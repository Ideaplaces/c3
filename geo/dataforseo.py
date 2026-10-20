"""DataForSEO for every product on the engine, with each product's spend capped on its own.

Products may share one DataForSEO account and so one balance, but never a spend file, a lock or a cap:
those come from the product's configuration (config.DataForSEO). A product's spend this month is the
sum of the costs DataForSEO reported for that product's own calls, kept in its spend file. It is never
read off a fall in the balance, because the balance also falls when another product on the account
spends. The balance is still read once per run (the cheap check that the account answers and is
verified) and kept in the spend file with the month's start and its top-ups, as a record of the
account as this product saw it.

Every call goes through call(), which refuses a call once the month's spend plus the cost of the
dearest call so far would pass the product's cap. A lock file lets one process of a product spend at a
time. A month recorded before spend was counted per call holds no "spent"; its spend is then the
balance formula of that time (start plus top-ups minus the last balance left), which was right while
only one product used the account.

The engine never buys ads or placements. Spec: https://docs.ideaplaces.com/devops/seo-geo-engine#spend
"""
from __future__ import annotations

import base64
import datetime as dt
import fcntl
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

API = "https://api.dataforseo.com/v3/"
NOT_YET_VERIFIED_WAITS = (15, 30, 60)
TOPUP_TOLERANCE = 0.01  # DataForSEO reports costs to the cent and below; a rise smaller than this is rounding


class Unavailable(RuntimeError):
    """DataForSEO cannot be used this run: the reading is skipped and the report says why."""


class CapReached(Unavailable):
    pass


class NoCredentials(Unavailable):
    pass


def read_secret(vault: str, name: str) -> str:
    try:
        return subprocess.run(["az", "keyvault", "secret", "show", "--vault-name", vault, "--name", name,
                               "--query", "value", "-o", "tsv"], capture_output=True, text=True,
                              check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise NoCredentials(f"DataForSEO credentials unreadable from {vault} ({name})") from exc


def basic_auth(settings, cache: list[str]) -> str:
    """The Basic header value for the product's account, read from its vault once per process."""
    if not cache:
        login = read_secret(settings.vault, settings.login_secret)
        password = read_secret(settings.vault, settings.password_secret)
        cache.append(base64.b64encode(f"{login}:{password}".encode()).decode())
    return cache[0]


def http(path: str, body=None, *, auth: Callable[[], str], opener=None) -> dict:
    opener = opener or urllib.request.urlopen
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Basic " + auth(), "Content-Type": "application/json"},
                                 method="POST" if body is not None else "GET")
    try:
        with opener(req, timeout=180) as r:
            return json.load(r)
    except urllib.error.HTTPError as exc:  # DataForSEO explains itself in the body (e.g. 40104, verify the account)
        try:
            return json.load(exc)
        except Exception:  # noqa: BLE001
            raise exc from None


def not_verified(d: dict) -> bool:
    """40104 at the top, or in the first task (the balance endpoint puts it there)."""
    tasks = d.get("tasks") or [{}]
    return d.get("status_code") == 40104 or (tasks[0] or {}).get("status_code") == 40104


def patient(http, path: str, body=None, sleep=time.sleep) -> dict:
    """One call, retried while DataForSEO answers 40104 (its verification spreads unevenly at first)."""
    d = http(path, body) if body is not None else http(path)
    for wait in NOT_YET_VERIFIED_WAITS:
        if not not_verified(d):
            break
        sleep(wait)
        d = http(path, body) if body is not None else http(path)
    return d


def balance(http, sleep=time.sleep) -> float:
    d = patient(http, "appendix/user_data", sleep=sleep)
    try:
        return float(d["tasks"][0]["result"][0]["money"]["balance"])
    except (KeyError, IndexError, TypeError):
        task = (d.get("tasks") or [{}])[0] or {}
        raise RuntimeError(f"DataForSEO balance unreadable: {d.get('status_code')} {task.get('status_code')} "
                           f"{task.get('status_message') or d.get('status_message')}") from None


def _read(path: Path) -> dict:
    return json.loads(path.read_text()) if path.exists() else {}


def _write(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=1))


