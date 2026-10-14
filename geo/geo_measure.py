"""AI answer visibility measurement, driven by one product config.

Asks every prompt of a product's frozen panel on each configured engine, twice,
and three more times only when the first two disagree. One JSON row per answer
goes to <runs_dir>/<wave>-p<panel_v>.jsonl and, when the config names one, to
a private blob container. Engine kinds:

  azure-openai  Azure OpenAI Responses API with the web_search tool
  gemini-api    Gemini API key with Google Search grounding
  claude-code   Claude Code headless on the operator's subscription, WebSearch
                only, with --safe-mode and --strict-mcp-config so none of the
                operator's own notes reach the model
  claude-api    Anthropic Messages API (for example on Azure Foundry) with web search

Each engine names the Key Vault and secrets it reads, so every product is
billed to its own accounts. A config looks like:

  {"product": "mentorly", "site": "mentorly.com", "aliases": ["mentorly"],
   "competitors": ["chronus", "qooper", ...], "panel": "/path/panel.v1.json",
   "prompt": "Use web search for \\"{q}\\". ...", "runs_dir": "/path/runs",
   "storage": {"account": "stmentorlygeo", "container": "geo-runs"} or null,
   "engines": {"azure": {"kind": "azure-openai", "vault": "...", "endpoint_secret": "...",
                         "key_secret": "...", "deployment": "gpt-5.4", "workers": 1}, ...}}

An engine marked "default": false runs only when named with --engines.

Usage: geo_measure.py --config <product.json> [--engines a,b] [--wave YYYY-MM-DD] [--limit N] [--runs N] [--no-upload]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geo_stats as stats  # noqa: E402

METHOD_V = 1
MAX_RUNS = 5
SYSTEM = "You are a helpful assistant. Answer the user's question using web search and cite your sources."
URL = re.compile(r"https?://[^\s)\]>\"']+")
WRITE = threading.Lock()
_secrets: dict[tuple[str, str], str] = {}
_secrets_lock = threading.Lock()


def load(path: str | Path) -> dict:
    cfg = json.loads(Path(path).read_text())
    cfg["aliases"] = [a.lower() for a in cfg["aliases"]]
    cfg["competitors"] = [c.lower() for c in cfg.get("competitors", [])]
    return cfg


def prose(text: str) -> str:
    """The answer without its URLs, so a cited page of ours is not a mention."""
    return URL.sub(" ", text)


def named(text: str, aliases: list[str]) -> bool:
    low = prose(text).lower()
    return any(re.search(rf"\b{re.escape(a)}\b", low) for a in aliases)


def rank(text: str, aliases: list[str], competitors: list[str]) -> int | None:
    """The product's position among the platforms the answer names, by first mention."""
    low = prose(text).lower()
    first = {n: m.start() for n in list(competitors) + list(aliases)
             if (m := re.search(rf"\b{re.escape(n)}\b", low))}
    if not any(a in first for a in aliases):
        return None
    at = min(first[a] for a in aliases if a in first)
    return 1 + sum(1 for n, pos in first.items() if n not in aliases and pos < at)


def kv(vault: str, name: str) -> str:
    with _secrets_lock:
        if (vault, name) not in _secrets:
            _secrets[(vault, name)] = subprocess.run(
                ["az", "keyvault", "secret", "show", "--vault-name", vault, "--name", name, "--query", "value",
                 "-o", "tsv"], capture_output=True, text=True, check=True).stdout.strip()
        return _secrets[(vault, name)]


def _post(url: str, body: dict, headers: dict, attempts: int = 6) -> dict:
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
            return json.load(urllib.request.urlopen(req, timeout=240))
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 529) or attempt == attempts - 1:
                raise
            wait = exc.headers.get("retry-after") if exc.headers else None
            hinted = float(wait) if wait and wait.replace(".", "").isdigit() else 15 * (attempt + 1)
            time.sleep(min(60, max(15, hinted)))
    raise RuntimeError("unreachable")


def _without_citations(part: dict) -> str:
    """A message part's text with the spans the engine marked as citations removed."""
    text = part.get("text", "")
    spans = sorted(((a.get("start_index"), a.get("end_index")) for a in part.get("annotations", [])
                    if a.get("type") == "url_citation" and a.get("start_index") is not None), reverse=True)
    for start, end in spans:
        text = text[:start] + text[end:]
    return text


