"""Tests for fetch_rss.py — RSS / Atom poller with dedup + XXE guard."""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import fetch_rss


FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def tmp_project(tmp_path: Path) -> Path:
    (tmp_path / "_lumina" / "_state" / "feeds").mkdir(parents=True)
    return tmp_path


def _make_resp(body: bytes, status: int = 200, headers: dict | None = None):
    r = MagicMock()
    r.status_code = status
    r.headers = headers or {}
    r.iter_content = lambda chunk_size: iter([body])
    return r


def _atom_bytes() -> bytes:
    return (FIXTURES / "feed_sample_atom.xml").read_bytes()


def _xxe_bytes() -> bytes:
    return (FIXTURES / "feed_xxe_attack.xml").read_bytes()


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

class TestPollHappyPath:
    def test_extracts_three_items_from_sample_feed(self, tmp_project):
        with patch("fetch_rss._make_session") as mk:
            sess = MagicMock()
            mk.return_value = sess
            sess.get.return_value = _make_resp(_atom_bytes(), headers={"ETag": "v1"})
            result = fetch_rss.poll(
                "https://example.com/feed", tmp_project, feed_id="sample"
            )
        assert len(result["items"]) == 3
        # First item has an arxiv reference.
        first = result["items"][0]
        assert first["external_ids"].get("arxiv") == "2401.12345"
        # DOI cross-walk synthesized.
        assert first["external_ids"].get("doi") == "10.48550/arxiv.2401.12345"

    def test_state_file_created_with_etag(self, tmp_project):
        with patch("fetch_rss._make_session") as mk:
            sess = MagicMock()
            mk.return_value = sess
            sess.get.return_value = _make_resp(_atom_bytes(), headers={"ETag": "v1"})
            fetch_rss.poll(
                "https://example.com/feed", tmp_project, feed_id="sample"
            )
        state_path = tmp_project / "_lumina" / "_state" / "feeds" / "sample.json"
        assert state_path.exists()
        state = json.loads(state_path.read_text())
        assert state["etag"] == "v1"
        assert len(state["last_seen_guids"]) == 3


class TestDedup:
    def test_re_poll_returns_no_new_items(self, tmp_project):
        with patch("fetch_rss._make_session") as mk:
            sess = MagicMock()
            mk.return_value = sess
            sess.get.return_value = _make_resp(_atom_bytes(), headers={"ETag": "v1"})
            r1 = fetch_rss.poll(
                "https://example.com/feed", tmp_project, feed_id="sample"
            )
            assert len(r1["items"]) == 3
            # Re-poll
            sess.get.return_value = _make_resp(_atom_bytes(), headers={"ETag": "v1"})
            r2 = fetch_rss.poll(
                "https://example.com/feed", tmp_project, feed_id="sample"
            )
            assert len(r2["items"]) == 0

    def test_max_cap_spilled_items_re_surface(self, tmp_project):
        with patch("fetch_rss._make_session") as mk:
            sess = MagicMock()
            mk.return_value = sess
            sess.get.return_value = _make_resp(_atom_bytes())
            r1 = fetch_rss.poll(
                "https://example.com/feed", tmp_project, feed_id="sample", max_new=2
            )
            assert len(r1["items"]) == 2
            # spilled item must NOT be added to last_seen_guids
            state_path = tmp_project / "_lumina" / "_state" / "feeds" / "sample.json"
            state = json.loads(state_path.read_text())
            assert len(state["last_seen_guids"]) == 2

            sess.get.return_value = _make_resp(_atom_bytes())
            r2 = fetch_rss.poll(
                "https://example.com/feed", tmp_project, feed_id="sample", max_new=10
            )
            # The third (spilled) item is re-emitted.
            assert len(r2["items"]) == 1


