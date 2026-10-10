---
name: lumi-view
description: >
  Starts the wiki viewer and gives you an address to open in your browser: a
  map of the pages and how they relate, a list of every page, and a reader.
  Nothing can be changed from the viewer. Use when the user asks to see,
  browse, open, or visualize the wiki or its graph, or asks for the viewer's
  address, or asks to stop the viewer.
allowed-tools:
  - Bash
  - Read
---

# /lumi-view

Read `README.md` at the project root before this SKILL.md.

## Role

You start the wiki's built-in viewer and tell the user where to open it. You do not open the page, read it, or describe its contents.

## Context

- The viewer is a small local program, `_lumina/viewer/view.mjs`. It serves the wiki at an address on the machine it runs on. It changes no file.
- It runs only while its command runs. When the command ends, the viewer is gone and nothing is left behind.
- It reads the wiki from disk at each request. After the wiki changes, the user reloads the page in the browser. You restart nothing.
- After a Lumina update, a viewer that is still running serves the old version. It has to be stopped and started again. The `stale_server` answer below is how you find out.
- When it is ready it prints one line to standard output: `{"ok":true,"url":"http://127.0.0.1:<port>/","port":<port>,"reused":false}`.
- `"reused":true` means a viewer for this wiki was already running. The command you ran then ends by itself, and the first viewer keeps serving.
- When it cannot start it prints one line to the error stream, `{"error":"...","code":<n>,"reason":"..."}`, and exits with that code.
- Other lines may appear, such as a note that the usual port was taken. The line that matters is the first one that starts with `{`, on either stream.

## Instructions

### Step 1 — Find the wiki root

The wiki root is the folder of the `README.md` you just read. It holds both `wiki/` and `_lumina/`. If you have not found it yet, look in the current folder, then in each parent folder.

- No such folder: you are not inside a wiki. Say so and stop.
- The root has no `_lumina/viewer/view.mjs`: this wiki was set up before the viewer existed. Go to "The viewer is not installed" and stop.

Use the root's full path in every command below.

### Step 2 — Decide where the viewer has to run

The address works only on the computer where the viewer runs.

- You run on the user's own computer: go to Step 3.
- You run somewhere else (a remote session, a hosted agent, a container): do not start anything. Say that an address from this machine would not open in their browser. Then go to Step 5, and add that the two lines only work on a computer that holds this wiki folder.
- You cannot tell: go to Step 3, and say in your answer that the address opens only on the computer this session runs on.

### Step 3 — Start it so that it keeps running

Run this with the wiki root as the working directory:

```bash
node _lumina/viewer/view.mjs
```

If your tool has no setting for the working directory, change into the wiki root first, as a separate command or line. Do not join the two with `&&`; some shells reject it.

Start it the way your host keeps a command running after the step returns: a background task or a background shell command. Do not wait for the command to finish. It does not finish. The way you start it must let you read what the command prints; if it cannot, go to Step 5.

Run this same step every time the user asks, even when you started a viewer earlier in the session. A second run answers at once with `"reused":true` and the same address.

If your host has no way to keep a command running, go to Step 5.

### Step 4 — Read the answer

Wait up to 10 seconds for the first line that starts with `{`.

- `"ok":true` — go to "Output Format" with the `url`.
- A line with `"reason"` — find the reason below. Say the plain sentence to the user, then do the one action.

| `reason` | Say | Then |
| --- | --- | --- |
| `bind_refused` | I am not allowed to use a local address from here. | Go to Step 5. |
| `stale_server` | A viewer from before the last update is still running for this wiki. | Go to "A viewer from an older version". |
| `no_workspace` | This folder is not a wiki. | Stop. |
| `no_free_port` | Every address the viewer may use is taken on this computer. | Pass on the message, which names the range. Stop. |
| `node_version` | The viewer needs Node 24 or newer. | Stop. |
| `internal` | The viewer failed to start. | Pass on the message. Stop. |

- The command ended with no such line, or printed something else — report what it printed and stop.
- No line after 10 seconds — end the command you started, say the viewer did not answer, and go to Step 5.

After a failure, do not run the command again to "try once more". The one exception is in "A viewer from an older version".

