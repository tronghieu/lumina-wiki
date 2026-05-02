"""
Tests for fetch_wikipedia.py — Wikipedia REST + Action API wrapper.

Covers:
- Happy path: page fetch returns JSON dict with required keys, exit 0.
- Happy path: search returns JSON list, exit 0.
- Empty title -> exit 2 + actionable stderr.
- Empty search query -> exit 2.
- Page not found (404) -> exit 2 with actionable message.
- Disambiguation page -> exit 2 with actionable message.
- Network error -> exit 3.
- Timeout -> exit 3.
- HTTP 5xx -> exit 3.
- Result schema validation.
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

import fetch_wikipedia


def _make_mock_response(
    data: dict | list | None = None,
    status_code: int = 200,
    text: str = "",
) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = text or (json.dumps(data) if data else "")
    resp.json = MagicMock(return_value=data or {})
    resp.raise_for_status = MagicMock()
    return resp


MOCK_SUMMARY = {
    "type": "standard",
    "title": "Flash attention",
    "pageid": 12345,
    "description": "An attention algorithm",
    "extract": "Flash attention is an algorithm...",
    "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Flash_attention"}},
}

MOCK_ACTION_RESPONSE = {
    "query": {
        "pages": {
            "12345": {
                "extract": "Flash attention is a fast attention algorithm.",
                "categories": [
                    {"title": "Category:Machine learning algorithms"},
                ],
            }
        }
    }
}

MOCK_SEARCH_RESPONSE = {
    "query": {
        "search": [
            {
                "title": "Flash attention",
                "pageid": 12345,
                "snippet": "an <span class=\"searchmatch\">attention</span> algorithm",
            }
        ]
    }
}


class TestFetchPage:
    def test_fetch_page_happy_path_returns_dict(self) -> None:
        """Happy path: returns dict with required keys."""
        with patch("fetch_wikipedia.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            # First call: REST summary; second call: Action API
            sess.get.side_effect = [
                _make_mock_response(MOCK_SUMMARY),
                _make_mock_response(MOCK_ACTION_RESPONSE),
            ]
            result = fetch_wikipedia.fetch_page("Flash attention", sess)

        required = {"title", "pageid", "description", "extract", "url", "categories"}
        assert required.issubset(set(result.keys()))

    def test_fetch_page_404_raises_value_error(self) -> None:
        """404 response raises ValueError with page-not-found message."""
        with patch("fetch_wikipedia.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            resp = _make_mock_response(status_code=404)
            sess.get.return_value = resp
            with pytest.raises(ValueError, match="not found"):
                fetch_wikipedia.fetch_page("NonExistentPage12345XYZ", sess)

    def test_fetch_page_disambiguation_raises_value_error(self) -> None:
        """Disambiguation page raises ValueError with actionable message."""
        disambiguation = {**MOCK_SUMMARY, "type": "disambiguation"}
        with patch("fetch_wikipedia.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(disambiguation)
            with pytest.raises(ValueError, match="disambiguation"):
                fetch_wikipedia.fetch_page("Mercury", sess)

    def test_fetch_page_5xx_raises_value_error(self) -> None:
        """HTTP 5xx raises ValueError."""
        with patch("fetch_wikipedia.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(status_code=503)
            with pytest.raises(ValueError, match="HTTP 503"):
                fetch_wikipedia.fetch_page("Test", sess)


class TestSearchWikipedia:
    def test_search_happy_path_returns_list(self) -> None:
        """Happy path: returns list of result dicts."""
        with patch("fetch_wikipedia.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(MOCK_SEARCH_RESPONSE)
            results = fetch_wikipedia.search_wikipedia("flash attention", session=sess)

        assert isinstance(results, list)
        assert len(results) == 1
        assert results[0]["title"] == "Flash attention"

    def test_search_snippet_strips_html_spans(self) -> None:
        """Search result snippet has HTML searchmatch spans stripped."""
        with patch("fetch_wikipedia.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(MOCK_SEARCH_RESPONSE)
            results = fetch_wikipedia.search_wikipedia("flash attention", session=sess)
        # The mock snippet contains HTML spans; they should be stripped
        assert "<span" not in results[0]["snippet"]


class TestCLI:
    def test_empty_page_title_exits_2(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Empty title -> exit 2."""
        with pytest.raises(SystemExit) as exc_info:
            fetch_wikipedia.main(["page", "   "])
        assert exc_info.value.code == 2

    def test_empty_search_query_exits_2(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Empty search query -> exit 2."""
        with pytest.raises(SystemExit) as exc_info:
            fetch_wikipedia.main(["search", "   "])
        assert exc_info.value.code == 2

    def test_page_happy_path_stdout_is_valid_json_exit_0(self) -> None:
        """Happy path page fetch: stdout is valid JSON, exit 0."""
        with patch("fetch_wikipedia.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.side_effect = [
                _make_mock_response(MOCK_SUMMARY),
                _make_mock_response(MOCK_ACTION_RESPONSE),
            ]
            buf = io.StringIO()
            with redirect_stdout(buf):
                with pytest.raises(SystemExit) as exc_info:
                    fetch_wikipedia.main(["page", "Flash attention"])
        assert exc_info.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert isinstance(parsed, dict)

    def test_search_happy_path_stdout_is_valid_json_exit_0(self) -> None:
        """Happy path search: stdout is valid JSON list, exit 0."""
        with patch("fetch_wikipedia.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(MOCK_SEARCH_RESPONSE)
            buf = io.StringIO()
            with redirect_stdout(buf):
                with pytest.raises(SystemExit) as exc_info:
                    fetch_wikipedia.main(["search", "attention"])
        assert exc_info.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert isinstance(parsed, list)

    def test_network_error_exits_3(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Network error -> exit 3 with retry hint."""
        import requests as req
        with patch("fetch_wikipedia.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.side_effect = req.exceptions.ConnectionError("refused")
            with pytest.raises(SystemExit) as exc_info:
                fetch_wikipedia.main(["page", "Test"])
        assert exc_info.value.code == 3
        captured = capsys.readouterr()
        assert "retry" in captured.err.lower()

    def test_timeout_exits_3(self) -> None:
        """Timeout -> exit 3."""
        import requests as req
        with patch("fetch_wikipedia.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.side_effect = req.exceptions.Timeout()
            with pytest.raises(SystemExit) as exc_info:
                fetch_wikipedia.main(["page", "Test"])
        assert exc_info.value.code == 3

    def test_disambiguation_exits_2_with_actionable_message(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Disambiguation page -> exit 2 with helpful message."""
        disambiguation = {**MOCK_SUMMARY, "type": "disambiguation"}
        with patch("fetch_wikipedia.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(disambiguation)
            with pytest.raises(SystemExit) as exc_info:
                fetch_wikipedia.main(["page", "Mercury"])
        assert exc_info.value.code == 2
        captured = capsys.readouterr()
        parsed = json.loads(captured.err)
        assert "disambiguation" in parsed["error"].lower()

    def test_disambiguation_emits_structured_json_on_stderr(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Disambiguation page -> exit 2; stderr is JSON with kind='disambiguation' and non-empty hint."""
        disambiguation = {**MOCK_SUMMARY, "type": "disambiguation"}
        with patch("fetch_wikipedia.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(disambiguation)
            with pytest.raises(SystemExit) as exc_info:
                fetch_wikipedia.main(["page", "Mercury"])
        assert exc_info.value.code == 2
        captured = capsys.readouterr()
        parsed = json.loads(captured.err)
        assert parsed.get("kind") == "disambiguation"
        assert parsed.get("hint", "")

    def test_non_disambiguation_value_error_still_exits_2_with_json(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Non-disambiguation ValueError -> exit 2; stderr is JSON without 'kind' field."""
        with patch("fetch_wikipedia.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            # 404 causes a ValueError("Page not found: ...") — no "disambiguation" in message
            sess.get.return_value = _make_mock_response(status_code=404)
            with pytest.raises(SystemExit) as exc_info:
                fetch_wikipedia.main(["page", "NonExistentPage12345XYZ"])
        assert exc_info.value.code == 2
        captured = capsys.readouterr()
        parsed = json.loads(captured.err)
        assert "error" in parsed
        assert "kind" not in parsed
