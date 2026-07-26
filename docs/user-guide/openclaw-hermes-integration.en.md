# Use Lumina-Wiki from OpenClaw or Hermes

Connect your existing OpenClaw or Hermes chat agent to Lumina-Wiki once, then
manage several wikis from the chat you already use. You can send a document to
a named wiki, ask what it says, or ask the agent to adopt or create a wiki
without opening that folder yourself.

This is an advanced how-to for people who already have OpenClaw or Hermes
working. For installing the chat platform or connecting a channel, use the
official [OpenClaw documentation](https://docs.openclaw.ai/) or [Hermes
documentation](https://hermes-agent.nousresearch.com/docs/).

## Before you begin

- OpenClaw or Hermes can already receive your messages and run commands in its
  own environment.
- Node.js 20 or later is available in that same environment. Check with:

  ```bash
  node --version
  ```

- The agent can read and write the folders you want to use for wikis.
- If Hermes runs in Docker, mount both your wiki folders and `~/.lumina` into
  the container before continuing.

Use this guide when one chat agent needs to care for more than one wiki. For a
single wiki that you always open in an editor, the regular Lumina-Wiki setup is
usually simpler.

## Install Lumina skills for the chat agent

Run the following in the environment where the agent runs. Replace
`<platform>` with `openclaw` or `hermes`:

```bash
npm install --global lumina-wiki
lumina install --yes --agents <platform>
```

If both platforms run in that same environment, use
`--agents openclaw,hermes` in the second command.

This installs Lumina's managed skills for the selected platform. It does not
create a wiki or replace unrelated skills already installed for the agent.

### Checkpoint: confirm the agent can see Lumina

Start a new chat, or restart the platform if it does not reload skills between
chats. Ask:

```text
What Lumina-Wiki tasks can you help me with?
```

The agent should say it can manage a group of wikis and should be able to use
`/lumi-hub`. If it cannot, see [Troubleshooting](#troubleshooting).

## Add your first wiki through chat

Tell the agent about either a wiki you already have or a new folder. Include a
natural name, a short alias, and—when creating a new wiki—its purpose and any
optional packs you want.

```text
Create a wiki at /Users/me/wikis/ai-engineering called AI Engineering.
Call it AI wiki. It is for AI engineering notes and papers. Include the
research pack.
```

The agent follows one safe chat-first path:

1. It checks the path without changing anything.
2. If the folder already contains your files, it tells you what it found and
   asks for explicit approval before adding Lumina files.
3. It asks only for details still missing, then creates and registers the wiki
   in one additive operation.

If the path is already a complete Lumina-Wiki, the agent registers it without
reinstalling or upgrading it. A wiki created through chat is intentionally
lightweight: the chat agent's skills stay global, while the wiki keeps its own
notes and working files.

### Checkpoint: the wiki is ready for chat

Ask:

```text
Which wikis do I have?
```

You should see **AI Engineering** and its alias. If you use an alias in a
later message, the agent resolves it to that wiki before doing work.

## Work from chat

Name the wiki whenever you send a document or ask for work:

```text
Add this PDF to my AI wiki.

What does AI Engineering say about evaluation-driven development?

Check my AI wiki for broken links.
```

For each request, the agent resolves the wiki by its name or alias, reads that
wiki's `README.md`, and then uses the normal Lumina workflow there. If exactly
one wiki clearly matches the subject, it tells you which one it chose;
otherwise, it asks you to choose.

When you attach a document, the agent first confirms that the platform made
the attachment available, then places a new collision-safe copy in the chosen
wiki before ingesting it. It does not overwrite an existing source file. Its
reply should name the wiki that changed.

### Checkpoint: test the whole route

Send a small document and say, “Add this to my AI wiki.” After it finishes,
ask one question answered by that document. A successful result confirms the
attachment, wiki selection, ingestion, and question flow.

## Keep the fleet healthy

Ask the agent, “Are all my wikis healthy?” It can run a read-only health check
across the wikis it knows. If a wiki is missing expected Lumina pieces, ask it
to repair that wiki. Repair creates only missing structure and applies safe
link fixes; it never deletes or overwrites existing wiki content.

You may schedule the health check with your platform's scheduler. The command
for an automation is `lumina wikis doctor --json`. Schedule checks, not
automatic ingestion: deciding which documents to add remains your decision.

## Troubleshooting

| Situation | What to do |
| --- | --- |
| Lumina skills do not appear | Open a new chat or restart the platform. Confirm Node.js and the `lumina` command are available to the agent's own environment, then repeat the installation command for that platform. |
| The agent cannot find a wiki | Use its exact name or alias. If the folder moved, tell the agent its new path so it can inspect and register it again. |
| The agent asks before using a folder with files | This is expected. Review the files it reports and approve only if you want Lumina added alongside them. |
| A document attachment cannot be read | Check the platform's attachment permissions and current size limit, then try a smaller file. Use the platform's official documentation because these limits can change. |
| A health check reports problems | Ask the agent to run a repair for that named wiki. It adds missing pieces and safe fixes, but does not replace your notes or sources. |

## Operating limits and safety

- Keep one primary writing agent per wiki at a time. Do not have two agents
  ingest or edit the same wiki simultaneously.
- Wikis remain separate. Lumina does not create links between them or combine
  them into one answer.
- Give the agent access only to chat channels and folders you are comfortable
  letting it use. Apply OpenClaw or Hermes permission and sandbox controls as
  needed.
- Chat-driven ingestion remains user-initiated. Use scheduled tasks only for
  health checks unless you deliberately choose a different workflow.

For everyday work inside a selected wiki, return to the [User Guide](en.md).
