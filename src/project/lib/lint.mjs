/**
 * @file lint.mjs
 * @description Cross-doc lint (CAP-9, AD-14, AD-27): the relation-rule
 * findings P01-P08, computed over an already-built graph. Pure -- no I/O.
 * `project.mjs`'s `lint` subcommand folds these in with `buildGraph`'s own
 * engine findings (P09-P12, P17-P21, already in `graph.findings`) plus P13
 * (stale facts), P14/P15 (`verifyEvidence`), and P16 (scope warnings), none
 * of which this module owns.
 */

import { sortFindings, makeFinding, docPathOfSubject } from './graph.mjs';

/** A non-empty string is a scope; `null`/`""`/anything else from a hand-edited envelope is not. */
function isScope(v) {
  return typeof v === 'string' && v.length > 0;
}

/** `nodeId` normalized to its doc node (a `frag:` collapses to its own `doc:`); anything else is unchanged. */
function docNodeOf(nodeId) {
  const path = docPathOfSubject(nodeId);
  return path === null ? nodeId : `doc:${path}`;
}

/**
 * `graph.nodes[].status`; a `frag:` node with no status of its own -- or not
 * present as a node at all -- falls back to its doc's status.
 */
function statusOf(nodeId, nodesById) {
  const node = nodesById.get(nodeId);
  if (node && node.status !== undefined && node.status !== null) return node.status;
  if (nodeId.startsWith('frag:')) {
    return nodesById.get(`doc:${docPathOfSubject(nodeId)}`)?.status ?? undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Cycles (P01 supersedes, P06 depends-on, P07 part-of): one finding per
// strongly-connected set of 2+ nodes, at the evidence of its smallest edge
// (`edges` is already globally sorted by (from, relation, to) -- filtering
// preserves that order, so the first internal edge found is the smallest).
// ---------------------------------------------------------------------------

function stronglyConnectedComponents(nodes, adjacency) {
  let index = 0;
  const indices = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];

  function strongconnect(v) {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }
    if (lowlink.get(v) === indices.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) sccs.push(scc);
    }
  }

  for (const v of nodes) {
    if (!indices.has(v)) strongconnect(v);
  }
  return sccs;
}

