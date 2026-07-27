import type { NoteContentState } from './note-content';

type NoteViewProps = {
  noteState: NoteContentState;
};

export function NoteView({ noteState }: NoteViewProps) {
  return (
    <section className={`note-view ${noteState.kind}`} aria-label="Note content" aria-live="polite">
      <header>
        <span>{noteState.path ? 'Selected note' : 'No note selected'}</span>
        <strong>{noteState.kind === 'loading' ? 'Loading' : noteState.kind}</strong>
      </header>
      <pre>{noteState.content}</pre>
    </section>
  );
}
