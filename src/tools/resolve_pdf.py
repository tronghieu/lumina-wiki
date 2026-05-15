"""
resolve_pdf.py — 2-layer orchestrator: OpenAlex metadata anchor + PDF ladder.

CLI:
    python resolve_pdf.py <input> [--project-root PATH]

`<input>` is a DOI, arXiv ID, or OpenAlex Work ID. Any of those alone is
enough — we cross-walk to the others via OpenAlex.

Two layers, in order:

  Layer A — Metadata anchor (always runs):
      fetch_openalex.py work <input>  →  external_ids{}, oa_url?, sources[]

  Layer B — PDF stop-on-first-200 ladder, gated by `_safe_url()`:
      1. openalex.oa_url    (if present)
      2. unpaywall          (if DOI known + UNPAYWALL_EMAIL set)
      3. core               (if CORE_API_KEY set; skipped on 429)
      4. arxiv              (arxiv.org/pdf/<id>.pdf if arxiv id known)

Output JSON to stdout:
    {
      "external_ids": {...},
      "sources": [...],
      "pdf_path": "raw/download/<provider>/<sha16>.pdf" | "",
      "status": "ok" | "metadata_only" | "failed"
    }

Per-provider attempt log → stderr (debug only; not consumed downstream).

Exit codes:
    0  success — pdf downloaded OR metadata_only (closed-access)
    2  user error (bad input identifier)
    3  hard failure — even the metadata anchor failed
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import requests

import fetch_pdf
from fetch_core import EXIT_RATE_LIMITED
from fetch_pdf import (
    MAX_PDF_BYTES,
    REQUEST_TIMEOUT,
    USER_AGENT,
    _safe_get,
    _safe_url,
    _sha16_id,
    head_check,
)
from id_utils import (
    EXTERNAL_ID_PATTERNS,
    build_source_entry,
    expand_external_ids,
    normalize_external_id,
)

PROJECT_ROOT_DEFAULT = Path.cwd()

# Per-provider HTTP wall-clock — keep aligned with each fetcher's own timeout.
HEAD_TIMEOUT = 30
GET_TIMEOUT = 60

TOOLS_DIR = Path(__file__).resolve().parent


def _err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _attempt_log(provider: str, outcome: str, detail: str = "") -> None:
    """One line per provider attempt; stderr debug stream."""
    pad = " " * max(0, 20 - len(provider))
    line = f"  {provider}{pad}{outcome}"
    if detail:
        line += f"  {detail}"
    _err(line)


# ---------------------------------------------------------------------------
# Input parsing — detect namespace from CLI argument
# ---------------------------------------------------------------------------

def _detect_namespace(raw: str) -> tuple[str, str]:
    """Return (namespace, normalized_id). Raises ValueError on garbage."""
    s = (raw or "").strip()
    if not s:
        raise ValueError("input identifier must not be empty.")

    # Try each namespace; first valid wins. Order matters: openalex is a tight
    # regex (^W\d+$) so checking it before DOI avoids accidental DOI matches.
    for ns in ("openalex", "doi", "arxiv"):
        r = normalize_external_id(ns, s)
        if r["valid"]:
            return ns, r["id"]

    raise ValueError(
        f"Cannot detect identifier type for {raw!r}. Expected DOI, arXiv ID, or OpenAlex Work ID."
    )


# ---------------------------------------------------------------------------
# Layer A — OpenAlex metadata anchor
# ---------------------------------------------------------------------------

def _run_openalex(identifier: str) -> dict[str, Any]:
    """Invoke fetch_openalex.py via subprocess. Raises on hard failure."""
    cmd = ["python3", str(TOOLS_DIR / "fetch_openalex.py"), "work", identifier]
    proc = subprocess.run(
        cmd, capture_output=True, text=True, timeout=GET_TIMEOUT
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"fetch_openalex.py exited {proc.returncode}: {proc.stderr.strip()[:400]}"
        )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"fetch_openalex.py returned non-JSON: {exc}") from exc


# ---------------------------------------------------------------------------
# Layer B — provider PDF endpoints
# ---------------------------------------------------------------------------

def _run_unpaywall(doi: str) -> dict[str, Any] | None:
    """Invoke fetch_unpaywall.py; return parsed JSON or None on graceful skip."""
    cmd = ["python3", str(TOOLS_DIR / "fetch_unpaywall.py"), "doi", doi]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=GET_TIMEOUT)
    if proc.returncode == 2:
        # User error (missing env, bad DOI). Skip silently.
        return None
    if proc.returncode != 0:
        _attempt_log("unpaywall", "error", proc.stderr.strip()[:200])
        return None
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None


def _run_core_search(query: str) -> dict[str, Any] | None:
    """Search CORE for a paper title. Returns first hit or None.

    Sentinel return `{"_rate_limited": True}` when the provider 429s — caller
    must skip the rest of the CORE ladder for the remainder of this run.
    """
    cmd = [
        "python3", str(TOOLS_DIR / "fetch_core.py"), "search", query, "--limit", "1"
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=GET_TIMEOUT)
    if proc.returncode == EXIT_RATE_LIMITED:
        return {"_rate_limited": True}
    if proc.returncode == 2:
        # Missing key — skip silently.
        return None
    if proc.returncode != 0:
        _attempt_log("core", "error", proc.stderr.strip()[:200])
        return None
    try:
        results = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None
    if isinstance(results, list) and results:
        return results[0]
    return None


# ---------------------------------------------------------------------------
# PDF download — uses fetch_pdf internals with SSRF guard re-check per hop
# ---------------------------------------------------------------------------

def _download_pdf(
    session: requests.Session,
    pdf_url: str,
    project_root: Path,
    provider_subdir: str,
    external_id: str,
) -> str:
    """Stream a PDF to `raw/download/<provider_subdir>/<sha16>.pdf`. Return rel path.

    Raises ValueError/RuntimeError on failure. SSRF guard runs both before
    the HEAD probe and before the GET — Location headers from a 3xx are
    never blindly trusted because each `session.get` triggers requests'
    own redirect chain, which we then re-validate by inspecting the final
    `resp.url`.
    """
    if not _safe_url(pdf_url):
        raise ValueError(f"unsafe URL rejected by SSRF guard: {pdf_url}")

    # HEAD probe — verify Content-Type before bandwidth commitment.
    # `head_check` runs with allow_redirects=False so a 3xx Location cannot
    # drive HEAD into an internal host. 3xx here is treated as inconclusive:
    # the real defense is `_safe_get` on the GET below, which walks every
    # redirect hop.
    try:
        status, ctype = head_check(session, pdf_url, timeout=HEAD_TIMEOUT)
    except requests.exceptions.RequestException as exc:
        raise RuntimeError(f"HEAD failed: {exc}") from exc

    head_is_redirect = 300 <= status < 400
    if status >= 400 and status != 405:
        raise RuntimeError(f"HEAD returned {status}")
    if ctype and status != 405 and not head_is_redirect:
        ct = ctype.lower().split(";")[0].strip()
        url_ends_pdf = pdf_url.lower().endswith(".pdf")
        if not (ct.startswith("application/pdf") or ct == "application/octet-stream" or url_ends_pdf):
            raise ValueError(f"HEAD content-type {ctype!r} is not PDF")

    # Streaming GET — `_safe_get` walks redirects manually so every hop is
    # validated against the SSRF guard.
    rel_dir = f"raw/download/{provider_subdir}"
    out_dir = project_root / rel_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{_sha16_id(external_id)}.pdf"
    out_path = out_dir / filename

    if out_path.exists():
        return out_path.relative_to(project_root).as_posix()

    resp = _safe_get(session, pdf_url, timeout=GET_TIMEOUT)
    if resp.status_code >= 400:
        raise RuntimeError(f"GET returned {resp.status_code}")

    fd, tmp_path_str = tempfile.mkstemp(dir=out_dir, suffix=".tmp")
    size = 0
    hasher = hashlib.sha256()
    try:
        with os.fdopen(fd, "wb") as f:
            for chunk in resp.iter_content(chunk_size=65536):
                if not chunk:
                    continue
                size += len(chunk)
                if size > MAX_PDF_BYTES:
                    raise ValueError(
                        f"PDF exceeds size cap {MAX_PDF_BYTES} bytes"
                    )
                f.write(chunk)
                hasher.update(chunk)
            f.flush()
            os.fsync(f.fileno())
    except Exception:
        try:
            os.unlink(tmp_path_str)
        except OSError:
            pass
        raise

    if size < 100:
        try:
            os.unlink(tmp_path_str)
        except OSError:
            pass
        raise ValueError(f"downloaded body too small ({size} bytes)")

    try:
        os.replace(tmp_path_str, out_path)
    except OSError:
        # Cross-device rename or permission failure — clean up to avoid .tmp leak.
        try:
            os.unlink(tmp_path_str)
        except OSError:
            pass
        raise
    return out_path.relative_to(project_root).as_posix()


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def resolve(input_id: str, project_root: Path) -> dict[str, Any]:
    """Main orchestration. Returns the JSON payload defined in the docstring."""
    ns, normalized = _detect_namespace(input_id)
    _err(f"resolve_pdf input={ns}:{normalized}")

    # Layer A — metadata anchor. Always runs, even when input is arxiv-only,
    # so the cross-walk populates DOI / OpenAlex IDs for downstream consumers.
    t0 = time.monotonic()
    try:
        oa_record = _run_openalex(normalized)
    except (RuntimeError, ValueError) as exc:
        _attempt_log("openalex", "metadata_failed", str(exc)[:200])
        return {
            "external_ids": {ns: normalized},
            "sources": [],
            "pdf_path": "",
            "status": "failed",
            "error": str(exc),
        }
    anchor_ms = int((time.monotonic() - t0) * 1000)
    _attempt_log("openalex", "metadata_ok", f"{anchor_ms}ms")

    external_ids: dict[str, str] = dict(oa_record.get("external_ids") or {})
    # Always include the user-supplied identifier in case OpenAlex missed it.
    external_ids.setdefault(ns, normalized)
    external_ids = expand_external_ids(external_ids)

    sources: list[dict[str, Any]] = list(oa_record.get("sources") or [])

    # Best stable key for filename hashing.
    if external_ids.get("doi"):
        fname_key = f"doi:{external_ids['doi']}"
    elif external_ids.get("arxiv"):
        fname_key = f"arxiv:{external_ids['arxiv']}"
    elif external_ids.get("openalex"):
        fname_key = f"openalex:{external_ids['openalex']}"
    else:
        fname_key = f"{ns}:{normalized}"

    # Build a session for the PDF ladder.
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    pdf_path = ""
    core_skip = False

    # --- Step 1: openalex.oa_url
    oa_url = oa_record.get("oa_url")
    if isinstance(oa_url, str) and oa_url:
        try:
            pdf_path = _download_pdf(session, oa_url, project_root, "openalex", fname_key)
            sources.append(build_source_entry("openalex", url=oa_url))
            _attempt_log("openalex.oa_url", "200", pdf_path)
        except (ValueError, RuntimeError, requests.exceptions.RequestException) as exc:
            _attempt_log("openalex.oa_url", "failed", str(exc)[:200])
            pdf_path = ""

    # --- Step 2: Unpaywall (requires DOI)
    if not pdf_path and external_ids.get("doi"):
        up = _run_unpaywall(external_ids["doi"])
        if up and up.get("is_oa"):
            loc = up.get("best_oa_location") or {}
            pdf_url = loc.get("pdf_url") if isinstance(loc, dict) else None
            if isinstance(pdf_url, str) and pdf_url:
                try:
                    pdf_path = _download_pdf(
                        session, pdf_url, project_root, "unpaywall", fname_key
                    )
                    sources.extend(up.get("sources") or [])
                    _attempt_log("unpaywall", "200", pdf_path)
                except (ValueError, RuntimeError, requests.exceptions.RequestException) as exc:
                    _attempt_log("unpaywall", "failed", str(exc)[:200])
        else:
            _attempt_log("unpaywall", "closed_access" if up else "skipped")

    # --- Step 3: CORE (requires title for search; skipped on 429)
    if not pdf_path and not core_skip:
        title = oa_record.get("title") or ""
        if isinstance(title, str) and title.strip():
            core_hit = _run_core_search(title.strip())
            if core_hit and core_hit.get("_rate_limited"):
                core_skip = True
                _attempt_log("core", "rate_limited", "skipping remaining CORE calls")
            elif core_hit:
                cdl = core_hit.get("download_url") or ""
                if isinstance(cdl, str) and cdl.startswith("https://"):
                    try:
                        pdf_path = _download_pdf(
                            session, cdl, project_root, "core", fname_key
                        )
                        sources.extend(core_hit.get("sources") or [])
                        _attempt_log("core", "200", pdf_path)
                    except (ValueError, RuntimeError, requests.exceptions.RequestException) as exc:
                        _attempt_log("core", "failed", str(exc)[:200])
                else:
                    _attempt_log("core", "no_download_url")
            else:
                _attempt_log("core", "no_hit")
        else:
            _attempt_log("core", "skipped", "no title for search")

    # --- Step 4: arxiv direct
    if not pdf_path and external_ids.get("arxiv"):
        arxiv_id = external_ids["arxiv"]
        arxiv_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
        try:
            pdf_path = _download_pdf(session, arxiv_url, project_root, "arxiv", fname_key)
            sources.append(build_source_entry("arxiv", url=arxiv_url, ns="arxiv", value=arxiv_id))
            _attempt_log("arxiv", "200", pdf_path)
        except (ValueError, RuntimeError, requests.exceptions.RequestException) as exc:
            _attempt_log("arxiv", "failed", str(exc)[:200])

    status = "ok" if pdf_path else "metadata_only"
    return {
        "external_ids": external_ids,
        "sources": sources,
        "pdf_path": pdf_path,
        "status": status,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="resolve_pdf.py",
        description=(
            "Resolve DOI / arXiv ID / OpenAlex Work ID → external_ids cross-walk + "
            "downloaded PDF (best-effort). Always runs OpenAlex anchor first; "
            "PDF ladder stops on first 200."
        ),
    )
    parser.add_argument("input", help="Identifier: DOI, arXiv ID, or OpenAlex W-id.")
    parser.add_argument(
        "--project-root", default=None,
        help="Project root for raw/download (default: current dir).",
    )
    args = parser.parse_args(argv)

    project_root = (
        Path(args.project_root).resolve() if args.project_root else PROJECT_ROOT_DEFAULT.resolve()
    )

    try:
        result = resolve(args.input, project_root)
    except ValueError as exc:
        _err(f"Error: {exc}")
        sys.exit(2)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result.get("status") == "failed":
        sys.exit(3)
    sys.exit(0)


if __name__ == "__main__":
    main()
