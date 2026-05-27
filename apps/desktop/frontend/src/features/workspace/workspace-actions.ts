import type { ImportResult } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/importer/models';
import type { CheckResult } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/tools/models';

export type WorkspaceActionState = {
  kind: 'idle' | 'loading' | 'success' | 'error';
  title: string;
  message: string;
};

export const idleActionState: WorkspaceActionState = {
  kind: 'idle',
  title: 'Workspace actions',
  message: 'Run checks or import one source file.',
};

export function formatCheckResult(result: CheckResult): WorkspaceActionState {
  const summary = result.summary;
  const clean = summary.errors === 0 && summary.warnings === 0;
  return {
    kind: clean ? 'success' : 'error',
    title: clean ? 'Check passed' : 'Check found issues',
    message: `${summary.errors} errors, ${summary.warnings} warnings, ${summary.fixable} fixable.`,
  };
}

export function formatImportResult(result: ImportResult): WorkspaceActionState {
  return {
    kind: 'success',
    title: 'Import complete',
    message: `${result.relativePath} (${result.bytes} bytes)`,
  };
}

export function formatActionError(error: unknown): WorkspaceActionState {
  return {
    kind: 'error',
    title: 'Action failed',
    message: error instanceof Error ? error.message : String(error),
  };
}
