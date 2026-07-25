/**
 * Catalog-template integrity check for `src/templates/_lumina/schema/lumi-help.csv`.
 *
 * Renders the template against eight pack configurations (all combinations of
 * research, reading, and learning) and asserts:
 *   1. the rendered output has the canonical CSV header,
 *   2. every data row has the expected column count,
 *   3. ids and menu codes are unique within each rendering,
 *   4. `phase`, `pack`, and `required` values are in the known sets,
 *   5. pack gating matches the template flags,
 *   6. every `after`/`before` reference resolves to an id in the same render,
 *   7. **completeness**: the rendered id set exactly matches the shipped
 *      project-installable skills — no skill is missing from the catalog, no
 *      stale/renamed id lingers in it.
 *
 * Wired into `npm run test:catalog` and `npm run test:all`. Catches:
 *   - typos in `after`/`before` (would silently break Mode A's DAG),
 *   - duplicate `menu` codes (would alias keyboard shortcuts in /lumi-help),
 *   - invalid phase strings (would skip the row in phase-ordered iteration),
 *   - pack mis-conditioning (would leak research/reading rows into core-only installs),
 *   - a shipped skill silently absent from `/lumi-help skills` (found in the
 *     wild: `/lumi-migrate-legacy` shipped, installed, and symlinked on every
 *     install, but had no catalog row — undiscoverable via `/lumi-help`).
 *
 * Check 7's expected-id set is derived by walking `src/skills/core/<name>`
 * and `src/skills/packs/<pack>/<name>` and reading each `SKILL.md`'s `name:`
 * frontmatter —
 * NOT by importing `getSkillDefs()` from `src/installer/commands.js`. That
 * function is private (not exported) and commands.js is a live edit target
 * for other work; walking SKILL.md directly is both independent of its
 * internal state and, arguably, a stronger check — SKILL.md is the actual
 * shipped artifact, so this catches drift between commands.js's own hardcoded
 * list and the CSV too, not just between the CSV and one particular list.
 * `src/skills/agents/**` (`lumi-hub`) is deliberately excluded: it is
 * agent-host-only, never installed into a project, and never belongs in this
 * project-installable catalog.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { render } from '../src/installer/template-engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const TEMPLATE = join(REPO, 'src/templates/_lumina/schema/lumi-help.csv');
const SKILLS_DIR = join(REPO, 'src/skills');

const EXPECTED_HEADER = 'id,menu,pack,phase,after,before,required,args,outputs,description';
const EXPECTED_COLUMNS = EXPECTED_HEADER.split(',');
const KNOWN_PHASES = new Set(['1-bootstrap', '2-ingest', '3-query', 'anytime']);
const KNOWN_PACKS = new Set(['core', 'research', 'reading', 'learning']);

/**
 * Split a CSV line respecting double-quoted fields. Doubled quotes inside a
 * quoted field decode to a single literal quote.
 */
function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split(',');
  const rows = lines.slice(1).map((line, idx) => {
    const values = splitCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = values[i] ?? '';
    row.__lineNumber = idx + 2;
    row.__rawColumns = values.length;
    return row;
  });
  return { header, rows };
}

/**
 * Extract the `name:` frontmatter value from a SKILL.md's leading `---`
 * block. Minimal by design — this is not a general YAML parser, just enough
 * to read one scalar field that project-context.md documents as required to
 * equal the installed canonicalId verbatim.
 */
function extractSkillName(content) {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const nameLine = fm[1].match(/^name:\s*(.+?)\s*$/m);
  return nameLine ? nameLine[1].trim() : null;
}

/**
 * canonicalIds of every skill directly under `dirPath` (one level of leaf
 * directories, each containing a SKILL.md) — e.g. `src/skills/core` or
 * `src/skills/packs/research`.
 */
async function skillIdsUnder(dirPath) {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const ids = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let content;
    try {
      content = await readFile(join(dirPath, entry.name, 'SKILL.md'), 'utf8');
    } catch (_) {
      continue; // not a skill leaf (no SKILL.md)
    }
    const name = extractSkillName(content);
    if (name) ids.push(name);
  }
  return ids;
}

// Read once, up front — independent of any per-case pack combination.
const CORE_IDS     = await skillIdsUnder(join(SKILLS_DIR, 'core'));
const RESEARCH_IDS = await skillIdsUnder(join(SKILLS_DIR, 'packs', 'research'));
const READING_IDS  = await skillIdsUnder(join(SKILLS_DIR, 'packs', 'reading'));
const LEARNING_IDS = await skillIdsUnder(join(SKILLS_DIR, 'packs', 'learning'));

