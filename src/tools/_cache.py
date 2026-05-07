"""
_cache.py — Persistent HTTP GET cache for Lumina research-pack fetchers.

Wraps a `requests.Session` so that repeated GETs of the same URL within a
TTL window are served from disk instead of hitting the network. Designed
to relieve rate limits on ArXiv, Semantic Scholar, Wikipedia, and similar
small-JSON APIs.

Storage layout:
    <project>/_lumina/_state/http-cache/<namespace>/<sha256>.json

Each cache entry is a single JSON file written atomically (temp + replace).
On cache hit, a synthetic `requests.Response` is returned so callers
cannot tell the difference. Cache misses fall through to the underlying
session and the response body is stored on success (status 200, body
under MAX_BODY_BYTES).

Configuration (env vars):
    LUMINA_NO_CACHE=1         — bypass cache entirely (always fetch live)
    LUMINA_CACHE_TTL=<sec>    — override default TTL (default 86400 = 24h)

Scope limits (intentional):
    - GET only. POST/PUT/DELETE pass through untouched.
    - Status 200 only. Errors (4xx/5xx) are NOT cached.
    - Body size limit: 1 MiB. Larger responses pass through uncached
      (avoids ballooning the cache with PDFs or model files).
    - Headers are NOT replayed (Content-Type is reconstructed from cache
      metadata; other headers are dropped). Callers using headers beyond
      Content-Type should disable cache.

Usage:
    from _cache import wrap_session

    session = wrap_session(requests.Session(), namespace="s2")
    resp = session.get(url, params=params, timeout=30)
    # First call hits network; subsequent calls within TTL hit disk.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import time
from io import BytesIO
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit, urlunsplit

import requests

DEFAULT_TTL_SECONDS = 86400  # 24 hours
MAX_BODY_BYTES = 1 * 1024 * 1024  # 1 MiB
CACHE_DIR_NAME = "http-cache"
CACHE_SCHEMA_VERSION = 1  # bump when entry shape changes; mismatched entries are treated as misses


# ---------------------------------------------------------------------------
# Cache directory resolution
# ---------------------------------------------------------------------------

def _find_lumina_state_dir(start: Optional[Path] = None) -> Path:
    """Locate `_lumina/_state/` by ascending from start (or cwd).

    Falls back to `~/.cache/lumina-wiki/` if no project is found, so tools
    invoked outside a project root still cache (just to a different dir).
    """
    cur = (start or Path.cwd()).resolve()
    for candidate in [cur, *cur.parents]:
        state_dir = candidate / "_lumina" / "_state"
        if state_dir.is_dir():
            return state_dir
    fallback = Path.home() / ".cache" / "lumina-wiki"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def _cache_root_for(namespace: str, start: Optional[Path] = None) -> Path:
    """Return the directory holding cache files for the given namespace."""
    safe_ns = "".join(c if c.isalnum() or c in "-_" else "_" for c in namespace)
    root = _find_lumina_state_dir(start) / CACHE_DIR_NAME / (safe_ns or "default")
    root.mkdir(parents=True, exist_ok=True)
    return root


# ---------------------------------------------------------------------------
# Cache key
# ---------------------------------------------------------------------------

def _canonical_url(url: str, params: Optional[dict[str, Any]] = None) -> str:
    """Build a deterministic URL string from base URL + params dict.

    Delegates URL construction to `requests.PreparedRequest.prepare_url()`
    so percent-encoding semantics match what `requests` actually sends to
    the server, then sorts the final query string alphabetically. This
    avoids the double-encoding bug that plagues naive `split('=') +
    urlencode()` round-trips on already-encoded URLs (e.g. DOI strings
    like `id=DOI%3A10.x/y`).
    """
    pr = requests.PreparedRequest()
    pr.prepare_url(url, params)  # type: ignore[arg-type]
    parts = urlsplit(pr.url or url)
    if parts.query:
        pairs = sorted(parts.query.split("&"))
        sorted_query = "&".join(pairs)
    else:
        sorted_query = ""
    return urlunsplit((parts.scheme, parts.netloc, parts.path, sorted_query, parts.fragment))


def _cache_key(method: str, canonical_url: str) -> str:
    h = hashlib.sha256()
    h.update(method.upper().encode("utf-8"))
    h.update(b"\x00")
    h.update(canonical_url.encode("utf-8"))
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Atomic write
# ---------------------------------------------------------------------------

def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    """Write JSON to path using temp + replace so readers never see partials."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".tmp-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Synthetic Response
# ---------------------------------------------------------------------------

def _build_response(entry: dict[str, Any], url: str) -> requests.Response:
    """Reconstruct a `requests.Response` from a cache entry."""
    resp = requests.Response()
    resp.status_code = int(entry.get("status", 200))
    resp.url = url
    body_bytes: bytes = entry["body"].encode("utf-8")
    resp.raw = BytesIO(body_bytes)
    resp._content = body_bytes  # type: ignore[attr-defined]
    content_type = entry.get("content_type")
    if content_type:
        resp.headers["Content-Type"] = content_type
    resp.headers["X-Lumina-Cache"] = "HIT"
    # Body was normalized to UTF-8 at write time (see _write_entry), so the
    # response's text encoding must also be UTF-8 — using the original
    # server-declared encoding (e.g. iso-8859-1) here would mojibake .text.
    resp.encoding = "utf-8"
    return resp


