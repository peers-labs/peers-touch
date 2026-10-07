/**
 * Mobile runtime registry — registry of all MobileRuntimeDescriptors.
 *
 * Each runtime declares its identity, dependencies, and lifecycle hooks.
 * The lifecycle kernel uses this registry to bootstrap, suspend, resume,
 * and teardown runtimes in correct dependency order.
 *
 * Migration note: This replaces the previous static RuntimeDescriptor[]
 * with live MobileRuntimeDescriptor implementations that own their lifecycle.
 */

import type {
  LifecycleKernelSnapshot,
  MobileLaunchState,
  MobileRuntimeContext,
  MobileRuntimeDescriptor,
  RuntimeOperationResult,
} from '../app/lifecycle/types';
import {
  clearAllScrollPositions,
  findNavigationDescriptor,
  readMobileNavigationProjection,
  resetMobileNavigation,
} from '../app/navigation';
import {
  isAccessGranted,
  type AccessDecision,
  type MobileAuthSession,
} from '../features/auth/authSession';
import { isMobileAuthSessionValid } from '../features/auth/mobileAuthIdentity';
import { useAuthStore } from '../features/auth/authStore';
import {
  activeStationEntry,
} from '../features/station/stationRegistry';
import {
  startSocialRuntime,
  type SocialRuntimeController,
} from '../features/social/socialRuntime';
import { useSocialStore } from '../features/social/socialStore';
import {
  createAuthRuntimeDescriptor,
  fenceAuthRuntimeProjection,
} from './authRuntime';
import {
  createAccessRuntimeDescriptor,
  fenceAccessRuntimeProjection,
} from './accessRuntime';
import { createDeviceSettingsRuntimeDescriptor } from './deviceSettingsRuntime';
import { installMobileNativeEventBridge } from './mobileNativeEventBridge';
import { fetchLifecycleGeneration } from './nativeLifecycleBridge';
import { createMessagingRuntimeDescriptor } from './messagingRuntime';
import { createChatStorageRuntimeDescriptor } from './chatStorageRuntime';
import { createPrivateMomentsRuntimeDescriptor } from './privateMomentsRuntime';
import { runRuntimeSessionTransition } from './runtimeSessionTransition';
import {
  createSessionRuntimeDescriptor,
  fenceSessionRuntimeProjection,
  readActiveSessionProjection,
} from './sessionRuntime';
import {
  activateReliabilityRuntime,
  applyReliabilityProjectionCheckpoints,
  closeReliabilityScope,
  getDraftRestorationPort,
  listReliabilityCommands,
  nextReliabilityRetryDelay,
  openReliabilityAdmission,
  readReliabilityRuntimeStatus,
  reconcileReliableFriendRequests,
  reconcileReliableSocialRelationships,
  reliabilityCommandRecoveryActions,
  registerReliabilityReconciliationWake,
  rebindReliabilityGeneration,
  suspendReliabilityRuntime,
  type CommandProjection,
} from './commandRuntime';
import {
  getRecoveryProjection,
  destroyRecoveryProjection,
} from './recoveryProjection';
import {
  bootstrapStationRuntime,
  readStationRegistryProjection,
} from './stationRuntime';

// --- Secure Storage Runtime Descriptor ---

function createSecureStorageDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'secure-storage',
    title: 'Secure Storage Runtime',
    responsibility:
      'Provides encrypted key-value storage via platform secure storage APIs. Must be available before auth.',
    dependsOn: [],

    async bootstrap(): Promise<void> {
      // Secure storage is initialized via the platform adapter.
      // The smoke test is run during platform creation (createTauriMobilePlatform).
    },

    async suspend(): Promise<void> {
      // Secure storage is passive — no suspend action needed.
    },

    async resume(): Promise<void> {
      // Secure storage is passive — no resume action needed.
    },

    async teardown(): Promise<RuntimeOperationResult> {
      return {
        runtimeId: 'secure-storage',
        success: true,
        durationMs: 0,
      };
    },
  };
}

// --- Station Runtime Descriptor ---

function createStationRuntimeDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'station',
    title: 'Station Runtime',
    responsibility:
      'Owns the serialized device-local Station registry and its observable handshake projection.',
    dependsOn: ['secure-storage'],

    async bootstrap(): Promise<void> {
      await bootstrapStationRuntime();
    },

    async suspend(): Promise<void> {
      // The app-scoped registry has no active resource to suspend.
    },

    async resume(): Promise<void> {
      await bootstrapStationRuntime();
    },

    async teardown(): Promise<RuntimeOperationResult> {
      return {
        runtimeId: 'station',
        success: true,
        durationMs: 0,
      };
    },
  };
}

