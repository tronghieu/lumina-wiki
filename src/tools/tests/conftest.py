"""
conftest.py — Shared fixtures for Lumina research-pack tool tests.

Provides:
    tmp_project   — temporary project directory with raw/discovered/, raw/tmp/,
                    raw/sources/, _lumina/_state/ sub-directories.
    mock_env      — environment dict with dummy API keys for testing.
    env_file      — writes a .env file into tmp_project and returns the path.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Generator

import pytest

# Ensure src/tools is importable when pytest is run from the repo root
TOOLS_DIR = Path(__file__).resolve().parent.parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))


@pytest.fixture
def tmp_project(tmp_path: Path) -> Generator[Path, None, None]:
    """Create a temporary project directory with the required sub-directories.

    Directory layout:
        tmp_path/
            raw/
                discovered/
                sources/
                tmp/
                notes/
                assets/
            _lumina/
                _state/
            wiki/
    """
    dirs = [
        "raw/discovered",
        "raw/sources",
        "raw/tmp",
        "raw/notes",
        "raw/assets",
        "_lumina/_state",
        "wiki",
    ]
    for d in dirs:
        (tmp_path / d).mkdir(parents=True, exist_ok=True)
    yield tmp_path


@pytest.fixture
def mock_env() -> dict[str, str]:
    """Return a dict of dummy API keys suitable for patching _env.load_env."""
    return {
        "SEMANTIC_SCHOLAR_API_KEY": "test-s2-key-123",
        "DEEPXIV_TOKEN": "test-deepxiv-token-456",
    }


@pytest.fixture
def env_file(tmp_project: Path, mock_env: dict[str, str]) -> Path:
    """Write a .env file into tmp_project with mock API keys.

    Returns the path to the .env file.
    """
    lines = [f"{k}={v}" for k, v in mock_env.items()]
    env_path = tmp_project / ".env"
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return env_path
