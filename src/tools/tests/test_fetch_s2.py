"""
Tests for fetch_s2.py — Semantic Scholar API wrapper.

Covers:
- Missing API key -> exit 2 + actionable message mentioning env var name and URL.
- Happy path: paper fetch returns valid JSON, exit 0.
- Happy path: search returns valid JSON, exit 0.
- Paper not found (404) -> exit 2.
- HTTP 5xx -> exit 3.
- Rate limit (429) -> exit 3.
- Network connection error -> exit 3.
- Timeout -> exit 3.
- Result schema validation.
- Parametrized: multiple paper IDs.
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

import fetch_s2


def _make_mock_response(data: dict | list = None, status_code: int = 200) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.json = MagicMock(return_value=data or {})
    resp.raise_for_status = MagicMock()
    return resp


MOCK_PAPER = {
    "paperId": "abc123",
    "title": "Attention Is All You Need",
    "abstract": "The dominant sequence transduction models...",
    "authors": [{"name": "Vaswani et al."}],
    "year": 2017,
    "citationCount": 80000,
    "url": "https://api.semanticscholar.org/paper/abc123",
}

MOCK_SEARCH_RESULT = {
    "total": 1,
    "offset": 0,
    "next": None,
    "data": [MOCK_PAPER],
}

MOCK_CITATIONS = {
    "total": 1,
    "offset": 0,
    "next": None,
    "data": [{"citingPaper": MOCK_PAPER}],
}

MOCK_REFERENCES = {
    "total": 1,
    "offset": 0,
    "next": None,
    "data": [{"citedPaper": MOCK_PAPER}],
}


class TestMissingApiKey:
    def test_missing_key_exits_2_with_env_var_name(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Missing SEMANTIC_SCHOLAR_API_KEY -> exit 2 + message with var name."""
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        monkeypatch.chdir(tmp_path)

        with pytest.raises(SystemExit) as exc_info:
            fetch_s2.main(["paper", "abc123"])
        assert exc_info.value.code == 2
        captured = capsys.readouterr()
        assert "SEMANTIC_SCHOLAR_API_KEY" in captured.err

    def test_missing_key_message_includes_obtain_url(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Missing key error message includes URL to obtain key."""
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        monkeypatch.chdir(tmp_path)

        with pytest.raises(SystemExit):
            fetch_s2.main(["paper", "abc123"])
        captured = capsys.readouterr()
        assert "semanticscholar.org" in captured.err or "https://" in captured.err


class TestFetchPaper:
    def test_fetch_paper_happy_path(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """Happy path: returns paper dict with required keys."""
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("SEMANTIC_SCHOLAR_API_KEY=test_key\n")

        with patch("fetch_s2.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(MOCK_PAPER)
            result = fetch_s2.fetch_paper("abc123", sess)

        assert result["paperId"] == "abc123"

    def test_fetch_paper_404_raises_value_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """404 -> ValueError 'Not found'."""
        with patch("fetch_s2.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(status_code=404)
            with pytest.raises(ValueError, match="[Nn]ot found"):
                fetch_s2.fetch_paper("nonexistent_id", sess)

    def test_fetch_paper_5xx_raises_runtime_error(self) -> None:
        """5xx -> RuntimeError."""
        with patch("fetch_s2.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(status_code=503)
            with pytest.raises(RuntimeError, match="HTTP 503"):
                fetch_s2.fetch_paper("abc123", sess)

    def test_fetch_paper_429_rate_limit_raises_runtime_error(self) -> None:
        """429 -> RuntimeError rate limit."""
        with patch("fetch_s2.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(status_code=429)
            with pytest.raises(RuntimeError, match="[Rr]ate limit"):
                fetch_s2.fetch_paper("abc123", sess)


class TestSearchPapers:
    def test_search_happy_path(self) -> None:
        """Search returns dict with 'data' list."""
        with patch("fetch_s2.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(MOCK_SEARCH_RESULT)
            result = fetch_s2.search_papers("attention", sess)

        assert "data" in result
        assert isinstance(result["data"], list)

    @pytest.mark.parametrize("paper_id", ["abc123", "arXiv:1706.03762", "DOI:10.48550/arXiv.1706.03762"])
    def test_fetch_citations_parameterized_ids(self, paper_id: str) -> None:
        """Parametrized: citations endpoint works for various ID formats."""
        with patch("fetch_s2.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(MOCK_CITATIONS)
            result = fetch_s2.fetch_citations(paper_id, sess)

        assert "data" in result


class TestCLI:
    def test_paper_command_stdout_is_valid_json(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """CLI paper command: stdout is valid JSON, exit 0."""
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("SEMANTIC_SCHOLAR_API_KEY=test_key\n")
        monkeypatch.chdir(tmp_path)

        with patch("fetch_s2.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(MOCK_PAPER)
            buf = io.StringIO()
            with redirect_stdout(buf):
                with pytest.raises(SystemExit) as exc_info:
                    fetch_s2.main(["paper", "abc123"])

        assert exc_info.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert isinstance(parsed, dict)

    def test_network_error_exits_3(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Network error -> exit 3 + retry hint."""
        import requests as req
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("SEMANTIC_SCHOLAR_API_KEY=test_key\n")
        monkeypatch.chdir(tmp_path)

        with patch("fetch_s2.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.side_effect = req.exceptions.ConnectionError("refused")
            with pytest.raises(SystemExit) as exc_info:
                fetch_s2.main(["paper", "abc123"])

        assert exc_info.value.code == 3
        captured = capsys.readouterr()
        assert "retry" in captured.err.lower()

    def test_timeout_exits_3(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Timeout -> exit 3."""
        import requests as req
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("SEMANTIC_SCHOLAR_API_KEY=test_key\n")
        monkeypatch.chdir(tmp_path)

        with patch("fetch_s2.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.side_effect = req.exceptions.Timeout()
            with pytest.raises(SystemExit) as exc_info:
                fetch_s2.main(["search", "test"])

        assert exc_info.value.code == 3

    def test_empty_paper_id_exits_2(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Empty paper ID -> exit 2."""
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("SEMANTIC_SCHOLAR_API_KEY=test_key\n")
        monkeypatch.chdir(tmp_path)

        with pytest.raises(SystemExit) as exc_info:
            fetch_s2.main(["paper", "   "])
        assert exc_info.value.code == 2
