// Single owner of the viewer's view settings. Later features add fields and actions here.

export const initialState = Object.freeze({
  collapsed: Object.freeze({}),
  selectedEdge: null,
  filter: '',
  showOrphans: true,
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
    case 'setFilter': {
      const value = typeof action.value === 'string' ? action.value : '';
      return state.filter === value ? state : { ...state, filter: value };
    }
    case 'setShowOrphans': {
      const value = action.value === true;
      return state.showOrphans === value ? state : { ...state, showOrphans: value };
    }
    case 'setHops': {
      const value = action.value === 1 || action.value === 2 || action.value === 3 ? action.value : null;
      return state.hops === value ? state : { ...state, hops: value };
    }
    case 'setQuery': {
      const value = typeof action.value === 'string' ? action.value : '';
      return state.query === value ? state : { ...state, query: value };
    }
    case 'selectEdge':
      return state.selectedEdge === action.key ? state : { ...state, selectedEdge: action.key };
    case 'clearEdge':
      return state.selectedEdge === null ? state : { ...state, selectedEdge: null };
    default:
      return state;
  }
}
