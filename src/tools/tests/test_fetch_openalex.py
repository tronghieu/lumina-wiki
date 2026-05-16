"""Tests for fetch_openalex.py — OpenAlex API wrapper.

Covers:
- normalize_record extracts external_ids + sources[] provenance + arxiv-DOI cross-walk
- _path_for_id accepts DOI, OpenAlex W-id, and URL forms; rejects garbage
- missing OPENALEX_API_KEY emits one-shot warning, no api_key in outbound params
- api-key-set call includes api_key in outbound params
- 404 → exit 2; 5xx after retries → exit 3
- 429 with Retry-After respects header and retries once
- cache key is api-key-independent
- search command builds /works query with filter expr
"""

from __future__ import annotations

import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import fetch_openalex


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

MOCK_WORK = {
    "id": "https://openalex.org/W4392834756",
    "doi": "https://doi.org/10.48550/arxiv.2401.12345",
    "title": "Sample Paper",
    "display_name": "Sample Paper",
    "publication_year": 2024,
    "authorships": [
        {"author": {"display_name": "Jane Doe", "orcid": "https://orcid.org/0000-0000-0000-0000"}},
        {"author": {"display_name": "John Roe"}},
    ],
    "abstract_inverted_index": {"Hello": [0], "world": [1]},
    "open_access": {"is_oa": True},
    "best_oa_location": {"pdf_url": "https://arxiv.org/pdf/2401.12345.pdf"},
    "ids": {
        "openalex": "https://openalex.org/W4392834756",
        "doi": "https://doi.org/10.48550/arXiv.2401.12345",
    },
}


def _resp(data, status=200, headers=None):
    r = MagicMock()
    r.status_code = status
    r.json = MagicMock(return_value=data or {})
    r.headers = headers or {}
    r.raise_for_status = MagicMock()
    return r


@pytest.fixture(autouse=True)
def _reset_warning(monkeypatch):
    """Each test starts with the unauthenticated warning un-emitted."""
    monkeypatch.setattr(fetch_openalex, "_API_KEY_WARN_EMITTED", False)
    yield


@pytest.fixture
def no_cache(monkeypatch):
    """Force CachedSession into bypass mode so .get goes straight to the inner mock."""
    monkeypatch.setenv("LUMINA_NO_CACHE", "1")
    yield


# ---------------------------------------------------------------------------
# normalize_record — Phase 1 schema compliance
# ---------------------------------------------------------------------------

def test_normalize_extracts_openalex_doi_arxiv_crosswalk():
    rec = fetch_openalex.normalize_record(MOCK_WORK)
    assert rec["external_ids"]["openalex"] == "W4392834756"
    assert rec["external_ids"]["doi"] == "10.48550/arxiv.2401.12345"
    # arxiv-DOI cross-walk via expand_external_ids
    assert rec["external_ids"]["arxiv"] == "2401.12345"


def test_normalize_emits_sources_via_buildSourceEntry():
    rec = fetch_openalex.normalize_record(MOCK_WORK)
    sources = rec["sources"]
    # one per id + one for oa_url
    by_ns = {s.get("ns"): s for s in sources if "ns" in s}
    assert "openalex" in by_ns and by_ns["openalex"]["value"] == "W4392834756"
    assert "doi" in by_ns and by_ns["doi"]["value"] == "10.48550/arxiv.2401.12345"
    # All carry the provider tag
    assert all(s["provider"] == "openalex" for s in sources)
    # oa_url entry recorded
    url_entries = [s for s in sources if s.get("url")]
    assert any(s["url"] == "https://arxiv.org/pdf/2401.12345.pdf" for s in url_entries)


def test_normalize_handles_missing_fields_gracefully():
    rec = fetch_openalex.normalize_record({"id": "https://openalex.org/W123"})
    assert rec["external_ids"]["openalex"] == "W123"
    assert rec["authors"] == []
    assert rec["abstract"] == ""
    assert rec["is_oa"] is False
    assert "oa_url" not in rec


def test_normalize_rebuilds_abstract_from_inverted_index():
    raw = {
        "id": "https://openalex.org/W1",
        "abstract_inverted_index": {"Foo": [0, 2], "Bar": [1]},
    }
    rec = fetch_openalex.normalize_record(raw)
    assert rec["abstract"] == "Foo Bar Foo"


