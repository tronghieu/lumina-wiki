"""
Tests for fetch_scite.py — Scite.ai citation-tally wrapper.

Covers:
- Missing API key -> exit 2 + actionable message (env var name + URL).
- Invalid DOI -> exit 2.
- Happy path: tally normalized, found=True.
- DOI not indexed (404) -> found=False, exit 0 (graceful "no data").
- Key rejected (401/403) -> ValueError -> exit 2.
- HTTP 5xx / 429 -> RuntimeError.
- Network error / timeout -> exit 3 + retry hint.
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

import fetch_scite


def _make_mock_response(data: dict | list = None, status_code: int = 200) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.json = MagicMock(return_value=data or {})
    resp.raise_for_status = MagicMock()
    return resp


VALID_DOI = "10.1234/abcd.5678"

MOCK_TALLY = {
    "doi": VALID_DOI,
    "supporting": 12,
    "contradicting": 1,
    "mentioning": 64,
    "unclassified": 2,
    "total": 79,
}


class TestMissingApiKey:
    def test_missing_key_exits_2_with_env_var_name(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        monkeypatch.chdir(tmp_path)

        with pytest.raises(SystemExit) as exc_info:
            fetch_scite.main(["tally", VALID_DOI])
        assert exc_info.value.code == 2
        captured = capsys.readouterr()
        assert "SCITE_API_KEY" in captured.err
        assert "https://" in captured.err


class TestInvalidDoi:
    def test_invalid_doi_exits_2(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("SCITE_API_KEY=test_key\n")
        monkeypatch.chdir(tmp_path)

        with pytest.raises(SystemExit) as exc_info:
            fetch_scite.main(["tally", "not-a-doi"])
        assert exc_info.value.code == 2
        assert "DOI" in capsys.readouterr().err


class TestFetchTally:
    def test_happy_path_normalizes_tally(self) -> None:
        with patch("fetch_scite.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(MOCK_TALLY)
            result = fetch_scite.fetch_tally(VALID_DOI, sess)

        assert result["found"] is True
        assert result["supporting"] == 12
        assert result["contrasting"] == 1   # mapped from 'contradicting'
        assert result["mentioning"] == 64
        assert result["source"] == "scite.ai"

    def test_404_returns_found_false(self) -> None:
        with patch("fetch_scite.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(status_code=404)
            result = fetch_scite.fetch_tally(VALID_DOI, sess)

        assert result == {"found": False, "doi": VALID_DOI}

    def test_401_raises_value_error(self) -> None:
        with patch("fetch_scite.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(status_code=401)
            with pytest.raises(ValueError, match="[Kk]ey"):
                fetch_scite.fetch_tally(VALID_DOI, sess)

    def test_5xx_raises_runtime_error(self) -> None:
        with patch("fetch_scite.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(status_code=503)
            with pytest.raises(RuntimeError, match="HTTP 503"):
                fetch_scite.fetch_tally(VALID_DOI, sess)

    def test_429_raises_runtime_error(self) -> None:
        with patch("fetch_scite.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(status_code=429)
            with pytest.raises(RuntimeError, match="[Rr]ate limit"):
                fetch_scite.fetch_tally(VALID_DOI, sess)


class TestCLI:
    def test_tally_command_stdout_is_valid_json(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("SCITE_API_KEY=test_key\n")
        monkeypatch.chdir(tmp_path)

        with patch("fetch_scite.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(MOCK_TALLY)
            buf = io.StringIO()
            with redirect_stdout(buf):
                with pytest.raises(SystemExit) as exc_info:
                    fetch_scite.main(["tally", VALID_DOI])

        assert exc_info.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert parsed["found"] is True

    def test_network_error_exits_3(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import requests as req
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("SCITE_API_KEY=test_key\n")
        monkeypatch.chdir(tmp_path)

        with patch("fetch_scite.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.side_effect = req.exceptions.ConnectionError("refused")
            with pytest.raises(SystemExit) as exc_info:
                fetch_scite.main(["tally", VALID_DOI])

        assert exc_info.value.code == 3
        assert "retry" in capsys.readouterr().err.lower()
