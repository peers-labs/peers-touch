// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

const socialRuntimeMocks = vi.hoisted(() => ({
  reconcileSocialRuntimeDomains: vi.fn(async () => undefined),
  startSocialRuntime: vi.fn(),
  installMobileNativeEventBridge: vi.fn(),
}));

vi.mock('../features/social/socialRuntime', () => ({
  reconcileSocialRuntimeDomains: socialRuntimeMocks.reconcileSocialRuntimeDomains,
  startSocialRuntime: socialRuntimeMocks.startSocialRuntime,
}));

vi.mock('./nativeLifecycleBridge', () => ({
  fetchLifecycleGeneration: vi.fn(async () => 1),
}));

vi.mock('./mobileNativeEventBridge', () => ({
  installMobileNativeEventBridge:
    socialRuntimeMocks.installMobileNativeEventBridge,
}));

vi.mock('./commandRuntime', () => ({
  activateReliabilityRuntime: vi.fn(),
  applyReliabilityProjectionCheckpoints: vi.fn(async () => 0),
  closeReliabilityScope: vi.fn(async () => undefined),
  getDraftRestorationPort: vi.fn(() => ({ list: vi.fn(async () => []) })),
  listReliabilityCommands: vi.fn(async () => []),
  nextReliabilityRetryDelay: vi.fn(() => null),
  openReliabilityAdmission: vi.fn(async () => undefined),
  readReliabilityRuntimeStatus: vi.fn(async () => ({
    active: false,
    runtimeGeneration: 0,
    admissionOpen: false,
    pendingCommands: 0,
    unknownCommands: 0,
    draftCount: 0,
    archivedLegacyFiles: 0,
    commandCapacity: {
      recordCount: 0,
      recordLimit: 512,
      byteUsage: 0,
      byteLimit: 16_777_216,
      exhaustionCauses: [],
    },
  })),
  reconcileReliableFriendRequests: vi.fn(async () => undefined),
  reliabilityCommandRecoveryActions: vi.fn(() => []),
  registerReliabilityReconciliationWake: vi.fn(() => () => undefined),
  rebindReliabilityGeneration: vi.fn(async () => undefined),
  suspendReliabilityRuntime: vi.fn(async () => undefined),
}));

import { ACCESS_DECISION_GRANTED } from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';
import {
  createMobileRuntimeDescriptors,
  resolveMobileLaunchStateFromState,
} from './runtimeRegistry';

describe('Mobile Shell admission', () => {
  it('admits only a granted valid session after critical runtimes are ready', () => {
    expect(resolveMobileLaunchStateFromState({
      stationPeerId: 'station-primary',
      accessDecision: grantedDecision(),
      session: mobileSession('ptid:alice', 'session-alice'),
      lifecycle: admissionLifecycle(),
      navigationHostReady: true,
    })).toBe('shell');
  });

  it('returns to the access chain for an expired or wrong-Station session', () => {
    expect(resolveMobileLaunchStateFromState({
      stationPeerId: 'station-primary',
      accessDecision: grantedDecision(),
      session: {
        ...mobileSession('ptid:alice', 'session-alice'),
        expiresAt: '2026-09-16T00:00:00.000Z',
      },
      lifecycle: admissionLifecycle(),
      navigationHostReady: true,
      now: Date.parse('2026-09-17T00:00:00.000Z'),
    })).toBe('access-gate-chain');

    expect(resolveMobileLaunchStateFromState({
      stationPeerId: 'station-other',
      accessDecision: grantedDecision(),
      session: mobileSession('ptid:alice', 'session-alice'),
      lifecycle: admissionLifecycle(),
      navigationHostReady: true,
    })).toBe('access-gate-chain');
  });

  it('does not admit a public native session projection as a Web business session', () => {
    expect(resolveMobileLaunchStateFromState({
      stationPeerId: 'station-primary',
      accessDecision: grantedDecision(),
      session: null,
      lifecycle: admissionLifecycle(),
      navigationHostReady: true,
    })).toBe('access-gate-chain');
  });

  it('keeps the launch state runtime-critical until every critical owner is ready', () => {
    expect(resolveMobileLaunchStateFromState({
      stationPeerId: 'station-primary',
      accessDecision: grantedDecision(),
      session: mobileSession('ptid:alice', 'session-alice'),
      lifecycle: admissionLifecycle('auth'),
      navigationHostReady: true,
    })).toBe('runtime-critical');
  });
});

