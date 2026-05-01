"""
test_discover.py — Tests for discover.py candidate ranking tool.

Covers:
- Happy path: valid candidates ranked by composite score, top N returned.
- Empty candidates list -> returns empty list, exit 0.
- Missing --topic -> exit 2.
- Invalid JSON input -> exit 2.
- Non-list JSON input -> exit 2.
- --input file not found -> exit 2.
- Score order: high-citation paper ranks above zero-citation paper.
- Recency: newer paper scores higher on recency component.
- Topic match: paper with topic words in title ranks higher.
- Output includes '_score' field on each candidate.
- Top N: respects --top limit.
- Deterministic: same input -> same output order.
"""

from __future__ import annotations

import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import discover
from discover import rank_candidates, score_candidate, _recency_score, _topic_match_score


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_paper(
    pid: str = "p1",
    title: str = "Test Paper",
    abstract: str = "",
    year: int = 2022,
    citations: int = 0,
) -> dict:
    return {
        "id": pid,
        "title": title,
        "abstract": abstract,
        "year": year,
        "citationCount": citations,
    }


# ---------------------------------------------------------------------------
# Unit tests: scoring helpers
# ---------------------------------------------------------------------------

class TestRecencyScore:
    def test_current_year_scores_highest(self) -> None:
        """Current year gets a high recency score."""
        score = _recency_score(discover.CURRENT_YEAR)
        assert score > 0.5

    def test_old_paper_scores_zero_or_near(self) -> None:
        """Very old paper gets low recency score."""
        score = _recency_score(1990)
        assert score == 0.0

    def test_none_year_returns_zero(self) -> None:
        """None year returns 0.0."""
        assert _recency_score(None) == 0.0

    def test_future_year_clamped_to_one(self) -> None:
        """Future year is clamped to 1.0."""
        score = _recency_score(discover.CURRENT_YEAR + 5)
        assert score == 1.0


class TestTopicMatchScore:
    def test_all_tokens_present_returns_one(self) -> None:
        """All topic words in title -> score 1.0."""
        paper = _make_paper(title="flash attention transformer")
        tokens = discover._tokenize("flash attention")
        score = _topic_match_score(paper, tokens)
        assert score == 1.0

    def test_no_tokens_match_returns_zero(self) -> None:
        """No topic words in title/abstract -> score 0.0."""
        paper = _make_paper(title="Unrelated Paper About Widgets")
        tokens = discover._tokenize("flash attention")
        score = _topic_match_score(paper, tokens)
        assert score == 0.0

    def test_empty_topic_tokens_returns_zero(self) -> None:
        """Empty topic -> score 0.0 (no division by zero)."""
        paper = _make_paper(title="some paper")
        score = _topic_match_score(paper, set())
        assert score == 0.0

    def test_partial_match_returns_fraction(self) -> None:
        """Partial match returns intermediate score."""
        paper = _make_paper(title="flash paper about things")
        tokens = discover._tokenize("flash attention")
        score = _topic_match_score(paper, tokens)
        assert 0.0 < score < 1.0


# ---------------------------------------------------------------------------
# rank_candidates tests
# ---------------------------------------------------------------------------