// --- Native Event Bridge Runtime Descriptor ---

let appNativeEventBridge:
  ReturnType<typeof installMobileNativeEventBridge> | null = null;

function createNativeEventBridgeDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'native-event-bridge',
    title: 'Native Event Bridge',
    responsibility:
      'Routes native push, deep-link, resume, and network wakeups into runtime-owned reconciliation.',
    dependsOn: ['auth'],

    async bootstrap(): Promise<void> {
      appNativeEventBridge ??= installMobileNativeEventBridge();
      await appNativeEventBridge.ready;
    },

    async suspend(): Promise<void> {
      // Bridge listeners remain installed during suspend;
      // native events that arrive while suspended are buffered by the OS.
    },

    async resume(): Promise<void> {
      // Bridge is still installed — no action needed.
      // Resume events from native side flow through the existing listeners.
    },

    async teardown(context): Promise<RuntimeOperationResult> {
      const start = performance.now();
      try {
        if (context.reason === 'app-unmount') {
          await appNativeEventBridge?.teardown();
          appNativeEventBridge = null;
        }
        return {
          runtimeId: 'native-event-bridge',
          success: true,
          durationMs: performance.now() - start,
        };
      } catch (error) {
        return {
          runtimeId: 'native-event-bridge',
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
          durationMs: performance.now() - start,
        };
      }
    },
  };
}

// --- Social Runtime Descriptor ---

function createSocialRuntimeDescriptor(): MobileRuntimeDescriptor {
  let controller: SocialRuntimeController | null = null;
  let unsubscribe: (() => void) | null = null;
  let suspended = false;
  let lifecycleRevision = 0;
  let transition: Promise<void> = Promise.resolve();
  let runtimeContext: MobileRuntimeContext;

  const synchronize: RuntimeSessionOperation = async (session, isCurrent) => {
    const previousController = controller;
    await previousController?.teardown();
    await previousController?.drain();
    controller = null;
    if (!isCurrent()) return;
    useSocialStore.getState().bindSession(session);
    if (!session || suspended) return;
    controller = await startSocialRuntime(
      session,
      useSocialStore.getState,
    );
    if (!isCurrent()) {
      await controller.teardown();
      await controller.drain();
      controller = null;
      return;
    }
    await applyReliabilityProjectionCheckpoints(
      session.stationPeerId,
      session.actorRef.ptid,
      await fetchLifecycleGeneration(),
      () => useSocialStore.getState().refreshFriendRequests(),
    );
  };

  const enqueueSession = (
    session: MobileAuthSession | null,
    operation: RuntimeSessionOperation = synchronize,
  ) => {
    const task = runRuntimeSessionTransition({
      previous: transition,
      context: runtimeContext,
      isScopeCurrent: () => runtimeSessionKey(admittedRuntimeSession(useAuthStore.getState())) === runtimeSessionKey(session),
      run: (isCurrent) => operation(session, isCurrent),
      onError: (error) => reportRuntimeDescriptorError('social', error),
    });
    transition = task.catch(() => undefined);
    return task;
  };

  return {
    id: 'social',
    title: 'Social Runtime',
    responsibility:
      'Owns the single session-scoped Social ingress, contacts, notifications, presence, Moments/profile freshness, cursor repair, and reconciliation.',
    dependsOn: ['session', 'native-event-bridge', 'messaging', 'command'],

    async bootstrap(context): Promise<void> {
      runtimeContext = context;
      lifecycleRevision += 1;
      suspended = false;
      unsubscribe = useAuthStore.subscribe((state, previous) => {
        const session = admittedRuntimeSession(state);
        const previousSession = admittedRuntimeSession(previous);
        if (runtimeSessionKey(session) === runtimeSessionKey(previousSession)) return;
        enqueueSession(session);
      });
      await enqueueSession(admittedRuntimeSession(useAuthStore.getState()));
    },

    async suspend(): Promise<void> {
      const revision = ++lifecycleRevision;
      suspended = true;
      await transition;
      if (revision !== lifecycleRevision || !suspended) return;
      const activeController = controller;
      await activeController?.suspend();
      if (!activeController || revision === lifecycleRevision) return;
      await transition;
      if (controller === activeController && !suspended) {
        await activeController.resume();
      }
    },

    async resume(context): Promise<void> {
      runtimeContext = context;
      lifecycleRevision += 1;
      suspended = false;
      const session = admittedRuntimeSession(useAuthStore.getState());
      await enqueueSession(session, async (activeSession, isCurrent) => {
        if (controller && activeSession) {
          useSocialStore.getState().bindSession(activeSession);
          await controller.resume();
        } else {
          await synchronize(activeSession, isCurrent);
        }
      });
    },

    async teardown(): Promise<RuntimeOperationResult> {
      const start = performance.now();
      unsubscribe?.();
      unsubscribe = null;
      lifecycleRevision += 1;
      suspended = true;
      await transition;
      const activeController = controller;
      await activeController?.teardown();
      await activeController?.drain();
      controller = null;
      useSocialStore.getState().bindSession(null);
      return {
        runtimeId: 'social',
        success: true,
        durationMs: performance.now() - start,
      };
    },
  };
}


