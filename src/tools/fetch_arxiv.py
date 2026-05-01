"""
fetch_arxiv.py — arXiv API + RSS feed wrapper.

CLI:
    python fetch_arxiv.py search <query> [--max N] [--start N]
    python fetch_arxiv.py daily <category>

JSON emitted to stdout on success.
Errors emitted to stderr; exit codes:
    0  success
    2  user error (bad input, missing args) — actionable message
    3  internal/transient error (network, API 5xx) — includes retry hint

No API key required for arXiv. All network calls use requests.Session().
"""

from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ARXIV_API_BASE = "https://export.arxiv.org/api/query"
ARXIV_RSS_BASE = "https://rss.arxiv.org/rss"
ATOM_NS = "http://www.w3.org/2005/Atom"
ARXIV_NS = "http://arxiv.org/schemas/atom"
OPENSEARCH_NS = "http://a9.com/-/spec/opensearch/1.1/"

# Default timeout for HTTP requests (seconds)
REQUEST_TIMEOUT = 30


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _atom_tag(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


def _text(el: ET.Element | None) -> str:
    if el is None:
        return ""
    return (el.text or "").strip()


def _parse_entry(entry: ET.Element) -> dict[str, Any]:
    """Parse a single arXiv Atom feed <entry> into a plain dict."""
    arxiv_id_url = _text(entry.find(_atom_tag(ATOM_NS, "id")))
    # Convert URL like https://arxiv.org/abs/2301.00234v1 to bare ID
    arxiv_id = arxiv_id_url.split("/abs/")[-1] if "/abs/" in arxiv_id_url else arxiv_id_url

    authors = [
        _text(a.find(_atom_tag(ATOM_NS, "name")))
        for a in entry.findall(_atom_tag(ATOM_NS, "author"))
    ]

    categories = [
        c.get("term", "")
        for c in entry.findall(_atom_tag(ATOM_NS, "category"))
    ]

    primary_cat_el = entry.find(_atom_tag(ARXIV_NS, "primary_category"))
    primary_category = primary_cat_el.get("term", "") if primary_cat_el is not None else ""

    return {
        "id": arxiv_id,
        "title": _text(entry.find(_atom_tag(ATOM_NS, "title"))),
        "authors": authors,
        "summary": _text(entry.find(_atom_tag(ATOM_NS, "summary"))),
        "published": _text(entry.find(_atom_tag(ATOM_NS, "published"))),
        "updated": _text(entry.find(_atom_tag(ATOM_NS, "updated"))),
        "primary_category": primary_category,
        "categories": categories,
        "url": arxiv_id_url,
    }


def _parse_rss_item(item: ET.Element) -> dict[str, Any]:
    """Parse a single RSS <item> element into a plain dict."""
    title_el = item.find("title")
    link_el = item.find("link")
    desc_el = item.find("description")
    guid_el = item.find("guid")

    raw_link = _text(link_el)
    arxiv_id = raw_link.split("/abs/")[-1] if "/abs/" in raw_link else raw_link

    return {
        "id": arxiv_id,
        "title": _text(title_el),
        "url": raw_link,
        "guid": _text(guid_el),
        "description": _text(desc_el),
    }


# ---------------------------------------------------------------------------
# Session factory
# ---------------------------------------------------------------------------

def _make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": "lumina-wiki/0.1 (research-pack fetcher)"})
    return session


# ---------------------------------------------------------------------------
# Core fetch functions
# ---------------------------------------------------------------------------

def search_arxiv(
    query: str,
    max_results: int = 10,
    start: int = 0,
    session: requests.Session | None = None,
) -> list[dict[str, Any]]:
    """Search arXiv via the Atom API.

    Args:
        query: Search query string (arXiv query syntax supported).
        max_results: Maximum number of results to return.
        start: Offset for pagination.
        session: Optional requests.Session for connection reuse.

    Returns:
        List of paper dicts.

    Raises:
        requests.RequestException: on network failure.
        ValueError: on bad API response.
    """
    sess = session or _make_session()
    params = {
        "search_query": query,
        "start": start,
        "max_results": max_results,
    }
    resp = sess.get(ARXIV_API_BASE, params=params, timeout=REQUEST_TIMEOUT)
    if resp.status_code >= 500:
        raise ValueError(f"arXiv API returned HTTP {resp.status_code}")
    resp.raise_for_status()

    root = ET.fromstring(resp.text)
    entries = root.findall(_atom_tag(ATOM_NS, "entry"))
    return [_parse_entry(e) for e in entries]


def daily_arxiv(
    category: str,
    session: requests.Session | None = None,
) -> list[dict[str, Any]]:
    """Fetch today's new submissions for a given arXiv category via RSS.

    Args:
        category: arXiv category slug, e.g. 'cs.LG', 'math.CO'.
        session: Optional requests.Session for connection reuse.

    Returns:
        List of paper dicts from the RSS feed.

    Raises:
        requests.RequestException: on network failure.
        ValueError: on bad RSS response.
    """
    sess = session or _make_session()
    url = f"{ARXIV_RSS_BASE}/{quote_plus(category)}"
    resp = sess.get(url, timeout=REQUEST_TIMEOUT)
    if resp.status_code >= 500:
        raise ValueError(f"arXiv RSS returned HTTP {resp.status_code}")
    resp.raise_for_status()

    root = ET.fromstring(resp.text)
    channel = root.find("channel")
    if channel is None:
        return []
    items = channel.findall("item")
    return [_parse_rss_item(item) for item in items]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="fetch_arxiv.py",
        description="Fetch papers from arXiv API or RSS feed.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # search subcommand
    search_parser = subparsers.add_parser("search", help="Search arXiv by query string.")
    search_parser.add_argument("query", help="arXiv search query (e.g. 'flash attention transformer').")
    search_parser.add_argument("--max", type=int, default=10, dest="max_results",
                               help="Maximum results to return (default: 10).")
    search_parser.add_argument("--start", type=int, default=0,
                               help="Result offset for pagination (default: 0).")

    # daily subcommand
    daily_parser = subparsers.add_parser("daily", help="Fetch today's new submissions for a category.")
    daily_parser.add_argument("category", help="arXiv category slug, e.g. cs.LG, math.CO.")

    args = parser.parse_args(argv)
    session = _make_session()

    try:
        if args.command == "search":
            if not args.query.strip():
                _err("Error: query must not be empty.")
                _err("Usage: python fetch_arxiv.py search <query>")
                sys.exit(2)
            results = search_arxiv(args.query, args.max_results, args.start, session)
        else:  # daily
            if not args.category.strip():
                _err("Error: category must not be empty.")
                _err("Usage: python fetch_arxiv.py daily <category>  (e.g. cs.LG)")
                sys.exit(2)
            results = daily_arxiv(args.category, session)

        print(json.dumps(results, ensure_ascii=False, indent=2))
        sys.exit(0)

    except requests.exceptions.ConnectionError as exc:
        _err(f"Network error: {exc}")
        _err("Retry hint: check your internet connection and try again.")
        sys.exit(3)
    except requests.exceptions.Timeout:
        _err("Request timed out while contacting arXiv.")
        _err("Retry hint: arXiv may be slow; try again in a few minutes.")
        sys.exit(3)
    except requests.exceptions.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else "unknown"
        _err(f"HTTP error {code} from arXiv.")
        _err("Retry hint: arXiv may be experiencing issues; try again later.")
        sys.exit(3)
    except ValueError as exc:
        _err(f"API error: {exc}")
        _err("Retry hint: arXiv API may be returning malformed data; try again later.")
        sys.exit(3)
    except ET.ParseError as exc:
        _err(f"Failed to parse arXiv response XML: {exc}")
        _err("Retry hint: try again; arXiv may be returning partial responses.")
        sys.exit(3)


if __name__ == "__main__":
    main()
