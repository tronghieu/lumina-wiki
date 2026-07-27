import type { PreparedContinuity } from './workspace-restoration';

type HistoryResolution = {
  previousEnabled: boolean;
  continuityStatus: PreparedContinuity['historyStatus'] | null;
  backendEnabled: boolean;
};

export function resolveActivationHistoryEnabled({
  continuityStatus,
  backendEnabled,
}: HistoryResolution): boolean {
  if (continuityStatus === 'off') return false;
  if (continuityStatus === 'empty' || continuityStatus === 'loaded') return true;
  if (continuityStatus !== null) return false;
  return backendEnabled;
}

export async function abortIfStalePrepared(
  prepared: { preparationToken: string },
  generation: number,
  currentGeneration: () => number,
  abort: (preparationToken: string) => Promise<unknown>,
): Promise<boolean> {
  if (currentGeneration() === generation) return false;
  await abort(prepared.preparationToken).catch(() => undefined);
  return true;
}
