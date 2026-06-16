"""
fetch_scite.py — Scite.ai citation-tally wrapper.

CLI:
    python fetch_scite.py tally <doi>

Surfaces the Smart Citation tallies (supporting / contrasting / mentioning)
that Scite.ai computes for a publication, used by /lumi-research-rank as a
quality signal beyond raw citation counts.

Requires SCITE_API_KEY in the environment (via _env.load_env()). The signal is
key-gated: when the key is absent the tool exits 2 with an actionable message
so the skill can skip this signal and continue. JSON emitted to stdout on
success.

Exit codes:
    0  success (includes the "no Scite data for this DOI" case, found=false)
    2  user error (missing key, bad/empty DOI) — actionable
    3  internal/transient error (network, API 5xx) — includes retry hint
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import requests

# Import HTTP cache helper at module load (before any test patches requests.Session)
from _cache import wrap_session
from id_utils import normalize_external_id

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

SCITE_API_BASE = "https://api.scite.ai"
REQUEST_TIMEOUT = 30

ENV_KEY_NAME = "SCITE_API_KEY"
KEY_OBTAIN_URL = "https://scite.ai/apis"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _get_api_key() -> str:
    """Load and return the Scite API key.

    Raises SystemExit(2) with an actionable message if missing.
    """
    env = load_env()
    key = env.get(ENV_KEY_NAME, "").strip()
    if not key:
        _err(
            f"Error: {ENV_KEY_NAME} is not set.\n"
            f"Scite tallies are an optional, key-gated ranking signal.\n"
            f"Set it in your project .env file or ~/.env:\n"
            f"  {ENV_KEY_NAME}=<your-key>\n"
            f"Obtain an API key at: {KEY_OBTAIN_URL}"
        )
        sys.exit(2)
    return key


def _clean_doi(raw: str) -> str:
    """Validate and normalize a DOI; SystemExit(2) on an invalid value."""
    r = normalize_external_id("doi", raw)
    if not r["valid"] or not r["id"]:
        _err(f"Error: {raw!r} is not a valid DOI (expected form like 10.1234/abcd).")
        sys.exit(2)
    return r["id"]


def _make_session(api_key: str) -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": "lumina-wiki/0.1 (research-pack; scite fetcher)",
        "Authorization": f"Bearer {api_key}",
    })
    return wrap_session(session, namespace="scite")


def _handle_response_errors(resp: requests.Response, context: str) -> None:
    """Check for API-level errors and raise appropriate exceptions.

    404 is NOT raised here — a DOI absent from the Scite index is a normal
    "no data" outcome handled by the caller, not an error.
    """
    if resp.status_code in (401, 403):
        raise ValueError("Scite rejected the API key. Check SCITE_API_KEY.")
    if resp.status_code == 429:
        raise RuntimeError("Rate limit exceeded. Wait before retrying.")
    if resp.status_code >= 500:
        raise RuntimeError(f"Scite API returned HTTP {resp.status_code}")
    if resp.status_code != 404:
        resp.raise_for_status()


# ---------------------------------------------------------------------------
# Core fetch
# ---------------------------------------------------------------------------

def fetch_tally(doi: str, session: requests.Session) -> dict[str, Any]:
    """Fetch the Smart Citation tally for a single DOI.

    Returns a normalized dict. When the DOI is not indexed by Scite, returns
    {"found": False, "doi": doi} rather than raising.
    """
    url = f"{SCITE_API_BASE}/tallies/{doi}"
    resp = session.get(url, timeout=REQUEST_TIMEOUT)
    _handle_response_errors(resp, f"tally for '{doi}'")
    if resp.status_code == 404:
        return {"found": False, "doi": doi}

    raw = resp.json()
    # Scite returns either a flat tally object or {"tally": {...}}.
    tally = raw.get("tally", raw) if isinstance(raw, dict) else {}
    return {
        "found": True,
        "doi": tally.get("doi", doi),
        "supporting": tally.get("supporting", 0),
        "contrasting": tally.get("contradicting", tally.get("contrasting", 0)),
        "mentioning": tally.get("mentioning", 0),
        "unclassified": tally.get("unclassified", 0),
        "total": tally.get("total", 0),
        "source": "scite.ai",
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="fetch_scite.py",
        description="Fetch Scite.ai Smart Citation tallies. Requires SCITE_API_KEY.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    t = subparsers.add_parser("tally", help="Fetch supporting/contrasting/mentioning tallies for a DOI.")
    t.add_argument("doi", help="DOI of the publication (e.g. 10.1234/abcd).")

    args = parser.parse_args(argv)

    if not args.doi.strip():
        _err("Error: DOI must not be empty.")
        sys.exit(2)
    doi = _clean_doi(args.doi.strip())

    api_key = _get_api_key()
    session = _make_session(api_key)

    try:
        result = fetch_tally(doi, session)
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
        _err("Request timed out while contacting Scite.")
        _err("Retry hint: Scite may be slow; try again in a few minutes.")
        sys.exit(3)
    except requests.exceptions.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else "unknown"
        _err(f"HTTP error {code} from Scite.")
        _err("Retry hint: try again later.")
        sys.exit(3)


if __name__ == "__main__":
    main()
