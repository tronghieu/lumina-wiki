---
stepsCompleted: [0]
project_name: 'LuminaWiki'
date: '2026-05-06'
type: 'spec'
status: 'draft'
---

# Spec: /lumi-help Skill (RAG Assistant)

## Outcome
A context-aware, RAG-based (Retrieval-Augmented Generation) assistant that replaces static onboarding by providing instant answers to user questions about Lumina-Wiki’s features, commands, and troubleshooting.

## High-Level Intent
- **Dynamic Onboarding**: Instead of a "guided tour," users ask natural language questions when they encounter friction.
- **Internal Knowledge Index**: The skill must index local documentation, including `README.md`, `docs/user-guide/*.md`, and `GEMINI.md`.
- **Contextual Troubleshooting**: Help users debug common issues (e.g., missing API keys, lint errors, or graph drift) by explaining the *why* and *how*.
- **Command Discovery**: Act as an interactive "man page" that provides examples and explains flags for any `/lumi-*` skill.

## Acceptance Criteria
1. **Indexing Engine**: A mechanism to parse and index local markdown documentation into a searchable vector store or structured retrieval index.
2. **Slash Command**: Implementation of the `/lumi-help` command that accepts a natural language query.
3. **Multi-language Awareness**: Answers must respect the configured `communication_language` (English, Vietnamese, or Simplified Chinese) using the corresponding localized docs.
4. **Agent Integration**: The skill should be able to look up the current wiki state (e.g., "Why is my graph failing lint?") to provide specific debugging advice.
5. **Cold-start Optimized**: The help index should be pre-computed or lightweight enough to answer in < 2 seconds.
