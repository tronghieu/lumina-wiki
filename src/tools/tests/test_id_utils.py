"""Parity tests for id_utils.py — gated by id-cases.json (shared fixture)."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

import pytest

from id_utils import (
    CANONICAL_URL_V,
    EXTERNAL_ID_NAMESPACES,
    canonicalize_url,
    expand_external_ids,
    external_id_match_key,
    normalize_external_id,
    parse_url_to_external_ids,
    safe_id_token,
    sanitize_external_ids_object,
)

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "id-cases.json").read_text(encoding="utf-8")
)


def test_namespaces_locked():
    assert tuple(EXTERNAL_ID_NAMESPACES) == ("doi", "arxiv", "s2", "url", "openalex")


def test_canonical_v_int():
    assert isinstance(CANONICAL_URL_V, int) and CANONICAL_URL_V >= 1


@pytest.mark.parametrize("case", FIXTURE["normalize"])
def test_normalize(case):
    r = normalize_external_id(case["kind"], case["raw"])
    assert r["id"] == case["expected"]["id"], case
    assert r["valid"] == case["expected"]["valid"], case
    for k, v in case["expected"].get("extras", {}).items():
        assert r["extras"].get(k) == v, case


@pytest.mark.parametrize("case", FIXTURE["parseUrl"])
def test_parse_url(case):
    assert parse_url_to_external_ids(case["url"]) == case["expected"], case


@pytest.mark.parametrize("case", FIXTURE["canonicalize"])
def test_canonicalize(case):
    if case["expected"] is None:
        with pytest.raises(Exception):
            canonicalize_url(case["url"])
    else:
        assert canonicalize_url(case["url"]) == case["expected"], case


@pytest.mark.parametrize("case", FIXTURE["matchKey"])
def test_match_key(case):
    assert external_id_match_key(case["ids"]) == case["expected"], case


@pytest.mark.parametrize("case", FIXTURE["expand"])
def test_expand(case):
    assert expand_external_ids(case["ids"]) == case["expected"], case


@pytest.mark.parametrize("case", FIXTURE["safeIdToken"])
def test_safe_id_token(case):
    if case["valid"]:
        assert safe_id_token(case["kind"], case["val"]) == case["val"]
    else:
        with pytest.raises(Exception):
            safe_id_token(case["kind"], case["val"])


@pytest.mark.parametrize("case", FIXTURE["sanitize"])
def test_sanitize(case):
    out = sanitize_external_ids_object(case["input"])
    assert sorted(out.keys()) == sorted(case["expectedKeys"]), case


def test_build_source_entry_minimal():
    from id_utils import build_source_entry
    e = build_source_entry("arxiv")
    assert e["provider"] == "arxiv"
    assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", e["fetched_at"])
    assert "url" not in e


def test_build_source_entry_with_url():
    from id_utils import build_source_entry
    e = build_source_entry("s2", url="https://api.semanticscholar.org/x")
    assert e["url"] == "https://api.semanticscholar.org/x"


def test_build_source_entry_override_fetched_at():
    from id_utils import build_source_entry
    e = build_source_entry("pdf", fetched_at="2026-01-01T00:00:00Z")
    assert e["fetched_at"] == "2026-01-01T00:00:00Z"


@pytest.mark.parametrize("bad", ["", "BadCase", "has space", "1leading", "../traverse", "a" * 33])
def test_build_source_entry_rejects_invalid_provider(bad):
    from id_utils import build_source_entry
    with pytest.raises(ValueError):
        build_source_entry(bad)


def test_build_source_entry_drops_oversize_url():
    from id_utils import build_source_entry
    huge = "https://x.test/" + "a" * 3000
    e = build_source_entry("pdf", url=huge)
    assert "url" not in e


def test_build_source_entry_with_ns_value():
    from id_utils import build_source_entry
    e = build_source_entry("openalex", ns="openalex", value="W4392834756")
    assert e["ns"] == "openalex"
    assert e["value"] == "W4392834756"
    assert e["provider"] == "openalex"


def test_build_source_entry_ns_value_url_combined():
    from id_utils import build_source_entry
    e = build_source_entry(
        "openalex",
        ns="doi",
        value="10.48550/arxiv.2401.12345",
        url="https://api.openalex.org/works/W123",
    )
    assert e["ns"] == "doi"
    assert e["value"] == "10.48550/arxiv.2401.12345"
    assert e["url"] == "https://api.openalex.org/works/W123"


def test_build_source_entry_drops_invalid_ns():
    from id_utils import build_source_entry
    e = build_source_entry("openalex", ns="isbn", value="9780000000000")
    assert "ns" not in e and "value" not in e


def test_build_source_entry_drops_when_one_missing():
    from id_utils import build_source_entry
    e1 = build_source_entry("openalex", ns="doi")
    assert "ns" not in e1 and "value" not in e1
    e2 = build_source_entry("openalex", value="W123")
    assert "ns" not in e2 and "value" not in e2


def test_build_source_entry_drops_oversize_value():
    from id_utils import build_source_entry
    huge = "x" * 3000
    e = build_source_entry("openalex", ns="doi", value=huge)
    assert "ns" not in e and "value" not in e


def test_build_source_entry_backcompat_no_ns_value():
    from id_utils import build_source_entry
    e = build_source_entry("arxiv")
    assert set(e.keys()) == {"provider", "fetched_at"}


@pytest.mark.parametrize("case", FIXTURE["redos"])
def test_redos(case):
    raw = case["raw_template"] + case["pad_char"] * case["pad_count"] + case["tail"]
    start = time.perf_counter()
    normalize_external_id(case["kind"], raw)
    elapsed_ms = (time.perf_counter() - start) * 1000
    assert elapsed_ms < case["must_complete_under_ms"], (
        f"{case['kind']} took {elapsed_ms:.2f}ms (budget {case['must_complete_under_ms']}ms)"
    )
