// Single owner of the viewer's view settings. Later features add fields and actions here.

export const initialState = Object.freeze({ collapsed: Object.freeze({}), selectedEdge: null });

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
    case 'selectEdge':
      return state.selectedEdge === action.key ? state : { ...state, selectedEdge: action.key };
    case 'clearEdge':
      return state.selectedEdge === null ? state : { ...state, selectedEdge: null };
    default:
      return state;
  }
}