def _month(state: dict, month: str, balance_now: float) -> dict:
    ref = state.get(month)
    if ref is None:
        ref = {"start": balance_now, "topups": 0.0, "last": balance_now, "spent": 0.0}
    elif "spent" not in ref:  # recorded under the balance formula, when one product had the account
        ref["spent"] = ref["start"] + ref["topups"] - ref["last"]
    state[month] = ref
    return ref


def month_spend(now_balance: float, today: dt.date, path: Path) -> float:
    """This product's spend this month: its own calls' reported costs. The balance only updates the
    record of the account: a rise over the balance this product last saw is a top-up."""
    state = _read(path)
    ref = _month(state, today.strftime("%Y-%m"), now_balance)
    if now_balance > ref["last"] + TOPUP_TOLERANCE:
        ref["topups"] += now_balance - ref["last"]
    ref["last"] = now_balance
    _write(path, state)
    return round(ref["spent"], 4)


def settle(balance_left: float, today: dt.date, path: Path, cost: float = 0.0) -> None:
    """Record one call: its reported cost joins the month's spend, and the balance it left is kept."""
    state = _read(path)
    ref = _month(state, today.strftime("%Y-%m"), balance_left + cost)  # a month that turned during the run
    ref["spent"] += cost
    ref["last"] = balance_left
    _write(path, state)


def _lock(path: Path):
    """Held until the process ends: a second process of the same product waits here."""
    path.parent.mkdir(parents=True, exist_ok=True)
    f = path.open("w")
    fcntl.flock(f, fcntl.LOCK_EX)
    return f


def call(path: str, body, *, http, cap: float, spend_path: Path, run: dict, today: dt.date | None = None,
         sleep=time.sleep) -> dict:
    """The balance endpoint allows 6 calls a minute, so it is read once per run; each call's own
    reported cost is added on top, and the call is refused when the dearest call so far would cross
    the cap."""
    today = today or dt.date.today()
    if "start_spend" not in run:
        if "lock" not in run:  # held once per run: a retry after a failed balance read must not wait on itself
            run["lock"] = _lock(spend_path.with_suffix(".lock"))
        run["start_balance"] = balance(http, sleep)
        run["start_spend"], run["costs"], run["dearest"] = month_spend(run["start_balance"], today, spend_path), 0.0, 0.0
    spent = run["start_spend"] + run["costs"]
    if spent >= cap or spent + run["dearest"] > cap:
        raise CapReached(f"DataForSEO spend this month is {spent:.2f} USD; the next call could pass the {cap:.2f} cap")
    d = patient(http, path, body, sleep)
    cost = float(d.get("cost") or 0)
    run["costs"] += cost
    run["dearest"] = max(run["dearest"], cost)
    settle(run["start_balance"] - run["costs"], today, spend_path, cost)
    if d.get("status_code") != 20000 or not_verified(d):
        raise RuntimeError(f"DataForSEO {path}: {d.get('status_code')} {d.get('status_message')}")
    return d


def results(d: dict) -> list[dict]:
    """The result items of every task, errors per task raised."""
    out = []
    for t in d.get("tasks", []):
        if t.get("status_code") != 20000:
            raise RuntimeError(f"DataForSEO task: {t.get('status_code')} {t.get('status_message')}")
        for r in t.get("result") or []:
            out.append(r)
    return out


class Client:
    """One product's DataForSEO: its account secrets, cap, spend file and lock, and its own run state."""

    def __init__(self, settings):
        self.settings = settings
        self.run: dict = {}
        self._auth: list[str] = []

    @classmethod
    def from_config(cls, cfg) -> "Client":
        return cls(cfg.dataforseo)

    def auth(self) -> str:
        return basic_auth(self.settings, self._auth)

    def http(self, path: str, body=None, opener=None) -> dict:
        return http(path, body, auth=self.auth, opener=opener)

    def call(self, path: str, body, http=None, today: dt.date | None = None, sleep=time.sleep) -> dict:
        return call(path, body, http=http or self.http, cap=self.settings.monthly_cap_usd,
                    spend_path=self.settings.spend_file, run=self.run, today=today, sleep=sleep)

    def month_spend(self, now_balance: float, today: dt.date) -> float:
        return month_spend(now_balance, today, self.settings.spend_file)
