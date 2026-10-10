// Copy of the project-mode community detection (Louvain), because the project tree is not installed in classic workspaces.
// A parity test (communities.test.mjs) keeps the two copies in step.

/** One local-moving pass over a weighted adjacency list; returns a community label per vertex. */
function localMoving(adj) {
  const k = adj.map((nb) => { let s = 0; for (const w of nb.values()) s += w; return s; });
  const m2 = k.reduce((a, b) => a + b, 0);
  const comm = adj.map((_, i) => i);
  if (m2 === 0) return comm;
  const tot = k.slice();
  let moved = true;
  while (moved) {
    moved = false;
    for (let i = 0; i < adj.length; i++) {
      const ci = comm[i];
      const wTo = new Map();
      for (const [j, w] of adj[i]) if (j !== i) wTo.set(comm[j], (wTo.get(comm[j]) || 0) + w);
      tot[ci] -= k[i];
      let best = ci;
      let bestGain = (wTo.get(ci) || 0) - (tot[ci] * k[i]) / m2;
      for (const [c, w] of wTo) {
        const gain = w - (tot[c] * k[i]) / m2;
        if (gain > bestGain + 1e-12) { best = c; bestGain = gain; }
      }
      tot[best] += k[i];
      if (best !== ci) { comm[i] = best; moved = true; }
    }
  }
  return comm;
}

/**
 * @param {{id: string}[]} nodes - sorted.
 * @param {{from: string, to: string}[]} edges - sorted.
 * @returns {{of: number[], list: {name: string, size: number}[]}} `of[i]` is
 *   node i's community index; `list` is ordered by size (desc), then by the
 *   community's first node, and each is named after its highest-degree node.
 */
export function detectCommunities(nodes, edges) {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  let adj = nodes.map(() => new Map());
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    adj[a].set(b, (adj[a].get(b) || 0) + 1);
    adj[b].set(a, (adj[b].get(a) || 0) + 1);
  }
  const degree = adj.map((nb) => nb.size);

  // Each level merges communities into super-vertices and re-runs local
  // moving, until a level merges nothing.
  let member = nodes.map((_, i) => i);
  for (;;) {
    const comm = localMoving(adj);
    const labels = [...new Set(comm)];
    if (labels.length === adj.length) break;
    const relabel = new Map(labels.map((c, i) => [c, i]));
    member = member.map((s) => relabel.get(comm[s]));
    const next = labels.map(() => new Map());
    adj.forEach((nb, s) => {
      const cs = relabel.get(comm[s]);
      for (const [t, w] of nb) {
        const ct = relabel.get(comm[t]);
        next[cs].set(ct, (next[cs].get(ct) || 0) + w);
      }
    });
    adj = next;
  }

  const groups = new Map();
  member.forEach((c, i) => {
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(i);
  });
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
  const of = new Array(nodes.length);
  const list = ordered.map((members, ci) => {
    let top = members[0];
    for (const i of members) {
      of[i] = ci;
      if (degree[i] > degree[top]) top = i;
    }
    const id = nodes[top].id;
    return { name: id.slice(id.indexOf(':') + 1), size: members.length };
  });
  return { of, list };
}
