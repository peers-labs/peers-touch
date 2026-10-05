import type { PrototypeManifest } from '../../../portal/src/registry/types';

const manifest = {
  id: 'applet-workspace',
  title: 'Applet Workspace',
  site: 'desktop',
  host: 'desktop',
  kind: 'feature',
  status: 'drafting',
  module: 'applet-runtime',
  path: 'packages/prototypes/desktop/features/applet-workspace/',
  docs: 'docs/architecture/platform/applet-runtime/prototype/README.md',
  description: 'Browser-like Desktop applet workspace with pinned home, multi-instance tabs, pin-to-system, detach, and immersive modes.',
  order: 25,
  hidden: true,
  previewExport: 'AppletWorkspacePrototype',
  entry: () => import('./src/AppletWorkspaceStandalone'),
} satisfies PrototypeManifest;

export default manifest;
