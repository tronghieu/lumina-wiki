from __future__ import annotations

import hashlib
import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import fetch_pdf

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

MINIMAL_PDF = b"%PDF-1.4 minimal content for testing purposes only" + b"x" * 200


@pytest.fixture
def tmp_project(tmp_path: Path) -> Path:
    """Project root with raw/download/ pre-created."""
    (tmp_path / "raw" / "download").mkdir(parents=True)
    return tmp_path


@pytest.fixture
def mock_pdf_response() -> MagicMock:
    """Mock requests Response returning PDF binary via iter_content."""
    resp = MagicMock()
    resp.status_code = 200
    resp.headers = {"Content-Type": "application/pdf"}
    resp.iter_content = lambda chunk_size: iter([MINIMAL_PDF])
    resp.raise_for_status = MagicMock()
    resp.url = "https://arxiv.org/pdf/2604.03501v2.pdf"
    return resp


def _make_mock_response(
    content: bytes = MINIMAL_PDF,
    status_code: int = 200,
    content_type: str = "application/pdf",
    final_url: str = "",
) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.headers = {"Content-Type": content_type}
    resp.iter_content = lambda chunk_size: iter([content])
    resp.url = final_url or "https://example.com/paper.pdf"
    resp.raise_for_status = MagicMock()
    return resp


def _make_session_with(response: MagicMock) -> MagicMock:
    sess = MagicMock()
    sess.get.return_value = response
    return sess


# ---------------------------------------------------------------------------
# TestResourceDetection
# ---------------------------------------------------------------------------

class TestResourceDetection:
    @pytest.mark.parametrize("url,expected_resource,expected_id,expected_pdf_url", [
        pytest.param(
            "https://arxiv.org/abs/2604.03501v2",
            "arxiv", "2604.03501v2", "https://arxiv.org/pdf/2604.03501v2.pdf",
            id="arxiv-abs-with-version",
        ),
        pytest.param(
            "https://arxiv.org/abs/2604.03501",
            "arxiv", "2604.03501", "https://arxiv.org/pdf/2604.03501.pdf",
            id="arxiv-abs-no-version",
        ),
        pytest.param(
            "https://arxiv.org/pdf/2503.18238v3",
            "arxiv", "2503.18238v3", "https://arxiv.org/pdf/2503.18238v3.pdf",
            id="arxiv-pdf-no-suffix",
        ),
        pytest.param(
            "https://arxiv.org/pdf/2503.18238v3.pdf",
            "arxiv", "2503.18238v3", "https://arxiv.org/pdf/2503.18238v3.pdf",
            id="arxiv-pdf-with-suffix",
        ),
        pytest.param(
            "https://doi.org/10.1145/3491102.3501856",
            "doi", "10.1145-3491102.3501856", None,
            id="doi-standard",
        ),
        pytest.param(
            "https://www.semanticscholar.org/paper/Attention-is-All-You-Need/204e3073870fae3d05bcbc2f6a8e263d9b72e776",
            "s2", "Attention-is-All-You-Need", None,
            id="s2-paper",
        ),
    ])
    def test_detect_resource_returns_correct_partition(
        self, url: str, expected_resource: str, expected_id: str, expected_pdf_url: str | None
    ) -> None:
        resource, id_, pdf_url = fetch_pdf.detect_resource(url)
        assert resource == expected_resource
        assert id_ == expected_id
        if expected_pdf_url is not None:
            assert pdf_url == expected_pdf_url

    def test_detect_resource_with_web_url_returns_sha16_id(self) -> None:
        url = "https://example.com/some-paper.pdf"
        resource, id_, pdf_url = fetch_pdf.detect_resource(url)
        assert resource == "web"
        assert len(id_) == 16
        assert pdf_url == url

    def test_detect_resource_with_web_url_id_is_deterministic(self) -> None:
        url = "https://example.com/some-paper.pdf"
        _, id_a, _ = fetch_pdf.detect_resource(url)
        _, id_b, _ = fetch_pdf.detect_resource(url)
        assert id_a == id_b


# ---------------------------------------------------------------------------
# TestFilenameDerivation
# ---------------------------------------------------------------------------

