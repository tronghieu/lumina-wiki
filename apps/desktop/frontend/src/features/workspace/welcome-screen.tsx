import { useCallback, useState, type FormEvent } from 'react';
import type { PendingLibraryOperation, WorkspaceAttemptKind } from './welcome-state';
import type { RecentLibrary } from './workspace-restoration';

interface WelcomeScreenProps {
  /** Prevents duplicate actions while a native confirmation is open. */
  busy: boolean;
  /** Safe, path-free description of an interrupted creation. */
  recovery: PendingLibraryOperation | null;
  /** Friendly outcome from the most recent action. */
  notice: string | null;
  /** Safe display label for the library that remains available behind Welcome. */
  currentLibraryLabel?: string;
  /** Private, path-free recent library summaries. */
  recentLibraries: RecentLibrary[];
  /** Starts creation using the user-visible library name. */
  onCreate: (name: string) => void;
  /** Opens the native library chooser. */
  onOpen: () => void;
  /** Retries an interrupted creation. */
  onRetryRecovery: (recoveryId: string) => void;
  /** Removes only the app's recovery reference. */
  onRemoveRecovery: (recoveryId: string) => void;
  /** Returns to the library that was active before Welcome opened. */
  onReturnToLibrary?: () => void;
  onRestoreRecent: (workspaceId: string) => void;
  onFindRecent: (workspaceId: string) => void;
  onRemoveRecent: (workspaceId: string) => void;
  onClearRecentActivity: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  busy,
  recovery,
  notice,
  currentLibraryLabel,
  recentLibraries,
  onCreate,
  onOpen,
  onRetryRecovery,
  onRemoveRecovery,
  onReturnToLibrary,
  onRestoreRecent,
  onFindRecent,
  onRemoveRecent,
  onClearRecentActivity,
}) => {
  const [libraryName, setLibraryName] = useState('Lumina Library');

  const submitCreate = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = libraryName.trim();
    if (name) onCreate(name);
  }, [libraryName, onCreate]);

  return (
    <main className="welcome-screen" aria-busy={busy}>
      <section className="welcome-panel" aria-labelledby="welcome-title">
        {currentLibraryLabel && onReturnToLibrary && (
          <div className="welcome-current-library">
            <span>{currentLibraryLabel} is still open.</span>
            <button type="button" disabled={busy} onClick={onReturnToLibrary}>
              Return to current library
            </button>
          </div>
        )}
        <header className="welcome-heading">
          <span className="welcome-mark" aria-hidden="true">LW</span>
          <p>Your knowledge, connected</p>
          <h1 id="welcome-title">Welcome to Lumina</h1>
          <span>
            Create a library for your documents, notes, topics, and the relationships between them.
          </span>
        </header>

        {recovery && (
          <section className="recovery-card" aria-labelledby="recovery-title">
            <div>
              <span>Needs attention</span>
              <h2 id="recovery-title">{recovery.libraryLabel}</h2>
              <p>{recovery.message}</p>
            </div>
            <div className="welcome-actions">
              <button
                className="primary-action"
                type="button"
                disabled={busy}
                onClick={() => onRetryRecovery(recovery.recoveryId)}
              >
                Retry
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemoveRecovery(recovery.recoveryId)}
              >
                Remove from this list
              </button>
            </div>
          </section>
        )}

        <section className="recent-libraries" aria-labelledby="recent-libraries-title">
            <div className="recent-libraries-heading">
              <div>
                <h2 id="recent-libraries-title">Recent libraries</h2>
                <p>Continue where you left off, or locate a library again.</p>
              </div>
              <button type="button" disabled={busy} onClick={onClearRecentActivity}>
                Clear recent activity
              </button>
            </div>
            <div className="recent-library-list">
              {recentLibraries.length === 0 && (
                <p className="recent-library-empty">No recent libraries yet.</p>
              )}
              {recentLibraries.slice(0, 12).map((library) => (
                <article className="recent-library-card" key={library.workspaceId}>
                  <div>
                    <h3>{library.label}</h3>
                    <span>{library.focus === 'chat' ? 'Chat' : library.focus === 'note' ? 'Note' : 'Graph'}</span>
                  </div>
                  <div className="welcome-actions">
                    {library.status === 'available' ? (
                      <button
                        className="primary-action"
                        type="button"
                        disabled={busy}
                        onClick={() => onRestoreRecent(library.workspaceId)}
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        className="primary-action"
                        type="button"
                        disabled={busy}
                        onClick={() => onFindRecent(library.workspaceId)}
                      >
                        Find again
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRemoveRecent(library.workspaceId)}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
        </section>

        <div className="welcome-choices">
          <form className="welcome-card" onSubmit={submitCreate}>
            <div className="welcome-card-icon" aria-hidden="true">+</div>
            <div>
              <h2>Create a new library</h2>
              <p>Start with an empty library, then add documents and notes when you are ready.</p>
            </div>
            <label>
              <span>Library name</span>
              <input
                autoComplete="off"
                disabled={busy}
                maxLength={80}
                value={libraryName}
                onChange={(event) => setLibraryName(event.target.value)}
              />
            </label>
            <button className="primary-action" type="submit" disabled={busy || !libraryName.trim()}>
              Create library
            </button>
          </form>

          <section className="welcome-card">
            <div className="welcome-card-icon" aria-hidden="true">↗</div>
            <div>
              <h2>Continue with a library</h2>
              <p>Choose a library you already created. Lumina opens it without changing its contents.</p>
            </div>
            <button type="button" disabled={busy} onClick={onOpen}>
              Open existing library
            </button>
          </section>
        </div>

        <p className="welcome-status" role="status" aria-live="polite">
          {busy ? 'Waiting for your confirmation…' : notice}
        </p>
      </section>
    </main>
  );
};

export default WelcomeScreen;

export function workspaceAttemptLabel(kind: WorkspaceAttemptKind): string {
  if (kind === 'create') return 'Creating your library…';
  if (kind === 'recover') return 'Finishing your library…';
  if (kind === 'restore') return 'Restoring your library…';
  if (kind === 'find') return 'Opening the library you selected…';
  return 'Opening your library…';
}
