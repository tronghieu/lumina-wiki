"""
prepare_source.py — Normalize a local file into an ingest-ready package.

Accepts one local file (PDF, .tex, .html, .md) and produces a deterministic
output package at raw/tmp/<slug>/ containing:
    source.<ext>   — original file (hard-link or copy)
    meta.json      — extracted metadata (title, type, sha256, ext, slug, size)
    text.txt       — extracted plain text

The slug is derived from the SHA256 hash of the source file content so the
same input always produces the same slug and byte-identical output. Running
twice with the same input is a no-op (idempotent).

CLI:
    python prepare_source.py <file> [--out-dir PATH] [--project-root PATH]

Output (stdout, single JSON object):
    {
      "slug": "<sha256-prefix>",
      "source": "<original-filename>",
      "ext": "<.pdf|.tex|.html|.md|...>",
      "sha256": "<hex>",
      "out_dir": "<absolute-path-to-raw/tmp/<slug>>",
      "meta_path": "<absolute-path-to-meta.json>",
      "text_path": "<absolute-path-to-text.txt>",
      "text_length": <int>
    }

Exit codes:
    0  success
    2  user error (file not found, unsupported ext, path traversal) — actionable
    3  internal error (extraction failure, I/O error) — retry hint

Writes to raw/tmp/ (or --out-dir). Never writes to wiki/.
All writes are atomic (temp + fsync + rename).

Text extraction:
    .pdf  — tries pdfminer.six if available; falls back to pdfplumber; falls
            back to extracting raw bytes with a notice on stderr.
    .tex  — strips LaTeX commands (regex-based) to produce plain text.
    .html — uses html.parser (stdlib) to strip tags.
    .md   — kept as-is (markdown is plain text).
    other — treated as UTF-8 text; binary files will produce garbled output
            with a warning on stderr.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SUPPORTED_EXTENSIONS = {".pdf", ".tex", ".html", ".htm", ".md", ".txt"}
# Slug is the first 16 hex chars of the file's SHA256 — enough uniqueness.
SLUG_LENGTH = 16


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _sha256_file(path: Path) -> str:
    """Compute the SHA256 hex digest of a file (streaming, low memory)."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _safe_path(base: Path, rel: Path, label: str) -> Path:
    """Resolve rel under base; reject '..', absolute, or escaping paths."""
    if rel.is_absolute():
        _err(f"Error: {label} must be a relative path, got: {rel}")
        sys.exit(2)
    if ".." in rel.parts:
        _err(f"Error: {label} contains '..': {rel}")
        sys.exit(2)
    resolved = (base / rel).resolve()
    try:
        resolved.relative_to(base.resolve())
    except ValueError:
        _err(f"Error: {label} escapes base directory: {rel}")
        sys.exit(2)
    return resolved


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write bytes atomically to path (temp + fsync + replace)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    os.replace(tmp, path)