function cycleFindings(edges, relation, ruleId) {
  const relEdges = edges.filter((e) => e.relation === relation);
  // A `frag:` id and its own `doc:` id are the same document for cycle
  // purposes (a doc depending on part of another doc still depends on that
  // doc) -- normalize before building the SCC graph, and drop the self-loops
  // that normalizing can create (a doc referencing its own fragment).
  const adjacency = new Map();
  const nodes = new Set();
  for (const e of relEdges) {
    const from = docNodeOf(e.from);
    const to = docNodeOf(e.to);
    if (from === to) continue;
    nodes.add(from);
    nodes.add(to);
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(to);
  }

  const findings = [];
  for (const scc of stronglyConnectedComponents(nodes, adjacency)) {
    const members = [...new Set(scc)].sort();
    const memberSet = new Set(members);
    const smallest = relEdges.find(
      (e) => docNodeOf(e.from) !== docNodeOf(e.to) && memberSet.has(docNodeOf(e.from)) && memberSet.has(docNodeOf(e.to)),
    );
    const ev = smallest.evidence[0];
    findings.push(makeFinding(ruleId, ev.file, ev.line, `${relation} cycle: ${members.join(', ')}`));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Supersedes (P02 target status, P03 citers of a superseded part) -- AD-27.
// ---------------------------------------------------------------------------

/** A merged `supersedes` edge's scope labels (Design Notes: any evidence scope makes the whole edge partial, even mixed with unscoped evidence). */
function scopesOf(edge) {
  return new Set(edge.evidence.map((e) => e.scope).filter(isScope));
}

function supersedesFindings(edges, nodesById) {
  const supersedesEdges = edges.filter((e) => e.relation === 'supersedes');

  // Every doc path that supersedes some target doc, keyed by that target's
  // doc path -- so two docs that both supersede the same target are never
  // counted as citers of each other's supersession (AD-27 talks about a
  // *citer*, not a fellow superseder).
  const supersedersByTargetDoc = new Map();
  for (const e of supersedesEdges) {
    const targetDocPath = docPathOfSubject(e.to);
    if (targetDocPath === null) continue;
    if (!supersedersByTargetDoc.has(targetDocPath)) supersedersByTargetDoc.set(targetDocPath, new Set());
    supersedersByTargetDoc.get(targetDocPath).add(docPathOfSubject(e.from));
  }

  // P03's citer lookup, indexed once instead of an O(edges) filter per
  // supersedes edge: by exact target node id (fragment/scoped-doc case) and
  // by the target's own doc path (full-doc case).
  const edgesByTo = new Map();
  const edgesByToDocPath = new Map();
  for (const e of edges) {
    if (!edgesByTo.has(e.to)) edgesByTo.set(e.to, []);
    edgesByTo.get(e.to).push(e);
    const toDocPath = docPathOfSubject(e.to);
    if (toDocPath !== null) {
      if (!edgesByToDocPath.has(toDocPath)) edgesByToDocPath.set(toDocPath, []);
      edgesByToDocPath.get(toDocPath).push(e);
    }
  }

  const findings = [];

  for (const edge of supersedesEdges) {
    const scopes = scopesOf(edge);
    const isFrag = edge.to.startsWith('frag:');
    const isPartial = isFrag || scopes.size > 0;

    // P02: target status.
    const status = statusOf(edge.to, nodesById);
    if (status !== undefined) {
      const validStatuses = isPartial ? ['superseded', 'partially-superseded'] : ['superseded'];
      if (!validStatuses.includes(status)) {
        const ev = edge.evidence[0];
        findings.push(makeFinding(
          'P02',
          ev.file,
          ev.line,
          `superseded target status is not superseded: "${edge.to}" is "${status}"`,
        ));
      }
    }

    // P03: every other edge citing the superseded part -- never another
    // `supersedes` edge, and never a self-reference: neither the target
    // doc's own edges (e.g. into its own fragments) nor any doc that itself
    // supersedes this same target (compared by doc path, not node id, so a
    // fragment-level self-citation is caught too).
    const targetDocPath = docPathOfSubject(edge.to);
    const excludedDocPaths = new Set([targetDocPath, ...(supersedersByTargetDoc.get(targetDocPath) ?? [])]);
    const notASelfCiter = (e) => e.relation !== 'supersedes' && !excludedDocPaths.has(docPathOfSubject(e.from));

    if (isPartial) {
      // Fragment or scoped-doc target: only an edge into that exact node counts.
      const citers = (edgesByTo.get(edge.to) ?? []).filter(notASelfCiter);
      if (isFrag) {
        for (const citer of citers) {
          for (const ev of citer.evidence) {
            findings.push(makeFinding('P03', ev.file, ev.line, `doc cites a superseded part: "${edge.to}"`));
          }
        }
      } else {
        // Scoped doc target: only the citer's own evidence carrying a matching scope.
        for (const citer of citers) {
          for (const ev of citer.evidence) {
            if (isScope(ev.scope) && scopes.has(ev.scope)) {
              findings.push(makeFinding(
                'P03',
                ev.file,
                ev.line,
                `doc cites a superseded part: "${edge.to}" (scope "${ev.scope}")`,
              ));
            }
          }
        }
      }
    } else {
      // Full-doc supersession: every edge into X or any of X's fragments counts.
      const citers = (edgesByToDocPath.get(targetDocPath) ?? []).filter(notASelfCiter);
      for (const citer of citers) {
        for (const ev of citer.evidence) {
          findings.push(makeFinding('P03', ev.file, ev.line, `doc cites a superseded part: "${edge.to}"`));
        }
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Satisfies (P04): an in-scope Requirement doc with no incoming `satisfies`.
// ---------------------------------------------------------------------------

function satisfiesFindings(graph, parsed) {
  const docsByPath = new Map(parsed.docs.map((d) => [d.path, d]));
  // A `satisfies` edge into a fragment of the Requirement doc satisfies the
  // whole doc (there's only one Requirement node per doc, at doc granularity).
  const satisfiedDocPaths = new Set(
    graph.edges.filter((e) => e.relation === 'satisfies').map((e) => docPathOfSubject(e.to)).filter((p) => p !== null),
  );

  const findings = [];
  for (const node of graph.nodes) {
    if (node.kind !== 'doc' || node.inScope !== true || node.metaType !== 'Requirement') continue;
    const path = node.id.slice(4);
    if (satisfiedDocPaths.has(path)) continue;
    const line = docsByPath.get(path)?.declaresLine ?? 1;
    findings.push(makeFinding('P04', path, line, `requirement nothing satisfies: "${node.id}"`));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Governs (P05): a governed node whose governor is superseded (not a
// partially-superseded one -- that governor may still validly govern).
// ---------------------------------------------------------------------------

function governsFindings(edges, nodesById) {
  const findings = [];
  for (const e of edges) {
    if (e.relation !== 'governs') continue;
    if (statusOf(e.from, nodesById) !== 'superseded') continue;
    for (const ev of e.evidence) {
      findings.push(makeFinding('P05', ev.file, ev.line, `governor is superseded: "${e.from}"`));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Contradicts (P08): always flagged, at the edge's first (smallest) evidence.
// ---------------------------------------------------------------------------

function contradictsFindings(edges) {
  const findings = [];
  for (const e of edges) {
    if (e.relation !== 'contradicts') continue;
    const ev = e.evidence[0];
    findings.push(makeFinding('P08', ev.file, ev.line, `contradiction: "${e.from}" vs "${e.to}"`));
  }
  return findings;
}

/**
 * Every relation-rule finding (P01-P08) over an already-built graph.
 * @param {object} params
 * @param {{nodes: object[], edges: object[]}} params.graph `buildGraph()`'s output.
 * @param {{docs: object[]}} params.parsed `parseAll()`'s output (for P04's `declaresLine`).
 * @returns {object[]} findings, sorted.
 */
export function lintGraph({ graph, parsed }) {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const findings = [
    ...cycleFindings(graph.edges, 'supersedes', 'P01'),
    ...supersedesFindings(graph.edges, nodesById),
    ...satisfiesFindings(graph, parsed),
    ...governsFindings(graph.edges, nodesById),
    ...cycleFindings(graph.edges, 'depends-on', 'P06'),
    ...cycleFindings(graph.edges, 'part-of', 'P07'),
    ...contradictsFindings(graph.edges),
  ];
  return sortFindings(findings);
}
