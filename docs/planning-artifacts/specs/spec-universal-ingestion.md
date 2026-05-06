---
stepsCompleted: [0]
project_name: 'LuminaWiki'
date: '2026-05-06'
type: 'spec'
status: 'refined'
---

# Spec: Universal & Multimodal Ingestion

## Outcome
Enable users to ingest any form of media—documents (.docx, .txt), images (OCR), cloud files (Google Docs), and multimedia (Audio, YouTube)—into the Lumina-Wiki knowledge graph with high semantic fidelity.

## High-Level Intent
- **Format Agnosticism**: Standardize the ingestion pipeline to handle binary files, images, cloud streams, and audio/video transcripts.
- **Image Intelligence (OCR)**:
  - Implement a local or API-based OCR layer (e.g., Tesseract, EasyOCR, or Vision LLMs) to extract text from screenshots, scans, and photos.
  - Preserve spatial context where relevant (e.g., identifying headers or captions).
- **Google Workspace Bridge**: Use `gws` to fetch and export Google Docs/Sheets into the `raw/` directory.
- **Multimedia Intelligence**:
  - **YouTube Integration**: Fetch transcripts via YouTube API or specialized scrapers.
  - **Local Audio Support**: Implement a transcription layer (e.g., OpenAI Whisper) for local audio files.
- **Unified Processing**: Convert all incoming formats into a "Unified Markdown Intermediate" (UMI) format before entity extraction and graph linking.

## Acceptance Criteria
1. **Multimodal `prepare_source.py`**: A dispatcher that handles `.pdf`, `.docx`, `.txt`, `.png`, `.jpg`, `.mp3`, `.wav`, and YouTube URLs.
2. **OCR Pipeline**: Integration of an OCR tool that extracts clean text from images with high accuracy.
3. **Transcription Engine**: Integration of an audio-to-text pipeline that preserves timestamps.
4. **YouTube Handler**: New tool `fetch_youtube.py` for transcript and metadata extraction.
5. **Google Docs Connector**: Support for exporting remote documents via `gws`.
6. **Semantic Mapping**: Multimedia and Image sources must maintain links to the original file/timestamp for provenance.
