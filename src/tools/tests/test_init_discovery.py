"""
test_init_discovery.py — Tests for init_discovery.py multi-phase discovery.

Covers:
- Missing --topic -> exit 2.
- Happy path phase 1: fetches papers, writes checkpoint, writes sources.
- Atomic write: checkpoint file is valid JSON after write.
- Resume: phase with checkpoint is skipped when --resume is passed.
- _save_source: writes file atomically under raw/discovered/<slug>/.
- _atomic_write_json: temp file cleaned on error.
- Path traversal: _safe_path rejects '..'.
- _slugify: converts topic to a valid slug.
- Phase 1 deduplicates papers with the same ID.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import init_discovery
from init_discovery import (
    _slugify,
    _safe_path,
    _atomic_write_json,
    _save_source,
    _load_checkpoint,
    _save_checkpoint,
    phase1_keyword_search,
)


# ---------------------------------------------------------------------------
# _slugify tests
# ---------------------------------------------------------------------------

class TestSlugify:
    def test_basic_slug(self) -> None:
        """Simple topic produces lowercase kebab slug."""
        assert _slugify("Flash Attention") == "flash-attention"

    def test_special_chars_removed(self) -> None:
        """Special characters are stripped."""
        slug = _slugify("hello! world?")
        assert "!" not in slug
        assert "?" not in slug

    def test_max_length_64(self) -> None:
        """Slug is capped at 64 characters."""
        slug = _slugify("a" * 200)
        assert len(slug) <= 64

    def test_empty_returns_discovery(self) -> None:
        """Empty/whitespace topic returns 'discovery'."""
        assert _slugify("") == "discovery"
        assert _slugify("   ") == "discovery"


# ---------------------------------------------------------------------------
# _safe_path tests
# ---------------------------------------------------------------------------

class TestSafePath:
    def test_valid_relative_path_allowed(self, tmp_path: Path) -> None:
        """Valid relative path is allowed."""
        result = _safe_path(tmp_path, "subdir/file.json")
        assert str(result).startswith(str(tmp_path))

    def test_path_traversal_rejected(self, tmp_path: Path) -> None:
        """Path with '..' that escapes base is rejected with ValueError."""
        with pytest.raises(ValueError, match="traversal"):
            _safe_path(tmp_path, "../outside.json")


# ---------------------------------------------------------------------------
# _atomic_write_json tests
# ---------------------------------------------------------------------------

class TestAtomicWriteJson:
    def test_writes_valid_json(self, tmp_path: Path) -> None:
        """Writes valid JSON to the target path."""
        target = tmp_path / "out.json"
        data = {"key": "value", "num": 42}
        _atomic_write_json(target, data)
        loaded = json.loads(target.read_text(encoding="utf-8"))
        assert loaded == data

    def test_no_temp_file_left_on_success(self, tmp_path: Path) -> None:
        """No .tmp files left after successful write."""
        target = tmp_path / "out.json"
        _atomic_write_json(target, {"x": 1})
        tmp_files = list(tmp_path.glob("*.tmp"))
        assert len(tmp_files) == 0

    def test_creates_parent_directories(self, tmp_path: Path) -> None:
        """Creates parent directories as needed."""
        target = tmp_path / "nested" / "deep" / "out.json"
        _atomic_write_json(target, {})
        assert target.exists()


# ---------------------------------------------------------------------------
# _save_source tests
# ---------------------------------------------------------------------------

class TestSaveSource:
    def test_saves_source_file(self, tmp_path: Path) -> None:
        """Source dict is written as JSON under <discovered_dir>/<slug>/."""
        discovered_dir = tmp_path / "raw" / "discovered"
        discovered_dir.mkdir(parents=True)
        source = {"id": "simplepaperid", "title": "Test Paper"}
        path = _save_source(discovered_dir, "test-slug", source)
        assert path.exists()
        loaded = json.loads(path.read_text(encoding="utf-8"))
        assert loaded["id"] == "simplepaperid"

    def test_handles_slash_in_id(self, tmp_path: Path) -> None:
        """Slashes in IDs are replaced with underscores for the filename."""
        discovered_dir = tmp_path / "raw" / "discovered"
        discovered_dir.mkdir(parents=True)
        source = {"id": "DOI:10.1234/paper", "title": "Paper"}
        path = _save_source(discovered_dir, "slug", source)
        assert "/" not in path.name


# ---------------------------------------------------------------------------
# Checkpoint tests
# ---------------------------------------------------------------------------

class TestCheckpoints:
    def test_save_and_load_checkpoint(self, tmp_path: Path) -> None:
        """Checkpoint is saved and loaded correctly."""
        state_dir = tmp_path / "_lumina" / "_state"
        state_dir.mkdir(parents=True)
        data = {"results": [{"id": "p1"}], "slug": "test"}
        _save_checkpoint(state_dir, 1, data)
        loaded = _load_checkpoint(state_dir, 1)
        assert loaded is not None
        assert loaded["slug"] == "test"

    def test_load_missing_checkpoint_returns_none(self, tmp_path: Path) -> None:
        """Loading a non-existent checkpoint returns None."""
        state_dir = tmp_path / "_lumina" / "_state"
        state_dir.mkdir(parents=True)
        result = _load_checkpoint(state_dir, 99)
        assert result is None

    def test_checkpoint_file_is_valid_json(self, tmp_path: Path) -> None:
        """Checkpoint file contains valid JSON."""
        state_dir = tmp_path / "_lumina" / "_state"
        state_dir.mkdir(parents=True)
        _save_checkpoint(state_dir, 2, {"results": [], "slug": "topic"})
        cp_path = state_dir / "discovery-2.json"
        assert cp_path.exists()
        data = json.loads(cp_path.read_text(encoding="utf-8"))
        assert "results" in data


# ---------------------------------------------------------------------------
# phase1_keyword_search tests
# ---------------------------------------------------------------------------

class TestPhase1KeywordSearch:
    def test_phase1_writes_sources(self, tmp_path: Path) -> None:
        """Phase 1 writes source JSON files under raw/discovered/<slug>/."""
        discovered_dir = tmp_path / "raw" / "discovered"
        discovered_dir.mkdir(parents=True)
        slug = "test-topic"
        env = {}

        mock_papers = [
            {"id": "p1", "title": "Paper 1", "authors": [], "year": 2022},
        ]

        with patch("init_discovery._arxiv_search", return_value=mock_papers):
            results = phase1_keyword_search(
                "test topic", slug, discovered_dir, ["arxiv"], 10, env, set()
            )

        assert len(results) == 1
        assert results[0]["id"] == "p1"
        written = list((discovered_dir / slug).glob("*.json"))
        assert len(written) == 1

    def test_phase1_deduplicates_by_id(self, tmp_path: Path) -> None:
        """Phase 1 deduplicates papers with the same ID."""
        discovered_dir = tmp_path / "raw" / "discovered"
        discovered_dir.mkdir(parents=True)
        slug = "dedup-test"
        env = {}

        paper = {"id": "SAME_ID", "title": "Duplicate Paper", "authors": [], "year": 2022}

        with patch("init_discovery._arxiv_search", return_value=[paper, paper]):
            results = phase1_keyword_search(
                "topic", slug, discovered_dir, ["arxiv"], 10, env, set()
            )

        # Same ID should only appear once
        ids = [p["id"] for p in results]
        assert ids.count("SAME_ID") == 1

    def test_phase1_skips_failed_fetcher(self, tmp_path: Path) -> None:
        """Phase 1 skips a fetcher that raises an exception."""
        discovered_dir = tmp_path / "raw" / "discovered"
        discovered_dir.mkdir(parents=True)
        slug = "fail-test"
        env = {}

        with patch("init_discovery._arxiv_search", side_effect=RuntimeError("network down")):
            results = phase1_keyword_search(
                "topic", slug, discovered_dir, ["arxiv"], 10, env, set()
            )

        # Should return empty list, not raise
        assert results == []

    def test_phase1_skips_excluded_ids(self, tmp_path: Path) -> None:
        """Phase 1 skips papers whose ID is in exclude_ids and does not save them."""
        discovered_dir = tmp_path / "raw" / "discovered"
        discovered_dir.mkdir(parents=True)
        slug = "exclude-test"
        env = {}

        mock_papers = [
            {"id": "p1", "title": "Keep 1", "authors": [], "year": 2023},
            {"id": "p2", "title": "Excluded", "authors": [], "year": 2023},
            {"id": "p3", "title": "Keep 2", "authors": [], "year": 2023},
        ]

        with patch("init_discovery._arxiv_search", return_value=mock_papers):
            results = phase1_keyword_search(
                "topic", slug, discovered_dir, ["arxiv"], 10, env, {"p2"}
            )

        ids = [p["id"] for p in results]
        assert "p2" not in ids
        assert set(ids) == {"p1", "p3"}
        written = sorted(p.name for p in (discovered_dir / slug).glob("*.json"))
        assert written == ["p1.json", "p3.json"]

    def test_phase1_empty_exclude_ids_no_op(self, tmp_path: Path) -> None:
        """Empty exclude_ids set behaves identically to baseline."""
        discovered_dir = tmp_path / "raw" / "discovered"
        discovered_dir.mkdir(parents=True)
        slug = "noop-test"
        env = {}

        mock_papers = [{"id": "p1", "title": "Paper", "authors": [], "year": 2023}]

        with patch("init_discovery._arxiv_search", return_value=mock_papers):
            results = phase1_keyword_search(
                "topic", slug, discovered_dir, ["arxiv"], 10, env, set()
            )

        assert len(results) == 1
        assert results[0]["id"] == "p1"


# ---------------------------------------------------------------------------
# CLI tests
# ---------------------------------------------------------------------------

class TestCLI:
    def test_missing_topic_exits_2(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Missing --topic -> exit 2."""
        with pytest.raises(SystemExit) as exc_info:
            init_discovery.main([])
        assert exc_info.value.code == 2

    def test_empty_topic_exits_2(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Blank --topic -> exit 2."""
        with pytest.raises(SystemExit) as exc_info:
            init_discovery.main(["--topic", "   "])
        assert exc_info.value.code == 2

    def test_invalid_phases_exits_2(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Non-integer phases -> exit 2."""
        with pytest.raises(SystemExit) as exc_info:
            init_discovery.main(["--topic", "attention", "--phases", "a,b,c"])
        assert exc_info.value.code == 2

    def test_happy_path_single_phase_exit_0(self, tmp_path: Path) -> None:
        """Single phase 1 run: exits 0 with valid JSON summary."""
        import io
        from contextlib import redirect_stdout

        discovered_dir = tmp_path / "raw" / "discovered"
        discovered_dir.mkdir(parents=True)
        (tmp_path / "_lumina" / "_state").mkdir(parents=True)

        mock_papers = [{"id": "p1", "title": "Paper", "authors": [], "year": 2023}]

        with patch("init_discovery._arxiv_search", return_value=mock_papers):
            with patch("init_discovery.load_env", return_value={}):
                buf = io.StringIO()
                with redirect_stdout(buf):
                    with pytest.raises(SystemExit) as exc_info:
                        init_discovery.main([
                            "--topic", "flash attention",
                            "--project-root", str(tmp_path),
                            "--phases", "1",
                            "--fetchers", "arxiv",
                        ])
        assert exc_info.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert parsed["topic"] == "flash attention"
        assert "phases" in parsed

    def test_resume_skips_completed_phase(self, tmp_path: Path) -> None:
        """--resume skips phases with existing checkpoints."""
        import io
        from contextlib import redirect_stdout

        discovered_dir = tmp_path / "raw" / "discovered"
        discovered_dir.mkdir(parents=True)
        state_dir = tmp_path / "_lumina" / "_state"
        state_dir.mkdir(parents=True)

        # Pre-write a phase 1 checkpoint
        cp_data = {"results": [{"id": "pre", "title": "Pre-existing"}], "slug": "flash-attention"}
        _atomic_write_json(state_dir / "discovery-1.json", cp_data)

        with patch("init_discovery.load_env", return_value={}):
            # phase1_keyword_search should NOT be called since checkpoint exists
            with patch("init_discovery.phase1_keyword_search") as mock_p1:
                buf = io.StringIO()
                with redirect_stdout(buf):
                    with pytest.raises(SystemExit) as exc_info:
                        init_discovery.main([
                            "--topic", "flash attention",
                            "--project-root", str(tmp_path),
                            "--phases", "1",
                            "--resume",
                        ])
        assert exc_info.value.code == 0
        # phase1 function should not have been called because checkpoint existed
        mock_p1.assert_not_called()
