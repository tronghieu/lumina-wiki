// Pure lint model for the tree and reader. The /api/lint body crosses the network, so it is checked here.
import { ancestorsOf } from './tree.mjs';

export const SEVERITY_RANK = Object.freeze({ error: 3, warning: 2, info: 1 });
// Own-key lookup: a severity named like an Object.prototype key must rank 0.
const rank = (s) => (Object.hasOwn(SEVERITY_RANK, s) ? SEVERITY_RANK[s] : 0);

/** The higher-ranked severity; unknown or missing ranks 0, and two of them give null. */
export function worstOf(a, b) {
  const r = Math.max(rank(a), rank(b));
  return r === 0 ? null : rank(a) === r ? a : b;
}

const usable = (f) =>
  f && typeof f === 'object' && typeof f.id === 'string' && Object.hasOwn(SEVERITY_RANK, f.severity) && typeof f.message === 'string';

/** Group findings by page, mark ancestor folders, and recount the summary from what passed the check. */
const emptyIndex = () => ({
  byNode: new Map(),
  folders: new Map(),
  workspace: [],
  summary: { errors: 0, warnings: 0, info: 0 },
  total: 0,
});

export function lintIndex(lint) {
  const index = emptyIndex();
  if (!lint || typeof lint !== 'object' || !Array.isArray(lint.findings)) return index;
  const key = { error: 'errors', warning: 'warnings', info: 'info' };
  for (const f of lint.findings.filter(usable)) {
    index.total++;
    index.summary[key[f.severity]]++;
    if (typeof f.nodeId !== 'string' || !f.nodeId) {
      index.workspace.push(f);
      continue;
    }
    const e = index.byNode.get(f.nodeId) ?? { worst: null, findings: [] };
    e.worst = worstOf(e.worst, f.severity);
    e.findings.push(f);
    index.byNode.set(f.nodeId, e);
    for (const dir of ancestorsOf(f.nodeId)) index.folders.set(dir, worstOf(index.folders.get(dir), f.severity));
  }
  return index;
}

/** Findings of one page; empty when it has none. */
export const findingsFor = (index, id) => index.byNode.get(id)?.findings ?? [];

/** A broken reply must never read as "no problems found": any bad shape or bad finding fails the whole result. */
export function lintResult(ok, body) {
  if (ok && body && typeof body === 'object' && Array.isArray(body.findings) && body.findings.every(usable)) {
    return { status: 'ready', index: lintIndex(body) };
  }
  return { status: 'failed', index: emptyIndex() };
}

export const LINT_LOADING = Object.freeze({ status: 'loading', index: emptyIndex() });

/** Page id to worst severity for the graph rings; null when rings are off. */
export const ringsOf = (index, on) =>
  on === true ? new Map([...index.byNode].map(([id, e]) => [id, e.worst])) : null;
