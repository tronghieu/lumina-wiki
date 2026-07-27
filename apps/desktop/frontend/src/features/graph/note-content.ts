import type { GraphNode } from './graph-types';

export type NoteContentState = {
  kind: 'idle' | 'loading' | 'loaded' | 'error';
  path: string;
  content: string;
};

export const noteUnavailableState: NoteContentState = {
  kind: 'idle',
  path: '',
  content: 'Select a note to read it here.',
};

export function toNoteLoadedState(note: { path: string; content: string }): NoteContentState {
  return {
    kind: 'loaded',
    path: note.path,
    content: note.content,
  };
}

export function toSnapshotNoteState(node: GraphNode): NoteContentState {
  return {
    kind: 'loaded',
    path: node.path,
    content: node.preview || 'This note has no preview yet.',
  };
}

export function toNoteErrorState(path: string): NoteContentState {
  return {
    kind: 'error',
    path,
    content: 'This note could not be opened. Your library is unchanged.',
  };
}
