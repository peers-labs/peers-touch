import { installIdentityChangedBridge } from './identity_event';
import { installPresenceBridge, teardownPresenceBridge } from './presence';
import { installPeerPresenceBridge, teardownPeerPresenceBridge } from './peerPresence';
import { installEventStreamBridge, teardownEventStreamBridge } from './eventStream';
import { installMediaRuntime, teardownMediaRuntime } from './mediaRuntime';
import { installNavigationBadgeProjection, teardownNavigationBadgeProjection } from '../store/navigationBadges';
import { bootstrapRuntime, installRuntime, registerRuntime, teardownRuntime } from '../kernel/runtime';
import { searchRuntime } from '../runtimes/searchRuntime';
import { settingsRuntime } from '../runtimes/settingsRuntime';
import { socialRuntime } from '../runtimes/socialRuntime';
import { federationRuntime } from '../runtimes/federationRuntime';
import { appletsRuntime } from '../runtimes/appletsRuntime';
import { log } from '../utils/logger';

// Register kernel-managed runtimes once. The legacy bridges
// (presence, peerPresence, eventStream, mediaRuntime,
// navigationBadgeProjection, identity event) still install inline
// below because they are not yet wrapped by `RuntimeDescriptor`s; that
// migration is incremental (see plan §3 / §6).
let runtimesRegistered = false;
function registerKernelRuntimes(): void {
  if (runtimesRegistered) return;
  runtimesRegistered = true;
  registerRuntime(socialRuntime);
  registerRuntime(searchRuntime);
  registerRuntime(settingsRuntime);
  registerRuntime(federationRuntime);
  registerRuntime(appletsRuntime);
}

let installed = false;

export function installAppRuntime(): void {
  if (installed) return;
  installed = true;

  registerKernelRuntimes();

  installIdentityChangedBridge();
  installNavigationBadgeProjection();
  installRuntime(socialRuntime.id);
  // App-scope bootstrap (no-op here, but keeps lifecycle log lines
  // consistent with the BootPipeline contract).
  void bootstrapRuntime(socialRuntime.id, null);

  installRuntime(searchRuntime.id);
  void bootstrapRuntime(searchRuntime.id, null);

  installRuntime(settingsRuntime.id);
  void bootstrapRuntime(settingsRuntime.id, null);

  installRuntime(federationRuntime.id);
  void bootstrapRuntime(federationRuntime.id, null);

  installRuntime(appletsRuntime.id);
  void bootstrapRuntime(appletsRuntime.id, null);

  installMediaRuntime();

  void installPresenceBridge();
  void installPeerPresenceBridge();
  void installEventStreamBridge();

  log.info('appRuntime', 'runtime installed');
}

export function teardownAppRuntime(): void {
  if (!installed) return;
  installed = false;

  teardownRuntime(socialRuntime.id);
  teardownRuntime(searchRuntime.id);
  teardownRuntime(settingsRuntime.id);
  teardownRuntime(federationRuntime.id);
  teardownRuntime(appletsRuntime.id);
  teardownMediaRuntime();
  teardownNavigationBadgeProjection();
  teardownEventStreamBridge();
  teardownPeerPresenceBridge();
  teardownPresenceBridge();

  log.info('appRuntime', 'runtime torn down');
}
