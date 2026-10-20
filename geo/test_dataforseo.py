"""Tests for the shared DataForSEO client and its per-product spend cap. Run: python3 -m pytest geo -q"""
import datetime as dt
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

import config
import dataforseo as d

DAY = dt.date(2026, 10, 14)


def balance_then(cost, start=51.0):
    def http(path, body=None):
        if path == "appendix/user_data":
            return {"tasks": [{"result": [{"money": {"balance": start}}]}]}
        return {"status_code": 20000, "cost": cost, "tasks": []}
    return http


def call(path, http, spend_path, run, cap=15, **kw):
    return d.call(path, [{}], http=http, cap=cap, spend_path=spend_path, run=run, today=kw.pop("today", DAY), **kw)


def test_spend_is_the_reported_costs_and_a_top_up_never_erases_it(tmp_path):
    p = tmp_path / "spend.json"
    assert d.month_spend(51.0, DAY, p) == 0  # run 1 reads 51 before its calls
    d.settle(37.0, DAY, p, cost=14.0)  # and spends 14
    assert d.month_spend(87.0, DAY, p) == 14  # topped up 50 before run 2: still 14 spent
    assert json.loads(p.read_text())["2026-10"]["topups"] == 50.0
    d.settle(85.0, DAY, p, cost=2.005)
    assert d.month_spend(85.0, DAY, p) == pytest.approx(16.005)
    assert d.month_spend(85.004, DAY, p) == pytest.approx(16.005)  # a rise under a cent is rounding, not a top-up
    assert json.loads(p.read_text())["2026-10"]["topups"] == 50.0
    assert d.month_spend(97.0, dt.date(2026, 11, 1), p) == 0  # a new month starts over


def test_a_month_recorded_under_the_balance_formula_keeps_its_spend(tmp_path):
    p = tmp_path / "spend.json"
    p.write_text(json.dumps({"2026-10": {"start": 51.0, "topups": 10.0, "last": 55.5}}))
    assert d.month_spend(55.5, DAY, p) == 5.5
    call("serp", balance_then(1.0, 55.5), p, {})
    assert d.month_spend(54.5, DAY, p) == 6.5


def test_spend_isolated_per_product(tmp_path):
    """Two products on one account: each one's spend is its own calls, whatever the other spends,
    and a top-up landing while the other spends is never read as spend or as a refund."""
    account = {"balance": 51.0}

    def http(cost):
        def answer(path, body=None):
            if path == "appendix/user_data":
                return {"tasks": [{"result": [{"money": {"balance": account["balance"]}}]}]}
            account["balance"] -= cost
            return {"status_code": 20000, "cost": cost, "tasks": []}
        return answer

    def product(name):
        return config.parse({"product": name, "site": f"{name}.com", "aliases": [name], "timezone": "UTC",
                             "runs_dir": str(tmp_path / name / "runs"),
                             "dataforseo": {"vault": "shared-vault", "login_secret": "l", "password_secret": "p",
                                            "monthly_cap_usd": 15, "spend_file": str(tmp_path / name / "spend.json")}})

    a, b = d.Client.from_config(product("a")), d.Client.from_config(product("b"))
    a.call("serp", [{}], http=http(6.0), today=DAY)
    a.run["lock"].close()
    for _ in range(3):  # the other product spends 9 in between
        b.call("serp", [{}], http=http(3.0), today=DAY)
    b.run["lock"].close()
    account["balance"] += 4.0  # a top-up smaller than what the other spent
    again = d.Client.from_config(product("a"))
    again.call("serp", [{}], http=http(6.0), today=DAY)  # 6 spent + 6 dearest fits under 15; 6 + 9 + 6 would not
    assert again.run["start_spend"] == 6.0 and again.month_spend(account["balance"], DAY) == 12.0
    again.run["lock"].close()
    assert d.Client.from_config(product("b")).month_spend(account["balance"], DAY) == 9.0
    with pytest.raises(d.CapReached):  # 12 spent, and another 6 would make 18: its own cap, its own calls
        again.call("serp", [{}], http=http(6.0), today=DAY)


