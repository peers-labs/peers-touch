import type { PrototypeManifest } from '../../portal/src/registry/types';

const manifest = {
  id: 'desktop',
  title: 'Desktop',
  site: 'desktop',
  host: 'desktop',
  kind: 'shell',
  status: 'drafting',
  module: 'desktop',
  path: 'packages/prototypes/desktop/shell/',
  docs: 'docs/architecture/engineering/prototypes/desktop-shell/README.md',
  description: 'Unified desktop prototype — all desktop features (Chat, Agent, Atelier, Orchestration, Applets, Settings) live here.',
  order: 10,
  previewExport: 'DesktopShell',
  entry: () => import('./src/Shell'),
} satisfies PrototypeManifest;

export default manifest;
