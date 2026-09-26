// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const openContactChatMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));
vi.mock('../features/social/contactCommands', () => ({
  dispatchOpenContactChat: openContactChatMock,
}));

import { MobileAcceptanceActionRegistry } from './actionRegistry';
import {
  MOBILE_ACCEPTANCE_ACTION_NAMES,
} from './contracts';
import {
  sanitizeNegativeOAuthProjection,
  sanitizeOAuthPurgeOutput,
} from './negativeOAuth';
import {
  sanitizeMessagingProjection,
  sanitizeMobileProjection,
  sanitizeSessionRevocation,
} from './projection';
import { createMobileAcceptanceHarness } from './registry';
import {
  destroyMobileLifecycleKernel,
  getMobileLifecycleKernel,
  type MobileRuntimeContext,
  type MobileRuntimeDescriptor,
} from '../app/lifecycle';
import { resetMobileNavigation } from '../app/navigation';
import { useAuthStore } from '../features/auth/authStore';
import {
  bindMobileMutationAdmission,
  bindMobileSessionMutationAdmission,
} from '../runtimes/mutationAdmission';
import { runRuntimeSessionTransition } from '../runtimes/runtimeSessionTransition';
import {
  fenceSessionRuntimeProjection,
  readSessionRuntimeSnapshot,
  sessionRuntimeTestContract,
} from '../runtimes/sessionRuntime';

let releaseSessionAdmission: (() => void) | null = null;

function activateAcceptanceSession(): void {
  const decision = {
    state: 'ACCESS_DECISION_STATE_GRANTED',
    attemptId: 'attempt-1',
    gates: [],
  };
  useAuthStore.setState({ accessDecision: decision });
  sessionRuntimeTestContract.activate({
    stationPeerId: 'station-peer',
    stationUrl: 'https://station.example',
    sessionId: 'session-1',
    actorPtid: 'ptid:alice',
    deviceId: 'device-1',
    lifecycleGeneration: 1,
    expiresAt: '2030-01-01T00:00:00Z',
  }, decision);
}

