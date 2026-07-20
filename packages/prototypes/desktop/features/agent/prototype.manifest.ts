import type { PrototypeManifest } from '../../../portal/src/registry/types';

const manifest = {
  id: 'agent',
  title: 'Agent',
  site: 'desktop',
  host: 'desktop',
  kind: 'feature',
  status: 'drafting',
  module: 'agent',
  path: 'packages/prototypes/desktop/features/agent/',
  docs: 'docs/architecture/agent/prototype/README.md',
  description:
    'Agent module prototype with 3 sub-entries: Agent (execution unit), Atelier (workbench UI), and Orchestration. TRAE Solo focused layout.',
  order: 25,
  hidden: true,
  previewExport: 'AgentPrototype',
  entry: () => import('./src/AgentPrototype'),
} satisfies PrototypeManifest;

export default manifest;
