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
import { homeRuntime } from '../runtimes/homeRuntime';
import { appletsRuntime } from '../runtimes/appletsRuntime';
import { momentsRuntime } from '../runtimes/momentsRuntime';
import { agentCapabilityRuntime } from '../runtimes/agentCapabilityRuntime';
import { agentTopicRuntime } from '../runtimes/agentTopicRuntime';
import { messagingRecoveryRuntime } from '../runtimes/messagingRecoveryRuntime';
import { toolRuntime } from '../runtimes/toolRuntime';
import { chatRuntime } from '../runtimes/chatRuntime';
import { evaluationRuntime } from '../runtimes/evaluationRuntime';
import { chatStorageRuntime } from '../runtimes/chatStorageRuntime';
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
  registerRuntime(chatStorageRuntime);
  registerRuntime(searchRuntime);
  registerRuntime(settingsRuntime);
  registerRuntime(federationRuntime);
  registerRuntime(homeRuntime);
  registerRuntime(appletsRuntime);
  registerRuntime(momentsRuntime);
  registerRuntime(agentCapabilityRuntime);
  registerRuntime(agentTopicRuntime);
  registerRuntime(chatRuntime);
  registerRuntime(messagingRecoveryRuntime);
  registerRuntime(toolRuntime);
  registerRuntime(evaluationRuntime);
}

let installed = false;
let deferredInstalled = false;
let deferredInstallInFlight: Promise<void> | null = null;
let criticalInstallInFlight: {
  actorId: string;
  promise: Promise<void>;
} | null = null;

const DEFERRED_APP_RUNTIME_IDS = [
  searchRuntime.id,
  settingsRuntime.id,
  federationRuntime.id,
  momentsRuntime.id,
];

export const CRITICAL_SESSION_RUNTIME_IDS: ReadonlyArray<string> = [
  chatRuntime.id,
  homeRuntime.id,
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

export function installDeferredAppRuntimeProjections(actorPtid: string): Promise<void> {
  if (deferredInstalled) return Promise.resolve();
  if (deferredInstallInFlight) return deferredInstallInFlight;

  installAppRuntime();

  deferredInstallInFlight = (async () => {
    await bootstrapRuntime(socialRuntime.id, actorPtid);

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

export async function installAuthenticatedCriticalRuntimes(
  actorId: string,
): Promise<void> {
  // #region debug-point A:critical-bootstrap-entry
  await fetch('http://127.0.0.1:7781/event', { method: 'POST', body: JSON.stringify({ sessionId: 'messaging-scope-race', runId: 'post-fix', hypothesisId: 'A', location: 'apps/desktop/src/services/appRuntime.ts:critical-entry', msg: '[DEBUG] Critical runtime install requested', data: { actorPresent: Boolean(actorId), reusedInFlight: criticalInstallInFlight?.actorId === actorId }, ts: Date.now() }) }).catch(() => {});
  // #endregion
  if (criticalInstallInFlight?.actorId === actorId) {
    return criticalInstallInFlight.promise;
  }
  installAppRuntime();
  const promise = (async () => {
    for (const runtimeId of CRITICAL_SESSION_RUNTIME_IDS) {
      // #region debug-point A-D:critical-runtime-step
      await fetch('http://127.0.0.1:7781/event', { method: 'POST', body: JSON.stringify({ sessionId: 'messaging-scope-race', runId: 'post-fix', hypothesisId: 'A,D', location: 'apps/desktop/src/services/appRuntime.ts:runtime-start', msg: '[DEBUG] Critical runtime bootstrap started', data: { runtimeId }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      installRuntime(runtimeId);
      await bootstrapRuntime(runtimeId, actorId);
      // #region debug-point A-D:critical-runtime-step
      await fetch('http://127.0.0.1:7781/event', { method: 'POST', body: JSON.stringify({ sessionId: 'messaging-scope-race', runId: 'post-fix', hypothesisId: 'A,D', location: 'apps/desktop/src/services/appRuntime.ts:runtime-end', msg: '[DEBUG] Critical runtime bootstrap completed', data: { runtimeId }, ts: Date.now() }) }).catch(() => {});
      // #endregion
    }
  })();
  criticalInstallInFlight = { actorId, promise };
  try {
    await promise;
  } finally {
    if (criticalInstallInFlight?.promise === promise) {
      criticalInstallInFlight = null;
    }
  }
}

export function teardownAppRuntime(): void {
  if (!installed) return;
  installed = false;
  deferredInstalled = false;
  deferredInstallInFlight = null;
  criticalInstallInFlight = null;

  teardownRuntime(socialRuntime.id);
  teardownRuntime(chatStorageRuntime.id);
  teardownRuntime(searchRuntime.id);
  teardownRuntime(settingsRuntime.id);
  teardownRuntime(federationRuntime.id);
  teardownRuntime(homeRuntime.id);
  teardownRuntime(appletsRuntime.id);
  teardownRuntime(momentsRuntime.id);
  teardownRuntime(agentCapabilityRuntime.id);
  teardownRuntime(agentTopicRuntime.id);
  teardownRuntime(chatRuntime.id);
  teardownRuntime(messagingRecoveryRuntime.id);
  teardownRuntime(toolRuntime.id);
  teardownRuntime(evaluationRuntime.id);
  teardownMediaRuntime();
  teardownNavigationBadgeProjection();
  teardownSessionKickBridge();
  teardownEventStreamBridge();
  teardownPresenceBridge();

  log.info('appRuntime', 'runtime torn down');
}
