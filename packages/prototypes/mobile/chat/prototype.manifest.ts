import type { PrototypeManifest } from '../../portal/src/registry/types';

const manifest = {
  id: 'mobile-chat',
  title: 'Mobile Product',
  site: 'mobile',
  host: 'mobile',
  kind: 'shell',
  status: 'pending-review',
  module: 'mobile-product',
  path: 'packages/prototypes/mobile/chat/',
  docs: 'docs/architecture/platform/client/mobile/prototype/README.md',
  description: 'Single mobile product surface (messages / moments / me) sharing the desktop north-star interaction grammar and data; the evidence host injects scenario state into the same MobileApp, there is no second skin.',
  order: 10,
  previewExport: 'MobilePrototype',
  entry: () => import('./src/MobilePrototype'),
} satisfies PrototypeManifest;

export default manifest;
