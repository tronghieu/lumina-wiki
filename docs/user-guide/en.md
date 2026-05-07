# Lumina-Wiki User Guide

Lumina-Wiki helps you turn AI into a personal knowledge assistant: you put documents, notes, papers, or articles in one fixed place; AI reads, summarizes, organizes, links, and maintains them as a wiki you can ask about later.

You can think of Lumina-Wiki as a "second brain" for reading and research. The difference is that you do not have to write every note from scratch. AI does the heavy work: reading sources, extracting main ideas, creating concept pages, recording links between documents, and keeping the wiki structured.

Your role is to choose sources, ask questions, check the direction of the analysis, and decide what matters. The AI's role is to take care of the knowledge area in `wiki/`: writing new pages, updating old pages, keeping links, updating the index, writing the log, and helping the wiki stay consistent as it grows.

## Contents

- [Problems With the Old Way of Managing Knowledge](#problems-with-the-old-way-of-managing-knowledge)
- [What Can You Use Lumina-Wiki For?](#what-can-you-use-lumina-wiki-for)
- [How Does Lumina-Wiki Work?](#how-does-lumina-wiki-work)
- [Installation](#installation)
- [How to Call Commands in an AI Agent](#how-to-call-commands-in-an-ai-agent)
- [Quick Start](#quick-start)
- [Research Pack for Research Work](#research-pack-for-research-work)
- [Common Commands](#common-commands)
- [Using OpenAI CodexApp (ChatGPT), Claude Code, and Gemini CLI](#using-openai-codexapp-chatgpt-claude-code-and-gemini-cli)
- [Using Obsidian to Read the Wiki](#using-obsidian-to-read-the-wiki)
- [Upgrading Lumina-Wiki](#upgrading-lumina-wiki)
- [Frequently Asked Questions](#frequently-asked-questions)
- [A Suggested Workflow for Researchers](#a-suggested-workflow-for-researchers)
- [Advanced: Find Research Regularly](advanced-scheduled-discovery.en.md)
- [Advanced: Accelerate Queries with QMD](advanced-qmd.en.md)

## Problems With the Old Way of Managing Knowledge

When you only have a few documents, you can save them in a folder, bookmark them in a browser, or write a few lines in a note-taking app. But when the number of documents grows, this usually creates many problems:

- **Documents are scattered:** PDFs are in the downloads folder, links are in the browser, notes are in a note-taking app, and key ideas are in chat history.
- **You read something but cannot reuse it easily:** you remember reading an important document, but you do not remember where it is or what the main point was.
- **Notes are not connected:** one idea may appear in many documents, but you have to remember which document said what and how they relate to each other.
- **New documents do not update old understanding:** when you read a new source, you have to update old notes yourself, add contradictions, add evidence, and add links.
- **It is hard to write an overview:** when you need to write a report, thesis, plan, or presentation, you have to gather information from many places and organize it again from the start.
- **Personal wikis are easy to abandon:** at first you may take careful notes, but as documents grow, naming, sectioning, linking, and updating become tiring.
- **Using AI as separate chats still makes you start over often:** if you only upload files into one chat, AI can answer at that moment, but useful analysis often disappears into chat history and does not become a maintained knowledge base.

Lumina-Wiki solves this by letting AI take care of the wiki. You still decide which sources matter and which questions are worth following, but AI helps turn documents into a structured knowledge area and keeps maintaining it over time.

## What Can You Use Lumina-Wiki For?

Lumina-Wiki is useful when you have many documents and want to turn them into a knowledge base you can ask again later. Here are some specific use cases.

### 1. Build a personal knowledge library

You read books, articles, reports, newsletters, personal notes, or podcast transcripts. You may not be working on a formal research topic, but you still want what you read to stay useful after a few days.

Lumina-Wiki fits when you want one place to keep main ideas, sources, open questions, and links between things you have read. Over time, the wiki becomes a personal memory store: you can return to see what you have read, which topics repeat often, and which ideas are worth exploring further.

This is a good fit for self-learners, people who read a lot but do not take notes regularly, or people who want to build a "second brain" without manually maintaining every note.

### 2. Managers and company operators

You need to read many types of documents: market reports, customer feedback, meeting notes, competitor documents, internal strategy, industry analysis, and new policies. The problem is not only storage, but turning them into insight you can use for decisions.

Lumina-Wiki fits when you often need to ask: what are customers complaining about most, how are competitors changing direction, which risks keep appearing, and which opportunities have strong enough evidence. The wiki helps AI keep the source of each claim, connect scattered signals, and maintain a shared picture as new documents appear.

This is useful for founders, product managers, strategy, operations, marketing, sales, or anyone who needs to turn many information sources into clear decisions.

### 3. Teachers and curriculum designers

You have textbooks, slides, reference materials, learning outcomes, exercises, student feedback, practical examples, and extra reading sources. As the course grows, it becomes harder to remember which lesson relates to which concept, which example has been used, and where students often get stuck.

Lumina-Wiki fits when you want to build a knowledge base for a course or training program: main concepts, explanatory sources, examples, common misunderstandings, links between lessons, what should be taught first, and where more material is needed.

This is especially useful when you update the curriculum often. New material can be added to the wiki so AI can help link it with old lessons, instead of leaving everything scattered across many folders.

### 4. Students

You have textbooks, slides, readings, class notes, review outlines, and reference materials. Each file may make sense on its own, but when it is time to study for an exam or write a paper, you need to see how they connect.

Lumina-Wiki fits if you often feel "I have read this, but I do not know where to start reviewing." The wiki helps collect the important parts of each document, create concept pages, connect related lessons, and keep the summaries you have asked for.

This is useful for long-term study: final exam review, essays, thesis preparation, language learning, difficult courses, or self-learning a new skill.

### 5. Researchers

You work with academic papers, monographs, technical reports, supporting data, experiment notes, draft ideas, and related sources. You need more than summaries of individual sources; you need to see how sources build on, add to, or challenge each other.

Lumina-Wiki fits long-term research because the wiki can grow source by source. When you add a new document, AI can help update old concepts, record contradictions, and link authors, methods, evidence, and research gaps.

This is where Research Pack is especially valuable: finding related sources, pre-creating foundational concepts, choosing documents worth reading, and creating an overview from what the wiki already knows.

## How Does Lumina-Wiki Work?

Lumina-Wiki uses two main areas:

- `raw/`: where you put original documents.
- `wiki/`: the knowledge area that AI takes care of and maintains. This is where AI creates notes, summaries, concepts, people profiles, answers, and the links between them.

In short: `raw/` is your source library; `wiki/` is the knowledge brain that AI helps you write and keep tidy over time.

Example:

```text
You put a document in raw/sources/
        ↓
You ask AI to read it with lumi-ingest
        ↓
AI creates a summary page in wiki/sources/
        ↓
AI updates concepts, related people, links, the index, and the log
        ↓
You ask again with lumi-ask
```

You do not need to remember the full internal structure. In everyday use, you only need to remember:

- original documents go in `raw/`,
- processed knowledge lives in `wiki/`,
- you work with Lumina-Wiki through commands named `lumi-*`. Depending on the AI tool, you may call them with `/` or `$`.

<p align="center">
  <img src="../../assets/lumina-architecture-en.png" alt="Lumina-Wiki Architecture" width="720">
</p>

## Installation

Installing Lumina-Wiki is simple, like setting up a new "office" for your AI assistant. Just follow these steps:

### 1. What do you need?

*   **Node.js**: This is the "engine" that lets Lumina-Wiki run on your computer.
    *   **How to**: Download the **LTS** version (most stable) from [nodejs.org](https://nodejs.org) and install it like any other software.
*   **Working Directory**: Create an empty folder where you want to keep your wiki (e.g., in your `Documents` folder and name it `MyWiki`).
*   **(Optional for Windows)**: If you use Windows, turn on **Developer Mode** in your system settings to help wiki shortcuts work more smoothly. If you don't, that's fine too; the software will automatically choose a suitable installation method.

### 2. Installation Steps

1.  **Open your terminal**:
    *   **Windows**: Press the Windows key, type `cmd` or `PowerShell`, and press Enter.
    *   **Mac**: Press `Cmd + Space`, type `Terminal`, and press Enter.
2.  **Go to your folder**:
    *   Type the command `cd` followed by a space.
    *   Drag the `MyWiki` folder you just created into the terminal window and press Enter.
3.  **Run the install command**:
    *   Paste this and press Enter:
    ```bash
    npx lumina-wiki install
    ```
    *(This command will automatically download what is needed and start the setup for you).*

### 3. What will the installer ask?

You will see a series of questions. Use the **Arrow keys** to select and **Enter** to confirm:

*   **Installer language / Ngôn ngữ / 语言** *(new in v1.2)*: The very first question. Pick the language you want the installer itself to speak — **English**, **Tiếng Việt**, or **中文**. This is just the language of the setup conversation; you can still tell the AI to chat with you in any language afterwards. If you ever change your mind on a re-install, the installer will gently confirm before switching.
*   **Installation directory**: Just press **Enter** to choose the current directory. This is recommended.
*   **Research purpose**: Type a few words about what you want the AI to help with (e.g., "Language learning", "Market research"). This helps the AI understand your context.
*   **AI tools (IDE targets)**: This is the most important step. Choose the tool you will use to chat with the AI:
    *   **OpenAI CodexApp (ChatGPT)**: A popular choice for beginners. It is a dedicated app with a visual interface.
    *   **Claude Code**: If you use Anthropic's tool.
    *   **Gemini CLI**: If you use Google's tool.
    *   *Tip: You can select multiple items using the Space bar.*
*   **Packs**: Select `research` if you are doing research, or `reading` if you want AI to help with books/stories. Core features are always included.
*   **Languages**: Type `English` (or your preferred language) for the AI to talk to you and write notes.

When you see the **[done]** message in green, congratulations! Your "office" is ready.

### Upgrading and Uninstallation

*   **To change settings or upgrade**: Just run the `npx lumina-wiki install` command again. Your existing data **will not be lost**.
*   **To uninstall**: Run the command `npx lumina-wiki uninstall`. This only removes system files; **your documents and notes will always stay safe**.

## How to Call Commands in an AI Agent

When you chat with your AI assistant (for example, in the OpenAI CodexApp), you control it using commands starting with `/` or `$`.

| Tool | Command Syntax | Example |
| --- | --- | --- |
| **OpenAI CodexApp** | Use the `$` prefix | `$lumi-ingest raw/sources/file.pdf` |
| **Claude / Gemini** | Use the `/` prefix | `/lumi-ingest raw/sources/file.pdf` |

---

## Quick Start

After installation, you only need 3 steps to start "feeding" your AI brain:

### 1. Add your documents
Copy your PDF files or notes into the `raw/sources/` folder.

### 2. Tell the AI to read
In your chat window (e.g., CodexApp), type:
```text
$lumi-ingest raw/sources/your-file-name.pdf
```
The AI will read, summarize, and automatically create related knowledge pages.

### 3. Ask anything
Once the AI has read a few documents, you can ask:
```text
$lumi-ask Are there any interesting common points among these documents?
```

The experience with **OpenAI CodexApp** will be very smooth because it is designed to automatically understand the Lumina-Wiki structure through the `AGENTS.md` file that the installer created for you.

## Research Pack for Research Work

Research Pack is very useful if you use Lumina-Wiki for research, especially when you need to find related documents, filter sources, build a conceptual foundation, or write an overview from what you have read.

Research Pack has six main commands:

| Command | What it is for |
| --- | --- |
| `/lumi-research-setup` | Prepare the research environment, check Python tools, and help configure API keys if needed. |
| `/lumi-research-discover` | Find and rank research sources related to the topic you provide. |
| `/lumi-research-watchlist` | Choose research topics for Lumina-Wiki to check regularly. |
| `/lumi-research-prefill` | Pre-create foundation pages for common concepts, so later reading links more consistently. |
| `/lumi-research-survey` | Create a research overview from the sources and concepts already in the wiki. |
| `/lumi-research-topic` | Gather related concepts and sources already in the wiki into a dedicated topic page at `wiki/topics/`. |

### When should you use Research Pack?

Use Research Pack when you are doing things like:

- finding new documents for a topic,
- choosing which documents are worth reading first,
- building background knowledge for a field,
- pre-creating basic concepts so later reading stays consistent in meaning and naming,
- summarizing the documents you have read into an overview,
- finding gaps or disagreements between sources,
- collecting a recurring theme into its own dedicated page after you have ingested several sources.

### Example research workflow

Suppose you want to research "the impact of phone use in the classroom".

First, configure the research tools:

```text
/lumi-research-setup
```

Next, it is useful to pre-create a few foundation concepts:

```text
/lumi-research-prefill phone use in the classroom
```

```text
/lumi-research-prefill student attention level
```

This step gives AI a shared concept layer before reading many documents. When sources use different names for the same idea, the wiki can link them into the same knowledge foundation more easily, instead of creating many separate pages or drifting in interpretation.

Then ask Lumina-Wiki to find sources:

```text
/lumi-research-discover impact of phone use in the classroom
```

This command creates a list of papers or research material for you to review. It does not automatically turn every result into a wiki page. You choose which documents are worth reading, then add each source to the wiki:

![Example of Research Pack discovering new documents in OpenAI CodexApp (ChatGPT)](../../assets/lumi-discover-new-paper.png)

Example in OpenAI CodexApp (ChatGPT): Research Pack suggests new research sources for you to review before adding them to the wiki.

If you want Lumina-Wiki to check saved research topics regularly,
use `/lumi-research-watchlist` to set up the topics first. The schedule itself
is run by your computer or by GitHub Actions, not by the assistant waking up on
its own. See [Advanced: Find Research Regularly](advanced-scheduled-discovery.en.md)
for GitHub Actions, cron, launchd, and Windows Task Scheduler examples.

```text
/lumi-ingest <document or source you choose>
```

When the wiki has some sources, you can ask:

```text
/lumi-ask What do these documents say about the impact of phones on attention?
```

Or create an overview:

```text
/lumi-research-survey phone use in the classroom
```

Once you have read several sources and a theme keeps coming up, you can give it its own page:

```text
/lumi-research-topic phone use in the classroom
```

The AI looks at what is already in the wiki, proposes which concepts and sources belong in the cluster, and waits for you to confirm or edit the list. Once you confirm, the page is written to `wiki/topics/` and reverse links from each listed concept and source back to the topic are added automatically. If a concept or source has not been ingested yet, run `/lumi-ingest` first.

For example: suppose you have read eight papers and want to pull together everything about RLHF. You run `/lumi-research-topic rlhf`. The AI proposes six sources and four concepts. You remove two sources that are only loosely related, then confirm. The topic page is written, the wiki linter runs, and a log entry is appended.

The important point: Research Pack helps you expand and organize the research process. Adding a specific source to the wiki still goes through `/lumi-ingest`, so the wiki keeps clear structure, links, and logs.

For long-term research, the biggest value is accumulation: each new source is not only summarized on its own, but can also clarify old concepts, add sources for an argument, or show contradictions with what the wiki recorded earlier.

### Useful research questions

```text
/lumi-ask Which documents have the most reliable evidence?
```

```text
/lumi-ask Where do the authors disagree?
```

```text
/lumi-ask Which idea groups are mentioned by many sources?
```

```text
/lumi-ask If I write the literature review section, what idea groups should I divide it into?
```

```text
/lumi-research-survey Summarize the main directions in this field and identify research gaps.
```

## Common Commands

The examples below use `/lumi-*` syntax, which fits environments that use slash commands. If you use OpenAI CodexApp (ChatGPT), change `/lumi-*` to `$lumi-*`, for example `/lumi-ingest` to `$lumi-ingest`.

| Command | Simple meaning |
| --- | --- |
| `/lumi-init` | Prepare the initial wiki structure and scan what is already in `raw/`. |
| `/lumi-ingest <file or source>` | Add a document to the wiki. This is the command you will use very often. |
| `/lumi-ask <question>` | Ask the knowledge base created in `wiki/`. |
| `/lumi-edit <wiki page>` | Ask AI to edit or update a specific wiki page. |
| `/lumi-check` | Ask AI to check wiki health: structure errors, broken links, or pages that were not updated correctly. |
| `/lumi-reset` | Delete or reset part of the wiki in a controlled way. |
| `/lumi-verify` | Ask AI to check that your wiki notes actually match the sources you cited. |

## Checking your notes with /lumi-verify

When AI summarizes a document into a wiki page, it can sometimes add things that are not in the original source. `/lumi-verify` reads each note in your wiki and tells you which statements do not match the sources you cited.

### When to use it

- After AI adds new pages to your wiki, before you rely on them.
- Before you share or export part of the wiki.
- Once in a while, as a health check on older pages.

### How to use it

```text
/lumi-verify <page-name>     # check one page
/lumi-verify --all            # check all pages
```

### What you get back

A short report listing any statement in your notes that does not match the cited source. For each one, the report tells you:

- Which statement looks suspicious.
- Why (for example: "this number does not appear in the cited paper").
- A suggestion (rewrite, remove, or keep with a note).

`/lumi-verify` never edits your notes for you. You decide what to do with each finding.

## Adding a document with /lumi-ingest

`/lumi-ingest` reads a document and adds it to your wiki. It asks you to review the draft before continuing, then only comes back to you when your judgment is needed.

### When to use it

- You have a new PDF, article, or report ready in `raw/sources/` and want to add it to the wiki.
- You want to check a summary before it becomes a wiki page.
- You are building a research wiki and need each source to be reliable before you cite it in writing.

### How to use it

```text
/lumi-ingest raw/sources/your-document.pdf
```

After you run the command, the AI reads the source and writes a draft wiki page, then pauses so you can read it. You can accept the draft, ask for changes, or quit and come back later.

If you accept, the AI checks the page connections and compares the draft against the source. When everything looks clean, it saves the page and writes a record to the log without asking you to approve each internal step. It asks again only when it finds something suspicious, cannot safely clean up the page, cannot find the source file, or needs your approval to save the page with a low-confidence note.

If you quit at any point, progress is preserved. Running `/lumi-ingest` again on the same document picks up where you left off.

### What you get back

- A new wiki page in `wiki/sources/` summarizing the document.
- New concept, person, or organization pages created automatically if the document introduces ones that do not exist yet.
- Two-way links between the new page and the related pages already in the wiki.
- The wiki index updated to include the new page.
- A record in the wiki log showing when the document was added and how the check went.
- A low-confidence mark on the page if you chose to save it with reservations, so you know to return to it.

## Using OpenAI CodexApp (ChatGPT), Claude Code, and Gemini CLI

Lumina-Wiki is not a separate chat app. It is a folder structure, scripts, and commands that let an AI agent work inside your project.

With tools like OpenAI CodexApp (ChatGPT), Claude Code, or Gemini CLI, the general workflow is:

1. Open the correct project folder where Lumina-Wiki is installed.
2. Chat with the AI agent inside that project.
3. Call Lumina commands using the syntax supported by that tool.

### OpenAI CodexApp (ChatGPT)

**OpenAI CodexApp** is the most recommended tool for Lumina-Wiki users because it has a dedicated app with an intuitive visual interface, so you don't have to work entirely in a black command window.

**How to use:**
1. Open the CodexApp on your computer.
2. Select "Open Project" and point to the folder where you just installed Lumina-Wiki.
3. Once inside the project, you can chat directly with the AI. 
4. Lumina-Wiki commands in CodexApp start with the `$` prefix.

Example:
```text
$lumi-ingest raw/sources/document.pdf
```

CodexApp will automatically recognize the `AGENTS.md` file in the folder to activate Lumina-Wiki's "skills". This is a very friendly experience for both researchers and casual users.

### Claude Code

With Claude Code, open the project where Lumina-Wiki is installed and use `/lumi-*` commands in the chat. Lumina-Wiki has an entry file for Claude Code so the agent knows to read the README and use the installed skills correctly.

### Gemini CLI

With Gemini CLI, open a terminal in the project where Lumina-Wiki is installed, then chat with Gemini in that same folder. Lumina-Wiki has an entry file for Gemini CLI so the agent understands the wiki structure and Lumina commands.

## Using Obsidian to Read the Wiki

[Obsidian](https://obsidian.md/) is a note-taking app that stores your notes as Markdown files on your computer and helps you link notes together.

Because Lumina-Wiki creates Markdown files, you can open the project folder with Obsidian if you want to read and browse the wiki more easily. The README recommends opening the **project root folder**, not only the `wiki/` folder.

![Viewing Lumina-Wiki in Obsidian](../../assets/obsidian-preview.png)

Image source: [obsidian.md](https://obsidian.md/)

## Upgrading Lumina-Wiki

When you want to upgrade Lumina-Wiki in an existing project, run again:

```bash
npx lumina-wiki install
```

The installer will update scripts, schemas, and skills. Your knowledge content in `wiki/`, original documents in `raw/`, and existing log are preserved.

If an old wiki is missing some new metadata fields, the installer may warn you. In that case, you can run:

```text
/lumi-migrate-legacy
```

This command helps AI read the changelog and add missing information to old pages in a controlled way.

## Frequently Asked Questions

### Do I need to know programming?

You do not need to know programming to use Lumina-Wiki at a basic level. You need to know how to open a terminal, run the install command, put files in the right folder, and chat with an AI agent.

### Where should I put files?

Main documents such as PDFs, papers, reports, and transcripts should go in:

```text
raw/sources/
```

Personal notes can go in:

```text
raw/notes/
```

### Should I edit files in `wiki/` by hand?

You can, but be careful. `wiki/` is the knowledge area where AI maintains structure, links, and metadata. If you want to edit a page, the better way is to use:

```text
/lumi-edit <wiki page path>
```

### I just added a document to `raw/`. Why does `/lumi-ask` not know it yet?

Because the original document is only in `raw/`. Add it to the wiki with:

```text
/lumi-ingest raw/sources/<file-name>
```

After that, `/lumi-ask` can use the processed knowledge in `wiki/`.

### What is an API key?

An API key is a key string issued by an external service, for example Semantic Scholar or DeepXiv. Research Pack can use some API keys to find better sources or increase access limits. Do not put API keys in files you plan to commit or share publicly.

### Does Obsidian replace Lumina-Wiki?

No. Obsidian is a note-taking app. Lumina-Wiki is a system that helps AI read documents and create a structured wiki. The two tools can be used together, but they have different roles.

## A Suggested Workflow for Researchers

1. Install Lumina-Wiki and choose Research Pack.
2. Run `/lumi-research-setup` to check research tools.
3. Use `/lumi-research-prefill` for foundational concepts in the field.
4. Put the documents you already have in `raw/sources/`.
5. Run `/lumi-ingest` for each important document.
6. Use `/lumi-research-discover` to find more related sources.
7. Choose sources worth reading and ingest them.
8. Use `/lumi-ask` to ask questions, compare sources, and find gaps.
9. Use `/lumi-research-topic` to give recurring themes their own dedicated pages once you have enough sources on them.
10. Use `/lumi-research-survey` to create an overview from what the wiki already knows.
11. Open the project with Obsidian if you want to read and browse Markdown notes more conveniently.

Lumina-Wiki becomes more useful when you use it regularly. Each well-ingested document makes your knowledge brain clearer, more connected, and easier to ask again. You do not only get one more summary; you get one more piece of knowledge that AI maintains inside a shared system.
