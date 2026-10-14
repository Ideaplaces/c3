"""Tests for the shared visibility statistics. Run: python3 -m pytest geo -q (from the c3 repo)."""
import random

import geo_stats as stats


def rows(rates: dict[str, tuple[int, int]], engine: str = "e") -> list[dict]:
    """{prompt_id: (named, runs)} as answer rows."""
    out = []
    for pid, (k, n) in rates.items():
        out += [{"engine": engine, "prompt_id": pid, "named": i < k, "answered": True} for i in range(n)]
    return out


def test_wilson_edges_and_middle():
    lo, hi = stats.wilson(0, 5)
    assert lo == 0 and 0.43 < hi < 0.44
    lo, hi = stats.wilson(5, 5)
    assert 0.56 < lo < 0.57 and hi == 1
    assert stats.wilson(0, 0) == (0.0, 1.0)
    lo, hi = stats.wilson(50, 100)
    assert 0.40 < lo < 0.41 and 0.59 < hi < 0.60


def test_visibility_is_the_mean_of_per_prompt_rates_not_of_answers():
    # One prompt with 5 runs at 100 percent and one with 2 runs at 0 percent is
    # 50 percent visibility, not 5 of 7.
    r = rows({"a": (5, 5), "b": (0, 2)})
    assert stats.visibility(r)["value"] == 0.5


def test_unanswered_rows_count_as_not_named_but_lower_the_answered_rate():
    r = rows({"a": (2, 2)}) + [{"engine": "e", "prompt_id": "a", "named": False, "answered": False}]
    v = stats.visibility(r)
    assert round(v["value"], 3) == 0.667 and round(v["answered_rate"], 3) == 0.667


def test_bootstrap_interval_contains_the_value_and_is_seeded():
    r = rows({f"p{i}": ((i % 3) and 1 or 0, 2) for i in range(40)})
    a, b = stats.visibility(r, seed=7), stats.visibility(r, seed=7)
    assert a == b
    assert a["ci_low"] <= a["value"] <= a["ci_high"]
    assert a["ci_high"] - a["ci_low"] > 0


def test_a_wave_needs_enough_prompts_and_answers_to_be_readable():
    assert stats.readable(rows({f"p{i}": (0, 2) for i in range(40)}))
    assert not stats.readable(rows({f"p{i}": (0, 2) for i in range(39)}))
    unanswered = rows({f"p{i}": (0, 2) for i in range(40)})
    for x in unanswered[:20]:
        x["answered"] = False
    assert not stats.readable(unanswered)


def test_compare_reports_flat_for_two_draws_of_the_same_site():
    random.seed(3)
    truth = {f"p{i}": random.random() < 0.15 for i in range(46)}
    def draw():
        return [{"engine": "e", "prompt_id": p, "named": named and random.random() < 0.9, "answered": True}
                for p, named in truth.items() for _ in range(2)]
    assert stats.compare(draw(), draw(), seed=1)["direction"] == "flat"


def test_compare_detects_a_large_real_move():
    before = rows({f"p{i}": (0, 2) for i in range(40)})
    after = rows({f"p{i}": (2 if i < 20 else 0, 2) for i in range(40)})
    c = stats.compare(before, after, seed=1)
    assert c["direction"] == "up" and c["ci_low"] > 0


def test_compare_only_uses_prompts_present_in_both_waves_and_needs_enough_of_them():
    before = rows({"a": (0, 2), "b": (0, 2)})
    after = rows({"a": (2, 2), "c": (2, 2)})
    c = stats.compare(before, after, seed=1)
    assert c["n_prompts"] == 1 and c["direction"] == "not_readable"
    many_before = rows({f"p{i}": (0, 2) for i in range(40)} | {"x": (0, 2)})
    many_after = rows({f"p{i}": (2, 2) for i in range(40)} | {"y": (2, 2)})
    assert stats.compare(many_before, many_after, seed=1)["n_prompts"] == 40


def test_early_stop_runs_more_only_when_the_first_two_disagree():
    assert stats.needs_more_runs([True, True]) is False
    assert stats.needs_more_runs([False, False]) is False
    assert stats.needs_more_runs([True, False]) is True
    assert stats.needs_more_runs([True]) is True


def test_compare_detects_a_large_real_drop():
    before = rows({f"p{i}": (2 if i < 20 else 0, 2) for i in range(40)})
    after = rows({f"p{i}": (0, 2) for i in range(40)})
    c = stats.compare(before, after, seed=1)
    assert c["direction"] == "down" and c["ci_high"] < 0 and c["delta"] == -0.5


def test_readable_at_exactly_eighty_percent_answered():
    wave = rows({f"p{i}": (0, 5) for i in range(40)})
    for x in wave[::5]:  # one row in five unanswered: exactly 80 percent answered
        x["answered"] = False
    assert stats.readable(wave)
    wave[1]["answered"] = False
    assert not stats.readable(wave)


