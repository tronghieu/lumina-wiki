"""
fetch_rss.py — Poll an RSS / Atom feed and emit discover-compatible JSON.

CLI:
    python fetch_rss.py poll -- <feed_url> [--max N] [--ignore-etag] [--feed-id ID]

The `--` separator before `<feed_url>` is REQUIRED when the URL is user-
supplied; it neutralizes a maliciously crafted feed entry like
`--allow-http=true` reaching argparse as a flag. Schema validation in
watchlist-config.mjs additionally enforces `^https://`.

Per-feed state lives in `_lumina/_state/feeds/<feed-id>.json`:
    {
      "etag": "...",
      "last_modified": "...",
      "last_seen_guids": {"<guid>": "<first_seen_iso>", ...},
      "last_run": "<iso>",
      "item_count": <int>,
      "poll_count": <int>
    }

Output JSON to stdout:
    {
      "items": [...],         # normalized; each has external_ids + sources
      "state": {"etag": "...", "last_modified": "..."},
      "cache_hit": <bool>,
      "error": "<msg>"        # only on hard failure (XXE, bad XML, network)
    }

Exit codes:
    0  success (including 304 / empty)
    2  user error (bad URL, malformed args)
    3  transient (network, 5xx exhausted)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from fetch_pdf import _safe_url
from id_utils import build_source_entry, extract_ids_from_text

REQUEST_TIMEOUT = 30
MAX_BODY_BYTES = 5 * 1024 * 1024  # 5 MiB
LAST_SEEN_CAP = 5000
LAST_SEEN_MAX_AGE_DAYS = 90
DEFAULT_MAX_NEW = 20
FORCE_REFETCH_INTERVAL = 10  # every 10th poll bypasses etag

PROVIDER = "rss"


def _err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _ua() -> str:
    try:
        pkg = Path(__file__).resolve().parent.parent.parent / "package.json"
        if pkg.is_file():
            data = json.loads(pkg.read_text(encoding="utf-8"))
            ver = data.get("version", "0.0.0")
            return f"lumina-wiki/{ver} (research-pack; rss fetcher)"
    except (OSError, ValueError, KeyError):
        pass
    return "lumina-wiki/0 (research-pack; rss fetcher)"


# ---------------------------------------------------------------------------
# State management — one file per feed under _lumina/_state/feeds/
# ---------------------------------------------------------------------------

_FEED_ID_SAFE_RE = re.compile(r"[^a-z0-9-]+")


def _safe_feed_id(raw: str) -> str:
    """Slugify a feed-id input. Empty input falls back to a hash of the URL."""
    s = (raw or "").strip().lower()
    s = _FEED_ID_SAFE_RE.sub("-", s).strip("-")
    return s[:64] or "feed"


def _feed_id_from_url(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


def _state_dir(project_root: Path) -> Path:
    d = project_root / "_lumina" / "_state" / "feeds"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _read_state(state_path: Path) -> dict[str, Any]:
    try:
        with state_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
    except (OSError, json.JSONDecodeError):
        pass
    return {
        "etag": "",
        "last_modified": "",
        "last_seen_guids": {},
        "last_run": "",
        "item_count": 0,
        "poll_count": 0,
    }


def _write_state(state_path: Path, state: dict[str, Any]) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".tmp-", dir=str(state_path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, state_path)
        # State files contain ETags and per-feed metadata — restrict perms
        # so a local attacker can't tamper to force re-fetch or replay items.
        try:
            os.chmod(state_path, 0o600)
        except OSError:
            pass  # Windows / network FS may not honor — best-effort.
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _evict_last_seen(seen: dict[str, str]) -> dict[str, str]:
    """Drop entries older than LAST_SEEN_MAX_AGE_DAYS, then FIFO-cap at LAST_SEEN_CAP.

    Unparsable timestamps are treated as oldest (`-inf`) so they get evicted
    first under both the age filter and the FIFO cap. This prevents an
    adversarial feed from flooding `last_seen_guids` with garbage timestamps
    to push out legitimate fresh GUIDs and replay old entries.
    """
    if not seen:
        return {}
    cutoff = datetime.now(timezone.utc).timestamp() - (LAST_SEEN_MAX_AGE_DAYS * 86400)
    fresh: list[tuple[float, str, str]] = []
    for guid, ts in seen.items():
        try:
            stamp = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
        except (ValueError, AttributeError):
            stamp = float("-inf")  # treat as oldest — evict first
        if stamp >= cutoff:
            fresh.append((stamp, guid, ts))
    fresh.sort(key=lambda t: t[0])
    if len(fresh) > LAST_SEEN_CAP:
        fresh = fresh[-LAST_SEEN_CAP:]
    return {guid: ts for _, guid, ts in fresh}


# ---------------------------------------------------------------------------
# HTTP layer — retry + size cap + XXE pre-parse
# ---------------------------------------------------------------------------

def _make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": _ua()})
    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=(500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    s.mount("https://", adapter)
    return s


def _is_safe_xml(body: bytes) -> bool:
    """Pre-parse via defusedxml to reject DOCTYPE / billion-laughs payloads.

    Returns True if the body parses without triggering any defusedxml-blocked
    construct (entities, DTDs, external references, unsupported features).
    We discard the parsed tree — feedparser does the real parsing once we
    know the input is safe.
    """
    try:
        from defusedxml.ElementTree import fromstring as defused_fromstring
        from defusedxml.common import DefusedXmlException
    except ImportError:
        # If defusedxml isn't installed, fail closed — better safe than XXE.
        _err("Warning: defusedxml not installed; refusing to parse feed body.")
        return False
    try:
        defused_fromstring(body)
    except DefusedXmlException:
        # Covers EntitiesForbidden, DTDForbidden, ExternalReferenceForbidden,
        # NotSupportedError — every defusedxml-flagged attack vector.
        return False
    except Exception:
        # Non-XML payloads (or quirky feeds) — defer judgement to feedparser.
        # feedparser tolerates many malformed inputs; defusedxml is strict.
        # We treat parse errors as "safe to hand to feedparser" because they
        # were not caused by an entity / external-reference attack.
        return True
    return True


# ---------------------------------------------------------------------------
# Item normalization — convert feedparser entries → discover-compatible items
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _entry_text(entry: Any) -> str:
    """Concatenate title + summary + link hrefs for ID extraction."""
    parts: list[str] = []
    title = getattr(entry, "title", "") or ""
    summary = getattr(entry, "summary", "") or getattr(entry, "description", "") or ""
    parts.append(str(title))
    parts.append(str(summary))
    links = getattr(entry, "links", None) or []
    for link in links:
        href = getattr(link, "href", None) if not isinstance(link, dict) else link.get("href")
        if isinstance(href, str):
            parts.append(href)
    fallback_link = getattr(entry, "link", "") or ""
    if isinstance(fallback_link, str):
        parts.append(fallback_link)
    return " ".join(parts)


def _entry_guid(entry: Any, feed_url: str) -> str:
    """Best-effort stable identifier per entry."""
    for attr in ("id", "guid"):
        val = getattr(entry, attr, "") or ""
        if isinstance(val, str) and val.strip():
            return val.strip()
    link = getattr(entry, "link", "") or ""
    if isinstance(link, str) and link.strip():
        return f"link:{link.strip()}"
    title = getattr(entry, "title", "") or ""
    return f"title:{feed_url}:{title}"


def _normalize_entry(entry: Any, feed_url: str, extract_dois: bool) -> dict[str, Any]:
    text = _entry_text(entry)
    ids = extract_ids_from_text(text) if extract_dois else {"doi": None, "arxiv": None, "openalex": None}

    external_ids: dict[str, str] = {}
    if ids.get("doi"):
        external_ids["doi"] = ids["doi"]
    if ids.get("arxiv"):
        external_ids["arxiv"] = ids["arxiv"]
    if ids.get("openalex"):
        external_ids["openalex"] = ids["openalex"]
    link = getattr(entry, "link", "") or ""
    if isinstance(link, str) and link:
        external_ids["url"] = link

    sources: list[dict[str, Any]] = [build_source_entry(PROVIDER, url=feed_url)]
    if external_ids.get("doi"):
        sources.append(build_source_entry(PROVIDER, ns="doi", value=external_ids["doi"]))
    elif external_ids.get("arxiv"):
        sources.append(build_source_entry(PROVIDER, ns="arxiv", value=external_ids["arxiv"]))

    return {
        "title": str(getattr(entry, "title", "") or "").strip(),
        "summary": str(getattr(entry, "summary", "") or getattr(entry, "description", "") or "").strip(),
        "published": str(getattr(entry, "published", "") or getattr(entry, "updated", "") or ""),
        "link": link if isinstance(link, str) else "",
        "external_ids": external_ids,
        "sources": sources,
        "_provider": PROVIDER,
    }


# ---------------------------------------------------------------------------
# poll — main entry point
# ---------------------------------------------------------------------------

def poll(
    feed_url: str,
    project_root: Path,
    *,
    max_new: int = DEFAULT_MAX_NEW,
    ignore_etag: bool = False,
    feed_id: str = "",
    extract_dois: bool = True,
) -> dict[str, Any]:
    """Poll the feed once. Returns the JSON payload (no I/O side effects beyond state)."""
    feed_url = (feed_url or "").strip()
    if not feed_url:
        raise ValueError("feed_url must not be empty")
    parsed = urlsplit(feed_url)
    if parsed.scheme not in ("https",):
        raise ValueError(f"feed_url must use https scheme: {feed_url!r}")
    # SSRF guard — defense-in-depth on top of watchlist schema's https check.
    # Watchlist YAML is user-curated; a curated entry could still target an
    # internal host. Rejects private/loopback/link-local/metadata addresses.
    if not _safe_url(feed_url):
        raise ValueError(f"feed_url rejected by SSRF guard: {feed_url!r}")

    fid = _safe_feed_id(feed_id) if feed_id else _feed_id_from_url(feed_url)
    state_path = _state_dir(project_root) / f"{fid}.json"
    state = _read_state(state_path)

    poll_count = int(state.get("poll_count", 0)) + 1
    force_refetch = ignore_etag or poll_count % FORCE_REFETCH_INTERVAL == 0

    headers: dict[str, str] = {}
    if not force_refetch:
        if state.get("etag"):
            headers["If-None-Match"] = state["etag"]
        if state.get("last_modified"):
            headers["If-Modified-Since"] = state["last_modified"]

    session = _make_session()
    resp = session.get(feed_url, headers=headers, timeout=REQUEST_TIMEOUT, stream=True)

    if resp.status_code == 304:
        state["last_run"] = _now_iso()
        state["poll_count"] = poll_count
        _write_state(state_path, state)
        return {
            "items": [],
            "state": {"etag": state.get("etag", ""), "last_modified": state.get("last_modified", "")},
            "cache_hit": True,
        }

    if resp.status_code >= 400:
        raise RuntimeError(f"HTTP {resp.status_code} from feed")

    # Body size cap (read incrementally to avoid loading multi-GB feeds).
    # bytearray avoids O(n^2) reallocation from repeated `body += chunk`.
    buf = bytearray()
    for chunk in resp.iter_content(chunk_size=65536):
        if not chunk:
            continue
        buf.extend(chunk)
        if len(buf) > MAX_BODY_BYTES:
            raise RuntimeError(f"feed body exceeds {MAX_BODY_BYTES} bytes")
    body = bytes(buf)

    if not _is_safe_xml(body):
        # Don't mutate state — preserve recovery for the next poll.
        return {
            "items": [],
            "state": {"etag": state.get("etag", ""), "last_modified": state.get("last_modified", "")},
            "cache_hit": False,
            "error": "unsafe XML",
        }

    try:
        import feedparser
    except ImportError:
        raise RuntimeError("feedparser not installed — pip install feedparser")

    parsed_feed = feedparser.parse(body)
    entries = parsed_feed.get("entries", []) if isinstance(parsed_feed, dict) else parsed_feed.entries

    last_seen = dict(state.get("last_seen_guids", {}))
    now_iso = _now_iso()
    items: list[dict[str, Any]] = []
    new_guids: list[str] = []

    for entry in entries:
        guid = _entry_guid(entry, feed_url)
        if guid in last_seen:
            continue
        item = _normalize_entry(entry, feed_url, extract_dois)
        if len(items) < max_new:
            items.append(item)
            new_guids.append(guid)
        else:
            # Spilled — don't update last_seen so next poll re-surfaces it.
            break

    # Persist guids of the items we actually emitted.
    for guid in new_guids:
        last_seen[guid] = now_iso
    last_seen = _evict_last_seen(last_seen)

    new_etag = resp.headers.get("ETag", state.get("etag", "")) or state.get("etag", "")
    new_last_mod = resp.headers.get("Last-Modified", state.get("last_modified", "")) or state.get("last_modified", "")

    state.update({
        "etag": new_etag,
        "last_modified": new_last_mod,
        "last_seen_guids": last_seen,
        "last_run": now_iso,
        "item_count": int(state.get("item_count", 0)) + len(items),
        "poll_count": poll_count,
    })
    _write_state(state_path, state)

    return {
        "items": items,
        "state": {"etag": new_etag, "last_modified": new_last_mod},
        "cache_hit": False,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="fetch_rss.py",
        description="Poll an RSS / Atom feed, dedup against per-feed state, emit JSON.",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("poll", help="Poll a feed once.")
    p.add_argument("feed_url", help="HTTPS URL of the RSS / Atom feed.")
    p.add_argument("--max", type=int, default=DEFAULT_MAX_NEW, help=f"Max new items to emit (default {DEFAULT_MAX_NEW}).")
    p.add_argument("--ignore-etag", action="store_true", help="Bypass conditional GET; force re-fetch.")
    p.add_argument("--feed-id", default="", help="Per-feed state file id (kebab-case). Default: hash of URL.")
    p.add_argument("--no-extract-dois", action="store_true", help="Skip DOI/arxiv extraction from entry text.")
    p.add_argument("--project-root", default=None, help="Project root (default: cwd).")

    args = parser.parse_args(argv)
    project_root = Path(args.project_root).resolve() if args.project_root else Path.cwd().resolve()

    try:
        result = poll(
            args.feed_url,
            project_root,
            max_new=args.max,
            ignore_etag=args.ignore_etag,
            feed_id=args.feed_id,
            extract_dois=not args.no_extract_dois,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(0)
    except ValueError as exc:
        _err(f"Error: {exc}")
        sys.exit(2)
    except RuntimeError as exc:
        _err(f"Transient error: {exc}")
        sys.exit(3)
    except requests.exceptions.ConnectionError as exc:
        _err(f"Network error: {exc}")
        sys.exit(3)
    except requests.exceptions.Timeout:
        _err("Request timed out while fetching feed.")
        sys.exit(3)


if __name__ == "__main__":
    main()
