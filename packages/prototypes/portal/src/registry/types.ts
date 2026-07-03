import type { ComponentType } from 'react';

export type PrototypeSite = 'desktop' | 'mobile' | 'dashboard';

export type PrototypeKind = 'shell' | 'applet' | 'feature';

export type PrototypeStatus = 'drafting' | 'pending-review' | 'confirmed' | 'landed' | 'superseded';

export type PrototypeEntryModule = {
  [exportName: string]: ComponentType | unknown;
};

export type PrototypeManifest = {
  id: string;
  title: string;
  site: PrototypeSite;
  host: PrototypeSite;
  kind: PrototypeKind;
  status: PrototypeStatus;
  module: string;
  path: string;
  docs?: string;
  description: string;
  order?: number;
  previewExport?: string;
  entry: () => Promise<PrototypeEntryModule>;
};

export type PrototypeWorktreeTarget = {
  id: string;
  label: string;
  branch: string;
  worktreePath: string;
  sites: Partial<Record<PrototypeSite, string>>;
};
