import { installIdentityChangedBridge } from './identity_event';
import { installPresenceBridge, teardownPresenceBridge } from './presence';
import { installPeerPresenceBridge, teardownPeerPresenceBridge } from './peerPresence';
import { installEventStreamBridge, teardownEventStreamBridge } from './eventStream';
import { installSocialRealtimeBridge, teardownSocialRealtimeBridge } from './socialRealtime';
import { installMediaRuntime, teardownMediaRuntime } from './mediaRuntime';
import { installNavigationBadgeProjection, teardownNavigationBadgeProjection } from '../store/navigationBadges';
import { log } from '../utils/logger';

let installed = false;

export function installAppRuntime(): void {
  if (installed) return;
  installed = true;

  installIdentityChangedBridge();
  installNavigationBadgeProjection();
  installSocialRealtimeBridge();
  installMediaRuntime();

  void installPresenceBridge();
  void installPeerPresenceBridge();
  void installEventStreamBridge();

  log.info('appRuntime', 'runtime installed');
}

export function teardownAppRuntime(): void {
  if (!installed) return;
  installed = false;

  teardownSocialRealtimeBridge();
  teardownMediaRuntime();
  teardownNavigationBadgeProjection();
  teardownEventStreamBridge();
  teardownPeerPresenceBridge();
  teardownPresenceBridge();

  log.info('appRuntime', 'runtime torn down');
}
