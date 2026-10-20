"""Tests for the product configuration loader. Run: python3 -m pytest geo -q (from the c3 repo)."""
import copy
import json
import re
from pathlib import Path

import pytest

import config

BASE = {"product": "acme", "site": "acme.com", "aliases": ["Acme"], "competitors": ["Rival"],
        "timezone": "America/Toronto", "runs_dir": "~/runs/acme",
        "dataforseo": {"vault": "vault-acme", "login_secret": "dfs-login", "password_secret": "dfs-password",
                       "monthly_cap_usd": 15, "spend_file": "~/state/acme/dataforseo-spend.json",
                       "markets": [{"market": "us", "location_code": 2840, "language_code": "en"}]}}


def raw(**changes):
    r = copy.deepcopy(BASE)
    r.update(changes)
    return r


def test_a_full_config_loads_with_its_billing_and_paths(tmp_path):
    p = tmp_path / "acme.json"
    p.write_text(json.dumps(raw(search_console={"property": "sc-domain:acme.com", "credential": "~/sa.json"},
                                repo={"name": "Acme/site", "promotion_rule": "develop green"},
                                relevance_vocabulary=["widget"], report_channel="discord:acme")))
    c = config.load(p)
    d = c.dataforseo
    assert (d.vault, d.login_secret, d.password_secret, d.monthly_cap_usd) == ("vault-acme", "dfs-login",
                                                                                "dfs-password", 15.0)
    assert d.spend_file == Path.home() / "state/acme/dataforseo-spend.json"
    assert d.lock_file == Path.home() / "state/acme/dataforseo-spend.lock"
    assert d.markets == (config.Market("us", 2840, "en"),)
    assert c.aliases == ("acme",) and c.competitors == ("rival",) and c.runs_dir == Path.home() / "runs/acme"
    assert c.search_console.credential == str(Path.home() / "sa.json") and c.repo.name == "Acme/site"
    assert c.require("relevance_vocabulary") == ("widget",)
    with pytest.raises(config.ConfigError, match="acme.*wait_channel"):
        c.require("wait_channel")


@pytest.mark.parametrize("breaks, why", [
    (lambda r: r.pop("dataforseo"), "no dataforseo"),
    (lambda r: r["dataforseo"].pop("monthly_cap_usd"), "monthly_cap_usd"),
    (lambda r: r["dataforseo"].update(monthly_cap_usd=0), "monthly_cap_usd"),
    (lambda r: r["dataforseo"].update(monthly_cap_usd=-5), "monthly_cap_usd"),
    (lambda r: r["dataforseo"].update(monthly_cap_usd="15"), "monthly_cap_usd"),
    (lambda r: r["dataforseo"].update(monthly_cap_usd=True), "monthly_cap_usd"),
    (lambda r: r["dataforseo"].pop("vault"), "vault"),
    (lambda r: r["dataforseo"].update(vault=" "), "vault"),
    (lambda r: r["dataforseo"].pop("spend_file"), "spend_file"),
])
def test_config_refuses_missing_billing(breaks, why):
    r = raw()
    breaks(r)
    with pytest.raises(config.ConfigError, match=why):
        config.parse(r)


def test_config_refuses_an_unknown_timezone_and_a_market_without_its_codes():
    with pytest.raises(config.ConfigError, match="timezone"):
        config.parse(raw(timezone="Mars/Olympus"))
    r = raw()
    r["dataforseo"]["markets"] = [{"market": "us", "location_code": "2840", "language_code": "en"}]
    with pytest.raises(config.ConfigError, match="location_code"):
        config.parse(r)


def test_two_products_never_share_a_spend_file():
    a = config.parse(raw())
    b = config.parse(raw(product="other"))
    with pytest.raises(config.ConfigError, match="share the spend file"):
        config.refuse_shared_spend([a, b])
    r = raw(product="other")
    r["dataforseo"]["spend_file"] = "~/state/other/dataforseo-spend.json"
    config.refuse_shared_spend([a, config.parse(r)])  # the same account and vault, a spend file each


def test_no_vault_literal_in_engine():
    """The engine names no product's Key Vault: each comes from that product's configuration."""
    here = Path(__file__).resolve().parent
    found = [f"{p.name}:{n}: {line.strip()}" for p in sorted(here.glob("*.py"))
             if not p.name.startswith(("test_", "conftest"))
             for n, line in enumerate(p.read_text().splitlines(), 1) if re.search(r"\bkv-[A-Za-z0-9]", line)]
    assert found == []
