export type WorkspaceActionState = {
  kind: 'idle' | 'loading' | 'success' | 'error';
  title: string;
  message: string;
};

export type WorkspaceRequestGuard = {
  begin: () => number;
  isCurrent: (requestId: number) => boolean;
};

export const idleActionState: WorkspaceActionState = {
  kind: 'idle',
  title: 'Library ready',
  message: 'Choose a note or ask about this library.',
};

export const workspaceLoadCanceledState: WorkspaceActionState = {
  kind: 'idle',
  title: 'Library unchanged',
  message: 'Nothing was changed.',
};

export function libraryOpenedState(
  libraryLabel: string,
  notes: number,
  relationships: number,
): WorkspaceActionState {
  return {
    kind: 'success',
    title: 'Library ready',
    message: `${libraryLabel} · ${formatCount(notes, 'note')}, ${formatCount(relationships, 'relationship')}`,
  };
}

export function friendlyWorkspaceFailure(code: string): WorkspaceActionState {
  if (code === 'permission_denied') {
    return {
      kind: 'error',
      title: 'Permission needed',
      message: 'Lumina could not access that location. Choose another folder or update its permissions.',
    };
  }
  if (code === 'not_a_library') {
    return {
      kind: 'error',
      title: 'Library not recognized',
      message: 'Choose a folder created by Lumina or create a new library.',
    };
  }
  if (code === 'destination_in_use') {
    return {
      kind: 'error',
      title: 'Choose another location',
      message: 'That destination already contains files. Lumina did not change them.',
    };
  }
  return {
    kind: 'error',
    title: 'Library unavailable',
    message: 'Lumina could not finish that action. Your current library is unchanged.',
  };
}

export function createWorkspaceRequestGuard(): WorkspaceRequestGuard {
  let currentRequestId = 0;
  return {
    begin(): number {
      currentRequestId += 1;
      return currentRequestId;
    },
    isCurrent(requestId: number): boolean {
      return currentRequestId === requestId;
    },
  };
}

function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}
