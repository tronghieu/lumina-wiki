<p align="left" lang="en">
  <img src="assets/lumina-logo.png" width="250" alt="Lumina-Wiki logo">
</p>

# Lumina-Wiki

> **Where Knowledge Starts to Glow.**

Turn the documents you read into a knowledge library you can ask questions about later.

Lumina-Wiki gives your AI assistant a lasting workspace for study and research. You add papers, books, reports, class notes, or personal notes. The assistant summarizes them, connects related ideas, and keeps the results in plain Markdown files on your computer.

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D20-blue.svg">
</p>

<p align="center">
  English · <a href="README.vi.md" lang="vi">Tiếng Việt</a> · <a href="README.zh.md" lang="zh-Hans">简体中文</a>
</p>

<p align="center">
  <a href="docs/user-guide/en.md">Start with the user guide</a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=XuhhjbwoNeQ">
    <img src="https://img.youtube.com/vi/XuhhjbwoNeQ/maxresdefault.jpg" alt="Lumina-Wiki video walkthrough" width="560">
  </a>
  <br>
  <a href="https://www.youtube.com/watch?v=XuhhjbwoNeQ">▶ Watch the video walkthrough (Vietnamese)</a>
</p>

## What you can do

Lumina-Wiki is useful when you want to:

- keep what you learn from many documents in one place;
- compare ideas or evidence across several sources;
- prepare for an exam, essay, literature review, or long-term research project;
- return to an old topic without searching through previous chats;
- keep important answers together with the sources that support them.

You do not need to build the wiki by hand. You choose the sources and make the important decisions. Your AI assistant does the routine work of reading, organizing, linking, and checking notes.

## How it works

Lumina-Wiki uses two main folders:

- `raw/` holds your original documents.
- `wiki/` holds the organized notes created from those documents.

```text
Your documents in raw/
        |
        |  lumi-ingest
        v
Organized notes in wiki/
        |
        |  lumi-ask
        v
Answers based on what you have read
```

Your original files stay separate from AI-written notes. This makes it easier to check where an idea came from and to correct the wiki when needed.

## Start in a few minutes

### Before you start

Install the current LTS version of [Node.js](https://nodejs.org/en/download). You also need an AI tool that can work with a folder on your computer, such as Codex, Claude Code, or Gemini CLI.

### 1. Create your workspace

Open a terminal in the folder where you want to keep your knowledge library, then run:

```bash
npx lumina-wiki install
```

The setup asks which AI tool and optional feature sets you want to use. If you are unsure, keep the suggested choices. You can run the same command again later to change them.

### 2. Add one document

Place a PDF, Markdown file, or text file in:

```text
raw/sources/
```

For example:

```text
raw/sources/my-first-paper.pdf
```

### 3. Ask your AI assistant to read it

In Codex, use:

```text
$lumi-ingest raw/sources/my-first-paper.pdf
```

In tools that use slash commands, such as Claude Code or Gemini CLI, use:

```text
/lumi-ingest raw/sources/my-first-paper.pdf
```

The assistant shows you a draft before saving the new notes. You can approve it, ask for changes, or stop and continue later.

### 4. Ask your first question

After the document has been added, try:

```text
/lumi-ask What are the main ideas in this document?
```

Codex users can replace the first `/` with `$`.

If you are not sure what to do next, use `/lumi-help` or `$lumi-help`.

For a guided walkthrough with checkpoints and common fixes, see the [user guide](docs/user-guide/en.md).

## Optional feature sets

The basic features are always included. During setup, you can add:

| Feature set | Choose it when you want to |
| --- | --- |
| Research | Find papers, follow research topics, rank sources, and build literature reviews. |
| Reading | Read books chapter by chapter without revealing later plot details. |
| Learning | Record how your understanding changes as you study. |

You can add or remove an optional feature set later by running `npx lumina-wiki install` again. Your documents and wiki notes are preserved.

## Everyday commands

These are enough for most people:

| Command | Use it to |
| --- | --- |
| `/lumi-help` | Get one useful suggestion for what to do next. |
| `/lumi-ingest` | Add a document to the wiki. |
| `/lumi-ask` | Ask a question using the knowledge already in the wiki. |
| `/lumi-edit` | Correct or update a wiki page. |
| `/lumi-verify` | Check that notes match the sources they cite. |
| `/lumi-check` | Check the wiki for broken links and other problems. |

See the [command reference](docs/user-guide/commands.en.md) for every available command.

## Guides

- [Beginner tutorial](docs/user-guide/en.md)
- [Research workflow](docs/user-guide/research.en.md)
- [Command reference](docs/user-guide/commands.en.md)
- [Find research regularly](docs/user-guide/advanced-scheduled-discovery.en.md) — advanced
- [Use QMD for local search](docs/user-guide/advanced-qmd.en.md) — advanced
- [Connect OpenClaw or Hermes](docs/user-guide/openclaw-hermes-integration.en.md) — advanced

You can also open the project root in [Obsidian](https://obsidian.md) to browse the Markdown notes visually.

## Update or uninstall

To update Lumina-Wiki or change your setup, run:

```bash
npx lumina-wiki install
```

To remove Lumina-Wiki's managed files, run:

```bash
npx lumina-wiki uninstall
```

Uninstalling keeps your original documents in `raw/` and your knowledge notes in `wiki/`.

## For contributors

Development instructions live in [CONTRIBUTING.md](CONTRIBUTING.md). The stable command-line contract is documented in [docs/cli-contract.md](docs/cli-contract.md), and planned work is listed in [ROADMAP.md](ROADMAP.md).

Lumina-Wiki is available under the [MIT License](LICENSE).

---

## Contributors

Thanks to everyone who has contributed to Lumina Wiki!

[![Contributors](https://contrib.rocks/image?repo=tronghieu/lumina-wiki)](https://github.com/tronghieu/lumina-wiki/graphs/contributors)

**Want to contribute?** Read [CONTRIBUTING.md](CONTRIBUTING.md) to get started — bug reports, new skills, tool integrations, and translations are all welcome.
