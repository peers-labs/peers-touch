import type { PrototypeManifest } from '../../../portal/src/registry/types';

const manifest = {
  id: 'modern-chat-agent',
  title: 'Modern Chat Agent',
  site: 'desktop',
  host: 'desktop',
  kind: 'feature',
  status: 'confirmed',
  module: 'agent',
  path: 'packages/prototypes/desktop/features/modern-chat-agent/',
  docs: 'docs/architecture/domains/agent/modern-chat-agent/prototype/README.md',
  description: 'Peers Touch Modern Chat Agent V1/V2 product states, including Home, capability governance, and Evaluation.',
  order: 45,
  hidden: true,
  previewExport: 'ModernChatReview',
  entry: () => import('./src/ModernChatReview'),
} satisfies PrototypeManifest;

export default manifest;
