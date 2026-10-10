// Pure sidebar model: no DOM, no imports, so it runs in the bundle and under node --test.
// Page titles in a folder sort with one fixed-locale collator (accent- and case-insensitive,
// numeric-aware), so any language orders sensibly. The locale is fixed so every machine agrees.
// Folder names, root page ids, and ties (by id) use plain `<` comparison.

const lt = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Folder paths containing a page id, outermost first. */
export function ancestorsOf(id) {
  const parts = id.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** Build the nested row tree from `/api/wiki` nodes and `schema.entityTypes`. */
export function buildTree(nodes, entityTypes) {
  const root = { children: [], folders: new Map() };
  for (const n of nodes) {
    if (n.kind !== 'page') continue;
    let dir = root;
    for (const path of ancestorsOf(n.id)) {
      let f = dir.folders.get(path);
      if (!f) {
        f = { kind: 'folder', path, name: path.slice(path.lastIndexOf('/') + 1), children: [], folders: new Map() };
        dir.folders.set(path, f);
      }
      dir = f;
    }
    dir.children.push({ kind: 'page', id: n.id, title: n.title });
  }
  const rank = new Map(entityTypes.map((t, i) => [t.name, i]));
  const finish = (dir, top) => {
    const folders = [...dir.folders.values()].map((f) => ({ ...f, children: finish(f, false) }));
    for (const f of folders) delete f.folders;
    const byName = (a, b) => lt(a.name, b.name);
    const pages = dir.children;
    if (top) {
      const typed = (f) => rank.has(f.name);
      return [
        ...pages.sort((a, b) => lt(a.id, b.id)),
        ...folders.filter(typed).sort((a, b) => rank.get(a.name) - rank.get(b.name)),
        ...folders.filter((f) => !typed(f)).sort(byName),
      ];
    }
    return [
      ...folders.sort(byName),
      ...pages.sort((a, b) => collator.compare(a.title, b.title) || lt(a.id, b.id)),
    ];
  };
  return finish(root, true);
}

/** Page ids in display order, depth first. */
export function flattenPages(tree) {
  return tree.flatMap((r) => (r.kind === 'page' ? [r.id] : flattenPages(r.children)));
}
