"""
fetch_openalex.py — OpenAlex API wrapper.

CLI:
    python fetch_openalex.py work <id>
    python fetch_openalex.py search <query> [--limit N] [--filter k=v ...]

`<id>` accepts a DOI, an OpenAlex Work ID (W…), or a full openalex.org URL.

OpenAlex accepts unauthenticated requests for some endpoints, but current
OpenAlex docs use `api_key=...` for authentication, rate limits, and usage
tracking. Set OPENALEX_API_KEY to attach that query parameter. The key is
stripped from cache keys so the same logical request collapses onto the same
disk entry regardless of who is asking.

JSON emitted to stdout on success. Errors → stderr; exit codes:
    0  success
    2  user error (bad input, work not found)            — actionable
    3  internal/transient error (network, API 5xx)        — includes retry hint

Cache TTLs (via _cache.wrap_session):
    work-by-id  → 7d (slow-moving record)
    search      → 1h (catalogues update daily)

Retry policy: urllib3.util.Retry(total=3, backoff_factor=0.5,
status_forcelist=[500,502,503,504]) mounted on the session. 429 → read
`Retry-After`, sleep up to 30s, retry once; if absent, fail fast.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Iterable

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from _cache import wrap_session
from id_utils import (
    EXTERNAL_ID_PATTERNS,
    build_source_entry,
    expand_external_ids,
    normalize_external_id,
)

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

OPENALEX_API_BASE = "https://api.openalex.org"
REQUEST_TIMEOUT = 30
WORK_CACHE_TTL = 7 * 86400  # 7 days
SEARCH_CACHE_TTL = 3600     # 1 hour

ENV_KEY_NAME = "OPENALEX_API_KEY"
PROVIDER = "openalex"

# Lumina-Wiki UA tag — fall back to a generic version if package.json is
# unreadable for any reason (CI sandboxes, partial installs).
def _ua() -> str:
    try:
        pkg = Path(__file__).resolve().parent.parent.parent / "package.json"
        if pkg.is_file():
            data = json.loads(pkg.read_text(encoding="utf-8"))
            ver = data.get("version", "0.0.0")
            return f"lumina-wiki/{ver} (research-pack; openalex fetcher)"
    except (OSError, ValueError, KeyError):
        pass
    return "lumina-wiki/0 (research-pack; openalex fetcher)"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_API_KEY_WARN_EMITTED = False


def _err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _warn_unauthenticated_once() -> None:
    """Emit a single warning per process when OPENALEX_API_KEY is unset.

    The value itself is never logged — only the namespace presence.
    """
    global _API_KEY_WARN_EMITTED
    if _API_KEY_WARN_EMITTED:
        return
    _err(
        "Warning: OPENALEX_API_KEY is not set; using unauthenticated OpenAlex "
        "requests. Set it in your .env for OpenAlex's free daily API budget "
        "and usage visibility."
    )
    _API_KEY_WARN_EMITTED = True


def _get_api_key() -> str:
    env = load_env()
    raw = env.get(ENV_KEY_NAME, "").strip()
    return raw if raw else ""


def _make_session(api_key: str, *, namespace: str, ttl_seconds: int) -> requests.Session:
    """Build a retry-mounted, API-key-aware, cache-wrapped session.

    `namespace` selects the cache bucket (`openalex-work` or `openalex-search`).
    `api_key` is stripped from the cache key so authenticated and
    unauthenticated runs of the same logical request collapse onto the same
    on-disk slot.
    """
    session = requests.Session()
    session.headers.update({"User-Agent": _ua()})

    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=(500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        respect_retry_after_header=False,  # we handle 429 explicitly below
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    return wrap_session(
        session,
        namespace=namespace,
        ttl_seconds=ttl_seconds,
        strip_params=["api_key"],
    )


def _params_with_api_key(params: dict[str, Any], api_key: str) -> dict[str, Any]:
    """Return a copy of `params` with `api_key` appended if set."""
    if api_key:
        merged = dict(params)
        merged["api_key"] = api_key
        return merged
    return params


def _request_json(session: requests.Session, url: str, params: dict[str, Any]) -> dict[str, Any]:
    """GET + retry-on-429 + decode JSON. Raises ValueError/RuntimeError on failure."""
    resp = session.get(url, params=params, timeout=REQUEST_TIMEOUT)

    if resp.status_code == 429:
        ra = resp.headers.get("Retry-After")
        if ra:
            try:
                delay = min(30, max(0, int(ra)))
            except ValueError:
                delay = 5
            time.sleep(delay)
            resp = session.get(url, params=params, timeout=REQUEST_TIMEOUT)

    if resp.status_code == 404:
        raise ValueError(f"OpenAlex returned 404 for {url}")
    if resp.status_code in (401, 403):
        raise ValueError("OpenAlex rejected the API key. Check OPENALEX_API_KEY.")
    if resp.status_code == 429:
        raise RuntimeError("OpenAlex rate-limited after retry.")
    if resp.status_code >= 500:
        raise RuntimeError(f"OpenAlex API returned HTTP {resp.status_code}")
    resp.raise_for_status()

    try:
        return resp.json()
    except ValueError as exc:
        raise RuntimeError(f"OpenAlex returned malformed JSON: {exc}") from exc


# ---------------------------------------------------------------------------
# ID parsing — accept DOI, OpenAlex W-id, or full URL on the CLI
# ---------------------------------------------------------------------------

_ARXIV_DOI_RE = EXTERNAL_ID_PATTERNS["doi_arxiv"]


def _path_for_id(raw: str) -> str:
    """Build the `/works/<id>` path for a user-supplied identifier.

    Accepts: bare OpenAlex W-id, DOI in any URL form, openalex.org URL.
    OpenAlex's API resolves `/works/doi:<doi>` and `/works/W<n>` directly.
    """
    s = (raw or "").strip()
    if not s:
        raise ValueError("Empty identifier.")

    oa = normalize_external_id("openalex", s)
    if oa["valid"]:
        return f"/works/{oa['id']}"

    doi = normalize_external_id("doi", s)
    if doi["valid"]:
        return f"/works/doi:{doi['id']}"

    raise ValueError(
        f"Identifier '{raw}' is neither a valid DOI nor a valid OpenAlex Work ID."
    )


# ---------------------------------------------------------------------------
# Normalize — map OpenAlex record → discover-compatible shape
# ---------------------------------------------------------------------------

def _take(ns: str, raw: Any) -> tuple[str, str] | None:
    if not isinstance(raw, str) or not raw:
        return None
    r = normalize_external_id(ns, raw)
    if r["valid"] and r["id"]:
        return (ns, r["id"])
    _err(f"[warn] fetch_openalex dropped invalid external_id {ns}={raw!r}")
    return None


def _normalize_authors(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        author = item.get("author")
        if not isinstance(author, dict):
            continue
        name = author.get("display_name")
        if not isinstance(name, str) or not name:
            continue
        entry: dict[str, Any] = {"name": name}
        orcid = author.get("orcid")
        if isinstance(orcid, str) and orcid:
            entry["orcid"] = orcid
        out.append(entry)
    return out


def _reassemble_abstract(inv: Any) -> str:
    """OpenAlex stores abstracts as inverted indexes {word: [positions]}."""
    if not isinstance(inv, dict) or not inv:
        return ""
    by_pos: dict[int, str] = {}
    for word, positions in inv.items():
        if not isinstance(word, str) or not isinstance(positions, list):
            continue
        for p in positions:
            if isinstance(p, int) and p >= 0:
                by_pos[p] = word
    if not by_pos:
        return ""
    return " ".join(by_pos[i] for i in sorted(by_pos))


def normalize_record(raw: dict[str, Any]) -> dict[str, Any]:
    """Map a raw OpenAlex Work into the discover-compatible JSON shape.

    Output contract:
      title, authors[], year, abstract, external_ids{}, sources[], oa_url?, is_oa, _provider
    """
    if not isinstance(raw, dict):
        return {}

    candidates: list[tuple[str, str]] = []

    # OpenAlex Work ID lives at `id` as a full URL: https://openalex.org/W…
    oa_url_id = raw.get("id")
    kv = _take("openalex", oa_url_id) if isinstance(oa_url_id, str) else None
    if kv:
        candidates.append(kv)

    # ids.doi may be a full URL or a bare doi — normalize handles both.
    ids = raw.get("ids") if isinstance(raw.get("ids"), dict) else {}
    if "doi" in ids:
        kv = _take("doi", ids.get("doi"))
        if kv:
            candidates.append(kv)
    # Top-level `doi` is sometimes populated even when `ids.doi` is missing.
    if not any(ns == "doi" for ns, _ in candidates) and "doi" in raw:
        kv = _take("doi", raw.get("doi"))
        if kv:
            candidates.append(kv)

    ext_ids = dict(candidates)
    ext_ids = expand_external_ids(ext_ids)  # arxiv-DOI cross-walk

    # Sources provenance — one entry per identifier resolved.
    sources: list[dict[str, Any]] = []
    for ns, value in ext_ids.items():
        sources.append(
            build_source_entry(PROVIDER, ns=ns, value=value)
        )

    # PDF hint (top-level helper; ladder consumes this directly).
    oa_loc = raw.get("best_oa_location")
    oa_url = ""
    if isinstance(oa_loc, dict):
        candidate = oa_loc.get("pdf_url")
        if isinstance(candidate, str) and candidate.startswith("https://"):
            oa_url = candidate

    title = raw.get("title") or raw.get("display_name") or ""
    year = raw.get("publication_year")
    if not isinstance(year, int):
        year = None
    abstract = _reassemble_abstract(raw.get("abstract_inverted_index"))
    is_oa = bool(raw.get("open_access", {}).get("is_oa")) if isinstance(raw.get("open_access"), dict) else False

    record: dict[str, Any] = {
        "title": title if isinstance(title, str) else "",
        "authors": _normalize_authors(raw.get("authorships")),
        "year": year,
        "abstract": abstract,
        "external_ids": ext_ids,
        "sources": sources,
        "is_oa": is_oa,
        "_provider": PROVIDER,
    }
    if oa_url:
        record["oa_url"] = oa_url
        # Record the candidate PDF URL provenance too.
        record["sources"].append(
            build_source_entry(PROVIDER, url=oa_url)
        )
    return record


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

def cmd_work(raw_id: str, api_key: str) -> dict[str, Any]:
    path = _path_for_id(raw_id)
    session = _make_session(api_key, namespace="openalex-work", ttl_seconds=WORK_CACHE_TTL)
    params = _params_with_api_key({}, api_key)
    data = _request_json(session, OPENALEX_API_BASE + path, params)
    return normalize_record(data)


def _validate_filter(value: str) -> tuple[str, str]:
    if "=" not in value:
        raise argparse.ArgumentTypeError(f"--filter must be key=value, got {value!r}")
    k, v = value.split("=", 1)
    k = k.strip()
    v = v.strip()
    if not k or not v:
        raise argparse.ArgumentTypeError(f"--filter must be key=value, got {value!r}")
    if not re.match(r"^[a-z_][a-z0-9_.]*$", k):
        raise argparse.ArgumentTypeError(f"--filter key {k!r} has invalid characters.")
    return (k, v)


def cmd_search(query: str, limit: int, filters: Iterable[tuple[str, str]], api_key: str) -> list[dict[str, Any]]:
    session = _make_session(api_key, namespace="openalex-search", ttl_seconds=SEARCH_CACHE_TTL)
    params: dict[str, Any] = {"search": query, "per_page": max(1, min(limit, 100))}
    if filters:
        params["filter"] = ",".join(f"{k}:{v}" for k, v in filters)
    params = _params_with_api_key(params, api_key)
    data = _request_json(session, OPENALEX_API_BASE + "/works", params)
    results = data.get("results", []) if isinstance(data, dict) else []
    if not isinstance(results, list):
        return []
    return [normalize_record(r) for r in results if isinstance(r, dict)]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="fetch_openalex.py",
        description=(
            "Fetch metadata from OpenAlex. Set OPENALEX_API_KEY to attach the "
            "current OpenAlex api_key query parameter."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    w = sub.add_parser("work", help="Fetch a single Work by DOI or OpenAlex Work ID.")
    w.add_argument("id", help="DOI (10.x/y), OpenAlex Work ID (W…), or full openalex.org URL.")

    s = sub.add_parser("search", help="Search works by keyword.")
    s.add_argument("query", help="Search query string.")
    s.add_argument("--limit", type=int, default=10, help="Max results per page (1–100, default 10).")
    s.add_argument(
        "--filter",
        dest="filters",
        action="append",
        type=_validate_filter,
        default=[],
        help="OpenAlex filter expr key=value (repeatable). Example: --filter from_publication_date=2024-01-01.",
    )

    args = parser.parse_args(argv)

    api_key = _get_api_key()
    if not api_key:
        _warn_unauthenticated_once()

    try:
        if args.command == "work":
            if not args.id.strip():
                _err("Error: id must not be empty.")
                sys.exit(2)
            result = cmd_work(args.id.strip(), api_key)
            print(json.dumps(result, ensure_ascii=False, indent=2))

        else:  # search
            if not args.query.strip():
                _err("Error: query must not be empty.")
                sys.exit(2)
            result = cmd_search(args.query.strip(), args.limit, args.filters, api_key)
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
        _err("Request timed out while contacting OpenAlex.")
        _err("Retry hint: OpenAlex may be slow; try again in a few minutes.")
        sys.exit(3)
    except requests.exceptions.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else "unknown"
        _err(f"HTTP error {code} from OpenAlex.")
        _err("Retry hint: try again later.")
        sys.exit(3)


if __name__ == "__main__":
    main()
