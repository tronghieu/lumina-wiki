import { readFile } from 'node:fs/promises';
import { atomicWrite } from './fsx.mjs';

export function emptyDiscoveryState() {
  return { version: 1, items: {} };
}

export async function readDiscoveryState(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || !parsed.items) {
      return emptyDiscoveryState();
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return emptyDiscoveryState();
    if (err instanceof SyntaxError) return emptyDiscoveryState();
    throw err;
  }
}

export async function writeDiscoveryState(filePath, state) {
  await atomicWrite(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

export function getItemState(state, itemId) {
  state.items[itemId] ??= { lastRunAt: null, seen: {} };
  state.items[itemId].seen ??= {};
  return state.items[itemId];
}

export function markSeen(itemState, dedupKey, timestamp) {
  itemState.seen[dedupKey] = timestamp;
}

export function hasSeen(itemState, dedupKey) {
  return Object.prototype.hasOwnProperty.call(itemState.seen ?? {}, dedupKey);
}