def test_the_cap_counts_each_calls_cost_and_reads_the_balance_once(tmp_path):
    seen = []
    inner = balance_then(5.0)
    http = lambda path, body=None: (seen.append(path), inner(path, body))[1]
    run = {}
    for _ in range(3):  # 0, 5, 10 spent before each call: the dearest call (5) still fits under 15
        call("serp", http, tmp_path / "spend.json", run)
    with pytest.raises(d.CapReached):  # 15 spent
        call("serp", http, tmp_path / "spend.json", run)
    assert seen.count("appendix/user_data") == 1 and seen.count("serp") == 3


def test_a_call_that_could_cross_the_cap_is_refused(tmp_path):
    run = {}
    call("serp", balance_then(8.0), tmp_path / "s.json", run)
    with pytest.raises(d.CapReached):  # 8 spent, and another 8 would make 16
        call("serp", balance_then(8.0), tmp_path / "s.json", run)


def test_the_next_run_sees_what_this_run_spent(tmp_path):
    p = tmp_path / "spend.json"
    call("serp", balance_then(6.0, 51.0), p, {})
    assert json.loads(p.read_text())["2026-10"] == {"start": 51.0, "topups": 0.0, "last": 45.0, "spent": 6.0}
    second = {}
    call("serp", balance_then(6.0, 45.0), p, second)
    assert second["start_spend"] == 6.0 and d.month_spend(39.0, DAY, p) == 12.0


def test_two_processes_cannot_spend_at_once(tmp_path):
    lock = tmp_path / "spend.lock"
    holder = subprocess.Popen([sys.executable, "-c", f"import fcntl,time; f=open({str(lock)!r},'w'); "
                               "fcntl.flock(f, fcntl.LOCK_EX); print('held', flush=True); time.sleep(2)"],
                              stdout=subprocess.PIPE, text=True)
    assert holder.stdout.readline().strip() == "held"
    t0 = time.monotonic()
    d._lock(lock)
    assert time.monotonic() - t0 > 1  # waited for the other process to finish
    holder.wait()


def test_missing_credentials_are_unavailable_not_a_crash(monkeypatch):
    def fail(*a, **k):
        raise FileNotFoundError("az")
    monkeypatch.undo()  # the suite's guard on read_secret is lifted for this one test of it
    monkeypatch.setattr(d.subprocess, "run", fail)
    settings = config.DataForSEO("some-vault", "l", "p", 15.0, Path("/nonexistent"))
    with pytest.raises(d.NoCredentials, match="some-vault"):
        d.basic_auth(settings, [])


def test_task_errors_are_raised():
    with pytest.raises(RuntimeError):
        d.results({"tasks": [{"status_code": 40501, "status_message": "Invalid field"}]})
    assert d.results({"tasks": [{"status_code": 20000, "result": [{"a": 1}]}]}) == [{"a": 1}]


def test_a_not_yet_verified_answer_is_retried_then_raised(tmp_path):
    answers = iter([{"status_code": 40104, "status_message": "verify"}, {"status_code": 20000, "tasks": []}])
    def http(path, body=None):
        if path == "appendix/user_data":
            return {"tasks": [{"result": [{"money": {"balance": 50.0}}]}]}
        return next(answers)
    assert call("x", http, tmp_path / "s.json", {}, sleep=lambda s: None)["status_code"] == 20000
    never = lambda path, body=None: ({"tasks": [{"result": [{"money": {"balance": 50.0}}]}]} if path == "appendix/user_data"
                                     else {"status_code": 40104, "status_message": "verify"})
    with pytest.raises(RuntimeError):
        call("x", never, tmp_path / "s.json", {}, sleep=lambda s: None)


