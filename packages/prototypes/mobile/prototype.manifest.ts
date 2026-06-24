import type { PrototypeManifest } from '../portal/src/registry/types';

const manifest = {
  id: 'mobile-chat',
  title: 'Mobile Chat',
  site: 'mobile',
  host: 'mobile',
  kind: 'shell',
  status: 'drafting',
  module: 'mobile',
  path: 'packages/prototypes/mobile/',
  docs: 'docs/client/mobile/base.md',
  description: 'Mobile chat shell baseline for cross-device conversations and agent summaries.',
  order: 10,
  previewExport: 'MobilePrototype',
  entry: () => import('./src/MobilePrototype'),
} satisfies PrototypeManifest;

export default manifest;