class TestEtag304:
    def test_304_returns_empty_with_cache_hit_flag(self, tmp_project):
        state_path = tmp_project / "_lumina" / "_state" / "feeds" / "sample.json"
        # seed state with an etag
        state_path.write_text(json.dumps({
            "etag": "v1",
            "last_modified": "",
            "last_seen_guids": {},
            "last_run": "",
            "item_count": 0,
            "poll_count": 1,
        }))
        with patch("fetch_rss._make_session") as mk:
            sess = MagicMock()
            mk.return_value = sess
            sess.get.return_value = _make_resp(b"", status=304)
            r = fetch_rss.poll(
                "https://example.com/feed", tmp_project, feed_id="sample"
            )
        assert r["cache_hit"] is True
        assert r["items"] == []
        # last_run updated
        state = json.loads(state_path.read_text())
        assert state["last_run"]


class TestXxeRejection:
    def test_xxe_payload_rejected_state_untouched(self, tmp_project):
        with patch("fetch_rss._make_session") as mk:
            sess = MagicMock()
            mk.return_value = sess
            sess.get.return_value = _make_resp(_xxe_bytes())
            r = fetch_rss.poll(
                "https://example.com/xxe", tmp_project, feed_id="xxe"
            )
        assert r["items"] == []
        assert r.get("error") == "unsafe XML"
        # State file should NOT have been created
        state_path = tmp_project / "_lumina" / "_state" / "feeds" / "xxe.json"
        assert not state_path.exists()


class TestUrlValidation:
    def test_http_scheme_rejected(self, tmp_project):
        with pytest.raises(ValueError, match="https"):
            fetch_rss.poll("http://example.com/feed", tmp_project, feed_id="x")

    def test_empty_url_rejected(self, tmp_project):
        with pytest.raises(ValueError, match="empty"):
            fetch_rss.poll("", tmp_project, feed_id="x")

    @pytest.mark.parametrize("url", [
        "https://127.0.0.1/feed",            # loopback
        "https://169.254.169.254/feed",      # cloud metadata
        "https://10.0.0.5/feed",             # RFC1918
        "https://192.168.1.1/feed",          # RFC1918
    ])
    def test_private_ip_feed_rejected_by_ssrf_guard(self, tmp_project, url):
        with patch("fetch_rss._make_session") as mk:
            sess = MagicMock()
            mk.return_value = sess
            with pytest.raises(ValueError, match="SSRF"):
                fetch_rss.poll(url, tmp_project, feed_id="x")
            # Critical: guard must run BEFORE any network I/O.
            sess.get.assert_not_called()


class TestPerFeedStateIsolation:
    def test_two_feeds_write_distinct_files(self, tmp_project):
        with patch("fetch_rss._make_session") as mk:
            sess = MagicMock()
            mk.return_value = sess
            sess.get.return_value = _make_resp(_atom_bytes())
            fetch_rss.poll("https://example.com/a", tmp_project, feed_id="alpha")
            sess.get.return_value = _make_resp(_atom_bytes())
            fetch_rss.poll("https://example.com/b", tmp_project, feed_id="beta")
        d = tmp_project / "_lumina" / "_state" / "feeds"
        assert (d / "alpha.json").exists()
        assert (d / "beta.json").exists()


class TestIgnoreEtag:
    def test_ignore_etag_bypasses_conditional_headers(self, tmp_project):
        state_path = tmp_project / "_lumina" / "_state" / "feeds" / "sample.json"
        state_path.write_text(json.dumps({
            "etag": "v1",
            "last_modified": "",
            "last_seen_guids": {},
            "last_run": "",
            "item_count": 0,
            "poll_count": 1,
        }))
        with patch("fetch_rss._make_session") as mk:
            sess = MagicMock()
            mk.return_value = sess
            sess.get.return_value = _make_resp(_atom_bytes())
            fetch_rss.poll(
                "https://example.com/feed", tmp_project,
                feed_id="sample", ignore_etag=True,
            )
            # First positional arg = url; headers via kwarg
            call_kwargs = sess.get.call_args.kwargs
            headers = call_kwargs.get("headers", {})
            assert "If-None-Match" not in headers
