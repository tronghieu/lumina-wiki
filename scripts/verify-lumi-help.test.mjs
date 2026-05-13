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
 *   6. every `after`/`before` reference resolves to an id in the same render.
 *
 * Wired into `npm run test:catalog` and `npm run test:all`. Catches:
 *   - typos in `after`/`before` (would silently break Mode A's DAG),
 *   - duplicate `menu` codes (would alias keyboard shortcuts in /lumi-help),
 *   - invalid phase strings (would skip the row in phase-ordered iteration),
 *   - pack mis-conditioning (would leak research/reading rows into core-only installs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { render } from '../src/installer/template-engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const TEMPLATE = join(REPO, 'src/templates/_lumina/schema/lumi-help.csv');

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
  });
}
