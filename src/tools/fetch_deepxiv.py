"""
fetch_deepxiv.py — DeepXiv SDK wrapper for semantic search and progressive
reading over arXiv-hosted papers.

CLI:
    python fetch_deepxiv.py search <query> [--limit N]
    python fetch_deepxiv.py read <arxiv_id> [--section SECTION]
    python fetch_deepxiv.py trending [--category CAT] [--limit N]

Requires DEEPXIV_TOKEN in environment (via _env.load_env()).
JSON emitted to stdout on success.
Errors emitted to stderr; exit codes:
    0  success
    2  user error (missing token, bad input) — actionable message
    3  internal/transient error (network, API 5xx) — includes retry hint

NOTE: DeepXiv does not have a public SDK at the time of writing. This
wrapper targets the DeepXiv REST API conventions documented at
https://deepxiv.com/api/docs. Update BASE_URL if the endpoint changes.

All network calls use requests.Session().
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import requests

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

DEEPXIV_BASE_URL = "https://api.deepxiv.com/v1"
REQUEST_TIMEOUT = 45  # DeepXiv reads can be slow on large papers

ENV_KEY_NAME = "DEEPXIV_TOKEN"
KEY_OBTAIN_URL = "https://deepxiv.com/signup"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _get_token() -> str:
    """Load and return the DeepXiv token.

    Raises SystemExit(2) with an actionable message if missing.
    """
    env = load_env()
    token = env.get(ENV_KEY_NAME, "").strip()
    if not token:
        _err(
            f"Error: {ENV_KEY_NAME} is not set.\n"
            f"Set it in your project .env file or ~/.env:\n"
            f"  {ENV_KEY_NAME}=<your-token>\n"
            f"Obtain a token at: {KEY_OBTAIN_URL}"
        )
        sys.exit(2)
    return token


def _make_session(token: str) -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": "lumina-wiki/0.1 (research-pack; deepxiv fetcher)",
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    return session


def _handle_response_errors(resp: requests.Response, context: str) -> None:
    if resp.status_code == 401:
        raise ValueError(
            f"Authentication failed for {context}. "
            f"Check that {ENV_KEY_NAME} is correct."
        )
    if resp.status_code == 404:
        raise ValueError(f"Not found: {context}. Check the arXiv ID.")
    if resp.status_code == 429:
        raise RuntimeError("Rate limit exceeded. Wait before retrying.")
    if resp.status_code >= 500:
        raise RuntimeError(f"DeepXiv API returned HTTP {resp.status_code}")
    resp.raise_for_status()


# ---------------------------------------------------------------------------
# Core fetch functions
# ---------------------------------------------------------------------------

def semantic_search(
    query: str,
    session: requests.Session,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Perform semantic search over arXiv papers via DeepXiv.

    Args:
        query: Natural-language query string.
        session: requests.Session with auth header set.
        limit: Maximum results.

    Returns:
        List of paper dicts with relevance scores.
    """
    url = f"{DEEPXIV_BASE_URL}/search"
    payload = {"query": query, "limit": limit}
    resp = session.post(url, json=payload, timeout=REQUEST_TIMEOUT)
    _handle_response_errors(resp, f"search '{query}'")
    data = resp.json()
    return data.get("results", data) if isinstance(data, dict) else data


def read_paper(
    arxiv_id: str,
    session: requests.Session,
    section: str | None = None,
) -> dict[str, Any]:
    """Progressively read a paper — fetch full text or a specific section.

    Args:
        arxiv_id: arXiv paper ID, e.g. '2301.00234' or '2301.00234v1'.
        session: requests.Session with auth header set.
        section: Optional section name to retrieve (e.g. 'abstract',
                 'introduction', 'conclusion'). If None, returns the full
                 structured content.

    Returns:
        Dict with keys: arxiv_id, title, sections (list), full_text, metadata.
    """
    url = f"{DEEPXIV_BASE_URL}/paper/{arxiv_id}/read"
    params: dict[str, Any] = {}
    if section:
        params["section"] = section
    resp = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
    _handle_response_errors(resp, f"paper '{arxiv_id}'")
    return resp.json()


def fetch_trending(
    session: requests.Session,
    category: str | None = None,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Fetch trending arXiv papers from DeepXiv.

    Args:
        session: requests.Session with auth header set.
        category: Optional arXiv category filter (e.g. 'cs.LG').
        limit: Maximum results.

    Returns:
        List of trending paper dicts.
    """
    url = f"{DEEPXIV_BASE_URL}/trending"
    params: dict[str, Any] = {"limit": limit}
    if category:
        params["category"] = category
    resp = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
    _handle_response_errors(resp, "trending papers")
    data = resp.json()
    return data.get("results", data) if isinstance(data, dict) else data


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="fetch_deepxiv.py",
        description=(
            "Semantic search and progressive reading over arXiv papers via DeepXiv. "
            "Requires DEEPXIV_TOKEN."
        ),
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # search
    s = subparsers.add_parser("search", help="Semantic search over arXiv papers.")
    s.add_argument("query", help="Natural-language query.")
    s.add_argument("--limit", type=int, default=10, help="Max results (default: 10).")

    # read
    r = subparsers.add_parser("read", help="Read a paper or one of its sections.")
    r.add_argument("arxiv_id", help="arXiv paper ID, e.g. 2301.00234.")
    r.add_argument("--section", default=None,
                   help="Section to read (e.g. abstract, introduction, conclusion).")

    # trending
    t = subparsers.add_parser("trending", help="Fetch trending arXiv papers.")
    t.add_argument("--category", default=None, help="arXiv category filter (e.g. cs.LG).")
    t.add_argument("--limit", type=int, default=10, help="Max results (default: 10).")

    args = parser.parse_args(argv)
    token = _get_token()
    session = _make_session(token)

    try:
        if args.command == "search":
            if not args.query.strip():
                _err("Error: query must not be empty.")
                sys.exit(2)
            result = semantic_search(args.query.strip(), session, args.limit)
            print(json.dumps(result, ensure_ascii=False, indent=2))

        elif args.command == "read":
            if not args.arxiv_id.strip():
                _err("Error: arxiv_id must not be empty.")
                sys.exit(2)
            result = read_paper(args.arxiv_id.strip(), session, args.section)
            print(json.dumps(result, ensure_ascii=False, indent=2))

        else:  # trending
            result = fetch_trending(session, args.category, args.limit)
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
        _err("Request timed out while contacting DeepXiv.")
        _err("Retry hint: DeepXiv may be slow; try again in a few minutes.")
        sys.exit(3)
    except requests.exceptions.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else "unknown"
        _err(f"HTTP error {code} from DeepXiv.")
        _err("Retry hint: try again later.")
        sys.exit(3)


if __name__ == "__main__":
    main()
