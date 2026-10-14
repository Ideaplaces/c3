"""Tests for the shared GEO measurement harness. Run: python3 -m pytest geo -q (from the c3 repo)."""
import json

import geo_measure as gm

ALIASES = ["mentorly"]
COMPETITORS = ["chronus", "qooper", "together platform", "mentorloop"]


def cfg(tmp_path, engines=None):
    panel = tmp_path / "panel.json"
    panel.write_text(json.dumps({"panel_v": 1, "prompts": [
        {"id": f"p{i}", "q": f"q{i}", "intent": "discovery", "segment": "general", "locale": "en"} for i in range(3)]}))
    return {"product": "acme", "site": "acme.com", "aliases": ALIASES, "competitors": COMPETITORS,
            "panel": str(panel), "prompt": "Use web search for \"{q}\".", "runs_dir": str(tmp_path / "runs"),
            "storage": None, "engines": engines or {"azure": {"kind": "azure-openai", "workers": 1}}}


def test_named_counts_the_product_in_the_prose_only():
    assert gm.named("Consider Mentorly for matching.", ALIASES)
    assert gm.named("MENTORLY is Canadian", ALIASES)
    assert gm.named("Mentorly ([site](https://mentorly.com))", ALIASES)
    assert not gm.named("Mentorloop and Mentorli are popular", ALIASES)
    assert not gm.named("Sources: https://www.mentorly.com/en/blog/top-tools", ALIASES)
    assert not gm.named("thementorlyst blog", ALIASES)
    assert gm.named("Tour Cockpit helps", ["tour cockpit"])


def test_rank_is_the_position_among_named_platforms():
    assert gm.rank("Chronus and Qooper lead; Mentorly is third", ALIASES, COMPETITORS) == 3
    assert gm.rank("Teams that work together often pick Mentorly.", ALIASES, COMPETITORS) == 1
    assert gm.rank("Chronus only", ALIASES, COMPETITORS) is None
    assert gm.rank("Together Platform and Chronus lead, then Mentorly", ALIASES, COMPETITORS) == 3


def test_early_stopping_and_exact_runs():
    c = {"product": "acme", "aliases": ALIASES, "competitors": [], "engines": {}}
    p = {"id": "a", "q": "x", "intent": "i", "segment": "s", "locale": "en"}
    assert len(gm.measure_prompt(c, "e", lambda q: ("Chronus", [], "m", {}), p, "w")) == 2
    answers = iter(["Mentorly", "Chronus", "Chronus", "Mentorly", "Chronus"])
    split = gm.measure_prompt(c, "e", lambda q: (next(answers), [], "m", {}), p, "w")
    assert [r["named"] for r in split] == [True, False, False, True, False]
    assert [r["run"] for r in split] == [0, 1, 2, 3, 4]
    assert len(gm.measure_prompt(c, "e", lambda q: ("x", [], "m", {}), p, "w", runs=1)) == 1


def test_a_failing_or_blank_engine_is_unanswered_data():
    c = {"product": "acme", "aliases": ALIASES, "competitors": [], "engines": {}}
    p = {"id": "a", "q": "x", "intent": "i", "segment": "s", "locale": "en"}
    def broken(q):
        raise TimeoutError("down")
    assert not any(r["answered"] for r in gm.measure_prompt(c, "e", broken, p, "w"))
    assert gm.answer_row(c, "e", lambda q: ("  ", [], "m", {}), p, 0, "w", 1)["answered"] is False


def test_a_wave_runs_from_config_alone_once(tmp_path):
    c = cfg(tmp_path)
    assert gm.run(c, ["azure"], "w1", askers={"azure": lambda q: ("Mentorly", [], "m", {})}) == 0
    rows = [json.loads(l) for l in (tmp_path / "runs/w1-p1.jsonl").read_text().splitlines()]
    assert len(rows) == 6 and {r["product"] for r in rows} == {"acme"} and all(r["panel_v"] == 1 for r in rows)
    assert gm.run(c, ["azure"], "w1", askers={"azure": lambda q: ("x", [], "m", {})}) == 2


def test_an_engine_that_never_answers_fails_the_wave(tmp_path):
    def down(q):
        raise ConnectionError("down")
    c = cfg(tmp_path, {"a": {"kind": "azure-openai"}, "b": {"kind": "gemini-api"}})
    assert gm.run(c, ["a", "b"], "w", askers={"a": lambda q: ("Chronus", [], "m", {}), "b": down}) == 1


