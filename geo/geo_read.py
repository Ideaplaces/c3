"""Reads two waves of the GEO harness side by side: visibility per engine with its interval on each
wave, and the paired comparison of the second against the first. Two waves of an unchanged site are
the A/A pair, which must read flat before any change is judged against the baseline.

Visibility is read on the unbranded questions only: intents named in --exclude-intents (default
"brand") are left out, because a question that names the product is answered with its name and would
inflate the reading. For those questions the reading reports instead how often the answer names the
product and how often it cites the product's site. It also reports visibility per locale (both waves'
runs pooled per question), how often
each competitor is named (its spellings grouped by the config's optional "competitor_groups",
{"Bókun": ["bokun", "bókun"]}, otherwise one entry per name), and the tokens each engine used.

Usage: geo_read.py --config <product.json> --waves A,B [--exclude-intents brand] [--out file.json]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geo_measure as gm  # noqa: E402
import geo_stats as stats  # noqa: E402


def wave_rows(cfg: dict, wave: str) -> list[dict]:
    panel_v = json.loads(Path(cfg["panel"]).read_text())["panel_v"]
    path = Path(os.path.expanduser(cfg["runs_dir"])) / f"{wave}-p{panel_v}.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def cites_site(row: dict, site: str) -> bool:
    return any(re.search(rf"(^|[/.]){re.escape(site)}(/|$)", re.sub(r"^https?://", "", u)) for u in row.get("cites", []))


def engine_reading(cfg: dict, a: list[dict], b: list[dict], exclude: set[str]) -> dict:
    ua, ub = ([r for r in rows if r["intent"] not in exclude] for rows in (a, b))
    brand = [r for r in a + b if r["intent"] in exclude and r.get("answered")]
    by_locale = defaultdict(list)
    for r in ua + ub:
        by_locale[r["locale"]].append(r)  # both waves' runs of a question pool into one rate
    answered = [r for r in ua + ub if r.get("answered")]
    groups = cfg.get("competitor_groups") or {c: [c] for c in cfg["competitors"]}
    competitors = {c: sum(gm.named(r.get("text", ""), [n.lower() for n in names]) for r in answered) / max(1, len(answered))
                   for c, names in groups.items()}
    usage = defaultdict(float)
    for r in a + b:
        for k, v in (r.get("usage") or {}).items():
            if isinstance(v, (int, float)):
                usage[k] += v
    return {
        "first": {**stats.visibility(ua), "readable": stats.readable(ua)},
        "second": {**stats.visibility(ub), "readable": stats.readable(ub)},
        "aa": stats.compare(ua, ub),
        "by_locale": {loc: {k: v for k, v in stats.visibility(rows).items() if k in ("value", "ci_low", "ci_high", "n_prompts")}
                      for loc, rows in sorted(by_locale.items())},
        "brand": {"answers": len(brand), "named": sum(r["named"] for r in brand) / max(1, len(brand)),
                  "cites_site": sum(cites_site(r, cfg["site"]) for r in brand) / max(1, len(brand))},
        "competitors_named": {c: round(v, 3) for c, v in sorted(competitors.items(), key=lambda kv: -kv[1]) if v},
        "errors": sum(1 for r in a + b if r.get("error")),
        "usage": dict(usage),
    }


def read(cfg: dict, a: list[dict], b: list[dict], exclude: set[str]) -> dict:
    engines = sorted({r["engine"] for r in a} | {r["engine"] for r in b})
    return {"product": cfg["product"], "waves": [a[0]["wave"] if a else None, b[0]["wave"] if b else None],
            "excluded_intents": sorted(exclude),
            "engines": {e: engine_reading(cfg, [r for r in a if r["engine"] == e], [r for r in b if r["engine"] == e],
                                          exclude) for e in engines}}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--waves", required=True, help="first,second")
    ap.add_argument("--exclude-intents", default="brand")
    ap.add_argument("--out", default="")
    args = ap.parse_args(argv)
    cfg = gm.load(args.config)
    first, second = args.waves.split(",")
    out = read(cfg, wave_rows(cfg, first), wave_rows(cfg, second), {i for i in args.exclude_intents.split(",") if i})
    text = json.dumps(out, indent=1, ensure_ascii=False)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(text + "\n")
    for e, r in out["engines"].items():
        f, s, aa = r["first"], r["second"], r["aa"]
        print(f"{e}: {f['value']:.1%} [{f['ci_low']:.1%}, {f['ci_high']:.1%}] then {s['value']:.1%} "
              f"[{s['ci_low']:.1%}, {s['ci_high']:.1%}], A/A {aa['direction']} {aa['delta']:+.1%} "
              f"[{aa['ci_low']:+.1%}, {aa['ci_high']:+.1%}], brand named {r['brand']['named']:.0%} "
              f"cites site {r['brand']['cites_site']:.0%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