describe('Mobile Acceptance Harness', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openContactChatMock.mockReset();
    releaseSessionAdmission?.();
    fenceSessionRuntimeProjection();
    useAuthStore.setState({
      session: null,
      accessDecision: null,
      loading: false,
      error: null,
      restored: false,
    });
    releaseSessionAdmission = bindMobileSessionMutationAdmission(() => {
      const current = readSessionRuntimeSnapshot();
      return {
        scopeKey: current.session
          ? `${current.session.stationPeerId}|${current.session.actorPtid}`
          : null,
        open: current.phase === 'active' && current.writesAllowed,
        reason: `session_${current.phase}`,
      };
    });
    resetMobileNavigation();
  });

  afterEach(() => {
    releaseSessionAdmission?.();
    releaseSessionAdmission = null;
  });

  it('registers exactly the environment contract action names', () => {
    const actionNames = Object.keys(createMobileAcceptanceHarness()).sort();
    expect(actionNames).toEqual(
      [...MOBILE_ACCEPTANCE_ACTION_NAMES].sort(),
    );
    expect(actionNames).toContain('build.identity');
    expect(actionNames).toContain('runtime.prepareActorIdentity');
    expect(actionNames).toContain('station.select');
    expect(actionNames).toContain('oauth.replayHandle');
    expect(actionNames).toContain('oauth.negativeCallback');
    expect(actionNames).toContain('lifecycle.snapshot');
    expect(actionNames).toContain('lifecycle.suspend');
    expect(actionNames).toContain('lifecycle.resume');
    expect(actionNames).toContain('lifecycle.restart');
    expect(actionNames).toContain('lifecycle.nativeBridgeDiagnostic');
    expect(actionNames).toContain('lifecycle.secureStorageDeleteFailure');
    expect(actionNames).toContain('lifecycle.scope.read');
    expect(actionNames).toContain('navigation.snapshot');
    expect(actionNames).toContain('navigation.apply');
    expect(actionNames).toContain('platform.permission.check');
    expect(actionNames).toContain('platform.permission.request');
    expect(actionNames).toContain('platform.permission.checkAll');
    expect(actionNames).toContain('platform.network.read');
    expect(actionNames).toContain('session.logout');
    expect(actionNames).toContain('federation.context.read');
    expect(actionNames).toContain('messaging.createDirect');
    expect(actionNames).toContain('messaging.createGroup');
    expect(actionNames).toContain('messaging.attachment.stage');
    expect(actionNames).toContain('messaging.send');
    expect(actionNames).toContain('messaging.interact');
    expect(actionNames).toContain('messaging.projection.read');
    expect(actionNames).toContain('social.people.search');
    expect(actionNames).toContain('reliability.fixture.configure');
    expect(actionNames).toContain('reliability.friendRequest.submit');
    expect(actionNames).toContain('reliability.snapshot');
    expect(actionNames).toContain('reliability.command.action');
    expect(actionNames).toContain('reliability.draft.write');
    expect(actionNames).toContain('reliability.reset');
    expect(actionNames).toContain('recovery.snapshot');
    expect(actionNames).toContain('social.request.send');
    expect(actionNames).toContain('social.request.accept');
    expect(actionNames).toContain('social.contact.open');
    expect(actionNames).toContain('social.reconcile');
    expect(actionNames).toContain('social.projection.read');
    expect(actionNames).toContain('storage.conversation-clear.seed');
  });

  it('routes conversation-clear fixture creation through the active Rust owner', async () => {
    invokeMock.mockImplementation(async (command: string, payload?: unknown) => {
      if (command === 'messaging_status') {
        return {
          active: true,
          stationPeerId: 'station-peer',
          actorPtid: 'ptid:alice',
        };
      }
      if (command === 'chat_storage_acceptance_seed_conversation_clear') {
        expect(payload).toEqual({
          input: {
            stationPeerId: 'station-peer',
            actorPtid: 'ptid:alice',
            plaintextBytes: 2 * 1024 * 1024,
          },
        });
        return {
          conversationId: 'conversation-clear',
          messageId: 'message-clear',
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(createMobileAcceptanceHarness()[
      'storage.conversation-clear.seed'
    ]({
      plaintextBytes: 2 * 1024 * 1024,
    })).resolves.toEqual({
      conversationId: 'conversation-clear',
      messageId: 'message-clear',
    });
  });

  it('prepares a parent-supplied actor identity without returning the seed', async () => {
    const seedBase64 = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
    const storageKey =
      'mobile-crypto-identity.v1.identity.0123456789abcdef0123456789abcdef';
    invokeMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(seedBase64);

    const result = await createMobileAcceptanceHarness()[
      'runtime.prepareActorIdentity'
    ]({ storageKey, seedBase64 });

    expect(result).toEqual({ prepared: true });
    expect(result).not.toHaveProperty('seedBase64');
    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      'secure_storage_set',
      { key: storageKey, value: seedBase64 },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      'secure_storage_get',
      { key: storageKey },
    );
  });

  it('exposes a descriptor-free read-only lifecycle snapshot', async () => {
    const snapshot = await createMobileAcceptanceHarness()[
      'lifecycle.snapshot'
    ]();

    expect(snapshot).toMatchObject({
      phase: 'COLD',
      launchState: 'app-boot',
      generation: 0,
      bootOrder: [],
      runtimes: [],
      errorKey: null,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.runtimes)).toBe(true);
  });

  it('reports the effective mutation admission in recovery snapshots', async () => {
    activateAcceptanceSession();
    const releaseAdmission = bindMobileMutationAdmission(
      'station-peer|ptid:alice',
      () => ({
        lifecycle: 'active',
        writeAdmission: { open: true },
        staleness: {
          social: { stale: false },
          group: { stale: false },
          moments: { stale: false },
          notification: { stale: false },
          profile: { stale: false },
          control: { stale: false },
        },
      }),
    );

    const snapshot = await createMobileAcceptanceHarness()[
      'recovery.snapshot'
    ]().finally(releaseAdmission);

    expect(snapshot.writeAdmission).toEqual({
      open: true,
      reason: null,
    });
  });

  it.each([false, true])(
    'reads readiness after restart acknowledgement, persistent failure: %s',
    async (persistentFailure) => {
      const kernel = getMobileLifecycleKernel();
      const harness = createMobileAcceptanceHarness();
      let messagingContext!: MobileRuntimeContext;
      let failBootstrap = false;
      let generation = 0;
      const descriptor = (id: string, dependsOn: string[]): MobileRuntimeDescriptor => ({
        id, title: id, responsibility: id, dependsOn,
        async bootstrap(context) {
          if (id !== 'messaging') return;
          messagingContext = context;
          if (failBootstrap) throw new Error('private Station detail');
        },
        async suspend() {},
        async resume() {},
        async teardown() { return { runtimeId: id, success: true, durationMs: 0 }; },
      });
      kernel.configureRuntimeGraph({
        createDescriptors: () => [
          descriptor('auth', []),
          descriptor('messaging', ['auth']),
          descriptor('social', ['messaging']),
        ],
        readGeneration: async () => generation,
        advanceGeneration: async () => ++generation,
        fenceProjections: () => undefined,
        resolveLaunchState: async () => 'shell',
      });
      try {
        await kernel.startRuntimeGraph();
        await expect(runRuntimeSessionTransition({
          previous: Promise.resolve(),
          context: messagingContext,
          isScopeCurrent: () => true,
          run: async () => { throw new Error('private activation detail'); },
          onError: () => undefined,
        })).rejects.toThrow('private activation detail');
        const failed = await harness['lifecycle.snapshot']();
        expect(failed.runtimes).toEqual([
          { id: 'auth', status: 'ready', errorKey: null },
          { id: 'messaging', status: 'failed', errorKey: 'mobile.lifecycle.runtimeFailed' },
          { id: 'social', status: 'failed', errorKey: 'mobile.lifecycle.dependencyFailed:messaging' },
        ]);
        expect(Object.isFrozen(failed.runtimes[1])).toBe(true);
        expect(JSON.stringify(failed)).not.toContain('private');
        await expect(harness['navigation.apply']({
          kind: 'primary', routeId: 'tab:settings',
        })).resolves.toMatchObject({ primaryRouteId: 'tab:settings' });

        failBootstrap = persistentFailure;
        await expect(harness['lifecycle.restart']()).resolves.toEqual({
          requested: true, scope: 'webview',
        });
        const restarted = await harness['lifecycle.waitReady']({
          minimumGeneration: failed.generation + 1,
          includeDiagnostics: true,
        });
        expect(restarted.generation).toBe(failed.generation + 1);
        expect(restarted.runtimes[0].status).toBe('ready');
        expect(restarted.runtimes.slice(1).map((runtime) => runtime.status))
          .toEqual(persistentFailure ? ['failed', 'failed'] : ['ready', 'ready']);
        expect(restarted.runtimeErrors).toEqual(persistentFailure
          ? [
              { runtimeId: 'messaging', error: 'private Station detail' },
              {
                runtimeId: 'social',
                error: 'mobile.lifecycle.dependencyFailed:messaging',
              },
            ]
          : []);
        expect(failed.runtimes[1].status).toBe('failed');
        const publicRestarted = await harness['lifecycle.waitReady']({
          minimumGeneration: restarted.generation,
        });
        expect(publicRestarted).not.toHaveProperty('runtimeErrors');
        expect(JSON.stringify(publicRestarted)).not.toContain('private');
        expect(invokeMock).not.toHaveBeenCalled();
      } finally {
        await kernel.stopRuntimeGraph();
        destroyMobileLifecycleKernel();
      }
    },
  );

  it('proves secure-storage delete failure blocks lifecycle and retry recovers', async () => {
    const kernel = getMobileLifecycleKernel();
    const harness = createMobileAcceptanceHarness();
    let generation = 0;
    kernel.configureRuntimeGraph({
      createDescriptors: () => [{
        id: 'auth',
        title: 'auth',
        responsibility: 'auth',
        dependsOn: [],
        async bootstrap() {},
        async suspend() {},
        async resume() {},
        async teardown() {
          return { runtimeId: 'auth', success: true, durationMs: 0 };
        },
      }],
      readGeneration: async () => generation,
      advanceGeneration: async () => ++generation,
      fenceProjections: () => undefined,
      resolveLaunchState: async () => 'station-selection',
    });
    let purgeAttempt = 0;
    invokeMock.mockImplementation(async (command: string, payload?: unknown) => {
      if (command === 'oauth_acceptance_configure_secure_storage_fault') {
        return payload?.input;
      }
      if (command === 'oauth_logout_purge') {
        purgeAttempt += 1;
        if (purgeAttempt === 1) {
          throw { code: 'MOBILE_SECURE_STORAGE', message: 'injected' };
        }
        return {
          stationRevocation: 'not_required',
          secureStorage: {
            activeAttemptIndexAbsent: true,
            attemptSecretRecordAbsent: true,
            currentSessionIndexAbsent: true,
            credentialRecordAbsent: true,
            publicProjectionAbsent: true,
          },
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    try {
      await kernel.startRuntimeGraph();
      await expect(
        harness['lifecycle.secureStorageDeleteFailure'](),
      ).resolves.toMatchObject({
        outcome: 'blocked',
        errorCode: 'MOBILE_SECURE_STORAGE',
        blocked: {
          phase: 'COLD',
          launchState: 'station-selection',
          generation: 1,
        },
        recovered: {
          phase: 'ACTIVE',
          launchState: 'station-selection',
          generation: 2,
        },
      });
      expect(invokeMock.mock.calls).toEqual([
        [
          'oauth_acceptance_configure_secure_storage_fault',
          { input: { mode: 'fail-next-remove' } },
        ],
        ['oauth_logout_purge', { input: null }],
        [
          'oauth_acceptance_configure_secure_storage_fault',
          { input: { mode: 'none' } },
        ],
        ['oauth_logout_purge', { input: null }],
      ]);
    } finally {
      await kernel.stopRuntimeGraph();
      destroyMobileLifecycleKernel();
    }
  });

  it('rejects duplicate action registration', () => {
    const registry = new MobileAcceptanceActionRegistry();
    const action = async () => ({
      requested: true as const,
      scope: 'webview' as const,
    });

    registry.register('lifecycle.restart', action);

    expect(() => registry.register('lifecycle.restart', action))
      .toThrow('acceptance.mobile.duplicateAction:lifecycle.restart');
  });

  it('returns only explicitly public projection fields', () => {
    const projection = sanitizeMobileProjection({
      stationRegistry: {
        activeStationPeerId: 'station-peer',
        entries: [{
          stationPeerId: 'station-peer',
          url: 'https://station.example',
          label: 'Station',
          createdAt: 1,
          lastUsedAt: 2,
          online: true,
          privateKey: 'must-not-cross',
        }],
      },
      access: {
        decision: {
          state: 'ACCESS_DECISION_STATE_GRANTED',
          attemptId: 'attempt',
          currentGateId: '',
          accessGrantId: 'grant',
          message: 'must-not-cross',
          gates: [{
            gateId: 'auth.login',
            type: 'ACCESS_GATE_TYPE_AUTH_LOGIN',
            state: 'ACCESS_GATE_STATE_PASSED',
            title: 'must-not-cross',
            inputSchemaJson: '{"password":"must-not-cross"}',
          }],
        },
        loading: false,
        errorKey: null,
        restored: true,
      },
      session: {
        phase: 'active',
        session: {
          stationPeerId: 'station-peer',
          stationUrl: 'https://station.example',
          sessionId: 'must-not-cross',
          actorPtid: 'ptid:alice',
          expiresAt: '2026-08-29T00:00:00Z',
          credentialOwner: 'native-oauth',
        },
        writesAllowed: true,
        refreshReason: null,
        errorKey: null,
      },
      oauth: {
        phase: 'active_session',
        stationPeerId: 'station-peer',
        candidatePtid: 'ptid:alice',
        errorKey: null,
        recovery: 'none',
        session: {
          sessionId: 'must-not-cross',
          actorPtid: 'ptid:alice',
          expiresAt: '2026-08-29T00:00:00Z',
        },
        authorizationCode: 'must-not-cross',
      },
    });

    expect(JSON.stringify(projection)).not.toMatch(
      /accessToken|authorizationCode|inputSchemaJson|message|privateKey|sessionId/,
    );
    expect(projection).toMatchObject({
      station: {
        activeStationPeerId: 'station-peer',
        entries: [{ stationPeerId: 'station-peer' }],
      },
      access: {
        session: {
          stationPeerId: 'station-peer',
          actorPtid: 'ptid:alice',
        },
      },
      oauth: {
        phase: 'active_session',
        session: { actorPtid: 'ptid:alice' },
      },
    });
  });

  it('keeps acceptance adapters outside direct Zustand mutation APIs', () => {
    const source = readFileSync(
      new URL('./actions.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toMatch(/from ['"].*authStore['"]/);
    expect(source).not.toMatch(/\.(?:getState|setState)\s*\(/);
    expect(source).not.toMatch(/\bzustand\b/);
  });

  it('routes bounded lifecycle actions through the lifecycle owner', () => {
    const source = readFileSync(
      new URL('./actions.ts', import.meta.url),
      'utf8',
    );

    expect(source).toMatch(
      /lifecycle\.snapshot[\s\S]*getMobileLifecycleKernel\(\)\.getSnapshot\(\)/,
    );
    expect(source).toMatch(
      /lifecycle\.suspend[\s\S]*getMobileLifecycleKernel\(\)\.suspend\('acceptance-suspend'\)/,
    );
    expect(source).toMatch(
      /lifecycle\.resume[\s\S]*getMobileLifecycleKernel\(\)\.resume\('acceptance-resume'\)/,
    );
    expect(source).toMatch(
      /lifecycle\.restart[\s\S]*getMobileLifecycleKernel\(\)\.restartRuntimeGraph\('acceptance-restart'\)/,
    );
    expect(source).not.toMatch(/window\.location\.reload/);
  });

  it('requires and projects the explicit Federation search context', () => {
    const source = readFileSync(
      new URL('./actions.ts', import.meta.url),
      'utf8',
    );
    const searchAction = source.slice(
      source.indexOf("'social.people.search':"),
      source.indexOf("'reliability.fixture.configure':"),
    );

    expect(searchAction).toContain(
      "federationId,\n      'social.people.search.federationId'",
    );
    expect(searchAction).toContain('federationId: contextId');
    expect(searchAction).not.toContain('result.federationId');
  });

  it('routes platform evidence through production Rust commands', async () => {
    invokeMock
      .mockResolvedValueOnce({
        kind: 'camera',
        status: 'not_determined',
        canRequest: true,
      })
      .mockResolvedValueOnce({
        kind: 'camera',
        status: 'granted',
        wasAlreadyGranted: false,
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        connected: true,
        networkType: 'wifi',
        updatedAtMs: 1,
      });

    const harness = createMobileAcceptanceHarness();
    await harness['platform.permission.check']({ kind: 'camera' });
    await harness['platform.permission.request']({ kind: 'camera' });
    await harness['platform.permission.checkAll']();
    await harness['platform.network.read']();

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      'permission_check',
      { kind: 'camera' },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      'permission_request',
      { kind: 'camera' },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      3,
      'permission_check_all',
      undefined,
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      4,
      'network_state',
      undefined,
    );
  });

  it('rejects unknown permission kinds before invoking Rust', async () => {
    const harness = createMobileAcceptanceHarness();

    await expect(harness['platform.permission.check']({
      kind: 'location',
    } as never)).rejects.toThrow(
      'acceptance.mobile.invalidInput:platform.permission.kind',
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('keeps reliability fault control acceptance-only and closed', async () => {
    invokeMock.mockResolvedValueOnce({
      mode: 'hold-before-dispatch',
    });
    const harness = createMobileAcceptanceHarness();

    await expect(harness['reliability.fixture.configure']({
      mode: 'hold-before-dispatch',
    })).resolves.toEqual({
      mode: 'hold-before-dispatch',
    });
    expect(invokeMock).toHaveBeenCalledWith(
      'reliability_acceptance_configure_fault',
      { input: { mode: 'hold-before-dispatch' } },
    );

    invokeMock.mockClear();
    await expect(harness['reliability.fixture.configure']({
      mode: 'unknown',
    } as never)).rejects.toThrow(
      'acceptance.mobile.invalidInput:reliability.fixture.mode',
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('reads reliability evidence only through the active Rust owner', async () => {
    activateAcceptanceSession();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'reliability_status') {
        return {
          active: true,
          stationPeerId: 'station-peer',
          actorPtid: 'ptid:alice',
          runtimeGeneration: 4,
          admissionOpen: true,
          pendingCommands: 0,
          unknownCommands: 0,
          draftCount: 0,
          archivedLegacyFiles: 0,
        };
      }
      if (
        command === 'reliability_list_commands'
        || command === 'draft_list'
        || command === 'reliability_list_projection_checkpoints'
      ) {
        return [];
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(createMobileAcceptanceHarness()[
      'reliability.snapshot'
    ]()).resolves.toEqual({
      runtime: {
        active: true,
        stationPeerId: 'station-peer',
        actorPtid: 'ptid:alice',
        runtimeGeneration: 4,
        admissionOpen: true,
        pendingCommands: 0,
        unknownCommands: 0,
        draftCount: 0,
        archivedLegacyFiles: 0,
      },
      commands: [],
      drafts: [],
      checkpoints: [],
    });
    expect(invokeMock).toHaveBeenCalledWith(
      'reliability_list_commands',
      {
        input: {
          stationPeerId: 'station-peer',
          actorPtid: 'ptid:alice',
          runtimeGeneration: 4,
        },
      },
    );
  });

  it('routes Station replacement and logout through the generation fence', () => {
    const actionsSource = readFileSync(
      new URL('./actions.ts', import.meta.url),
      'utf8',
    );
    const appSource = readFileSync(
      new URL('../App.tsx', import.meta.url),
      'utf8',
    );

    expect(actionsSource).toMatch(
      /station\.replace[\s\S]*transitionScope\(\s*'station-replace'[\s\S]*cancelAndClearCurrentAuthScope\(\)/,
    );
    expect(actionsSource).toMatch(
      /station\.select[\s\S]*transitionScope\(\s*'station-replace'[\s\S]*logoutSessionRuntime\(\)/,
    );
    expect(appSource).toMatch(
      /commitStationScope[\s\S]*runUserScopeTransition\(\s*'station-replace'[\s\S]*logoutSessionRuntime\(\)/,
    );
    expect(appSource).toMatch(
      /runUserScopeTransition[\s\S]*transitionScope\([\s\S]*draftDisposition/,
    );
    expect(appSource).toMatch(
      /function logout[\s\S]*runUserScopeTransition\(\s*'logout'[\s\S]*logoutSessionRuntime/,
    );
  });

  it('routes lifecycle scope reads through runtime owners', () => {
    const source = readFileSync(
      new URL('./actions.ts', import.meta.url),
      'utf8',
    );

    expect(source).toMatch(
      /lifecycle\.scope\.read[\s\S]*readMobileRuntimeScopeProjection\(\)/,
    );
    expect(source).toMatch(
      /session\.logout[\s\S]*transitionScope\(\s*'logout'[\s\S]*logoutSessionRuntime/,
    );
    expect(source).toMatch(
      /session\.logout[\s\S]*logout:\s*sanitizeSessionRevocation\(logout\)/,
    );
    expect(source).not.toMatch(/\.(?:getState|setState)\s*\(/);
  });

  it('keeps Station registry persistence behind the Station runtime owner', () => {
    const ownerSource = readFileSync(
      new URL('../runtimes/stationRuntime.ts', import.meta.url),
      'utf8',
    );
    const consumerSources = [
      new URL('../App.tsx', import.meta.url),
      new URL('./actions.ts', import.meta.url),
      new URL('../runtimes/authRuntime.ts', import.meta.url),
      new URL('../runtimes/runtimeRegistry.ts', import.meta.url),
    ].map((path) => readFileSync(path, 'utf8'));

    expect(ownerSource).toMatch(/loadStationRegistry/);
    expect(ownerSource).toMatch(/persistStationRegistry/);
    for (const source of consumerSources) {
      expect(source).not.toMatch(/\bloadStationRegistry\b/);
      expect(source).not.toMatch(/\bpersistStationRegistry\b/);
    }
  });

  it('routes navigation intents through the production navigation owner', async () => {
    const harness = createMobileAcceptanceHarness();

    await expect(harness['navigation.snapshot']()).resolves.toEqual({
      primaryRouteId: 'tab:chat',
      detailKeys: [],
      overlayRouteId: null,
    });
    await expect(harness['navigation.apply']({
      kind: 'primary',
      routeId: 'tab:contacts',
    })).resolves.toMatchObject({
      primaryRouteId: 'tab:contacts',
      detailKeys: [],
      overlayRouteId: null,
    });
    await expect(harness['navigation.apply']({
      kind: 'overlay.open',
      route: { routeId: 'overlay:create-group' },
    })).resolves.toMatchObject({
      primaryRouteId: 'tab:contacts',
      detailKeys: [],
      overlayRouteId: 'overlay:create-group',
    });
    await expect(harness['navigation.apply']({
      kind: 'detail.push',
      route: {
        routeId: 'detail:contact-profile',
        actorPtid: 'ptid:contact-1',
      },
    })).resolves.toMatchObject({
      detailKeys: ['detail:contact-profile:ptid:contact-1'],
      overlayRouteId: null,
    });

    const source = readFileSync(
      new URL('./actions.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(
      /navigation\.apply[\s\S]*applyMobileNavigationIntent\([\s\S]*requireNavigationIntent/,
    );
    expect(source).not.toMatch(/\.(?:getState|setState)\s*\(/);
  });

  it('rejects malformed navigation intents before changing route state', async () => {
    const harness = createMobileAcceptanceHarness();

    await expect(harness['navigation.apply']({
      kind: 'detail.push',
      route: {
        routeId: 'detail:contact-profile',
        actorPtid: '',
      },
    })).rejects.toThrow(
      'acceptance.mobile.invalidInput:navigation.detail.actorPtid',
    );
    await expect(harness['navigation.snapshot']()).resolves.toEqual({
      primaryRouteId: 'tab:chat',
      detailKeys: [],
      overlayRouteId: null,
    });
  });

  it('routes Messaging actions through the active account-scoped native API', async () => {
    activateAcceptanceSession();
    invokeMock.mockResolvedValue({
      conversationId: 'conversation-1',
      commandId: 'command-1',
      state: 'projected',
    });
    const releaseAdmission = bindMobileMutationAdmission(
      'station-peer|ptid:alice',
      () => ({
        lifecycle: 'active',
        writeAdmission: { open: true },
        staleness: {
          social: { stale: false },
          group: { stale: false },
          moments: { stale: false },
          notification: { stale: false },
          profile: { stale: false },
          control: { stale: false },
        },
      }),
    );

    const result = await createMobileAcceptanceHarness()[
      'messaging.createDirect'
    ]({ peerPtid: 'ptid:bob', federationId: 'federation-1' })
      .finally(releaseAdmission);

    expect(result).toEqual({
      conversationId: 'conversation-1',
      commandId: 'command-1',
      state: 'projected',
    });
    expect(invokeMock).toHaveBeenCalledWith('messaging_create_direct', {
      input: {
        stationPeerId: 'station-peer',
        actorPtid: 'ptid:alice',
        peerPtid: 'ptid:bob',
        federationId: 'federation-1',
      },
    });
  });

  it('keeps business runtime actions closed before final access grant', async () => {
    useAuthStore.setState({
      session: {
        stationPeerId: 'station-peer',
        stationUrl: 'https://station.example',
        sessionId: 'session-1',
        actorRef: { ptid: 'ptid:alice' },
        authenticatedAt: 1,
      },
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });

    await expect(createMobileAcceptanceHarness()[
      'messaging.createDirect'
    ]({ peerPtid: 'ptid:bob' }))
      .rejects.toThrow('acceptance.mobile.activeMessagingSessionRequired');
    await expect(createMobileAcceptanceHarness()[
      'social.contact.open'
    ]({ peerPtid: 'ptid:bob', federationId: 'federation-1' }))
      .rejects.toThrow('acceptance.mobile.activeMessagingSessionRequired');
    expect(openContactChatMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  describe('contact opening', () => {
    beforeEach(() => {
      activateAcceptanceSession();
    });

    it('returns only the production contact command result after it settles', async () => {
      let resolveOpen: (id: string) => void;
      openContactChatMock.mockReturnValue(new Promise<string>((resolve) => {
        resolveOpen = resolve;
      }));
      let settled = false;
      const result = createMobileAcceptanceHarness()['social.contact.open']({
        peerPtid: 'ptid:bob',
        federationId: 'federation-1',
      }).then((value) => {
        settled = true;
        return value;
      });
      await Promise.resolve();

      expect(settled).toBe(false);
      expect(openContactChatMock).toHaveBeenCalledExactlyOnceWith(
        'ptid:bob', 'federation-1',
      );
      expect(invokeMock).not.toHaveBeenCalled();
      resolveOpen('station-returned-conversation');
      await expect(result).resolves.toEqual({
        conversationId: 'station-returned-conversation',
      });
    });

    it('propagates production preparation failures without inventing an ID', async () => {
      openContactChatMock.mockRejectedValue(
        new Error('mobile.contacts.conversationPreparing'),
      );
      await expect(createMobileAcceptanceHarness()['social.contact.open']({
        peerPtid: 'ptid:bob',
        federationId: 'federation-1',
      })).rejects.toThrow('mobile.contacts.conversationPreparing');
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it.each([
      [{ peerPtid: '', federationId: 'federation-1' }, 'peerPtid'],
      [{ peerPtid: 'ptid:bob', federationId: '' }, 'federationId'],
    ])('rejects missing contact scope before dispatch: %s', async (input, field) => {
      await expect(createMobileAcceptanceHarness()['social.contact.open'](input))
        .rejects.toThrow(`social.contact.open.${field}`);
      expect(openContactChatMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });
  });

  it('sanitizes messaging projections without local storage references', () => {
    const projection = sanitizeMessagingProjection({
      runtime: {
        active: true,
        profileId: 'profile-1',
        stationPeerId: 'station-peer',
        stationOrigin: 'https://station.example',
        actorPtid: 'ptid:alice',
        deviceId: 'device-1',
        deviceEnrolled: true,
        laneSequence: 8,
        consumerEpoch: 2,
        conversationCount: 1,
        activationGeneration: 3,
        workerPhase: 'running',
      },
      conversations: [{
        conversationId: 'conversation-1',
        authorityStationId: 'station-peer',
        federationId: 'federation-1',
        kind: 1,
        name: '',
        ownerPtid: 'ptid:alice',
        memberPtids: ['ptid:alice', 'ptid:bob'],
        membershipEpoch: 1,
        mlsEpoch: 0,
        active: true,
        updatedAtUnixMs: 10,
      }],
      messages: {
        'conversation-1': [{
          messageId: 'message-1',
          senderPtid: 'ptid:alice',
          senderDeviceId: 'device-1',
          plaintext: 'acceptance-message',
          attachments: [{
            attachmentId: 'attachment-1',
            filename: 'proof.txt',
            mimeType: 'text/plain',
            plaintextSize: 4,
            objectId: 'object-1',
            storageRef: 'private-storage-ref',
            ciphertextSize: 20,
            availabilityState: 'local',
          }],
          state: 'delivered',
          timestampUnixMs: 10,
          retracted: false,
          reactions: [],
          readByPtids: ['ptid:bob'],
        }],
      },
    });

    expect(projection.runtime).not.toHaveProperty('stationOrigin');
    expect(projection.messages['conversation-1'][0]).not.toHaveProperty('senderDeviceId');
    expect(projection.messages['conversation-1'][0].attachments[0]).not.toHaveProperty('storageRef');
    expect(projection.messages['conversation-1'][0].attachments[0]).not.toHaveProperty('objectId');
    expect(projection.messages['conversation-1'][0].plaintext).toBe('acceptance-message');
  });

  it('starts access through the production Access runtime before OAuth', () => {
    const actionsSource = readFileSync(
      new URL('./actions.ts', import.meta.url),
      'utf8',
    );
    const runtimeSource = readFileSync(
      new URL('../runtimes/accessRuntime.ts', import.meta.url),
      'utf8',
    );
    const appSource = readFileSync(
      new URL('../App.tsx', import.meta.url),
      'utf8',
    );

    expect(actionsSource).toMatch(
      /input\.kind === 'start'[\s\S]*startAccessAttemptForActiveStation\(\)/,
    );
    expect(actionsSource).toContain(
      "await kernel.reconcileLaunchState('access-granted')",
    );
    expect(runtimeSource).toMatch(
      /startAccessAttemptForActiveStation[\s\S]*startStationAccessAttemptWithRecovery\([\s\S]*applyAccessGateRuntimeResult\(decision\)/,
    );
    expect(runtimeSource).toMatch(
      /startAccessAttemptWithInvalidSessionRecovery[\s\S]*isRevokedSessionError[\s\S]*clearSession\(\)/,
    );
    expect(appSource).toMatch(
      /startAccessGateChainFor[\s\S]*startAccessAttemptForActiveStation\(\)/,
    );
    expect(appSource).not.toMatch(/function isRevokedSessionError/);
  });

  it('projects negative OAuth results without callback or credential material', () => {
    const projection = sanitizeNegativeOAuthProjection({
      phase: 'failed',
      stationPeerId: 'station-peer',
      provider: 'github',
      accessAttemptId: 'access-attempt',
      gateId: 'auth.oauth',
      result: 'OAUTH_ATTEMPT_RESULT_BINDING_MISMATCH',
      errorCode: 'OAUTH_CALLBACK_BINDING_MISMATCH',
      candidate: {
        actorPtid: 'ptid:alice',
        candidateId: 'must-not-cross',
      },
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_PENDING',
        currentGateId: 'auth.oauth',
        message: 'must-not-cross',
      },
      session: null,
      callbackUrl: 'must-not-cross',
      code: 'must-not-cross',
      state: 'must-not-cross',
      pkceVerifier: 'must-not-cross',
      nonce: 'must-not-cross',
    });

    expect(projection).toEqual({
      phase: 'failed',
      stationPeerId: 'station-peer',
      provider: 'github',
      accessAttemptId: 'access-attempt',
      gateId: 'auth.oauth',
      expiresAtUnixMs: undefined,
      result: 'OAUTH_ATTEMPT_RESULT_BINDING_MISMATCH',
      errorCode: 'OAUTH_CALLBACK_BINDING_MISMATCH',
      candidatePtid: 'ptid:alice',
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_PENDING',
        currentGateId: 'auth.oauth',
      },
      sessionPresent: false,
    });
    expect(JSON.stringify(projection)).not.toMatch(
      /callbackUrl|candidateId|code|message|nonce|pkceVerifier/,
    );
  });

  it('returns only authoritative Rust secure-storage absence flags', () => {
    const projection = sanitizeOAuthPurgeOutput({
      stationRevocation: 'confirmed',
      secureStorage: {
        activeAttemptIndexAbsent: true,
        attemptSecretRecordAbsent: true,
        currentSessionIndexAbsent: true,
        credentialRecordAbsent: true,
        publicProjectionAbsent: true,
        credential: 'must-not-cross',
      },
      deletedKeys: ['must-not-cross'],
    });

    expect(projection).toEqual({
      stationRevocation: 'confirmed',
      secureStorage: {
        activeAttemptIndexAbsent: true,
        attemptSecretRecordAbsent: true,
        currentSessionIndexAbsent: true,
        credentialRecordAbsent: true,
        publicProjectionAbsent: true,
      },
    });
    expect(JSON.stringify(projection)).not.toMatch(
      /must-not-cross|deletedKeys/,
    );
  });

  it('keeps native purge details behind the Station revocation projection', () => {
    const projection = sanitizeSessionRevocation({
      remoteRevocation: 'confirmed',
      nativePurge: {
        stationRevocation: 'confirmed',
        secureStorage: {
          activeAttemptIndexAbsent: true,
          attemptSecretRecordAbsent: true,
          currentSessionIndexAbsent: true,
          credentialRecordAbsent: true,
          publicProjectionAbsent: true,
        },
      },
    });

    expect(projection).toEqual({
      remoteRevocation: 'confirmed',
    });
    expect(projection).not.toHaveProperty('nativePurge');
  });

  it('routes negative OAuth input through the registered typed action', async () => {
    const input = {
      context: {
        build: {
          buildId: 'build-id',
          harnessEnabled: true,
        },
        leases: [
          {
            leaseRef: 'physical-device-lease/alice-ios',
            holderRunId: 'run-id',
            fenceToken: 9,
            state: 'IN_USE',
            expiresAtUnixMs: Number.MAX_SAFE_INTEGER,
          },
          {
            leaseRef: 'provider-account-lease/github',
            holderRunId: 'run-id',
            fenceToken: 42,
            state: 'IN_USE',
            expiresAtUnixMs: Number.MAX_SAFE_INTEGER,
          },
          {
            leaseRef: 'browser-session-lease/alice-ios',
            holderRunId: 'run-id',
            fenceToken: 18,
            state: 'IN_USE',
            expiresAtUnixMs: Number.MAX_SAFE_INTEGER,
          },
        ],
        services: [{
          serviceId: 'station-primary',
          stationOrigin: 'https://station.example',
          stationPeerId: 'station-peer',
        }],
      },
      intent: {
        artifactKind: 'mobile-oauth-negative-callback-intent',
        runId: 'run-id',
        gateId: 'mobile-native-access-e2e',
        variantId: 'provider-mismatch-ios',
        clientId: 'alice-ios',
        operation: 'provider_mismatch',
        requiredLeaseRefs: [
          'physical-device-lease/alice-ios',
          'provider-account-lease/github',
          'browser-session-lease/alice-ios',
        ],
        holderRunId: 'run-id',
        fenceTokens: {
          physicalDevice: 9,
          providerAccount: 42,
          browserSession: 18,
        },
        callbackReplayHandle: '',
        replayMode: '',
        alternateServiceId: '',
        expectedFailure: 'oauthProviderMismatch',
      },
    };
    invokeMock.mockResolvedValue({
      operation: 'provider_mismatch',
      failure: 'oauthProviderMismatch',
      projection: {
        phase: 'failed',
        result: 'OAUTH_ATTEMPT_RESULT_BINDING_MISMATCH',
        errorCode: 'OAUTH_CALLBACK_BINDING_MISMATCH',
      },
    });

    const result = await createMobileAcceptanceHarness()[
      'oauth.negativeCallback'
    ](input);

    expect(invokeMock).toHaveBeenCalledWith(
      'oauth_acceptance_negative_callback',
      { input },
    );
    expect(result).toMatchObject({
      operation: 'provider_mismatch',
      failure: 'oauthProviderMismatch',
      projection: {
        phase: 'failed',
        sessionPresent: false,
      },
    });
  });

  it('routes replay handle acquisition through the registered typed action', async () => {
    const input = {
      runId: 'run-id',
      gateId: 'mobile-native-access-e2e',
      clientId: 'alice-ios',
      context: {
        build: {
          buildId: 'build-id',
          harnessEnabled: true,
        },
        leases: [],
        services: [],
      },
    };
    invokeMock.mockResolvedValue({
      callbackReplayHandle: 'volatile-handle',
    });

    await expect(createMobileAcceptanceHarness()[
      'oauth.replayHandle'
    ](input)).resolves.toEqual({
      callbackReplayHandle: 'volatile-handle',
    });
    expect(invokeMock).toHaveBeenCalledWith(
      'oauth_acceptance_callback_replay_handle',
      { input },
    );
  });

  it('keeps negative adapters acceptance-only and delegates purge to Rust', () => {
    const actionsSource = readFileSync(
      new URL('./actions.ts', import.meta.url),
      'utf8',
    );
    const adapterSource = readFileSync(
      new URL('./negativeOAuth.ts', import.meta.url),
      'utf8',
    );
    const productionCommandsSource = readFileSync(
      new URL('../services/mobileCommands.ts', import.meta.url),
      'utf8',
    );
    const entrySource = readFileSync(
      new URL('../main.tsx', import.meta.url),
      'utf8',
    );
    const registrySource = readFileSync(
      new URL('./registry.ts', import.meta.url),
      'utf8',
    );
    const rustCommandsSource = readFileSync(
      new URL('../../src-tauri/src/commands/mod.rs', import.meta.url),
      'utf8',
    );
    const rustOAuthCommandsSource = readFileSync(
      new URL('../../src-tauri/src/commands/oauth.rs', import.meta.url),
      'utf8',
    );
    const [releaseHandler, acceptanceHandler = ''] = rustCommandsSource.split(
      '#[cfg(feature = "acceptance-harness")]\npub fn handlers',
    );

    expect(entrySource).toMatch(
      /VITE_ACCEPTANCE_HARNESS === '1'[\s\S]*import\('\.\/acceptance\/registry'\)/,
    );
    expect(adapterSource).toMatch(
      /invoke<[^>]+>\(\s*'oauth_acceptance_negative_callback'/,
    );
    expect(adapterSource).toMatch(
      /invoke<[^>]+>\(\s*'oauth_logout_purge'/,
    );
    expect(adapterSource).toMatch(
      /invoke<[^>]+>\(\s*'oauth_acceptance_configure_secure_storage_fault'/,
    );
    expect(adapterSource).not.toMatch(
      /secure_storage_(?:get|set|remove)|callbackUrl|authorizationCode|pkceVerifier|nonce/,
    );
    expect(productionCommandsSource).not.toMatch(
      /oauth_acceptance_(?:callback_replay_handle|negative_callback|configure_secure_storage_fault)/,
    );
    expect(registrySource).toMatch(
      /oauth\.replayHandle[\s\S]*oauth\.negativeCallback/,
    );
    expect(actionsSource).toMatch(
      /build\.identity[\s\S]*oauth\.replayHandle[\s\S]*oauth\.negativeCallback/,
    );
    expect(releaseHandler).not.toMatch(
      /mobile_build_identity|oauth_acceptance_(?:callback_replay_handle|negative_callback|configure_secure_storage_fault)/,
    );
    expect(acceptanceHandler).toMatch(
      /mobile_build_identity[\s\S]*oauth_acceptance_callback_replay_handle[\s\S]*oauth_acceptance_configure_secure_storage_fault[\s\S]*oauth_acceptance_negative_callback/,
    );
    expect(releaseHandler).not.toMatch(
      /reliability_acceptance_configure_fault/,
    );
    expect(acceptanceHandler).toMatch(
      /reliability_acceptance_configure_fault/,
    );
    expect(rustOAuthCommandsSource).toMatch(
      /#\[cfg\(feature = "acceptance-harness"\)\][\s\S]*oauth_acceptance_callback_replay_handle/,
    );
    expect(rustOAuthCommandsSource).toMatch(
      /#\[cfg\(feature = "acceptance-harness"\)\][\s\S]*oauth_acceptance_negative_callback/,
    );
    expect(rustOAuthCommandsSource).toMatch(
      /#\[cfg\(feature = "acceptance-harness"\)\][\s\S]*oauth_acceptance_configure_secure_storage_fault/,
    );
    expect(productionCommandsSource).not.toMatch(
      /oauth_acceptance_(?:callback_replay_handle|negative_callback|configure_secure_storage_fault)/,
    );
    expect(rustCommandsSource).toMatch(/oauth::oauth_logout_purge/);
    expect(releaseHandler).toMatch(
      /oauth::oauth_session_projection[\s\S]*oauth::oauth_session_refresh/,
    );
    expect(acceptanceHandler).toMatch(
      /oauth::oauth_session_projection[\s\S]*oauth::oauth_session_refresh/,
    );
    expect(actionsSource).toMatch(
      /transitionScope\(\s*'logout'[\s\S]*logoutSessionRuntime\(\)[\s\S]*purgeNativeOAuth\(\)/,
    );
  });
});
