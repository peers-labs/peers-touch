import type { PrototypeManifest } from '../../portal/src/registry/types';

const manifest = {
  id: 'mobile-chat',
  title: 'Mobile Shell',
  site: 'mobile',
  host: 'mobile',
  kind: 'shell',
  status: 'pending-review',
  module: 'mobile-shell',
  path: 'packages/prototypes/mobile/chat/',
  docs: 'docs/architecture/platform/client/mobile/prototype/README.md',
  description: 'Mobile Shell with the current cross-platform Chat delivery-recovery review journey and existing product flows.',
  order: 10,
  previewExport: 'MobilePrototype',
  entry: () => import('./src/MobilePrototype'),
} satisfies PrototypeManifest;

export default manifest;
