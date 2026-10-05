import type { PrototypeManifest } from '../../../portal/src/registry/types';

const manifest = {
  id: 'applet-lifecycle',
  title: 'Applet Lifecycle',
  site: 'desktop',
  host: 'desktop',
  kind: 'feature',
  status: 'drafting',
  module: 'applet-runtime',
  path: 'packages/prototypes/desktop/features/applet-lifecycle/',
  docs: 'docs/architecture/platform/applet-runtime/prototype/README.md',
  description: 'Minimal Desktop Applet Box launcher with package import, running state, notifications, exit, and uninstall.',
  order: 24,
  hidden: true,
  previewExport: 'AppletLifecyclePrototype',
  entry: () => import('./src/AppletLifecyclePrototype'),
} satisfies PrototypeManifest;

export default manifest;