def test_claude_code_runs_without_the_operators_instructions_or_tools(monkeypatch):
    seen = {}
    class Done:
        stdout = '[{"type": "result", "result": "Chronus", "is_error": false, "modelUsage": {"claude-sonnet-5": {}}}]'
    def fake_run(cmd, **kw):
        seen["cmd"], seen["env"], seen["cwd"] = cmd, kw.get("env", {}), kw.get("cwd")
        return Done()
    monkeypatch.setattr(gm.subprocess, "run", fake_run)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    text, _, model, _ = gm.ask_claude_code("q", "{q}", {"model": "sonnet"})
    for flag in ("--safe-mode", "--strict-mcp-config", "--no-session-persistence", "--system-prompt", "--allowedTools"):
        assert flag in seen["cmd"]
    assert seen["cmd"][seen["cmd"].index("--tools") + 1] == "WebSearch"
    assert seen["cwd"].startswith(gm.tempfile.gettempdir()) and seen["cwd"] != gm.os.path.expanduser("~")
    assert "ANTHROPIC_API_KEY" not in seen["env"] and model == "claude-code/claude-sonnet-5"


def test_claude_code_errors_raise(monkeypatch):
    class Done:
        stdout = '{"type": "result", "result": "usage limit reached", "is_error": true}'
    monkeypatch.setattr(gm.subprocess, "run", lambda cmd, **kw: Done())
    try:
        gm.ask_claude_code("q", "{q}", {})
        assert False
    except RuntimeError as exc:
        assert "usage limit" in str(exc)


def test_replies_are_read_for_each_api_engine(monkeypatch):
    monkeypatch.setattr(gm, "kv", lambda vault, name: "https://x/" if "endpoint" in name else "k")
    monkeypatch.setattr(gm, "_post", lambda url, body, headers: {
        "usage": {"input_tokens": 3}, "output": [{"type": "message", "content": [
            {"text": "Mentorly [1] and Chronus", "annotations": [
                {"type": "url_citation", "url": "https://mentorly.com/x?utm=1", "start_index": 9, "end_index": 12}]}]}]})
    text, cites, model, _ = gm.ask_azure_openai("q", "{q}", {"vault": "v", "endpoint_secret": "endpoint",
                                                               "key_secret": "key", "deployment": "gpt"})
    assert text == "Mentorly  and Chronus" and cites == ["https://mentorly.com/x"] and model == "gpt"
    monkeypatch.setattr(gm, "_post", lambda url, body, headers: {
        "modelVersion": "gemini-x", "usageMetadata": {}, "candidates": [{"content": {"parts": [{"text": "Qooper"}]},
        "groundingMetadata": {"groundingChunks": [{"web": {"title": "qooper.io"}}], "webSearchQueries": ["q"]}}]})
    assert gm.ask_gemini_api("q", "{q}", {"vault": "v", "key_secret": "k", "model": "g"})[:3] == (
        "Qooper", ["https://qooper.io/"], "gemini-x")
    monkeypatch.setattr(gm, "_post", lambda url, body, headers: {
        "model": "claude-sonnet-5", "usage": {"server_tool_use": {"web_search_requests": 2}},
        "content": [{"type": "server_tool_use"}, {"type": "text", "text": "Mentorloop",
                                                   "citations": [{"url": "https://mentorloop.com/a"}]}]})
    assert gm.ask_claude_api("q", "{q}", {"vault": "v", "endpoint_secret": "endpoint", "key_secret": "k",
                                          "model": "m"})[:2] == ("Mentorloop", ["https://mentorloop.com/a"])


def test_rows_carry_the_surface_and_what_the_judge_needs(tmp_path):
    c = cfg(tmp_path, {"code": {"kind": "claude-code"}, "api": {"kind": "claude-api"}})
    p = {"id": "u01", "q": "q", "intent": "use_case", "segment": "s", "locale": "en"}
    row = gm.answer_row(c, "code", lambda q: ("Mentorly", ["https://a.com/x", "https://a.com/x"], "m", {"t": 1}), p, 0, "w", 1)
    assert row["surface"] == "cli" and row["cites"] == ["https://a.com/x"] and row["rank"] == 1
    for key in ("wave", "method_v", "panel_v", "product", "engine", "prompt_id", "intent", "segment", "locale", "run",
                "model", "answered", "named", "rank", "cites", "usage", "text_sha"):
        assert key in row
    assert gm.answer_row(c, "api", lambda q: ("x", [], "m", {}), p, 0, "w", 1)["surface"] == "api"


