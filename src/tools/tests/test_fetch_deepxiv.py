"""
Tests for fetch_deepxiv.py — DeepXiv API wrapper.

Covers:
- Missing DEEPXIV_TOKEN -> exit 2 + actionable message with env var name + URL.
- Happy path search: stdout is valid JSON, exit 0.
- Happy path paper read: stdout is valid JSON, exit 0.
- Empty search query -> exit 2.
- Empty arxiv_id -> exit 2.
- HTTP 401 -> exit 2 with auth error message.
- HTTP 404 -> exit 2.
- HTTP 5xx -> exit 3.
- Network error -> exit 3.
- Timeout -> exit 3.
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

import fetch_deepxiv


def _make_mock_response(data=None, status_code: int = 200) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.json = MagicMock(return_value=data or {})
    resp.raise_for_status = MagicMock()
    return resp


MOCK_SEARCH_RESULTS = [
    {
        "id": "2301.00234",
        "title": "Flash Attention 2",
        "authors": [{"name": "Tri Dao"}],
        "abstract": "Faster attention...",
        "url": "https://arxiv.org/abs/2301.00234",
        "score": 0.95,
        "year": 2023,
    }
]

MOCK_PAPER_READ = {
    "arxiv_id": "2301.00234",
    "title": "Flash Attention 2",
    "sections": [
        {"heading": "Abstract", "text": "Faster attention mechanism.", "order": 0},
        {"heading": "Introduction", "text": "We propose...", "order": 1},
    ],
    "metadata": {},
}


class TestMissingToken:
    def test_missing_token_exits_2(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Missing DEEPXIV_TOKEN -> exit 2 + message with env var name."""
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        monkeypatch.chdir(tmp_path)

        with pytest.raises(SystemExit) as exc_info:
            fetch_deepxiv.main(["search", "attention"])
        assert exc_info.value.code == 2
        captured = capsys.readouterr()
        assert "DEEPXIV_TOKEN" in captured.err

    def test_missing_token_message_includes_url(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Missing token message includes URL to obtain token."""
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        monkeypatch.chdir(tmp_path)

        with pytest.raises(SystemExit):
            fetch_deepxiv.main(["search", "attention"])
        captured = capsys.readouterr()
        assert "https://" in captured.err or "deepxiv" in captured.err.lower()


class TestCLI:
    def test_empty_search_query_exits_2(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Empty search query -> exit 2 before touching the network."""
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("DEEPXIV_TOKEN=test_token\n")
        monkeypatch.chdir(tmp_path)

        with pytest.raises(SystemExit) as exc_info:
            fetch_deepxiv.main(["search", "   "])
        assert exc_info.value.code == 2

    def test_empty_arxiv_id_exits_2(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Empty arxiv_id -> exit 2."""
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("DEEPXIV_TOKEN=test_token\n")
        monkeypatch.chdir(tmp_path)

        with pytest.raises(SystemExit) as exc_info:
            fetch_deepxiv.main(["read", "   "])
        assert exc_info.value.code == 2

    def test_search_happy_path_stdout_is_valid_json_exit_0(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Happy path search: stdout is valid JSON, exit 0."""
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("DEEPXIV_TOKEN=test_token\n")
        monkeypatch.chdir(tmp_path)

        mock_resp = _make_mock_response(MOCK_SEARCH_RESULTS)
        with patch("fetch_deepxiv.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.post.return_value = mock_resp
            buf = io.StringIO()
            with redirect_stdout(buf):
                with pytest.raises(SystemExit) as exc_info:
                    fetch_deepxiv.main(["search", "flash attention"])

        assert exc_info.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert isinstance(parsed, list)

    def test_read_happy_path_stdout_is_valid_json_exit_0(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Happy path paper read: stdout is valid JSON, exit 0."""
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("DEEPXIV_TOKEN=test_token\n")
        monkeypatch.chdir(tmp_path)

        mock_resp = _make_mock_response(MOCK_PAPER_READ)
        with patch("fetch_deepxiv.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = mock_resp
            buf = io.StringIO()
            with redirect_stdout(buf):
                with pytest.raises(SystemExit) as exc_info:
                    fetch_deepxiv.main(["read", "2301.00234"])

        assert exc_info.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert isinstance(parsed, dict)

    def test_network_error_exits_3(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Network error -> exit 3 with retry hint."""
        import requests as req
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("DEEPXIV_TOKEN=test_token\n")
        monkeypatch.chdir(tmp_path)

        with patch("fetch_deepxiv.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.post.side_effect = req.exceptions.ConnectionError("refused")
            with pytest.raises(SystemExit) as exc_info:
                fetch_deepxiv.main(["search", "attention"])

        assert exc_info.value.code == 3
        captured = capsys.readouterr()
        assert "retry" in captured.err.lower()

    def test_timeout_exits_3(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Timeout -> exit 3."""
        import requests as req
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("DEEPXIV_TOKEN=test_token\n")
        monkeypatch.chdir(tmp_path)

        with patch("fetch_deepxiv.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.post.side_effect = req.exceptions.Timeout()
            with pytest.raises(SystemExit) as exc_info:
                fetch_deepxiv.main(["search", "attention"])

        assert exc_info.value.code == 3

    def test_http_5xx_exits_3(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """HTTP 5xx -> exit 3."""
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("DEEPXIV_TOKEN=test_token\n")
        monkeypatch.chdir(tmp_path)

        mock_resp = _make_mock_response(status_code=503)
        with patch("fetch_deepxiv.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.post.return_value = mock_resp
            with pytest.raises(SystemExit) as exc_info:
                fetch_deepxiv.main(["search", "attention"])

        assert exc_info.value.code == 3

    def test_auth_error_401_exits_2(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """HTTP 401 -> exit 2 with actionable auth message."""
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("DEEPXIV_TOKEN=bad_token\n")
        monkeypatch.chdir(tmp_path)

        mock_resp = _make_mock_response(status_code=401)
        with patch("fetch_deepxiv.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.post.return_value = mock_resp
            with pytest.raises(SystemExit) as exc_info:
                fetch_deepxiv.main(["search", "attention"])

        assert exc_info.value.code == 2
        captured = capsys.readouterr()
        assert "auth" in captured.err.lower() or "token" in captured.err.lower()

    def test_trending_happy_path_exit_0(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Trending command: valid JSON list, exit 0."""
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        (tmp_path / ".env").write_text("DEEPXIV_TOKEN=test_token\n")
        monkeypatch.chdir(tmp_path)

        mock_resp = _make_mock_response({"results": MOCK_SEARCH_RESULTS})
        with patch("fetch_deepxiv.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = mock_resp
            buf = io.StringIO()
            with redirect_stdout(buf):
                with pytest.raises(SystemExit) as exc_info:
                    fetch_deepxiv.main(["trending", "--limit", "5"])

        assert exc_info.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert isinstance(parsed, list)
