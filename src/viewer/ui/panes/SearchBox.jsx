import { useMemo } from 'react';
import { STRINGS } from '../lib/strings.mjs';
import { searchPages } from '../lib/search.mjs';

// Controlled search field above the page tree. The query lives in the root reducer.
export function SearchBox({ nodes, query, onQuery, onOpen }) {
  const { results, total } = useMemo(() => searchPages(nodes, query), [nodes, query]);
  const active = query.trim() !== '';

  // Titles shown twice get their id, so the reader can tell the pages apart.
  const sharedTitles = useMemo(() => {
    const seen = new Set();
    const shared = new Set();
    for (const { title } of results) (seen.has(title) ? shared : seen).add(title);
    return shared;
  }, [results]);

  const onKeyDown = (e) => {
    // Enter while an input method is composing confirms the text, not the search.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && results.length > 0) onOpen(results[0].id);
    else if (e.key === 'Escape') onQuery('');
  };

  return (
    <div className="search" role="search">
      <input
        type="search"
        className="search-input"
        aria-label={STRINGS.searchLabel}
        placeholder={STRINGS.searchPlaceholder}
        value={query}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {active && results.length > 0 && (
        <ul className="search-results">
          {results.map(({ id, title, type }) => (
            <li key={id}>
              <button type="button" className="search-result" title={id} onClick={() => onOpen(id)}>
                {title}
                {type != null && <span className="search-result-type">{type}</span>}
                {sharedTitles.has(title) && <span className="search-result-id">{id}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {active && total > results.length && (
        <p className="status search-more" role="status">{STRINGS.searchMore}</p>
      )}
      {active && results.length === 0 && (
        <p className="status search-empty" role="status">{STRINGS.searchNoMatch}</p>
      )}
    </div>
  );
}
