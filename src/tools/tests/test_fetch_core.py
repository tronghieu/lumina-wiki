"""Tests for fetch_core.py — CORE search + download-url."""

from __future__ import annotations

import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import fetch_core


@pytest.fixture
def no_cache(monkeypatch):
    monkeypatch.setenv("LUMINA_NO_CACHE", "1")
    yield


@pytest.fixture
def fake_env(monkeypatch):
    monkeypatch.setattr(fetch_core, "load_env", lambda: {"CORE_API_KEY": "deadbeef"})
    yield


def _resp(data, status=200):
    r = MagicMock()
    r.status_code = status
    r.json = MagicMock(return_value=data or {})
    r.headers = {}
    r.raise_for_status = MagicMock()
    return r


class TestNormalizeWork:
    def test_extracts_core_id_doi_and_download_url(self):
        raw = {
            "id": 42,
            "doi": "10.1234/sample",
            "title": "Example",
            "abstract": "abstract text",
            "yearPublished": 2024,
            "authors": [{"name": "A"}, {"name": "B"}],
            "downloadUrl": "https://core.ac.uk/download/42.pdf",
        }
        norm = fetch_core._normalize_work(raw)
        assert norm["core_id"] == "42"
        assert norm["external_ids"]["doi"] == "10.1234/sample"
        assert norm["download_url"].startswith("https://")
        assert any(p.get("ns") == "doi" for p in norm["sources"])
        assert any(
            p.get("url") == "https://core.ac.uk/download/42.pdf"
            for p in norm["sources"]
        )


class TestCmdSearch:
    def test_search_returns_normalized_records(self, no_cache, fake_env):
        payload = {
            "results": [
                {"id": 1, "title": "Paper A", "doi": "10.1/a", "downloadUrl": "https://example.com/a.pdf"},
                {"id": 2, "title": "Paper B"},
            ]
        }
        with patch("fetch_core.requests.Session") as cls:
            sess = MagicMock()
            cls.return_value = sess
            sess.get.return_value = _resp(payload)
            sess.mount = MagicMock()
            sess.headers = {}
            results = fetch_core.cmd_search("RAG", 5, "deadbeef")
        assert len(results) == 2
        assert results[0]["core_id"] == "1"

    def test_search_429_raises_rate_limit_sentinel(self, no_cache, fake_env):
        with patch("fetch_core.requests.Session") as cls:
            sess = MagicMock()
            cls.return_value = sess
            sess.get.return_value = _resp({}, status=429)
            sess.mount = MagicMock()
            sess.headers = {}
            with pytest.raises(RuntimeError, match="CORE_RATE_LIMITED"):
                fetch_core.cmd_search("x", 5, "deadbeef")

    def test_search_401_raises_value_error(self, no_cache, fake_env):
        with patch("fetch_core.requests.Session") as cls:
            sess = MagicMock()
            cls.return_value = sess
            sess.get.return_value = _resp({}, status=401)
            sess.mount = MagicMock()
            sess.headers = {}
            with pytest.raises(ValueError, match="(?i)credentials"):
                fetch_core.cmd_search("x", 5, "deadbeef")


class TestCmdDownloadUrl:
    def test_returns_pdf_url_for_known_work(self, no_cache, fake_env):
        with patch("fetch_core.requests.Session") as cls:
            sess = MagicMock()
            cls.return_value = sess
            sess.get.return_value = _resp({"downloadUrl": "https://example.com/x.pdf"})
            sess.mount = MagicMock()
            sess.headers = {}
            r = fetch_core.cmd_download_url("99", "deadbeef")
        assert r["pdf_url"] == "https://example.com/x.pdf"
        assert r["mime_type"] == "application/pdf"

    def test_rejects_non_numeric_core_id(self, no_cache, fake_env):
        with pytest.raises(ValueError, match="numeric"):
            fetch_core.cmd_download_url("abc", "deadbeef")


class TestCli:
    def test_cli_429_exits_with_rate_limit_sentinel(self, no_cache, fake_env, capsys):
        with patch("fetch_core.requests.Session") as cls:
            sess = MagicMock()
            cls.return_value = sess
            sess.get.return_value = _resp({}, status=429)
            sess.mount = MagicMock()
            sess.headers = {}
            buf = io.StringIO()
            with redirect_stdout(buf), pytest.raises(SystemExit) as exc:
                fetch_core.main(["search", "x", "--limit", "5"])
        assert exc.value.code == fetch_core.EXIT_RATE_LIMITED
        parsed = json.loads(buf.getvalue())
        assert parsed.get("_rate_limited") is True

    def test_cli_without_key_exits_2(self, capsys, monkeypatch):
        monkeypatch.setattr(fetch_core, "load_env", lambda: {})
        with pytest.raises(SystemExit) as exc:
            fetch_core.main(["search", "x"])
        assert exc.value.code == 2
        err = capsys.readouterr().err
        assert "CORE_API_KEY" in err
