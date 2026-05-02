<p align="center" lang="en">
  <img src="assets/lumina-logo.png" width="250" alt="Lumina-Wiki Logo">
</p>

# Lumina-Wiki

> **Where Knowledge Starts to Glow.**
>
> The LLM-maintained Knowledge Artifact for Technical Research.

Lumina-Wiki is a ready-to-use implementation of the **[LLM-Wiki vision](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)** articulated by **Andrej Karpathy, founding member of OpenAI and former Director of AI at Tesla.**

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg"/>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D20-blue.svg"/>
  <img alt="Python" src="https://img.shields.io/badge/Python-3.9+-yellow.svg"/>
  <img alt="Skills" src="https://img.shields.io/badge/Skills-14-purple.svg"/>
  <br>
  <img alt="Powered by" src="https://img.shields.io/badge/Powered%20by-grey?style=flat"/>
  <img alt="Claude" src="https://img.shields.io/badge/-Claude%20Code-orange?style=flat"/>
  <img alt="Codex" src="https://img.shields.io/badge/-Codex-blueviolet?style=flat"/>
  <img alt="Gemini" src="https://img.shields.io/badge/-Gemini-4285F4?style=flat"/>
</p>

<p align="center">
  English • <a href="README.vi.md" lang="vi">Tiếng Việt</a> • <a href="README.zh.md" lang="zh">简体中文</a>
</p>

---

## 1. The Core Workflow

Lumina-Wiki operates on a simple principle: separate your raw materials from the AI's structured knowledge.

```text
+-------------------------+      /lumi-ingest      +---------------------------+
|      YOUR INPUT         | ---------------------> |     THE AGENT'S BRAIN     |
|       (raw/ folder)     |                        |       (wiki/ folder)      |
|                         | <--------------------- |                           |
|  - my-paper.pdf         |       /lumi-ask        |  - my-paper.md (summary)  |
|  - my-notes.txt         |                        |  - concept-a.md           |
+-------------------------+                        +---------------------------+
```

1.  **You Provide:** Place your documents (PDFs, notes) into the `raw/` directory.
2.  **The Agent Builds:** Use commands in your AI chat (like `/lumi-ingest`) to make the agent read from `raw/` and build a structured, interlinked wiki in the `wiki/` directory.
3.  **You Query:** Ask questions (using `/lumi-ask`) against the agent's "brain" in `wiki/`, receiving faster and more context-aware answers.

## 2. Getting Started

### **Step 1: Install**
Install the wiki workspace into your current project with one command:

