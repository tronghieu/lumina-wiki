"""Parity tests for id_utils.py — gated by id-cases.json (shared fixture)."""

from __future__ import annotations

import json
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
    assert tuple(EXTERNAL_ID_NAMESPACES) == ("doi", "arxiv", "s2", "url")


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


@pytest.mark.parametrize("case", FIXTURE["redos"])
def test_redos(case):
    raw = case["raw_template"] + case["pad_char"] * case["pad_count"] + case["tail"]
    start = time.perf_counter()
    normalize_external_id(case["kind"], raw)
    elapsed_ms = (time.perf_counter() - start) * 1000
    assert elapsed_ms < case["must_complete_under_ms"], (
        f"{case['kind']} took {elapsed_ms:.2f}ms (budget {case['must_complete_under_ms']}ms)"
    )
