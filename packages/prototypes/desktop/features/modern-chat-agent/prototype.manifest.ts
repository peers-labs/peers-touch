import type { PrototypeManifest } from '../../../portal/src/registry/types';

const manifest = {
  id: 'modern-chat-agent',
  title: 'Modern Chat Agent',
  site: 'desktop',
  host: 'desktop',
  kind: 'feature',
  status: 'pending-review',
  module: 'agent',
  path: 'packages/prototypes/desktop/features/modern-chat-agent/',
  docs: 'docs/architecture/agent/modern-chat-agent/prototype/README.md',
  description: 'Peers Touch Modern Chat Agent product states and interactions.',
  order: 45,
  hidden: true,
  previewExport: 'ModernChatReview',
  entry: () => import('./src/ModernChatReview'),
} satisfies PrototypeManifest;

export default manifest;
