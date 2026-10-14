"""Statistics of the AI answer visibility measurement, shared by every product
that runs the GEO harness (geo_measure.py) from its own config.

Visibility is the mean over prompts of each prompt's named rate, never the
share of all answers: a prompt asked five times must not weigh more than one
asked twice. Intervals are a bootstrap that resamples prompts, because answers
to one prompt are not independent of each other. A change is a change only
when the interval of the difference excludes zero. """
from __future__ import annotations

import math
import random
from collections import defaultdict

RESAMPLES = 2000
MIN_PROMPTS = 40
MIN_ANSWERED = 0.8


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95 percent Wilson interval of k successes in n trials."""
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, centre - half), min(1.0, centre + half))


def per_prompt(rows: list[dict]) -> dict[str, float]:
    """Named rate per prompt. A row that did not answer counts as not named."""
    named: dict[str, list[bool]] = defaultdict(list)
    for row in rows:
        named[row["prompt_id"]].append(bool(row.get("answered") and row.get("named")))
    return {p: sum(v) / len(v) for p, v in named.items()}


def _percentile(sorted_values: list[float], q: float) -> float:
    return sorted_values[min(len(sorted_values) - 1, int(q * len(sorted_values)))]


def visibility(rows: list[dict], seed: int = 0) -> dict:
    rates = per_prompt(rows)
    prompts = sorted(rates)
    if not prompts:
        return {"value": 0.0, "ci_low": 0.0, "ci_high": 1.0, "n_prompts": 0, "n_answers": 0, "answered_rate": 0.0}
    rng = random.Random(seed)
    boot = sorted(sum(rates[rng.choice(prompts)] for _ in prompts) / len(prompts) for _ in range(RESAMPLES))
    return {
        "value": sum(rates.values()) / len(prompts),
        "ci_low": _percentile(boot, 0.025),
        "ci_high": _percentile(boot, 0.975),
        "n_prompts": len(prompts),
        "n_answers": len(rows),
        "answered_rate": sum(1 for r in rows if r.get("answered")) / len(rows),
    }


def readable(rows: list[dict]) -> bool:
    """A wave can be read only with enough prompts and enough real answers."""
    if not rows:
        return False
    answered = sum(1 for r in rows if r.get("answered")) / len(rows)
    return len(per_prompt(rows)) >= MIN_PROMPTS and answered >= MIN_ANSWERED


def compare(before: list[dict], after: list[dict], seed: int = 0, min_prompts: int = MIN_PROMPTS) -> dict:
    """Paired bootstrap over the prompts both waves asked. Up or down only when
    the 95 percent interval of the difference excludes zero, otherwise flat.
    Fewer than min_prompts in common is not readable: one prompt is not a wave."""
    a, b = per_prompt(before), per_prompt(after)
    prompts = sorted(set(a) & set(b))
    if len(prompts) < min_prompts:
        return {"direction": "not_readable", "delta": 0.0, "ci_low": 0.0, "ci_high": 0.0, "n_prompts": len(prompts)}
    diffs = {p: b[p] - a[p] for p in prompts}
    rng = random.Random(seed)
    boot = sorted(sum(diffs[rng.choice(prompts)] for _ in prompts) / len(prompts) for _ in range(RESAMPLES))
    low, high = _percentile(boot, 0.025), _percentile(boot, 0.975)
    direction = "up" if low > 0 else "down" if high < 0 else "flat"
    return {"direction": direction, "delta": sum(diffs.values()) / len(prompts), "ci_low": low, "ci_high": high,
            "n_prompts": len(prompts)}


def needs_more_runs(named: list[bool]) -> bool:
    """Early stopping: two runs that agree settle a prompt; a split asks for five."""
    return len(named) < 2 or len(set(named[:2])) > 1


def runs_by_prompt(rows: list[dict]) -> dict[str, list[bool]]:
    named: dict[str, list[bool]] = defaultdict(list)
    for row in rows:
        named[row["prompt_id"]].append(bool(row.get("answered") and row.get("named")))
    return dict(named)


def diff_in_diff(before: list[dict], after: list[dict], targets: set[str], seed: int = 0,
                 min_targets: int = 2, min_controls: int = 5) -> dict:
    """How much more the targeted prompts moved than the control prompts did.
    Two-stage bootstrap: prompts are resampled within each group, then runs
    within each prompt, so both the spread between prompts and the noise of a
    prompt's own few runs reach the interval. Needs min_targets and
    min_controls prompts present in both windows."""
    a, b = runs_by_prompt(before), runs_by_prompt(after)
    common = set(a) & set(b)
    tgt, ctl = sorted(common & targets), sorted(common - targets)
    if len(tgt) < min_targets or len(ctl) < min_controls:
        return {"effect": 0.0, "ci_low": 0.0, "ci_high": 0.0, "n_target": len(tgt), "n_control": len(ctl),
                "readable": False}
    rng = random.Random(seed)

    def rate(xs: list[bool], resample: bool) -> float:
        draw = [rng.choice(xs) for _ in xs] if resample else xs
        return sum(draw) / len(draw)

    def delta(p: str, resample: bool) -> float:
        return rate(b[p], resample) - rate(a[p], resample)

    def effect(resample: bool) -> float:
        t = [rng.choice(tgt) for _ in tgt] if resample else tgt
        c = [rng.choice(ctl) for _ in ctl] if resample else ctl
        return sum(delta(p, resample) for p in t) / len(t) - sum(delta(p, resample) for p in c) / len(c)

    boot = sorted(effect(True) for _ in range(RESAMPLES))
    return {"effect": effect(False), "ci_low": _percentile(boot, 0.025), "ci_high": _percentile(boot, 0.975),
            "n_target": len(tgt), "n_control": len(ctl), "readable": True}
