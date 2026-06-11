import type { AppletManifest } from './manifest.js';

export interface AppletIndexEntry {
  id: string;
  name?: string;
  version: string;
  path: string;
  manifest?: AppletManifest;
}

export interface AppletIndex {
  version?: number;
  generatedAt?: string;
  applets: AppletIndexEntry[];
}