const cases = [
  { name: 'core only',                          vars: { pack_research: false, pack_reading: false, pack_learning: false } },
  { name: 'core + research',                    vars: { pack_research: true,  pack_reading: false, pack_learning: false } },
  { name: 'core + reading',                     vars: { pack_research: false, pack_reading: true,  pack_learning: false } },
  { name: 'core + learning',                    vars: { pack_research: false, pack_reading: false, pack_learning: true  } },
  { name: 'core + research + reading',          vars: { pack_research: true,  pack_reading: true,  pack_learning: false } },
  { name: 'core + research + learning',         vars: { pack_research: true,  pack_reading: false, pack_learning: true  } },
  { name: 'core + reading + learning',          vars: { pack_research: false, pack_reading: true,  pack_learning: true  } },
  { name: 'core + research + reading + learning', vars: { pack_research: true, pack_reading: true, pack_learning: true  } },
];

for (const c of cases) {
  test(`lumi-help.csv renders cleanly: ${c.name}`, async () => {
    const tmpl = await readFile(TEMPLATE, 'utf8');
    const rendered = render(tmpl, c.vars);
    const { header, rows } = parseCsv(rendered);

    // 1. header
    assert.equal(header.join(','), EXPECTED_HEADER, 'header mismatch');

    // 2. row count + column count
    assert.ok(rows.length > 0, 'no skill rows in rendered CSV');
    for (const row of rows) {
      assert.equal(
        row.__rawColumns, EXPECTED_COLUMNS.length,
        `line ${row.__lineNumber}: ${row.__rawColumns} columns, expected ${EXPECTED_COLUMNS.length}`,
      );
    }

    // 3. ids and menu codes unique; required values valid
    const seenIds = new Set();
    const seenMenus = new Set();
    for (const row of rows) {
      assert.ok(row.id, `line ${row.__lineNumber}: missing id`);
      assert.ok(row.menu, `${row.id}: missing menu`);
      assert.ok(KNOWN_PACKS.has(row.pack), `${row.id}: unknown pack "${row.pack}"`);
      assert.ok(KNOWN_PHASES.has(row.phase), `${row.id}: unknown phase "${row.phase}"`);
      assert.ok(
        row.required === 'true' || row.required === 'false',
        `${row.id}: required must be true|false, got "${row.required}"`,
      );
      assert.ok(!seenIds.has(row.id), `duplicate skill id ${row.id}`);
      assert.ok(!seenMenus.has(row.menu), `duplicate menu code ${row.menu} (collides on ${row.id})`);
      seenIds.add(row.id);
      seenMenus.add(row.menu);
    }

    // 4. pack gating matches the template flags
    const packs = new Set(rows.map(r => r.pack));
    assert.ok(packs.has('core'), 'core pack absent from skills');
    assert.equal(
      packs.has('research'), c.vars.pack_research,
      `research pack gating wrong: expected ${c.vars.pack_research}, got ${packs.has('research')}`,
    );
    assert.equal(
      packs.has('reading'), c.vars.pack_reading,
      `reading pack gating wrong: expected ${c.vars.pack_reading}, got ${packs.has('reading')}`,
    );
    assert.equal(
      packs.has('learning'), c.vars.pack_learning,
      `learning pack gating wrong: expected ${c.vars.pack_learning}, got ${packs.has('learning')}`,
    );

    // 5. dependency references resolve within this rendering
    const idsInCase = new Set(rows.map(r => r.id));
    for (const row of rows) {
      const after  = row.after  ? row.after.split(';').filter(Boolean)  : [];
      const before = row.before ? row.before.split(';').filter(Boolean) : [];
      for (const dep of [...after, ...before]) {
        assert.ok(
          idsInCase.has(dep),
          `${row.id} references unknown skill "${dep}" in after/before`,
        );
      }
    }

    // 6. completeness: the rendered id set must exactly match the shipped
    // project-installable skills for this case's pack selection — see the
    // module doc for why this is derived from SKILL.md, not getSkillDefs().
    const expectedIds = new Set([
      ...CORE_IDS,
      ...(c.vars.pack_research ? RESEARCH_IDS : []),
      ...(c.vars.pack_reading  ? READING_IDS  : []),
      ...(c.vars.pack_learning ? LEARNING_IDS : []),
    ]);
    const missing = [...expectedIds].filter(id => !idsInCase.has(id)).sort();
    const extra   = [...idsInCase].filter(id => !expectedIds.has(id)).sort();
    assert.deepEqual(
      { missing, extra }, { missing: [], extra: [] },
      `catalog id set does not match shipped skills for "${c.name}" ` +
      `(missing: shipped but no catalog row; extra: catalog row but not a shipped skill for this pack selection)`,
    );
  });
}
