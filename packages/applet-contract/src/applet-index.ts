// Applet index registry types for discovering installed applets.

export interface AppletIndexEntry {
  id: string;
  name: string;
  version: string;
  path: string;
}

export interface AppletIndex {
  version: number;
  applets: AppletIndexEntry[];
}
