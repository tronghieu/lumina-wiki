"""
fetch_s2.py — Semantic Scholar API wrapper.

CLI:
    python fetch_s2.py paper <id>
    python fetch_s2.py citations <id> [--limit N] [--offset N]
    python fetch_s2.py references <id> [--limit N] [--offset N]
    python fetch_s2.py recommendations <id> [--limit N]
    python fetch_s2.py search <query> [--limit N] [--offset N]

Requires SEMANTIC_SCHOLAR_API_KEY in environment (via _env.load_env()).
JSON emitted to stdout on success.
Errors emitted to stderr; exit codes:
    0  success
    2  user error (missing key, bad input, paper not found) — actionable
    3  internal/transient error (network, API 5xx) — includes retry hint

All network calls use requests.Session(). Paginated endpoints accept
--limit (default 50) to avoid fetching thousands of records in one call.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import requests

# Import env loader using relative path for portability when installed
try:
    from _env import load_env
except ImportError:
    import importlib.util
    _spec = importlib.util.spec_from_file_location(
        "_env", Path(__file__).parent / "_env.py"
    )
    _mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
    _spec.loader.exec_module(_mod)  # type: ignore[union-attr]
    load_env = _mod.load_env

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

S2_API_BASE = "https://api.semanticscholar.org/graph/v1"
REQUEST_TIMEOUT = 30

PAPER_FIELDS = (
    "paperId,externalIds,title,abstract,authors,year,"
    "referenceCount,citationCount,influentialCitationCount,"
    "isOpenAccess,openAccessPdf,publicationTypes,"
    "publicationDate,journal,fieldsOfStudy,s2FieldsOfStudy,url"
)
CITATION_FIELDS = "paperId,title,authors,year,citationCount,url"
REFERENCE_FIELDS = "paperId,title,authors,year,citationCount,url"
RECOMMENDATION_FIELDS = "paperId,title,authors,year,citationCount,url"
SEARCH_FIELDS = "paperId,title,authors,year,citationCount,abstract,url"

ENV_KEY_NAME = "SEMANTIC_SCHOLAR_API_KEY"
KEY_OBTAIN_URL = "https://www.semanticscholar.org/product/api#api-key-section"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _get_api_key() -> str:
    """Load and return the Semantic Scholar API key.

    Raises SystemExit(2) with an actionable message if missing.
    """
    env = load_env()
    key = env.get(ENV_KEY_NAME, "").strip()
    if not key:
        _err(
            f"Error: {ENV_KEY_NAME} is not set.\n"
            f"Set it in your project .env file or ~/.env:\n"
            f"  {ENV_KEY_NAME}=<your-key>\n"
            f"Obtain a free API key at: {KEY_OBTAIN_URL}"
        )
        sys.exit(2)
    return key


def _make_session(api_key: str) -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": "lumina-wiki/0.1 (research-pack; s2 fetcher)",
        "x-api-key": api_key,
    })
    return session


def _handle_response_errors(resp: requests.Response, context: str) -> None:
    """Check for API-level errors and raise appropriate exceptions."""
    if resp.status_code == 404:
        raise ValueError(f"Not found: {context}. Check the paper ID.")
    if resp.status_code == 429:
        raise RuntimeError("Rate limit exceeded. Wait before retrying.")
    if resp.status_code >= 500:
        raise RuntimeError(f"Semantic Scholar API returned HTTP {resp.status_code}")
    resp.raise_for_status()


# ---------------------------------------------------------------------------
# Core fetch functions
# ---------------------------------------------------------------------------

def fetch_paper(
    paper_id: str,
    session: requests.Session,
) -> dict[str, Any]:
    """Fetch full metadata for a single paper.

    Args:
        paper_id: S2 paper ID, arXiv ID (prefix 'arXiv:'), DOI (prefix 'DOI:'),
                  or any supported external ID.
        session: requests.Session with API key set.

    Returns:
        Paper metadata dict.
    """
    url = f"{S2_API_BASE}/paper/{paper_id}"
    resp = session.get(url, params={"fields": PAPER_FIELDS}, timeout=REQUEST_TIMEOUT)
    _handle_response_errors(resp, f"paper '{paper_id}'")
    return resp.json()


def fetch_citations(
    paper_id: str,
    session: requests.Session,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Fetch papers that cite the given paper (one page).

    Args:
        paper_id: S2 paper ID or external ID.
        session: requests.Session with API key set.
        limit: Maximum results per page (max 1000 per S2 API).
        offset: Pagination offset.

    Returns:
        Dict with keys: total, offset, next, data (list of paper stubs).
    """
    url = f"{S2_API_BASE}/paper/{paper_id}/citations"
    params = {
        "fields": CITATION_FIELDS,
        "limit": min(limit, 1000),
        "offset": offset,
    }
    resp = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
    _handle_response_errors(resp, f"citations for '{paper_id}'")
    raw = resp.json()
    # Unwrap nested citingPaper structure
    data = [item.get("citingPaper", item) for item in raw.get("data", [])]
    return {
        "total": raw.get("total"),
        "offset": raw.get("offset", offset),
        "next": raw.get("next"),
        "data": data,
    }