def test_upload_runs_only_with_storage_and_without_no_upload(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(gm, "upload", lambda c, path: calls.append(path.name))
    c = {**cfg(tmp_path), "storage": {"account": "a", "container": "b"}}
    gm.run(c, ["azure"], "w1", askers={"azure": lambda q: ("x", [], "m", {})}, no_upload=True)
    gm.run(c, ["azure"], "w2", askers={"azure": lambda q: ("x", [], "m", {})})
    assert calls == ["w2-p1.jsonl"]


def test_an_opt_in_engine_runs_only_when_named(tmp_path, monkeypatch):
    seen = []
    monkeypatch.setattr(gm, "run", lambda c, engines, *a, **k: seen.append(engines) or 0)
    path = tmp_path / "c.json"
    path.write_text(json.dumps({**cfg(tmp_path, {"a": {"kind": "azure-openai"}, "b": {"kind": "claude-api", "default": False}})}))
    gm.main(["--config", str(path)])
    gm.main(["--config", str(path), "--engines", "b"])
    assert seen == [["a"], ["b"]]


def test_a_partly_answering_engine_does_not_fail_the_wave(tmp_path):
    answers = iter([ConnectionError("blip")] + [("Chronus", [], "m", {})] * 20)
    def flaky(q):
        a = next(answers)
        if isinstance(a, Exception):
            raise a
        return a
    assert gm.run(cfg(tmp_path), ["azure"], "w", askers={"azure": flaky}) == 0


def test_rank_ignores_urls_and_partial_words():
    assert gm.rank("See https://chronus.com/x first, then Mentorly", ALIASES, COMPETITORS) == 1
    assert gm.rank("Chronusly speaking, Mentorly", ALIASES, COMPETITORS) == 1


def test_several_azure_citations_are_all_stripped(monkeypatch):
    monkeypatch.setattr(gm, "kv", lambda vault, name: "https://x/")
    text = "Alpha [1] beta [2] gamma"
    monkeypatch.setattr(gm, "_post", lambda url, body, headers: {"usage": {}, "output": [{"type": "message", "content": [
        {"text": text, "annotations": [{"type": "url_citation", "url": "https://a.com", "start_index": 6, "end_index": 9},
                                       {"type": "url_citation", "url": "https://b.com", "start_index": 15, "end_index": 18}]}]}]})
    out, cites, _, _ = gm.ask_azure_openai("q", "{q}", {"vault": "v", "endpoint_secret": "e", "key_secret": "k",
                                                        "deployment": "d"})
    assert out == "Alpha  beta  gamma" and cites == ["https://a.com", "https://b.com"]


def test_gemini_reads_every_text_part(monkeypatch):
    monkeypatch.setattr(gm, "kv", lambda vault, name: "k")
    monkeypatch.setattr(gm, "_post", lambda url, body, headers: {"candidates": [{"content": {"parts": [
        {"text": "Chronus"}, {"text": "Mentorly"}]}}]})
    assert gm.ask_gemini_api("q", "{q}", {"vault": "v", "key_secret": "k", "model": "g"})[0] == "Chronus Mentorly"


def test_load_lowercases_names_and_main_honours_limit(tmp_path):
    path = tmp_path / "c.json"
    path.write_text(json.dumps({**cfg(tmp_path), "aliases": ["MentorLy"], "competitors": ["Chronus"]}))
    c = gm.load(path)
    assert c["aliases"] == ["mentorly"] and c["competitors"] == ["chronus"]
    gm.KINDS["azure-openai"], orig = (lambda q, prompt, e: ("x", [], "m", {})), gm.KINDS["azure-openai"]
    try:
        assert gm.main(["--config", str(path), "--wave", "w", "--limit", "2", "--runs", "1"]) == 0
    finally:
        gm.KINDS["azure-openai"] = orig
    assert len((tmp_path / "runs/w-p1.jsonl").read_text().splitlines()) == 2
