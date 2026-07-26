# How to search a large wiki locally with QMD

Use this guide when your wiki has enough Markdown notes that you want faster local search. QMD is optional: Lumina-Wiki does not install it or automatically use it for `/lumi-ask`.

## Prerequisites

- Node.js 22 or later; check with `node --version`.
- A terminal and permission to install global npm packages.
- On macOS, Homebrew and its SQLite package. QMD needs Homebrew SQLite for extensions.
- A Lumina-Wiki workspace with a `wiki/` folder.

## Install and check QMD

On macOS, install SQLite first:

```bash
brew install sqlite
```

Then install QMD:

```bash
npm install -g @tobilu/qmd
qmd --version
qmd doctor
```

`qmd doctor` reports missing requirements. If it reports a macOS SQLite problem, confirm that Homebrew SQLite is installed and follow the command's advice.

## Add your wiki and create its search index

From the workspace root, add the wiki as a collection. Pick a short name that does not clash with another collection on your computer.

```bash
qmd collection add wiki --name my-wiki
qmd update
qmd embed
```

The first embedding run downloads local models and can take time and disk space. Leave the terminal open until it completes.

## Verify the result

Check the collection and search for a phrase that occurs in one of your notes:

```bash
qmd status
qmd collection show my-wiki
qmd search "a phrase from my notes" -c my-wiki
qmd query "a question about my notes" -c my-wiki
```

Use `qmd search` for quick keyword matches. Use `qmd query` for a broader, meaning-based search with ranking. Paths and excerpts from your wiki confirm that QMD can read the collection.

## Refresh the index after changing notes

After adding or editing notes, run:

```bash
qmd update
qmd embed
```

These commands refresh QMD's results; they do not change your wiki notes.

## Use QMD with an AI assistant, if you choose

Tell an assistant explicitly what to run, for example:

```text
Use `qmd query` in the `my-wiki` collection to find notes relevant to this question, then cite the notes you used.
```

Whether an assistant can run QMD depends on its permissions and setup. Configure an integration separately if needed; installing QMD does not automatically change Lumina-Wiki commands.

## Update QMD

Update the tool, check its health, and refresh the collection:

```bash
npm update -g @tobilu/qmd
qmd doctor
qmd status
qmd update
qmd embed
```

## Troubleshooting

| Problem | What to do |
| --- | --- |
| `qmd: command not found` | Reopen the terminal. If it remains unavailable, add npm's global bin directory to `PATH`, then reinstall QMD. |
| `qmd doctor` reports an unsupported Node version | Install Node.js 22 or later, reopen the terminal, and run `node --version` again. |
| macOS reports an SQLite or extension problem | Run `brew install sqlite`, reopen the terminal, and run `qmd doctor` again. |
| The collection has no expected notes | Run commands from the workspace root, check `qmd collection show my-wiki`, then run `qmd update` and `qmd embed`. |
| A recent note is absent from semantic results | Run `qmd update` followed by `qmd embed`; keyword search may find it first. |

For QMD command details and supported integrations, see the [official QMD documentation](https://github.com/tobi/qmd).
