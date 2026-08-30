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
  docs: 'docs/architecture/mobile/prototype/README.md',
  description: 'Mobile Shell product flow with Station trust, OAuth, Chat, Moments, Contacts, Me, and recovery-state evidence.',
  order: 10,
  previewExport: 'MobilePrototype',
  entry: () => import('./src/MobilePrototype'),
} satisfies PrototypeManifest;

export default manifest;