```bash
npx lumina-wiki install
```
> **Note for Windows Users:** For the best experience, it is recommended to [enable Developer Mode](https://learn.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development) to allow the installer to use symlinks correctly. If Developer Mode is off, the installer will fall back to copying skill files, which is functional but less ideal for updates.

The installer will guide you through a quick setup, including selecting optional **Packs** like `research` and `reading`.

### **Step 2 (Optional): Configure the Research Pack**
If you installed the `research` pack, some skills need API keys to search online. Run the setup skill to configure them. In your AI chat window:

> **You:**
> `/lumi-research-setup`

The agent will guide you through an interactive setup to save your keys to a local `.env` file.

## 3. Your First Commands (Core Skills)

Interact with your wiki using these commands in your AI chat interface (Gemini CLI, Claude, etc.).

**Phase 1: Ingestion & Building**
-   `/lumi-init`: Scans the `raw/` directory and performs an initial build of the wiki.
-   `/lumi-ingest [path/to/file]`: Processes a single new document and integrates it into the knowledge base.

**Phase 2: Query & Maintenance**
-   `/lumi-ask [your question]`: Asks a question against the entire knowledge base in `wiki/`.
-   `/lumi-edit [path/to/wiki/page]`: Requests a change or correction to a specific wiki page.
-   `/lumi-check`: Lints the wiki for errors (broken links, etc.).

*Additional skills may be available if you installed optional packs like `research` or `reading`.*

---

## 4. The Workspace Directory Guide

Lumina creates a workspace with a clear purpose for each directory.

### **Primary Folders (Your Daily Workspace)**

| Path | Purpose | Managed By |
| :--- | :--- | :--- |
| **`raw/`** | **Your Immutable Input Library.** The agent **only reads** from here. | **You** |
| `raw/sources/` | Place your primary documents (PDFs, articles) here. | You |
| `raw/notes/` | Your personal, unstructured notes and ideas. | You |
| `raw/assets/` | Images or other assets for your notes. | You |
| `raw/discovered/`| *(Research Pack)* Papers found by `/lumi-research-discover` are saved here. | Agent |
| **`wiki/`** | **The Agent's Brain.** The agent **writes** structured knowledge here. | **Agent** |
| `wiki/sources/` | AI-generated summaries for each document in `raw/sources`. | Agent |
| `wiki/concepts/` | Core ideas and definitions are extracted into individual pages. | Agent |
| `wiki/people/` | Profiles of authors, researchers, etc. | Agent |
| `wiki/outputs/` | Detailed answers from `/lumi-ask` are saved here for reference. | Agent |
| `wiki/index.md` | The main table of contents for your wiki. | Agent |
| `...` | *(Other entity folders like `foundations/`, `characters/` appear with packs)* | Agent |


### **System Folders (Managed by Lumina)**

| Path | Purpose | Managed By |
| :--- | :--- | :--- |
| **`_lumina/`** | The core engine, scripts, and configuration for the wiki. | **System** |
| **`.agents/`** | Contains all the `skills` that the agent can use. | **System** |
| `...` | *(Other dotfiles like `.claude/`, `.gitignore`)* | **System** |

**Note:** You generally do not need to modify the System Folders.

### **Browsing Your Wiki with Obsidian (Optional)**

[Obsidian](https://obsidian.md) is the recommended visual companion for Lumina-Wiki. Because the wiki uses native Obsidian `[[wikilinks]]`, you get a full graph view, backlinks panel, and property queries out of the box.

**Point your vault at the project root** — not just the `wiki/` subfolder. The root contains `index.md`, `log.md`, and cross-links between `wiki/` pages and `raw/` source files that only resolve when Obsidian can see both directories.

**Recommended setup after `npx lumina-wiki install`:**

1. Obsidian → **Open folder as vault** → select the project root.
2. **Settings → Files & links → Excluded files** — add:
   - `_lumina/`, `.claude/`, `.cursor/`, `.agents/`, `.git/`, `wiki/graph/`
3. **Settings → Files & links**:
   - Use `[[Wikilinks]]`: **on**
   - New link format: **Shortest path when possible**
   - Default attachment location: `In the folder specified below` → `raw/assets/`
4. **Core plugins to enable:** Graph view, Backlinks, Outgoing links, Tags, Properties, Outline.
5. *(Optional)* Community plugin **Dataview** — lets you query pages by frontmatter fields like `type`, `importance`, `confidence`, and `date_added`.

> The `wiki/graph/` folder contains `edges.jsonl` and `citations.jsonl` (machine-readable data files, not markdown). Excluding it keeps the graph view clean.

---

## 5. Available Skills and Tools (v0.1)

### Skills (User Commands)

These are the commands you can use in your chat with the AI.

| Pack | Skill | Purpose |
| :--- | :--- | :--- |
| **Core** | `/lumi-init` | Initializes the wiki from all files in `raw/`. |
| | `/lumi-ingest` | Processes a single new document into the wiki. |
| | `/lumi-ask` | Asks a question against the entire knowledge base. |
| | `/lumi-edit` | Requests a manual edit to a wiki page. |
| | `/lumi-check` | Lints the wiki for errors (broken links, etc.). |
| | `/lumi-reset` | Safely resets parts of the wiki. |
| **Research**| `/lumi-research-discover` | Discovers and ranks relevant research papers. |
| | `/lumi-research-survey` | Creates a survey/summary from existing knowledge. |
| | `/lumi-research-prefill` | Seeds the wiki with foundational concepts to avoid duplicates. |
| | `/lumi-research-setup` | Helps configure API keys for research tools. |
| **Reading** | `/lumi-reading-chapter-ingest`| Ingests a book chapter by chapter. |
| | `/lumi-reading-character-track`| Tracks characters and their relationships in a story. |
| | `/lumi-reading-theme-map` | Identifies and maps out themes in a narrative. |
| | `/lumi-reading-plot-recap` | Provides a progressive recap of the plot. |

### Tools (The Engine Under the Hood)

These are the scripts that the agent's skills use to perform actions.

| Location | Tool | Role |
| :--- | :--- | :--- |
| **`_lumina/scripts/`** | `wiki.mjs` | **The Core Engine.** Handles all write/edit/link operations in `wiki/`. |
| | `lint.mjs` | Linter used by `/lumi-check` to find errors. |
| | `reset.mjs` | The script for safely deleting content. |
| | `schemas.mjs` | The single source of truth for all wiki structures and rules. |
| **`_lumina/tools/`** | `discover.py` | *(Research Pack)* Powers the `/lumi-research-discover` skill. |
| | `fetch_*.py` | *(Research Pack)* A set of tools to fetch data from APIs like ArXiv, Wikipedia, etc. |

---

## 6. What's Coming Next

The current release is **v0.2** (preview). The full plan lives in [`ROADMAP.md`](./ROADMAP.md). Headline items:

**v1.0.0 — First Stable**
- **Daily search & fetch** — watchlist queries (`_lumina/config/watchlist.yml`) run on a cadence; new arXiv / Semantic Scholar hits land in `raw/discovered/<date>/` automatically.
- New `/lumi-daily` skill to triage what landed since last run.
- Stability lock for the v0.1 surface (CLI flags, exit codes, schema field names).
- Cross-platform CI matrix (macOS + Linux + Windows, Node 20 + 22).

**v2.0.0 — Research Pack Source Expansion**
- **New paper sources:** OpenAlex, Unpaywall, CORE (Priority 1) → OpenReview, Hugging Face Papers, Papers With Code (Priority 2) → Crossref, DOAJ, research-blog RSS (Priority 3).
- **Paper ranking:** new `/lumi-rank` skill surfacing influential-citation count, field-normalized citation rank, Scite support/contrast tally, and Altmetric attention — all into a `ranking:` block on the paper's frontmatter.

**Want to help?** Pick any unchecked item in `ROADMAP.md`, open an issue to claim it, then send a PR. Source fetchers all follow the same pattern in `src/tools/` (CLI + JSON, no async, exit codes `0/2/3`) so they're a friendly first contribution. See the local-dev steps below.

---

## 7. Contributing & License

### 🛠️ Local Development (for contributors)

If you want to contribute to the `lumina-wiki` installer itself:
```bash
# 1. Clone & Install Dependencies
git clone https://github.com/tronghieu/lumina-wiki.git
cd lumina-wiki
npm ci

# 2. Run Tests
npm run test:all
```

## 8. Other Languages

- [Tiếng Việt (Vietnamese)](README.vi.md)
- [简体中文 (Chinese)](README.zh.md)

**License:** [MIT](LICENSE) © Lưu Trọng Hiếu.
