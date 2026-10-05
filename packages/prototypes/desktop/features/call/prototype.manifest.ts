import type { PrototypeManifest } from '../../../portal/src/registry/types';

const manifest = {
  id: 'call',
  title: 'Call Surface',
  site: 'desktop',
  host: 'desktop',
  kind: 'feature',
  status: 'confirmed',
  module: 'call',
  path: 'packages/prototypes/desktop/features/call/',
  docs: 'docs/architecture/domains/chat/calling/prototype/README.md',
  description: 'Desktop Chat / voice-video call capability prototype.',
  order: 30,
  hidden: true,
  previewExport: 'CallPrototype',
  entry: () => import('./src/CallPrototype'),
} satisfies PrototypeManifest;

export default manifest;
