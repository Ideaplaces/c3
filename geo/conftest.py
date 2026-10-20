"""No engine test may reach DataForSEO: reading the account's secrets is the door to every call, so it
fails the test for the whole suite. pytest.fail raises a BaseException, so no "except Exception" in
the code under test can swallow it."""
import pytest

import dataforseo


@pytest.fixture(autouse=True)
def no_dataforseo(monkeypatch):
    def refuse(vault, name):
        pytest.fail(f"a test tried to read DataForSEO credentials ({name}): inject http instead", pytrace=True)
    monkeypatch.setattr(dataforseo, "read_secret", refuse)
