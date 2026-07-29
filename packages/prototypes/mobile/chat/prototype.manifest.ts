import type { PrototypeManifest } from '../../portal/src/registry/types';

const manifest = {
  id: 'mobile-chat',
  title: 'Mobile Shell',
  site: 'mobile',
  host: 'mobile',
  kind: 'shell',
  status: 'drafting',
  module: 'mobile-shell',
  path: 'packages/prototypes/mobile/chat/',
  docs: 'docs/architecture/mobile/prototype/README.md',
  description: 'Mobile Shell baseline aligned with apps/mobile: access gate, Chat, Moments, Contacts, Settings, Friend and Group flows.',
  order: 10,
  previewExport: 'MobilePrototype',
  entry: () => import('./src/MobilePrototype'),
} satisfies PrototypeManifest;

export default manifest;
