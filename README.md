<p align="center" lang="en">
  <img src="assets/lumina-logo.png" width="250" alt="Lumina-Wiki Logo">
</p>

# Lumina-Wiki

> **Where Knowledge Starts to Glow.**
>
> Turn AI into your personal knowledge assistant and second brain.

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg"/>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D20-blue.svg"/>
  <img alt="Python" src="https://img.shields.io/badge/Python-3.9+-yellow.svg"/>
  <img alt="Skills" src="https://img.shields.io/badge/Skills-Many-purple.svg"/>
  <br>
  <img alt="Powered by" src="https://img.shields.io/badge/Powered%20by-grey?style=flat"/>
  <img alt="Claude" src="https://img.shields.io/badge/-Claude%20Code-orange?style=flat"/>
  <img alt="Codex" src="https://img.shields.io/badge/-Codex-blueviolet?style=flat"/>
  <img alt="Gemini" src="https://img.shields.io/badge/-Gemini-4285F4?style=flat"/>
</p>

<p align="center">
  English • <a href="README.vi.md" lang="vi">Tiếng Việt</a> • <a href="README.zh.md" lang="zh-Hans">简体中文</a>
</p>

<p align="center">
  <a href="docs/user-guide/en.md">User Guide</a>
</p>

## Menu

- [Getting Started & Install](#2-getting-started)
- [User Guide](docs/user-guide/en.md)
- [The Core Workflow](#1-the-core-workflow)
- [Your First Commands](#3-your-first-commands-core-skills)
- [Workspace Directory Guide](#4-workspace-directory-guide)
- [Available Skills](#5-available-skills-v01)
- [What's Coming Next](#6-whats-coming-next)
- [Contributing & License](#7-contributing--license)
- [Other Languages](#8-other-languages)

---

## 1. The Core Workflow

Lumina-Wiki works from one simple principle: keep your raw materials separate from the AI's structured knowledge.

```text
+-------------------------+      /lumi-ingest      +---------------------------+
|      YOUR INPUT         | ---------------------> |     THE AGENT'S BRAIN     |
|       (raw/ folder)     |                        |       (wiki/ folder)      |
|                         | <--------------------- |                           |
|  - my-paper.pdf         |       /lumi-ask        |  - my-paper.md (summary)  |
|  - my-notes.txt         |                        |  - concept-a.md           |
+-------------------------+                        +---------------------------+
```

<p align="center">
  <img src="assets/lumina-architecture-en.png" alt="Lumina-Wiki Architecture" width="720">
</p>

1.  **You Provide:** Place your documents (PDFs, notes) in the `raw/` directory.
2.  **The Agent Builds:** Use commands in your AI chat, such as `/lumi-ingest`, to make the agent read from `raw/` and build a structured, interlinked wiki in `wiki/`.
3.  **You Query:** Ask questions with `/lumi-ask` against the agent's "brain" in `wiki/` for faster, more context-aware answers.

## 2. Getting Started

### **Step 1: Install**

Install the wiki workspace into your current project with one command:

Before running this command, your machine needs **Node.js**. If you do not have it yet, download and install the recommended version from the official site: [nodejs.org/en/download](https://nodejs.org/en/download).

```bash
npx lumina-wiki install
```

> **Note for Windows users:** For the best experience, enable [Developer Mode](https://learn.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development) so the installer can use symlinks correctly. If Developer Mode is off, the installer falls back to copying skill files; everything still works, but updates are less ideal.

The installer will guide you through a quick setup, including optional **Packs** such as `research` and `reading`.

### **Step 2 (Optional): Configure the Research Pack**

If you installed the `research` pack, some skills can use API keys for better online search. In your AI chat, run:

> **You:**
> `/lumi-research-setup`

The agent will help you check the research tools and save keys to a local `.env` file when needed.

### **Step 3 (Upgrades): Migrate Legacy Wiki Entries**

If you reinstall Lumina-Wiki on a project that already has a `wiki/` from an earlier version, just run `npx lumina-wiki install` again. The installer updates scripts, schemas, and skills; **your content in `wiki/`, `raw/`, and `log.md` is not modified**.

If the installer warns that older entries are missing newer frontmatter fields, you have two ways to backfill them:

- **Recommended:** open your AI chat and run `/lumi-migrate-legacy`.
- **Faster:** run this terminal command:

```bash
node _lumina/scripts/wiki.mjs migrate --add-defaults
```

See [`CHANGELOG.md`](CHANGELOG.md) or the local `_lumina/CHANGELOG.md` after install for version-by-version schema changes.

## 3. Your First Commands (Core Skills)

Interact with your wiki using these commands in your AI chat interface, such as Gemini CLI, Claude, or Codex.

**Phase 1: Ingest and Build Knowledge**
-   `/lumi-init`: Scan the `raw/` directory and perform the first wiki build.
-   `/lumi-ingest [path/to/file]`: Process a new document into the knowledge base. It asks you to review the draft, then keeps going unless something needs your judgment.

**Phase 2: Query and Maintain**
-   `/lumi-ask [your question]`: Ask a question against the full knowledge base in `wiki/`.
-   `/lumi-edit [path/to/wiki/page]`: Request a change or correction to a specific wiki page.
-   `/lumi-check`: Check the whole wiki for errors, such as broken links or orphan pages.

*Additional skills may be available if you installed optional packs such as `research` or `reading`.*

---

## 4. Workspace Directory Guide

Lumina creates a workspace where each folder has a clear purpose.

<p align="center">
  <img src="assets/lumina-env-en.png" alt="Lumina-Wiki Workspace Environment" width="720">
</p>

| Path | Purpose | Managed By |
| :--- | :--- | :--- |
| **`raw/`** | **Your immutable input library.** The agent **only reads** from here. | **You** |
| `raw/sources/` | Place your primary documents, such as PDFs and articles, here. | You |
| `raw/notes/` | Your personal, unstructured notes and ideas. | You |
| `raw/assets/` | Images or other assets for your notes. | You |
| `raw/discovered/` | *(Research Pack)* Papers found by `/lumi-research-discover` are saved here. | Agent |
| **`wiki/`** | **The agent's brain.** The agent **writes** structured knowledge here. | **Agent** |
| `wiki/sources/` | AI-generated summaries for each document in `raw/sources`. | Agent |
| `wiki/concepts/` | Core ideas and definitions extracted into individual pages. | Agent |
| `wiki/people/` | Profiles of authors, researchers, and other people. | Agent |
| `wiki/outputs/` | Detailed answers from `/lumi-ask` saved for reference. | Agent |
| `wiki/index.md` | The main table of contents for your wiki. | Agent |
| `...` | *(Other entity folders such as `foundations/` and `characters/` appear with packs.)* | Agent |
| **`_lumina/`** | Lumina-managed engine, scripts, and configuration. | **System** |
| **`.agents/`** | Skills the agent can use. | **System** |

You usually work with `raw/` and read results in `wiki/`; you do not need to edit system folders.

### **Browse Your Wiki with Obsidian (Optional)**

[Obsidian](https://obsidian.md) is a local Markdown note-taking app that helps you browse linked notes. Because Lumina-Wiki also creates Markdown files, you can open the **project root folder** in Obsidian to read and browse your wiki more easily. See the [user guide](docs/user-guide/en.md#using-obsidian-to-read-the-wiki) for details.

### **Local Search with qmd (Advanced, Optional)**

As your wiki grows, you can use [qmd](https://github.com/tobi/qmd) for faster local Markdown search. If your IDE supports the skill format, install the official qmd skill with:

```bash
npx skills add https://github.com/tobi/qmd --skill qmd
```

See the [Advanced Guide](docs/user-guide/advanced-qmd.en.md) for detailed installation and configuration.

---

## 5. Available Skills

These are the commands you can use when chatting with your AI agent.

| Pack | Skill | Purpose |
| :--- | :--- | :--- |
| **Core** | `/lumi-init` | Initialize the wiki from all files in `raw/`. |
| | `/lumi-ingest` | Read a document and write a wiki page. It asks you to review the draft, then continues on its own unless something needs your judgment. Resumable across sessions. |
| | `/lumi-ask` | Ask a question against the full knowledge base. |
| | `/lumi-edit` | Request a manual edit to a wiki page. |
| | `/lumi-check` | Check the wiki for errors, such as broken links. |
| | `/lumi-reset` | Safely reset parts of the wiki. |
| | `/lumi-verify` | Check that wiki notes match the sources they cite. Reports anything suspicious for your review; never edits notes for you. |
| | `/lumi-help` | Read your workspace state and recommend one next action. Pass `skills` to list every command, or `explain <topic>` to ask how Lumina itself works (e.g., `/lumi-help explain bidirectional links`). |
| **Research** | `/lumi-research-discover` | Discover and rank relevant research papers. |
| | `/lumi-research-watchlist` | Choose research topics for scheduled discovery with AI help. |
| | `/lumi-research-survey` | Create a survey or summary from existing knowledge. |
| | `/lumi-research-prefill` | Seed foundational concepts to avoid duplicates. |
| | `/lumi-research-topic` | Create a topic page at `wiki/topics/<slug>.md` by gathering related concepts and sources already in your wiki. The AI proposes what to include and you confirm before anything is written. Use this after several `/lumi-ingest` runs when you want to give a theme its own page. |
| | `/lumi-research-setup` | Help configure API keys for research tools. |
| **Reading** | `/lumi-reading-chapter-ingest` | Ingest a book chapter by chapter. |
| | `/lumi-reading-character-track` | Track characters and their relationships in a story. |
| | `/lumi-reading-theme-map` | Identify and map themes in a narrative. |
| | `/lumi-reading-plot-recap` | Provide a progressive plot recap. |

The scripts behind these skills live in `_lumina/scripts/` and `_lumina/tools/`; you usually do not need to call them directly.

---

## 6. What's Coming Next

Lumina-Wiki is evolving rapidly. Here is our user-facing roadmap:

**Near-term (Stability & New Ingestion)**
- [x] **`/lumi-help` Skill:** A smart assistant that reads your workspace state and tells you the one thing to do next; `skills` shows every command, `explain <topic>` answers how Lumina itself works.
- [x] **Multilingual setup:** Choose English, Vietnamese, or Chinese as your primary language during install. *(shipped in v1.2)*
- [ ] **Native DOCX & Image OCR:** Ingest Word files and screenshots directly into your wiki.
- [ ] **Advanced Paper Ranking:** See influence scores and quality signals for your research papers.
- [x] **Improved CI/CD:** Native support for Bun and Node 22 environments. *(shipped in v1.2)*

**Long-term (Deep Research & Integration)**
- [ ] **Global Source Expansion:** Direct integration with OpenAlex, CORE, and Unpaywall.
- [ ] **RSS & Blog Monitoring:** Automatically identify new papers from your favorite lab blogs.
- [ ] **Google Workspace:** Ingest Google Docs and Sheets directly into your graph.
- [ ] **Multimedia Support:** Process YouTube videos and Audio recordings via transcripts.
- [ ] **Knowledge Graph Auditing:** Automated checks for contradictions and structural drift.

**Proposed**
- [ ] **Desktop Application:** A dedicated visual environment for easier wiki management.
- [ ] **Specialized Science Packs:** Deep integration for bio-medical and physics researchers.

---
*Full technical details are available in [`ROADMAP.md`](./ROADMAP.md). Want to contribute? Join us on GitHub!*

---

## 7. Contributing & License

### CLI Contract

CI scripts and integrations should reference [`docs/cli-contract.md`](./docs/cli-contract.md) for the v1.x stable flag list and exit code mapping. Anything not listed there is internal and may change without notice.

### Local Development (for contributors)

If you want to contribute to the `lumina-wiki` installer:

```bash
# 1. Clone and install dependencies
git clone https://github.com/tronghieu/lumina-wiki.git
cd lumina-wiki
npm ci

# 2. Run tests
npm run test:all
```

## 8. Other Languages

- [Tiếng Việt (Vietnamese)](README.vi.md)
- [简体中文 (Chinese)](README.zh.md)

**License:** [MIT](LICENSE) © Lưu Trọng Hiếu.
