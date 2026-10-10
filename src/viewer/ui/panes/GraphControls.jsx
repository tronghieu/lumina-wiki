import { useMemo, useRef } from 'react';
import { STRINGS } from '../lib/strings.mjs';
import { legendEntries, suggest } from '../lib/query.mjs';

const KEY_HINT = { 'type:': STRINGS.suggestType, 'rel:': STRINGS.suggestRel, 'conf:': STRINGS.suggestConf };
const SWATCH = { fill: '', hollow: ' is-hollow', missing: ' is-hollow is-missing' };
const DEPTHS = ['1', '2', '3'];

// Stateless: the filter text and switches arrive as props; every change leaves through dispatch.
export function GraphControls({ vocabulary, legend, filter, showOrphans, hops, canUseDepth, matched, total, dispatch }) {
  const input = useRef(null);
  const list = useRef(null);
  const suggestions = useMemo(() => suggest(filter, vocabulary), [filter, vocabulary]);
  const entries = useMemo(() => legendEntries(legend, filter), [legend, filter]);
  if (total === 0) return null;

  const setFilter = (value) => dispatch({ type: 'setFilter', value });
  const clearAll = () => {
    setFilter('');
    dispatch({ type: 'setShowOrphans', value: true });
    dispatch({ type: 'setHops', value: null });
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
      <div className="filter-switches">
        <label className="control-item" title={STRINGS.orphansHint}>
          <input
            type="checkbox"
            checked={showOrphans}
            onChange={(e) => dispatch({ type: 'setShowOrphans', value: e.target.checked })}
          />{' '}
          <span className="control-label">{STRINGS.orphansLabel}</span>
        </label>
        {canUseDepth && (
          <label className="control-select">
            <span className="control-label">{STRINGS.depthLabel}</span>{' '}
            <select
              value={hops == null ? '' : String(hops)}
              onChange={(e) => dispatch({ type: 'setHops', value: e.target.value === '' ? null : Number(e.target.value) })}
            >
              <option value="">{STRINGS.depthAll}</option>
              {DEPTHS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
        )}
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
                  className={`legend-swatch${SWATCH[e.variant] || ''}`}
                  style={e.variant === 'fill' ? { background: e.color } : undefined}
                />{' '}
                {e.label}
              </button>
            </li>
          ))}
        </ul>
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
