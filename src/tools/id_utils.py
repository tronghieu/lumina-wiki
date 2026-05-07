"""id_utils.py — Python mirror of src/scripts/external-ids.mjs.

Pure helpers for normalizing external identifiers (DOI/arXiv/S2/URL).
No I/O, no side effects. Parity with the Node module is gated by
src/tools/tests/fixtures/id-cases.json.

Cross-reference: keep regex strings byte-for-byte aligned with
external-ids.mjs (`EXTERNAL_ID_PATTERNS`).
"""

from __future__ import annotations

import re
from types import MappingProxyType
from typing import Any, Mapping
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

CANONICAL_URL_V = 1
EXTERNAL_ID_NAMESPACES = ("doi", "arxiv", "s2", "url")
_NS_SET = frozenset(EXTERNAL_ID_NAMESPACES)
_MAX_URL_LEN = 2048

# Cross-ref: src/scripts/external-ids.mjs EXTERNAL_ID_PATTERNS
EXTERNAL_ID_PATTERNS: Mapping[str, "re.Pattern[str]"] = MappingProxyType({
    "doi":       re.compile(r"^10\.[0-9]{4,9}/[A-Za-z0-9._\-/()]{1,256}$"),
    "arxiv_new": re.compile(r"^[0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?$"),
    "arxiv_old": re.compile(r"^[a-z\-]+(?:\.[A-Z]{2})?/[0-9]{7}(?:v[0-9]+)?$"),
    "s2":        re.compile(r"^[a-f0-9]{40}$"),
    "doi_arxiv": re.compile(r"^10\.48550/arxiv\.([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?)$", re.IGNORECASE),
})

_ARXIV_VERSION_RE = re.compile(r"v([0-9]+)$")
_TRACKING_PARAM_RE = re.compile(r"^(utm_|ref$|ref_)", re.IGNORECASE)
_DOI_URL_PREFIX_RE = re.compile(r"^https?://(?:dx\.)?doi\.org/", re.IGNORECASE)
_ARXIV_URL_PREFIX_RE = re.compile(r"^https?://arxiv\.org/(?:abs|pdf)/", re.IGNORECASE)
_DOI_PREFIX_RE = re.compile(r"^doi:", re.IGNORECASE)
_ARXIV_PREFIX_RE = re.compile(r"^arxiv:", re.IGNORECASE)
_PDF_SUFFIX_RE = re.compile(r"\.pdf$", re.IGNORECASE)
_DOI_URL_FULL_RE = re.compile(r"^https://doi\.org/(.+)$", re.IGNORECASE)
_ARXIV_URL_FULL_RE = re.compile(r"^https://arxiv\.org/(?:abs|pdf)/(.+?)(?:\.pdf)?$", re.IGNORECASE)


def _decode_uri_safe(s: str) -> str:
    try:
        from urllib.parse import unquote
        return unquote(s)
    except Exception:
        return s


def canonicalize_url(raw: str) -> str:
    """Lowercase host, force https, strip fragment + utm_*/ref* params."""
    if not isinstance(raw, str):
        raise TypeError("canonicalize_url: expected string")
    if len(raw) > _MAX_URL_LEN:
        raise ValueError(f"canonicalize_url: length > {_MAX_URL_LEN}")
    if not raw.isascii():
        raise ValueError("canonicalize_url: non-ASCII")
    parts = urlsplit(raw)
    if parts.scheme.lower() not in ("http", "https"):
        raise ValueError(f"canonicalize_url: unsupported protocol {parts.scheme}")
    if not parts.netloc:
        raise ValueError("canonicalize_url: missing netloc")
    scheme = "https"
    host = parts.hostname or ""
    host = host.lower()
    netloc = host
    if parts.port is not None and not (
        (scheme == "https" and parts.port == 443) or (scheme == "http" and parts.port == 80)
    ):
        netloc = f"{host}:{parts.port}"
    qs = parse_qsl(parts.query, keep_blank_values=True)
    qs = [(k, v) for (k, v) in qs if not _TRACKING_PARAM_RE.match(k)]
    qs.sort(key=lambda kv: kv[0])
    query = urlencode(qs)
    path = parts.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    return urlunsplit((scheme, netloc, path, query, ""))


