// Read model of the wiki viewer: three live reads over the classic engine's exports (AD-3, AD-12, AD-21).
import { readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  runLint, walkMd, parseFrontmatter, parseEdgesJsonl,
  resolveWikilinkTarget, buildBasenameIndex, entityTypeForPath,
} from '../../scripts/lint.mjs';
import { ENTITY_DIRS, EDGE_TYPES, EDGE_CONFIDENCE, REQUIRED_FRONTMATTER, WIKILINK_RE } from '../../scripts/schemas.mjs';
import { edgeTypeByName } from '../../scripts/lib/edges.mjs';
import { detectCommunities } from './communities.mjs';

const wikiOf = (root) => join(root, 'wiki');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Null sorts first; strings compare by UTF-16 code unit and numbers numerically.
const cmpNullFirst = (a, b) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : cmp(a, b));

// AD-4: the page set is every .md under wiki/ outside graph/, keyed by id.
async function pageFiles(root) {
  const wikiRoot = wikiOf(root);
  await stat(wikiRoot); // walkMd swallows a missing folder; the server maps this throw to 500.
  const files = new Map();
  for (const f of await walkMd(wikiRoot)) {
    const rel = relative(wikiRoot, f).replace(/\\/g, '/');
    if (rel.split('/')[0] !== 'graph' && !/(^|\/)\.md$/.test(rel)) files.set(rel.slice(0, -3), f);
  }
  return files;
}

function resolver(ids) {
  const slugs = new Set(ids);
  const index = buildBasenameIndex(slugs);
  return (raw) => (raw.includes('://') ? null : resolveWikilinkTarget(raw, slugs, index));
}

function describePage(id, content) {
  const fm = parseFrontmatter(content);
  const frontmatter = fm ? fm.data : {};
  const t = Object.hasOwn(frontmatter, 'title') ? frontmatter.title : undefined;
  const usable = (typeof t === 'string' && t.trim() !== '') || typeof t === 'number';
  const dir = id.split('/')[0];
  return {
    id,
    // Own-key check: a folder named like an Object.prototype key is not an entity type.
    type: Object.hasOwn(ENTITY_DIRS, dir) && dir !== 'graph' ? entityTypeForPath(id + '.md') : null,
    title: usable ? String(t) : id.slice(id.lastIndexOf('/') + 1),
    frontmatter,
    body: fm ? fm.body : content,
  };
}