def test_a_month_already_at_the_cap_spends_nothing_even_on_free_calls(tmp_path):
    p = tmp_path / "spend.json"
    p.write_text(json.dumps({"2026-10": {"start": 51.0, "topups": 0.0, "last": 36.0, "spent": 15.0}}))
    with pytest.raises(d.CapReached):  # exactly the cap
        call("serp", balance_then(0.0, 36.0), p, {})


def test_a_not_yet_verified_first_task_is_retried_then_raised(tmp_path):
    first_task = {"status_code": 20000, "tasks": [{"status_code": 40104, "status_message": "verify"}]}
    answers = iter([first_task, {"status_code": 20000, "tasks": [{"status_code": 20000}]}])
    def http(path, body=None):
        return {"tasks": [{"result": [{"money": {"balance": 50.0}}]}]} if path == "appendix/user_data" else next(answers)
    assert call("x", http, tmp_path / "s.json", {}, sleep=lambda s: None)["tasks"][0]["status_code"] == 20000
    stuck = lambda path, body=None: ({"tasks": [{"result": [{"money": {"balance": 50.0}}]}]}
                                     if path == "appendix/user_data" else first_task)
    with pytest.raises(RuntimeError):
        call("x", stuck, tmp_path / "s2.json", {}, sleep=lambda s: None)


def test_a_top_up_is_counted_once(tmp_path):
    p = tmp_path / "spend.json"
    d.month_spend(51.0, DAY, p)
    assert d.month_spend(81.0, DAY, p) == 0  # topped up 30
    assert d.month_spend(81.0, DAY, p) == 0  # read again with nothing spent: still no spend, not -30
    assert json.loads(p.read_text())["2026-10"]["topups"] == 30.0


def test_a_retry_after_a_failed_balance_read_does_not_wait_on_its_own_lock(tmp_path):
    answers = iter([{"status_code": 50000, "tasks": []}])

    def http(path, body=None):
        if path == "appendix/user_data":
            return next(answers, {"status_code": 20000, "tasks": [{"status_code": 20000,
                                                                 "result": [{"money": {"balance": 50.0}}]}]})
        return {"status_code": 20000, "cost": 0.01, "tasks": []}

    run, out = {}, []

    def two_calls():
        with pytest.raises(RuntimeError):
            call("serp", http, tmp_path / "spend.json", run, sleep=lambda s: None)
        out.append(call("serp", http, tmp_path / "spend.json", run, sleep=lambda s: None))

    t = threading.Thread(target=two_calls, daemon=True)
    t.start()
    t.join(10)
    assert not t.is_alive() and out[0]["status_code"] == 20000


def test_the_spend_lock_is_exclusive_and_held_for_the_whole_run(tmp_path):
    import fcntl
    run = {}
    call("serp", balance_then(1.0), tmp_path / "spend.json", run)
    other = (tmp_path / "spend.lock").open("w")
    with pytest.raises(BlockingIOError):  # a second process cannot take it, even shared, while this run lives
        fcntl.flock(other, fcntl.LOCK_SH | fcntl.LOCK_NB)
    run["lock"].close()
    fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)  # released only when the run's lock goes


def test_a_balance_drop_without_a_call_of_ours_is_not_our_spend(tmp_path):
    p = tmp_path / "spend.json"
    assert d.month_spend(50.0, DAY, p) == 0
    assert d.month_spend(45.0, DAY, p) == 0  # another product on the account spent 5
    assert d.month_spend(45.5, DAY, p) == 0  # a 0.50 top-up raises the balance; still nothing of ours
    assert json.loads(p.read_text())["2026-10"]["topups"] == 0.5


def test_the_suite_refuses_to_read_credentials():
    with pytest.raises(pytest.fail.Exception, match="tried to read DataForSEO credentials"):
        d.Client(config.DataForSEO("v", "l", "p", 15.0, Path("/x"))).http("serp", [{}])