// --- Command Runtime Descriptor ---

function requiresDraftDisposition(
  reason: Parameters<MobileRuntimeDescriptor['teardown']>[0]['reason'],
): boolean {
  return reason === 'station-replace'
    || reason === 'actor-replace'
    || reason === 'logout';
}

async function refreshReliabilityRecoveryProjection(
  session: MobileAuthSession,
  generation: number,
  isCurrent: () => boolean,
): Promise<CommandProjection[]> {
  const [commands, drafts, status] = await Promise.all([
    listReliabilityCommands(session.stationPeerId, session.actorRef.ptid, generation),
    getDraftRestorationPort().list(session.stationPeerId, session.actorRef.ptid),
    readReliabilityRuntimeStatus(),
  ]);
  if (!isCurrent()) return [];
  if (
    !status.active
    || status.stationPeerId !== session.stationPeerId
    || status.actorPtid !== session.actorRef.ptid
    || status.runtimeGeneration !== generation
  ) {
    throw new Error('mobile.reliability.scopeTransitionRequired');
  }
  const projection = getRecoveryProjection();
  projection.reportCommandRecovery(
    commands.filter(
      (command) => reliabilityCommandRecoveryActions(command).length > 0,
    ),
  );
  projection.reportCapacityReadOnly(status.commandCapacity);
  if (drafts.length > 0) {
    projection.reportDraftRestorePending(drafts);
  } else {
    projection.clearDraftRestore();
  }
  return commands;
}

