// Parses the graph filter box and offers completions. Pure: no DOM, no React.
import { fold } from './search.mjs';

const KEYS = ['type', 'rel', 'conf'];
// Whitespace splits terms; a double-quoted run is part of one term; an unclosed quote runs on.
// Quotes stay in the raw term so edits can put the text back untouched.
function tokenize(text) {
  const terms = [];
  let cur = '';
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') { quoted = !quoted; cur += ch; }
    else if (!quoted && /\s/.test(ch)) { terms.push(cur); cur = ''; }
    else cur += ch;
  }
  terms.push(cur);
  return terms.filter(Boolean);
}

// One raw term -> { key, value, exclude }, or null when it filters nothing.
// A bare "-" or "-" plus the start of a key is an exclusion still being typed.
function parseTerm(raw) {
  const s = raw.replace(/"/g, '');
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  if (neg && KEYS.some((k) => k.startsWith(body.toLowerCase()))) return null;
  const m = /^(type|rel|conf):(.*)$/is.exec(body);
  const value = fold(m ? m[2] : s);
  if (!value) return null;
  return { key: m ? m[1].toLowerCase() : null, value, exclude: neg && !!m };
}

export function parseFilter(text) {
  const out = { words: [], include: { type: [], rel: [], conf: [] }, exclude: { type: [], rel: [], conf: [] } };
  for (const raw of tokenize(typeof text === 'string' ? text : '')) {
    const t = parseTerm(raw);
    if (!t) continue;
    if (t.key) out[t.exclude ? 'exclude' : 'include'][t.key].push(t.value);
    else out.words.push(t.value);
  }
  return out;
}

export function matchValue(value, name) {
  const v = fold(value);
  return v !== '' && fold(name).startsWith(v);
}

export function toggleTerm(text, term) {
  const terms = text.split(/\s+/).filter(Boolean);
  const kept = terms.filter((t) => t.toLowerCase() !== term.toLowerCase());
  return (kept.length === terms.length ? [...terms, term] : kept).join(' ');
}

// Exact names beat prefixes, so "authored" selects one kind and "auth" selects both.
export function resolveValues(values, names) {
  const out = new Set();
  for (const v of values) {
    const f = fold(v);
    if (!f) continue;
    const exact = names.filter((n) => fold(n) === f);
    for (const n of exact.length ? exact : names.filter((n2) => fold(n2).startsWith(f))) out.add(n);
  }
  return out;
}

export function removeTerms(text, predicate) {
  return tokenize(typeof text === 'string' ? text : '')
    .filter((raw) => {
      const t = parseTerm(raw);
      return !(t && predicate(t));
    })
    .join(' ');
}

// One legend button per node kind; `next` is the filter text after a click.
export function legendEntries(legend, text) {
  const q = parseFilter(text);
  const kinds = legend.map((e) => e.key.replace(/^type:/, ''));
  const inc = resolveValues(q.include.type, kinds);
  const exc = resolveValues(q.exclude.type, kinds);
  return legend.map((e, i) => {
    const kind = kinds[i];
    const picked = inc.has(kind);
    const excluded = exc.has(kind);
    const off = excluded || (q.include.type.length > 0 && !picked);
    const next = picked || excluded
      ? removeTerms(text, (t) => t.key === 'type' && t.exclude === excluded && resolveValues([t.value], kinds).has(kind))
      : `${(text ?? '').trim()} type:${kind}`.trim();
    return { ...e, kind, picked, off, next };
  });
}

export function suggest(text, vocabulary) {
  const term = /\S*$/.exec(text)[0];
  const head = text.slice(0, text.length - term.length);
  // A term inside an open quote is a phrase, not a key or value.
  if ((head.match(/"/g) ?? []).length % 2) return [];
  const sign = term.startsWith('-') ? '-' : '';
  const body = term.slice(sign.length);
  const colon = body.indexOf(':');
  if (colon < 0) {
    const lower = body.toLowerCase();
    return KEYS.filter((k) => k.startsWith(lower)).map((k) => ({ label: `${k}:`, text: `${head}${sign}${k}:` }));
  }
  const key = body.slice(0, colon).toLowerCase();
  if (!KEYS.includes(key)) return [];
  const partial = body.slice(colon + 1).replace(/"/g, '');
  const present = parseFilter(head)[sign ? 'exclude' : 'include'][key];
  return (vocabulary?.[key] ?? [])
    // A value already typed in full needs no suggestion.
    .filter((v) => (partial === '' || matchValue(partial, v)) && fold(v) !== fold(partial) && !present.includes(fold(v)))
    .map((v) => {
      const shown = /\s/.test(v) ? `"${v}"` : v;
      return { label: `${key}:${v}`, text: `${head}${sign}${key}:${shown} ` };
    });
}
