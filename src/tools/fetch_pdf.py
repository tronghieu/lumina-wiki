"""
fetch_pdf.py — Download a PDF from a URL into the workspace landing zone.

CLI:
    python fetch_pdf.py <url> [--project-root PATH] [--filename NAME] [--force]

Output (stdout, single JSON object on success):
    {
      "url": "<input url>",
      "resolved_url": "<final url after redirects/normalization>",
      "resource": "arxiv|doi|s2|web",
      "id": "<extracted id>",
      "path": "raw/download/arxiv/2604.03501v2.pdf",
      "size_bytes": 12345,
      "sha256": "<hex>",
      "skipped": false
    }

Errors emitted to stderr as JSON; exit codes:
    0  success (or skipped due to existing file)
    2  user error (empty url, malformed url, path traversal, HTML response)
    3  transient error (network failure, HTTP 5xx, timeout)

No API key required. All network calls use requests.Session().
Landing zone: raw/download/<resource>/<filename>
    resource = arxiv | doi | s2 | web
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

USER_AGENT = "lumina-wiki/0.1 (research-pack; pdf fetcher)"
REQUEST_TIMEOUT = 60
MIN_PDF_SIZE = 100  # bytes — smaller responses are likely error pages
CHUNK_SIZE = 65536  # 64 KB chunks for streaming download

# Windows-illegal characters in filenames
_WIN_ILLEGAL_RE = re.compile(r'[<>:"/\\|?*]')

# Resource detection patterns — compiled once at module level
_ARXIV_ABS_RE = re.compile(
    r"arxiv\.org/abs/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)", re.IGNORECASE
)
_ARXIV_PDF_RE = re.compile(
    r"arxiv\.org/pdf/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)(?:\.pdf)?$", re.IGNORECASE
)
_DOI_RE = re.compile(r"(?:dx\.)?doi\.org/(.+)", re.IGNORECASE)
_S2_RE = re.compile(r"semanticscholar\.org/paper/([^/?#]+)", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _err_json(msg: str, code: int) -> None:
    """Print a JSON error to stderr."""
    print(json.dumps({"error": msg, "code": code}), file=sys.stderr)


def _sha16_url(url: str) -> str:
    """First 16 hex chars of SHA256 of URL — used as web resource ID."""
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def _sanitize_filename(name: str) -> str:
    """Remove Windows-illegal characters from a filename."""
    return _WIN_ILLEGAL_RE.sub("_", name)


def _safe_path(base: Path, rel: str, label: str) -> Path:
    """Resolve rel under base; reject '..', absolute, or escaping paths."""
    rel_path = Path(rel)
    if rel_path.is_absolute():
        _err_json(f"{label} must be a relative path, got: {rel}", 2)
        sys.exit(2)
    if ".." in rel_path.parts:
        _err_json(f"{label} contains '..': {rel}", 2)
        sys.exit(2)
    resolved = (base / rel_path).resolve()
    try:
        resolved.relative_to(base.resolve())
    except ValueError:
        _err_json(f"{label} escapes base directory: {rel}", 2)
        sys.exit(2)
    return resolved


# ---------------------------------------------------------------------------
# Resource detection
# ---------------------------------------------------------------------------

def detect_resource(url: str) -> tuple[str, str, str]:
    """Detect resource type and ID from URL.

    Returns:
        (resource, id, resolved_pdf_url)

    resource is one of: arxiv, doi, s2, web
    """
    url = url.strip()

    # arxiv abs
    m = _ARXIV_ABS_RE.search(url)
    if m:
        arxiv_id = m.group(1)
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
        return "arxiv", arxiv_id, pdf_url

    # arxiv pdf
    m = _ARXIV_PDF_RE.search(url)
    if m:
        arxiv_id = m.group(1)
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
        return "arxiv", arxiv_id, pdf_url

    # DOI
    m = _DOI_RE.search(url)
    if m:
        doi_raw = m.group(1).rstrip("/")
        doi_id = doi_raw.replace("/", "-")
        return "doi", doi_id, url

    # Semantic Scholar
    m = _S2_RE.search(url)
    if m:
        s2_id = m.group(1)
        return "s2", s2_id, url

    # Web fallback
    sha16 = _sha16_url(url)
    return "web", sha16, url


def _derive_filename(resource: str, id_: str, content_type: str = "") -> str:
    """Derive a default filename from resource/id.

    For 'web', probes content_type for extension; defaults to .pdf.
    """
    if resource in ("arxiv", "doi", "s2"):
        return _sanitize_filename(id_) + ".pdf"
    # web
    ext = ".pdf"
    if content_type:
        ct = content_type.lower().split(";")[0].strip()
        if "octet-stream" in ct or "pdf" in ct:
            ext = ".pdf"
        # If it's something else we still default to .pdf per spec
    return _sanitize_filename(id_) + ext


# ---------------------------------------------------------------------------
# Session factory
# ---------------------------------------------------------------------------

def _make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


# ---------------------------------------------------------------------------
# Core download function
# ---------------------------------------------------------------------------

def fetch_pdf(
    url: str,
    project_root: Path,
    filename: str | None = None,
    force: bool = False,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    """Download a PDF from url into raw/download/<resource>/<filename>.

    Args:
        url: The source URL (arxiv abs/pdf, doi, s2, or generic web URL).
        project_root: Absolute path to the project root.
        filename: Override output filename (sanitized). If None, derived from resource/id.
        force: If True, overwrite existing file. If False, skip if exists.
        session: Optional requests.Session for connection reuse.

    Returns:
        Result dict (see module docstring).

    Raises:
        ValueError: on user errors (empty url, content-type mismatch, path traversal).
        RuntimeError: on transient errors (network, HTTP 5xx, timeout).
        requests.RequestException: on low-level network failure (caller re-raises).
    """
    url = url.strip()
    if not url:
        raise ValueError("url must not be empty")

    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError(f"malformed url (no scheme or host): {url!r}")

    resource, res_id, resolved_url = detect_resource(url)

    sess = session or _make_session()

    if filename is not None:
        out_filename = _sanitize_filename(filename)
        if not out_filename:
            raise ValueError(f"--filename becomes empty after sanitization: {filename!r}")
    else:
        out_filename = None

    rel_dir = f"raw/download/{resource}"
    out_dir = _safe_path(project_root, rel_dir, "output directory")

    if out_filename is None:
        out_filename = _derive_filename(resource, res_id)

    if "/" in out_filename or "\\" in out_filename or ".." in out_filename:
        raise ValueError(f"filename contains path separators or '..': {out_filename!r}")

    out_path = out_dir / out_filename

    # Idempotency: skip if exists and not --force
    if out_path.exists() and not force:
        return {
            "url": url,
            "resolved_url": resolved_url,
            "resource": resource,
            "id": res_id,
            "path": str(out_path.relative_to(project_root)),
            "size_bytes": out_path.stat().st_size,
            "sha256": _sha256_file(out_path),
            "skipped": True,
            "reason": "exists",
        }

    # Streaming download
    resp = sess.get(resolved_url, timeout=REQUEST_TIMEOUT, allow_redirects=True, stream=True)

    if resp.status_code >= 500:
        raise RuntimeError(f"HTTP {resp.status_code} from server")
    if resp.status_code == 404:
        raise ValueError(f"HTTP 404: resource not found at {resolved_url}")
    if resp.status_code >= 400:
        raise ValueError(f"HTTP {resp.status_code} from server")
    resp.raise_for_status()

    content_type = resp.headers.get("Content-Type", "")

    # For 'web' resource, refine the filename extension from content-type
    if resource == "web" and filename is None:
        out_filename = _derive_filename(resource, res_id, content_type)
        out_path = out_dir / out_filename

    ct_lower = content_type.lower().split(";")[0].strip()
    url_ends_pdf = resolved_url.lower().endswith(".pdf")
    is_pdf = ct_lower.startswith("application/pdf") or url_ends_pdf

    if not is_pdf and ct_lower.startswith("text/html"):
        raise ValueError(
            f"expected PDF but server returned HTML (Content-Type: {content_type}); "
            f"URL may be a landing page rather than a direct PDF link"
        )

    # Atomic write: temp + streaming + fsync + rename; SHA256 computed during download
    out_dir.mkdir(parents=True, exist_ok=True)
    fd, tmp_path_str = tempfile.mkstemp(dir=out_dir, suffix=".tmp")
    hasher = hashlib.sha256()
    size = 0
    try:
        with os.fdopen(fd, "wb") as f:
            for chunk in resp.iter_content(chunk_size=CHUNK_SIZE):
                if chunk:
                    f.write(chunk)
                    hasher.update(chunk)
                    size += len(chunk)
            f.flush()
            os.fsync(f.fileno())
    except Exception:
        try:
            os.unlink(tmp_path_str)
        except OSError:
            pass
        raise

    if size < MIN_PDF_SIZE:
        try:
            os.unlink(tmp_path_str)
        except OSError:
            pass
        raise ValueError(
            f"downloaded content is too small ({size} bytes < {MIN_PDF_SIZE}); "
            f"likely an error page rather than a real PDF"
        )

    os.replace(tmp_path_str, out_path)

    return {
        "url": url,
        "resolved_url": resp.url,
        "resource": resource,
        "id": res_id,
        "path": str(out_path.relative_to(project_root)),
        "size_bytes": size,
        "sha256": hasher.hexdigest(),
        "skipped": False,
    }


def _sha256_file(path: Path) -> str:
    """Compute SHA256 of an existing file."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(CHUNK_SIZE), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="fetch_pdf.py",
        description=(
            "Download a PDF from a URL into raw/download/<resource>/<filename>. "
            "Detects arxiv, DOI, Semantic Scholar, and generic web URLs."
        ),
    )
    parser.add_argument("url", help="URL of the PDF to download.")
    parser.add_argument(
        "--project-root", default=None,
        help="Project root directory (default: current directory).",
    )
    parser.add_argument(
        "--filename", default=None,
        help="Override output filename (default: derived from resource/id).",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-download and overwrite if file already exists.",
    )

    args = parser.parse_args(argv)

    if not args.url or not args.url.strip():
        _err_json("url must not be empty", 2)
        sys.exit(2)

    project_root = (
        Path(args.project_root).resolve()
        if args.project_root
        else Path.cwd().resolve()
    )

    if args.filename is not None:
        fn = args.filename
        if "/" in fn or "\\" in fn or ".." in fn:
            _err_json(
                f"--filename must be a plain filename (no path separators or '..'): {fn!r}",
                2,
            )
            sys.exit(2)

    session = _make_session()

    try:
        result = fetch_pdf(
            url=args.url,
            project_root=project_root,
            filename=args.filename,
            force=args.force,
            session=session,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(0)

    except ValueError as exc:
        _err_json(str(exc), 2)
        sys.exit(2)
    except requests.exceptions.ConnectionError as exc:
        _err_json(f"Network error: {exc}", 3)
        sys.exit(3)
    except requests.exceptions.Timeout:
        _err_json("Request timed out while downloading PDF.", 3)
        sys.exit(3)
    except requests.exceptions.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else "unknown"
        _err_json(f"HTTP error {code} while downloading PDF.", 3)
        sys.exit(3)
    except RuntimeError as exc:
        _err_json(str(exc), 3)
        sys.exit(3)
    except OSError as exc:
        _err_json(f"I/O error: {exc}", 3)
        sys.exit(3)
    except Exception as exc:  # noqa: BLE001
        _err_json(f"Internal error: {exc}", 3)
        sys.exit(3)


if __name__ == "__main__":
    main()
