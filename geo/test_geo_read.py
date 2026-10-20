"""Tests for the two-wave reading. Run: python3 -m pytest geo -q (from the c3 repo)."""
import json

import geo_read as gr


def row(wave, pid, named, intent="discovery", locale="en", engine="azure", cites=(), text="", usage=None):
    return {"wave": wave, "engine": engine, "prompt_id": pid, "intent": intent, "locale": locale, "answered": True,
            "named": named, "cites": list(cites), "text": text, "usage": usage or {}}


CFG = {"product": "acme", "site": "acme.com", "competitors": ["turitop", "regiondo"]}


def test_brand_questions_stay_out_of_visibility_and_are_read_on_their_own():
    a = [row("w", f"p{i}", i < 10) for i in range(40)] + [row("w", "b1", True, "brand", cites=["https://www.acme.com/x"])]
    b = [row("wb", f"p{i}", i < 10) for i in range(40)] + [row("wb", "b1", True, "brand", cites=["https://notacme.com/"])]
    e = gr.read(CFG, a, b, {"brand"})["engines"]["azure"]
    assert e["first"]["value"] == 0.25 and e["first"]["n_prompts"] == 40 and e["first"]["readable"]
    assert e["aa"]["direction"] == "flat" and e["aa"]["delta"] == 0
    assert e["brand"] == {"answers": 2, "named": 1.0, "cites_site": 0.5}


def test_locales_pool_both_waves_per_question_and_competitors_are_counted_on_unbranded_answers():
    a = [row("w", "p1", True, locale="es", text="TuriTop o Regiondo"), row("w", "p2", False, locale="de", text="Regiondo")]
    b = [row("wb", "p1", False, locale="es", text="nada", usage={"input_tokens": 5}),
         row("wb", "p2", False, locale="de", text="Regiondo", usage={"input_tokens": 7})]
    e = gr.read(CFG, a, b, {"brand"})["engines"]["azure"]
    assert e["by_locale"]["es"]["value"] == 0.5 and e["by_locale"]["es"]["n_prompts"] == 1
    assert e["competitors_named"] == {"regiondo": 0.75, "turitop": 0.25}
    assert e["usage"] == {"input_tokens": 12}
    assert not e["first"]["readable"] and e["aa"]["direction"] == "not_readable"


def test_main_reads_the_waves_from_the_config_and_writes_the_reading(tmp_path):
    panel = tmp_path / "panel.json"
    panel.write_text(json.dumps({"panel_v": 2, "prompts": []}))
    runs = tmp_path / "runs"
    runs.mkdir()
    for w in ("w", "wb"):
        (runs / f"{w}-p2.jsonl").write_text("\n".join(json.dumps(row(w, f"p{i}", i % 2 == 0)) for i in range(40)))
    cfg = tmp_path / "c.json"
    cfg.write_text(json.dumps({**CFG, "aliases": ["acme"], "panel": str(panel), "runs_dir": str(runs)}))
    out = tmp_path / "read.json"
    assert gr.main(["--config", str(cfg), "--waves", "w,wb", "--out", str(out)]) == 0
    reading = json.loads(out.read_text())
    assert reading["waves"] == ["w", "wb"] and reading["engines"]["azure"]["second"]["value"] == 0.5


def test_the_second_wave_is_read_against_the_first_with_its_sign():
    a = [row("w", f"p{i}", i < 4) for i in range(40)]
    b = [row("wb", f"p{i}", i < 30) for i in range(40)]
    e = gr.read(CFG, a, b, {"brand"})["engines"]["azure"]
    assert e["first"]["value"] == 0.1 and e["second"]["value"] == 0.75
    assert e["aa"]["direction"] == "up" and round(e["aa"]["delta"], 2) == 0.65


def test_brand_answers_do_not_count_toward_competitors_and_spellings_group():
    cfg = {**CFG, "competitor_groups": {"Bókun": ["bokun", "Bókun"], "TuriTop": ["turitop"]}}
    a = [row("w", "p1", False, text="Bokun"), row("w", "b1", True, "brand", text="TuriTop")]
    b = [row("wb", "p1", False, text="Bókun and TuriTop"), {**row("wb", "p2", False), "answered": False, "error": "down"}]
    e = gr.read(cfg, a, b, {"brand"})["engines"]["azure"]
    assert e["competitors_named"] == {"Bókun": 1.0, "TuriTop": 0.5}
    assert e["errors"] == 1