def ask_azure_openai(q: str, prompt: str, e: dict) -> tuple[str, list[str], str, dict]:
    d = _post(kv(e["vault"], e["endpoint_secret"]).rstrip("/") + "/openai/v1/responses",
              {"model": e["deployment"], "input": prompt.format(q=q), "tools": [{"type": "web_search"}]},
              {"api-key": kv(e["vault"], e["key_secret"]), "Content-Type": "application/json"})
    parts = [c for o in d.get("output", []) if o.get("type") == "message" for c in o.get("content", [])]
    cites = [a["url"].split("?utm")[0] for c in parts for a in c.get("annotations", [])
             if a.get("type") == "url_citation" and a.get("url")]
    u = d.get("usage", {})
    return (" ".join(_without_citations(c) for c in parts), cites, e["deployment"],
            {"input_tokens": u.get("input_tokens"), "output_tokens": u.get("output_tokens")})


def ask_gemini_api(q: str, prompt: str, e: dict) -> tuple[str, list[str], str, dict]:
    d = _post(f"https://generativelanguage.googleapis.com/v1beta/models/{e['model']}:generateContent",
              {"contents": [{"parts": [{"text": prompt.format(q=q)}]}], "tools": [{"google_search": {}}]},
              {"x-goog-api-key": kv(e["vault"], e["key_secret"]), "content-type": "application/json"})
    cand = d["candidates"][0]
    text = " ".join(p.get("text", "") for p in cand.get("content", {}).get("parts", []))
    chunks = cand.get("groundingMetadata", {}).get("groundingChunks", [])
    # Grounding returns redirect URLs; the chunk title carries the source domain.
    cites = ["https://" + c["web"]["title"] + "/" for c in chunks if c.get("web", {}).get("title")]
    u = d.get("usageMetadata", {})
    return text, cites, d.get("modelVersion", e["model"]), {
        "input_tokens": u.get("promptTokenCount"), "output_tokens": u.get("totalTokenCount"),
        "searches": len(cand.get("groundingMetadata", {}).get("webSearchQueries", []))}


