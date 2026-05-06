---
stepsCompleted: [0]
project_name: 'LuminaWiki'
date: '2026-05-06'
type: 'spec'
status: 'refined'
---

# Spec: KG Consistency & Contradiction Audit

## Outcome
A lightweight, wiki-wide audit capability designed to identify semantic contradictions and structural drift, preventing "knowledge silos" as the graph grows beyond human cognitive limits.

## High-Level Intent
- **Direct Contradiction Detection**: Prioritize the identification of conflicting claims between different entries (e.g., Source A asserts X, while Source B asserts Y which contradicts X).
- **Lightweight First Pass**: Focus on a simple, high-signal audit rather than an exhaustive academic review to minimize token costs and complexity.
- **Prose-Graph Reconciliation**: Ensure that relations described in markdown body text are formally recorded in `wiki/graph/edges.jsonl`.

## Acceptance Criteria
1. **Triple Extraction**: The `/lumi-audit` skill can parse markdown prose to extract `(subject, predicate, object)` triples for comparison.
2. **Conflict Reporting**: Detect and report pairs of entries that use opposing predicates (e.g., `contradicts`, `refutes`, `challenges`) or make logically inconsistent claims about the same concept.
3. **Structural Health**: Deterministically flag orphan entities (non-foundation nodes with no inbound edges) and citation cycles.
4. **Advisory Non-Mutation**: The audit produces a report at `_lumina/_state/audit-report.json` and a human summary in `wiki/log.md`, but never modifies user-authored body text.
5. **Back-compat**: The audit must run successfully on existing v0.1 wikis with zero initial metadata required.
