"""Tests for fetch_unpaywall.py — DOI → best OA PDF URL."""

from __future__ import annotations

import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import fetch_unpaywall


@pytest.fixture
def no_cache(monkeypatch):
    monkeypatch.setenv("LUMINA_NO_CACHE", "1")
    yield


@pytest.fixture
def fake_env(monkeypatch):
    monkeypatch.setattr(
        fetch_unpaywall, "load_env", lambda: {"UNPAYWALL_EMAIL": "test@example.com"}
    )
    yield


def _resp(data, status=200):
    r = MagicMock()
    r.status_code = status
    r.json = MagicMock(return_value=data or {})
    r.headers = {}
    r.raise_for_status = MagicMock()
    return r


class TestCmdDoi:
    def test_open_access_doi_returns_pdf_url(self, no_cache, fake_env):
        oa_record = {
            "doi": "10.1000/oa-paper",
            "is_oa": True,
            "best_oa_location": {
                "url_for_pdf": "https://example.com/paper.pdf",
                "license": "cc-by",
                "host_type": "repository",
            },
        }
        with patch("fetch_unpaywall.requests.Session") as cls:
            sess = MagicMock()
            cls.return_value = sess
            sess.get.return_value = _resp(oa_record)
            sess.mount = MagicMock()
            sess.headers = {}
            result = fetch_unpaywall.cmd_doi("10.1000/oa-paper", "test@example.com")
        assert result["is_oa"] is True
        assert result["best_oa_location"]["pdf_url"] == "https://example.com/paper.pdf"
        assert result["external_ids"]["doi"] == "10.1000/oa-paper"
        # sources[] carries provenance with ns/value + url entries.
        provs = result["sources"]
        assert any(p.get("ns") == "doi" and p.get("value") == "10.1000/oa-paper" for p in provs)
        assert any(p.get("url") == "https://example.com/paper.pdf" for p in provs)

    def test_closed_doi_returns_is_oa_false(self, no_cache, fake_env):
        closed = {"doi": "10.1000/closed", "is_oa": False, "best_oa_location": None}
        with patch("fetch_unpaywall.requests.Session") as cls:
            sess = MagicMock()
            cls.return_value = sess
            sess.get.return_value = _resp(closed)
            sess.mount = MagicMock()
            sess.headers = {}
            result = fetch_unpaywall.cmd_doi("10.1000/closed", "test@example.com")
        assert result["is_oa"] is False
        assert result["best_oa_location"] is None

    def test_invalid_doi_raises_value_error(self, no_cache, fake_env):
        with pytest.raises(ValueError, match="(?i)valid doi"):
            fetch_unpaywall.cmd_doi("not-a-doi", "test@example.com")

    def test_404_raises_value_error(self, no_cache, fake_env):
        with patch("fetch_unpaywall.requests.Session") as cls:
            sess = MagicMock()
            cls.return_value = sess
            sess.get.return_value = _resp({}, status=404)
            sess.mount = MagicMock()
            sess.headers = {}
            with pytest.raises(ValueError, match="404"):
                fetch_unpaywall.cmd_doi("10.1000/missing", "test@example.com")

    def test_5xx_raises_runtime_error(self, no_cache, fake_env):
        with patch("fetch_unpaywall.requests.Session") as cls:
            sess = MagicMock()
            cls.return_value = sess
            sess.get.return_value = _resp({}, status=500)
            sess.mount = MagicMock()
            sess.headers = {}
            with pytest.raises(RuntimeError, match="500"):
                fetch_unpaywall.cmd_doi("10.1000/x", "test@example.com")

    def test_pdf_url_must_be_https(self, no_cache, fake_env):
        """Bad-scheme pdf_url is silently dropped (best_oa_location.pdf_url empty)."""
        data = {
            "doi": "10.1000/bad",
            "is_oa": True,
            "best_oa_location": {"url_for_pdf": "http://insecure.example.com/x.pdf"},
        }
        with patch("fetch_unpaywall.requests.Session") as cls:
            sess = MagicMock()
            cls.return_value = sess
            sess.get.return_value = _resp(data)
            sess.mount = MagicMock()
            sess.headers = {}
            result = fetch_unpaywall.cmd_doi("10.1000/bad", "test@example.com")
        assert result["best_oa_location"] is None


class TestCliMissingEnv:
    def test_cli_without_email_exits_2(self, capsys, monkeypatch):
        monkeypatch.setattr(fetch_unpaywall, "load_env", lambda: {})
        with pytest.raises(SystemExit) as exc:
            fetch_unpaywall.main(["doi", "10.1000/x"])
        assert exc.value.code == 2
        err = capsys.readouterr().err
        assert "UNPAYWALL_EMAIL" in err


class TestCli:
    def test_cli_open_access_outputs_json(self, no_cache, fake_env, capsys):
        oa_record = {
            "doi": "10.1000/oa-paper",
            "is_oa": True,
            "best_oa_location": {"url_for_pdf": "https://example.com/x.pdf"},
        }
        with patch("fetch_unpaywall.requests.Session") as cls:
            sess = MagicMock()
            cls.return_value = sess
            sess.get.return_value = _resp(oa_record)
            sess.mount = MagicMock()
            sess.headers = {}
            buf = io.StringIO()
            with redirect_stdout(buf), pytest.raises(SystemExit) as exc:
                fetch_unpaywall.main(["doi", "10.1000/oa-paper"])
        assert exc.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert parsed["is_oa"] is True
        assert parsed["_provider"] == "unpaywall"
