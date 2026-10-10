// Page ids map to URL hashes; every segment is escaped so ids with '#', '?' or '%' survive.
export function idToHash(id) {
  return '#/' + id.split('/').map(encodeURIComponent).join('/');
}

export function hashToId(hash) {
  if (typeof hash !== 'string' || !hash.startsWith('#/') || hash.length === 2) return null;
  try {
    return hash.slice(2).split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}

// A hash opens a page only when it names a real page; url: and missing: nodes open nothing.
export function openPageId(hash, pageIds) {
  const id = hashToId(hash);
  return id !== null && pageIds.has(id) ? id : null;
}
