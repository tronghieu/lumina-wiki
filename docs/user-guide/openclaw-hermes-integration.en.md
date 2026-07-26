# Install and Integrate Lumina-Wiki with OpenClaw and Hermes

Use this guide to run one OpenClaw or Hermes agent across several
Lumina-Wikis. You can send a document from chat, ask a question, or ask the
agent to create a new wiki without opening its project folder.

This is an integration guide. It assumes OpenClaw or Hermes is already
installed, connected to your chat channel, and allowed to run commands. For
platform setup, use the official [OpenClaw documentation](https://docs.openclaw.ai/)
or [Hermes documentation](https://hermes-agent.nousresearch.com/docs/).

## What you need

- Node.js 20 or later in the environment where the agent runs.
- OpenClaw or Hermes working with your chosen chat channel.
- A stable folder for each wiki.

Check Node.js first:

```bash
node --version
```

## 1. Install Lumina for your agent

Run these two commands in the environment where the agent runs. The first
installs the `lumina` CLI; the second installs Lumina's skills for OpenClaw:

```bash
npm install --global lumina-wiki
lumina install --yes --agents openclaw
```

For Hermes, replace `openclaw` with `hermes`. If OpenClaw and Hermes both run
in the same environment, use:

```bash
lumina install --yes --agents openclaw,hermes
```

Open a new chat after installing and ask:

```text
What Lumina-Wiki tasks can you help me with?
```

The agent should now be able to list, set up, check, and use your wikis
through `/lumi-hub`.

## 2. Add an existing wiki or create a new one

Do this in chat, not by manually creating Lumina folders. The agent first
looks at the path and asks only for information it still needs.

To add an existing wiki, say:

```text
Remember the wiki at /Users/me/wikis/ai-engineering as AI Engineering.
You can also call it AI wiki.
```

To create a new wiki, include the path, purpose, and any packs you want:

```text
Create a new wiki at /Users/me/wikis/cooking called Cooking.
It is for recipes and kitchen notes. Add the research pack.
```

The agent checks the folder before changing it.

- If it is already a Lumina-Wiki, it only adds it to your wiki list.
- If it is empty or missing, it asks for a name, description, and optional
  packs before setting it up.
- If it already has your files, it tells you what it found and waits for your
  explicit approval. It only adds missing Lumina files and never overwrites
  your existing files.

Pick a short alias you would naturally use in conversation. `AI wiki` is often
more convenient than a long project name.

## 3. Use the wiki from chat

Once a wiki is known to the agent, name it when you make a request:

```text
Add this PDF to my AI wiki.

What does Cooking say about keeping kitchen knives sharp?

Check my Reading Notes wiki for broken links.
```

If the request names one wiki clearly, the agent works there. If more than
one wiki could fit, it asks you to choose instead of guessing. Each reply that
changes something should name the wiki it changed.

When you send a document through chat, the agent places a new copy in the
selected wiki and follows the normal Lumina ingest flow. A file already in the
wiki is never overwritten.

## 4. Check all of your wikis

Ask “Which wikis do I have?” or “Are all my wikis healthy?”, or run:

```bash
lumina wikis list
lumina wikis resolve "AI wiki"
lumina wikis doctor
```

For a report that is convenient for an automation or another tool, add
`--json`:

```bash
lumina wikis doctor --json
```

If a check finds missing Lumina pieces, repair only those missing pieces:

```bash
lumina wikis doctor --fix
```

The repair does not delete or rewrite existing wiki content. Use it after a
folder was partly copied, restored, or accidentally damaged.

OpenClaw's scheduled tasks or Hermes scheduled tasks can run
`lumina wikis doctor --json` regularly. Do not schedule automatic ingestion:
choosing what to ingest remains your decision.

## Troubleshooting and operating limits

| Situation | What to do |
| --- | --- |
| The agent cannot find a wiki | Ask it to run `lumina wikis doctor`. If the wiki moved, register its new path in chat. |
| The agent is unsure which wiki you mean | Reply with the wiki's name or alias. It should not choose for you. |
| Lumina skills do not appear | Start a new chat or restart the platform, then run the matching `lumina install --yes --agents ...` command again. |
| A health check finds missing pieces | Use `lumina wikis doctor --fix`; it only adds missing pieces. |

One agent should be the primary writer for a wiki at any given time. Do not
have two agents ingest or edit the same wiki simultaneously. Lumina
also keeps wikis separate: it does not create links between wikis or answer
one combined question across all of them.

Only expose folders and chat channels that you are comfortable letting the
agent access. Use each platform's permission and sandbox controls for
stricter boundaries.

## Next steps

Send a small document to your first wiki and ask a simple question about it.
This confirms the full path: chat attachment, selected wiki, ingestion, and a
useful answer. For day-to-day Lumina commands, return to the [User Guide](en.md).
