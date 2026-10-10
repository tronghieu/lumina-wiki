// Single owner of the viewer's view settings. Later features add fields and actions here.

export const initialState = Object.freeze({
  collapsed: Object.freeze({}),
  selectedEdge: null,
  // Bucket key -> true when that bucket is hidden (e.g. 'node:type:sources', 'rel:cites', 'conf:low').
  hidden: Object.freeze({}),
  hideLonely: false,
  hops: null,
  query: '',
});

// Folder names come from wiki paths, so 'constructor' or '__proto__' must act like any other name.
const isClosed = (collapsed, path) => Object.hasOwn(collapsed, path) && collapsed[path] === true;
const OWN_TRUE = { value: true, enumerable: true, writable: true, configurable: true };

export function reducer(state, action) {
  switch (action.type) {
    case 'toggleFolder': {
      const collapsed = { ...state.collapsed };
      if (isClosed(state.collapsed, action.path)) delete collapsed[action.path];
      else Object.defineProperty(collapsed, action.path, OWN_TRUE);
      return { ...state, collapsed };
    }
    case 'openFolders': {
      if (!action.paths.some((p) => isClosed(state.collapsed, p))) return state;
      const collapsed = { ...state.collapsed };
      for (const p of action.paths) delete collapsed[p];
      return { ...state, collapsed };
    }
    case 'toggleHidden': {
      const hidden = { ...state.hidden };
      if (Object.hasOwn(state.hidden, action.key)) delete hidden[action.key];
      else Object.defineProperty(hidden, action.key, OWN_TRUE);
      return { ...state, hidden };
    }
    case 'setHideLonely': {
      const value = action.value === true;
      return state.hideLonely === value ? state : { ...state, hideLonely: value };
    }
    case 'setHops': {
      const value = action.value === 1 || action.value === 2 || action.value === 3 ? action.value : null;
      return state.hops === value ? state : { ...state, hops: value };
    }
    case 'setQuery': {
      const value = typeof action.value === 'string' ? action.value : '';
      return state.query === value ? state : { ...state, query: value };
    }
    case 'resetView': {
      if (Object.keys(state.hidden).length === 0 && !state.hideLonely && state.hops === null) return state;
      return { ...state, hidden: {}, hideLonely: false, hops: null };
    }
    case 'selectEdge':
      return state.selectedEdge === action.key ? state : { ...state, selectedEdge: action.key };
    case 'clearEdge':
      return state.selectedEdge === null ? state : { ...state, selectedEdge: null };
    default:
      return state;
  }
}
