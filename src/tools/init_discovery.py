"""
init_discovery.py — Multi-phase discovery session with checkpoint manifest.

Drives a discovery session for a research topic:
    Phase 1 — keyword search across configured fetchers
    Phase 2 — author backfill (fetch more papers by top authors found in phase 1)
    Phase 3 — citation expansion (fetch citations/references of top phase-1 papers)

Writes fetched sources under raw/discovered/<slug>/
Writes checkpoint manifests at _lumina/_state/discovery-<phase>.json

Resumable: if a phase checkpoint exists and --resume is passed, that
phase is skipped and its results are loaded from disk. Kill -9 mid-phase
leaves the completed sub-phases intact; the next run with --resume
continues from the last completed checkpoint.

CLI:
    python init_discovery.py --topic "flash attention" [--project-root PATH]
                             [--phases 1,2,3] [--resume]
                             [--fetchers arxiv,s2] [--limit N]

JSON summary emitted to stdout on completion.
Errors emitted to stderr; exit codes:
    0  success
    2  user error (bad args, missing API key) — actionable message
    3  internal/transient error (network, API failure) — retry hint

Writes to:
    raw/discovered/<slug>/        — individual JSON files per fetched source
    _lumina/_state/               — discovery-<phase>.json checkpoints

Never writes to wiki/. Skills own wiki/.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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

from id_utils import (
    expand_external_ids,
    normalize_external_id,
    parse_url_to_external_ids,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_LIMIT = 20
DEFAULT_PHASES = "1,2,3"
DEFAULT_FETCHERS = "arxiv,s2"

# Max authors to backfill in phase 2
MAX_AUTHORS_BACKFILL = 3
# Max papers for citation expansion per seed in phase 3
CITATIONS_PER_SEED = 10


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _slugify(text: str) -> str:
    """Convert a topic string to a filesystem-safe slug."""
    slug = text.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug[:64].strip("-") or "discovery"


def _safe_path(base: Path, rel: str) -> Path:
    """Resolve a relative path within base; reject traversal."""
    resolved = (base / rel).resolve()
    try:
        resolved.relative_to(base.resolve())
    except ValueError as exc:
        raise ValueError(f"Path traversal rejected: {rel!r} escapes {base}") from exc
    return resolved


def _atomic_write_json(path: Path, data: Any) -> None:
    """Write data as JSON atomically (temp + replace)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    os.replace(tmp_path, path)


