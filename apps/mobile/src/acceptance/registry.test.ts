// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
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
} from './projection';
import { createMobileAcceptanceHarness } from './registry';
import { useAuthStore } from '../features/auth/authStore';

describe('Mobile Acceptance Harness', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAuthStore.setState({
      session: null,
      accessDecision: null,
      loading: false,
      error: null,
      restored: false,
    });
  });

  it('registers exactly the environment contract action names', () => {
    const actionNames = Object.keys(createMobileAcceptanceHarness()).sort();
    expect(actionNames).toEqual(
      [...MOBILE_ACCEPTANCE_ACTION_NAMES].sort(),
    );
    expect(actionNames).toContain('build.identity');
    expect(actionNames).toContain('station.select');
    expect(actionNames).toContain('oauth.replayHandle');
    expect(actionNames).toContain('oauth.negativeCallback');
    expect(actionNames).toContain('lifecycle.snapshot');
    expect(actionNames).toContain('lifecycle.suspend');
    expect(actionNames).toContain('lifecycle.resume');
    expect(actionNames).toContain('lifecycle.restart');
    expect(actionNames).toContain('lifecycle.scope.read');
    expect(actionNames).toContain('platform.permission.check');
    expect(actionNames).toContain('platform.permission.request');
    expect(actionNames).toContain('platform.permission.checkAll');
    expect(actionNames).toContain('platform.network.read');
    expect(actionNames).toContain('session.logout');
    expect(actionNames).toContain('messaging.createDirect');
    expect(actionNames).toContain('messaging.createGroup');
    expect(actionNames).toContain('messaging.attachment.stage');
    expect(actionNames).toContain('messaging.send');
    expect(actionNames).toContain('messaging.interact');
    expect(actionNames).toContain('messaging.projection.read');
    expect(actionNames).toContain('social.request.send');
    expect(actionNames).toContain('social.request.accept');
    expect(actionNames).toContain('social.reconcile');
    expect(actionNames).toContain('social.projection.read');
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
        session: {
          stationPeerId: 'station-peer',
          actorPtid: 'ptid:alice',
          expiresAt: '2026-08-29T00:00:00Z',
          accessToken: 'must-not-cross',
        },
        loading: false,
        errorKey: null,
        restored: true,
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
      /station\.select[\s\S]*transitionScope\(\s*'station-replace'[\s\S]*logoutAuthRuntimeSession\(\)/,
    );
    expect(appSource).toMatch(
      /commitStationScope[\s\S]*transitionScope\(\s*'station-replace'[\s\S]*logoutAuthRuntimeSession\(\)/,
    );
    expect(appSource).toMatch(
      /function logout[\s\S]*transitionScope\('logout'[\s\S]*logoutAuthRuntimeSession/,
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
      /session\.logout[\s\S]*transitionScope\(\s*'logout'[\s\S]*logoutAuthRuntimeSession/,
    );
    expect(source).not.toMatch(/\.(?:getState|setState)\s*\(/);
  });

  it('routes Messaging actions through the active account-scoped native API', async () => {
    useAuthStore.setState({
      session: {
        stationPeerId: 'station-peer',
        stationUrl: 'https://station.example',
        sessionId: 'session-1',
        accessToken: 'test-token',
        actorRef: { ptid: 'ptid:alice' },
        authenticatedAt: 1,
      },
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    invokeMock.mockResolvedValue({
      conversationId: 'conversation-1',
      commandId: 'command-1',
      state: 'projected',
    });

    const result = await createMobileAcceptanceHarness()[
      'messaging.createDirect'
    ]({ peerPtid: 'ptid:bob', federationId: 'federation-1' });

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
        accessToken: 'test-token',
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
    expect(invokeMock).not.toHaveBeenCalled();
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

  it('starts access through the production auth runtime before OAuth', () => {
    const actionsSource = readFileSync(
      new URL('./actions.ts', import.meta.url),
      'utf8',
    );
    const runtimeSource = readFileSync(
      new URL('../runtimes/authRuntime.ts', import.meta.url),
      'utf8',
    );
    const appSource = readFileSync(
      new URL('../App.tsx', import.meta.url),
      'utf8',
    );

    expect(actionsSource).toMatch(
      /input\.kind === 'start'[\s\S]*startAccessAttemptForActiveStation\(\)/,
    );
    expect(runtimeSource).toMatch(
      /startAccessAttemptForActiveStation[\s\S]*startStationAccessAttemptWithRecovery\([\s\S]*applyAccessGateRuntimeResult\(decision\)/,
    );
    expect(runtimeSource).toMatch(
      /startAccessAttemptWithInvalidSessionRecovery[\s\S]*isRevokedSessionError[\s\S]*clearSession\(\)/,
    );
    expect(appSource).toMatch(
      /startAccessGateChainFor[\s\S]*startStationAccessAttemptWithRecovery\(/,
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
      '#[cfg(feature = "acceptance-harness")]',
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
    expect(adapterSource).not.toMatch(
      /secure_storage_(?:get|set|remove)|callbackUrl|authorizationCode|pkceVerifier|nonce/,
    );
    expect(productionCommandsSource).not.toMatch(
      /oauth_acceptance_(?:callback_replay_handle|negative_callback)/,
    );
    expect(registrySource).toMatch(
      /oauth\.replayHandle[\s\S]*oauth\.negativeCallback/,
    );
    expect(actionsSource).toMatch(
      /build\.identity[\s\S]*oauth\.replayHandle[\s\S]*oauth\.negativeCallback/,
    );
    expect(releaseHandler).not.toMatch(
      /mobile_build_identity|oauth_acceptance_(?:callback_replay_handle|negative_callback)/,
    );
    expect(acceptanceHandler).toMatch(
      /mobile_build_identity[\s\S]*oauth_acceptance_callback_replay_handle[\s\S]*oauth_acceptance_negative_callback/,
    );
    expect(rustOAuthCommandsSource).toMatch(
      /#\[cfg\(feature = "acceptance-harness"\)\][\s\S]*oauth_acceptance_callback_replay_handle/,
    );
    expect(rustOAuthCommandsSource).toMatch(
      /#\[cfg\(feature = "acceptance-harness"\)\][\s\S]*oauth_acceptance_negative_callback/,
    );
    expect(productionCommandsSource).not.toMatch(
      /oauth_acceptance_(?:callback_replay_handle|negative_callback)/,
    );
    expect(rustCommandsSource).toMatch(/oauth::oauth_logout_purge/);
    expect(actionsSource).toMatch(
      /transitionScope\(\s*'logout'[\s\S]*purgeNativeOAuth\([\s\S]*logoutAuthRuntimeSession\(\)/,
    );
  });
});
