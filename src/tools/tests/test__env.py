"""
Tests for _env.py — dotenv loader.

Covers:
- Happy path: reads ~/.env and project/.env; project overrides global.
- Missing files: returns empty dict without error.
- Comment lines and blank lines are ignored.
- Quote stripping (single and double).
- mutate=False by default (os.environ not touched).
- Keys without values (no '=') are ignored.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Ensure src/tools is importable
sys.path.insert(0, str(Path(__file__).parent.parent))

from _env import _parse_dotenv, load_env


# ---------------------------------------------------------------------------
# _parse_dotenv unit tests
# ---------------------------------------------------------------------------

class TestParseDotenv:
    def test_parse_simple_key_value(self, tmp_path: Path) -> None:
        """Arrange: simple KEY=VALUE line; Act: parse; Assert: correct dict."""
        env_file = tmp_path / ".env"
        env_file.write_text("FOO=bar\n", encoding="utf-8")
        result = _parse_dotenv(env_file)
        assert result == {"FOO": "bar"}

    def test_parse_ignores_comments(self, tmp_path: Path) -> None:
        """Comment lines starting with '#' are skipped."""
        env_file = tmp_path / ".env"
        env_file.write_text("# comment\nFOO=bar\n", encoding="utf-8")
        result = _parse_dotenv(env_file)
        assert "FOO" in result
        assert len(result) == 1

    def test_parse_ignores_blank_lines(self, tmp_path: Path) -> None:
        """Blank lines produce no entries."""
        env_file = tmp_path / ".env"
        env_file.write_text("\n\nFOO=bar\n\n", encoding="utf-8")
        result = _parse_dotenv(env_file)
        assert result == {"FOO": "bar"}

    def test_parse_strips_double_quotes(self, tmp_path: Path) -> None:
        """Double-quoted values are unquoted."""
        env_file = tmp_path / ".env"
        env_file.write_text('KEY="hello world"\n', encoding="utf-8")
        result = _parse_dotenv(env_file)
        assert result["KEY"] == "hello world"

    def test_parse_strips_single_quotes(self, tmp_path: Path) -> None:
        """Single-quoted values are unquoted."""
        env_file = tmp_path / ".env"
        env_file.write_text("KEY='hello world'\n", encoding="utf-8")
        result = _parse_dotenv(env_file)
        assert result["KEY"] == "hello world"

    def test_parse_ignores_lines_without_equals(self, tmp_path: Path) -> None:
        """Lines without '=' are ignored."""
        env_file = tmp_path / ".env"
        env_file.write_text("NOT_A_VAR\nFOO=bar\n", encoding="utf-8")
        result = _parse_dotenv(env_file)
        assert result == {"FOO": "bar"}

    def test_parse_missing_file_returns_empty(self, tmp_path: Path) -> None:
        """A missing file returns an empty dict without raising."""
        result = _parse_dotenv(tmp_path / "nonexistent.env")
        assert result == {}

    def test_parse_value_with_equals_sign(self, tmp_path: Path) -> None:
        """Values containing '=' are preserved correctly."""
        env_file = tmp_path / ".env"
        env_file.write_text("URL=https://example.com/path?a=1&b=2\n", encoding="utf-8")
        result = _parse_dotenv(env_file)
        assert result["URL"] == "https://example.com/path?a=1&b=2"


# ---------------------------------------------------------------------------
# load_env unit tests
# ---------------------------------------------------------------------------

class TestLoadEnv:
    def test_project_overrides_global(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """Project .env values override global ~/.env values."""
        home = tmp_path / "home"
        home.mkdir()
        project = tmp_path / "project"
        project.mkdir()

        (home / ".env").write_text("KEY=global_value\n", encoding="utf-8")
        (project / ".env").write_text("KEY=project_value\n", encoding="utf-8")

        monkeypatch.setattr(Path, "home", lambda: home)
        result = load_env(project)
        assert result["KEY"] == "project_value"

    def test_global_only_when_no_project_env(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Global vars appear when project .env is missing."""
        home = tmp_path / "home"
        home.mkdir()
        project = tmp_path / "project"
        project.mkdir()

        (home / ".env").write_text("GLOBAL_KEY=global\n", encoding="utf-8")
        monkeypatch.setattr(Path, "home", lambda: home)

        result = load_env(project)
        assert result["GLOBAL_KEY"] == "global"

    def test_missing_both_returns_empty(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """No .env files anywhere -> empty dict, no exception."""
        home = tmp_path / "home"
        home.mkdir()
        project = tmp_path / "project"
        project.mkdir()
        monkeypatch.setattr(Path, "home", lambda: home)

        result = load_env(project)
        assert result == {}

    def test_does_not_mutate_os_environ(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Default call does not modify os.environ."""
        home = tmp_path / "home"
        home.mkdir()
        project = tmp_path / "project"
        project.mkdir()
        (project / ".env").write_text("MY_UNIQUE_KEY_12345=some_value\n", encoding="utf-8")
        monkeypatch.setattr(Path, "home", lambda: home)

        before = os.environ.get("MY_UNIQUE_KEY_12345", "__NOT_SET__")
        load_env(project)
        after = os.environ.get("MY_UNIQUE_KEY_12345", "__NOT_SET__")
        assert before == after == "__NOT_SET__"

    def test_defaults_to_cwd_when_no_project_root(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """project_root=None uses cwd as default."""
        home = tmp_path / "home"
        home.mkdir()
        monkeypatch.setattr(Path, "home", lambda: home)
        monkeypatch.chdir(tmp_path)

        (tmp_path / ".env").write_text("CWD_KEY=cwd_value\n", encoding="utf-8")
        result = load_env()
        assert result["CWD_KEY"] == "cwd_value"

    def test_merged_dict_contains_both_global_and_project_keys(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Non-overlapping keys from both files appear in merged dict."""
        home = tmp_path / "home"
        home.mkdir()
        project = tmp_path / "project"
        project.mkdir()
        (home / ".env").write_text("GLOBAL=g\n", encoding="utf-8")
        (project / ".env").write_text("LOCAL=l\n", encoding="utf-8")
        monkeypatch.setattr(Path, "home", lambda: home)

        result = load_env(project)
        assert result["GLOBAL"] == "g"
        assert result["LOCAL"] == "l"
