import { STRINGS } from './strings.mjs';
import { escapeHtml } from './escape.mjs';

// Mostly Catppuccin Mocha accents (MIT); red is left out because it marks a missing page.
// Entity type N takes entry N, cycled.
export const TYPE_PALETTE = [
  '#fab387', '#a6e3a1', '#cba6f7', '#89b4fa', '#f9e2af', '#94e2d5',
  '#f5c2e7', '#74c7ec', '#b4befe', '#c8a27c', '#c3d982', '#eba0ac',
];
export const NEUTRAL = '#6c7086';

export function typeColor(typeName, entityTypes) {
  const i = typeName === null ? -1 : entityTypes.findIndex((t) => t.name === typeName);
  return i < 0 ? NEUTRAL : TYPE_PALETTE[i % TYPE_PALETTE.length];
}

// Parallel links and loops get distinct bends so none hides another.
function assignCurvature(links) {
  const groups = new Map();
  for (const l of links) {
    const k = l.source === l.target ? `loop\0${l.source}`
      : l.source < l.target ? `${l.source}\0${l.target}` : `${l.target}\0${l.source}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(l);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const n = group.length;
    group.forEach((l, i) => {
      if (l.source === l.target) l.curvature = 0.6 + 0.4 * i;
      else if (n === 1) l.curvature = 0;
      else {
        const offset = (i - (n - 1) / 2) * 0.3;
        l.curvature = (l.source < l.target ? offset : -offset) + 0; // + 0 turns -0 into 0 so equality checks hold
      }
    });
  }
}

export function buildGraphModel(wiki) {
  const ids = new Set(wiki.nodes.map((n) => n.id));
  const links = [];
  const touched = new Set();
  const degree = new Map();
  const nb = new Map();
  const bump = (id) => degree.set(id, (degree.get(id) || 0) + 1);
  for (const e of wiki.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    links.push({
      key: `${e.from}\0${e.type}\0${e.to}`,
      source: e.from,
      target: e.to,
      type: e.type,
      directed: e.directed !== false,
      confidence: e.confidence ?? null,
      citation: e.type === 'cites',
      curvature: 0,
    });
    touched.add(e.from).add(e.to);
    bump(e.from);
    if (e.to !== e.from) bump(e.to);
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (a === b) continue;
      if (!nb.has(a)) nb.set(a, new Set());
      nb.get(a).add(b);
    }
  }
  assignCurvature(links);
  const keep = wiki.nodes.filter((n) => touched.has(n.id) || (n.kind === 'page' && n.type !== null));
  const neighbors = new Map();
  const nodes = keep.map((n) => {
    const d = degree.get(n.id) || 0;
    degree.set(n.id, d);
    neighbors.set(n.id, nb.get(n.id) || new Set());
    return {
      id: n.id, kind: n.kind, type: n.type, title: n.title, community: n.community,
      color: n.kind === 'page' ? typeColor(n.type, wiki.schema.entityTypes) : NEUTRAL,
      val: 1 + Math.sqrt(d),
    };
  });
  return { nodes, links, neighbors, degree };
}

export function nodeTooltip(node) {
  if (node.kind === 'missing') return `${node.title} (${STRINGS.missingSuffix})`;
  if (node.kind === 'url') return `${node.title} (${STRINGS.externalSuffix})`;
  return node.type === null ? node.title : `${node.title} (${node.type})`;
}

export function edgeCaption(link, titleOf) {
  const sep = link.directed ? '->' : '--';
  const base = `${titleOf(link.source)} ${sep} ${link.type} ${sep} ${titleOf(link.target)}`;
  return link.confidence === null ? base : `${base} (${STRINGS.confidenceLabel}: ${link.confidence})`;
}

export function nodeLabelHtml(node) {
  return escapeHtml(nodeTooltip(node));
}

export function linkLabelHtml(link) {
  return escapeHtml(link.confidence === null
    ? link.type : `${link.type} (${STRINGS.confidenceLabel}: ${link.confidence})`);
}

export function legendOf(model, entityTypes) {
  const pages = model.nodes.filter((n) => n.kind === 'page');
  const has = (kind) => model.nodes.some((n) => n.kind === kind);
  const out = entityTypes
    .filter((t) => pages.some((n) => n.type === t.name))
    .map((t) => ({ key: `type:${t.name}`, label: t.name, color: typeColor(t.name, entityTypes), variant: 'fill' }));
  if (pages.some((n) => n.type === null)) {
    out.push({ key: 'other', label: STRINGS.legendOther, color: NEUTRAL, variant: 'fill' });
  }
  if (has('url')) out.push({ key: 'url', label: STRINGS.legendUrl, color: NEUTRAL, variant: 'hollow' });
  if (has('missing')) out.push({ key: 'missing', label: STRINGS.legendMissing, color: null, variant: 'missing' });
  return out;
}
