"""
test_extract_pdf.py — Tests for extract_pdf.py.

Covers wrapper logic (page parsing, path validation, exit codes, CLI surface).
Text extraction itself is delegated to pypdf and not re-tested here.
"""

from __future__ import annotations

import io
import sys
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import extract_pdf
from extract_pdf import _parse_pages, _safe_resolve, main


# ---------------------------------------------------------------------------
# Minimal valid PDF bytes — single blank page. pypdf can parse this; text
# extraction returns "" but the page count is 1, which is enough for the
# range-bound and exit-code tests below.
# ---------------------------------------------------------------------------

@pytest.fixture
def blank_pdf(tmp_path: Path) -> Path:
    """Write a one-page blank PDF using pypdf and return its path."""
    pypdf = pytest.importorskip("pypdf")
    writer = pypdf.PdfWriter()
    writer.add_blank_page(width=612, height=792)
    path = tmp_path / "blank.pdf"
    with path.open("wb") as fh:
        writer.write(fh)
    return path


# ---------------------------------------------------------------------------
# _parse_pages
# ---------------------------------------------------------------------------

class TestParsePages:
    def test_none_returns_none(self):
        assert _parse_pages(None, None) is None

    def test_single_page_via_page_arg(self):
        assert _parse_pages(None, 7) == (7, 7)

    def test_range_via_pages_arg(self):
        assert _parse_pages("12-34", None) == (12, 34)

    def test_single_page_range(self):
        assert _parse_pages("5-5", None) == (5, 5)

    def test_both_args_rejected(self):
        with pytest.raises(ValueError, match="not both"):
            _parse_pages("1-2", 3)

    def test_zero_page_rejected(self):
        with pytest.raises(ValueError, match=">= 1"):
            _parse_pages(None, 0)

    def test_missing_dash_rejected(self):
        with pytest.raises(ValueError, match="START-END"):
            _parse_pages("12", None)

    def test_non_integer_rejected(self):
        with pytest.raises(ValueError, match="integers"):
            _parse_pages("a-b", None)

    def test_reversed_range_rejected(self):
        with pytest.raises(ValueError, match="invalid page range"):
            _parse_pages("10-5", None)

    def test_zero_start_rejected(self):
        with pytest.raises(ValueError, match="invalid page range"):
            _parse_pages("0-5", None)


# ---------------------------------------------------------------------------
# _safe_resolve
# ---------------------------------------------------------------------------

class TestSafeResolve:
    def test_existing_file(self, tmp_path: Path):
        p = tmp_path / "x.pdf"
        p.write_bytes(b"%PDF-1.4\n")
        assert _safe_resolve(str(p)) == p.resolve()

    def test_missing_file_raises(self, tmp_path: Path):
        with pytest.raises(FileNotFoundError):
            _safe_resolve(str(tmp_path / "nope.pdf"))

    def test_directory_raises(self, tmp_path: Path):
        with pytest.raises(IsADirectoryError):
            _safe_resolve(str(tmp_path))


# ---------------------------------------------------------------------------
# main() CLI surface
# ---------------------------------------------------------------------------

class TestMainCLI:
    def _run(self, argv: list[str]) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = main(argv)
        return code, out.getvalue(), err.getvalue()

    def test_missing_file_exits_2(self, tmp_path: Path):
        code, _, err = self._run([str(tmp_path / "missing.pdf")])
        assert code == 2
        assert "file not found" in err

    def test_non_pdf_extension_exits_2(self, tmp_path: Path):
        f = tmp_path / "notes.txt"
        f.write_text("hi")
        code, _, err = self._run([str(f)])
        assert code == 2
        assert "not a .pdf" in err

    def test_bad_page_range_exits_2(self, blank_pdf: Path):
        code, _, err = self._run([str(blank_pdf), "--pages", "10-5"])
        assert code == 2
        assert "invalid page range" in err

    def test_both_page_args_exit_2(self, blank_pdf: Path):
        code, _, err = self._run(
            [str(blank_pdf), "--pages", "1-1", "--page", "1"]
        )
        assert code == 2
        assert "not both" in err

    def test_page_out_of_bounds_exits_2(self, blank_pdf: Path):
        code, _, err = self._run([str(blank_pdf), "--pages", "5-10"])
        assert code == 2
        assert "exceeds" in err

    def test_blank_pdf_succeeds_with_warning(self, blank_pdf: Path):
        # Blank PDF: extraction returns empty/near-empty text. Wrapper still
        # exits 0 but emits a "may be scanned" warning to stderr.
        code, out, err = self._run([str(blank_pdf)])
        assert code == 0
        assert "may be scanned" in err
        assert out.endswith("\n")

    def test_no_pdf_library_exits_3(self, blank_pdf: Path, monkeypatch):
        # Force every extractor to look uninstalled by making them raise
        # ImportError. The wrapper should surface exit 3 with an install hint.
        def fake_import_error(*_args, **_kwargs):
            raise ImportError("forced for test")

        monkeypatch.setattr(extract_pdf, "_extract_with_pypdf", fake_import_error)
        monkeypatch.setattr(extract_pdf, "_extract_with_pdfminer", fake_import_error)
        monkeypatch.setattr(extract_pdf, "_extract_with_pdfplumber", fake_import_error)

        code, _, err = self._run([str(blank_pdf)])
        assert code == 3
        assert "pip install pypdf" in err
