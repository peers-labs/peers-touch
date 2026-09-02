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

import type { MobileRuntimeDescriptor, RuntimeOperationResult } from '../app/lifecycle/types';
import { installMobileNativeEventBridge } from './mobileNativeEventBridge';
import {
  getRecoveryProjection,
  destroyRecoveryProjection,
} from './recoveryProjection';

// --- Auth Runtime Descriptor ---

function createAuthRuntimeDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'auth',
    title: 'Auth Runtime',
    responsibility:
      'Owns Station-scoped credential attempts, OAuth callbacks, candidate isolation, cancellation, and typed recovery.',
    dependsOn: ['secure-storage'],

    async bootstrap(): Promise<void> {
      // Auth runtime initializes through the auth store's restoreSession.
      // Actual session restore is triggered by the kernel orchestrator after
      // all dependencies (secure-storage) are ready.
    },

    async suspend(): Promise<void> {
      // Auth state is persisted — no active streams to pause.
    },

    async resume(): Promise<void> {
      // Session validity is checked when the shell re-activates.
    },

    async teardown(): Promise<RuntimeOperationResult> {
      const start = performance.now();
      return {
        runtimeId: 'auth',
        success: true,
        durationMs: performance.now() - start,
      };
    },
  };
}

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

// --- Native Event Bridge Runtime Descriptor ---

function createNativeEventBridgeDescriptor(): MobileRuntimeDescriptor {
  let teardownBridge: (() => void) | null = null;

  return {
    id: 'native-event-bridge',
    title: 'Native Event Bridge',
    responsibility:
      'Routes native push, deep-link, resume, and network wakeups into runtime-owned reconciliation.',
    dependsOn: ['auth'],

    async bootstrap(): Promise<void> {
      teardownBridge = installMobileNativeEventBridge();
    },

    async suspend(): Promise<void> {
      // Bridge listeners remain installed during suspend;
      // native events that arrive while suspended are buffered by the OS.
    },

    async resume(): Promise<void> {
      // Bridge is still installed — no action needed.
      // Resume events from native side flow through the existing listeners.
    },

    async teardown(): Promise<RuntimeOperationResult> {
      const start = performance.now();
      try {
        teardownBridge?.();
        teardownBridge = null;
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
  return {
    id: 'social',
    title: 'Social Runtime',
    responsibility:
      'Owns friend chat, contacts, notifications, realtime streams, presence, typing, and reconcile projection.',
    dependsOn: ['auth', 'native-event-bridge'],

    async bootstrap(): Promise<void> {
      // Social runtime bootstraps through useSocialRuntime hook
      // which starts when the shell mounts with a valid session.
      // The descriptor declares the dependency order;
      // actual stream start is session-gated.
    },

    async suspend(): Promise<void> {
      // Social streams and timers are paused during suspend.
      // The hook teardown handles this.
    },

    async resume(): Promise<void> {
      // Reconciliation is triggered on resume via the native event bridge.
    },

    async teardown(): Promise<RuntimeOperationResult> {
      return {
        runtimeId: 'social',
        success: true,
        durationMs: 0,
      };
    },
  };
}

// --- Group Runtime Descriptor ---

function createGroupRuntimeDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'group',
    title: 'Group Runtime',
    responsibility:
      'Owns group list, group members, group messages, unread counts, and reconcile projection.',
    dependsOn: ['auth', 'social'],

    async bootstrap(): Promise<void> {
      // Group runtime starts alongside social runtime.
    },

    async suspend(): Promise<void> {
      // Group streams are paused with social runtime.
    },

    async resume(): Promise<void> {
      // Group reconciliation triggers through the social runtime resume.
    },

    async teardown(): Promise<RuntimeOperationResult> {
      return {
        runtimeId: 'group',
        success: true,
        durationMs: 0,
      };
    },
  };
}

// --- Command Runtime Descriptor ---

function createCommandRuntimeDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'command',
    title: 'Command Runtime',
    responsibility:
      'Owns command admission, encrypted ledger persistence, four-key fair dispatch, pending/failed/unknown projection, and draft restoration.',
    dependsOn: ['auth', 'secure-storage'],

    async bootstrap(): Promise<void> {
      // Command runtime is initialized by the lifecycle kernel after
      // auth provides the session and secure-storage is ready.
      // Actual init is session-gated: the kernel calls
      // getInteractionAdmission().initialize() with the actor's
      // encryption secret once authentication completes.
    },

    async suspend(): Promise<void> {
      // Ledger state is persisted — no active dispatch to pause.
      // Pending commands remain in the SQLite database.
    },

    async resume(): Promise<void> {
      // On resume, the kernel may trigger a readback to refresh
      // pending/failed/unknown projections in the UI.
    },

    async teardown(): Promise<RuntimeOperationResult> {
      const start = performance.now();
      // The lifecycle kernel is responsible for calling shutdown()
      // on both the InteractionAdmission and DraftRestorationPort.
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
    dependsOn: ['auth'],

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

// --- W5: Social Projection Descriptor (converged ingress owner) ---

function createSocialProjectionRuntimeDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'social-projection',
    title: 'Social Projection',
    responsibility:
      'W5 converged projection owner for Social, Group, Moments, Notification, and Profile. ' +
      'Routes all domain events through the shared typed ingress with capacity control, ' +
      'cursor repair, and session revalidation. Group remains a subordinate descriptor.',
    dependsOn: ['auth', 'social', 'group'],

    async bootstrap(): Promise<void> {
      // Social projection bootstraps after social and group runtimes are ready.
      // It creates the shared ingress and wires event routing.
    },

    async suspend(): Promise<void> {
      // Ingress pauses event acceptance during suspend.
    },

    async resume(): Promise<void> {
      // On resume, the ingress reopens admission and triggers reconciliation.
    },

    async teardown(): Promise<RuntimeOperationResult> {
      return {
        runtimeId: 'social-projection',
        success: true,
        durationMs: 0,
      };
    },
  };
}