def test_normalize_rejects_http_oa_url():
    """Defense-in-depth: best_oa_location.pdf_url must be https://."""
    raw = dict(MOCK_WORK)
    raw["best_oa_location"] = {"pdf_url": "http://example.com/paper.pdf"}
    rec = fetch_openalex.normalize_record(raw)
    assert "oa_url" not in rec


def test_normalize_drops_invalid_external_id_with_warning(capsys):
    raw = {"id": "https://openalex.org/A123"}  # Author ID — not Work
    rec = fetch_openalex.normalize_record(raw)
    assert "openalex" not in rec["external_ids"]
    err = capsys.readouterr().err
    assert "dropped invalid external_id" in err


# ---------------------------------------------------------------------------
# _path_for_id — identifier dispatch
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("W4392834756", "/works/W4392834756"),
    ("https://openalex.org/W4392834756", "/works/W4392834756"),
    ("openalex:W123", "/works/W123"),
    ("10.48550/arXiv.2401.12345", "/works/doi:10.48550/arxiv.2401.12345"),
    ("https://doi.org/10.1109/abc.2020", "/works/doi:10.1109/abc.2020"),
])
def test_path_for_id_accepts_canonical_forms(raw, expected):
    assert fetch_openalex._path_for_id(raw) == expected


@pytest.mark.parametrize("bad", ["", "A1234567", "not-an-id", "../../etc/passwd"])
def test_path_for_id_rejects_garbage(bad):
    with pytest.raises(ValueError):
        fetch_openalex._path_for_id(bad)


# ---------------------------------------------------------------------------
# API key: warning + outbound api_key param
# ---------------------------------------------------------------------------

def test_missing_api_key_emits_single_warning_per_process(capsys):
    fetch_openalex._warn_unauthenticated_once()
    fetch_openalex._warn_unauthenticated_once()  # second call should be silent
    err = capsys.readouterr().err
    assert err.count("OPENALEX_API_KEY is not set") == 1


def test_params_with_api_key_absent_leaves_params_unchanged():
    out = fetch_openalex._params_with_api_key({"search": "q"}, "")
    assert out == {"search": "q"}
    assert "api_key" not in out


def test_params_with_api_key_set_appends_param():
    out = fetch_openalex._params_with_api_key({"search": "q"}, "test-key")
    assert out["api_key"] == "test-key"
    assert out["search"] == "q"


# ---------------------------------------------------------------------------
# HTTP behaviour via _request_json — 404 / 429 / 5xx
# ---------------------------------------------------------------------------

def test_request_json_404_raises_value_error():
    session = MagicMock()
    session.get.return_value = _resp({}, status=404)
    with pytest.raises(ValueError):
        fetch_openalex._request_json(session, "https://api.openalex.org/works/Wx", {})


def test_request_json_401_raises_value_error():
    session = MagicMock()
    session.get.return_value = _resp({}, status=401)
    with pytest.raises(ValueError, match="OPENALEX_API_KEY"):
        fetch_openalex._request_json(session, "https://api.openalex.org/works/Wx", {})


def test_request_json_5xx_raises_runtime_error():
    session = MagicMock()
    session.get.return_value = _resp({}, status=503)
    with pytest.raises(RuntimeError):
        fetch_openalex._request_json(session, "https://api.openalex.org/works/Wx", {})


def test_request_json_429_with_retry_after_retries_once():
    session = MagicMock()
    # First 429 with Retry-After, then 200
    session.get.side_effect = [
        _resp({}, status=429, headers={"Retry-After": "0"}),
        _resp({"ok": True}, status=200),
    ]
    with patch.object(fetch_openalex.time, "sleep") as fake_sleep:
        result = fetch_openalex._request_json(session, "https://api.openalex.org/works/Wx", {})
    assert result == {"ok": True}
    assert session.get.call_count == 2
    fake_sleep.assert_called_once()


def test_request_json_429_without_retry_after_fails():
    session = MagicMock()
    session.get.side_effect = [
        _resp({}, status=429, headers={}),
    ]
    with pytest.raises(RuntimeError):
        fetch_openalex._request_json(session, "https://api.openalex.org/works/Wx", {})


# ---------------------------------------------------------------------------
# Cache key is api-key-independent
# ---------------------------------------------------------------------------

