"""One product's configuration for the shared SEO and GEO engine, loaded and checked once.

Every engine module reads a product through the Config this returns, so two products never share a
value by accident. The fields are the ones on the engine page
(https://docs.ideaplaces.com/devops/seo-geo-engine#a-products-configuration). Billing is checked
hardest: a configuration without a DataForSEO vault or a positive monthly cap is refused, because
the engine must never spend on an account it cannot name or without a ceiling.

A field a module has not moved into the engine yet stays optional here; the module that needs it
asks with Config.require(), which says which product lacks it.

    "dataforseo": {"vault": "<key vault>", "login_secret": "...", "password_secret": "...",
                   "monthly_cap_usd": 15, "spend_file": "~/.c3/state/<product>/dataforseo-spend.json",
                   "markets": [{"market": "us", "location_code": 2840, "language_code": "en"}]}
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class ConfigError(ValueError):
    """The configuration cannot be used; the message names the product and the field."""


@dataclass(frozen=True)
class Market:
    market: str
    location_code: int
    language_code: str


@dataclass(frozen=True)
class DataForSEO:
    vault: str
    login_secret: str
    password_secret: str
    monthly_cap_usd: float
    spend_file: Path
    markets: tuple[Market, ...] = ()

    @property
    def lock_file(self) -> Path:
        """One process of this product spends at a time; another product has its own lock."""
        return self.spend_file.with_suffix(".lock")


@dataclass(frozen=True)
class SearchConsole:
    property: str
    credential: str


@dataclass(frozen=True)
class Repo:
    name: str
    promotion_rule: str


@dataclass(frozen=True)
class Config:
    product: str
    site: str
    aliases: tuple[str, ...]
    competitors: tuple[str, ...]
    timezone: str
    dataforseo: DataForSEO
    runs_dir: Path
    storage: dict | None = None
    markets: dict = field(default_factory=dict)  # country -> languages the AI-answer panel asks in
    search_console: SearchConsole | None = None
    ledger_repo: str | None = None
    scoreboard_page: str | None = None
    report_channel: str | None = None
    wait_channel: str | None = None
    repo: Repo | None = None
    relevance_vocabulary: tuple[str, ...] = ()

    def require(self, name: str):
        value = getattr(self, name)
        if value in (None, (), {}, ""):
            raise ConfigError(f"{self.product}: the configuration has no {name}, and the module asking needs it")
        return value


def _text(raw: dict, key: str, where: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{where}: {key} is missing or empty")
    return value


def _path(value: str) -> Path:
    return Path(os.path.expanduser(value))


def _dataforseo(raw: dict, product: str) -> DataForSEO:
    where = f"{product}: dataforseo"
    block = raw.get("dataforseo")
    if not isinstance(block, dict):
        raise ConfigError(f"{product}: no dataforseo block, so no vault and no monthly cap; refused")
    cap = block.get("monthly_cap_usd")
    if isinstance(cap, bool) or not isinstance(cap, (int, float)) or cap <= 0:
        raise ConfigError(f"{where}: monthly_cap_usd must be a positive number of USD, got {cap!r}; refused")
    markets = []
    for m in block.get("markets") or []:
        if not isinstance(m.get("location_code"), int) or not isinstance(m.get("language_code"), str):
            raise ConfigError(f"{where}: market {m!r} needs an integer location_code and a language_code")
        markets.append(Market(_text(m, "market", where), m["location_code"], m["language_code"]))
    return DataForSEO(vault=_text(block, "vault", where), login_secret=_text(block, "login_secret", where),
                      password_secret=_text(block, "password_secret", where), monthly_cap_usd=float(cap),
                      spend_file=_path(_text(block, "spend_file", where)), markets=tuple(markets))


def parse(raw: dict) -> Config:
    product = _text(raw, "product", "configuration")
    tz = _text(raw, "timezone", product)
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise ConfigError(f"{product}: timezone {tz!r} is not a known zone") from None
    aliases = raw.get("aliases")
    if not aliases or not all(isinstance(a, str) and a for a in aliases):
        raise ConfigError(f"{product}: aliases must list the names an answer may use for the product")
    sc = raw.get("search_console")
    repo = raw.get("repo")
    return Config(
        product=product, site=_text(raw, "site", product), aliases=tuple(a.lower() for a in aliases),
        competitors=tuple(c.lower() for c in raw.get("competitors") or []), timezone=tz,
        dataforseo=_dataforseo(raw, product), runs_dir=_path(_text(raw, "runs_dir", product)),
        storage=raw.get("storage"), markets=dict(raw.get("markets") or {}),
        search_console=SearchConsole(_text(sc, "property", f"{product}: search_console"),
                                     os.path.expanduser(_text(sc, "credential", f"{product}: search_console")))
        if sc else None,
        ledger_repo=raw.get("ledger_repo"), scoreboard_page=raw.get("scoreboard_page"),
        report_channel=raw.get("report_channel"), wait_channel=raw.get("wait_channel"),
        repo=Repo(_text(repo, "name", f"{product}: repo"), _text(repo, "promotion_rule", f"{product}: repo"))
        if repo else None,
        relevance_vocabulary=tuple(raw.get("relevance_vocabulary") or ()))


def load(path: str | Path) -> Config:
    return parse(json.loads(Path(path).read_text()))


def refuse_shared_spend(configs: list[Config]) -> None:
    """Two products may share a DataForSEO account, never a spend file or its lock."""
    seen: dict[Path, str] = {}
    for c in configs:
        other = seen.setdefault(c.dataforseo.spend_file.resolve(), c.product)
        if other != c.product:
            raise ConfigError(f"{c.product} and {other} share the spend file {c.dataforseo.spend_file}; each "
                              "product needs its own")
