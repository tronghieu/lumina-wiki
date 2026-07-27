export type ArtifactView = 'graph' | 'note';
export type SemanticFocus = 'chat' | 'note' | 'graph';
export type ResponsivePanelMode = 'desktop' | 'medium' | 'narrow';

export function resolveArtifactView(requestedView: ArtifactView, selectedNodeId: string): ArtifactView {
  return requestedView === 'note' && !selectedNodeId ? 'graph' : requestedView;
}

export function resolveSemanticFocus(
  requestedFocus: SemanticFocus,
  selectedNodeId: string,
): SemanticFocus {
  return requestedFocus === 'note' && !selectedNodeId ? 'graph' : requestedFocus;
}

export function resolveResponsivePanels(width: number): {
  mode: ResponsivePanelMode;
  treeInitiallyOpen: boolean;
  agentInitiallyOpen: boolean;
} {
  if (width > 1180) {
    return { mode: 'desktop', treeInitiallyOpen: true, agentInitiallyOpen: true };
  }
  if (width > 760) {
    return { mode: 'medium', treeInitiallyOpen: false, agentInitiallyOpen: false };
  }
  return { mode: 'narrow', treeInitiallyOpen: false, agentInitiallyOpen: false };
}