// AD-6: normalize rows to ids, collapse duplicates, then drop the stored half of each reverse pair.
function normalizeEdges(rows, resolve) {
  const endpoint = (raw) => (raw.includes('://') ? `url:${raw}` : resolve(raw) ?? `missing:${raw}`);
  const collapsed = new Map();
  for (const r of rows) {
    let { type } = r;
    let from = endpoint(r.from);
    let to = endpoint(r.to);
    if (r.edges && type === 'cited_by') { [from, to] = [to, from]; type = 'cites'; }
    if (edgeTypeByName(type)?.symmetric && from > to) [from, to] = [to, from];
    const key = JSON.stringify([from, type, to]);
    const prev = collapsed.get(key) ?? { from, type, to, confidence: null, source: 'edges' };
    prev.confidence ??= r.confidence;
    if (r.citations) prev.source = 'citations';
    collapsed.set(key, prev);
  }
  const all = [...collapsed.values()];
  const order = (t) => EDGE_TYPES.findIndex((d) => d.name === t);
  const names = (a, b) => edgeTypeByName(a.type)?.reverse === b.type;
  // a beats b: a names b as its reverse, and on a tie a is listed first in EDGE_TYPES.
  const beats = (a, b) => names(a, b) && (!names(b, a) || order(a.type) < order(b.type));
  // Indexed by endpoint pair so pairing stays linear on a wiki with thousands of edges.
  const byPair = new Map();
  for (const r of all) {
    const key = `${r.from}\0${r.to}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(r);
  }
  const kept = [];
  for (const r of all) {
    const pairable = !edgeTypeByName(r.type)?.symmetric;
    const partners = !pairable ? [] : (byPair.get(`${r.to}\0${r.from}`) ?? [])
      .filter((p) => !edgeTypeByName(p.type)?.symmetric && (names(r, p) || names(p, r)));
    if (partners.some((p) => beats(p, r))) continue;
    for (const p of partners) r.confidence ??= p.confidence;
    kept.push(r);
  }
  return kept
    .map((r) => ({ ...r, directed: edgeTypeByName(r.type)?.symmetric !== true }))
    .sort((a, b) => cmp(a.from, b.from) || cmp(a.type, b.type) || cmp(a.to, b.to));
}

const CONFIDENCE = new Set(EDGE_CONFIDENCE);
const isStr = (v) => typeof v === 'string';
const isText = (v) => isStr(v) && v.trim() !== '';
// A page that another program deletes mid-read is simply absent.
const readOrNull = (f) => readFile(f, 'utf8').catch((e) => { if (e.code === 'ENOENT') return null; throw e; });

export async function readWiki(root) {
  const files = await pageFiles(root);
  const resolve = resolver(files.keys());
  const graph = join(wikiOf(root), 'graph');
  const rows = [];
  for (const [file, citations] of [['edges.jsonl', false], ['citations.jsonl', true]]) {
    for (const r of await parseEdgesJsonl(join(graph, file))) {
      if (r === null || typeof r !== 'object' || Array.isArray(r)) continue;
      if (!isText(r.from) || !isText(r.to) || (!citations && !isText(r.type))) continue;
      rows.push({
        from: r.from,
        to: r.to,
        type: citations ? 'cites' : r.type,
        confidence: CONFIDENCE.has(r.confidence) ? r.confidence : null,
        edges: !citations,
        citations,
      });
    }
  }
  const edges = normalizeEdges(rows, resolve);

  const nodes = [];
  for (const [id, f] of [...files]) {
    const text = await readOrNull(f);
    if (text === null) { files.delete(id); continue; }
    const { type, title } = describePage(id, text);
    nodes.push({ id, kind: 'page', type, title, community: null });
  }
  nodes.sort((a, b) => cmp(a.id, b.id));
  const pageIds = new Set(files.keys());
  // detectCommunities names a group after the text past the first ':'; one prefix keeps a page id whole.
  const { of, list } = detectCommunities(
    nodes.map((n) => ({ id: ':' + n.id })),
    edges.filter((e) => pageIds.has(e.from) && pageIds.has(e.to)).map((e) => ({ ...e, from: ':' + e.from, to: ':' + e.to })),
  );
  nodes.forEach((n, i) => { n.community = of[i]; });
  const extra = new Set();
  for (const e of edges) for (const id of [e.from, e.to]) if (!pageIds.has(id)) extra.add(id);
  for (const id of extra) {
    nodes.push({ id, kind: id.startsWith('url:') ? 'url' : 'missing', type: null, title: id.slice(id.indexOf(':') + 1), community: null });
  }
  nodes.sort((a, b) => cmp(a.id, b.id));

  return {
    generatedAt: new Date().toISOString(),
    schema: {
      entityTypes: Object.keys(ENTITY_DIRS).filter((name) => name !== 'graph').map((name) => ({
        name,
        required: (REQUIRED_FRONTMATTER[name] ?? [])
          .filter((f) => f.required && !REQUIRED_FRONTMATTER._base.some((b) => b.key === f.key))
          .map((f) => f.key),
      })),
      relationTypes: EDGE_TYPES.map((t) => ({ name: t.name, symmetric: t.symmetric === true, reverse: t.reverse ?? null })),
      wikilinkPattern: WIKILINK_RE.source,
    },
    nodes,
    edges,
    communities: list,
  };
}

export async function readPage(root, id) {
  // AD-8: id is only ever a key of this call's own map, never joined onto a path.
  const files = await pageFiles(root);
  const file = files.get(id);
  if (file === undefined) return null;
  const text = await readOrNull(file);
  if (text === null) return null;
  const page = describePage(id, text);
  const resolve = resolver(files.keys());
  const links = Object.create(null);
  // The engine pattern decides what a wikilink is. The cheap checks skip starts it would
  // reject only after scanning to the end of the text, which stalls the single-threaded server.
  const body = page.body;
  const re = new RegExp(WIKILINK_RE.source, 'y');
  let p = 0, close = -1, pipe = -1;
  for (;;) {
    const i = body.indexOf('[[', p);
    if (i === -1) break;
    if (close < i + 2) {
      close = body.indexOf(']', i + 2);
      if (close === -1) break;
    }
    if (body[close + 1] !== ']') { p = close + 1; continue; }
    if (pipe < i + 2) {
      pipe = body.indexOf('|', i + 2);
      if (pipe === -1) pipe = Infinity;
    }
    if (close === i + 2 || body[i + 2] === '|' || pipe === close - 1) { p = i + 1; continue; }
    re.lastIndex = i;
    const m = re.exec(body);
    if (m === null) { p = i + 1; continue; }
    const target = m[1].trim();
    links[target] = resolve(target);
    p = i + m[0].length;
  }
  return { ...page, links };
}

export async function readLint(root) {
  const files = await pageFiles(root);
  const resolve = resolver(files.keys());
  const { findings: raw } = await runLint(root, {});
  const summary = { errors: 0, warnings: 0, info: 0 };
  const findings = raw.map((f) => {
    const file = isStr(f.file) ? f.file : null;
    // A .md file is a path under wiki/; anything else is an edge endpoint as written.
    const nodeId = file === null ? null
      : file.endsWith('.md') ? (files.has(file.slice(0, -3)) ? file.slice(0, -3) : null)
      : resolve(file);
    if (f.severity === 'error') summary.errors++;
    else if (f.severity === 'warning') summary.warnings++;
    else if (f.severity === 'info') summary.info++;
    return {
      id: f.id,
      severity: f.severity,
      fixable: f.fixable,
      file,
      line: f.line ?? null,
      message: f.message,
      nodeId,
    };
  });
  findings.sort((a, b) => cmpNullFirst(a.file, b.file) || cmpNullFirst(a.line, b.line) || cmp(a.id, b.id) || cmp(a.message, b.message));
  return { findings, summary };
}
