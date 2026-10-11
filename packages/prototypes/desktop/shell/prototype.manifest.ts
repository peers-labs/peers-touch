import type { PrototypeManifest } from '../../portal/src/registry/types';

const manifest = {
  id: 'desktop',
  title: 'Desktop',
  site: 'desktop',
  host: 'desktop',
  kind: 'shell',
  status: 'pending-review',
  module: 'desktop',
  path: 'packages/prototypes/desktop/shell/',
  docs: 'docs/architecture/engineering/prototypes/desktop-shell/README.md',
  description: 'Unified desktop prototype with the current cross-platform Chat delivery-recovery review journey.',
  order: 10,
  previewExport: 'DesktopShell',
  entry: () => import('./src/Shell'),
} satisfies PrototypeManifest;

export default manifest;
