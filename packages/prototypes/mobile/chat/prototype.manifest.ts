import type { PrototypeManifest } from '../../portal/src/registry/types';

const manifest = {
  id: 'mobile-chat',
  title: 'Mobile Shell',
  site: 'mobile',
  host: 'mobile',
  kind: 'shell',
  status: 'drafting',
  module: 'mobile',
  path: 'packages/prototypes/mobile/chat/',
  docs: 'docs/architecture/mobile/prototype/README.md',
  description: 'Source-backed Mobile prototype aligned to apps/mobile launch state, MobileShell tabs, Chat, Contacts, Moments, Settings, Friend and Group flows.',
  order: 10,
  previewExport: 'MobilePrototype',
  entry: () => import('./src/MobilePrototype'),
} satisfies PrototypeManifest;

export default manifest;
