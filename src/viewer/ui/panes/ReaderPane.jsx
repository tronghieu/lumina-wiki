import { useEffect, useMemo, useRef, useState } from 'react';
import { STRINGS } from '../lib/strings.mjs';
import { renderPage } from '../lib/render.mjs';
import { relationsOf, headerFields } from '../lib/relations.mjs';
import { idToHash } from '../lib/hash.mjs';
import { typeColor } from '../lib/graph-model.mjs';
import { urlNodeHref } from '../lib/links.mjs';
import { FindingList } from './FindingList.jsx';

const DIRECTION = { out: STRINGS.directionOut, in: STRINGS.directionIn, both: STRINGS.directionBoth };

function RelationItem({ item }) {
  let link;
  if (item.kind === 'page') {
    link = <a className="relation-link" href={idToHash(item.id)}>{item.title}</a>;
  } else if (item.kind === 'url') {
    const href = urlNodeHref(item.id);
    link = href !== null
      ? <a className="relation-link is-external" href={href} target="_blank" rel="noopener noreferrer">{item.title}</a>
      : <span className="relation-missing">{item.title}</span>;
  } else {
    link = <span className="relation-missing">{item.title}</span>;
  }
  return (
    <li>
      {link}
      {item.kind === 'url' && link.type === 'a' && <> <span className="relation-note">{STRINGS.externalSuffix}</span></>}
      {link.type === 'span' && <> <span className="relation-note">{STRINGS.missingSuffix}</span></>}
      {item.confidence !== null && item.confidence !== undefined && (
        <> <span className="relation-confidence">{STRINGS.confidenceLabel}: {item.confidence}</span></>
      )}
    </li>
  );
}

export function ReaderPane({ id, wiki, onClose, findings = [] }) {
  const [state, setState] = useState({ status: 'loading', page: null });
  const [attempt, setAttempt] = useState(0);
  const rootRef = useRef(null);

  useEffect(() => {
    const ctl = new AbortController();
    setState({ status: 'loading', page: null });
    const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(15000)]);
    fetch('/api/page?id=' + encodeURIComponent(id), { signal })
      .then(async (res) => {
        if (res.status === 404) return setState({ status: 'notFound', page: null });
        if (!res.ok) return setState({ status: 'failed', page: null });
        const p = await res.json();
        const valid = p && typeof p === 'object' && typeof p.id === 'string'
          && typeof p.title === 'string' && typeof p.body === 'string';
        setState(valid ? { status: 'ready', page: p } : { status: 'failed', page: null });
      })
      .catch(() => {
        // Cleanup aborts are silent; a timeout or network error is a failed load.
        if (!ctl.signal.aborted) setState({ status: 'failed', page: null });
      });
    return () => ctl.abort();
  }, [id, attempt]);

  const { status, page } = state;
  useEffect(() => {
    if (status !== 'ready' || !rootRef.current) return;
    rootRef.current.scrollTop = 0;
    // Following a link destroys the focused element; keep focus inside the pane.
    rootRef.current.focus({ preventScroll: true });
  }, [page]);

  const html = useMemo(() => {
    if (!page) return '';
    try {
      return renderPage(page.body, page.links, wiki.schema.wikilinkPattern);
    } catch {
      return null;
    }
  }, [page, wiki.schema.wikilinkPattern]);
  const failed = status === 'failed' || (status === 'ready' && html === null);
  const fields = page ? headerFields(page, wiki.schema.entityTypes) : [];
  const groups = page ? relationsOf(wiki, page.id) : [];

  // Broken pages are the ones most likely to have findings, so every non-loading state shows them.
  const findingsSection = findings.length > 0 && (
    <section className="reader-findings" aria-labelledby="reader-findings-title">
      <h2 id="reader-findings-title" className="relations-title">{STRINGS.findingsTitle}</h2>
      <FindingList findings={findings} />
    </section>
  );

  return (
    <section className="pane pane-reader" ref={rootRef} aria-label={STRINGS.readerLabel} tabIndex={-1}>
      <button type="button" className="reader-close" aria-label={STRINGS.closeReader} onClick={onClose}>{STRINGS.closeGlyph}</button>
      {status === 'loading' && <p className="status" role="status">{STRINGS.pageLoading}</p>}
      {status === 'notFound' && (
        <>
          <p className="status" role="status">{STRINGS.pageNotFound}</p>
          <p className="reader-id">{id}</p>
        </>
      )}
      {failed && (
        <>
          <p className="status" role="alert">{STRINGS.pageFailed}</p>
          <button type="button" className="reader-retry" onClick={() => setAttempt((n) => n + 1)}>{STRINGS.retry}</button>
        </>
      )}
      {status === 'ready' && !failed && (
        <>
          <header className="reader-header">
            <h1 className="reader-title">{page.title}</h1>
            {page.type !== null && (
              <span className="reader-type" style={{ color: typeColor(page.type, wiki.schema.entityTypes) }}>{page.type}</span>
            )}
            {fields.length > 0 && (
              <dl className="reader-fields">
                {fields.map((f) => (
                  <div key={f.key} className="reader-field">
                    <dt>{f.key}</dt>
                    <dd>{f.text}</dd>
                  </div>
                ))}
              </dl>
            )}
          </header>
          {/* The only element the client's own code injects HTML into; the string comes from renderPage alone. */}
          <article className="reader-body" dangerouslySetInnerHTML={{ __html: html }} />
          {groups.length > 0 && (
            <nav className="reader-relations">
              <h2 className="relations-title">{STRINGS.relationsTitle}</h2>
              {groups.map((g) => (
                <section className="relation-group" key={`${g.type}/${g.direction}`}>
                  <h3 className="relation-type">
                    {g.type} <span className="relation-direction">{DIRECTION[g.direction]}</span>
                  </h3>
                  <ul className="relation-list">
                    {g.items.map((item) => (
                      <RelationItem key={`${g.type}/${g.direction}/${item.id}`} item={item} />
                    ))}
                  </ul>
                </section>
              ))}
            </nav>
          )}
        </>
      )}
      {status !== 'loading' && findingsSection}
    </section>
  );
}