class TestRankCandidates:
    def test_happy_path_returns_list(self) -> None:
        """Happy path: returns a list of candidates."""
        candidates = [_make_paper("p1"), _make_paper("p2")]
        result = rank_candidates(candidates, "test topic")
        assert isinstance(result, list)
        assert len(result) == 2

    def test_result_contains_score_field(self) -> None:
        """Each result has a '_score' field."""
        candidates = [_make_paper("p1", citations=100)]
        result = rank_candidates(candidates, "test")
        assert "_score" in result[0]

    def test_high_citation_ranks_above_zero_citation(self) -> None:
        """Paper with more citations ranks higher."""
        low = _make_paper("low", citations=0)
        high = _make_paper("high", citations=10000)
        result = rank_candidates([low, high], "test", top=2)
        assert result[0]["id"] == "high"

    def test_topic_relevant_paper_beats_irrelevant(self) -> None:
        """Paper with topic words in title ranks higher than unrelated paper."""
        relevant = _make_paper("rel", title="flash attention mechanism", citations=10)
        irrelevant = _make_paper("irr", title="widget factory algorithm", citations=10)
        result = rank_candidates([irrelevant, relevant], "flash attention", top=2)
        assert result[0]["id"] == "rel"

    def test_top_limits_output_count(self) -> None:
        """--top limits the number of returned candidates."""
        candidates = [_make_paper(f"p{i}") for i in range(20)]
        result = rank_candidates(candidates, "topic", top=5)
        assert len(result) == 5

    def test_empty_candidates_returns_empty(self) -> None:
        """Empty input returns empty list."""
        result = rank_candidates([], "topic")
        assert result == []

    def test_deterministic_same_input_same_order(self) -> None:
        """Same input always produces the same ranked order."""
        candidates = [
            _make_paper("a", title="alpha beta", citations=100),
            _make_paper("b", title="gamma delta", citations=50),
            _make_paper("c", title="alpha topic", citations=200),
        ]
        r1 = rank_candidates(candidates, "alpha", top=3)
        r2 = rank_candidates(candidates, "alpha", top=3)
        assert [p["id"] for p in r1] == [p["id"] for p in r2]

    def test_scores_are_numeric(self) -> None:
        """All _score values are numeric."""
        candidates = [_make_paper(f"p{i}") for i in range(5)]
        result = rank_candidates(candidates, "topic")
        for item in result:
            assert isinstance(item["_score"], (int, float))


# ---------------------------------------------------------------------------
# CLI tests
# ---------------------------------------------------------------------------

class TestCLI:
    def test_missing_topic_exits_2_or_argparse_error(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Missing --topic -> exit 2 (or argparse exits 2 by default)."""
        with pytest.raises(SystemExit) as exc_info:
            discover.main([])
        assert exc_info.value.code == 2

    def test_empty_topic_exits_2(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Blank --topic -> exit 2 with actionable message."""
        with pytest.raises(SystemExit) as exc_info:
            discover.main(["--topic", "   "])
        assert exc_info.value.code == 2

    def test_invalid_json_from_stdin_exits_2(
        self, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Invalid JSON on stdin -> exit 2."""
        monkeypatch.setattr("sys.stdin", io.StringIO("not valid json"))
        with pytest.raises(SystemExit) as exc_info:
            discover.main(["--topic", "test"])
        assert exc_info.value.code == 2

    def test_non_list_json_exits_2(
        self, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """JSON object (not array) on stdin -> exit 2."""
        monkeypatch.setattr("sys.stdin", io.StringIO('{"not": "an array"}'))
        with pytest.raises(SystemExit) as exc_info:
            discover.main(["--topic", "test"])
        assert exc_info.value.code == 2

    def test_input_file_not_found_exits_2(self, capsys: pytest.CaptureFixture[str]) -> None:
        """--input file not found -> exit 2 with actionable message."""
        with pytest.raises(SystemExit) as exc_info:
            discover.main(["--topic", "test", "--input", "/nonexistent/path/file.json"])
        assert exc_info.value.code == 2

    def test_happy_path_stdout_is_valid_json_exit_0(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Happy path from stdin: stdout is valid JSON list, exit 0."""
        candidates = [_make_paper("p1", title="flash attention study", citations=100)]
        monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(candidates)))
        buf = io.StringIO()
        with redirect_stdout(buf):
            with pytest.raises(SystemExit) as exc_info:
                discover.main(["--topic", "flash attention"])
        assert exc_info.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert isinstance(parsed, list)
        assert "_score" in parsed[0]

    def test_happy_path_from_input_file_exit_0(self, tmp_path: Path) -> None:
        """Happy path from --input file: stdout is valid JSON list, exit 0."""
        candidates = [_make_paper("p1", citations=50)]
        input_file = tmp_path / "candidates.json"
        input_file.write_text(json.dumps(candidates), encoding="utf-8")

        buf = io.StringIO()
        with redirect_stdout(buf):
            with pytest.raises(SystemExit) as exc_info:
                discover.main(["--topic", "attention", "--input", str(input_file)])
        assert exc_info.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert isinstance(parsed, list)
