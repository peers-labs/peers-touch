import type { AccessDecision } from '../features/auth/authSession';
import type { StoredStationRegistry } from '../features/station/stationRegistry';
import type {
  AccessRuntimePublicProjection,
  AuthRuntimeSnapshot,
} from '../runtimes/authRuntime';
import type {
  MobilePublicProjection,
  PublicAccessDecision,
  PublicOAuthProjection,
  PublicStationEntry,
} from './contracts';

export function sanitizeStationRegistry(
  registry: StoredStationRegistry,
): MobilePublicProjection['station'] {
  return {
    activeStationPeerId: registry.activeStationPeerId,
    entries: registry.entries.map(toPublicStationEntry),
  };
}

export function sanitizeAccessDecision(
  decision: AccessDecision | null | undefined,
): PublicAccessDecision | null {
  if (!decision) return null;
  return {
    state: decision.state,
    attemptId: decision.attemptId,
    currentGateId: decision.currentGateId,
    accessGrantId: decision.accessGrantId,
    gates: decision.gates.map((gate) => ({
      gateId: gate.gateId,
      type: gate.type,
      state: gate.state,
    })),
  };
}

export function sanitizeOAuthProjection(
  snapshot: AuthRuntimeSnapshot,
): PublicOAuthProjection {
  return {
    phase: snapshot.phase,
    stationPeerId: snapshot.stationPeerId,
    provider: snapshot.provider,
    accessAttemptId: snapshot.accessAttemptId,
    gateId: snapshot.gateId,
    expiresAtUnixMs: snapshot.expiresAtUnixMs,
    result: snapshot.result,
    errorCode: snapshot.errorCode,
    candidatePtid: snapshot.candidatePtid,
    accessDecision: sanitizeOAuthAccessDecision(snapshot.accessDecision),
    session: snapshot.session ? {
      actorPtid: snapshot.session.actorPtid,
      expiresAt: snapshot.session.expiresAt,
    } : null,
    errorKey: snapshot.errorKey,
    recovery: snapshot.recovery,
  };
}

export function sanitizeMobileProjection(input: {
  stationRegistry: StoredStationRegistry;
  access: AccessRuntimePublicProjection;
  oauth: AuthRuntimeSnapshot;
}): MobilePublicProjection {
  return {
    station: sanitizeStationRegistry(input.stationRegistry),
    access: {
      decision: sanitizeAccessDecision(input.access.decision),
      session: input.access.session ? {
        stationPeerId: input.access.session.stationPeerId,
        actorPtid: input.access.session.actorPtid,
        expiresAt: input.access.session.expiresAt,
      } : null,
      loading: input.access.loading,
      errorKey: input.access.errorKey,
      restored: input.access.restored,
    },
    oauth: sanitizeOAuthProjection(input.oauth),
  };
}

function toPublicStationEntry(
  entry: StoredStationRegistry['entries'][number],
): PublicStationEntry {
  return {
    stationPeerId: entry.stationPeerId,
    url: entry.url,
    label: entry.label,
    online: entry.online,
    lastCheckedAt: entry.lastCheckedAt,
  };
}

function sanitizeOAuthAccessDecision(
  decision: AuthRuntimeSnapshot['accessDecision'],
): PublicAccessDecision | null {
  if (!decision) return null;
  return {
    state: decision.state,
    attemptId: decision.attemptId,
    currentGateId: decision.currentGateId,
    accessGrantId: decision.accessGrantId,
    gates: decision.gates.map((gate) => ({
      gateId: gate.gateId,
      type: gate.gateType,
      state: gate.state,
    })),
  };
}
