"""Tests for _cache.py — persistent HTTP GET cache."""

from __future__ import annotations

import json
import time
from pathlib import Path
from unittest.mock import patch

import pytest
import requests

from _cache import (
    CachedSession,
    DEFAULT_TTL_SECONDS,
    MAX_BODY_BYTES,
    _atomic_write_json,
    _cache_key,
    _cache_root_for,
    _canonical_url,
    _find_lumina_state_dir,
    wrap_session,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _FakeResponse:
    """Minimal stand-in for requests.Response used in monkey-patching."""

    def __init__(self, *, status_code=200, body=b'{"ok":true}', content_type="application/json"):
        self.status_code = status_code
        self._content = body
        self.headers = {"Content-Type": content_type}
        self.encoding = "utf-8"

    @property
    def content(self):
        return self._content


def _stub_get(session: CachedSession, response: _FakeResponse, call_log: list):
    """Replace the inner session's .get() so we can count network calls."""
    def fake_get(url, **kwargs):
        call_log.append((url, kwargs))
        resp = requests.Response()
        resp.status_code = response.status_code
        resp._content = response.content  # type: ignore[attr-defined]
        resp.headers["Content-Type"] = response.headers["Content-Type"]
        resp.encoding = response.encoding
        return resp
    session._inner.get = fake_get  # type: ignore[assignment]

    class _NullCtx:
        def __enter__(self): return None
        def __exit__(self, *a): return False
    return _NullCtx()


# ---------------------------------------------------------------------------
# _canonical_url
# ---------------------------------------------------------------------------

def test_canonical_url_sorts_params():
    a = _canonical_url("https://example.com/api", {"b": 2, "a": 1})
    b = _canonical_url("https://example.com/api", {"a": 1, "b": 2})
    assert a == b
    assert "a=1&b=2" in a


def test_canonical_url_merges_existing_query():
    out = _canonical_url("https://example.com/api?x=9", {"a": 1})
    assert "a=1" in out and "x=9" in out


def test_canonical_url_drops_none_params():
    out = _canonical_url("https://example.com/api", {"a": 1, "b": None})
    assert "a=1" in out
    assert "b=" not in out


def test_canonical_url_preserves_existing_percent_encoding():
    """Pre-encoded URLs must not be double-encoded.

    Regression test for the cache-poisoning bug where DOI-style URLs
    (id=DOI%3A10.x/y) would have their %3A re-encoded to %253A.
    """
    out = _canonical_url("https://api.example.com/x?id=DOI%3A10.1/abc", None)
    assert "DOI%3A10.1" in out
    assert "%2503" not in out and "%253A" not in out


def test_canonical_url_dict_and_url_query_match():
    """Same logical request via params= or via URL query must canonicalize equal."""
    a = _canonical_url("https://api.example.com/x", {"q": "hello world"})
    b = _canonical_url("https://api.example.com/x?q=hello+world", None)
    assert a == b


# ---------------------------------------------------------------------------
# _cache_key
# ---------------------------------------------------------------------------

def test_cache_key_deterministic():
    k1 = _cache_key("GET", "https://example.com/x")
    k2 = _cache_key("GET", "https://example.com/x")
    assert k1 == k2
    assert len(k1) == 64  # sha256 hex


def test_cache_key_method_and_url_distinguish():
    assert _cache_key("GET", "https://example.com/x") != _cache_key("POST", "https://example.com/x")
    assert _cache_key("GET", "https://example.com/x") != _cache_key("GET", "https://example.com/y")


# ---------------------------------------------------------------------------
# _find_lumina_state_dir
# ---------------------------------------------------------------------------

def test_find_lumina_state_dir_finds_ancestor(tmp_project: Path):
    nested = tmp_project / "src" / "tools"
    nested.mkdir(parents=True, exist_ok=True)
    found = _find_lumina_state_dir(nested)
    assert found == tmp_project / "_lumina" / "_state"


def test_find_lumina_state_dir_falls_back(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    fallback = _find_lumina_state_dir(tmp_path)
    assert "lumina-wiki" in str(fallback)
    assert fallback.is_dir()


# ---------------------------------------------------------------------------
# _cache_root_for
# ---------------------------------------------------------------------------

def test_cache_root_isolates_namespaces(tmp_project: Path, monkeypatch):
    monkeypatch.chdir(tmp_project)
    a = _cache_root_for("arxiv")
    b = _cache_root_for("s2")
    assert a != b
    assert a.parent == b.parent  # same http-cache dir, different namespace


def test_cache_root_sanitizes_namespace(tmp_project: Path, monkeypatch):
    monkeypatch.chdir(tmp_project)
    root = _cache_root_for("../../etc")
    assert ".." not in root.name
    assert "/" not in root.name


# ---------------------------------------------------------------------------
# _atomic_write_json
# ---------------------------------------------------------------------------

def test_atomic_write_json_roundtrip(tmp_path: Path):
    target = tmp_path / "x.json"
    _atomic_write_json(target, {"a": 1, "b": "hello"})
    assert json.loads(target.read_text()) == {"a": 1, "b": "hello"}


def test_atomic_write_leaves_no_temp_files(tmp_path: Path):
    target = tmp_path / "x.json"
    _atomic_write_json(target, {"k": "v"})
    leftovers = [p.name for p in tmp_path.iterdir() if p.name.startswith(".tmp-")]
    assert leftovers == []


# ---------------------------------------------------------------------------
# CachedSession — hit / miss / TTL / bypass
# ---------------------------------------------------------------------------

def test_first_call_hits_network_second_hits_cache(tmp_project: Path, monkeypatch):
    monkeypatch.chdir(tmp_project)
    monkeypatch.delenv("LUMINA_NO_CACHE", raising=False)
    sess = wrap_session(requests.Session(), namespace="test")
    log: list = []
    fake = _FakeResponse(body=b'{"hello":"world"}')

    with _stub_get(sess, fake, log):
        r1 = sess.get("https://api.example.com/v1/x", params={"q": "a"}, timeout=5)
        r2 = sess.get("https://api.example.com/v1/x", params={"q": "a"}, timeout=5)

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json() == r2.json() == {"hello": "world"}
    assert len(log) == 1, "second call should be served from cache"
    assert r2.headers.get("X-Lumina-Cache") == "HIT"


def test_param_change_bypasses_cache(tmp_project: Path, monkeypatch):
    monkeypatch.chdir(tmp_project)
    monkeypatch.delenv("LUMINA_NO_CACHE", raising=False)
    sess = wrap_session(requests.Session(), namespace="test")
    log: list = []
    fake = _FakeResponse()
    with _stub_get(sess, fake, log):
        sess.get("https://api.example.com/x", params={"q": "a"})
        sess.get("https://api.example.com/x", params={"q": "b"})
    assert len(log) == 2, "different params must miss cache"


def test_ttl_expiry_refetches(tmp_project: Path, monkeypatch):
    monkeypatch.chdir(tmp_project)
    monkeypatch.delenv("LUMINA_NO_CACHE", raising=False)
    sess = wrap_session(requests.Session(), namespace="test", ttl_seconds=1)
    log: list = []
    fake = _FakeResponse()
    with _stub_get(sess, fake, log):
        sess.get("https://api.example.com/x")
        # Backdate the cache file so it appears stale.
        cache_dir = sess._lumina_cache_root
        for entry_path in cache_dir.glob("*.json"):
            data = json.loads(entry_path.read_text())
            data["fetched_at"] = time.time() - 100
            entry_path.write_text(json.dumps(data))
        sess.get("https://api.example.com/x")
    assert len(log) == 2, "expired entry should refetch"


def test_no_cache_env_bypasses(tmp_project: Path, monkeypatch):
    monkeypatch.chdir(tmp_project)
    monkeypatch.setenv("LUMINA_NO_CACHE", "1")
    sess = wrap_session(requests.Session(), namespace="test")
    log: list = []
    fake = _FakeResponse()
    with _stub_get(sess, fake, log):
        sess.get("https://api.example.com/x")
        sess.get("https://api.example.com/x")
    assert len(log) == 2
    # And nothing was written to disk
    assert not any(sess._lumina_cache_root.glob("*.json"))


def test_non_200_not_cached(tmp_project: Path, monkeypatch):
    monkeypatch.chdir(tmp_project)
    monkeypatch.delenv("LUMINA_NO_CACHE", raising=False)
    sess = wrap_session(requests.Session(), namespace="test")
    log: list = []
    fake = _FakeResponse(status_code=503, body=b"server error", content_type="text/plain")
    with _stub_get(sess, fake, log):
        sess.get("https://api.example.com/x")
        sess.get("https://api.example.com/x")
    assert len(log) == 2, "5xx must not be cached"


def test_oversized_body_not_cached(tmp_project: Path, monkeypatch):
    monkeypatch.chdir(tmp_project)
    monkeypatch.delenv("LUMINA_NO_CACHE", raising=False)
    sess = wrap_session(requests.Session(), namespace="test")
    log: list = []
    big = b"x" * (MAX_BODY_BYTES + 1)
    fake = _FakeResponse(body=big, content_type="application/json")
    with _stub_get(sess, fake, log):
        sess.get("https://api.example.com/x")
        sess.get("https://api.example.com/x")
    assert len(log) == 2


def test_binary_content_type_not_cached(tmp_project: Path, monkeypatch):
    monkeypatch.chdir(tmp_project)
    monkeypatch.delenv("LUMINA_NO_CACHE", raising=False)
    sess = wrap_session(requests.Session(), namespace="test")
    log: list = []
    fake = _FakeResponse(body=b"%PDF-1.4 ...", content_type="application/pdf")
    with _stub_get(sess, fake, log):
        sess.get("https://api.example.com/x")
        sess.get("https://api.example.com/x")
    assert len(log) == 2


def test_namespaces_isolated(tmp_project: Path, monkeypatch):
    monkeypatch.chdir(tmp_project)
    monkeypatch.delenv("LUMINA_NO_CACHE", raising=False)
    sess_a = wrap_session(requests.Session(), namespace="a")
    sess_b = wrap_session(requests.Session(), namespace="b")
    log: list = []
    fake = _FakeResponse()
    _stub_get(sess_a, fake, log)
    _stub_get(sess_b, fake, log)
    sess_a.get("https://api.example.com/x")
    sess_b.get("https://api.example.com/x")
    assert len(log) == 2, "different namespaces must not share cache"


def test_wrap_session_proxies_inner_headers(tmp_project: Path, monkeypatch):
    """Wrapped session reads/writes inner.headers via delegation, not copy."""
    monkeypatch.chdir(tmp_project)
    base = requests.Session()
    base.headers["User-Agent"] = "lumina-test/1.0"
    wrapped = wrap_session(base, namespace="test")
    assert wrapped.headers["User-Agent"] == "lumina-test/1.0"
    # Mutations on the wrapped session must propagate to the inner session.
    wrapped.headers["X-After-Wrap"] = "value"
    assert base.headers["X-After-Wrap"] == "value"


def test_non_get_methods_proxy_to_inner(tmp_project: Path, monkeypatch):
    """post/put/etc must pass straight through __getattr__ to inner session."""
    monkeypatch.chdir(tmp_project)
    sess = wrap_session(requests.Session(), namespace="test")
    called = {}

    def fake_post(url, **kwargs):
        called["url"] = url
        called["kwargs"] = kwargs
        return "post-response"

    sess._inner.post = fake_post  # type: ignore[assignment]
    result = sess.post("https://api.example.com/x", json={"k": "v"})
    assert result == "post-response"
    assert called["url"] == "https://api.example.com/x"


def test_ttl_zero_does_not_write_cache(tmp_project: Path, monkeypatch):
    """LUMINA_CACHE_TTL=0 must not fill disk with never-served entries."""
    monkeypatch.chdir(tmp_project)
    monkeypatch.delenv("LUMINA_NO_CACHE", raising=False)
    sess = wrap_session(requests.Session(), namespace="test", ttl_seconds=0)
    log: list = []
    fake = _FakeResponse()
    _stub_get(sess, fake, log)
    sess.get("https://api.example.com/x")
    sess.get("https://api.example.com/x")
    assert len(log) == 2, "TTL=0 must always refetch"
    assert not any(sess._lumina_cache_root.glob("*.json")), "TTL=0 must not write to disk"


def test_wrap_session_falls_back_when_cache_dir_unwritable(tmp_path: Path, monkeypatch):
    """Read-only filesystem must not break fetchers — return inner session unchanged."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("HOME", str(tmp_path / "no-home"))
    base = requests.Session()
    # Force cache_root to point at a path where mkdir would fail.
    bad_path = tmp_path / "blocked"
    bad_path.write_text("not a directory")  # file at the path → mkdir fails

    def boom(*_a, **_kw):
        raise OSError("read-only filesystem (test)")
    monkeypatch.setattr("_cache._cache_root_for", boom)

    result = wrap_session(base, namespace="test")
    assert result is base, "fallback must return original session unchanged"


def test_ttl_env_override(tmp_project: Path, monkeypatch):
    monkeypatch.chdir(tmp_project)
    monkeypatch.setenv("LUMINA_CACHE_TTL", "60")
    sess = wrap_session(requests.Session(), namespace="test")
    assert sess._lumina_ttl == 60


def test_default_ttl_used_when_env_missing(tmp_project: Path, monkeypatch):
    monkeypatch.chdir(tmp_project)
    monkeypatch.delenv("LUMINA_CACHE_TTL", raising=False)
    sess = wrap_session(requests.Session(), namespace="test")
    assert sess._lumina_ttl == DEFAULT_TTL_SECONDS
