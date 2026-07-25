/**
 * Doc/code drift guard for numbers that are restated in prose docs but are
 * actually derived from `src/scripts/schemas.mjs` — the wiki schema's single
 * source of truth (pure data, no I/O, no imports, safe to import anywhere,
 * per the module's own doc comment).
 *
 * Exists because a hand-restated number silently rotted, in the same three
 * files, on two separate occasions:
 *   1. The total shipped-skill count (see verify-lumi-help.test.mjs's
 *      completeness check, which guards the generated catalog directly —
 *      that check derives its expected set from SKILL.md, not a hand count,
 *      so it doesn't need a parallel guard here).
 *   2. The `EDGE_TYPES` count: `docs/system-architecture.md` was updated to
 *      "42" when schemas.mjs grew to 42 entries (commit e067795,
 *      2026-07-07), but `CLAUDE.md`, `docs/project-context.md`, and
 *      `docs/codebase-summary.md` were never touched and kept saying "28".
 *
 * Policy this test encodes: pin a restated NUMBER with a test when it
 * genuinely helps a reader orient on the system's shape (e.g. "42 directed
 * edge types" says something real). Do NOT try to keep every prose
 * description in sync this way — LISTS (which edge/entity/skill types exist,
 * their names) are intentionally left unpinned; a list is its own most
 * current documentation once written from source, and duplicating a
 * derivation-and-diff mechanism for every list a doc contains would be more
 * machinery than the drift risk justifies. Add a new case here only for
 * another number that both (a) recurs in prose across the repo and (b) is
 * cheap to derive from schemas.mjs / another pure-data module.
 *
 * Wired into `npm run test:catalog` (same "does the shipped truth match what
 * we tell readers" theme as the lumi-help.csv completeness check) and CI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { EDGE_TYPES } from '../src/scripts/schemas.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const trueEdgeTypeCount = EDGE_TYPES.length;

// One pattern per doc, tied to that doc's exact current wording. If the
// wording changes, this test fails with a clear "pattern not found" message
// rather than silently passing — update the pattern alongside the wording.
const edgeTypeCountClaims = [
  { path: 'CLAUDE.md',                pattern: /edge types \((\d+) directed\)/ },
  { path: 'docs/project-context.md',  pattern: /\*\*Edge types:\*\* (\d+) directed types\./ },
  { path: 'docs/codebase-summary.md', pattern: /\*\*Edge types:\*\* (\d+) directed relationships/ },
];

for (const claim of edgeTypeCountClaims) {
  test(`${claim.path} states the true EDGE_TYPES.length (currently ${trueEdgeTypeCount})`, async () => {
    const content = await readFile(join(REPO, claim.path), 'utf8');
    const match = content.match(claim.pattern);
    assert.ok(
      match,
      `${claim.path}: expected edge-type-count pattern not found. Either the doc's ` +
      `wording changed (update this test's pattern to match) or the count sentence ` +
      `was removed (update this test to match the new location, or remove the case).`,
    );
    const stated = Number(match[1]);
    assert.equal(
      stated, trueEdgeTypeCount,
      `${claim.path} says "${stated} directed edge type(s)" but src/scripts/schemas.mjs's ` +
      `EDGE_TYPES currently has ${trueEdgeTypeCount}. schemas.mjs is the source of truth — ` +
      `update the doc to match it.`,
    );
  });
}