def _atomic_copy_file(src: Path, dest: Path) -> None:
    """Copy a file atomically without loading it fully into memory."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=dest.parent, suffix=".tmp")
    try:
        with src.open("rb") as fsrc, os.fdopen(fd, "wb") as fdst:
            shutil.copyfileobj(fsrc, fdst, length=1024 * 1024)
            fdst.flush()
            os.fsync(fdst.fileno())
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    os.replace(tmp, dest)


def _atomic_write_text(path: Path, text: str) -> None:
    """Write text (UTF-8) atomically to path."""
    _atomic_write_bytes(path, text.encode("utf-8"))


def _atomic_write_json(path: Path, data: Any) -> None:
    """Write JSON atomically to path."""
    _atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------

def _extract_pdf_text(path: Path) -> str:
    """Extract text from a PDF file.

    Tries pdfminer.six first, then pdfplumber. Falls back to empty string
    with a warning if neither is installed.
    """
    # Try pdfminer.six
    try:
        from pdfminer.high_level import extract_text as pdfminer_extract  # type: ignore[import-untyped]
        text = pdfminer_extract(str(path))
        return text or ""
    except ImportError:
        pass

    # Try pdfplumber
    try:
        import pdfplumber  # type: ignore[import-untyped]
        with pdfplumber.open(str(path)) as pdf:
            pages = []
            for page in pdf.pages:
                t = page.extract_text() or ""
                pages.append(t)
        return "\n\n".join(pages)
    except ImportError:
        pass

    _err(
        "Warning: no PDF extraction library found. "
        "Install pdfminer.six: pip install pdfminer.six"
    )
    return ""


def _extract_tex_text(path: Path) -> str:
    """Extract plain text from a LaTeX .tex file by stripping commands."""
    import re
    try:
        src = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise ValueError(f"Cannot read .tex file: {exc}") from exc

    # Remove comments
    src = re.sub(r"%.*$", "", src, flags=re.MULTILINE)
    # Remove \command{...} and \command[...]{...}
    src = re.sub(r"\\[a-zA-Z]+\*?\[[^\]]*\]\{[^}]*\}", " ", src)
    src = re.sub(r"\\[a-zA-Z]+\*?\{[^}]*\}", " ", src)
    # Remove remaining backslash commands
    src = re.sub(r"\\[a-zA-Z]+\*?", " ", src)
    # Remove curly braces
    src = src.replace("{", " ").replace("}", " ")
    # Collapse whitespace
    src = re.sub(r"\n{3,}", "\n\n", src)
    src = re.sub(r" {2,}", " ", src)
    return src.strip()


def _extract_html_text(path: Path) -> str:
    """Extract plain text from an HTML file using stdlib html.parser."""
    from html.parser import HTMLParser

    class _TextExtractor(HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self._parts: list[str] = []
            self._skip = False

        def handle_starttag(self, tag: str, attrs: Any) -> None:  # noqa: ARG002
            if tag in ("script", "style", "head"):
                self._skip = True

        def handle_endtag(self, tag: str) -> None:
            if tag in ("script", "style", "head"):
                self._skip = False

        def handle_data(self, data: str) -> None:
            if not self._skip:
                stripped = data.strip()
                if stripped:
                    self._parts.append(stripped)

        def get_text(self) -> str:
            return "\n".join(self._parts)

    try:
        src = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise ValueError(f"Cannot read HTML file: {exc}") from exc

    extractor = _TextExtractor()
    extractor.feed(src)
    return extractor.get_text()


def _extract_text(path: Path) -> str:
    """Dispatch text extraction by file extension."""
    ext = path.suffix.lower()
    if ext == ".pdf":
        return _extract_pdf_text(path)
    if ext == ".tex":
        return _extract_tex_text(path)
    if ext in (".html", ".htm"):
        return _extract_html_text(path)
    # .md, .txt, and other text files — read as UTF-8
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise ValueError(f"Cannot read file: {exc}") from exc


# ---------------------------------------------------------------------------
# Package builder
# ---------------------------------------------------------------------------

def prepare_source(
    source_file: Path,
    out_base: Path,
) -> dict[str, Any]:
    """Normalize a local source file into an ingest-ready package.

    Args:
        source_file: Absolute path to the source file.
        out_base: Base directory for output packages (e.g. raw/tmp/).

    Returns:
        Result dict matching the CLI JSON output schema.

    Raises:
        ValueError: on unsupported extension or extraction failure.
        OSError: on I/O failure.
    """
    if not source_file.exists():
        raise ValueError(f"File not found: {source_file}")

    ext = source_file.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file extension '{ext}'. "
            f"Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )

    sha256 = _sha256_file(source_file)
    slug = sha256[:SLUG_LENGTH]
    out_dir = out_base / slug

    # Deterministic: if output already exists with same hash, it's a no-op.
    existing_meta = out_dir / "meta.json"
    if existing_meta.exists():
        try:
            meta = json.loads(existing_meta.read_text(encoding="utf-8"))
            if meta.get("sha256") == sha256:
                # Package already up-to-date — return existing result.
                text_path = out_dir / "text.txt"
                text_length = len(text_path.read_text(encoding="utf-8")) if text_path.exists() else 0
                return {
                    "slug": slug,
                    "source": source_file.name,
                    "ext": ext,
                    "sha256": sha256,
                    "out_dir": str(out_dir),
                    "meta_path": str(existing_meta),
                    "text_path": str(text_path),
                    "text_length": text_length,
                }
        except (json.JSONDecodeError, OSError):
            pass  # Rebuild on read error

    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Copy source file
    source_dest = out_dir / f"source{ext}"
    _atomic_copy_file(source_file, source_dest)

    # 2. Extract text
    try:
        text = _extract_text(source_file)
    except ValueError as exc:
        raise ValueError(f"Text extraction failed: {exc}") from exc

    text_path = out_dir / "text.txt"
    _atomic_write_text(text_path, text)

    # 3. Write meta.json
    meta: dict[str, Any] = {
        "slug": slug,
        "title": source_file.stem,
        "type": _guess_type(ext),
        "sha256": sha256,
        "ext": ext,
        "original_filename": source_file.name,
        "size_bytes": source_file.stat().st_size,
        "text_length": len(text),
    }
    meta_path = out_dir / "meta.json"
    _atomic_write_json(meta_path, meta)

    return {
        "slug": slug,
        "source": source_file.name,
        "ext": ext,
        "sha256": sha256,
        "out_dir": str(out_dir),
        "meta_path": str(meta_path),
        "text_path": str(text_path),
        "text_length": len(text),
    }


def _guess_type(ext: str) -> str:
    """Map file extension to a Lumina source type hint."""
    return {
        ".pdf": "pdf",
        ".tex": "latex",
        ".html": "webpage",
        ".htm": "webpage",
        ".md": "markdown",
        ".txt": "text",
    }.get(ext, "unknown")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="prepare_source.py",
        description=(
            "Normalize a local file (PDF, .tex, .html, .md) into an ingest-ready "
            "package under raw/tmp/<slug>/. Deterministic: same input -> same output."
        ),
    )
    parser.add_argument("file", help="Path to the source file to prepare.")
    parser.add_argument(
        "--out-dir", default=None,
        help="Output base directory (default: <project-root>/raw/tmp).",
    )
    parser.add_argument(
        "--project-root", default=None,
        help="Project root (default: current directory).",
    )

    args = parser.parse_args(argv)

    project_root = Path(args.project_root).resolve() if args.project_root else Path.cwd().resolve()
    out_base = Path(args.out_dir).resolve() if args.out_dir else project_root / "raw" / "tmp"

    # Validate source file path
    source_file = Path(args.file)
    if ".." in source_file.parts:
        _err(f"Error: file path contains '..': {args.file}")
        sys.exit(2)
    source_file = source_file.resolve()

    if not source_file.exists():
        _err(f"Error: file not found: {source_file}")
        _err("Check the path and try again.")
        sys.exit(2)

    if not source_file.is_file():
        _err(f"Error: not a file: {source_file}")
        sys.exit(2)

    ext = source_file.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        _err(
            f"Error: unsupported file extension '{ext}'. "
            f"Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )
        sys.exit(2)

    try:
        result = prepare_source(source_file, out_base)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(0)
    except ValueError as exc:
        _err(f"Error: {exc}")
        sys.exit(2)
    except OSError as exc:
        _err(f"I/O error: {exc}")
        _err("Retry hint: check disk space and file permissions.")
        sys.exit(3)
    except Exception as exc:  # noqa: BLE001
        _err(f"Internal error: {exc}")
        sys.exit(3)


if __name__ == "__main__":
    main()
