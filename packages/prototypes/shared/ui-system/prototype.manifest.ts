import type { PrototypeManifest } from '../../portal/src/registry/types';

export default {
  id: 'ui-system',
  title: 'Frontend Eles',
  site: 'frontend-eles',
  host: 'frontend-eles',
  kind: 'feature',
  // Gallery navigation status. Complete-surface confirmation is source-bound
  // in docs/architecture/engineering/prototypes/README.md, not this manifest.
  status: 'drafting',
  module: 'ui-system',
  path: 'packages/prototypes/shared/ui-system/',
  docs: 'docs/architecture/platform/client/ui-system/README.md',
  description: 'Self-training UI/UX: desktop & mobile prototypes, real capability registry, pattern kits, vetted specimens, and design philosophy; prototypes compose peers-ui primitives, never hand-rolled controls.',
  order: 1,
  previewExport: 'UISystemGallery',
  entry: () => import('./UISystemGallery'),
} satisfies PrototypeManifest;
