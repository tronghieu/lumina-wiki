import { useEffect, useRef } from 'react';
import { STRINGS } from '../lib/strings.mjs';

// Renders one level of rows. Closed folders render no children.
function Rows({ rows, openId, collapsed, onToggle, onOpen, selectedRef, nested = false }) {
  return (
    <ul className={nested ? 'tree-list tree-children' : 'tree-list'}>
      {rows.map((row) => {
        if (row.kind === 'folder') {
          const closed = collapsed[row.path] === true;
          return (
            <li key={`f:${row.path}`}>
              <button
                type="button"
                className={closed ? 'tree-folder is-collapsed' : 'tree-folder'}
                aria-expanded={!closed}
                title={row.path}
                onClick={() => onToggle(row.path)}
              >
                {row.name}
              </button>
              {!closed && (
                <Rows
                  rows={row.children}
                  openId={openId}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  onOpen={onOpen}
                  selectedRef={selectedRef}
                  nested
                />
              )}
            </li>
          );
        }
        const selected = row.id === openId;
        return (
          <li key={`p:${row.id}`}>
            <button
              type="button"
              className={selected ? 'tree-page is-selected' : 'tree-page'}
              aria-current={selected ? 'page' : undefined}
              title={`${row.title} (${row.id})`}
              ref={selected ? selectedRef : undefined}
              onClick={() => onOpen(row.id)}
            >
              {row.title}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function TreePane({ tree, openId, collapsed, onToggle, onOpen, children }) {
  const selectedRef = useRef(null);
  const scrolledTo = useRef(null);

  // The page's folders may open one render after openId changes, so this also runs when
  // `collapsed` changes; it scrolls once per open page, never when the reader folds a folder.
  useEffect(() => {
    if (openId === null) scrolledTo.current = null;
    else if (scrolledTo.current !== openId && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'center' });
      scrolledTo.current = openId;
    }
  }, [openId, collapsed]);

  return (
    <aside className="pane pane-tree" aria-label={STRINGS.treeLabel}>
      <h2 className="tree-title">{STRINGS.treeTitle}</h2>
      {children}
      {tree.length === 0 ? (
        <p className="status">{STRINGS.treeEmpty}</p>
      ) : (
        <Rows
          rows={tree}
          openId={openId}
          collapsed={collapsed}
          onToggle={onToggle}
          onOpen={onOpen}
          selectedRef={selectedRef}
        />
      )}
    </aside>
  );
}
