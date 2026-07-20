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
  /**
   * When true, the prototype source stays in the workspace but is not shown as
   * its own Portal card. Use this for surfaces that have been consolidated into
   * a host prototype (e.g. desktop features folded into `desktop-shell`).
   */
  hidden?: boolean;
  entry: () => Promise<PrototypeEntryModule>;
};

export type PrototypeWorktreeTarget = {
  id: string;
  label: string;
  branch: string;
  worktreePath: string;
  sites: Partial<Record<PrototypeSite, string>>;
};
