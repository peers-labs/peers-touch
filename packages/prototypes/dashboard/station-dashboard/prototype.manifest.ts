import type { PrototypeManifest } from '../../portal/src/registry/types';

const manifest = {
  id: 'station-dashboard',
  title: 'Station Dashboard',
  site: 'dashboard',
  host: 'dashboard',
  kind: 'shell',
  status: 'pending-review',
  module: 'station-dashboard',
  path: 'packages/prototypes/dashboard/station-dashboard/',
  docs: 'docs/station/base.md',
  description: 'Station operator view for the shared Chat delivery-recovery journey, federation health, and runtime operations.',
  order: 10,
  previewExport: 'DashboardPrototype',
  entry: () => import('./src/DashboardPrototype'),
} satisfies PrototypeManifest;

export default manifest;
