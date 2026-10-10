// Presents the communities the server already detected: palette, colors, and member lists.
// Members sort with one fixed-locale collator so every machine agrees; ties break by id.

// Ten distinct hues for community coloring, cycled past ten.
export const COMMUNITY_PALETTE = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];

import { NEUTRAL } from './graph-model.mjs';

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Palette color for a community index, or null when the index is not a non-negative integer. */
export function communityColor(index) {
  return Number.isInteger(index) && index >= 0 ? COMMUNITY_PALETTE[index % COMMUNITY_PALETTE.length] : null;
}

/** Node fill: type color, or the community color for page nodes in community mode. */
export function nodeFill(node, mode) {
  if (mode !== 'community' || node.kind !== 'page') return node.color;
  return Number.isInteger(node.community) ? communityColor(node.community) : NEUTRAL;
}

/** One entry per community, in the order sent, with its page members. Bad input yields fewer entries, never a throw. */
export function communityList(wiki) {
  const nodes = wiki.nodes || [];
  if (!Array.isArray(wiki.communities)) return [];
  const out = [];
  wiki.communities.forEach((c, index) => {
    if (!c || typeof c !== 'object') return;
    const { name, size } = c;
    out.push({
      index,
      name,
      title: nodes.find((n) => n.id === name)?.title ?? name,
      size,
      color: communityColor(index),
      members: nodes
        .filter((n) => n.kind === 'page' && n.community === index)
        .map((n) => ({ id: n.id, title: typeof n.title === 'string' ? n.title : n.id }))
        .sort((a, b) => collator.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    });
  });
  return out;
}
