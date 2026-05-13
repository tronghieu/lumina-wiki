"""
fetch_core.py — CORE Discovery API wrapper (search + download-url).

CLI:
    python fetch_core.py search <query> [--limit N]
    python fetch_core.py download-url <core_id>

Requires CORE_API_KEY (free tier: ~1000 req/day; obtain at
https://core.ac.uk/services/api). When unset, this fetcher refuses to run
so the orchestrator can short-circuit the ladder and skip CORE silently.

JSON emitted to stdout on success. Errors → stderr; exit codes:
    0  success
    2  user error (missing key, bad input, 404, 401/403)
    3  internal/transient (network, 5xx, 429 after retry exhaustion)

The 429 path emits a `_rate_limited: true` flag in the JSON when the API
hands back a soft 429 with cached metadata; the orchestrator uses this to
skip CORE for the remainder of its run.

Cache TTLs: 7d for download-url (stable once issued), 1h for search.
Retry: urllib3.util.Retry total=3 on 500/502/503/504. 429 is NOT retried
inside the session (rate-limit windows are minutes long) — caller handles.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from _cache import wrap_session
from id_utils import build_source_entry, normalize_external_id

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

CORE_API_BASE = "https://api.core.ac.uk/v3"
REQUEST_TIMEOUT = 30
SEARCH_CACHE_TTL = 3600         # 1 hour
WORK_CACHE_TTL = 7 * 86400      # 7 days

ENV_KEY_NAME = "CORE_API_KEY"
PROVIDER = "core"

# Sentinel exit code for "ratelimited" so resolve_pdf can detect cleanly.
EXIT_RATE_LIMITED = 4


def _err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _ua() -> str:
    try:
        pkg = Path(__file__).resolve().parent.parent.parent / "package.json"
        if pkg.is_file():
            data = json.loads(pkg.read_text(encoding="utf-8"))
            ver = data.get("version", "0.0.0")
            return f"lumina-wiki/{ver} (research-pack; core fetcher)"
    except (OSError, ValueError, KeyError):
        pass
    return "lumina-wiki/0 (research-pack; core fetcher)"


def _make_session(api_key: str, *, namespace: str, ttl_seconds: int) -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": _ua(),
        "Authorization": f"Bearer {api_key}",
    })
    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=(500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "POST"]),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    # No `strip_params` — CORE's API key lives in the Authorization header,
    # not in query string, so the cache key is unaffected.
    return wrap_session(session, namespace=namespace, ttl_seconds=ttl_seconds)


def _raise_for_response(resp: requests.Response, url: str) -> None:
    """Map HTTP status → exception. 429 raises a sentinel RuntimeError."""
    if resp.status_code == 429:
        raise RuntimeError("CORE_RATE_LIMITED")
    if resp.status_code in (401, 403):
        raise ValueError(
            f"CORE rejected credentials ({resp.status_code}). "
            "Verify CORE_API_KEY is valid and active."
        )
    if resp.status_code == 404:
        raise ValueError(f"CORE returned 404 for {url}")
    if resp.status_code >= 500:
        raise RuntimeError(f"CORE API returned HTTP {resp.status_code}")
    resp.raise_for_status()


def _normalize_work(raw: dict[str, Any]) -> dict[str, Any]:
    """Map a CORE Work record → discover-compatible JSON shape."""
    core_id = raw.get("id")
    if isinstance(core_id, int):
        core_id = str(core_id)
    if not isinstance(core_id, str):
        core_id = ""

    title = raw.get("title") or ""
    abstract = raw.get("abstract") or ""
    year = raw.get("yearPublished")
    if not isinstance(year, int):
        year = None

    authors_raw = raw.get("authors") if isinstance(raw.get("authors"), list) else []
    authors: list[dict[str, Any]] = []
    for a in authors_raw:
        if isinstance(a, dict):
            name = a.get("name")
            if isinstance(name, str) and name:
                authors.append({"name": name})
        elif isinstance(a, str) and a:
            authors.append({"name": a})

    # External IDs — DOI is the common cross-walk.
    ext_ids: dict[str, str] = {}
    doi_raw = raw.get("doi")
    if isinstance(doi_raw, str) and doi_raw:
        n = normalize_external_id("doi", doi_raw)
        if n["valid"]:
            ext_ids["doi"] = n["id"]

    download_url = raw.get("downloadUrl")
    if not isinstance(download_url, str):
        download_url = ""

    sources: list[dict[str, Any]] = []
    if ext_ids.get("doi"):
        sources.append(build_source_entry(PROVIDER, ns="doi", value=ext_ids["doi"]))
    if core_id:
        # CORE doesn't have a registered external_ids namespace yet — record
        # provenance only via the canonical work URL so the entry is still
        # validated by buildSourceEntry's URL check.
        sources.append(
            build_source_entry(
                PROVIDER, url=f"https://core.ac.uk/works/{core_id}"
            )
        )
    if download_url.startswith("https://"):
        sources.append(build_source_entry(PROVIDER, url=download_url))

    return {
        "core_id": core_id,
        "title": title if isinstance(title, str) else "",
        "authors": authors,
        "year": year,
        "abstract": abstract if isinstance(abstract, str) else "",
        "download_url": download_url,
        "external_ids": ext_ids,
        "sources": sources,
        "_provider": PROVIDER,
    }


def cmd_search(query: str, limit: int, api_key: str) -> list[dict[str, Any]]:
    session = _make_session(api_key, namespace="core-search", ttl_seconds=SEARCH_CACHE_TTL)
    # CORE v3 search takes `q` and `limit` as JSON body OR query string;
    # we use GET-with-params so the cache wrapper can canonicalize.
    params = {"q": query, "limit": max(1, min(limit, 100))}
    url = f"{CORE_API_BASE}/search/works"
    resp = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
    _raise_for_response(resp, url)
    try:
        data = resp.json()
    except ValueError as exc:
        raise RuntimeError(f"CORE returned malformed JSON: {exc}") from exc
    results = data.get("results", []) if isinstance(data, dict) else []
    if not isinstance(results, list):
        return []
    return [_normalize_work(r) for r in results if isinstance(r, dict)]


def cmd_download_url(core_id: str, api_key: str) -> dict[str, Any]:
    if not core_id.strip().isdigit():
        raise ValueError(f"core_id must be numeric, got {core_id!r}")
    session = _make_session(api_key, namespace="core-work", ttl_seconds=WORK_CACHE_TTL)
    url = f"{CORE_API_BASE}/works/{core_id.strip()}"
    resp = session.get(url, timeout=REQUEST_TIMEOUT)
    _raise_for_response(resp, url)
    try:
        data = resp.json()
    except ValueError as exc:
        raise RuntimeError(f"CORE returned malformed JSON: {exc}") from exc

    download_url = data.get("downloadUrl") if isinstance(data, dict) else ""
    if not isinstance(download_url, str) or not download_url.startswith("https://"):
        return {"core_id": core_id, "pdf_url": "", "mime_type": "", "sources": []}

    sources = [build_source_entry(PROVIDER, url=download_url)]
    return {
        "core_id": core_id,
        "pdf_url": download_url,
        "mime_type": "application/pdf",
        "sources": sources,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="fetch_core.py",
        description=(
            "Query CORE (https://core.ac.uk) for OA papers. Requires CORE_API_KEY."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    s = sub.add_parser("search", help="Search CORE works by keyword.")
    s.add_argument("query", help="Free-text query string.")
    s.add_argument("--limit", type=int, default=10, help="Max results (1–100, default 10).")

    d = sub.add_parser("download-url", help="Look up the canonical OA URL for a CORE work id.")
    d.add_argument("core_id", help="CORE numeric work id.")

    args = parser.parse_args(argv)

    env = load_env()
    api_key = (env.get(ENV_KEY_NAME) or "").strip()
    if not api_key:
        _err(
            f"Error: {ENV_KEY_NAME} not set. CORE requires an API key on every "
            "request. Get one at https://core.ac.uk/services/api and add "
            "CORE_API_KEY=… to your .env file."
        )
        sys.exit(2)

    try:
        if args.command == "search":
            if not args.query.strip():
                _err("Error: query must not be empty.")
                sys.exit(2)
            result = cmd_search(args.query.strip(), args.limit, api_key)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            sys.exit(0)

        # download-url
        result_d = cmd_download_url(args.core_id, api_key)
        print(json.dumps(result_d, ensure_ascii=False, indent=2))
        sys.exit(0)

    except ValueError as exc:
        _err(f"Error: {exc}")
        sys.exit(2)
    except RuntimeError as exc:
        if str(exc) == "CORE_RATE_LIMITED":
            _err("CORE rate-limited (HTTP 429). Skip and retry later.")
            print(json.dumps({"_rate_limited": True}, ensure_ascii=False))
            sys.exit(EXIT_RATE_LIMITED)
        _err(f"API error: {exc}")
        sys.exit(3)
    except requests.exceptions.ConnectionError as exc:
        _err(f"Network error: {exc}")
        sys.exit(3)
    except requests.exceptions.Timeout:
        _err("Request timed out while contacting CORE.")
        sys.exit(3)
    except requests.exceptions.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else "unknown"
        _err(f"HTTP error {code} from CORE.")
        sys.exit(3)


if __name__ == "__main__":
    main()
