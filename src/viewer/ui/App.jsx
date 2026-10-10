import { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from 'react';
import { GraphPane } from './panes/GraphPane.jsx';
import { TreePane } from './panes/TreePane.jsx';
import { idToHash, openPageId } from './lib/hash.mjs';
import { initialState, reducer } from './lib/state.mjs';
import { ancestorsOf, buildTree } from './lib/tree.mjs';
import { buildGraphModel, edgeCaption, legendOf } from './lib/graph-model.mjs';
import { STRINGS } from './lib/strings.mjs';

const EMPTY_WIKI = { nodes: [], edges: [], schema: { entityTypes: [] } };

function subscribeHash(cb) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}
const getHash = () => window.location.hash;

export function App() {
  const [load, setLoad] = useState({ status: 'loading', wiki: null });
  const [state, dispatch] = useReducer(reducer, initialState);
  const hash = useSyncExternalStore(subscribeHash, getHash);

  useEffect(() => {
    let live = true;
    fetch('/api/wiki', { signal: AbortSignal.timeout(15000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((w) => {
        const ok = Array.isArray(w?.nodes) && Array.isArray(w?.edges) && Array.isArray(w?.schema?.entityTypes);
        if (!ok) throw new Error('bad body');
        if (live) setLoad({ status: 'ready', wiki: w });
      })
      .catch(() => live && setLoad({ status: 'failed', wiki: null }));
    return () => { live = false; };
  }, []);

  const wiki = load.wiki ?? EMPTY_WIKI;
  const model = useMemo(() => buildGraphModel(wiki), [wiki]);
  const tree = useMemo(() => buildTree(wiki.nodes, wiki.schema.entityTypes), [wiki]);
  const titles = useMemo(() => new Map(wiki.nodes.map((n) => [n.id, n.title])), [wiki]);
  const pageIds = useMemo(() => new Set(wiki.nodes.filter((n) => n.kind === 'page').map((n) => n.id)), [wiki]);

  const openId = openPageId(hash, pageIds);
  const legend = useMemo(() => legendOf(model, wiki.schema.entityTypes), [model, wiki]);

  useEffect(() => {
    if (openId !== null) dispatch({ type: 'openFolders', paths: ancestorsOf(openId) });
  }, [openId]);

  if (load.status === 'loading') return <div className="app"><p className="status" role="status">{STRINGS.loading}</p></div>;
  if (load.status === 'failed') {
    return (
      <div className="notice" role="alert">
        <p>{STRINGS.loadFailed}</p>
        <p className="notice-hint">{STRINGS.loadFailedHint}</p>
        <button type="button" className="notice-button" onClick={() => window.location.reload()}>{STRINGS.reload}</button>
      </div>
    );
  }

  const onOpen = (id) => {
    if (id === openId) dispatch({ type: 'openFolders', paths: ancestorsOf(id) });
    window.location.hash = idToHash(id);
  };
  const link = state.selectedEdge === null ? null : model.links.find((l) => l.key === state.selectedEdge);
  const titleOf = (id) => titles.get(id) ?? id;

  return (
    <div className="app">
      <GraphPane
        model={model}
        legend={legend}
        openId={openId}
        selectedEdge={state.selectedEdge}
        onOpen={onOpen}
        onSelectEdge={(key) => dispatch({ type: 'selectEdge', key })}
        onClearEdge={() => dispatch({ type: 'clearEdge' })}
      >
        {link && (
          <div className="caption" role="status" aria-label={STRINGS.captionLabel}>
            <span className="caption-text">{edgeCaption(link, titleOf)}</span>
            <button type="button" className="caption-close" aria-label={STRINGS.closeCaption} onClick={() => dispatch({ type: 'clearEdge' })}>{STRINGS.closeGlyph}</button>
          </div>
        )}
      </GraphPane>
      <TreePane
        tree={tree}
        openId={openId}
        collapsed={state.collapsed}
        onToggle={(path) => dispatch({ type: 'toggleFolder', path })}
        onOpen={onOpen}
      />
    </div>
  );
}
