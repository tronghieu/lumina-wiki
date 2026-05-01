"""
extract_pdf.py — Extract plain text from a PDF file.

Self-contained core tool: takes a PDF path, prints extracted text to stdout.
Used by /lumi-ingest and /lumi-chapter-ingest in IDEs whose Read tool cannot
parse PDFs natively (Codex, Gemini CLI, Cursor, generic AGENTS.md hosts).

CLI:
    python extract_pdf.py <file> [--pages START-END] [--page N]

Options:
    --pages START-END   1-based inclusive range, e.g. --pages 12-34
    --page N            Single page (alias for --pages N-N)

Output:
    stdout — extracted plain text, pages separated by a form-feed (\\f).
    stderr — warnings (missing libs, scanned-PDF heuristic, etc.)

Exit codes:
    0  success
    2  user error (file not found, bad page range, path traversal)
    3  internal error (no PDF library available, parse failure)

Library priority:
    1. pypdf       (declared dep in requirements.txt; pure Python)
    2. pdfminer.six (optional fallback; better layout)
    3. pdfplumber   (optional fallback; built on pdfminer)

If none are importable, exit 3 with the install hint:
    pip install pypdf
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


PAGE_SEPARATOR = "\f"
SCANNED_THRESHOLD_CHARS_PER_PAGE = 32


def _parse_pages(spec: str | None, single: int | None) -> tuple[int, int] | None:
    if single is not None and spec is not None:
        raise ValueError("Use --pages or --page, not both")
    if single is not None:
        if single < 1:
            raise ValueError(f"page number must be >= 1, got {single}")
        return (single, single)
    if spec is None:
        return None
    if "-" not in spec:
        raise ValueError(f"--pages expects START-END, got {spec!r}")
    start_str, end_str = spec.split("-", 1)
    try:
        start, end = int(start_str), int(end_str)
    except ValueError as e:
        raise ValueError(f"--pages expects integers, got {spec!r}") from e
    if start < 1 or end < start:
        raise ValueError(f"invalid page range {spec!r}")
    return (start, end)


def _safe_resolve(path_arg: str) -> Path:
    """Resolve to an absolute path, refusing obvious traversal tricks."""
    p = Path(path_arg)
    resolved = p.resolve()
    if not resolved.exists():
        raise FileNotFoundError(f"file not found: {path_arg}")
    if not resolved.is_file():
        raise IsADirectoryError(f"not a file: {path_arg}")
    return resolved


def _extract_with_pypdf(path: Path, page_range: tuple[int, int] | None) -> list[str]:
    from pypdf import PdfReader  # type: ignore[import-not-found]

    reader = PdfReader(str(path))
    total = len(reader.pages)
    start, end = page_range if page_range else (1, total)
    if page_range and end > total:
        raise ValueError(f"page range {start}-{end} exceeds {total}-page document")
    return [reader.pages[i - 1].extract_text() or "" for i in range(start, end + 1)]


def _extract_with_pdfminer(path: Path, page_range: tuple[int, int] | None) -> list[str]:
    from pdfminer.high_level import extract_text  # type: ignore[import-not-found]

    if page_range:
        start, end = page_range
        page_numbers = list(range(start - 1, end))
        text = extract_text(str(path), page_numbers=page_numbers)
    else:
        text = extract_text(str(path))
    return [text]


def _extract_with_pdfplumber(path: Path, page_range: tuple[int, int] | None) -> list[str]:
    import pdfplumber  # type: ignore[import-not-found]

    with pdfplumber.open(str(path)) as pdf:
        total = len(pdf.pages)
        start, end = page_range if page_range else (1, total)
        if page_range and end > total:
            raise ValueError(f"page range {start}-{end} exceeds {total}-page document")
        return [pdf.pages[i - 1].extract_text() or "" for i in range(start, end + 1)]


def _try_extractors(path: Path, page_range: tuple[int, int] | None) -> list[str]:
    extractors = (
        ("pypdf", _extract_with_pypdf),
        ("pdfminer.six", _extract_with_pdfminer),
        ("pdfplumber", _extract_with_pdfplumber),
    )
    last_import_error: ImportError | None = None
    for name, fn in extractors:
        try:
            return fn(path, page_range)
        except ImportError as e:
            last_import_error = e
            continue
    msg = (
        "no PDF extraction library available. Install pypdf:\n"
        "    pip install pypdf"
    )
    if last_import_error:
        msg += f"\n(last import error: {last_import_error})"
    raise RuntimeError(msg)


def extract(path: Path, page_range: tuple[int, int] | None) -> str:
    pages = _try_extractors(path, page_range)
    text = PAGE_SEPARATOR.join(pages)
    total_chars = sum(len(p) for p in pages)
    if pages and total_chars / max(len(pages), 1) < SCANNED_THRESHOLD_CHARS_PER_PAGE:
        print(
            f"warning: extracted only {total_chars} chars across {len(pages)} page(s); "
            "PDF may be scanned/image-based — paste the text manually if needed.",
            file=sys.stderr,
        )
    return text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="extract_pdf.py",
        description="Extract plain text from a PDF file.",
    )
    parser.add_argument("file", help="path to the PDF file")
    parser.add_argument("--pages", help="1-based inclusive range, e.g. 12-34")
    parser.add_argument("--page", type=int, help="single page number (1-based)")
    args = parser.parse_args(argv)

    try:
        page_range = _parse_pages(args.pages, args.page)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    try:
        path = _safe_resolve(args.file)
    except (FileNotFoundError, IsADirectoryError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    if path.suffix.lower() != ".pdf":
        print(f"error: not a .pdf file: {path.name}", file=sys.stderr)
        return 2

    try:
        text = extract(path, page_range)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        return 3
    except Exception as e:  # noqa: BLE001 — surface any parse failure to user
        print(f"error: failed to extract PDF text: {e}", file=sys.stderr)
        return 3

    sys.stdout.write(text)
    if not text.endswith("\n"):
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