function createCommandRuntimeDescriptor(): MobileRuntimeDescriptor {
  let unsubscribe: (() => void) | null = null;
  let unregisterReconciliationWake: (() => void) | null = null;
  let retryTimer: number | null = null;
  let transition: Promise<void> = Promise.resolve();
  let suspended = false;
  let runtimeContext: MobileRuntimeContext;

  const clearRetryTimer = () => {
    if (retryTimer === null) return;
    window.clearTimeout(retryTimer);
    retryTimer = null;
  };

  const scheduleRetry = (commands: readonly CommandProjection[]) => {
    clearRetryTimer();
    if (suspended) return;
    const delay = nextReliabilityRetryDelay(commands, Date.now());
    if (delay === null) return;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      enqueueActiveReconciliation();
    }, delay);
  };

  const reconcileActive = async (
    session: MobileAuthSession,
    generation: number,
    isCurrent: () => boolean,
  ) => {
    await reconcileReliableFriendRequests(
      session.stationPeerId,
      session.actorRef.ptid,
    );
    await reconcileReliableSocialRelationships(
      session.stationPeerId,
      session.actorRef.ptid,
    );
    if (!isCurrent()) return;
    if (
      runtimeSessionKey(useSocialStore.getState().authSession)
      === runtimeSessionKey(session)
    ) {
      await applyReliabilityProjectionCheckpoints(
        session.stationPeerId,
        session.actorRef.ptid,
        generation,
        () => useSocialStore.getState().refreshFriendRequests(),
      );
    }
    if (!isCurrent()) return;
    const commands = await refreshReliabilityRecoveryProjection(
      session, generation, isCurrent,
    );
    if (isCurrent()) scheduleRetry(commands);
  };

  const synchronize: RuntimeSessionOperation = async (session, isCurrent) => {
    if (suspended) {
      clearRetryTimer();
      return;
    }
    const current = await readReliabilityRuntimeStatus();
    if (!isCurrent()) return;
    if (!session) {
      clearRetryTimer();
      if (current.active) {
        throw new Error('mobile.reliability.scopeTransitionRequired');
      }
      return;
    }
    if (
      current.active
      && (
        current.stationPeerId !== session.stationPeerId
        || current.actorPtid !== session.actorRef.ptid
      )
    ) {
      throw new Error('mobile.reliability.scopeTransitionRequired');
    }
    const generation = await fetchLifecycleGeneration();
    if (!isCurrent()) return;
    const status = await activateReliabilityRuntime(
      session.stationPeerId,
      session.actorRef.ptid,
      generation,
    );
    if (!isCurrent()) return;
    if (!status.active) {
      if (status.recoveryState === 'legacy-disposition-required') {
        getRecoveryProjection().clearReliabilityResetRecovery();
        getRecoveryProjection().reportLegacyReliabilityRecovery(
          status.archivedLegacyFiles,
        );
      } else if (status.recoveryState === 'reset-incomplete') {
        getRecoveryProjection().clearLegacyReliabilityRecovery();
        getRecoveryProjection().reportReliabilityResetRecovery();
      }
      throw new Error(
        status.recoveryState === 'legacy-disposition-required'
          ? 'mobile.reliability.legacyDispositionRequired'
          : status.recoveryState === 'reset-incomplete'
            ? 'mobile.reliability.resetIncomplete'
          : 'mobile.reliability.activationFailed',
      );
    }
    getRecoveryProjection().clearLegacyReliabilityRecovery();
    getRecoveryProjection().clearReliabilityResetRecovery();
    await reconcileActive(session, generation, isCurrent);
    if (!isCurrent()) return;
    await openReliabilityAdmission(
      session.stationPeerId,
      session.actorRef.ptid,
      generation,
    );
  };

  const enqueueSession = (
    session: MobileAuthSession | null,
    operation: RuntimeSessionOperation = synchronize,
  ) => {
    const task = runRuntimeSessionTransition({
      previous: transition,
      context: runtimeContext,
      isScopeCurrent: () => runtimeSessionKey(admittedRuntimeSession(useAuthStore.getState())) === runtimeSessionKey(session),
      run: (isCurrent) => operation(session, isCurrent),
      onError: (error) => reportRuntimeDescriptorError('command', error),
    });
    transition = task.catch(() => undefined);
    return task;
  };

  const enqueueActiveReconciliation = () => {
    if (suspended) return;
    const session = admittedRuntimeSession(useAuthStore.getState());
    if (!session) return;
    void enqueueSession(session, async (activeSession, isCurrent) => {
      if (!activeSession) return;
      const generation = await fetchLifecycleGeneration();
      if (!isCurrent()) return;
      await reconcileActive(activeSession, generation, isCurrent);
    });
  };

  return {
    id: 'command',
    title: 'Command Runtime',
    responsibility:
      'Owns non-messaging command admission, encrypted ledger persistence, four-key fair dispatch, pending/failed/unknown projection, and draft restoration.',
    dependsOn: ['session', 'secure-storage', 'messaging'],

    async bootstrap(context): Promise<void> {
      runtimeContext = context;
      suspended = false;
      unregisterReconciliationWake =
        registerReliabilityReconciliationWake(enqueueActiveReconciliation);
      unsubscribe = useAuthStore.subscribe((state, previous) => {
        const session = admittedRuntimeSession(state);
        const previousSession = admittedRuntimeSession(previous);
        if (runtimeSessionKey(session) === runtimeSessionKey(previousSession)) return;
        enqueueSession(session);
      });
      await enqueueSession(admittedRuntimeSession(useAuthStore.getState()));
    },

    async suspend(): Promise<void> {
      suspended = true;
      clearRetryTimer();
      await transition;
      const status = await readReliabilityRuntimeStatus();
      if (status.active) await suspendReliabilityRuntime();
    },

    async resume(context): Promise<void> {
      runtimeContext = context;
      suspended = false;
      const session = admittedRuntimeSession(useAuthStore.getState());
      await enqueueSession(session, async (activeSession, isCurrent) => {
        if (!activeSession) return;
        const generation = await fetchLifecycleGeneration();
        if (!isCurrent()) return;
        await rebindReliabilityGeneration(
          activeSession.stationPeerId, activeSession.actorRef.ptid, generation,
        );
        if (!isCurrent()) return;
        await reconcileActive(activeSession, generation, isCurrent);
        if (!isCurrent()) return;
        await openReliabilityAdmission(
          activeSession.stationPeerId, activeSession.actorRef.ptid, generation,
        );
      });
    },

    async teardown(context): Promise<RuntimeOperationResult> {
      const start = performance.now();
      unsubscribe?.();
      unsubscribe = null;
      unregisterReconciliationWake?.();
      unregisterReconciliationWake = null;
      clearRetryTimer();
      suspended = true;
      await transition;
      const status = await readReliabilityRuntimeStatus();
      if (status.active) {
        if (
          requiresDraftDisposition(context.reason)
          && status.draftCount > 0
          && !context.draftDisposition
        ) {
          throw new Error('mobile.reliability.draftDispositionRequired');
        }
        const disposition = context.reason === 'revocation'
          ? 'retain'
          : context.draftDisposition ?? (
              requiresDraftDisposition(context.reason) ? 'discard' : 'retain'
            );
        await closeReliabilityScope(disposition);
      }
      return {
        runtimeId: 'command',
        success: true,
        durationMs: performance.now() - start,
      };
    },
  };
}

