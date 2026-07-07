"""
verify_quotes.py — Mechanically check quoted passages against a paged source.

Core tool used by /lumi-ingest (long-source reading notes) and the verify step:
scans markdown files for quotations that carry a page citation and confirms the
quoted words actually appear on the cited page of the source. Catches
fabricated quotes and off-by-a-page citations. It can only check quotes — it
cannot check paraphrase.

CLI:
    python verify_quotes.py --source <file.pdf|paged.txt> <note.md|dir> [...]

Arguments:
    --source PATH   The source document. A .pdf is extracted in-process with
                    [[page N]] markers (same extractors as extract_pdf.py).
                    Any other extension is treated as plain text that already
                    contains [[page N]] marker lines.
    targets         One or more markdown files, or directories searched
                    recursively for *.md files.

What counts as a checkable quote:
    - The line carries a page citation: (p. N), (pp. A-B), or (tr. N)
      ("tr." = "trang", Vietnamese for page).
    - The line contains a double-quoted span (straight or curly quotes) of at
      least 5 whitespace-separated words. Shorter spans are too generic to
      verify and are skipped. Lines inside fenced code blocks are skipped.

Matching is normalized substring search: lowercase, diacritics stripped,
punctuation removed, hyphens and whitespace folded. A quote found on the exact
cited page(s) is OK; found only within a +/-1 page window is NEAR (usually an
off-by-one citation); found in neither is FAIL. Whitespace-only languages are
assumed for word counting; CJK quotes may not reach the 5-word minimum.

Output (stdout, single JSON object):
    {
      "checked": <int>, "ok": <int>, "near": <int>, "fail": <int>,
      "results": [
        {"status": "OK|NEAR|FAIL", "file": "...", "line": <int>,
         "citation": "(p. 12)", "quote_head": "first eight words ..."}
      ]
    }

Exit codes:
    0  check ran to completion (even when fail > 0 — failures are findings
       for the calling skill to present, not tool errors)
    2  user error (missing/unreadable source or targets, no [[page N]] markers)
    3  internal error (PDF extraction failure)

Read-only: never writes to wiki/ or anywhere else.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

MIN_QUOTE_WORDS = 5
QUOTE_HEAD_WORDS = 8

PAGE_MARKER_RE = re.compile(r"^\[\[page (\d+)\]\]\s*$")
CITATION_RE = re.compile(r"\((?:pp?|tr)\.\s*(\d+)(?:-(\d+))?\)")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
# Straight or curly double quotes; span must not cross a quote character.
QUOTED_SPAN_RE = re.compile(r'["“”]([^"“”]+)["“”]')

_DASH_FOLD = str.maketrans({
    "‘": "'", "’": "'",
    "–": "-", "—": "-",
    "đ": "d", "Đ": "d",  # đ/Đ do not decompose under NFD
})
_KEEP_RE = re.compile(r"[^a-z0-9 ]+")


def normalize(text: str) -> str:
    """Lowercase, strip diacritics/punctuation, fold hyphens and whitespace."""
    text = text.translate(_DASH_FOLD)
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("-", " ")
    text = _KEEP_RE.sub(" ", text)
    return " ".join(text.split())


def parse_paged_text(text: str) -> dict[int, str]:
    """Split text on [[page N]] marker lines into {page_number: page_text}."""
    pages: dict[int, str] = {}
    current: int | None = None
    buf: list[str] = []
    for line in text.splitlines():
        m = PAGE_MARKER_RE.match(line)
        if m:
            if current is not None:
                pages[current] = "\n".join(buf)
            current = int(m.group(1))
            buf = []
        elif current is not None:
            buf.append(line)
    if current is not None:
        pages[current] = "\n".join(buf)
    return pages


def load_source_pages(source: Path) -> dict[int, str]:
    if source.suffix.lower() == ".pdf":
        sys.path.insert(0, str(Path(__file__).parent))
        import extract_pdf  # noqa: PLC0415 — sibling tool, lazy by design

        text = extract_pdf.extract(source, None, markers=True)
    else:
        text = source.read_text(encoding="utf-8", errors="replace")
    pages = parse_paged_text(text)
    if not pages:
        raise ValueError(
            f"no [[page N]] markers found in {source.name}; "
            "generate paged text with extract_pdf.py --markers"
        )
    return pages


def collect_md_files(targets: list[str]) -> list[Path]:
    files: list[Path] = []
    for t in targets:
        p = Path(t)
        if p.is_dir():
            files.extend(sorted(p.rglob("*.md")))
        elif p.is_file():
            files.append(p)
        else:
            raise FileNotFoundError(f"target not found: {t}")
    return files


def extract_checkable_quotes(md_text: str) -> list[tuple[int, str, int, int, str]]:
    """Return (line_number, citation, page_lo, page_hi, quote) tuples."""
    out: list[tuple[int, str, int, int, str]] = []
    lines = md_text.splitlines()
    body_start = 0
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                body_start = i + 1
                break
    in_fence = False
    for lineno, line in enumerate(lines[body_start:], start=body_start + 1):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        cite = CITATION_RE.search(line)
        if not cite:
            continue
        lo = int(cite.group(1))
        hi = int(cite.group(2)) if cite.group(2) else lo
        if hi < lo:
            lo, hi = hi, lo
        for span in QUOTED_SPAN_RE.finditer(line):
            quote = span.group(1).strip()
            if len(quote.split()) >= MIN_QUOTE_WORDS:
                out.append((lineno, cite.group(0), lo, hi, quote))
    return out


def page_blob(pages: dict[int, str], lo: int, hi: int) -> str:
    return normalize(" ".join(pages.get(n, "") for n in range(lo, hi + 1)))


def check_files(pages: dict[int, str], files: list[Path], root: Path) -> dict:
    results = []
    counts = {"checked": 0, "ok": 0, "near": 0, "fail": 0}
    for f in files:
        text = f.read_text(encoding="utf-8", errors="replace")
        for lineno, citation, lo, hi, quote in extract_checkable_quotes(text):
            counts["checked"] += 1
            needle = normalize(quote)
            if needle and needle in page_blob(pages, lo, hi):
                status = "OK"
                counts["ok"] += 1
            elif needle and needle in page_blob(pages, lo - 1, hi + 1):
                status = "NEAR"
                counts["near"] += 1
            else:
                status = "FAIL"
                counts["fail"] += 1
            try:
                rel = str(f.resolve().relative_to(root))
            except ValueError:
                rel = str(f)
            head = " ".join(quote.split()[:QUOTE_HEAD_WORDS])
            results.append({
                "status": status,
                "file": rel,
                "line": lineno,
                "citation": citation,
                "quote_head": head,
            })
    return {**counts, "results": results}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="verify_quotes.py",
        description="Check page-cited quotes in markdown files against a paged source.",
    )
    parser.add_argument("--source", required=True,
                        help="source document: .pdf, or text with [[page N]] markers")
    parser.add_argument("targets", nargs="+",
                        help="markdown files or directories to check")
    args = parser.parse_args(argv)

    source = Path(args.source)
    if not source.is_file():
        print(f"error: source not found: {args.source}", file=sys.stderr)
        return 2

    try:
        pages = load_source_pages(source)
        files = collect_md_files(args.targets)
    except (FileNotFoundError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except RuntimeError as e:  # extract_pdf: no PDF library available
        print(f"error: {e}", file=sys.stderr)
        return 3
    except Exception as e:  # noqa: BLE001 — surface extraction failures
        print(f"error: failed to read source: {e}", file=sys.stderr)
        return 3

    report = check_files(pages, files, Path.cwd())
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
