# How to build a research picture from ordinary sources

Use this guide when you want to study a question over time, rather than merely collect files. It works for papers, reports, articles, course material, and careful notes. You will begin with a question, choose a small set of sources, add them one by one, then ask what the collected material supports.

This guide assumes the Research pack is available. Check with `/lumi-help skills` if you are unsure. Examples use `/`; use `$` instead in Codex.

## 1. Write one research question

Make the question narrow enough to guide your first few readings. For example:

```text
How does spaced repetition affect long-term vocabulary learning for adults?
```

Keep the question in a note or say it to the AI. A question can change later; its job now is to help you choose the next source.

### Checkpoint

You should be able to say what kind of evidence would help answer the question: an experiment, a review, a classroom report, or another kind of source.

## 2. Choose the first sources

If you already have papers or articles, place one or two in `raw/sources/`. If you need ideas for what to read, run:

```text
/lumi-research-discover
```

Review the suggested shortlist yourself. Pick the sources that fit your question and your available time. The command does not add them to the wiki until you choose to proceed.

If your topic has a few basic terms that you expect to use repeatedly, you can also run `/lumi-research-prefill` before adding sources. Use it for stable background ideas, not for claims your research still needs to test.

### Checkpoint

Have a small, intentional starting set. Two or three good sources are more useful than a large pile you have not examined.

## 3. Add sources one at a time

For each local file, run:

```text
/lumi-ingest raw/sources/first-paper.pdf
```

Read the draft and compare it with the original before accepting it. Ask for a clearer summary, a missing limitation, or a better explanation when needed. Then repeat with the next source.

### Checkpoint

After each source, open its page in `wiki/sources/`. You should be able to find the main result, the important limits, and a route back to the original file.

## 4. Compare what the sources say

Once you have several sources, ask a focused question:

```text
/lumi-ask Where do these sources agree, and where do they differ on vocabulary learning?
```

Ask for missing evidence as well:

```text
/lumi-ask What would I need to read next to answer my question with more confidence?
```

Use the linked notes in the answer to decide whether to add another source or refine your question.

## 5. Create an overview when it is useful

When a theme is beginning to recur, run:

```text
/lumi-research-topic
```

When you want a written overview of the material already in the wiki, run:

```text
/lumi-research-survey
```

These commands work from material you have already added. Read the result before asking to save it, especially if you will share it with someone else.

### Checkpoint

You should now be able to open the overview and trace its important statements back to the source notes that support them.

## 6. Keep the work trustworthy

Run `/lumi-check` after a group of additions. Before you rely on a source note for an important decision, paper, or presentation, run `/lumi-verify` on that source or on the whole wiki. Read the findings and decide what to revise; neither command should replace your judgment.

If you need help deciding what to read next, use `/lumi-research-rank source-name` for a paper already in the wiki.

## Next steps

- [Look up all commands](commands.en.md).
- [Return to the first-document tutorial](en.md).
- [Advanced scheduled discovery](advanced-scheduled-discovery.en.md).
