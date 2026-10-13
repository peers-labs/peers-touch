import type { PrototypeManifest } from '../../portal/src/registry/types';

const manifest = {
  id: 'mobile-chat',
  title: 'Mobile Shell',
  site: 'mobile',
  host: 'mobile',
  kind: 'shell',
  status: 'confirmed',
  module: 'mobile-shell',
  path: 'packages/prototypes/mobile/chat/',
  docs: 'docs/architecture/platform/client/mobile/prototype/README.md',
  description: 'Mobile Shell interaction revision for Chat identity, loading, recovery, and cross-module continuity.',
  order: 10,
  previewExport: 'MobilePrototype',
  entry: () => import('./src/MobilePrototype'),
} satisfies PrototypeManifest;

export default manifest;