def normalize_external_id(kind: str, raw: Any) -> dict:
    """Normalize raw value for a namespace → dict with id/valid/extras."""
    extras: dict = {}
    if not isinstance(raw, str) or not raw or kind not in _NS_SET:
        return {"id": None, "valid": False, "extras": extras}
    trimmed = raw.strip()
    if not trimmed:
        return {"id": None, "valid": False, "extras": extras}

    if kind == "doi":
        body = _DOI_URL_PREFIX_RE.sub("", trimmed)
        body = _DOI_PREFIX_RE.sub("", body)
        body = _decode_uri_safe(body).lower()
        # See external-ids.mjs: explicitly reject '..' inside the body.
        if ".." in body:
            return {"id": None, "valid": False, "extras": extras}
        if not EXTERNAL_ID_PATTERNS["doi"].match(body):
            return {"id": None, "valid": False, "extras": extras}
        return {"id": body, "valid": True, "extras": extras}

    if kind == "arxiv":
        body = _ARXIV_URL_PREFIX_RE.sub("", trimmed)
        body = _ARXIV_PREFIX_RE.sub("", body)
        body = _PDF_SUFFIX_RE.sub("", body)
        m = _ARXIV_VERSION_RE.search(body)
        if m:
            extras["arxiv_version"] = int(m.group(1))
        base_id = _ARXIV_VERSION_RE.sub("", body)
        if not (EXTERNAL_ID_PATTERNS["arxiv_new"].match(base_id)
                or EXTERNAL_ID_PATTERNS["arxiv_old"].match(base_id)):
            return {"id": None, "valid": False, "extras": {}}
        return {"id": base_id, "valid": True, "extras": extras}

    if kind == "s2":
        body = trimmed.lower()
        if not EXTERNAL_ID_PATTERNS["s2"].match(body):
            return {"id": None, "valid": False, "extras": extras}
        return {"id": body, "valid": True, "extras": extras}

    if kind == "url":
        try:
            ident = canonicalize_url(trimmed)
        except Exception:
            return {"id": None, "valid": False, "extras": extras}
        return {"id": ident, "valid": True, "extras": {"canonical_v": CANONICAL_URL_V}}

    return {"id": None, "valid": False, "extras": extras}


def parse_url_to_external_ids(raw: Any) -> dict:
    """Inspect URL → namespaces it implies + canonical url."""
    out: dict = {}
    if not isinstance(raw, str) or len(raw) > _MAX_URL_LEN:
        return out
    try:
        canon = canonicalize_url(raw)
    except Exception:
        return out
    out["url"] = canon
    m = _DOI_URL_FULL_RE.match(canon)
    if m:
        r = normalize_external_id("doi", m.group(1))
        if r["valid"]:
            out["doi"] = r["id"]
    m = _ARXIV_URL_FULL_RE.match(canon)
    if m:
        r = normalize_external_id("arxiv", m.group(1))
        if r["valid"]:
            out["arxiv"] = r["id"]
    return out


def expand_external_ids(ids: Any) -> dict:
    """Synthesize cross-namespace equivalents (arxiv↔arxiv-DOI). New dict."""
    out: dict = {}
    if not isinstance(ids, dict):
        return out
    for ns in EXTERNAL_ID_NAMESPACES:
        v = ids.get(ns)
        if isinstance(v, str) and v:
            out[ns] = v
    if out.get("arxiv") and not out.get("doi"):
        out["doi"] = f"10.48550/arxiv.{out['arxiv']}"
    elif out.get("doi") and not out.get("arxiv"):
        m = EXTERNAL_ID_PATTERNS["doi_arxiv"].match(out["doi"])
        if m:
            out["arxiv"] = m.group(1)
    return out


def external_id_match_key(ids: Any) -> str | None:
    """Best stable dedup key: doi > arxiv > s2 > url."""
    if not isinstance(ids, dict):
        return None
    for ns in EXTERNAL_ID_NAMESPACES:
        v = ids.get(ns)
        if isinstance(v, str) and v:
            return f"{ns}:{v}"
    return None


_UNSAFE_TOKEN_RE = re.compile(r"[\x00-\x1f\\\"'`*?<>|]")


def safe_id_token(kind: str, val: Any) -> str:
    """Re-validate a value before path/glob concatenation."""
    if not isinstance(val, str) or not val:
        raise ValueError("safe_id_token: empty")
    if len(val) > _MAX_URL_LEN:
        raise ValueError("safe_id_token: too long")
    if _UNSAFE_TOKEN_RE.search(val):
        raise ValueError("safe_id_token: control or meta char")
    if ".." in val:
        raise ValueError("safe_id_token: traversal")
    r = normalize_external_id(kind, val)
    if not r["valid"] or r["id"] != val:
        raise ValueError(f"safe_id_token: not a valid {kind}")
    return val


def build_external_ids(candidates: Any) -> dict:
    """Build a validated external_ids dict from a flat `{ns: raw}` candidate map.

    Each candidate is run through `normalize_external_id`; invalid values are
    dropped silently. Use this in fetchers that already know their per-field
    mapping (DOI, ArXiv, paperId, url) — the validation choke point makes
    every fetcher safe by construction.
    """
    out: dict = {}
    if not isinstance(candidates, dict):
        return out
    for ns in EXTERNAL_ID_NAMESPACES:
        raw = candidates.get(ns)
        if not isinstance(raw, str) or not raw:
            continue
        r = normalize_external_id(ns, raw)
        if r["valid"] and r["id"]:
            out[ns] = r["id"]
    return out


def sanitize_external_ids_object(obj: Any) -> dict:
    """Allowlist filter; rejects __proto__/constructor/etc."""
    out: dict = {}
    if not isinstance(obj, dict):
        return out
    for ns in EXTERNAL_ID_NAMESPACES:
        if ns not in obj:
            continue
        v = obj[ns]
        if not isinstance(v, str) or not v:
            continue
        out[ns] = v
    return out