describe('mobile runtime registry', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    useAuthStore.setState({
      session: null,
      accessDecision: null,
      loading: false,
      error: null,
      restored: false,
    });
    socialRuntimeMocks.installMobileNativeEventBridge.mockReset();
  });

  it('does not mark the native bridge bootstrapped before listener readiness', async () => {
    const readiness = Promise.withResolvers<void>();
    const teardown = vi.fn();
    socialRuntimeMocks.installMobileNativeEventBridge.mockReturnValue({
      ready: readiness.promise,
      teardown,
    });
    const nativeBridge = createMobileRuntimeDescriptors().find(
      (descriptor) => descriptor.id === 'native-event-bridge',
    );
    expect(nativeBridge).toBeDefined();

    let bootstrapped = false;
    const bootstrap = nativeBridge!.bootstrap(runtimeContext()).then(() => {
      bootstrapped = true;
    });
    await Promise.resolve();
    expect(bootstrapped).toBe(false);

    readiness.resolve();
    await bootstrap;
    expect(bootstrapped).toBe(true);
    await nativeBridge!.teardown({ reason: 'app-unmount' });
    expect(teardown).toHaveBeenCalledOnce();
  });

  it('keeps the app-installed native bridge across generation-fenced restarts', async () => {
    const teardown = vi.fn(async () => undefined);
    socialRuntimeMocks.installMobileNativeEventBridge.mockReturnValue({
      ready: Promise.resolve(),
      teardown,
    });
    const first = createMobileRuntimeDescriptors().find(
      (descriptor) => descriptor.id === 'native-event-bridge',
    );
    const replacement = createMobileRuntimeDescriptors().find(
      (descriptor) => descriptor.id === 'native-event-bridge',
    );

    await first!.bootstrap(runtimeContext());
    await first!.teardown({ reason: 'acceptance-restart' });
    await replacement!.bootstrap(runtimeContext());

    expect(socialRuntimeMocks.installMobileNativeEventBridge).toHaveBeenCalledOnce();
    expect(teardown).not.toHaveBeenCalled();

    await replacement!.teardown({ reason: 'app-unmount' });
    expect(teardown).toHaveBeenCalledOnce();
  });

  it('keeps Direct and Group under the single Messaging runtime', () => {
    const descriptors = createMobileRuntimeDescriptors();
    const ids = descriptors.map((descriptor) => descriptor.id);
    const deviceSettings = descriptors.find(
      (descriptor) => descriptor.id === 'device-settings',
    );
    const station = descriptors.find(
      (descriptor) => descriptor.id === 'station',
    );
    const auth = descriptors.find((descriptor) => descriptor.id === 'auth');
    const access = descriptors.find((descriptor) => descriptor.id === 'access');
    const session = descriptors.find((descriptor) => descriptor.id === 'session');
    const social = descriptors.find((descriptor) => descriptor.id === 'social');
    const messaging = descriptors.find(
      (descriptor) => descriptor.id === 'messaging',
    );
    const chatStorage = descriptors.find(
      (descriptor) => descriptor.id === 'chat-storage',
    );
    const recovery = descriptors.find(
      (descriptor) => descriptor.id === 'recovery-projection',
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(deviceSettings?.dependsOn).toEqual([]);
    expect(deviceSettings?.responsibility).toContain(
      'app-scoped device preference',
    );
    expect(station?.responsibility).toContain('serialized device-local Station registry');
    expect(auth?.dependsOn).toContain('station');
    expect(access?.dependsOn).toEqual(['station', 'auth']);
    expect(session?.dependsOn).toEqual(['station', 'auth', 'access']);
    expect(ids).not.toContain('social-projection');
    expect(ids).not.toContain('moments-projection');
    expect(ids).not.toContain('profile-projection');
    expect(social?.responsibility).toContain('single session-scoped Social ingress');
    expect(social?.dependsOn).toContain('session');
    expect(ids).not.toContain('group');
    expect(messaging?.dependsOn).toContain('session');
    expect(messaging?.responsibility).toContain('Device Messaging Engine');
    expect(chatStorage?.dependsOn).toEqual(['messaging']);
    expect(chatStorage?.responsibility).toContain('device-local Chat storage');
    expect(social?.dependsOn).toContain('messaging');
    expect(recovery?.dependsOn).toContain('social');
  });

  it('owns persisted Friend Request retry wakeups in the command runtime', () => {
    const registrySource = readFileSync(
      new URL('./runtimeRegistry.ts', import.meta.url),
      'utf8',
    );
    const commandSource = readFileSync(
      new URL('../services/mobileCommands.ts', import.meta.url),
      'utf8',
    );

    expect(registrySource).toMatch(
      /registerReliabilityReconciliationWake\(enqueueActiveReconciliation\)/,
    );
    expect(registrySource).toMatch(
      /nextReliabilityRetryDelay\(commands,\s*Date\.now\(\)\)/,
    );
    expect(registrySource).toMatch(
      /reconcileReliableFriendRequests\([\s\S]*applyReliabilityProjectionCheckpoints\(/,
    );
    expect(registrySource).toMatch(
      /window\.setTimeout\(\(\)\s*=>[\s\S]*enqueueActiveReconciliation\(\)/,
    );
    expect(commandSource).toMatch(
      /social_friend_request_send[\s\S]*notifyReliabilityCommandChanged\(\)/,
    );
    expect(commandSource).toMatch(
      /social_friend_request_accept[\s\S]*notifyReliabilityCommandChanged\(\)/,
    );
    expect(commandSource).toMatch(
      /social_friend_request_reject[\s\S]*notifyReliabilityCommandChanged\(\)/,
    );
    expect(registrySource).toMatch(
      /reliabilityCommandRecoveryActions\(command\)\.length > 0/,
    );
  });

  it('projects interrupted reliability reset before any scope can reopen', () => {
    const registrySource = readFileSync(
      new URL('./runtimeRegistry.ts', import.meta.url),
      'utf8',
    );

    expect(registrySource).toMatch(
      /status\.recoveryState === 'reset-incomplete'/,
    );
    expect(registrySource).toMatch(
      /reportReliabilityResetRecovery\(\)/,
    );
  });

  it('tears down and drains the old Social controller before session replacement', async () => {
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal('CustomEvent', class {
      constructor(
        readonly type: string,
        readonly init: unknown,
      ) {}
    });
    const order: string[] = [];
    const replacementStarted = Promise.withResolvers<void>();
    socialRuntimeMocks.startSocialRuntime.mockImplementation(async (session) => {
      order.push(`start:${session.actorRef.ptid}`);
      if (session.actorRef.ptid === 'ptid:bob') replacementStarted.resolve();
      return {
        suspend: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
        teardown: vi.fn(async () => {
          order.push(`teardown:${session.actorRef.ptid}`);
        }),
        drain: vi.fn(async () => {
          order.push(`drain:${session.actorRef.ptid}`);
        }),
      };
    });

    const alice = mobileSession('ptid:alice', 'session-alice');
    const bob = mobileSession('ptid:bob', 'session-bob');
    useAuthStore.setState({
      session: alice,
      accessDecision: grantedDecision(),
    });
    const social = createMobileRuntimeDescriptors().find(
      (descriptor) => descriptor.id === 'social',
    );
    expect(social).toBeDefined();

    await social!.bootstrap(runtimeContext());
    useAuthStore.setState({
      session: bob,
      accessDecision: grantedDecision(),
    });
    await replacementStarted.promise;

    expect(order).toEqual([
      'start:ptid:alice',
      'teardown:ptid:alice',
      'drain:ptid:alice',
      'start:ptid:bob',
    ]);

    await social!.teardown({ reason: 'app-unmount' });
  });
});

function mobileSession(ptid: string, sessionId: string) {
  return {
    stationPeerId: 'station-primary',
    stationUrl: 'https://station.example',
    sessionId,
    deviceId: 'device-1',
    lifecycleGeneration: 1,
    actorRef: { ptid },
    authenticatedAt: 1,
  };
}

function grantedDecision() {
  return {
    state: ACCESS_DECISION_GRANTED,
    attemptId: 'attempt-1',
    gates: [],
  };
}

function runtimeContext() {
  return {
    generation: 1,
    beginReadinessUpdate: () => ({
      isCurrent: () => true,
      waitForDependencies: async () => true,
      ready: () => undefined,
      fail: () => undefined,
    }),
  };
}

function admissionLifecycle(failedRuntimeId?: string) {
  return {
    phase: 'ACTIVE',
    runtimes: ['secure-storage', 'station', 'auth', 'access', 'session'].map((id) => ({
      id,
      status: id === failedRuntimeId ? 'failed' : 'ready',
      errorKey: id === failedRuntimeId ? 'mobile.lifecycle.runtimeFailed' : null,
    })),
  };
}
