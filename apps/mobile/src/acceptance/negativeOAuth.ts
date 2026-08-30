import { invoke } from '@tauri-apps/api/core';

import type {
  CallbackReplayHandleInput,
  CallbackReplayHandleOutput,
  NegativeOAuthCallbackInput,
  NegativeOAuthCallbackOutput,
  OAuthPurgeInput,
  OAuthPurgeOutput,
  PublicNegativeOAuthProjection,
} from './contracts';

export async function requestCallbackReplayHandle(
  input: CallbackReplayHandleInput,
): Promise<CallbackReplayHandleOutput> {
  const result = await invoke<unknown>(
    'oauth_acceptance_callback_replay_handle',
    { input },
  );
  const record = requireRecord(result, 'callbackReplayHandle');
  return {
    callbackReplayHandle: requireString(
      record.callbackReplayHandle,
      'callbackReplayHandle',
    ),
  };
}

export async function submitNegativeOAuthCallback(
  input: NegativeOAuthCallbackInput,
): Promise<NegativeOAuthCallbackOutput> {
  const rawResult = await invoke<unknown>(
    'oauth_acceptance_negative_callback',
    { input },
  );
  const result = requireRecord(rawResult, 'negativeCallback');
  const operation = requireNegativeOperation(result.operation);
  const failure = requireExpectedFailure(result.failure);
  if (
    operation !== input.intent.operation
    || failure !== input.intent.expectedFailure
  ) {
    throw new Error('acceptance.mobile.negativeOAuthResultMismatch');
  }
  const projection = sanitizeNegativeOAuthProjection(result.projection);
  if (projection.sessionPresent) {
    throw new Error('acceptance.mobile.negativeOAuthCreatedSession');
  }
  return {
    operation,
    failure,
    projection,
  };
}

export async function purgeNativeOAuth(
  input: OAuthPurgeInput,
): Promise<OAuthPurgeOutput> {
  const result = await invoke<unknown>(
    'oauth_logout_purge',
    { input },
  );
  return sanitizeOAuthPurgeOutput(result);
}

export function sanitizeNegativeOAuthProjection(
  value: unknown,
): PublicNegativeOAuthProjection {
  const projection = requireRecord(value, 'negativeOAuthProjection');
  const candidate = optionalRecord(projection.candidate);
  const accessDecision = optionalRecord(projection.accessDecision);
  return {
    phase: requireOAuthPhase(projection.phase),
    stationPeerId: optionalString(projection.stationPeerId),
    provider: optionalString(projection.provider),
    accessAttemptId: optionalString(projection.accessAttemptId),
    gateId: optionalString(projection.gateId),
    expiresAtUnixMs: optionalNumber(projection.expiresAtUnixMs),
    result: optionalString(projection.result),
    errorCode: optionalString(projection.errorCode),
    candidatePtid: optionalString(candidate?.actorPtid),
    accessDecision: accessDecision ? {
      state: optionalString(accessDecision.state),
      currentGateId: optionalString(
        accessDecision.currentGateId,
      ),
    } : null,
    sessionPresent: projection.session !== undefined
      && projection.session !== null,
  };
}

export function sanitizeOAuthPurgeOutput(
  value: unknown,
): OAuthPurgeOutput {
  const result = requireRecord(value, 'oauthPurge');
  const stationRevocation = result.stationRevocation;
  if (
    stationRevocation !== 'not_required'
    && stationRevocation !== 'confirmed'
    && stationRevocation !== 'unconfirmed'
  ) {
    throw new Error('acceptance.mobile.invalidOAuthPurgeProjection');
  }
  const secureStorage = requireRecord(
    result.secureStorage,
    'secureStorage',
  );

  return {
    stationRevocation,
    secureStorage: {
      activeAttemptIndexAbsent: requireBoolean(
        secureStorage.activeAttemptIndexAbsent,
        'activeAttemptIndexAbsent',
      ),
      attemptSecretRecordAbsent: requireBoolean(
        secureStorage.attemptSecretRecordAbsent,
        'attemptSecretRecordAbsent',
      ),
      currentSessionIndexAbsent: requireBoolean(
        secureStorage.currentSessionIndexAbsent,
        'currentSessionIndexAbsent',
      ),
      credentialRecordAbsent: requireBoolean(
        secureStorage.credentialRecordAbsent,
        'credentialRecordAbsent',
      ),
      publicProjectionAbsent: requireBoolean(
        secureStorage.publicProjectionAbsent,
        'publicProjectionAbsent',
      ),
    },
  };
}

function requireRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`acceptance.mobile.invalidProjection:${field}`);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`acceptance.mobile.invalidProjection:${field}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`acceptance.mobile.invalidProjection:${field}`);
  }
  return value;
}

function requireNegativeOperation(
  value: unknown,
): NegativeOAuthCallbackOutput['operation'] {
  if (
    value !== 'replay'
    && value !== 'provider_mismatch'
    && value !== 'station_mismatch'
  ) {
    throw new Error('acceptance.mobile.invalidNegativeOAuthOperation');
  }
  return value;
}

function requireExpectedFailure(
  value: unknown,
): NegativeOAuthCallbackOutput['failure'] {
  if (
    value !== 'oauthReplay'
    && value !== 'oauthProviderMismatch'
    && value !== 'oauthStationMismatch'
  ) {
    throw new Error('acceptance.mobile.invalidNegativeOAuthFailure');
  }
  return value;
}

function requireOAuthPhase(
  value: unknown,
): PublicNegativeOAuthProjection['phase'] {
  if (
    value !== 'idle'
    && value !== 'starting'
    && value !== 'awaiting_provider'
    && value !== 'callback_received'
    && value !== 'exchanging'
    && value !== 'following_gate'
    && value !== 'credential_delivery'
    && value !== 'active_session'
    && value !== 'cancelled'
    && value !== 'expired'
    && value !== 'failed'
  ) {
    throw new Error('acceptance.mobile.invalidOAuthPhase');
  }
  return value;
}
