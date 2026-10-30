import type { PrototypeManifest } from '../../portal/src/registry/types';

export default {
  id: 'ui-system',
  title: 'Frontend Eles',
  site: 'frontend-eles',
  host: 'frontend-eles',
  kind: 'feature',
  status: 'drafting',
  module: 'ui-system',
  path: 'packages/prototypes/shared/ui-system/',
  docs: 'docs/architecture/platform/client/ui-system/README.md',
  description: 'Draft material study: light translucent mint canvas, floating white panels, soft amber emphasis, brightened imagery; external references are de-identified and kept out of the repository.',
  order: 1,
  previewExport: 'UISystemGallery',
  entry: () => import('./UISystemGallery'),
} satisfies PrototypeManifest;
