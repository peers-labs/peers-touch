import { installIdentityChangedBridge } from './identity_event';
import { installPresenceBridge, teardownPresenceBridge } from './presence';
import { installEventStreamBridge, teardownEventStreamBridge } from './eventStream';
import { installSessionKickBridge, teardownSessionKickBridge } from './sessionKick';
import { installMediaRuntime, teardownMediaRuntime } from './mediaRuntime';
import { installNavigationBadgeProjection, teardownNavigationBadgeProjection } from '../store/navigationBadges';
import { bootstrapRuntime, installRuntime, registerRuntime, teardownRuntime } from '../kernel/runtime';
import { searchRuntime } from '../runtimes/searchRuntime';
import { settingsRuntime } from '../runtimes/settingsRuntime';
import { socialRuntime } from '../runtimes/socialRuntime';
import { federationRuntime } from '../runtimes/federationRuntime';
import { appletsRuntime } from '../runtimes/appletsRuntime';
import { momentsRuntime } from '../runtimes/momentsRuntime';
import { agentCapabilityRuntime } from '../runtimes/agentCapabilityRuntime';
import { agentTopicRuntime } from '../runtimes/agentTopicRuntime';
import { messagingRecoveryRuntime } from '../runtimes/messagingRecoveryRuntime';
import { log } from '../utils/logger';

// Register kernel-managed runtimes once. The legacy bridges
// (presence, eventStream, mediaRuntime,
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
  registerRuntime(momentsRuntime);
  registerRuntime(agentCapabilityRuntime);
  registerRuntime(agentTopicRuntime);
  registerRuntime(messagingRecoveryRuntime);
}

let installed = false;
let deferredInstalled = false;
let deferredInstallInFlight: Promise<void> | null = null;

const DEFERRED_APP_RUNTIME_IDS = [
  searchRuntime.id,
  settingsRuntime.id,
  federationRuntime.id,
  momentsRuntime.id,
  agentCapabilityRuntime.id,
  agentTopicRuntime.id,
];

function yieldToRenderer(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

export function installAppRuntime(): void {
  if (installed) return;
  installed = true;

  registerKernelRuntimes();

  installIdentityChangedBridge();
  installNavigationBadgeProjection();

  installRuntime(socialRuntime.id);
  installRuntime(appletsRuntime.id);
  void bootstrapRuntime(appletsRuntime.id, null);

  installMediaRuntime();

  void installPresenceBridge();
  void installEventStreamBridge();
  void installSessionKickBridge();

  log.info('appRuntime', 'early runtime installed');
}

export function installDeferredAppRuntimeProjections(actorId: string): Promise<void> {
  if (deferredInstalled) return Promise.resolve();
  if (deferredInstallInFlight) return deferredInstallInFlight;

  installAppRuntime();

  deferredInstallInFlight = (async () => {
    await bootstrapRuntime(socialRuntime.id, actorId);

    const installedRuntimes: string[] = [];
    for (const runtimeId of DEFERRED_APP_RUNTIME_IDS) {
      installRuntime(runtimeId);
      await bootstrapRuntime(runtimeId, null);
      installedRuntimes.push(runtimeId);
      await yieldToRenderer();
    }
    deferredInstalled = true;
    log.info('appRuntime', 'deferred projections installed', { installed: installedRuntimes });
  })().finally(() => {
    deferredInstallInFlight = null;
  });

  return deferredInstallInFlight;
}

export function teardownAppRuntime(): void {
  if (!installed) return;
  installed = false;
  deferredInstalled = false;
  deferredInstallInFlight = null;

  teardownRuntime(socialRuntime.id);
  teardownRuntime(searchRuntime.id);
  teardownRuntime(settingsRuntime.id);
  teardownRuntime(federationRuntime.id);
  teardownRuntime(appletsRuntime.id);
  teardownRuntime(momentsRuntime.id);
  teardownRuntime(agentCapabilityRuntime.id);
  teardownRuntime(agentTopicRuntime.id);
  teardownRuntime(messagingRecoveryRuntime.id);
  teardownMediaRuntime();
  teardownNavigationBadgeProjection();
  teardownSessionKickBridge();
  teardownEventStreamBridge();
  teardownPresenceBridge();

  log.info('appRuntime', 'runtime torn down');
}