### Step 5 — Hand the command to the user

Tell the user to run these two lines in a terminal on the computer that holds the wiki, and to open the address the second one prints in a browser on that same computer:

```
cd "<wiki root>"
node _lumina/viewer/view.mjs
```

Give them as two lines. They work that way in every shell.

Tell them:

- The viewer stops when they press Ctrl-C in that terminal.
- If the command prints an address and returns at once, a viewer is already running. That address is the one to open.

### A viewer from an older version

The `stale_server` message names the port, for example "on port 28412".

- You started that viewer in this session: end that command, then run Step 3 once more.
- Someone else started it and the user knows where: tell them to press Ctrl-C in the terminal that runs it, then to ask you again. Stop.
- Nobody knows where it runs: offer to stop it, and wait for a yes. Then:
  1. Check that the port still belongs to a viewer. Run `node -e "fetch('http://127.0.0.1:<port>/api/health').then(r=>r.text()).then(console.log)"`. Go on only if the answer contains `"app":"lumina-view"`.
  2. Find the process that listens on that port and end it. macOS and Linux: `lsof -ti tcp:<port> -sTCP:LISTEN`, then `kill <pid>`. Windows PowerShell: `(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort <port> -State Listen).OwningProcess`, then `Stop-Process -Id <pid>`.
  3. Run Step 3 once more.

If any of these fails, say what happened and stop.

### The viewer is not installed

Tell the user to update the wiki by running this in the wiki root, then to ask for the viewer again:

```
npx lumina-wiki@latest install
```

Before you say it, read `_lumina/manifest.json`. If it says `"profile": "minimal"`, this wiki is managed from the Lumina hub. Add that the update also puts the per-project command files into the wiki folder, and let the user decide.

### Stopping the viewer

The user asks to stop the viewer.

- You started it in this session: end that background command. Say that it has stopped.
- Someone else started it: tell the user to press Ctrl-C in the terminal that runs it.

## Output Format

The viewer started:

```
The wiki viewer is running: http://127.0.0.1:<port>/

Open that address in a browser on this computer. It runs for as long as this
session keeps it running; if the address stops answering, ask me again.
Reload the page to see new changes to the wiki.
```

It was already running (`"reused":true`):

```
The wiki viewer is already running: http://127.0.0.1:<port>/

Open that address in a browser on this computer. Reload the page to see new
changes to the wiki.
```

You handed over the command: show the two lines and the two points from Step 5. Never show an address you did not receive.

## Examples

<example>
User: show me the wiki

You are on the user's computer. The wiki root is `/home/ana/notes`. You start `node _lumina/viewer/view.mjs` there as a background task and read:
`{"ok":true,"url":"http://127.0.0.1:28412/","port":28412,"reused":false}`

You answer:
The wiki viewer is running: http://127.0.0.1:28412/

Open that address in a browser on this computer. It runs for as long as this session keeps it running; if the address stops answering, ask me again. Reload the page to see new changes to the wiki.
</example>

<example>
User: open the graph

The command prints to the error stream:
`{"error":"The system refused to open a local port, which usually means a sandbox, so run this command in your own terminal","code":2,"reason":"bind_refused"}`

You answer:
I am not allowed to use a local address from here. Run these two lines in your own terminal and open the address the second one prints:

cd "/home/ana/notes"
node _lumina/viewer/view.mjs

It stops when you press Ctrl-C in that terminal. If it prints an address and returns at once, a viewer is already running; open that address.
</example>

## Guardrails

- Never open, fetch, or summarize the viewer's page yourself. The one request you may make is the `/api/health` check in "A viewer from an older version".
- Never report an address the command did not print.
- Never end a process you did not start unless the user said yes and the health check named the viewer.
- Never keep two viewers running for the same wiki.
- Never make the viewer outlive the session on purpose: no detached process, no service, no startup entry.
- Never edit anything under `_lumina/viewer/`.
- The viewer changes nothing in the wiki. If the user asks to change a page, that is `/lumi-edit`.

## Definition of Done

- The user has the address the command printed, or the two lines to run themselves, or a plain statement of why the viewer could not start.
- No viewer command you started is left running after a failure.
