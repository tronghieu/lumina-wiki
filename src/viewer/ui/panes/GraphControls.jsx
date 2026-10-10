import { useMemo, useRef } from 'react';
import { STRINGS } from '../lib/strings.mjs';
import { legendEntries, suggest } from '../lib/query.mjs';
import { idToHash } from '../lib/hash.mjs';

const KEY_HINT = { 'type:': STRINGS.suggestType, 'rel:': STRINGS.suggestRel, 'conf:': STRINGS.suggestConf };
const SWATCH = { fill: '', hollow: ' is-hollow', missing: ' is-hollow is-missing' };

// Stateless: the filter text and switches arrive as props; every change leaves through dispatch.
export function GraphControls({ vocabulary, legend, filter, showOrphans, matched, total, colorMode, communities, lint, showLint, dispatch }) {
  const input = useRef(null);
  const list = useRef(null);
  const suggestions = useMemo(() => suggest(filter, vocabulary), [filter, vocabulary]);
  const entries = useMemo(() => legendEntries(legend, filter), [legend, filter]);
  if (total === 0) return null;

  const setFilter = (value) => dispatch({ type: 'setFilter', value });
  const clearAll = () => {
    setFilter('');
    dispatch({ type: 'setShowOrphans', value: true });
    // The clear button unmounts with the note; focus must not fall to the page body.
    input.current?.focus();
  };
  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      if (filter !== '') setFilter('');
      else input.current?.blur();
    } else if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      list.current?.querySelector('button')?.focus();
    }
  };

  return (
    <div className="controls">
      <div className="filter">
        <input
          ref={input}
          type="search"
          className="filter-input"
          aria-label={STRINGS.filterLabel}
          placeholder={STRINGS.filterPlaceholder}
          value={filter}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {suggestions.length > 0 && (
          <ul className="filter-suggestions" ref={list}>
            {suggestions.map((s) => (
              <li key={s.text}>
                <button
                  type="button"
                  className="filter-suggestion"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setFilter(s.text);
                    input.current?.focus();
                  }}
                >
                  {s.label}
                  {KEY_HINT[s.label] && <span className="filter-suggestion-hint">{KEY_HINT[s.label]}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="control-row">
        <label className="control-item" title={STRINGS.orphansHint}>
          <input
            type="checkbox"
            checked={showOrphans}
            onChange={(e) => dispatch({ type: 'setShowOrphans', value: e.target.checked })}
          />{' '}
          <span className="control-label">{STRINGS.orphansLabel}</span>
        </label>
        <label className="control-item" title={STRINGS.lintHint}>
          <input
            type="checkbox"
            checked={showLint && lint.status === 'ready'}
            disabled={lint.status !== 'ready'}
            onChange={(e) => dispatch({ type: 'setShowLint', value: e.target.checked })}
          />{' '}
          <span className="control-label">{STRINGS.lintToggle}</span>
        </label>
        <span className="lint-summary" role="status">
          {lint.status === 'loading' && STRINGS.lintLoading}
          {lint.status === 'ready' && lint.total === 0 && STRINGS.lintNone}
          {lint.status === 'ready' && lint.total > 0 && (
            <>
              <span className="lint-count is-error">{`${STRINGS.lintErrors} ${lint.summary.errors}`}</span>{' '}
              <span className="lint-count is-warning">{`${STRINGS.lintWarnings} ${lint.summary.warnings}`}</span>{' '}
              <span className="lint-count is-info">{`${STRINGS.lintInfo} ${lint.summary.info}`}</span>
            </>
          )}
        </span>
      </div>
      {lint.status === 'failed' && <p className="status lint-failed" role="status">{STRINGS.lintFailed}</p>}
      <div className="control-row">
        <label className="control-select" title={STRINGS.colorHint}>
          <span className="control-label">{STRINGS.colorLabel}</span>{' '}
          <select value={colorMode} onChange={(e) => dispatch({ type: 'setColorMode', value: e.target.value })}>
            <option value="type">{STRINGS.colorByType}</option>
            <option value="community">{STRINGS.colorByCommunity}</option>
          </select>
        </label>
      </div>
      {entries.length > 0 && (
        <ul className="legend-list" aria-label={STRINGS.legendLabel}>
          {entries.map((e) => (
            <li key={e.key}>
              <button
                type="button"
                className={`legend-entry${e.off ? ' is-off' : ''}`}
                aria-pressed={e.picked}
                onClick={() => setFilter(e.next)}
              >
                <span
                  className={`legend-swatch${SWATCH[e.variant] || ''}${e.variant === 'fill' && colorMode === 'community' ? ' is-plain' : ''}`}
                  style={e.variant === 'fill' && colorMode !== 'community' ? { background: e.color } : undefined}
                />{' '}
                {e.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {colorMode === 'community' && communities.length > 0 && (
        <div className="communities" role="group" aria-label={STRINGS.communitiesLabel}>
          {communities.map((c) => (
            <details className="community" key={c.index}>
              <summary>
                <span className="legend-swatch" style={{ background: c.color }} />
                <span className="community-title">{c.title}</span>
                <span className="community-size">{c.size}</span>
              </summary>
              <ul className="community-members">
                {c.members.map((m) => (
                  <li key={m.id}><a href={idToHash(m.id)}>{m.title}</a></li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
      {matched === 0 && total > 0 && (
        <p className="status filter-empty" role="status">
          {STRINGS.filterNoMatch}{' '}
          <button type="button" className="filter-clear" onClick={clearAll}>{STRINGS.filterClear}</button>
        </p>
      )}
    </div>
  );
}
