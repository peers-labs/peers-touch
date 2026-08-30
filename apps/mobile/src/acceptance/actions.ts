import {
  submitStationInviteCodeGate,
  submitStationLoginGate,
} from '../features/auth/authSession';
import { verifyStationIdentity } from '../features/station/stationConnection';
import {
  activeStationEntry,
  addStationEntry,
  emptyStationRegistry,
  loadStationRegistry,
  persistStationRegistry,
  removeStationEntry,
  type StoredStationRegistry,
} from '../features/station/stationRegistry';
import {
  applyAccessGateRuntimeResult,
  cancelOAuth,
  clearAuthRuntimeSession,
  readAccessRuntimeProjection,
  readAuthRuntimeSnapshot,
  refreshOAuthStatus,
  startAccessAttemptForActiveStation,
  startOAuth,
} from '../runtimes/authRuntime';
import { readSharedBuildIdentity } from './buildIdentity';
import type { MobileAcceptanceNamespace } from './contracts';
import {
  purgeNativeOAuth,
  requestCallbackReplayHandle,
  submitNegativeOAuthCallback,
} from './negativeOAuth';
import {
  sanitizeAccessDecision,
  sanitizeMobileProjection,
  sanitizeOAuthProjection,
  sanitizeStationRegistry,
} from './projection';

export const mobileAcceptanceActions: MobileAcceptanceNamespace = {
  'build.identity': async () => readSharedBuildIdentity(),

  'station.add': async (input) => {
    const requestedUrl = requireString(input?.url, 'station.add.url');
    const verified = await verifyStationIdentity(requestedUrl);
    const current = await loadStationRegistry();
    const next = addVerifiedStation(current, verified);
    if (
      current.activeStationPeerId
      && current.activeStationPeerId !== verified.stationPeerId
    ) {
      await cancelAndClearCurrentAuthScope();
    }

    await persistStationRegistry(next);
    return stationMutationOutput(next, verified);
  },

  'station.replace': async (input) => {
    const currentStationPeerId = requireString(
      input?.stationPeerId,
      'station.replace.stationPeerId',
    );
    const requestedUrl = requireString(input?.url, 'station.replace.url');
    const current = await loadStationRegistry();
    if (!current.entries.some(
      (entry) => entry.stationPeerId === currentStationPeerId,
    )) {
      throw new Error('acceptance.mobile.stationNotFound');
    }

    const verified = await verifyStationIdentity(requestedUrl);
    const withoutReplacedStation = removeStationEntry(
      current,
      currentStationPeerId,
    );
    const next = addVerifiedStation(withoutReplacedStation, verified);
    await cancelAndClearCurrentAuthScope();
    await persistStationRegistry(next);
    return stationMutationOutput(next, verified);
  },

  'access.submit': async (input) => {
    if (!input) throw new Error('acceptance.mobile.invalidAccessSubmitInput');
    const station = requireActiveStation(await loadStationRegistry());

    if (input.kind === 'start') {
      const decision = await startAccessAttemptForActiveStation();
      return {
        decision: requirePublicDecision(decision),
        session: readAccessRuntimeProjection().session,
      };
    }

    const attemptId = requireString(
      input?.attemptId,
      'access.submit.attemptId',
    );

    if (input.kind === 'login') {
      const result = await submitStationLoginGate({
        stationPeerId: station.stationPeerId,
        stationUrl: station.url,
        attemptId,
        email: requireString(input.email, 'access.submit.email'),
        password: requireString(input.password, 'access.submit.password'),
      });
      applyAccessGateRuntimeResult(result.decision, result.session);
      return {
        decision: requirePublicDecision(result.decision),
        session: {
          stationPeerId: result.session.stationPeerId,
          actorPtid: result.session.actorRef.ptid,
          expiresAt: result.session.expiresAt,
        },
      };
    }

    if (input.kind === 'invite-code') {
      const decision = await submitStationInviteCodeGate({
        stationUrl: station.url,
        attemptId,
        inviteCode: requireString(
          input.inviteCode,
          'access.submit.inviteCode',
        ),
      });
      applyAccessGateRuntimeResult(decision);
      return {
        decision: requirePublicDecision(decision),
        session: readAccessRuntimeProjection().session,
      };
    }

    throw new Error('acceptance.mobile.invalidAccessSubmitKind');
  },

  'oauth.start': async (input) => {
    if (!input) throw new Error('acceptance.mobile.invalidOAuthStartInput');
    const station = requireActiveStation(await loadStationRegistry());
    const provider = input?.provider;
    if (provider !== 'github' && provider !== 'google') {
      throw new Error('acceptance.mobile.invalidOAuthProvider');
    }
    await startOAuth({
      provider,
      stationUrl: station.url,
      accessAttemptId: requireString(
        input.accessAttemptId,
        'oauth.start.accessAttemptId',
      ),
      gateId: requireString(input.gateId, 'oauth.start.gateId'),
    });
    return sanitizeOAuthProjection(readAuthRuntimeSnapshot());
  },

  'oauth.status': async () => {
    await refreshOAuthStatus();
    return sanitizeOAuthProjection(readAuthRuntimeSnapshot());
  },

  'oauth.cancel': async () => {
    await cancelOAuth();
    return sanitizeOAuthProjection(readAuthRuntimeSnapshot());
  },

  'oauth.replayHandle': async (input) => requestCallbackReplayHandle(input),

  'oauth.negativeCallback': async (input) => (
    submitNegativeOAuthCallback(input)
  ),

  'lifecycle.restart': async () => {
    return {
      requested: true,
      scope: 'webview',
    };
  },

  'native.deliverDeepLink': async (input) => {
    requireString(input?.url, 'native.deliverDeepLink.url');
    return {
      supported: false,
      reason: 'external-driver-required',
      owner: 'appium-native-context',
    };
  },

  'projection.read': async () => sanitizeMobileProjection({
    stationRegistry: await loadStationRegistry(),
    access: readAccessRuntimeProjection(),
    oauth: readAuthRuntimeSnapshot(),
  }),

  cleanup: async () => {
    const station = requireActiveStation(await loadStationRegistry());
    const oauthPurge = await purgeNativeOAuth({
      stationOrigin: station.url,
      stationPeerId: station.stationPeerId,
    });
    await clearAuthRuntimeSession();
    await persistStationRegistry(emptyStationRegistry());
    return {
      oauthPurge,
      webSessionProjectionCleared: true,
      stationRegistryCleared: true,
    };
  },
};