// --- Avatar Asset Runtime Descriptor ---

function createAvatarAssetRuntimeDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'avatar-asset',
    title: 'Avatar Asset Runtime',
    responsibility:
      'Manages avatar image download, caching, and data-URL projection for all peer avatars.',
    dependsOn: ['session'],

    async bootstrap(): Promise<void> {
      // Avatar asset runtime is reactive — it initializes lazily
      // when the first useAvatarAsset hook subscribes.
    },

    async suspend(): Promise<void> {
      // In-flight downloads continue; no explicit suspend needed.
    },

    async resume(): Promise<void> {
      // Stale avatars will be re-fetched when components re-subscribe.
    },

    async teardown(): Promise<RuntimeOperationResult> {
      return {
        runtimeId: 'avatar-asset',
        success: true,
        durationMs: 0,
      };
    },
  };
}

// --- W6D: Recovery Projection Runtime Descriptor ---

function createRecoveryProjectionDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'recovery-projection',
    title: 'Recovery Projection',
    responsibility:
      'W6D aggregated recovery and degraded-state projection. Subscribes to lifecycle kernel ' +
      'events and runtime failure signals to produce a unified recovery snapshot consumed by ' +
      'overlay components. Does not own retry, persistence, or lifecycle — delegates to runtime owners.',
    dependsOn: ['session', 'command', 'social'],

    async bootstrap(): Promise<void> {
      // Recovery projection initializes by reading the current kernel state
      // and subscribing to runtime status changes. Actual wiring happens
      // through the RecoveryOverlayHost component and runtime event callbacks.
      const projection = getRecoveryProjection();
      // Ensure the projection is live — the singleton is created lazily.
      void projection.getSnapshot();
    },

    async suspend(): Promise<void> {
      // Recovery projection is passive — overlay host will unmount.
    },

    async resume(): Promise<void> {
      // On resume, the overlay host re-subscribes and re-reads the snapshot.
    },

    async teardown(): Promise<RuntimeOperationResult> {
      const start = performance.now();
      destroyRecoveryProjection();
      return {
        runtimeId: 'recovery-projection',
        success: true,
        durationMs: performance.now() - start,
      };
    },
  };
}

// --- Registry Factory ---

/**
 * Build the complete set of mobile runtime descriptors.
 *
 * Returns descriptors in declaration order — the kernel will compute
 * the actual bootstrap order via topological sort on `dependsOn`.
 */
export function createMobileRuntimeDescriptors(): MobileRuntimeDescriptor[] {
  return [
    createDeviceSettingsRuntimeDescriptor(),
    createSecureStorageDescriptor(),
    createStationRuntimeDescriptor(),
    createAuthRuntimeDescriptor(),
    createAccessRuntimeDescriptor(),
    createSessionRuntimeDescriptor(),
    createNativeEventBridgeDescriptor(),
    createMessagingRuntimeDescriptor(),
    createChatStorageRuntimeDescriptor(),
    createCommandRuntimeDescriptor(),
    createSocialRuntimeDescriptor(),
    createPrivateMomentsRuntimeDescriptor(),
    createAvatarAssetRuntimeDescriptor(),
    createRecoveryProjectionDescriptor(),
  ];
}

export function fenceMobileRuntimeProjections(): void {
  fenceAuthRuntimeProjection();
  fenceAccessRuntimeProjection();
  fenceSessionRuntimeProjection();
  resetMobileNavigation();
  useSocialStore.getState().bindSession(null);
  destroyRecoveryProjection();
  clearAllScrollPositions();
}

