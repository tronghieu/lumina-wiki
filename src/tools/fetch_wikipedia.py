"""
fetch_wikipedia.py — Wikipedia API wrapper.

CLI:
    python fetch_wikipedia.py page <title>
    python fetch_wikipedia.py search <query> [--limit N]

Used by /lumi-research-prefill to seed wiki/foundations/ with established definitions.
JSON emitted to stdout on success.
Errors emitted to stderr; exit codes:
    0  success
    2  user error (empty query/title, disambiguation page) — actionable message
    3  internal/transient error (network, API 5xx) — includes retry hint

No API key required. Uses the Wikipedia REST API and Action API.
All network calls use requests.Session().
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

import requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

WIKIPEDIA_REST_BASE = "https://en.wikipedia.org/api/rest_v1"
WIKIPEDIA_ACTION_BASE = "https://en.wikipedia.org/w/api.php"
REQUEST_TIMEOUT = 30


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": "lumina-wiki/0.1 (research-pack; wikipedia fetcher)"})
    return session


# ---------------------------------------------------------------------------
# Core fetch functions
# ---------------------------------------------------------------------------

def fetch_page(
    title: str,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    """Fetch a Wikipedia page summary and intro text by title.

    Uses the Wikipedia REST API /page/summary endpoint for fast metadata,
    then the Action API for a brief extract.

    Args:
        title: Wikipedia article title (URL-safe titles also accepted).
        session: Optional requests.Session for connection reuse.

    Returns:
        Dict with keys: title, pageid, description, extract, url, categories.

    Raises:
        requests.RequestException: on network failure.
        ValueError: on disambiguation, missing page, or API error.
    """
    sess = session or _make_session()

    # Use REST API summary endpoint
    url = f"{WIKIPEDIA_REST_BASE}/page/summary/{requests.utils.quote(title, safe='')}"
    resp = sess.get(url, timeout=REQUEST_TIMEOUT)

    if resp.status_code == 404:
        raise ValueError(f"Page not found: '{title}'. Check spelling or try a search first.")
    if resp.status_code >= 500:
        raise ValueError(f"Wikipedia REST API returned HTTP {resp.status_code}")
    resp.raise_for_status()

    data = resp.json()

    if data.get("type") == "disambiguation":
        raise ValueError(
            f"'{title}' is a disambiguation page. "
            f"Refine the title, e.g. '{title} (mathematics)' or use the search subcommand."
        )

    # Fetch a longer extract via the Action API
    action_params = {
        "action": "query",
        "format": "json",
        "titles": data.get("title", title),
        "prop": "extracts|categories",
        "exintro": True,
        "explaintext": True,
        "exsentences": 10,
        "cllimit": 20,
        "redirects": 1,
    }
    action_resp = sess.get(WIKIPEDIA_ACTION_BASE, params=action_params, timeout=REQUEST_TIMEOUT)
    if action_resp.status_code >= 500:
        raise ValueError(f"Wikipedia Action API returned HTTP {action_resp.status_code}")
    action_resp.raise_for_status()

    action_data = action_resp.json()
    pages = action_data.get("query", {}).get("pages", {})
    page_info = next(iter(pages.values()), {})
    extract = page_info.get("extract", data.get("extract", ""))
    raw_cats = page_info.get("categories", [])
    categories = [c.get("title", "").removeprefix("Category:") for c in raw_cats]

    return {
        "title": data.get("title", title),
        "pageid": data.get("pageid"),
        "description": data.get("description", ""),
        "extract": extract,
        "url": data.get("content_urls", {}).get("desktop", {}).get("page", ""),
        "categories": categories,
    }


def search_wikipedia(
    query: str,
    limit: int = 10,
    session: requests.Session | None = None,
) -> list[dict[str, Any]]:
    """Search Wikipedia and return a list of matching article summaries.

    Args:
        query: Free-text search query.
        limit: Maximum number of results.
        session: Optional requests.Session for connection reuse.

    Returns:
        List of dicts with keys: title, pageid, description, snippet, url.

    Raises:
        requests.RequestException: on network failure.
        ValueError: on API error.
    """
    sess = session or _make_session()
    params = {
        "action": "query",
        "format": "json",
        "list": "search",
        "srsearch": query,
        "srlimit": limit,
        "srprop": "snippet|titlesnippet",
        "utf8": 1,
    }
    resp = sess.get(WIKIPEDIA_ACTION_BASE, params=params, timeout=REQUEST_TIMEOUT)
    if resp.status_code >= 500:
        raise ValueError(f"Wikipedia Action API returned HTTP {resp.status_code}")
    resp.raise_for_status()

    data = resp.json()
    search_results = data.get("query", {}).get("search", [])

    results = []
    for item in search_results:
        results.append({
            "title": item.get("title", ""),
            "pageid": item.get("pageid"),
            "snippet": item.get("snippet", "").replace("<span class=\"searchmatch\">", "").replace("</span>", ""),
            "url": f"https://en.wikipedia.org/wiki/{requests.utils.quote(item.get('title', ''), safe='')}",
        })
    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="fetch_wikipedia.py",
        description="Fetch Wikipedia page content or search results.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # page subcommand
    page_parser = subparsers.add_parser("page", help="Fetch a Wikipedia article by title.")
    page_parser.add_argument("title", help="Wikipedia article title.")

    # search subcommand
    search_parser = subparsers.add_parser("search", help="Search Wikipedia.")
    search_parser.add_argument("query", help="Free-text search query.")
    search_parser.add_argument("--limit", type=int, default=10,
                               help="Maximum results to return (default: 10).")

    args = parser.parse_args(argv)
    session = _make_session()

    try:
        if args.command == "page":
            if not args.title.strip():
                _err("Error: title must not be empty.")
                _err("Usage: python fetch_wikipedia.py page <title>")
                sys.exit(2)
            result = fetch_page(args.title.strip(), session)
            print(json.dumps(result, ensure_ascii=False, indent=2))

        else:  # search
            if not args.query.strip():
                _err("Error: query must not be empty.")
                _err("Usage: python fetch_wikipedia.py search <query>")
                sys.exit(2)
            results = search_wikipedia(args.query.strip(), args.limit, session)
            print(json.dumps(results, ensure_ascii=False, indent=2))

        sys.exit(0)

    except ValueError as exc:
        msg = str(exc)
        if "disambiguation" in msg:
            err_obj: dict[str, str] = {
                "error": msg,
                "kind": "disambiguation",
                "hint": "Use the search subcommand to enumerate candidates.",
            }
        else:
            err_obj = {"error": msg}
        print(json.dumps(err_obj, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
    except requests.exceptions.ConnectionError as exc:
        _err(f"Network error: {exc}")
        _err("Retry hint: check your internet connection and try again.")
        sys.exit(3)
    except requests.exceptions.Timeout:
        _err("Request timed out while contacting Wikipedia.")
        _err("Retry hint: Wikipedia may be slow; try again in a few minutes.")
        sys.exit(3)
    except requests.exceptions.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else "unknown"
        _err(f"HTTP error {code} from Wikipedia.")
        _err("Retry hint: Wikipedia may be experiencing issues; try again later.")
        sys.exit(3)


if __name__ == "__main__":
    main()
