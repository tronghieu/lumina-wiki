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

## Failures

- Exit 2 means an actionable user/input problem; report the message and stop.
- Exit 3 with a `pip install pypdf` hint means the dependency is missing; ask the
  user to run that exact command, then retry.
- A scanned/blank warning means text extraction likely failed. OCR is out of
  scope; ask the user to provide text or a text-based PDF.

## Large Sources

For long PDFs, extract and ingest in sections. Checkpoint after each major phase
so a later interruption can resume without rereading the whole file.