const SHELL_BLOCKING_RUNTIME_IDS = [
  'secure-storage',
  'station',
  'auth',
  'access',
  'session',
] as const;

interface MobileLaunchAdmissionInput {
  readonly stationPeerId: string | null;
  readonly accessDecision: AccessDecision | null;
  readonly session: MobileAuthSession | null;
  readonly lifecycle: Pick<LifecycleKernelSnapshot, 'phase' | 'runtimes'>;
  readonly navigationHostReady: boolean;
  readonly now?: number;
}

export function resolveMobileLaunchStateFromState(
  input: MobileLaunchAdmissionInput,
): MobileLaunchState {
  if (!input.stationPeerId) return 'station-selection';

  if (
    !isAccessGranted(input.accessDecision)
    || !isMobileAuthSessionValid(input.session, input.now)
    || input.session.stationPeerId !== input.stationPeerId
  ) {
    return input.accessDecision
      ? 'access-gate-chain'
      : 'station-selection';
  }

  const runtimeById = new Map(
    input.lifecycle.runtimes.map((runtime) => [runtime.id, runtime]),
  );
  const criticalRuntimesReady = SHELL_BLOCKING_RUNTIME_IDS.every(
    (runtimeId) => runtimeById.get(runtimeId)?.status === 'ready',
  );
  if (
    input.lifecycle.phase !== 'ACTIVE'
    || !criticalRuntimesReady
    || !input.navigationHostReady
  ) {
    return 'runtime-critical';
  }
  return 'shell';
}

export async function resolveMobileLaunchState(
  lifecycle: LifecycleKernelSnapshot,
): Promise<MobileLaunchState> {
  const station = activeStationEntry(
    await readStationRegistryProjection(),
  );
  const auth = useAuthStore.getState();
  const navigation = readMobileNavigationProjection();
  return resolveMobileLaunchStateFromState({
    stationPeerId: station?.stationPeerId ?? null,
    accessDecision: auth.accessDecision,
    session: auth.session,
    lifecycle,
    navigationHostReady: Boolean(
      findNavigationDescriptor(navigation.primaryRouteId),
    ),
  });
}

export function readMobileRuntimeScopeProjection() {
  const auth = readActiveSessionProjection();
  const social = useSocialStore.getState();
  const navigation = readMobileNavigationProjection();

  return {
    activeStationPeerId: auth?.stationPeerId ?? null,
    activeActorPtid: auth?.actorPtid ?? null,
    deviceId: auth?.deviceId ?? null,
    social: {
      stationPeerId: social.authSession?.stationPeerId ?? null,
      actorPtid: social.currentUserPtid,
      sessionCount: social.sessions.length,
      requestCount: social.friendRequests.length,
      messageThreadCount: Object.keys(social.messages).length,
    },
    group: {
      stationPeerId: social.authSession?.stationPeerId ?? null,
      actorPtid: social.currentUserPtid,
      groupCount: social.messagingConversations.filter(
        (conversation) => conversation.active && conversation.kind === 2,
      ).length,
      messageThreadCount: Object.keys(social.messages).filter((conversationId) =>
        social.messagingConversations.some(
          (conversation) => (
            conversation.kind === 2
            && conversation.conversationId === conversationId
          ),
        )).length,
    },
    navigation: {
      primaryRouteId: navigation.primaryRouteId,
      detailKeys: [...navigation.detailKeys],
      overlayRouteId: navigation.overlayRouteId,
    },
  };
}

function runtimeSessionKey(session: MobileAuthSession | null): string {
  return session
    ? `${session.stationPeerId}\u001f${session.actorRef.ptid}\u001f${session.sessionId}`
    : '';
}

function admittedRuntimeSession(
  state: ReturnType<typeof useAuthStore.getState>,
): MobileAuthSession | null {
  return isAccessGranted(state.accessDecision)
    && isMobileAuthSessionValid(state.session)
    ? state.session
    : null;
}

type RuntimeSessionOperation = (
  session: MobileAuthSession | null,
  isCurrent: () => boolean,
) => Promise<void>;

function reportRuntimeDescriptorError(runtimeId: string, error: unknown): void {

  window.dispatchEvent(
    new CustomEvent('mobile-runtime-descriptor:error', {
      detail: {
        runtimeId,
        message: error instanceof Error ? error.message : String(error),
      },
    }),
  );
}
