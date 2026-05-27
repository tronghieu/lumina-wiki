import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { noteUnavailableState, toNoteLoadedState } from './note-content.ts';

describe('note-content', () => {
  it('formats loaded notes and unavailable sample state', () => {
    assert.deepEqual(toNoteLoadedState({ path: 'concepts/privacy.md', content: '# Privacy' }), {
      kind: 'loaded',
      path: 'concepts/privacy.md',
      content: '# Privacy',
    });
    assert.equal(noteUnavailableState.kind, 'idle');
  });
});
