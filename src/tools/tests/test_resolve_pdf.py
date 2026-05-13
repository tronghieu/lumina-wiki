"""Tests for resolve_pdf.py — 2-layer ladder orchestrator.

We stub the per-provider subprocess + the HTTP session so the ladder logic
can be exercised deterministically. Each test checks one branch of the
control flow defined in resolve_pdf.resolve().
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import resolve_pdf


@pytest.fixture
def tmp_project(tmp_path: Path) -> Path:
    (tmp_path / "raw" / "download").mkdir(parents=True)
    return tmp_path


# ---------------------------------------------------------------------------
# Subprocess stubs
# ---------------------------------------------------------------------------

def _make_subproc_result(stdout: str = "", stderr: str = "", returncode: int = 0):
    r = MagicMock()
    r.stdout = stdout
    r.stderr = stderr
    r.returncode = returncode
    return r


@pytest.fixture
def stub_openalex(monkeypatch):
    """Default: OpenAlex returns metadata with arxiv ID + oa_url."""
    def _stub(record):
        monkeypatch.setattr(resolve_pdf, "_run_openalex", lambda _id: record)
    return _stub


# ---------------------------------------------------------------------------
# Stubbed download helper — bypasses real HTTP + SSRF guard
# ---------------------------------------------------------------------------

@pytest.fixture
def fake_download(monkeypatch):
    """`_download_pdf` succeeds and writes a 200-byte stub file at the expected path."""
    written: list[str] = []

    def _fake(session, pdf_url, project_root, provider_subdir, external_id):
        out_dir = project_root / "raw" / "download" / provider_subdir
        out_dir.mkdir(parents=True, exist_ok=True)
        rel = f"raw/download/{provider_subdir}/{resolve_pdf._sha16_id(external_id)}.pdf"
        (project_root / rel).write_bytes(b"%PDF-1.4 stub" + b"x" * 200)
        written.append(rel)
        return rel

    monkeypatch.setattr(resolve_pdf, "_download_pdf", _fake)
    return written


@pytest.fixture
def failing_download(monkeypatch):
    """`_download_pdf` raises every time; ladder must keep walking."""
    def _fake(*a, **kw):
        raise RuntimeError("GET returned 404")
    monkeypatch.setattr(resolve_pdf, "_download_pdf", _fake)


# ---------------------------------------------------------------------------
# Namespace detection
# ---------------------------------------------------------------------------

class TestDetectNamespace:
    def test_doi(self):
        ns, val = resolve_pdf._detect_namespace("10.1234/foo")
        assert ns == "doi"

    def test_arxiv_bare(self):
        ns, val = resolve_pdf._detect_namespace("2401.12345")
        assert ns == "arxiv"
        assert val == "2401.12345"

    def test_openalex(self):
        ns, val = resolve_pdf._detect_namespace("W4392834756")
        assert ns == "openalex"

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            resolve_pdf._detect_namespace("")

    def test_garbage_raises(self):
        with pytest.raises(ValueError):
            resolve_pdf._detect_namespace("not-an-id")


# ---------------------------------------------------------------------------
# Layer-A failure — metadata anchor itself dies → status: failed
# ---------------------------------------------------------------------------

class TestMetadataAnchorFails:
    def test_returns_failed_status(self, tmp_project, monkeypatch):
        def _boom(_id):
            raise RuntimeError("network down")
        monkeypatch.setattr(resolve_pdf, "_run_openalex", _boom)
        result = resolve_pdf.resolve("2401.12345", tmp_project)
        assert result["status"] == "failed"
        assert result["pdf_path"] == ""


# ---------------------------------------------------------------------------
# Ladder Step 1 — openalex.oa_url stops the ladder
# ---------------------------------------------------------------------------

class TestStopsOnOaUrl:
    def test_first_200_wins(self, tmp_project, stub_openalex, fake_download):
        stub_openalex({
            "external_ids": {"arxiv": "2401.12345", "doi": "10.48550/arxiv.2401.12345"},
            "sources": [],
            "oa_url": "https://example.com/oa.pdf",
            "title": "Sample",
        })
        result = resolve_pdf.resolve("2401.12345", tmp_project)
        assert result["status"] == "ok"
        assert result["pdf_path"].startswith("raw/download/openalex/")
        # External IDs cross-walked via the anchor
        assert result["external_ids"]["doi"] == "10.48550/arxiv.2401.12345"


# ---------------------------------------------------------------------------
# Ladder Step 2 — Unpaywall hit
# ---------------------------------------------------------------------------

class TestUnpaywallHit:
    def test_unpaywall_used_when_no_oa_url(self, tmp_project, stub_openalex, fake_download, monkeypatch):
        stub_openalex({
            "external_ids": {"doi": "10.1000/oa"},
            "sources": [],
            "oa_url": "",
            "title": "Sample",
        })
        monkeypatch.setattr(resolve_pdf, "_run_unpaywall", lambda doi: {
            "is_oa": True,
            "best_oa_location": {"pdf_url": "https://example.com/up.pdf"},
            "sources": [{"provider": "unpaywall", "fetched_at": "2026-05-13T00:00:00Z"}],
        })
        # CORE search not reached because step-2 already succeeds
        monkeypatch.setattr(resolve_pdf, "_run_core_search", lambda q: None)
        result = resolve_pdf.resolve("10.1000/oa", tmp_project)
        assert result["status"] == "ok"
        assert "/unpaywall/" in result["pdf_path"]


# ---------------------------------------------------------------------------
# Ladder Step 3 — CORE 429 graceful skip
# ---------------------------------------------------------------------------

class TestCore429GracefulSkip:
    def test_falls_through_to_arxiv(self, tmp_project, stub_openalex, fake_download, monkeypatch):
        stub_openalex({
            "external_ids": {"arxiv": "2401.12345"},
            "sources": [],
            "oa_url": "",
            "title": "Sample",
        })
        monkeypatch.setattr(resolve_pdf, "_run_unpaywall", lambda doi: None)
        monkeypatch.setattr(resolve_pdf, "_run_core_search", lambda q: {"_rate_limited": True})
        result = resolve_pdf.resolve("2401.12345", tmp_project)
        assert result["status"] == "ok"
        assert "/arxiv/" in result["pdf_path"]


# ---------------------------------------------------------------------------
# All providers fail → metadata_only
# ---------------------------------------------------------------------------

class TestMetadataOnly:
    def test_closed_access_yields_metadata_only(
        self, tmp_project, stub_openalex, failing_download, monkeypatch
    ):
        stub_openalex({
            "external_ids": {"doi": "10.1000/closed"},
            "sources": [],
            "oa_url": "",
            "title": "Closed Paper",
        })
        monkeypatch.setattr(resolve_pdf, "_run_unpaywall", lambda doi: {
            "is_oa": False, "best_oa_location": None, "sources": []
        })
        monkeypatch.setattr(resolve_pdf, "_run_core_search", lambda q: None)
        result = resolve_pdf.resolve("10.1000/closed", tmp_project)
        assert result["status"] == "metadata_only"
        assert result["pdf_path"] == ""


# ---------------------------------------------------------------------------
# OpenAlex anchor unconditional even with arxiv-only input
# ---------------------------------------------------------------------------

class TestUnconditionalAnchor:
    def test_arxiv_input_still_calls_openalex(self, tmp_project, fake_download, monkeypatch):
        called = []

        def _capture(_id):
            called.append(_id)
            return {
                "external_ids": {"arxiv": "2401.12345", "doi": "10.48550/arxiv.2401.12345"},
                "sources": [],
                "oa_url": "https://example.com/oa.pdf",
                "title": "x",
            }

        monkeypatch.setattr(resolve_pdf, "_run_openalex", _capture)
        result = resolve_pdf.resolve("2401.12345", tmp_project)
        assert len(called) == 1
        assert "doi" in result["external_ids"]
