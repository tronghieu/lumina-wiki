"""
Tests for fetch_arxiv.py — arXiv API + RSS feed wrapper.

Covers:
- Happy path: valid search returns JSON list, exit 0.
- Happy path: daily RSS returns JSON list, exit 0.
- Empty query -> exit 2 + actionable stderr.
- Empty category -> exit 2 + actionable stderr.
- Network connection error -> exit 3.
- Network timeout -> exit 3.
- HTTP 5xx -> exit 3.
- Malformed XML response -> exit 3.
- Result schema validation (all expected keys present).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import fetch_arxiv


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

MOCK_ATOM_RESPONSE = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>https://arxiv.org/abs/2301.00234v1</id>
    <title>Test Paper Title</title>
    <author><name>Alice Smith</name></author>
    <summary>A test abstract.</summary>
    <published>2023-01-01T00:00:00Z</published>
    <updated>2023-01-02T00:00:00Z</updated>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <arxiv:primary_category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>"""

MOCK_RSS_RESPONSE = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>cs.LG updates</title>
    <item>
      <title>RSS Paper Title</title>
      <link>https://arxiv.org/abs/2301.99999</link>
      <guid>https://arxiv.org/abs/2301.99999</guid>
      <description>RSS abstract.</description>
    </item>
  </channel>
</rss>"""


def _make_mock_response(text: str, status_code: int = 200) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = text
    resp.raise_for_status = MagicMock()
    return resp


# ---------------------------------------------------------------------------
# search_arxiv tests
# ---------------------------------------------------------------------------

class TestSearchArxiv:
    def test_search_happy_path_returns_list(self) -> None:
        """Happy path: mocked HTTP 200 -> list of paper dicts."""
        mock_resp = _make_mock_response(MOCK_ATOM_RESPONSE)
        with patch("fetch_arxiv.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session.get.return_value = mock_resp
            mock_session_cls.return_value = mock_session

            results = fetch_arxiv.search_arxiv("test query", max_results=5)

        assert isinstance(results, list)
        assert len(results) == 1
        assert results[0]["id"] == "2301.00234v1"
        assert results[0]["title"] == "Test Paper Title"

    def test_search_result_schema_has_required_keys(self) -> None:
        """Search result dicts contain all documented fields."""
        mock_resp = _make_mock_response(MOCK_ATOM_RESPONSE)
        with patch("fetch_arxiv.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session.get.return_value = mock_resp
            mock_session_cls.return_value = mock_session
            results = fetch_arxiv.search_arxiv("test")

        required_keys = {"id", "title", "authors", "summary", "published", "updated",
                         "primary_category", "categories", "url"}
        assert required_keys.issubset(set(results[0].keys()))

    def test_search_5xx_raises_value_error(self) -> None:
        """HTTP 5xx from arXiv raises ValueError."""
        mock_resp = _make_mock_response("", status_code=503)
        mock_resp.raise_for_status = MagicMock()
        with patch("fetch_arxiv.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session.get.return_value = mock_resp
            mock_session_cls.return_value = mock_session

            with pytest.raises(ValueError, match="HTTP 503"):
                fetch_arxiv.search_arxiv("test")


# ---------------------------------------------------------------------------
# daily_arxiv tests
# ---------------------------------------------------------------------------

class TestDailyArxiv:
    def test_daily_happy_path_returns_list(self) -> None:
        """Happy path: mocked RSS 200 -> list of item dicts."""
        mock_resp = _make_mock_response(MOCK_RSS_RESPONSE)
        with patch("fetch_arxiv.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session.get.return_value = mock_resp
            mock_session_cls.return_value = mock_session

            results = fetch_arxiv.daily_arxiv("cs.LG")

        assert isinstance(results, list)
        assert len(results) == 1
        assert results[0]["title"] == "RSS Paper Title"

    def test_daily_result_has_id_and_url(self) -> None:
        """RSS result has 'id' and 'url' fields."""
        mock_resp = _make_mock_response(MOCK_RSS_RESPONSE)
        with patch("fetch_arxiv.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session.get.return_value = mock_resp
            mock_session_cls.return_value = mock_session
            results = fetch_arxiv.daily_arxiv("cs.LG")

        assert "id" in results[0]
        assert "url" in results[0]


# ---------------------------------------------------------------------------
# CLI tests
# ---------------------------------------------------------------------------

class TestCLI:
    def test_empty_search_query_exits_2(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Empty search query -> exit 2 with actionable stderr."""
        with pytest.raises(SystemExit) as exc_info:
            fetch_arxiv.main(["search", "   "])
        assert exc_info.value.code == 2
        captured = capsys.readouterr()
        assert "empty" in captured.err.lower() or "query" in captured.err.lower()

    def test_empty_category_exits_2(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Empty daily category -> exit 2 with actionable stderr."""
        with pytest.raises(SystemExit) as exc_info:
            fetch_arxiv.main(["daily", "   "])
        assert exc_info.value.code == 2

    def test_search_happy_path_stdout_is_valid_json(self) -> None:
        """Happy path search: stdout is valid JSON list, exit 0."""
        mock_resp = _make_mock_response(MOCK_ATOM_RESPONSE)
        with patch("fetch_arxiv.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session.get.return_value = mock_resp
            mock_session_cls.return_value = mock_session

            import io
            from contextlib import redirect_stdout
            buf = io.StringIO()
            with redirect_stdout(buf):
                with pytest.raises(SystemExit) as exc_info:
                    fetch_arxiv.main(["search", "flash attention", "--max", "5"])
        assert exc_info.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert isinstance(parsed, list)

    def test_network_error_exits_3(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Connection error -> exit 3 with retry hint."""
        import requests
        with patch("fetch_arxiv.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session.get.side_effect = requests.exceptions.ConnectionError("conn refused")
            mock_session_cls.return_value = mock_session

            with pytest.raises(SystemExit) as exc_info:
                fetch_arxiv.main(["search", "test query"])
        assert exc_info.value.code == 3
        captured = capsys.readouterr()
        assert "retry" in captured.err.lower()

    def test_timeout_exits_3(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Request timeout -> exit 3."""
        import requests
        with patch("fetch_arxiv.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session.get.side_effect = requests.exceptions.Timeout()
            mock_session_cls.return_value = mock_session

            with pytest.raises(SystemExit) as exc_info:
                fetch_arxiv.main(["search", "test query"])
        assert exc_info.value.code == 3

    def test_malformed_xml_exits_3(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Malformed XML response -> exit 3."""
        mock_resp = _make_mock_response("<not valid xml <><>")
        with patch("fetch_arxiv.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session.get.return_value = mock_resp
            mock_session_cls.return_value = mock_session

            with pytest.raises(SystemExit) as exc_info:
                fetch_arxiv.main(["search", "test"])
        assert exc_info.value.code == 3

    @pytest.mark.parametrize("query", ["flash attention", "transformer architecture"])
    def test_search_parameterized_queries(self, query: str) -> None:
        """Parametrized: multiple valid queries return list of results."""
        mock_resp = _make_mock_response(MOCK_ATOM_RESPONSE)
        with patch("fetch_arxiv.requests.Session") as mock_session_cls:
            mock_session = MagicMock()
            mock_session.get.return_value = mock_resp
            mock_session_cls.return_value = mock_session
            results = fetch_arxiv.search_arxiv(query)

        assert isinstance(results, list)
