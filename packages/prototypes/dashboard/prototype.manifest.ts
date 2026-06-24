import type { PrototypeManifest } from '../portal/src/registry/types';

const manifest = {
  id: 'station-dashboard',
  title: 'Station Dashboard',
  site: 'dashboard',
  host: 'dashboard',
  kind: 'shell',
  status: 'drafting',
  module: 'station-dashboard',
  path: 'packages/prototypes/dashboard/',
  docs: 'docs/station/base.md',
  description: 'Station Dashboard operations baseline for stations, federation health, and runtime alerts.',
  order: 10,
  previewExport: 'DashboardPrototype',
  entry: () => import('./src/DashboardPrototype'),
} satisfies PrototypeManifest;

export default manifest;

