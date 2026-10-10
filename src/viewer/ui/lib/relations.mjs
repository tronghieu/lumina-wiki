// Pure helpers for the reader pane. No imports, no DOM: runs in the bundle and under node --test.

const DIR_ORDER = { out: 0, in: 1, both: 2 };
const MAX_TEXT = 200;

// Same fixed-locale collator as the page tree, so titles order identically in both places.
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Groups the edges touching `id` by (type, direction); the other end is the item. */
export function relationsOf(wiki, id) {
  const byNode = new Map((wiki.nodes ?? []).map((n) => [n.id, n]));
  const groups = new Map();
  for (const e of wiki.edges ?? []) {
    if (e.from !== id && e.to !== id) continue;
    // A directed self-loop falls into the `from === id` branch, so it is listed once under 'out'.
    const direction = !e.directed ? 'both' : e.from === id ? 'out' : 'in';
    const otherId = e.from === id ? e.to : e.from;
    const node = byNode.get(otherId);
    const key = `${e.type}\0${direction}`;
    if (!groups.has(key)) groups.set(key, { type: e.type, direction, items: [] });
    groups.get(key).items.push({
      id: otherId,
      kind: node ? node.kind : 'missing',
      title: node ? node.title : otherId,
      confidence: e.confidence,
    });
  }
  for (const g of groups.values()) {
    g.items.sort((a, b) => collator.compare(String(a.title), String(b.title)) || cmp(a.id, b.id));
  }
  return [...groups.values()].sort(
    (a, b) => cmp(a.type, b.type) || DIR_ORDER[a.direction] - DIR_ORDER[b.direction],
  );
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const isBlank = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && v.trim() === '');

/** Header rows: created, updated, then the required keys of the page's entity type. */
export function headerFields(page, entityTypes) {
  const fm = page.frontmatter ?? {};
  const required = (entityTypes ?? []).find((t) => t.name === page.type)?.required ?? [];
  const keys = [...new Set(['created', 'updated', ...required])];
  const out = [];
  for (const key of keys) {
    if (key === 'title' || !Object.prototype.hasOwnProperty.call(fm, key) || isBlank(fm[key])) continue;
    const text = textOf(fm[key]);
    // Cutting between the halves of a surrogate pair would leave a lone surrogate.
    const cut = /[\uD800-\uDBFF]/.test(text[MAX_TEXT - 1]) ? MAX_TEXT - 1 : MAX_TEXT;
    out.push({ key, text: text.length > MAX_TEXT ? `${text.slice(0, cut)}...` : text });
  }
  return out;
}