class TestFilenameDerivation:
    def test_download_with_custom_filename_uses_override(self, tmp_project: Path) -> None:
        sess = _make_session_with(_make_mock_response(
            final_url="https://arxiv.org/pdf/2604.03501v2.pdf"
        ))
        result = fetch_pdf.fetch_pdf(
            "https://arxiv.org/abs/2604.03501v2",
            project_root=tmp_project,
            filename="my-paper.pdf",
            session=sess,
        )
        assert result["path"].endswith("my-paper.pdf")
        assert (tmp_project / "raw" / "download" / "arxiv" / "my-paper.pdf").exists()

    def test_download_with_arxiv_url_derives_arxiv_filename(self, tmp_project: Path) -> None:
        sess = _make_session_with(_make_mock_response(
            final_url="https://arxiv.org/pdf/2604.03501v2.pdf"
        ))
        result = fetch_pdf.fetch_pdf(
            "https://arxiv.org/abs/2604.03501v2",
            project_root=tmp_project,
            session=sess,
        )
        assert result["path"] == "raw/download/arxiv/2604.03501v2.pdf"

    def test_download_with_doi_url_derives_sanitized_filename(self, tmp_project: Path) -> None:
        sess = _make_session_with(_make_mock_response(
            final_url="https://doi.org/10.1145/3491102.3501856"
        ))
        result = fetch_pdf.fetch_pdf(
            "https://doi.org/10.1145/3491102.3501856",
            project_root=tmp_project,
            session=sess,
        )
        assert result["resource"] == "doi"
        assert "/" not in result["path"].split("/")[-1]

    def test_download_with_web_url_places_file_in_web_partition(self, tmp_project: Path) -> None:
        url = "https://example.com/some/paper.pdf"
        sess = _make_session_with(_make_mock_response(final_url=url))
        result = fetch_pdf.fetch_pdf(url, project_root=tmp_project, session=sess)
        assert result["resource"] == "web"
        assert result["path"].startswith("raw/download/web/")


# ---------------------------------------------------------------------------
# TestIdempotency
# ---------------------------------------------------------------------------

class TestIdempotency:
    def test_download_when_file_exists_returns_skipped(self, tmp_project: Path) -> None:
        sess = _make_session_with(_make_mock_response(
            final_url="https://arxiv.org/pdf/2604.03501v2.pdf"
        ))
        fetch_pdf.fetch_pdf(
            "https://arxiv.org/abs/2604.03501v2",
            project_root=tmp_project,
            session=sess,
        )
        r2 = fetch_pdf.fetch_pdf(
            "https://arxiv.org/abs/2604.03501v2",
            project_root=tmp_project,
            session=sess,
        )
        assert r2["skipped"] is True
        assert r2["reason"] == "exists"
        assert sess.get.call_count == 1

    def test_download_with_force_overwrites_existing_file(self, tmp_project: Path) -> None:
        content_v1 = b"%PDF-1.4 original content" + b"a" * 200
        content_v2 = b"%PDF-1.4 updated content " + b"b" * 200

        sess1 = _make_session_with(_make_mock_response(
            content=content_v1,
            final_url="https://arxiv.org/pdf/2604.03501v2.pdf",
        ))
        fetch_pdf.fetch_pdf(
            "https://arxiv.org/abs/2604.03501v2",
            project_root=tmp_project,
            session=sess1,
        )

        sess2 = _make_session_with(_make_mock_response(
            content=content_v2,
            final_url="https://arxiv.org/pdf/2604.03501v2.pdf",
        ))
        r2 = fetch_pdf.fetch_pdf(
            "https://arxiv.org/abs/2604.03501v2",
            project_root=tmp_project,
            force=True,
            session=sess2,
        )

        assert r2["skipped"] is False
        out_file = tmp_project / "raw" / "download" / "arxiv" / "2604.03501v2.pdf"
        assert out_file.read_bytes() == content_v2

    def test_download_first_run_returns_not_skipped(self, tmp_project: Path) -> None:
        sess = _make_session_with(_make_mock_response(
            final_url="https://arxiv.org/pdf/2604.03501v2.pdf"
        ))
        r1 = fetch_pdf.fetch_pdf(
            "https://arxiv.org/abs/2604.03501v2",
            project_root=tmp_project,
            session=sess,
        )
        assert r1["skipped"] is False


# ---------------------------------------------------------------------------
# TestErrorHandling
# ---------------------------------------------------------------------------

