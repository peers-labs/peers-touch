import type { PrototypeManifest } from '../../../portal/src/registry/types';

const manifest = {
  id: 'agent-lobehub-parity',
  title: 'Agent LobeHub Parity',
  site: 'desktop',
  host: 'desktop',
  kind: 'feature',
  status: 'pending-review',
  module: 'agent',
  path: 'packages/prototypes/desktop/features/agent-lobehub-parity/',
  docs: 'docs/architecture/agent/prototype-lobehub-parity/README.md',
  description:
    'Source-backed LobeHub parity prototype ready for Owner review; product migration remains blocked until Owner confirmation.',
  order: 45,
  previewExport: 'AgentLobeHubParityPrototype',
  entry: () => import('./src/AgentLobeHubParityPrototype'),
} satisfies PrototypeManifest;

export default manifest;
