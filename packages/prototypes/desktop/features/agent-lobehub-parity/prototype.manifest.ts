import type { PrototypeManifest } from '../../../portal/src/registry/types';

const manifest = {
  id: 'agent-lobehub-parity',
  title: 'Agent LobeHub Parity',
  site: 'desktop',
  host: 'desktop',
  kind: 'feature',
  status: 'superseded',
  module: 'agent',
  path: 'packages/prototypes/desktop/features/agent-lobehub-parity/',
  docs: 'docs/architecture/agent/prototype-lobehub-parity/README.md',
  description:
    'Historical LobeHub benchmark prototype retained as source evidence; superseded by the Peers Modern Chat Agent prototype.',
  order: 45,
  hidden: true,
  previewExport: 'AgentLobeHubParityPrototype',
  entry: () => import('./src/AgentLobeHubParityPrototype'),
} satisfies PrototypeManifest;

export default manifest;