def test_canonical_url_strips_api_key_param():
    from _cache import _canonical_url
    a = _canonical_url("https://api.openalex.org/works/W1", {"api_key": "key-a"}, strip_params=["api_key"])
    b = _canonical_url("https://api.openalex.org/works/W1", {"api_key": "key-b"}, strip_params=["api_key"])
    c = _canonical_url("https://api.openalex.org/works/W1", {}, strip_params=["api_key"])
    assert a == b == c


def test_canonical_url_keeps_other_params_when_stripping_api_key():
    from _cache import _canonical_url
    out = _canonical_url(
        "https://api.openalex.org/works",
        {"search": "rag", "api_key": "test-key"},
        strip_params=["api_key"],
    )
    assert "search=rag" in out
    assert "api_key" not in out


# ---------------------------------------------------------------------------
# Integration: cmd_work + cmd_search via patched _request_json
# ---------------------------------------------------------------------------

def test_cmd_work_invokes_request_with_correct_path(no_cache):
    with patch.object(fetch_openalex, "_request_json", return_value=MOCK_WORK) as m:
        rec = fetch_openalex.cmd_work("W4392834756", api_key="")
    args, kwargs = m.call_args
    assert args[1].endswith("/works/W4392834756")
    assert rec["external_ids"]["openalex"] == "W4392834756"


def test_cmd_work_passes_api_key_when_set(no_cache):
    with patch.object(fetch_openalex, "_request_json", return_value=MOCK_WORK) as m:
        fetch_openalex.cmd_work("W123", api_key="test-key")
    _args, _kwargs = m.call_args
    params = _args[2]
    assert params.get("api_key") == "test-key"


def test_cmd_search_builds_works_query(no_cache):
    payload = {"results": [MOCK_WORK]}
    with patch.object(fetch_openalex, "_request_json", return_value=payload) as m:
        results = fetch_openalex.cmd_search("rag", limit=5, filters=[("from_publication_date", "2024-01-01")], api_key="")
    args, _kwargs = m.call_args
    assert args[1].endswith("/works")
    params = args[2]
    assert params["search"] == "rag"
    assert params["per_page"] == 5
    assert params["filter"] == "from_publication_date:2024-01-01"
    assert len(results) == 1
    assert results[0]["external_ids"]["openalex"] == "W4392834756"


def test_cmd_search_clamps_limit_to_openalex_max(no_cache):
    payload = {"results": [MOCK_WORK]}
    with patch.object(fetch_openalex, "_request_json", return_value=payload) as m:
        fetch_openalex.cmd_search("rag", limit=200, filters=[], api_key="")
    args, _kwargs = m.call_args
    assert args[2]["per_page"] == 100


# ---------------------------------------------------------------------------
# CLI exit codes
# ---------------------------------------------------------------------------

def test_cli_empty_id_exits_2():
    with pytest.raises(SystemExit) as excinfo:
        fetch_openalex.main(["work", "   "])
    assert excinfo.value.code == 2


def test_cli_404_exits_2(no_cache):
    with patch.object(fetch_openalex, "_request_json", side_effect=ValueError("404")):
        with pytest.raises(SystemExit) as excinfo:
            fetch_openalex.main(["work", "W1"])
    assert excinfo.value.code == 2


def test_cli_5xx_exits_3(no_cache):
    with patch.object(fetch_openalex, "_request_json", side_effect=RuntimeError("HTTP 503")):
        with pytest.raises(SystemExit) as excinfo:
            fetch_openalex.main(["work", "W1"])
    assert excinfo.value.code == 3


def test_cli_work_happy_path_writes_json(no_cache, capsys):
    with patch.object(fetch_openalex, "_request_json", return_value=MOCK_WORK):
        with pytest.raises(SystemExit) as excinfo:
            fetch_openalex.main(["work", "W4392834756"])
    assert excinfo.value.code == 0
    out = capsys.readouterr().out
    data = json.loads(out)
    assert data["external_ids"]["openalex"] == "W4392834756"


# ---------------------------------------------------------------------------
# argparse filter validation
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("bad", ["nokey", "=", "k=", "=v", "BAD-KEY=v", "with spaces=v"])
def test_filter_validator_rejects_bad_input(bad):
    import argparse
    with pytest.raises(argparse.ArgumentTypeError):
        fetch_openalex._validate_filter(bad)


def test_filter_validator_accepts_good_input():
    assert fetch_openalex._validate_filter("from_publication_date=2024-01-01") == (
        "from_publication_date", "2024-01-01"
    )
