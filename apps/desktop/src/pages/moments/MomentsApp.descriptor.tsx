// PageDescriptor for the Moments page.
//
// Moments combines the long-lived Moments, Social relationship, and Messaging
// conversation projections. It is preloaded during idle and kept alive so
// feed/detail UI state survives sidebar navigation while freshness remains
// runtime-owned.

import { registerPage } from '../../kernel/page';
import { MomentsApp } from './MomentsApp';

export function registerMomentsPage(): void {
  registerPage({
    id: 'moments',
    title: 'Moments',
    factory: () => <MomentsApp />,
    preload: 'idle',
    keepAlive: 'forever',
    runtimes: ['moments', 'social', 'messaging'],
  });
}
