"""
conftest.py — Shared fixtures for Lumina research-pack tool tests.

Provides:
    tmp_project   — temporary project directory with raw/discovered/, raw/tmp/,
                    raw/sources/, _lumina/_state/ sub-directories.
    mock_env      — environment dict with dummy API keys for testing.
    env_file      — writes a .env file into tmp_project and returns the path.
    make_docx     — generate minimal .docx fixture in-memory.
    make_rtf      — generate minimal .rtf fixture in-memory.
    make_epub     — generate minimal .epub fixture in-memory.
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


# ---------------------------------------------------------------------------
# Local text-document fixture builders (research pack)
# ---------------------------------------------------------------------------

def _make_docx(path: Path, paragraphs: list[str]) -> Path:
    """Build a minimal .docx file at `path` containing the given paragraphs."""
    docx = pytest.importorskip("docx")
    doc = docx.Document()
    for p in paragraphs:
        doc.add_paragraph(p)
    doc.save(str(path))
    return path


def _make_rtf(path: Path, body: str) -> Path:
    """Build a minimal RTF file at `path` containing `body` as plain text."""
    pytest.importorskip("striprtf")
    escaped = body.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
    rtf = (
        "{\\rtf1\\ansi\\ansicpg1252\\deff0"
        "{\\fonttbl{\\f0 Times New Roman;}}"
        f"\\f0\\fs24 {escaped}\\par}}"
    )
    path.write_bytes(rtf.encode("ascii"))
    # Smoke parse-back so the fixture is valid before the extractor exists.
    from striprtf.striprtf import rtf_to_text
    parsed = rtf_to_text(rtf)
    assert body.split("\n", 1)[0][:20] in parsed, "RTF fixture round-trip failed"
    return path


def _make_epub(path: Path, chapters: list[tuple[str, str]]) -> Path:
    """Build a minimal .epub file at `path`. Each chapter is (title, body_html)."""
    ebooklib = pytest.importorskip("ebooklib")
    from ebooklib import epub

    book = epub.EpubBook()
    book.set_identifier("lumina-test-epub")
    book.set_title("Test EPUB")
    book.set_language("en")
    book.add_author("Test Author")

    spine: list = ["nav"]
    toc: list = []
    for idx, (title, body_html) in enumerate(chapters, start=1):
        chap = epub.EpubHtml(
            title=title,
            file_name=f"chap_{idx}.xhtml",
            lang="en",
        )
        chap.content = (
            f"<html><head><title>{title}</title></head>"
            f"<body><h1>{title}</h1>{body_html}</body></html>"
        )
        book.add_item(chap)
        spine.append(chap)
        toc.append(chap)
    book.toc = tuple(toc)
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = spine
    epub.write_epub(str(path), book, {})
    return path


@pytest.fixture
def make_docx():
    """Factory fixture: build a minimal .docx at the given path."""
    return _make_docx


@pytest.fixture
def make_rtf():
    """Factory fixture: build a minimal .rtf at the given path."""
    return _make_rtf


@pytest.fixture
def make_epub():
    """Factory fixture: build a minimal .epub at the given path."""
    return _make_epub
