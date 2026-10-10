import { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from 'react';
import { GraphPane } from './panes/GraphPane.jsx';
import { ReaderPane } from './panes/ReaderPane.jsx';
import { FindingList } from './panes/FindingList.jsx';
import { TreePane } from './panes/TreePane.jsx';
import { hashToId, idToHash, openPageId } from './lib/hash.mjs';
import { initialState, reducer } from './lib/state.mjs';
import { ancestorsOf, buildTree } from './lib/tree.mjs';
import { buildGraphModel, edgeCaption, legendOf, EMPTY_WIKI } from './lib/graph-model.mjs';
import { STRINGS } from './lib/strings.mjs';
import { vocabulary, visibleSets, selectedLink } from './lib/filter.mjs';
import { GraphControls } from './panes/GraphControls.jsx';
import { SearchBox } from './panes/SearchBox.jsx';
import { communityList } from './lib/communities.mjs';
import { findingsFor, LINT_LOADING, lintResult, ringsOf } from './lib/lint-marks.mjs';

const NO_COMMUNITIES = [];

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
        const ok = Array.isArray(w?.nodes) && Array.isArray(w?.edges) && Array.isArray(w?.schema?.entityTypes) && Array.isArray(w.schema.relationTypes) && typeof w.schema.wikilinkPattern === 'string';
        if (!ok) throw new Error('bad body');
        if (live) setLoad({ status: 'ready', wiki: w });
      })
      .catch(() => live && setLoad({ status: 'failed', wiki: null }));
    return () => { live = false; };
  }, []);

  // Lint is advisory and loads once after the wiki is on screen; a failure leaves everything else working.
  const [lint, setLint] = useState(LINT_LOADING);
  useEffect(() => {
    if (load.status !== 'ready') return undefined;
    let live = true;
    const done = (ok, body) => live && setLint(lintResult(ok, body));
    fetch('/api/lint', { signal: AbortSignal.timeout(30000) })
      .then((r) => r.json().then((body) => done(r.ok, body), () => done(false, null)))
      .catch(() => done(false, null));
    return () => { live = false; };
  }, [load.status]);

  const wiki = load.wiki ?? EMPTY_WIKI;
  const model = useMemo(() => buildGraphModel(wiki), [wiki]);
  const tree = useMemo(() => buildTree(wiki.nodes, wiki.schema.entityTypes), [wiki]);
  const titles = useMemo(() => new Map(wiki.nodes.map((n) => [n.id, n.title])), [wiki]);
  const pageIds = useMemo(() => new Set(wiki.nodes.filter((n) => n.kind === 'page').map((n) => n.id)), [wiki]);

  const openId = openPageId(hash, pageIds);
  const readerId = hashToId(hash);
  const legend = useMemo(() => legendOf(model, wiki.schema.entityTypes), [model, wiki]);
  const vocab = useMemo(() => vocabulary(model, wiki), [model, wiki]);
  const visible = useMemo(
    () => visibleSets(model, wiki, state, openId),
    [model, wiki, state.filter, state.showOrphans, openId],
  );
  const communities = useMemo(() => communityList(wiki), [wiki]);
  const lintReady = lint.status === 'ready';
  const lintRings = useMemo(
    () => ringsOf(lint.index, state.showLint && lintReady),
    [state.showLint, lintReady, lint.index],
  );
  const lintProp = useMemo(
    () => ({ status: lint.status, summary: lint.index.summary, total: lint.index.total, workspace: lint.index.workspace }),
    [lint],
  );
  const findings = useMemo(() => findingsFor(lint.index, readerId), [lint.index, readerId]);
  const footer = useMemo(
    () => (lintReady && lint.index.workspace.length > 0 ? (
      <details className="lint-workspace">
        <summary>{STRINGS.lintWorkspace} <span className="community-size">{lint.index.workspace.length}</span></summary>
        <FindingList findings={lint.index.workspace} showFile />
      </details>
    ) : null),
    [lintReady, lint.index],
  );

  // A selection the filter hides must not reappear when the filter relaxes.
  useEffect(() => {
    if (state.selectedEdge !== null && !visible.linkKeys.has(state.selectedEdge)) dispatch({ type: 'clearEdge' });
  }, [state.selectedEdge, visible]);

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
  const link = selectedLink(model, visible, state.selectedEdge);
  const titleOf = (id) => titles.get(id) ?? id;
  const onClose = () => { window.location.hash = ''; };

  return (
    <div className={readerId !== null ? 'app has-reader' : 'app'}>
      <GraphPane
        model={model}
        visible={visible}
        openId={openId}
        colorMode={state.colorMode}
        lintRings={lintRings}
        selectedEdge={state.selectedEdge}
        onOpen={onOpen}
        onSelectEdge={(key) => dispatch({ type: 'selectEdge', key })}
        onClearEdge={() => dispatch({ type: 'clearEdge' })}
      >
        <GraphControls
          vocabulary={vocab}
          legend={legend}
          colorMode={state.colorMode}
          communities={state.colorMode === 'community' ? communities : NO_COMMUNITIES}
          lint={lintProp}
          showLint={state.showLint}
          filter={state.filter}
          showOrphans={state.showOrphans}
          matched={visible.matchCount}
          total={model.nodes.length}
          dispatch={dispatch}
        />
        {link && (
          <div className="caption" role="status" aria-label={STRINGS.captionLabel}>
            <span className="caption-text">{edgeCaption(link, titleOf)}</span>
            <button type="button" className="caption-close" aria-label={STRINGS.closeCaption} onClick={() => dispatch({ type: 'clearEdge' })}>{STRINGS.closeGlyph}</button>
          </div>
        )}
      </GraphPane>
      {readerId !== null && <ReaderPane id={readerId} wiki={wiki} findings={findings} onClose={onClose} />}
      <TreePane
        tree={tree}
        openId={openId}
        collapsed={state.collapsed}
        marks={lintReady ? lint.index : null}
        onToggle={(path) => dispatch({ type: 'toggleFolder', path })}
        onOpen={onOpen}
        footer={footer}
      >
        <SearchBox nodes={wiki.nodes} query={state.query} onQuery={(value) => dispatch({ type: 'setQuery', value })} onOpen={onOpen} />
      </TreePane>
    </div>
  );
}
