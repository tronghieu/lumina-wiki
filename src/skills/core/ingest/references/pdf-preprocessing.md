# PDF Preprocessing

Use this reference when `/lumi-ingest` receives a PDF or a source too large to
read comfortably in one pass.

## Extractor

Most non-Claude IDEs cannot read PDFs through their built-in file tool. Use the
bundled extractor:

```bash
python3 _lumina/tools/extract_pdf.py raw/sources/<file>.pdf
python3 _lumina/tools/extract_pdf.py raw/sources/<file>.pdf --pages 1-20
```

Claude Code can read PDFs natively; use the extractor when native PDF reading is
unavailable, unreliable, or when a page range is safer.

Two extra flags support the long-source pipeline:

```bash
python3 _lumina/tools/extract_pdf.py raw/sources/<file>.pdf --info
# → {"pages": N, "chars": M, "est_tokens": K} — size check, no text dump
python3 _lumina/tools/extract_pdf.py raw/sources/<file>.pdf --pages 9-34 --markers
# → page text prefixed with [[page N]] marker lines (absolute page numbers)
```

## Failures

- Exit 2 means an actionable user/input problem; report the message and stop.
- Exit 3 with a `pip install pypdf` hint means the dependency is missing; ask the
  user to run that exact command, then retry.
- A scanned/blank warning means text extraction likely failed. OCR is out of
  scope; ask the user to provide text or a text-based PDF.

## Large Sources

If `--info` reports `pages >= 50` or `est_tokens >= 50000`, do not summarize in
one pass — read fully and follow `./long-source.md` (multi-pass reading with
page-anchored notes under `wiki/readings/`). Smaller sources that still exceed
one comfortable read: extract in sections and checkpoint after each phase.
