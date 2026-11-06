import type { PrototypeManifest } from '../../portal/src/registry/types';
import { isModelWireflow } from '../../shared/modelServiceWireflowState';

const manifest = {
  id: 'desktop',
  title: isModelWireflow() ? 'Desktop · 模型消费线框' : 'Desktop',
  site: 'desktop',
  host: 'desktop',
  kind: 'shell',
  status: isModelWireflow() ? 'drafting' : 'pending-review',
  module: 'desktop',
  path: 'packages/prototypes/desktop/shell/',
  docs: 'docs/architecture/engineering/prototypes/desktop-shell/README.md',
  description: isModelWireflow() ? '我的模型、个人默认与 Agent 消费，共享同一 Owner 图；授权与调用均为模拟。'
    : 'Unified desktop prototype with the current cross-platform Chat delivery-recovery review journey.',
  order: 10,
  previewExport: 'DesktopShell',
  entry: () => import('./src/Shell'),
} satisfies PrototypeManifest;

export default manifest;