def _load_checkpoint(state_dir: Path, phase: int) -> dict[str, Any] | None:
    """Load a phase checkpoint if it exists."""
    cp_path = state_dir / f"discovery-{phase}.json"
    if cp_path.exists():
        try:
            return json.loads(cp_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
    return None


def _save_checkpoint(state_dir: Path, phase: int, data: dict[str, Any]) -> None:
    """Save a phase checkpoint atomically."""
    cp_path = state_dir / f"discovery-{phase}.json"
    _atomic_write_json(cp_path, data)


def _compute_external_ids(paper: dict[str, Any]) -> dict[str, str]:
    """Map fetcher fields → validated `external_ids` dict.

    Reads from common shapes (arxiv `id`, S2 `paperId`, `externalIds.DOI`,
    `externalIds.ArXiv`, `url`). Each value is run through
    `normalize_external_id`; invalid values are dropped with a stderr warning.
    """
    ids: dict[str, str] = {}

    def _try_set(ns: str, raw: Any) -> None:
        if not raw or not isinstance(raw, str):
            return
        r = normalize_external_id(ns, raw)
        if r["valid"] and r["id"]:
            ids[ns] = r["id"]
        else:
            _err(f"[warn] dropped invalid external_id {ns}={raw!r}")

    # arXiv adapter shape: top-level `id` like "1706.03762".
    if isinstance(paper.get("id"), str) and "." in paper["id"]:
        _try_set("arxiv", paper["id"])

    # Semantic Scholar adapter shape.
    pid = paper.get("paperId")
    if isinstance(pid, str):
        _try_set("s2", pid)
    ext = paper.get("externalIds")
    if isinstance(ext, dict):
        if "DOI" in ext:
            _try_set("doi", ext.get("DOI"))
        if "ArXiv" in ext:
            _try_set("arxiv", ext.get("ArXiv"))

    # Canonical URL — derive from explicit `url` field or arxiv `id`.
    url = paper.get("url")
    if isinstance(url, str):
        url_ids = parse_url_to_external_ids(url)
        for ns, val in url_ids.items():
            ids.setdefault(ns, val)

    # Pre-normalized `external_ids` map (e.g. from fetch_openalex.normalize_record).
    # Trust upstream validation — re-validate here to guard against drift.
    pre = paper.get("external_ids")
    if isinstance(pre, dict):
        for ns, raw in pre.items():
            if ns in ids:
                continue
            if not isinstance(ns, str) or not isinstance(raw, str):
                continue
            r = normalize_external_id(ns, raw)
            if r["valid"] and r["id"]:
                ids[ns] = r["id"]

    return ids


def _save_source(discovered_dir: Path, slug: str, source: dict[str, Any]) -> Path:
    """Save a single source dict to raw/discovered/<slug>/<id>.json atomically."""
    raw_id = source.get("id") or source.get("paperId")
    if not raw_id:
        # Fall back to any namespace in pre-normalized external_ids (OpenAlex etc.).
        # Priority mirrors `external_id_match_key` so the filename derived here
        # stays stable across re-runs even if the same paper arrives via a
        # different fetcher (e.g. arxiv vs openalex returning the same DOI).
        ext = source.get("external_ids")
        if isinstance(ext, dict):
            for ns in ("doi", "arxiv", "s2", "openalex"):
                v = ext.get(ns)
                if isinstance(v, str) and v:
                    raw_id = v
                    break
    raw_id = raw_id or "unknown"
    source_id = re.sub(r'[<>:"/\\|?*]', "_", raw_id)
    filename = f"{source_id}.json"
    out_path = _safe_path(discovered_dir / slug, filename)
    enriched = dict(source)
    enriched["external_ids"] = expand_external_ids(_compute_external_ids(source))
    _atomic_write_json(out_path, enriched)
    return out_path


def _is_excluded(paper: dict[str, Any], exclude_keys: set[str]) -> bool:
    """True if any expanded external_ids value of `paper` is in exclude_keys."""
    if not exclude_keys:
        return False
    candidate = expand_external_ids(_compute_external_ids(paper))
    for v in candidate.values():
        if v in exclude_keys:
            return True
    # Back-compat: legacy callers exclude by raw paper id without external_ids.
    pid = paper.get("id") or paper.get("paperId") or ""
    return bool(pid) and pid in exclude_keys


# ---------------------------------------------------------------------------
# Fetcher adapters
# ---------------------------------------------------------------------------

def _arxiv_search(query: str, limit: int, env: dict[str, str]) -> list[dict[str, Any]]:
    """Run arXiv search; return list of paper dicts."""
    try:
        import requests as req
        from fetch_arxiv import search_arxiv, _make_session as arxiv_session
        session = arxiv_session()
        return search_arxiv(query, limit, 0, session)
    except ImportError:
        import subprocess
        result = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "fetch_arxiv.py"),
             "search", query, "--max", str(limit)],
            capture_output=True, text=True, env={**os.environ, **env}
        )
        if result.returncode != 0:
            raise RuntimeError(f"fetch_arxiv.py failed: {result.stderr.strip()}")
        return json.loads(result.stdout)


def _openalex_search(query: str, limit: int, env: dict[str, str]) -> list[dict[str, Any]]:
    """Run OpenAlex search; return list of paper dicts. Auth via OPENALEX_API_KEY."""
    try:
        from fetch_openalex import cmd_search
        api_key = env.get("OPENALEX_API_KEY", "").strip()
        return cmd_search(query, limit, [], api_key)
    except ImportError:
        import subprocess
        merged_env = {**os.environ, **env}
        result = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "fetch_openalex.py"),
             "search", query, "--limit", str(limit)],
            capture_output=True, text=True, env=merged_env
        )
        if result.returncode != 0:
            return []
        data = json.loads(result.stdout)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _s2_search(query: str, limit: int, env: dict[str, str]) -> list[dict[str, Any]]:
    """Run Semantic Scholar search; return list of paper dicts."""
    api_key = env.get("SEMANTIC_SCHOLAR_API_KEY", "")
    if not api_key:
        return []  # S2 is optional; silently skip if key missing
    try:
        from fetch_s2 import search_papers, _make_session as s2_session
        session = s2_session(api_key)
        result = search_papers(query, session, limit, 0)
        return result.get("data", [])
    except ImportError:
        import subprocess
        merged_env = {**os.environ, **env}
        result = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "fetch_s2.py"),
             "search", query, "--limit", str(limit)],
            capture_output=True, text=True, env=merged_env
        )
        if result.returncode != 0:
            return []
        data = json.loads(result.stdout)
        if isinstance(data, dict):
            return data.get("data", [])
        return data


