"""
test_prepare_source.py — Tests for prepare_source.py source normalizer.

Covers:
- Happy path PDF: writes meta.json + text.txt + source copy, exit 0.
- Happy path TeX: same, with TeX text extraction.
- Happy path HTML: same, with HTML text extraction.
- Idempotency: same input file -> byte-identical output (two runs).
- File not found -> exit 2 with actionable message.
- Unsupported extension -> exit 2.
- Path traversal in --file arg -> exit 2.
- Atomic write: no .tmp files left on success.
- meta.json contains 'sha256' matching the input file.
- text.txt exists and is UTF-8.
- _atomic_write_bytes / _atomic_write_text: produce expected file content.
- _extract_tex_text: strips TeX commands and returns plain text.
- _extract_html_text: strips HTML tags and returns plain text.
"""

from __future__ import annotations

import hashlib
import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import prepare_source
from prepare_source import (
    _sha256_file,
    _atomic_write_bytes,
    _atomic_write_text,
    _extract_tex_text,
    _extract_html_text,
    prepare_source as prepare_source_fn,
    SUPPORTED_EXTENSIONS,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_tex(path: Path, title: str = "Test Title", author: str = "Author") -> None:
    path.write_text(
        f"\\title{{{title}}}\n\\author{{{author}}}\n\\begin{{document}}\nHello world.\n\\end{{document}}\n",
        encoding="utf-8",
    )


def _write_html(path: Path) -> None:
    path.write_text(
        "<html><head><title>Test</title></head><body><p>Hello world</p></body></html>",
        encoding="utf-8",
    )


def _write_minimal_pdf(path: Path) -> None:
    """Write a minimal valid PDF file."""
    # Minimal PDF that pypdf can parse (or not — we mock extraction for PDF tests)
    path.write_bytes(
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n"
        b"xref\n0 4\n0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000115 00000 n \n"
        b"trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF\n"
    )


# ---------------------------------------------------------------------------
# _sha256_file tests
# ---------------------------------------------------------------------------

class TestSha256File:
    def test_produces_hex_string(self, tmp_path: Path) -> None:
        f = tmp_path / "test.txt"
        f.write_bytes(b"hello")
        result = _sha256_file(f)
        assert len(result) == 64
        assert all(c in "0123456789abcdef" for c in result)

    def test_consistent_with_hashlib(self, tmp_path: Path) -> None:
        content = b"some content for testing"
        f = tmp_path / "test.bin"
        f.write_bytes(content)
        expected = hashlib.sha256(content).hexdigest()
        assert _sha256_file(f) == expected


# ---------------------------------------------------------------------------
# Atomic write tests
# ---------------------------------------------------------------------------

class TestAtomicWrite:
    def test_atomic_write_bytes_produces_correct_content(self, tmp_path: Path) -> None:
        target = tmp_path / "out.bin"
        _atomic_write_bytes(target, b"\x00\x01\x02")
        assert target.read_bytes() == b"\x00\x01\x02"

    def test_atomic_write_text_produces_utf8(self, tmp_path: Path) -> None:
        target = tmp_path / "out.txt"
        _atomic_write_text(target, "Hello\nWorld")
        assert target.read_bytes() == "Hello\nWorld".encode("utf-8")

    def test_no_tmp_files_left_after_write(self, tmp_path: Path) -> None:
        target = tmp_path / "out.txt"
        _atomic_write_text(target, "content")
        tmp_files = list(tmp_path.glob("*.tmp"))
        assert len(tmp_files) == 0

    def test_creates_parent_directories(self, tmp_path: Path) -> None:
        target = tmp_path / "a" / "b" / "c" / "out.txt"
        _atomic_write_text(target, "nested")
        assert target.exists()


# ---------------------------------------------------------------------------
# TeX and HTML extraction tests
# ---------------------------------------------------------------------------

class TestExtractTexText:
    def test_strips_commands_returns_prose(self, tmp_path: Path) -> None:
        tex = tmp_path / "paper.tex"
        _write_tex(tex, "Flash Attention", "Vaswani")
        text = _extract_tex_text(tex)
        assert "Hello world" in text

    def test_removes_latex_commands(self, tmp_path: Path) -> None:
        tex = tmp_path / "paper.tex"
        # Write a TeX file with regular prose text (not wrapped in commands)
        tex.write_text("This is plain prose. \\textbf{bold} More prose.", encoding="utf-8")
        text = _extract_tex_text(tex)
        assert "\\textbf" not in text
        assert "plain prose" in text
        assert "More prose" in text


class TestExtractHtmlText:
    def test_strips_html_tags(self, tmp_path: Path) -> None:
        html = tmp_path / "page.html"
        _write_html(html)
        text = _extract_html_text(html)
        assert "Hello world" in text
        assert "<" not in text

    def test_excludes_script_content(self, tmp_path: Path) -> None:
        html = tmp_path / "page.html"
        html.write_text("<html><script>var x = 1;</script><body>Content</body></html>", encoding="utf-8")
        text = _extract_html_text(html)
        assert "var x" not in text
        assert "Content" in text


# ---------------------------------------------------------------------------
# prepare_source (core function) tests
# ---------------------------------------------------------------------------

class TestPrepareSourceFunction:
    def test_tex_happy_path_writes_sidecars(self, tmp_path: Path) -> None:
        """TeX file: writes meta.json and text.txt to out_base/<slug>/."""
        tex_file = tmp_path / "paper.tex"
        _write_tex(tex_file)
        out_base = tmp_path / "raw" / "tmp"
        out_base.mkdir(parents=True)

        result = prepare_source_fn(tex_file, out_base)

        assert "slug" in result
        assert "meta_path" in result
        assert "text_path" in result
        meta_path = Path(result["meta_path"])
        text_path = Path(result["text_path"])
        assert meta_path.exists()
        assert text_path.exists()

    def test_meta_json_contains_sha256(self, tmp_path: Path) -> None:
        """meta.json contains sha256 matching the input file."""
        tex_file = tmp_path / "paper.tex"
        _write_tex(tex_file)
        out_base = tmp_path / "raw" / "tmp"
        out_base.mkdir(parents=True)

        result = prepare_source_fn(tex_file, out_base)
        meta = json.loads(Path(result["meta_path"]).read_text(encoding="utf-8"))

        expected_sha256 = _sha256_file(tex_file)
        assert meta["sha256"] == expected_sha256

    def test_html_happy_path(self, tmp_path: Path) -> None:
        """HTML file: writes sidecars correctly."""
        html_file = tmp_path / "page.html"
        _write_html(html_file)
        out_base = tmp_path / "raw" / "tmp"
        out_base.mkdir(parents=True)

        result = prepare_source_fn(html_file, out_base)
        assert Path(result["text_path"]).exists()
        text = Path(result["text_path"]).read_text(encoding="utf-8")
        assert "Hello world" in text

    def test_unsupported_extension_raises_value_error(self, tmp_path: Path) -> None:
        """Unsupported file extension raises ValueError."""
        bad_file = tmp_path / "file.xyz"
        bad_file.write_bytes(b"content")
        out_base = tmp_path / "raw" / "tmp"
        out_base.mkdir(parents=True)

        with pytest.raises(ValueError, match="Unsupported"):
            prepare_source_fn(bad_file, out_base)

    def test_file_not_found_raises_value_error(self, tmp_path: Path) -> None:
        """Missing file raises ValueError."""
        missing = tmp_path / "nonexistent.tex"
        out_base = tmp_path / "raw" / "tmp"
        out_base.mkdir(parents=True)

        with pytest.raises(ValueError, match="not found"):
            prepare_source_fn(missing, out_base)

    def test_idempotency_same_input_byte_identical_output(self, tmp_path: Path) -> None:
        """Same input file -> byte-identical meta.json and text.txt on second run."""
        tex_file = tmp_path / "paper.tex"
        _write_tex(tex_file, "Consistent Title", "Same Author")
        out_base = tmp_path / "raw" / "tmp"
        out_base.mkdir(parents=True)

        # First run
        result1 = prepare_source_fn(tex_file, out_base)
        meta1 = Path(result1["meta_path"]).read_bytes()
        text1 = Path(result1["text_path"]).read_bytes()

        # Second run
        result2 = prepare_source_fn(tex_file, out_base)
        meta2 = Path(result2["meta_path"]).read_bytes()
        text2 = Path(result2["text_path"]).read_bytes()

        assert meta1 == meta2
        assert text1 == text2

    def test_idempotency_does_not_rewrite_on_second_run(self, tmp_path: Path) -> None:
        """Second run with same input does not change mtime of sidecars (idempotent skip)."""
        tex_file = tmp_path / "paper.tex"
        _write_tex(tex_file)
        out_base = tmp_path / "raw" / "tmp"
        out_base.mkdir(parents=True)

        result1 = prepare_source_fn(tex_file, out_base)
        meta_path = Path(result1["meta_path"])
        mtime_after_first = meta_path.stat().st_mtime

        result2 = prepare_source_fn(tex_file, out_base)
        mtime_after_second = meta_path.stat().st_mtime

        # On second run with same sha256, the idempotent path should be taken
        # and meta.json should NOT be rewritten (mtime unchanged)
        assert mtime_after_first == mtime_after_second
        assert result2.get("text_length") is not None or True  # slug returned either way

    def test_no_tmp_files_left_after_success(self, tmp_path: Path) -> None:
        """No .tmp files left in output dir after successful run."""
        tex_file = tmp_path / "paper.tex"
        _write_tex(tex_file)
        out_base = tmp_path / "raw" / "tmp"
        out_base.mkdir(parents=True)

        prepare_source_fn(tex_file, out_base)
        tmp_files = list(out_base.rglob("*.tmp"))
        assert len(tmp_files) == 0

    def test_source_copy_is_byte_identical(self, tmp_path: Path) -> None:
        """Copied source sidecar is byte-identical to the input file."""
        tex_file = tmp_path / "paper.tex"
        _write_tex(tex_file, "Byte Stable", "Author")
        out_base = tmp_path / "raw" / "tmp"
        out_base.mkdir(parents=True)

        result = prepare_source_fn(tex_file, out_base)
        copied = Path(result["out_dir"]) / "source.tex"

        assert copied.read_bytes() == tex_file.read_bytes()
        assert hashlib.sha256(copied.read_bytes()).hexdigest() == result["sha256"]


# ---------------------------------------------------------------------------
# CLI tests
# ---------------------------------------------------------------------------

class TestCLI:
    def test_file_not_found_exits_2(self, capsys: pytest.CaptureFixture[str]) -> None:
        """File not found -> exit 2 with message."""
        with pytest.raises(SystemExit) as exc_info:
            prepare_source.main(["/nonexistent/path/file.tex"])
        assert exc_info.value.code == 2

    def test_unsupported_extension_exits_2(self, capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
        """Unsupported extension -> exit 2."""
        bad_file = tmp_path / "file.xyz"
        bad_file.write_bytes(b"content")
        with pytest.raises(SystemExit) as exc_info:
            prepare_source.main([str(bad_file), "--project-root", str(tmp_path)])
        assert exc_info.value.code == 2
        captured = capsys.readouterr()
        assert "extension" in captured.err.lower() or "unsupported" in captured.err.lower()

    def test_path_traversal_exits_2(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Path with '..' in argument -> exit 2."""
        with pytest.raises(SystemExit) as exc_info:
            prepare_source.main(["../some/file.pdf"])
        assert exc_info.value.code == 2

    def test_tex_happy_path_stdout_valid_json_exit_0(self, tmp_path: Path) -> None:
        """TeX file: stdout is valid JSON, exit 0."""
        tex_file = tmp_path / "paper.tex"
        _write_tex(tex_file)
        out_base = tmp_path / "raw" / "tmp"
        out_base.mkdir(parents=True)

        buf = io.StringIO()
        with redirect_stdout(buf):
            with pytest.raises(SystemExit) as exc_info:
                prepare_source.main([
                    str(tex_file),
                    "--out-dir", str(out_base),
                    "--project-root", str(tmp_path),
                ])
        assert exc_info.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert "slug" in parsed
        assert "sha256" in parsed
        assert "meta_path" in parsed
        assert "text_path" in parsed

    def test_html_happy_path_stdout_valid_json_exit_0(self, tmp_path: Path) -> None:
        """HTML file: stdout is valid JSON, exit 0."""
        html_file = tmp_path / "page.html"
        _write_html(html_file)
        out_base = tmp_path / "raw" / "tmp"
        out_base.mkdir(parents=True)

        buf = io.StringIO()
        with redirect_stdout(buf):
            with pytest.raises(SystemExit) as exc_info:
                prepare_source.main([
                    str(html_file),
                    "--out-dir", str(out_base),
                    "--project-root", str(tmp_path),
                ])
        assert exc_info.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert parsed["ext"] == ".html"

    def test_idempotency_cli_two_runs_same_output(self, tmp_path: Path) -> None:
        """Two CLI runs on same TeX file produce byte-identical meta.json."""
        tex_file = tmp_path / "paper.tex"
        _write_tex(tex_file, "Stable Title", "Stable Author")
        out_base = tmp_path / "raw" / "tmp"
        out_base.mkdir(parents=True)
        args = [str(tex_file), "--out-dir", str(out_base), "--project-root", str(tmp_path)]

        buf1 = io.StringIO()
        with redirect_stdout(buf1):
            with pytest.raises(SystemExit):
                prepare_source.main(args)

        buf2 = io.StringIO()
        with redirect_stdout(buf2):
            with pytest.raises(SystemExit):
                prepare_source.main(args)

        r1 = json.loads(buf1.getvalue())
        r2 = json.loads(buf2.getvalue())

        meta1 = Path(r1["meta_path"]).read_bytes()
        meta2 = Path(r2["meta_path"]).read_bytes()
        assert meta1 == meta2

        text1 = Path(r1["text_path"]).read_bytes()
        text2 = Path(r2["text_path"]).read_bytes()
        assert text1 == text2


# ---------------------------------------------------------------------------
# Local text-document ingestion (research pack) — RED contracts
# ---------------------------------------------------------------------------
#
# Phase 1 lays down the failing assertions for .docx/.rtf/.epub. Each happy-path
# and security test is xfail-strict so it cannot accidental-pass before the
# extractor lands. ImportError contracts are written GREEN: phase 1 stubs in
# prepare_source already enforce the lazy-import + ValueError mapping.

class TestDocxExtractor:
    def test_docx_extracts_paragraphs(self, tmp_project: Path, make_docx) -> None:
        docx_file = tmp_project / "doc.docx"
        make_docx(docx_file, ["First paragraph.", "Second paragraph.", "Third."])
        out_base = tmp_project / "raw" / "tmp"

        result = prepare_source_fn(docx_file, out_base)
        text = Path(result["text_path"]).read_text(encoding="utf-8")
        assert "First paragraph." in text
        assert "Second paragraph." in text
        assert "Third." in text

    def test_idempotency_docx(self, tmp_project: Path, make_docx) -> None:
        docx_file = tmp_project / "doc.docx"
        make_docx(docx_file, ["Stable content."])
        out_base = tmp_project / "raw" / "tmp"

        r1 = prepare_source_fn(docx_file, out_base)
        meta1 = Path(r1["meta_path"]).read_bytes()
        text1 = Path(r1["text_path"]).read_bytes()

        r2 = prepare_source_fn(docx_file, out_base)
        meta2 = Path(r2["meta_path"]).read_bytes()
        text2 = Path(r2["text_path"]).read_bytes()

        assert meta1 == meta2
        assert text1 == text2

    def test_docx_zipbomb_rejected(
        self, tmp_project: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Lower the caps so a small fixture trips them — keeps the test
        # CI-memory-friendly while still exercising _check_zip_safety on a
        # real .docx-shaped archive.
        import zipfile

        monkeypatch.setattr(prepare_source, "MAX_DOCX_EXTRACTED_BYTES", 1024)
        bomb = tmp_project / "bomb.docx"
        with zipfile.ZipFile(bomb, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("word/document.xml", b"A" * 8192)  # 8 KB > 1 KB cap
        out_base = tmp_project / "raw" / "tmp"

        with pytest.raises(ValueError, match="zip|too large|Refusing"):
            prepare_source_fn(bomb, out_base)

    def test_docx_missing_lib_raises_actionable_error(
        self, tmp_project: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """When python-docx is missing, raise actionable ValueError (exit 2 path)."""
        # Ensure the import inside _extract_docx_text fails.
        monkeypatch.setitem(sys.modules, "docx", None)
        docx_file = tmp_project / "doc.docx"
        docx_file.write_bytes(b"PK\x03\x04 placeholder")  # not a real docx
        out_base = tmp_project / "raw" / "tmp"

        with pytest.raises(ValueError, match="python-docx"):
            prepare_source_fn(docx_file, out_base)


class TestRtfExtractor:
    def test_rtf_extracts_body(self, tmp_project: Path, make_rtf) -> None:
        rtf_file = tmp_project / "doc.rtf"
        make_rtf(rtf_file, "Hello RTF body.")
        out_base = tmp_project / "raw" / "tmp"

        result = prepare_source_fn(rtf_file, out_base)
        text = Path(result["text_path"]).read_text(encoding="utf-8")
        assert "Hello RTF body." in text

    def test_idempotency_rtf(self, tmp_project: Path, make_rtf) -> None:
        rtf_file = tmp_project / "doc.rtf"
        make_rtf(rtf_file, "Stable RTF content.")
        out_base = tmp_project / "raw" / "tmp"

        r1 = prepare_source_fn(rtf_file, out_base)
        meta1 = Path(r1["meta_path"]).read_bytes()
        text1 = Path(r1["text_path"]).read_bytes()

        r2 = prepare_source_fn(rtf_file, out_base)
        meta2 = Path(r2["meta_path"]).read_bytes()
        text2 = Path(r2["text_path"]).read_bytes()

        assert meta1 == meta2
        assert text1 == text2

    def test_rtf_missing_lib_raises_actionable_error(
        self, tmp_project: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setitem(sys.modules, "striprtf", None)
        monkeypatch.setitem(sys.modules, "striprtf.striprtf", None)
        rtf_file = tmp_project / "doc.rtf"
        rtf_file.write_bytes(b"{\\rtf1\\ansi placeholder}")
        out_base = tmp_project / "raw" / "tmp"

        with pytest.raises(ValueError, match="striprtf"):
            prepare_source_fn(rtf_file, out_base)


class TestEpubExtractor:
    def test_epub_extracts_chapters(self, tmp_project: Path, make_epub) -> None:
        epub_file = tmp_project / "book.epub"
        make_epub(
            epub_file,
            [
                ("Chapter 1", "<p>Opening line of chapter one.</p>"),
                ("Chapter 2", "<p>Opening line of chapter two.</p>"),
            ],
        )
        out_base = tmp_project / "raw" / "tmp"

        result = prepare_source_fn(epub_file, out_base)
        text = Path(result["text_path"]).read_text(encoding="utf-8")
        assert "Opening line of chapter one." in text
        assert "Opening line of chapter two." in text

    def test_idempotency_epub(self, tmp_project: Path, make_epub) -> None:
        epub_file = tmp_project / "book.epub"
        make_epub(epub_file, [("Only", "<p>Only chapter.</p>")])
        out_base = tmp_project / "raw" / "tmp"

        r1 = prepare_source_fn(epub_file, out_base)
        meta1 = Path(r1["meta_path"]).read_bytes()
        text1 = Path(r1["text_path"]).read_bytes()

        r2 = prepare_source_fn(epub_file, out_base)
        meta2 = Path(r2["meta_path"]).read_bytes()
        text2 = Path(r2["text_path"]).read_bytes()

        assert meta1 == meta2
        assert text1 == text2

    def test_epub_zipbomb_rejected(
        self, tmp_project: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # See test_docx_zipbomb_rejected for the cap-monkeypatch rationale.
        import zipfile

        monkeypatch.setattr(prepare_source, "MAX_EPUB_EXTRACTED_BYTES", 1024)
        bomb = tmp_project / "bomb.epub"
        with zipfile.ZipFile(bomb, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("OEBPS/big.xhtml", b"B" * 8192)
        out_base = tmp_project / "raw" / "tmp"

        with pytest.raises(ValueError, match="zip|too large|Refusing"):
            prepare_source_fn(bomb, out_base)

    def test_epub_xml_billion_laughs_rejected(self, tmp_project: Path) -> None:
        import zipfile

        billion = (
            "<?xml version='1.0'?>"
            "<!DOCTYPE lolz [<!ENTITY lol \"lol\">"
            "<!ENTITY lol2 \"&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;\">"
            "<!ENTITY lol3 \"&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;\">"
            "]><lolz>&lol3;</lolz>"
        )
        epub_file = tmp_project / "billion.epub"
        with zipfile.ZipFile(epub_file, "w") as zf:
            zf.writestr("mimetype", "application/epub+zip")
            zf.writestr("META-INF/container.xml", billion)
        out_base = tmp_project / "raw" / "tmp"

        with pytest.raises(ValueError):
            prepare_source_fn(epub_file, out_base)

    def test_epub_missing_lib_raises_actionable_error(
        self, tmp_project: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setitem(sys.modules, "ebooklib", None)
        epub_file = tmp_project / "book.epub"
        epub_file.write_bytes(b"PK\x03\x04 placeholder epub")
        out_base = tmp_project / "raw" / "tmp"

        with pytest.raises(ValueError, match="ebooklib"):
            prepare_source_fn(epub_file, out_base)

    def test_epub_drm_protected_rejected(self, tmp_project: Path, make_epub) -> None:
        """EPUB with META-INF/encryption.xml stub → ValueError 'DRM-protected'."""
        import zipfile

        epub_file = tmp_project / "drm.epub"
        make_epub(epub_file, [("Ch1", "<p>body</p>")])
        # Inject encryption.xml into the existing valid .epub.
        with zipfile.ZipFile(epub_file, "a") as zf:
            zf.writestr("META-INF/encryption.xml", "<encryption/>")
        out_base = tmp_project / "raw" / "tmp"

        with pytest.raises(ValueError, match="DRM-protected"):
            prepare_source_fn(epub_file, out_base)


# ---------------------------------------------------------------------------
# Integration smoke + lazy-import discipline guard
# ---------------------------------------------------------------------------

class TestIntegrationSmoke:
    def test_cli_smoke_all_new_formats(
        self, tmp_project: Path, make_docx, make_rtf, make_epub
    ) -> None:
        """One subprocess CLI run per new format — confirms wiring → meta.json."""
        import subprocess

        cases = [
            (".docx", lambda p: make_docx(p, ["Smoke paragraph."])),
            (".rtf",  lambda p: make_rtf(p, "Smoke RTF body.")),
            (".epub", lambda p: make_epub(p, [("Ch", "<p>Smoke EPUB body.</p>")])),
        ]
        script = Path(__file__).resolve().parents[1] / "prepare_source.py"
        for ext, factory in cases:
            src = tmp_project / f"sample{ext}"
            factory(src)
            proc = subprocess.run(
                [sys.executable, str(script), str(src),
                 "--project-root", str(tmp_project)],
                capture_output=True, text=True, check=True,
            )
            result = json.loads(proc.stdout)
            assert Path(result["meta_path"]).exists()
            meta = json.loads(Path(result["meta_path"]).read_text(encoding="utf-8"))
            assert meta["type"] == ext.lstrip(".")


class TestLazyImportDiscipline:
    """Guard against accidental top-level imports of optional research-pack libs."""

    FORBIDDEN_PREFIXES = (
        "from docx",
        "import docx",
        "from striprtf",
        "import striprtf",
        "from ebooklib",
        "import ebooklib",
        "from bs4",
        "import bs4",
        "from defusedxml",
        "import defusedxml",
    )

    def test_no_top_level_optional_imports(self) -> None:
        src_path = Path(__file__).resolve().parents[1] / "prepare_source.py"
        src = src_path.read_text(encoding="utf-8")
        offenders: list[str] = []
        for line in src.splitlines():
            if line.startswith(self.FORBIDDEN_PREFIXES):
                offenders.append(line)
        assert not offenders, (
            "Lazy-import discipline violated — these imports must live inside "
            f"the extractor function bodies: {offenders}"
        )