// --- W5: Moments Projection Descriptor ---

function createMomentsProjectionRuntimeDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'moments-projection',
    title: 'Moments Projection',
    responsibility:
      'Owns Moments/timeline feed state, post ingestion, and cursor-based pagination via shared social ingress.',
    dependsOn: ['social-projection'],

    async bootstrap(): Promise<void> {
      // Moments projection starts after the shared ingress is available.
    },

    async suspend(): Promise<void> {
      // Timeline feed is static — no streams to pause.
    },

    async resume(): Promise<void> {
      // Reconcile timeline cursor on resume.
    },

    async teardown(): Promise<RuntimeOperationResult> {
      return {
        runtimeId: 'moments-projection',
        success: true,
        durationMs: 0,
      };
    },
  };
}

// --- W5: Profile Projection Descriptor ---

function createProfileProjectionRuntimeDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'profile-projection',
    title: 'Profile Projection',
    responsibility:
      'Owns actor profile cache, relationship state, and MS-P05 account preference projection via shared social ingress.',
    dependsOn: ['social-projection'],

    async bootstrap(): Promise<void> {
      // Profile projection starts after the shared ingress is available.
    },

    async suspend(): Promise<void> {
      // Profile cache is passive — no streams to pause.
    },

    async resume(): Promise<void> {
      // Preferences may have changed server-side during suspend.
    },

    async teardown(): Promise<RuntimeOperationResult> {
      return {
        runtimeId: 'profile-projection',
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
    dependsOn: ['auth', 'command', 'social-projection'],

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
    createSecureStorageDescriptor(),
    createAuthRuntimeDescriptor(),
    createNativeEventBridgeDescriptor(),
    createCommandRuntimeDescriptor(),
    createSocialRuntimeDescriptor(),
    createGroupRuntimeDescriptor(),
    createSocialProjectionRuntimeDescriptor(),
    createMomentsProjectionRuntimeDescriptor(),
    createProfileProjectionRuntimeDescriptor(),
    createAvatarAssetRuntimeDescriptor(),
    createRecoveryProjectionDescriptor(),
  ];
}
