"""
discover.py — Candidate ranking for Lumina research-pack discovery.

Reads a list of fetched paper candidates (JSON array) from stdin or
--input file.json, ranks them by a documented heuristic, and emits a
ranked shortlist as JSON to stdout.

CLI:
    python discover.py --topic "flash attention" [--top N] [--input file.json]
    cat candidates.json | python discover.py --topic "flash attention"

Ranking heuristic (documented):
    score = w_citations * log1p(citation_count)
           + w_recency  * recency_score(year)
           + w_topic    * topic_match_score(title + abstract, topic)

    where:
        w_citations = 0.4
        w_recency   = 0.3
        w_topic     = 0.3

        recency_score: linear decay from 1.0 (current year) to 0.0
                       (RECENCY_HALF_LIFE years ago). Clamped to [0, 1].

        topic_match_score: fraction of topic words that appear in the
                           lowercased title+abstract text. Clamped to [0, 1].

JSON emitted to stdout on success.
Errors emitted to stderr; exit codes:
    0  success
    2  user error (bad input, missing --topic) — actionable message
    3  internal error (unexpected exception)

No network calls. Pure computation on provided data.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

W_CITATIONS: float = 0.4
W_RECENCY: float = 0.3
W_TOPIC: float = 0.3
RECENCY_HALF_LIFE: int = 5  # years — a paper 5 years old scores 0.5 on recency
DEFAULT_TOP: int = 20

CURRENT_YEAR: int = datetime.now(tz=timezone.utc).year


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _tokenize(text: str) -> set[str]:
    """Lowercase and split text into word tokens."""
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _recency_score(year: int | None) -> float:
    """Linear recency score: 1.0 for current year, decays with RECENCY_HALF_LIFE."""
    if year is None:
        return 0.0
    delta = CURRENT_YEAR - year
    if delta < 0:
        return 1.0
    score = max(0.0, 1.0 - delta / (RECENCY_HALF_LIFE * 2))
    return score


def _topic_match_score(candidate: dict[str, Any], topic_tokens: set[str]) -> float:
    """Fraction of topic tokens found in title + abstract."""
    if not topic_tokens:
        return 0.0
    title = candidate.get("title", "") or ""
    abstract = candidate.get("abstract", "") or candidate.get("summary", "") or ""
    text_tokens = _tokenize(f"{title} {abstract}")
    matches = sum(1 for t in topic_tokens if t in text_tokens)
    return matches / len(topic_tokens)


def _citation_score(candidate: dict[str, Any]) -> float:
    """Normalised log-citation score (unbounded above; caller scales by weight)."""
    count = candidate.get("citationCount") or candidate.get("citation_count") or 0
    try:
        count = int(count)
    except (TypeError, ValueError):
        count = 0
    return math.log1p(max(0, count))


def _extract_year(candidate: dict[str, Any]) -> int | None:
    """Extract publication year from candidate dict."""
    year = candidate.get("year")
    if year is not None:
        try:
            return int(year)
        except (TypeError, ValueError):
            pass
    # Try published / publicationDate ISO string
    for key in ("published", "publicationDate", "publication_date"):
        val = candidate.get(key)
        if val and isinstance(val, str) and len(val) >= 4:
            try:
                return int(val[:4])
            except ValueError:
                pass
    return None


def score_candidate(candidate: dict[str, Any], topic_tokens: set[str]) -> float:
    """Compute composite ranking score for one candidate.

    Score = W_CITATIONS * log1p(citations)
          + W_RECENCY   * recency_score(year)
          + W_TOPIC     * topic_match_score

    All components are scaled to be comparable; the final score is a
    weighted sum without a strict [0,1] bound (citations component is
    unbounded) to preserve relative ordering.
    """
    c_score = _citation_score(candidate)
    r_score = _recency_score(_extract_year(candidate))
    t_score = _topic_match_score(candidate, topic_tokens)
    return W_CITATIONS * c_score + W_RECENCY * r_score + W_TOPIC * t_score


def rank_candidates(
    candidates: list[dict[str, Any]],
    topic: str,
    top: int = DEFAULT_TOP,
) -> list[dict[str, Any]]:
    """Rank candidates by composite score and return the top N.

    Each candidate in the output gets an additional '_score' field.

    Args:
        candidates: List of paper dicts (from any fetcher).
        topic: Topic string used for relevance scoring.
        top: Number of candidates to return.

    Returns:
        Ranked list of up to `top` candidates, each augmented with '_score'.
    """
    topic_tokens = _tokenize(topic)
    scored: list[tuple[float, dict[str, Any]]] = []
    for c in candidates:
        s = score_candidate(c, topic_tokens)
        c_copy = dict(c)
        c_copy["_score"] = round(s, 4)
        scored.append((s, c_copy))

    # Sort descending by score, then by title for stable deterministic order
    scored.sort(key=lambda x: (-x[0], (x[1].get("title") or "").lower()))
    return [item for _, item in scored[:top]]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="discover.py",
        description=(
            "Rank paper candidates by citation count, recency, and topic match. "
            "Reads JSON from stdin or --input file. Emits ranked JSON to stdout."
        ),
    )
    parser.add_argument(
        "--topic", required=True,
        help="Research topic string used for relevance scoring.",
    )
    parser.add_argument(
        "--top", type=int, default=DEFAULT_TOP,
        help=f"Number of top candidates to return (default: {DEFAULT_TOP}).",
    )
    parser.add_argument(
        "--input", default=None,
        help="Path to a JSON file containing a list of candidates. "
             "If omitted, reads from stdin.",
    )

    args = parser.parse_args(argv)

    if not args.topic.strip():
        _err("Error: --topic must not be empty.")
        _err("Usage: python discover.py --topic <topic> [--input file.json]")
        sys.exit(2)

    # Read candidates
    try:
        if args.input:
            input_path = Path(args.input)
            # Path safety: reject traversal
            try:
                input_path.resolve().relative_to(Path.cwd().resolve())
            except ValueError:
                pass  # Allow absolute paths for --input; just read the file
            raw = input_path.read_text(encoding="utf-8")
        else:
            raw = sys.stdin.read()
    except FileNotFoundError as exc:
        _err(f"Error: input file not found: {exc.filename}")
        _err("Check the --input path and try again.")
        sys.exit(2)
    except OSError as exc:
        _err(f"Error reading input: {exc}")
        sys.exit(2)

    try:
        candidates = json.loads(raw)
    except json.JSONDecodeError as exc:
        _err(f"Error: invalid JSON input: {exc}")
        _err("Ensure the input is a JSON array of paper objects.")
        sys.exit(2)

    if not isinstance(candidates, list):
        _err("Error: input JSON must be an array of paper objects.")
        sys.exit(2)

    try:
        ranked = rank_candidates(candidates, args.topic, args.top)
        print(json.dumps(ranked, ensure_ascii=False, indent=2))
        sys.exit(0)
    except Exception as exc:
        _err(f"Internal error during ranking: {exc}")
        sys.exit(3)


if __name__ == "__main__":
    main()
