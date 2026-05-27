import type { ImportResult } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/importer/models';
import type { CheckResult } from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/tools/models';

export type WorkspaceActionState = {
  kind: 'idle' | 'loading' | 'success' | 'error';
  title: string;
  message: string;
};

export type CheckDetailsView = {
  status: string;
  exitCode: string;
  counts: string;
  byCheck: string[];
  stdout: string;
  stderr: string;
};

export const idleActionState: WorkspaceActionState = {
  kind: 'idle',
  title: 'Workspace actions',
  message: 'Open a workspace, run checks, or import one source file.',
};

export const workspaceLoadCanceledState: WorkspaceActionState = {
  kind: 'idle',
  title: 'Workspace unchanged',
  message: 'No folder selected.',
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

export function formatCheckDetails(result: CheckResult): CheckDetailsView {
  const summary = result.summary;
  return {
    status: result.status || 'unknown',
    exitCode: String(result.exitCode ?? 0),
    counts: `${formatCount(summary.errors, 'error')}, ${formatCount(summary.warnings, 'warning')}, ${summary.fixable} fixable`,
    byCheck: Object.entries(summary.by_check ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([check, count]) => `${check}: ${count}`),
    stdout: result.stdout?.trim() || 'No stdout captured.',
    stderr: result.stderr?.trim() || 'No stderr captured.',
  };
}

export function formatImportResult(result: ImportResult): WorkspaceActionState {
  return {
    kind: 'success',
    title: 'Import complete',
    message: `${result.relativePath} (${result.bytes} bytes)`,
  };
}

export function formatWorkspaceLoaded(root: string, graph: { nodes: unknown[]; edges: unknown[] }): WorkspaceActionState {
  return {
    kind: 'success',
    title: 'Workspace loaded',
    message: `${root} · ${formatCount(graph.nodes.length, 'node')}, ${formatCount(graph.edges.length, 'edge')}`,
  };
}

export function formatActionError(error: unknown): WorkspaceActionState {
  return {
    kind: 'error',
    title: 'Action failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}
