import * as LibraryService from '../../../bindings/github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/service.ts';
import {
  createWorkspaceGateway,
  type GeneratedLibraryService,
} from './workspace-gateway-factory';

export type { WorkspaceGateway } from './workspace-gateway-factory';

export const wailsWorkspaceGateway = createWorkspaceGateway(
  LibraryService as unknown as GeneratedLibraryService,
);