def ask_claude_code(q: str, prompt: str, e: dict) -> tuple[str, list[str], str, dict]:
    """Claude Code headless on the subscription. --safe-mode and --strict-mcp-config keep the
    operator's CLAUDE.md, hooks and MCP servers out of the context (code review, 2026-10-14)."""
    with tempfile.TemporaryDirectory() as empty:
        out = subprocess.run(["claude", "-p", prompt.format(q=q), "--model", e.get("model", "sonnet"), "--tools",
                              "WebSearch", "--allowedTools", "WebSearch", "--system-prompt", SYSTEM,
                              "--output-format", "json", "--safe-mode", "--strict-mcp-config",
                              "--no-session-persistence"], cwd=empty, capture_output=True, text=True, timeout=600,
                             env={k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"})
    events = json.loads(out.stdout)
    result = next(ev for ev in (events if isinstance(events, list) else [events]) if ev.get("type") == "result")
    if result.get("is_error"):
        raise RuntimeError(str(result.get("result"))[:160])
    text = result.get("result", "")
    models = sorted((result.get("modelUsage") or {}).keys()) or [e.get("model", "sonnet")]
    return text, list(dict.fromkeys(URL.findall(text))), "claude-code/" + ",".join(models), {
        "api_equivalent_usd": result.get("total_cost_usd"),
        "searches": (result.get("usage") or {}).get("server_tool_use", {}).get("web_search_requests")}


def ask_claude_api(q: str, prompt: str, e: dict) -> tuple[str, list[str], str, dict]:
    d = _post(kv(e["vault"], e["endpoint_secret"]) + "v1/messages",
              {"model": kv(e["vault"], e["deployment_secret"]) if e.get("deployment_secret") else e["model"],
               "max_tokens": 4000, "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}],
               "messages": [{"role": "user", "content": prompt.format(q=q)}]},
              {"x-api-key": kv(e["vault"], e["key_secret"]), "anthropic-version": "2023-06-01",
               "content-type": "application/json"})
    blocks = [b for b in d["content"] if b["type"] == "text"]
    cites = [c["url"] for b in blocks for c in (b.get("citations") or []) if c.get("url")]
    u = d.get("usage", {})
    return " ".join(b.get("text", "") for b in blocks), cites, d.get("model", "claude-api"), {
        "input_tokens": u.get("input_tokens"), "output_tokens": u.get("output_tokens"),
        "searches": (u.get("server_tool_use") or {}).get("web_search_requests")}


KINDS = {"azure-openai": ask_azure_openai, "gemini-api": ask_gemini_api, "claude-code": ask_claude_code,
         "claude-api": ask_claude_api}


def answer_row(cfg: dict, engine: str, ask, prompt: dict, run: int, wave: str, panel_v: int) -> dict:
    kind = cfg["engines"][engine]["kind"] if engine in cfg.get("engines", {}) else ""
    row = {"wave": wave, "method_v": METHOD_V, "panel_v": panel_v, "product": cfg["product"], "engine": engine,
           "surface": "cli" if kind == "claude-code" else "api", "prompt_id": prompt["id"], "q": prompt["q"],
           "intent": prompt["intent"], "segment": prompt["segment"], "locale": prompt["locale"], "run": run,
           "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    try:
        text, cites, model, usage = ask(prompt["q"])
        row.update(model=model, answered=bool(text.strip()), named=named(text, cfg["aliases"]),
                   rank=rank(text, cfg["aliases"], cfg["competitors"]), cites=list(dict.fromkeys(cites)),
                   usage=usage, text=text, text_sha=hashlib.sha256(text.encode()).hexdigest()[:16])
    except Exception as exc:  # noqa: BLE001, a failed answer is data, never fatal
        row.update(answered=False, named=False, cites=[], error=str(exc)[:200])
    return row


def measure_prompt(cfg: dict, engine: str, ask, prompt: dict, wave: str, panel_v: int = 1, runs: int = 0) -> list[dict]:
    """runs=0 is early stopping (2, then 5 on a split); runs=N asks exactly N times."""
    rows = [answer_row(cfg, engine, ask, prompt, r, wave, panel_v) for r in range(runs or 2)]
    while not runs and stats.needs_more_runs([r["named"] for r in rows]) and len(rows) < MAX_RUNS:
        rows.append(answer_row(cfg, engine, ask, prompt, len(rows), wave, panel_v))
    return rows


def asker(cfg: dict, engine: str):
    e = cfg["engines"][engine]
    fn = KINDS[e["kind"]]
    return lambda q: fn(q, cfg["prompt"], e)


def measure_engine(cfg: dict, engine: str, prompts: list[dict], wave: str, out: Path, panel_v: int,
                   runs: int = 0, ask=None) -> list[dict]:
    ask = ask or asker(cfg, engine)
    rows: list[dict] = []
    with cf.ThreadPoolExecutor(cfg["engines"].get(engine, {}).get("workers", 1)) as pool:
        for batch in pool.map(lambda p: measure_prompt(cfg, engine, ask, p, wave, panel_v, runs), prompts):
            with WRITE, out.open("a") as f:
                for row in batch:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
            rows += batch
            print(f"[measure] {cfg['product']} {engine} {batch[0]['prompt_id']} named "
                  f"{sum(r['named'] for r in batch)}/{len(batch)}", flush=True)
    return rows


def upload(cfg: dict, path: Path) -> None:
    s = cfg.get("storage")
    if not s:
        return
    subprocess.run(["az", "storage", "blob", "upload", "--auth-mode", "login", "--account-name", s["account"],
                    "--container-name", s["container"], "--name", path.name, "--file", str(path), "--overwrite",
                    "-o", "none"], check=True)


def run(cfg: dict, engines: list[str], wave: str, limit: int = 0, runs: int = 0, no_upload: bool = False,
        askers: dict | None = None) -> int:
    panel = json.loads(Path(cfg["panel"]).read_text())
    prompts = panel["prompts"][: limit or None]
    runs_dir = Path(os.path.expanduser(cfg["runs_dir"]))
    runs_dir.mkdir(parents=True, exist_ok=True)
    out = runs_dir / f"{wave}-p{panel['panel_v']}.jsonl"
    if out.exists():
        print(f"[measure] {out} exists; a wave is written once. Use another --wave.", file=sys.stderr)
        return 2
    askers = askers or {}
    with cf.ThreadPoolExecutor(len(engines)) as pool:
        results = dict(zip(engines, pool.map(
            lambda e: measure_engine(cfg, e, prompts, wave, out, panel["panel_v"], runs, askers.get(e)), engines)))
    failed = [e for e, rows in results.items() if not rows or not any(r["answered"] for r in rows)]
    for engine, rows in results.items():
        v = stats.visibility(rows)
        print(f"[measure] {cfg['product']} {engine}: visibility {v['value']:.1%} [{v['ci_low']:.1%}, "
              f"{v['ci_high']:.1%}] over {v['n_prompts']} prompts, {v['n_answers']} answers, answered "
              f"{v['answered_rate']:.0%}, readable {stats.readable(rows)}")
    if not no_upload and cfg.get("storage"):
        upload(cfg, out)
        print(f"[measure] uploaded {out.name}")
    if failed:
        print(f"[measure] no answer at all from {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--engines", default="")
    ap.add_argument("--wave", default=time.strftime("%Y-%m-%d"))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--runs", type=int, default=0, help="exact runs per prompt; 0 is early stopping")
    ap.add_argument("--no-upload", action="store_true")
    args = ap.parse_args(argv)
    cfg = load(args.config)
    # An engine with "default": false runs only when asked for by name (a comparison surface).
    engines = [e for e in args.engines.split(",") if e] or [n for n, e in cfg["engines"].items() if e.get("default", True)]
    return run(cfg, engines, args.wave, args.limit, args.runs, args.no_upload)


if __name__ == "__main__":
    sys.exit(main())
