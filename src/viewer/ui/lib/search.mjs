// Title and slug search over the in-memory page nodes. Pure: no DOM, no requests.
// Rank, lower is better, a page takes its best: 0 title starts with the query;
// 1 query starts a word in the title; 2 query starts the slug or a word in it;
// 3 query appears anywhere in title or slug. Ties: title (collator), then id.
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const LETTERS = {
  '\u0111': 'd', '\u0142': 'l', '\u00f8': 'o', '\u00df': 'ss', '\u00e6': 'ae', '\u0153': 'oe',
  '\u0131': 'i', '\u0127': 'h', '\u00f0': 'd', '\u00fe': 'th', '\u0167': 't',
};

// Matching text: no case, no Latin diacritics, ligatures and stroked letters flattened, one space between words.
// Only Latin-range combining marks are stripped: in kana, Thai and Devanagari marks change the word.
export function fold(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u0111\u0142\u00f8\u00df\u00e6\u0153\u0131\u0127\u00f0\u00fe\u0167]/g, (c) => LETTERS[c])
    .replace(/\s+/g, ' ')
    .trim();
}

// Punctuation becomes a word break, so "Low-Rank (LoRA)" matches "low rank".
// Marks are kept so voiced kana, Thai tones and Devanagari signs still tell words apart.
// Folding first drops Latin marks and keeps decomposed text (macOS file names) whole.
export const foldWords = (text) => fold(fold(text).replace(/[^\p{L}\p{N}\p{M}]+/gu, ' '));

function rank(node, q) {
  const t = foldWords(node.title ?? '');
  const s = foldWords(node.id.slice(node.id.lastIndexOf('/') + 1));
  if (t.startsWith(q)) return 0;
  if ((' ' + t).includes(' ' + q)) return 1;
  if ((' ' + s).includes(' ' + q)) return 2;
  return t.includes(q) || s.includes(q) ? 3 : 4;
}

export function searchPages(nodes, query, limit = 20) {
  const q = foldWords(query);
  if (!q) return { results: [], total: 0 };
  const hits = nodes
    .filter((n) => n.kind === 'page')
    .map((n) => ({ n, r: rank(n, q) }))
    .filter((x) => x.r < 4)
    .sort(
      (a, b) =>
        a.r - b.r ||
        collator.compare(a.n.title ?? '', b.n.title ?? '') ||
        (a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0),
    );
  return {
    results: hits.slice(0, limit).map(({ n }) => ({ id: n.id, title: n.title, type: n.type })),
    total: hits.length,
  };
}