function addVerifiedStation(
  registry: StoredStationRegistry,
  verified: Awaited<ReturnType<typeof verifyStationIdentity>>,
): StoredStationRegistry {
  const result = addStationEntry(
    registry,
    {
      stationPeerId: verified.stationPeerId,
      url: verified.canonicalOrigin,
    },
    {
      checkedAt: verified.verifiedAt,
      online: true,
    },
  );
  if (!result.ok) throw new Error(result.error);
  return result.registry;
}

function stationMutationOutput(
  registry: StoredStationRegistry,
  verified: Awaited<ReturnType<typeof verifyStationIdentity>>,
) {
  return {
    ...sanitizeStationRegistry(registry),
    verifiedStationPeerId: verified.stationPeerId,
    canonicalOrigin: verified.canonicalOrigin,
  };
}

function requireActiveStation(registry: StoredStationRegistry) {
  const station = activeStationEntry(registry);
  if (!station) throw new Error('acceptance.mobile.activeStationRequired');
  return station;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`acceptance.mobile.invalidInput:${field}`);
  }
  return value.trim();
}

function requirePublicDecision(
  decision: Parameters<typeof sanitizeAccessDecision>[0],
) {
  const sanitized = sanitizeAccessDecision(decision);
  if (!sanitized) throw new Error('acceptance.mobile.accessDecisionMissing');
  return sanitized;
}

async function cancelAndClearCurrentAuthScope(): Promise<void> {
  await cancelOAuth();
  await clearAuthRuntimeSession();
}