def fetch_references(
    paper_id: str,
    session: requests.Session,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Fetch papers referenced by the given paper (one page).

    Args:
        paper_id: S2 paper ID or external ID.
        session: requests.Session with API key set.
        limit: Maximum results per page.
        offset: Pagination offset.

    Returns:
        Dict with keys: total, offset, next, data (list of paper stubs).
    """
    url = f"{S2_API_BASE}/paper/{paper_id}/references"
    params = {
        "fields": REFERENCE_FIELDS,
        "limit": min(limit, 1000),
        "offset": offset,
    }
    resp = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
    _handle_response_errors(resp, f"references for '{paper_id}'")
    raw = resp.json()
    # Unwrap nested citedPaper structure
    data = [item.get("citedPaper", item) for item in raw.get("data", [])]
    return {
        "total": raw.get("total"),
        "offset": raw.get("offset", offset),
        "next": raw.get("next"),
        "data": data,
    }


def fetch_recommendations(
    paper_id: str,
    session: requests.Session,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Fetch recommended papers based on the given paper.

    Args:
        paper_id: S2 paper ID.
        session: requests.Session with API key set.
        limit: Maximum results.

    Returns:
        List of paper stubs.
    """
    url = f"{S2_API_BASE}/recommendations/v1/papers/forpaper/{paper_id}"
    params = {
        "fields": RECOMMENDATION_FIELDS,
        "limit": min(limit, 500),
    }
    resp = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
    _handle_response_errors(resp, f"recommendations for '{paper_id}'")
    return resp.json().get("recommendedPapers", [])


def search_papers(
    query: str,
    session: requests.Session,
    limit: int = 10,
    offset: int = 0,
) -> dict[str, Any]:
    """Search for papers by keyword.

    Args:
        query: Search query string.
        session: requests.Session with API key set.
        limit: Maximum results per page.
        offset: Pagination offset.

    Returns:
        Dict with keys: total, offset, next, data (list of paper stubs).
    """
    url = f"{S2_API_BASE}/paper/search"
    params = {
        "query": query,
        "fields": SEARCH_FIELDS,
        "limit": min(limit, 100),
        "offset": offset,
    }
    resp = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
    _handle_response_errors(resp, f"search '{query}'")
    return resp.json()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="fetch_s2.py",
        description="Fetch paper data from Semantic Scholar. Requires SEMANTIC_SCHOLAR_API_KEY.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # paper
    p = subparsers.add_parser("paper", help="Fetch full metadata for a paper.")
    p.add_argument("id", help="Paper ID (S2 ID, arXiv:XXXXXXX, DOI:xxxxx).")

    # citations
    c = subparsers.add_parser("citations", help="Fetch papers that cite a paper.")
    c.add_argument("id", help="Paper ID.")
    c.add_argument("--limit", type=int, default=50, help="Max results (default: 50).")
    c.add_argument("--offset", type=int, default=0, help="Pagination offset (default: 0).")

    # references
    r = subparsers.add_parser("references", help="Fetch papers referenced by a paper.")
    r.add_argument("id", help="Paper ID.")
    r.add_argument("--limit", type=int, default=50, help="Max results (default: 50).")
    r.add_argument("--offset", type=int, default=0, help="Pagination offset (default: 0).")

    # recommendations
    rec = subparsers.add_parser("recommendations", help="Fetch recommended papers.")
    rec.add_argument("id", help="Paper ID.")
    rec.add_argument("--limit", type=int, default=10, help="Max results (default: 10).")

    # search
    s = subparsers.add_parser("search", help="Search papers by keyword.")
    s.add_argument("query", help="Search query string.")
    s.add_argument("--limit", type=int, default=10, help="Max results (default: 10).")
    s.add_argument("--offset", type=int, default=0, help="Pagination offset (default: 0).")

    args = parser.parse_args(argv)

    api_key = _get_api_key()
    session = _make_session(api_key)

    try:
        if args.command == "paper":
            if not args.id.strip():
                _err("Error: paper ID must not be empty.")
                sys.exit(2)
            result = fetch_paper(args.id.strip(), session)
            print(json.dumps(result, ensure_ascii=False, indent=2))

        elif args.command == "citations":
            result = fetch_citations(args.id.strip(), session, args.limit, args.offset)
            print(json.dumps(result, ensure_ascii=False, indent=2))

        elif args.command == "references":
            result = fetch_references(args.id.strip(), session, args.limit, args.offset)
            print(json.dumps(result, ensure_ascii=False, indent=2))

        elif args.command == "recommendations":
            result = fetch_recommendations(args.id.strip(), session, args.limit)
            print(json.dumps(result, ensure_ascii=False, indent=2))

        else:  # search
            if not args.query.strip():
                _err("Error: query must not be empty.")
                sys.exit(2)
            result = search_papers(args.query.strip(), session, args.limit, args.offset)
            print(json.dumps(result, ensure_ascii=False, indent=2))

        sys.exit(0)

    except ValueError as exc:
        _err(f"Error: {exc}")
        sys.exit(2)
    except RuntimeError as exc:
        _err(f"API error: {exc}")
        _err("Retry hint: wait a few seconds and try again.")
        sys.exit(3)
    except requests.exceptions.ConnectionError as exc:
        _err(f"Network error: {exc}")
        _err("Retry hint: check your internet connection and try again.")
        sys.exit(3)
    except requests.exceptions.Timeout:
        _err("Request timed out while contacting Semantic Scholar.")
        _err("Retry hint: Semantic Scholar may be slow; try again in a few minutes.")
        sys.exit(3)
    except requests.exceptions.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else "unknown"
        _err(f"HTTP error {code} from Semantic Scholar.")
        _err("Retry hint: try again later.")
        sys.exit(3)


if __name__ == "__main__":
    main()