class TestErrorHandling:
    def test_download_with_html_response_raises_user_error(self, tmp_project: Path) -> None:
        sess = _make_session_with(_make_mock_response(
            content=b"<html><body>Landing page</body></html>" + b"x" * 200,
            content_type="text/html; charset=utf-8",
            final_url="https://example.com/paper",
        ))
        with pytest.raises(ValueError, match="(?i)expected pdf"):
            fetch_pdf.fetch_pdf(
                "https://example.com/paper",
                project_root=tmp_project,
                session=sess,
            )

    def test_download_with_undersized_response_raises_user_error(self, tmp_project: Path) -> None:
        sess = _make_session_with(_make_mock_response(
            content=b"%PDF-1.4",  # 8 bytes < MIN_PDF_SIZE
            final_url="https://arxiv.org/pdf/2604.03501v2.pdf",
        ))
        with pytest.raises(ValueError, match="too small"):
            fetch_pdf.fetch_pdf(
                "https://arxiv.org/abs/2604.03501v2",
                project_root=tmp_project,
                session=sess,
            )

    def test_download_with_http_5xx_raises_runtime_error(self, tmp_project: Path) -> None:
        sess = _make_session_with(_make_mock_response(
            status_code=503,
            content=b"Service Unavailable",
            final_url="https://arxiv.org/pdf/2604.03501v2.pdf",
        ))
        with pytest.raises(RuntimeError, match="HTTP 503"):
            fetch_pdf.fetch_pdf(
                "https://arxiv.org/abs/2604.03501v2",
                project_root=tmp_project,
                session=sess,
            )

    def test_download_with_empty_url_raises_value_error(self, tmp_project: Path) -> None:
        sess = MagicMock()
        with pytest.raises(ValueError, match="empty"):
            fetch_pdf.fetch_pdf("", project_root=tmp_project, session=sess)

    def test_download_with_malformed_url_raises_value_error(self, tmp_project: Path) -> None:
        sess = MagicMock()
        with pytest.raises(ValueError, match="malformed"):
            fetch_pdf.fetch_pdf("not-a-url", project_root=tmp_project, session=sess)

    def test_cli_with_empty_url_exits_2(self, capsys: pytest.CaptureFixture[str]) -> None:
        with pytest.raises(SystemExit) as exc_info:
            fetch_pdf.main(["   "])
        assert exc_info.value.code == 2
        err = json.loads(capsys.readouterr().err)
        assert err["code"] == 2

    def test_cli_with_path_traversal_filename_exits_2(
        self, tmp_project: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        with pytest.raises(SystemExit) as exc_info:
            fetch_pdf.main([
                "https://arxiv.org/abs/2604.03501v2",
                "--project-root", str(tmp_project),
                "--filename", "../../evil.pdf",
            ])
        assert exc_info.value.code == 2
        err = json.loads(capsys.readouterr().err)
        assert err["code"] == 2

    def test_cli_with_slash_in_filename_exits_2(
        self, tmp_project: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        with pytest.raises(SystemExit) as exc_info:
            fetch_pdf.main([
                "https://arxiv.org/abs/2604.03501v2",
                "--project-root", str(tmp_project),
                "--filename", "subdir/evil.pdf",
            ])
        assert exc_info.value.code == 2

    def test_cli_with_html_response_exits_2(
        self, tmp_project: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        with patch("fetch_pdf.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(
                content=b"<html><body>Landing page</body></html>" + b"x" * 200,
                content_type="text/html",
                final_url="https://example.com/paper",
            )
            with pytest.raises(SystemExit) as exc_info:
                fetch_pdf.main([
                    "https://example.com/paper",
                    "--project-root", str(tmp_project),
                ])
        assert exc_info.value.code == 2
        err = json.loads(capsys.readouterr().err)
        assert "pdf" in err["error"].lower() or "html" in err["error"].lower()

    def test_cli_with_network_error_exits_3(
        self, tmp_project: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        import requests as req
        with patch("fetch_pdf.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.side_effect = req.exceptions.ConnectionError("refused")
            with pytest.raises(SystemExit) as exc_info:
                fetch_pdf.main([
                    "https://arxiv.org/abs/2604.03501v2",
                    "--project-root", str(tmp_project),
                ])
        assert exc_info.value.code == 3
        err = json.loads(capsys.readouterr().err)
        assert err["code"] == 3

    def test_cli_with_timeout_exits_3(
        self, tmp_project: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        import requests as req
        with patch("fetch_pdf.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.side_effect = req.exceptions.Timeout()
            with pytest.raises(SystemExit) as exc_info:
                fetch_pdf.main([
                    "https://arxiv.org/abs/2604.03501v2",
                    "--project-root", str(tmp_project),
                ])
        assert exc_info.value.code == 3


# ---------------------------------------------------------------------------
# TestAtomicWrite
# ---------------------------------------------------------------------------

class TestAtomicWrite:
    def test_download_writes_correct_bytes_to_disk(self, tmp_project: Path) -> None:
        sess = _make_session_with(_make_mock_response(
            final_url="https://arxiv.org/pdf/2604.03501v2.pdf"
        ))
        fetch_pdf.fetch_pdf(
            "https://arxiv.org/abs/2604.03501v2",
            project_root=tmp_project,
            session=sess,
        )
        out_file = tmp_project / "raw" / "download" / "arxiv" / "2604.03501v2.pdf"
        assert out_file.exists()
        assert out_file.read_bytes() == MINIMAL_PDF

    def test_download_returns_correct_sha256(self, tmp_project: Path) -> None:
        sess = _make_session_with(_make_mock_response(
            final_url="https://arxiv.org/pdf/2604.03501v2.pdf"
        ))
        result = fetch_pdf.fetch_pdf(
            "https://arxiv.org/abs/2604.03501v2",
            project_root=tmp_project,
            session=sess,
        )
        expected_sha = hashlib.sha256(MINIMAL_PDF).hexdigest()
        assert result["sha256"] == expected_sha

    def test_download_leaves_no_tmp_file_on_error(self, tmp_project: Path) -> None:
        """No .tmp files left behind after a failed download."""
        small_content = b"%PDF-1.4"  # too small — triggers cleanup
        sess = _make_session_with(_make_mock_response(
            content=small_content,
            final_url="https://arxiv.org/pdf/2604.03501v2.pdf",
        ))
        with pytest.raises(ValueError, match="too small"):
            fetch_pdf.fetch_pdf(
                "https://arxiv.org/abs/2604.03501v2",
                project_root=tmp_project,
                session=sess,
            )
        arxiv_dir = tmp_project / "raw" / "download" / "arxiv"
        tmp_files = list(arxiv_dir.glob("*.tmp")) if arxiv_dir.exists() else []
        assert tmp_files == []

    def test_download_returns_correct_size_bytes(self, tmp_project: Path) -> None:
        sess = _make_session_with(_make_mock_response(
            final_url="https://arxiv.org/pdf/2503.18238v3.pdf"
        ))
        result = fetch_pdf.fetch_pdf(
            "https://arxiv.org/pdf/2503.18238v3",
            project_root=tmp_project,
            session=sess,
        )
        assert result["size_bytes"] == len(MINIMAL_PDF)


# ---------------------------------------------------------------------------
# TestCLI (integration via main())
# ---------------------------------------------------------------------------

class TestCLI:
    def test_cli_with_arxiv_url_outputs_valid_json(
        self, tmp_project: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        with patch("fetch_pdf.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(
                final_url="https://arxiv.org/pdf/2604.03501v2.pdf"
            )
            buf = io.StringIO()
            with redirect_stdout(buf):
                with pytest.raises(SystemExit) as exc_info:
                    fetch_pdf.main([
                        "https://arxiv.org/abs/2604.03501v2",
                        "--project-root", str(tmp_project),
                    ])

        assert exc_info.value.code == 0
        parsed = json.loads(buf.getvalue())
        assert parsed["resource"] == "arxiv"
        assert parsed["id"] == "2604.03501v2"
        assert parsed["skipped"] is False

    def test_cli_second_run_returns_skipped(
        self, tmp_project: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        with patch("fetch_pdf.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(
                final_url="https://arxiv.org/pdf/2604.03501v2.pdf"
            )
            buf1 = io.StringIO()
            with redirect_stdout(buf1):
                with pytest.raises(SystemExit) as exc1:
                    fetch_pdf.main([
                        "https://arxiv.org/abs/2604.03501v2",
                        "--project-root", str(tmp_project),
                    ])
            assert exc1.value.code == 0

            buf2 = io.StringIO()
            with redirect_stdout(buf2):
                with pytest.raises(SystemExit) as exc2:
                    fetch_pdf.main([
                        "https://arxiv.org/abs/2604.03501v2",
                        "--project-root", str(tmp_project),
                    ])
            assert exc2.value.code == 0

        r2 = json.loads(buf2.getvalue())
        assert r2["skipped"] is True
        assert sess.get.call_count == 1

    def test_cli_with_force_flag_redownloads(self, tmp_project: Path) -> None:
        with patch("fetch_pdf.requests.Session") as mock_cls:
            sess = MagicMock()
            mock_cls.return_value = sess
            sess.get.return_value = _make_mock_response(
                final_url="https://arxiv.org/pdf/2604.03501v2.pdf"
            )
            buf1 = io.StringIO()
            with redirect_stdout(buf1):
                with pytest.raises(SystemExit):
                    fetch_pdf.main([
                        "https://arxiv.org/abs/2604.03501v2",
                        "--project-root", str(tmp_project),
                    ])

            buf2 = io.StringIO()
            with redirect_stdout(buf2):
                with pytest.raises(SystemExit) as exc2:
                    fetch_pdf.main([
                        "https://arxiv.org/abs/2604.03501v2",
                        "--project-root", str(tmp_project),
                        "--force",
                    ])
            assert exc2.value.code == 0

        r2 = json.loads(buf2.getvalue())
        assert r2["skipped"] is False
        assert sess.get.call_count == 2
