"""
fetch_unpaywall.py — Unpaywall API wrapper (DOI → best open-access PDF URL).

CLI:
    python fetch_unpaywall.py doi <doi>

`<doi>` accepts a bare DOI, `doi:` prefix, or any doi.org URL form —
normalize_external_id handles all three.

The Unpaywall API requires every request to carry `email=<contact>`. The
helper reads it from `UNPAYWALL_EMAIL` via _env.load_env(); fetcher exits
non-zero with an actionable message if missing.

JSON emitted to stdout on success:
    {
      "doi": "10.x/y",
      "is_oa": true,
      "best_oa_location": {"pdf_url": "...", "license": "...", "host_type": "..."} | null,
      "sources": [...],          # buildSourceEntry provenance records
      "external_ids": {"doi": "..."},
      "_provider": "unpaywall"
    }

Errors → stderr; exit codes:
    0  success (even if is_oa: false)
    2  user error (missing env, bad DOI, 404 from API)
    3  internal/transient (network, API 5xx)

Cache TTL: 7d (Unpaywall records change rarely once an OA copy lands).
Retry: urllib3 Retry total=3, backoff_factor=0.5, 500/502/503/504.
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

UNPAYWALL_API_BASE = "https://api.unpaywall.org/v2"
REQUEST_TIMEOUT = 30
WORK_CACHE_TTL = 7 * 86400  # 7 days

ENV_KEY_NAME = "UNPAYWALL_EMAIL"
PROVIDER = "unpaywall"


def _err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _ua() -> str:
    try:
        pkg = Path(__file__).resolve().parent.parent.parent / "package.json"
        if pkg.is_file():
            data = json.loads(pkg.read_text(encoding="utf-8"))
            ver = data.get("version", "0.0.0")
            return f"lumina-wiki/{ver} (research-pack; unpaywall fetcher)"
    except (OSError, ValueError, KeyError):
        pass
    return "lumina-wiki/0 (research-pack; unpaywall fetcher)"


def _make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": _ua()})
    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=(500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    return wrap_session(
        session,
        namespace="unpaywall-work",
        ttl_seconds=WORK_CACHE_TTL,
        strip_params=["email"],
    )


def _request_json(
    session: requests.Session, url: str, params: dict[str, Any]
) -> dict[str, Any]:
    resp = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
    if resp.status_code == 404:
        raise ValueError(f"Unpaywall returned 404 for {url}")
    if resp.status_code == 422:
        # 422 = invalid DOI per Unpaywall convention.
        raise ValueError(f"Unpaywall returned 422 (invalid DOI) for {url}")
    if resp.status_code >= 500:
        raise RuntimeError(f"Unpaywall API returned HTTP {resp.status_code}")
    resp.raise_for_status()
    try:
        return resp.json()
    except ValueError as exc:
        raise RuntimeError(f"Unpaywall returned malformed JSON: {exc}") from exc


def _extract_best_oa(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Return the `best_oa_location` block if it carries an https pdf_url."""
    loc = raw.get("best_oa_location")
    if not isinstance(loc, dict):
        return None
    pdf_url = loc.get("url_for_pdf") or loc.get("pdf_url")
    if not isinstance(pdf_url, str) or not pdf_url.startswith("https://"):
        return None
    out: dict[str, Any] = {"pdf_url": pdf_url}
    license_ = loc.get("license")
    if isinstance(license_, str) and license_:
        out["license"] = license_
    host_type = loc.get("host_type")
    if isinstance(host_type, str) and host_type:
        out["host_type"] = host_type
    return out


def cmd_doi(doi_raw: str, email: str) -> dict[str, Any]:
    norm = normalize_external_id("doi", doi_raw)
    if not norm["valid"] or not norm["id"]:
        raise ValueError(f"Not a valid DOI: {doi_raw!r}")
    doi = norm["id"]

    session = _make_session()
    url = f"{UNPAYWALL_API_BASE}/{doi}"
    data = _request_json(session, url, {"email": email})

    is_oa = bool(data.get("is_oa"))
    best_oa = _extract_best_oa(data) if is_oa else None

    sources: list[dict[str, Any]] = [
        build_source_entry(PROVIDER, ns="doi", value=doi),
    ]
    if best_oa:
        sources.append(build_source_entry(PROVIDER, url=best_oa["pdf_url"]))

    return {
        "doi": doi,
        "is_oa": is_oa,
        "best_oa_location": best_oa,
        "sources": sources,
        "external_ids": {"doi": doi},
        "_provider": PROVIDER,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="fetch_unpaywall.py",
        description=(
            "Query Unpaywall for the best open-access copy of a DOI. "
            "Requires UNPAYWALL_EMAIL env var (a contact address — Unpaywall's "
            "rate-limit policy)."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)
    d = sub.add_parser("doi", help="Look up the best OA copy for a DOI.")
    d.add_argument("doi", help="DOI (bare, doi:-prefixed, or doi.org URL).")

    args = parser.parse_args(argv)

    env = load_env()
    email = (env.get(ENV_KEY_NAME) or "").strip()
    if not email:
        _err(
            f"Error: {ENV_KEY_NAME} not set. Unpaywall requires a contact "
            "email on every request. Add UNPAYWALL_EMAIL=you@example.com to "
            "your .env file."
        )
        sys.exit(2)

    try:
        if args.command == "doi":
            if not args.doi.strip():
                _err("Error: doi must not be empty.")
                sys.exit(2)
            result = cmd_doi(args.doi.strip(), email)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            sys.exit(0)

    except ValueError as exc:
        _err(f"Error: {exc}")
        sys.exit(2)
    except RuntimeError as exc:
        _err(f"API error: {exc}")
        sys.exit(3)
    except requests.exceptions.ConnectionError as exc:
        _err(f"Network error: {exc}")
        sys.exit(3)
    except requests.exceptions.Timeout:
        _err("Request timed out while contacting Unpaywall.")
        sys.exit(3)
    except requests.exceptions.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else "unknown"
        _err(f"HTTP error {code} from Unpaywall.")
        sys.exit(3)


if __name__ == "__main__":
    main()
