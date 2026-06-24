import type { PrototypeManifest } from '../portal/src/registry/types';

const manifest = {
  id: 'desktop-shell',
  title: 'Desktop Shell',
  site: 'desktop',
  host: 'desktop',
  kind: 'shell',
  status: 'drafting',
  module: 'desktop',
  path: 'packages/prototypes/desktop/',
  docs: 'docs/architecture/desktop/prototype/README.md',
  description: 'Desktop container shell; hosts applets such as Atelier.',
  order: 10,
  previewExport: 'DesktopShell',
  entry: () => import('./src/Shell'),
} satisfies PrototypeManifest;

export default manifest;
