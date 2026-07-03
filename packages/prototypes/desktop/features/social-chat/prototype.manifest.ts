import type { PrototypeManifest } from '../../../portal/src/registry/types';

const manifest = {
  id: 'social-chat',
  title: 'Social Chat',
  site: 'desktop',
  host: 'desktop',
  kind: 'feature',
  status: 'pending-review',
  module: 'social-chat',
  path: 'packages/prototypes/desktop/features/social-chat/',
  description: 'Desktop private chat and group chat confirmation prototype.',
  order: 40,
  previewExport: 'SocialChatPrototype',
  entry: () => import('./src/SocialChatPrototype'),
} satisfies PrototypeManifest;

export default manifest;