def test_answered_rate_counts_answers_not_mentions():
    r = rows({"a": (0, 3)})
    r[0]["answered"] = False
    assert round(stats.visibility(r)["answered_rate"], 3) == 0.667 and stats.visibility(r)["value"] == 0


def test_interval_has_the_expected_width_for_a_known_spread():
    # 40 prompts, 10 always named and 30 never: visibility 25 percent, and the
    # bootstrap over prompts gives roughly 12 to 40 percent (normal theory 12 to 38).
    r = rows({f"p{i}": ((2 if i < 10 else 0), 2) for i in range(40)})
    v = stats.visibility(r, seed=3)
    assert v["value"] == 0.25
    assert 0.10 < v["ci_low"] < 0.15 and 0.35 < v["ci_high"] <= 0.42


def test_compare_needs_forty_common_prompts_by_default():
    before = rows({f"p{i}": (0, 2) for i in range(39)})
    after = rows({f"p{i}": (2, 2) for i in range(39)})
    assert stats.compare(before, after, seed=1)["direction"] == "not_readable"
    assert stats.compare(before, after, seed=1, min_prompts=39)["direction"] == "up"


def test_diff_in_diff_credits_only_the_targeted_prompts():
    before = rows({f"p{i}": (0, 2) for i in range(30)})
    after = rows({f"p{i}": ((2 if i < 5 else 0), 2) for i in range(30)})
    d = stats.diff_in_diff(before, after, {f"p{i}" for i in range(5)}, seed=1)
    assert d["readable"] and d["effect"] == 1.0 and d["ci_low"] > 0.5
    # The whole panel rising together is not the change's effect.
    rising = rows({f"p{i}": (2, 2) for i in range(30)})
    d = stats.diff_in_diff(before, rising, {f"p{i}" for i in range(5)}, seed=1)
    assert d["effect"] == 0 and d["ci_low"] <= 0 <= d["ci_high"]


def test_diff_in_diff_needs_a_control_group():
    before = rows({f"p{i}": (0, 2) for i in range(6)})
    after = rows({f"p{i}": (2, 2) for i in range(6)})
    assert stats.diff_in_diff(before, after, {f"p{i}" for i in range(3)})["readable"] is False


def test_diff_in_diff_needs_two_targets_and_counts_noise_within_prompts():
    before = rows({f"p{i}": (0, 2) for i in range(30)})
    after = rows({f"p{i}": ((2 if i < 2 else 0), 2) for i in range(30)})
    assert stats.diff_in_diff(before, after, {"p0"}, seed=1)["readable"] is False
    assert stats.diff_in_diff(before, after, {"p0", "p1"}, seed=1)["readable"] is True
    # Two targets each at 1 of 2 runs: the run-level noise must widen the interval past zero.
    noisy = rows({f"p{i}": ((1 if i < 2 else 0), 2) for i in range(30)})
    d = stats.diff_in_diff(before, noisy, {"p0", "p1"}, seed=1)
    assert d["effect"] == 0.5 and d["ci_low"] <= 0


def _windows(target_change, control_change, n_target=8, n_control=30, base=20):
    before = {f"t{i}": base for i in range(n_target)} | {f"c{i}": base for i in range(n_control)}
    after = {f"t{i}": base * target_change for i in range(n_target)} | {f"c{i}": base * control_change for i in range(n_control)}
    return before, after, {f"t{i}" for i in range(n_target)}


def test_continuous_did_reads_a_relative_change_net_of_the_controls():
    before, after, targets = _windows(2.0, 1.0)
    d = stats.continuous_did(before, after, targets, seed=1)
    assert d["readable"] and 0.9 < d["relative"] < 1.1 and d["ci_low"] > 0  # doubled, about +100 percent
    before, after, targets = _windows(2.0, 2.0)  # everything doubled: the change is not ours
    d = stats.continuous_did(before, after, targets, seed=1)
    assert abs(d["relative"]) < 0.01 and d["ci_low"] <= 0 <= d["ci_high"]


def test_continuous_did_needs_volume_and_enough_queries():
    before, after, targets = _windows(2.0, 1.0, base=2)  # 16 impressions before: too thin
    assert stats.continuous_did(before, after, targets, seed=1, min_target_volume=100)["readable"] is False
    before, after, targets = _windows(2.0, 1.0, n_control=3)
    assert stats.continuous_did(before, after, targets, seed=1)["readable"] is False


def test_continuous_did_counts_a_query_missing_from_a_window_as_zero():
    before = {"t0": 50, "t1": 50, "c0": 10, "c1": 10, "c2": 10, "c3": 10, "c4": 10}
    after = {"t0": 50, "c0": 10, "c1": 10, "c2": 10, "c3": 10, "c4": 10}  # t1 vanished
    d = stats.continuous_did(before, after, {"t0", "t1"}, seed=1, min_target_volume=0, min_targets=2)
    assert d["effect"] < 0
