# Learn Lumina-Wiki by adding your first document

In this short lesson, you will set up a personal study space, add one document, turn it into useful notes, and ask a question about it. By the end, you will know where your original material goes, how to ask Lumina-Wiki to read it, and how to check what it made.

## Before you start

You need:

- A computer with the current LTS version of [Node.js](https://nodejs.org/) installed.
- An empty folder for this wiki, such as `Documents/my-study-wiki`.
- An AI app that can work with your files. During setup, choose the app you plan to use.
- One small document you are happy to test with: a PDF, text file, or Markdown note.

## 1. Install Lumina-Wiki

Open Terminal on macOS or Linux, or PowerShell on Windows. Move into the empty folder you created, then run:

```bash
npx lumina-wiki install
```

Answer the setup questions in everyday terms: choose your language, describe what you want to learn or research, choose your AI app, and choose any optional packs you need. The basic tools are included automatically. Choose the Research pack only if you want help finding and organising academic or other research material later.

When setup finishes, open that folder in the AI app you chose.

### Checkpoint

You should see a `raw/` folder for your original material and a `wiki/` folder for the notes Lumina-Wiki will build. Leave the files in `wiki/` to the AI; your first job is simply to add a source.

## 2. Ask Lumina-Wiki what to do next

In the AI chat, start with `lumi-help`. It reads the current workspace and recommends one useful next action. You can return to it whenever you are unsure what to do.

In Codex, use:

```text
$lumi-help
```

In most other supported AI apps, use:

```text
/lumi-help
```

In a new workspace, Lumina-Wiki will normally guide you to initialize the wiki. Follow that suggestion with the start command:

```text
$lumi-init
```

```text
/lumi-init
```

This prepares the empty wiki for your first source. It is safe to run again if you are unsure whether you already did it.

### Checkpoint

The AI should tell you that the wiki is ready. Run `lumi-help` again and confirm that its recommendation now reflects the new state of your workspace.

## 3. Add one document

Copy your test document into `raw/sources/`. For example, you might add:

```text
raw/sources/learning-notes.pdf
```

Choose a document with a clear subject. A short article or a few pages of notes is ideal for this first lesson. Keep the original file there even after Lumina-Wiki has read it.

### Checkpoint

Confirm that the file is visible in `raw/sources/` and that its name is easy for you to recognise.

## 4. Ask Lumina-Wiki to read it

Tell the AI which file to add. In Codex:

```text
$lumi-ingest raw/sources/learning-notes.pdf
```

In other supported AI apps:

```text
/lumi-ingest raw/sources/learning-notes.pdf
```

Lumina-Wiki reads the source, proposes a summary and related ideas, and lets you inspect the result as it goes. Read the short draft it shows you. Approve it if it reflects the document, or say what you want changed. You do not need to understand the note structure to give useful feedback; plain comments such as “make the main conclusion clearer” are enough.

### Checkpoint

When this finishes, you should have:

- A page about the document in `wiki/sources/`.
- Notes about important ideas or people when they appear in the source.
- An updated list of your material in `wiki/index.md`.

Open the new source page and check two things: the summary sounds like the document you supplied, and you can still find the original file named on the page.

## 5. Ask a useful question

Now ask about what Lumina-Wiki has read:

```text
$lumi-ask What are the three most useful ideas in this document for a beginner?
```

Or:

```text
/lumi-ask What are the three most useful ideas in this document for a beginner?
```

The answer should point you back to the notes and sources behind it. If the wiki does not yet contain enough material, it should say so and suggest what to add next.

### Final check

You have completed the first loop when all four statements are true:

- Your original file is still in `raw/sources/`.
- There is a matching page in `wiki/sources/`.
- `wiki/index.md` includes the new source.
- `/lumi-ask` or `$lumi-ask` answers from that source and points you to it.

## What you learned

You now have the everyday rhythm of Lumina-Wiki: keep the original material, add it with `lumi-ingest`, look at the notes, then ask questions with `lumi-ask`. Repeat this one-document loop whenever you read something worth keeping.

## Next steps

- [Look up every available command](commands.en.md).
- [Follow a practical research routine](research.en.md).
- [Advanced scheduled discovery](advanced-scheduled-discovery.en.md).
- [Advanced search](advanced-qmd.en.md).
- [Use more than one wiki from a chat service](openclaw-hermes-integration.en.md).