def _s2_citations(paper_id: str, limit: int, env: dict[str, str]) -> list[dict[str, Any]]:
    """Fetch S2 citations for a paper."""
    api_key = env.get("SEMANTIC_SCHOLAR_API_KEY", "")
    if not api_key:
        return []
    try:
        from fetch_s2 import fetch_citations, _make_session as s2_session
        session = s2_session(api_key)
        result = fetch_citations(paper_id, session, limit, 0)
        return result.get("data", [])
    except Exception:
        return []


def _s2_author_papers(author_name: str, limit: int, env: dict[str, str]) -> list[dict[str, Any]]:
    """Search for papers by a specific author via S2."""
    api_key = env.get("SEMANTIC_SCHOLAR_API_KEY", "")
    if not api_key:
        return []
    query = f"author:{author_name}"
    try:
        from fetch_s2 import search_papers, _make_session as s2_session
        session = s2_session(api_key)
        result = search_papers(query, session, limit, 0)
        return result.get("data", [])
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Phase implementations
# ---------------------------------------------------------------------------

def phase1_keyword_search(
    topic: str,
    slug: str,
    discovered_dir: Path,
    fetchers: list[str],
    limit: int,
    env: dict[str, str],
    exclude_keys: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Phase 1: keyword search across configured fetchers."""
    if exclude_keys is None:
        exclude_keys = set()
    results: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for fetcher in fetchers:
        try:
            if fetcher == "arxiv":
                papers = _arxiv_search(topic, limit, env)
            elif fetcher == "s2":
                papers = _s2_search(topic, limit, env)
            elif fetcher == "openalex":
                papers = _openalex_search(topic, limit, env)
            else:
                _err(f"Warning: unknown fetcher '{fetcher}' skipped.")
                continue
        except Exception as exc:
            _err(f"Warning: fetcher '{fetcher}' failed in phase 1: {exc}")
            continue

        for paper in papers:
            pid = paper.get("id") or paper.get("paperId") or ""
            if pid and pid in seen_ids:
                continue
            if _is_excluded(paper, exclude_keys):
                continue
            if pid:
                seen_ids.add(pid)
            results.append(paper)
            _save_source(discovered_dir, slug, paper)

    return results


def phase2_author_backfill(
    phase1_results: list[dict[str, Any]],
    slug: str,
    discovered_dir: Path,
    limit: int,
    env: dict[str, str],
    exclude_keys: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Phase 2: fetch more papers by the most prolific authors from phase 1."""
    if exclude_keys is None:
        exclude_keys = set()
    # Count author occurrences across phase-1 results
    author_counts: dict[str, int] = {}
    for paper in phase1_results:
        authors = paper.get("authors", [])
        for a in authors:
            name = a.get("name") if isinstance(a, dict) else str(a)
            if name:
                author_counts[name] = author_counts.get(name, 0) + 1

    # Pick top authors by frequency
    top_authors = sorted(author_counts, key=lambda a: -author_counts[a])[:MAX_AUTHORS_BACKFILL]

    results: list[dict[str, Any]] = []
    seen_ids: set[str] = {p.get("id") or p.get("paperId") or "" for p in phase1_results}

    for author in top_authors:
        try:
            papers = _s2_author_papers(author, limit, env)
        except Exception as exc:
            _err(f"Warning: author backfill failed for '{author}': {exc}")
            continue
        for paper in papers:
            pid = paper.get("id") or paper.get("paperId") or ""
            if pid and pid in seen_ids:
                continue
            if _is_excluded(paper, exclude_keys):
                continue
            if pid:
                seen_ids.add(pid)
            results.append(paper)
            _save_source(discovered_dir, slug, paper)

    return results


def phase3_citation_expansion(
    phase1_results: list[dict[str, Any]],
    slug: str,
    discovered_dir: Path,
    env: dict[str, str],
    exclude_keys: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Phase 3: fetch citations of top phase-1 papers."""
    if exclude_keys is None:
        exclude_keys = set()
    # Sort by citation count to pick the most-cited seeds
    def sort_key(p: dict[str, Any]) -> int:
        v = p.get("citationCount") or p.get("citation_count") or 0
        try:
            return -int(v)
        except (TypeError, ValueError):
            return 0

    seeds = sorted(phase1_results, key=sort_key)[:5]
    results: list[dict[str, Any]] = []
    seen_ids: set[str] = {p.get("id") or p.get("paperId") or "" for p in phase1_results}

    for seed in seeds:
        pid = seed.get("paperId") or seed.get("id") or ""
        if not pid:
            continue
        try:
            citations = _s2_citations(pid, CITATIONS_PER_SEED, env)
        except Exception as exc:
            _err(f"Warning: citation expansion failed for '{pid}': {exc}")
            continue
        for paper in citations:
            cid = paper.get("id") or paper.get("paperId") or ""
            if cid and cid in seen_ids:
                continue
            if _is_excluded(paper, exclude_keys):
                continue
            if cid:
                seen_ids.add(cid)
            results.append(paper)
            _save_source(discovered_dir, slug, paper)

    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="init_discovery.py",
        description=(
            "Run a multi-phase discovery session for a research topic. "
            "Writes sources to raw/discovered/<slug>/ and checkpoints to "
            "_lumina/_state/discovery-<phase>.json."
        ),
    )
    parser.add_argument("--topic", required=True, help="Research topic string.")
    parser.add_argument("--project-root", default=None,
                        help="Project root directory (default: current directory).")
    parser.add_argument("--phases", default=DEFAULT_PHASES,
                        help=f"Comma-separated phases to run (default: {DEFAULT_PHASES}).")
    parser.add_argument("--resume", action="store_true",
                        help="Skip phases with existing checkpoints and resume.")
    parser.add_argument("--fetchers", default=DEFAULT_FETCHERS,
                        help=f"Comma-separated fetchers (default: {DEFAULT_FETCHERS}).")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT,
                        help=f"Max results per fetcher per phase (default: {DEFAULT_LIMIT}).")
    parser.add_argument(
        "--exclude-keys", default="",
        help="Comma-separated list of external_ids values (DOI, arXiv ID, S2 "
             "paperId, canonical URL) to skip. Candidates are filtered by "
             "expanded external_ids set so a DOI excludes its arxiv form too.",
    )

    args = parser.parse_args(argv)

    if not args.topic.strip():
        _err("Error: --topic must not be empty.")
        sys.exit(2)

    project_root = Path(args.project_root).resolve() if args.project_root else Path.cwd().resolve()
    discovered_dir = project_root / "raw" / "discovered"
    state_dir = project_root / "_lumina" / "_state"

    try:
        phases_to_run = [int(p.strip()) for p in args.phases.split(",") if p.strip()]
    except ValueError:
        _err("Error: --phases must be a comma-separated list of integers, e.g. 1,2,3")
        sys.exit(2)

    fetchers = [f.strip() for f in args.fetchers.split(",") if f.strip()]
    exclude_keys: set[str] = {
        s.strip() for s in args.exclude_keys.split(",") if s.strip()
    }
    slug = _slugify(args.topic)
    env = load_env(project_root)

    phase1_results: list[dict[str, Any]] = []
    phase2_results: list[dict[str, Any]] = []
    phase3_results: list[dict[str, Any]] = []

    summary: dict[str, Any] = {
        "topic": args.topic,
        "slug": slug,
        "started_at": datetime.now(tz=timezone.utc).isoformat(),
        "phases": {},
    }

    try:
        # --- Phase 1 ---
        if 1 in phases_to_run:
            if args.resume:
                cp = _load_checkpoint(state_dir, 1)
                if cp is not None:
                    phase1_results = cp.get("results", [])
                    summary["phases"]["1"] = {"status": "resumed", "count": len(phase1_results)}
                    _err(f"Phase 1 resumed from checkpoint ({len(phase1_results)} results).")
                else:
                    _err(f"Phase 1: keyword search across {fetchers} (limit={args.limit})...")
                    phase1_results = phase1_keyword_search(
                        args.topic, slug, discovered_dir, fetchers, args.limit, env, exclude_keys
                    )
                    _save_checkpoint(state_dir, 1, {"results": phase1_results, "slug": slug})
                    _err(f"Phase 1 complete: {len(phase1_results)} unique candidates.")
                    summary["phases"]["1"] = {"status": "complete", "count": len(phase1_results)}
            else:
                _err(f"Phase 1: keyword search across {fetchers} (limit={args.limit})...")
                phase1_results = phase1_keyword_search(
                    args.topic, slug, discovered_dir, fetchers, args.limit, env, exclude_keys
                )
                _save_checkpoint(state_dir, 1, {"results": phase1_results, "slug": slug})
                _err(f"Phase 1 complete: {len(phase1_results)} unique candidates.")
                summary["phases"]["1"] = {"status": "complete", "count": len(phase1_results)}
        else:
            # Load from checkpoint if phase 1 was run previously
            cp = _load_checkpoint(state_dir, 1)
            if cp:
                phase1_results = cp.get("results", [])

        # --- Phase 2 ---
        if 2 in phases_to_run:
            if args.resume:
                cp = _load_checkpoint(state_dir, 2)
                if cp is not None:
                    phase2_results = cp.get("results", [])
                    summary["phases"]["2"] = {"status": "resumed", "count": len(phase2_results)}
                    _err(f"Phase 2 resumed from checkpoint ({len(phase2_results)} results).")
                else:
                    _err(f"Phase 2: author backfill (top {MAX_AUTHORS_BACKFILL} authors, limit={args.limit})...")
                    phase2_results = phase2_author_backfill(
                        phase1_results, slug, discovered_dir, args.limit, env, exclude_keys
                    )
                    _save_checkpoint(state_dir, 2, {"results": phase2_results, "slug": slug})
                    _err(f"Phase 2 complete: {len(phase2_results)} unique candidates.")
                    summary["phases"]["2"] = {"status": "complete", "count": len(phase2_results)}
            else:
                _err(f"Phase 2: author backfill (top {MAX_AUTHORS_BACKFILL} authors, limit={args.limit})...")
                phase2_results = phase2_author_backfill(
                    phase1_results, slug, discovered_dir, args.limit, env, exclude_keys
                )
                _save_checkpoint(state_dir, 2, {"results": phase2_results, "slug": slug})
                _err(f"Phase 2 complete: {len(phase2_results)} unique candidates.")
                summary["phases"]["2"] = {"status": "complete", "count": len(phase2_results)}

        # --- Phase 3 ---
        if 3 in phases_to_run:
            if args.resume:
                cp = _load_checkpoint(state_dir, 3)
                if cp is not None:
                    phase3_results = cp.get("results", [])
                    summary["phases"]["3"] = {"status": "resumed", "count": len(phase3_results)}
                    _err(f"Phase 3 resumed from checkpoint ({len(phase3_results)} results).")
                else:
                    _err(f"Phase 3: citation expansion (top 5 seeds × {CITATIONS_PER_SEED} citations)...")
                    phase3_results = phase3_citation_expansion(
                        phase1_results, slug, discovered_dir, env, exclude_keys
                    )
                    _save_checkpoint(state_dir, 3, {"results": phase3_results, "slug": slug})
                    _err(f"Phase 3 complete: {len(phase3_results)} unique candidates.")
                    summary["phases"]["3"] = {"status": "complete", "count": len(phase3_results)}
            else:
                _err(f"Phase 3: citation expansion (top 5 seeds × {CITATIONS_PER_SEED} citations)...")
                phase3_results = phase3_citation_expansion(
                    phase1_results, slug, discovered_dir, env, exclude_keys
                )
                _save_checkpoint(state_dir, 3, {"results": phase3_results, "slug": slug})
                _err(f"Phase 3 complete: {len(phase3_results)} unique candidates.")
                summary["phases"]["3"] = {"status": "complete", "count": len(phase3_results)}

    except ValueError as exc:
        _err(f"Error: {exc}")
        sys.exit(2)
    except Exception as exc:
        _err(f"Internal error: {exc}")
        _err("Retry hint: re-run with --resume to continue from last checkpoint.")
        sys.exit(3)

    total = len(phase1_results) + len(phase2_results) + len(phase3_results)
    summary["total_fetched"] = total
    summary["discovered_dir"] = str(discovered_dir / slug)
    summary["completed_at"] = datetime.now(tz=timezone.utc).isoformat()

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()
