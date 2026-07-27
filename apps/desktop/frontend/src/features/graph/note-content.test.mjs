import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  noteUnavailableState,
  toNoteErrorState,
  toNoteLoadedState,
  toSnapshotNoteState,
} from './note-content.ts';

describe('note-content', () => {
  it('formats loaded notes and unavailable sample state', () => {
    assert.deepEqual(toNoteLoadedState({ path: 'concepts/privacy.md', content: '# Privacy' }), {
      kind: 'loaded',
      path: 'concepts/privacy.md',
      content: '# Privacy',
    });
    assert.equal(noteUnavailableState.kind, 'idle');
  });

  it('uses bounded snapshot previews and never exposes raw failures', () => {
    assert.deepEqual(
      toSnapshotNoteState({
        id: 'privacy',
        title: 'Privacy',
        type: 'concept',
        path: 'concepts/privacy.md',
        preview: 'A safe preview.',
      }),
      {
        kind: 'loaded',
        path: 'concepts/privacy.md',
        content: 'A safe preview.',
      },
    );
    assert.deepEqual(toNoteErrorState('concepts/privacy.md'), {
      kind: 'error',
      path: 'concepts/privacy.md',
      content: 'This note could not be opened. Your library is unchanged.',
    });
  });
});
