import type { ReadyLibraryState } from './ready-library-state';

export type WorkspaceAttemptKind = 'create' | 'open' | 'recover' | 'restore' | 'find';

export type PendingLibraryOperation = {
  recoveryId: string;
  libraryLabel: string;
  message: string;
};

export type WorkspaceAttempt = {
  generation: number;
  kind: WorkspaceAttemptKind;
};

type SharedScreenState = {
  nextAttemptGeneration: number;
};

export type WorkspaceScreenState =
  | (SharedScreenState & { kind: 'booting' })
  | (SharedScreenState & {
      kind: 'welcome';
      previousLibrary: ReadyLibraryState | null;
      recovery: PendingLibraryOperation | null;
      notice: string | null;
    })
  | (SharedScreenState & {
      kind: 'ready';
      library: ReadyLibraryState;
      recovery: PendingLibraryOperation | null;
      notice: string | null;
    })
  | (SharedScreenState & {
      kind: 'activating';
      attempt: WorkspaceAttempt;
      returnTo: 'welcome' | 'ready';
      previousLibrary: ReadyLibraryState | null;
      recovery: PendingLibraryOperation | null;
    });

export type WorkspaceScreenAction =
  | { type: 'boot-welcome'; recovery: PendingLibraryOperation | null }
  | { type: 'boot-ready'; library: ReadyLibraryState }
  | { type: 'show-welcome' }
  | { type: 'return-to-ready' }
  | { type: 'begin-attempt'; attemptKind: WorkspaceAttemptKind }
  | { type: 'attempt-cancelled'; generation: number }
  | {
      type: 'attempt-failed';
      generation: number;
      notice: string;
      recovery?: PendingLibraryOperation | null;
    }
  | {
      type: 'attempt-committed';
      generation: number;
      library: ReadyLibraryState;
      recovery?: PendingLibraryOperation | null;
    }
  | { type: 'recovery-removed'; recoveryId: string };

export const initialWorkspaceScreenState: WorkspaceScreenState = {
  kind: 'booting',
  nextAttemptGeneration: 1,
};

export function beginWorkspaceAttempt(
  state: WorkspaceScreenState,
  attemptKind: WorkspaceAttemptKind,
): WorkspaceScreenState {
  return reduceWorkspaceScreen(state, { type: 'begin-attempt', attemptKind });
}

export function reduceWorkspaceScreen(
  state: WorkspaceScreenState,
  action: WorkspaceScreenAction,
): WorkspaceScreenState {
  if (action.type === 'boot-welcome') {
    return {
      kind: 'welcome',
      nextAttemptGeneration: state.nextAttemptGeneration,
      previousLibrary: null,
      recovery: action.recovery,
      notice: null,
    };
  }
  if (action.type === 'boot-ready') {
    return {
      kind: 'ready',
      nextAttemptGeneration: state.nextAttemptGeneration,
      library: action.library,
      recovery: currentRecovery(state),
      notice: null,
    };
  }
  if (action.type === 'show-welcome') {
    if (state.kind !== 'ready') return state;
    return {
      kind: 'welcome',
      nextAttemptGeneration: state.nextAttemptGeneration,
      previousLibrary: state.library,
      recovery: state.recovery,
      notice: null,
    };
  }
  if (action.type === 'return-to-ready') {
    if (state.kind !== 'welcome' || !state.previousLibrary) return state;
    return {
      kind: 'ready',
      nextAttemptGeneration: state.nextAttemptGeneration,
      library: state.previousLibrary,
      recovery: state.recovery,
      notice: null,
    };
  }
  if (action.type === 'begin-attempt') {
    return {
      kind: 'activating',
      nextAttemptGeneration: state.nextAttemptGeneration + 1,
      attempt: {
        generation: state.nextAttemptGeneration,
        kind: action.attemptKind,
      },
      returnTo: state.kind === 'welcome' ? 'welcome' : 'ready',
      previousLibrary: currentLibrary(state),
      recovery: currentRecovery(state),
    };
  }
  if (action.type === 'recovery-removed') {
    if (
      (state.kind !== 'welcome' && state.kind !== 'ready')
      || state.recovery?.recoveryId !== action.recoveryId
    ) {
      return state;
    }
    return {
      ...state,
      recovery: null,
    };
  }
  if (state.kind !== 'activating' || state.attempt.generation !== action.generation) {
    return state;
  }
  if (action.type === 'attempt-committed') {
    return {
      kind: 'ready',
      nextAttemptGeneration: state.nextAttemptGeneration,
      library: action.library,
      recovery: action.recovery ?? null,
      notice: null,
    };
  }
  if (action.type === 'attempt-cancelled') {
    return restorePreviousState(state, null);
  }
  if (action.type === 'attempt-failed') {
    return restorePreviousState(
      action.recovery === undefined ? state : { ...state, recovery: action.recovery },
      action.notice,
    );
  }
  return state;
}

function currentLibrary(state: WorkspaceScreenState): ReadyLibraryState | null {
  if (state.kind === 'ready') return state.library;
  if (state.kind === 'welcome') return state.previousLibrary;
  if (state.kind === 'activating') return state.previousLibrary;
  return null;
}

function currentRecovery(state: WorkspaceScreenState): PendingLibraryOperation | null {
  if (state.kind === 'welcome') return state.recovery;
  if (state.kind === 'ready') return state.recovery;
  if (state.kind === 'activating') return state.recovery;
  return null;
}

function restorePreviousState(
  state: Extract<WorkspaceScreenState, { kind: 'activating' }>,
  notice: string | null,
): WorkspaceScreenState {
  if (state.returnTo === 'ready' && state.previousLibrary) {
    return {
      kind: 'ready',
      nextAttemptGeneration: state.nextAttemptGeneration,
      library: state.previousLibrary,
      recovery: state.recovery,
      notice,
    };
  }
  return {
    kind: 'welcome',
    nextAttemptGeneration: state.nextAttemptGeneration,
    previousLibrary: state.previousLibrary,
    recovery: state.recovery,
    notice,
  };
}
