import type { NoteContent } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/graph/models';

export type NoteContentState = {
  kind: 'idle' | 'loading' | 'loaded' | 'error';
  path: string;
  content: string;
};

export const noteUnavailableState: NoteContentState = {
  kind: 'idle',
  path: '',
  content: 'Open a workspace to read full note content.',
};

export function toNoteLoadedState(note: NoteContent): NoteContentState {
  return {
    kind: 'loaded',
    path: note.path,
    content: note.content,
  };
}

export function toNoteErrorState(path: string, error: unknown): NoteContentState {
  return {
    kind: 'error',
    path,
    content: error instanceof Error ? error.message : String(error),
  };
}
