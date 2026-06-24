import type { PrototypeManifest } from '../portal/src/registry/types';

const manifest = {
  id: 'social-chat',
  title: 'Social Chat',
  site: 'desktop',
  host: 'desktop',
  kind: 'feature',
  status: 'drafting',
  module: 'social-chat',
  path: 'packages/prototypes/social-chat/',
  description: 'Desktop social chat capability prototype.',
  order: 40,
  previewExport: 'SocialChatPrototype',
  entry: () => import('./src/SocialChatPrototype'),
} satisfies PrototypeManifest;

export default manifest;
