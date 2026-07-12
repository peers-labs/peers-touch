import type { PrototypeManifest } from '../../../portal/src/registry/types';

const manifest = {
  id: 'atelier',
  title: 'Atelier',
  site: 'desktop',
  host: 'desktop',
  kind: 'applet',
  status: 'superseded',
  module: 'atelier',
  path: 'packages/prototypes/desktop/applets/atelier/',
  docs: 'docs/architecture/atelier/prototype/README.md',
  description: 'Desktop-hosted applet prototype, not a first-level prototype site.',
  order: 20,
  previewExport: 'AtelierPage',
  entry: () => import('./src/Page'),
} satisfies PrototypeManifest;

export default manifest;
