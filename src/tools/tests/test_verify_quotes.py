"""
test_verify_quotes.py — Tests for verify_quotes.py.

Uses a plain paged .txt source (no PDF library needed) so the matching
algorithm, verdicts, and CLI contract are covered independently of pypdf.
"""

from __future__ import annotations

import io
import json
import sys
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from verify_quotes import (
    extract_checkable_quotes,
    main,
    normalize,
    parse_paged_text,
)

PAGED_SOURCE = """[[page 1]]
Deep work is the ability to focus without distraction on a
cognitively demanding task.
[[page 2]]
The shallows are seductive; busyness is not a proxy for productivity
in the modern knowledge economy.
[[page 3]]
Craftsmanship offers a path to meaning through skillful labor.
"""


@pytest.fixture
def source_txt(tmp_path: Path) -> Path:
    p = tmp_path / "paged.txt"
    p.write_text(PAGED_SOURCE, encoding="utf-8")
    return p


def run_cli(argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = main(argv)
    return code, out.getvalue(), err.getvalue()


class TestNormalize:
    def test_folds_case_punctuation_and_whitespace(self):
        assert normalize('Deep  Work — the "Ability"!') == "deep work the ability"

    def test_folds_hyphens_and_curly_quotes(self):
        assert normalize("cognitively-demanding “task”") == "cognitively demanding task"

    def test_strips_vietnamese_diacritics(self):
        assert normalize("Đọc sách sâu") == "doc sach sau"


class TestParsePagedText:
    def test_splits_on_markers(self):
        pages = parse_paged_text(PAGED_SOURCE)
        assert set(pages) == {1, 2, 3}
        assert "Deep work" in pages[1]
        assert "shallows" in pages[2]

    def test_text_before_first_marker_ignored(self):
        pages = parse_paged_text("preamble\n[[page 4]]\nbody\n")
        assert set(pages) == {4}


class TestExtractCheckableQuotes:
    def test_finds_quote_with_page_citation(self):
        md = 'He defines it as "focus without distraction on a cognitively demanding task" (p. 1).\n'
        quotes = extract_checkable_quotes(md)
        assert len(quotes) == 1
        lineno, citation, lo, hi, quote = quotes[0]
        assert (lineno, citation, lo, hi) == (1, "(p. 1)", 1, 1)
        assert quote.startswith("focus without")

    def test_supports_pp_range_and_tr(self):
        md = (
            '"busyness is not a proxy for productivity" (pp. 2-3)\n'
            '"kha nang tap trung khong xao nhang la hiem" (tr. 7)\n'
        )
        quotes = extract_checkable_quotes(md)
        assert [(q[2], q[3]) for q in quotes] == [(2, 3), (7, 7)]

    def test_short_quotes_skipped(self):
        md = '"deep work" is central (p. 1).\n'
        assert extract_checkable_quotes(md) == []

    def test_uncited_lines_skipped(self):
        md = '"focus without distraction on a demanding task" has no citation.\n'
        assert extract_checkable_quotes(md) == []

    def test_fenced_code_blocks_skipped(self):
        md = (
            "```\n"
            '"focus without distraction on a cognitively demanding task" (p. 1)\n'
            "```\n"
        )
        assert extract_checkable_quotes(md) == []

    def test_yaml_frontmatter_skipped(self):
        # The recommended note title format ("Part N: Title (pp. from-to)")
        # must not register as a checkable quote.
        md = (
            "---\n"
            'title: "Part 1: The Activity of Deep Reading (pp. 9-34)"\n'
            "---\n"
            '"focus without distraction on a cognitively demanding task" (p. 1)\n'
        )
        quotes = extract_checkable_quotes(md)
        assert len(quotes) == 1
        assert quotes[0][0] == 4  # line number of the body quote


class TestCLIVerdicts:
    def _write_note(self, tmp_path: Path, body: str) -> Path:
        note = tmp_path / "note.md"
        note.write_text(body, encoding="utf-8")
        return note

    def test_ok_near_fail_counts(self, tmp_path: Path, source_txt: Path):
        note = self._write_note(tmp_path, (
            # OK — on the cited page, punctuation/case differences fold away.
            '"Focus without distraction, on a cognitively demanding task" (p. 1)\n'
            # NEAR — text is on page 2 but the note cites page 3.
            '"busyness is not a proxy for productivity" (p. 3)\n'
            # FAIL — fabricated quote.
            '"reading fiction rewires the prefrontal cortex overnight" (p. 2)\n'
        ))
        code, out, _ = run_cli(["--source", str(source_txt), str(note)])
        assert code == 0
        data = json.loads(out)
        assert (data["checked"], data["ok"], data["near"], data["fail"]) == (3, 1, 1, 1)
        statuses = [r["status"] for r in data["results"]]
        assert statuses == ["OK", "NEAR", "FAIL"]
        assert data["results"][0]["line"] == 1
        assert data["results"][2]["citation"] == "(p. 2)"

    def test_quote_spanning_pp_range_is_ok(self, tmp_path: Path, source_txt: Path):
        note = self._write_note(
            tmp_path,
            '"busyness is not a proxy for productivity" (pp. 2-3)\n',
        )
        code, out, _ = run_cli(["--source", str(source_txt), str(note)])
        assert code == 0
        assert json.loads(out)["ok"] == 1

    def test_directory_target_recurses(self, tmp_path: Path, source_txt: Path):
        notes = tmp_path / "notes"
        notes.mkdir()
        (notes / "a.md").write_text(
            '"focus without distraction on a cognitively demanding task" (p. 1)\n',
            encoding="utf-8",
        )
        code, out, _ = run_cli(["--source", str(source_txt), str(notes)])
        assert code == 0
        assert json.loads(out)["checked"] == 1

    def test_no_checkable_quotes_reports_zero(self, tmp_path: Path, source_txt: Path):
        note = self._write_note(tmp_path, "No quotes here, just prose.\n")
        code, out, _ = run_cli(["--source", str(source_txt), str(note)])
        assert code == 0
        data = json.loads(out)
        assert data == {"checked": 0, "ok": 0, "near": 0, "fail": 0, "results": []}


class TestCLIErrors:
    def test_missing_source_exits_2(self, tmp_path: Path):
        note = tmp_path / "n.md"
        note.write_text("x", encoding="utf-8")
        code, _, err = run_cli(["--source", str(tmp_path / "nope.txt"), str(note)])
        assert code == 2
        assert "source not found" in err

    def test_missing_target_exits_2(self, source_txt: Path, tmp_path: Path):
        code, _, err = run_cli(["--source", str(source_txt), str(tmp_path / "nope.md")])
        assert code == 2
        assert "target not found" in err

    def test_source_without_markers_exits_2(self, tmp_path: Path):
        bare = tmp_path / "bare.txt"
        bare.write_text("no markers at all", encoding="utf-8")
        note = tmp_path / "n.md"
        note.write_text("x", encoding="utf-8")
        code, _, err = run_cli(["--source", str(bare), str(note)])
        assert code == 2
        assert "[[page N]] markers" in err