# ---------------------------------------------------------------------------
# Cached session
# ---------------------------------------------------------------------------

class CachedSession:
    """Delegates to an inner `requests.Session` while caching GET on disk.

    Uses delegation rather than subclassing so callers can wrap a Session
    that was injected/mocked elsewhere. Non-GET attributes proxy via
    __getattr__, so `session.headers`, `session.post`, etc. continue to
    behave exactly like the inner session.
    """

    def __init__(self, inner: requests.Session, namespace: str, ttl_seconds: int, cache_root: Path):
        self._inner = inner
        self._lumina_namespace = namespace
        self._lumina_ttl = ttl_seconds
        self._lumina_cache_root = cache_root
        self._lumina_disabled = os.environ.get("LUMINA_NO_CACHE") == "1"

    def __getattr__(self, name: str) -> Any:
        # Called only when attribute not found on self — proxy to inner.
        # Guard against recursion if the instance is partially constructed
        # (e.g. unpickled or __init__ failed before _inner was set).
        if name == "_inner":
            raise AttributeError(name)
        return getattr(self._inner, name)

    def get(self, url, **kwargs):
        params = kwargs.get("params")
        # `requests` accepts params as dict, list[tuple], bytes, or str. Only
        # dict (and None) can be deterministically canonicalized for the key
        # — list-of-tuples with repeated keys would collapse onto the bare-URL
        # cache slot and collide. Bypass the cache for non-dict params.
        if params is not None and not isinstance(params, dict):
            return self._inner.get(url, **kwargs)
        canonical = _canonical_url(url, params)
        key = _cache_key("GET", canonical)
        path = self._lumina_cache_root / f"{key}.json"

        if not self._lumina_disabled and path.is_file():
            entry = self._read_entry(path)
            if entry and entry.get("v") == CACHE_SCHEMA_VERSION and self._is_fresh(entry):
                return _build_response(entry, canonical)

        resp = self._inner.get(url, **kwargs)

        if self._lumina_disabled or self._lumina_ttl <= 0:
            return resp

        if getattr(resp, "status_code", None) == 200 and self._cacheable(resp):
            try:
                self._write_entry(path, resp)
            except OSError:
                pass  # caching is best-effort; never block the caller
        return resp

    # ------------------------------------------------------------------ internals

    def _read_entry(self, path: Path) -> Optional[dict[str, Any]]:
        try:
            with path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            return None

    def _is_fresh(self, entry: dict[str, Any]) -> bool:
        ts = entry.get("fetched_at")
        if not isinstance(ts, (int, float)):
            return False
        age = time.time() - ts
        return 0 <= age < self._lumina_ttl

    def _cacheable(self, resp: requests.Response) -> bool:
        body = resp.content or b""
        if len(body) > MAX_BODY_BYTES:
            return False
        # Only cache text-like bodies (JSON, XML, HTML, plain). Skip
        # binary blobs (PDFs, images) — they belong elsewhere.
        ctype = (resp.headers.get("Content-Type") or "").lower()
        if ctype and not any(t in ctype for t in ("json", "xml", "text", "html", "atom", "rss")):
            return False
        return True

    def _write_entry(self, path: Path, resp: requests.Response) -> None:
        try:
            body_text = resp.content.decode(resp.encoding or "utf-8")
        except (UnicodeDecodeError, LookupError):
            return  # not text-decodable; skip cache silently
        entry = {
            "v": CACHE_SCHEMA_VERSION,
            "fetched_at": time.time(),
            "status": resp.status_code,
            "content_type": resp.headers.get("Content-Type"),
            "encoding": resp.encoding,
            "body": body_text,
        }
        _atomic_write_json(path, entry)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def wrap_session(
    session: requests.Session,
    namespace: str,
    *,
    ttl_seconds: Optional[int] = None,
    cache_root: Optional[Path] = None,
):
    """Return a session-like object that caches GETs to disk.

    If the cache directory cannot be created (read-only filesystem,
    permission denied, etc.), returns the input session unchanged so the
    fetcher continues to work without caching. Callers must rely on duck
    typing — the returned object always has `.get`, `.post`, `.headers`,
    etc., but its concrete type is either `requests.Session` (no-cache
    fallback) or `CachedSession` (delegating wrapper).
    """
    if ttl_seconds is None:
        env_ttl = os.environ.get("LUMINA_CACHE_TTL")
        if env_ttl:
            try:
                parsed = int(env_ttl)
            except ValueError:
                print(
                    f"lumina: ignoring invalid LUMINA_CACHE_TTL={env_ttl!r} "
                    f"(want a non-negative integer); using default {DEFAULT_TTL_SECONDS}s",
                    file=sys.stderr,
                )
                ttl_seconds = DEFAULT_TTL_SECONDS
            else:
                if parsed < 0:
                    print(
                        f"lumina: ignoring negative LUMINA_CACHE_TTL={env_ttl!r} "
                        f"(use LUMINA_NO_CACHE=1 to disable); using default {DEFAULT_TTL_SECONDS}s",
                        file=sys.stderr,
                    )
                    ttl_seconds = DEFAULT_TTL_SECONDS
                else:
                    ttl_seconds = parsed
        else:
            ttl_seconds = DEFAULT_TTL_SECONDS
    try:
        root = cache_root if cache_root is not None else _cache_root_for(namespace)
    except OSError:
        return session
    return CachedSession(inner=session, namespace=namespace, ttl_seconds=ttl_seconds, cache_root=root)
