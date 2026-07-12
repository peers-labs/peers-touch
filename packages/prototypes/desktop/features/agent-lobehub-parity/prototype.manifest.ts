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
    'Integrated Agent prototype: production-aligned Profile state and interactions, with existing Agent surfaces converging here for Owner review.',
  order: 45,
  hidden: true,
  previewExport: 'AgentLobeHubParityPrototype',
  entry: () => import('./src/AgentLobeHubParityPrototype'),
} satisfies PrototypeManifest;

export default manifest;
