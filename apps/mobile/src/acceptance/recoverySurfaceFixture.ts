import { create } from '@bufbuild/protobuf';
import { useSyncExternalStore } from 'react';

import {
  MobileDraftEnvelopeV2Schema,
  MobileDraftSurfaceKind,
  MobileDurableCommandEnvelopeV2Schema,
  MobileDurableCommandErrorCode,
  MobileDurableCommandState,
} from '../gen/proto/domain/mobile/reliability_pb';
import type { DraftProjection } from '../runtimes/commandRuntime';
import type { RecoveryState } from '../runtimes/recoveryProjection';

export const RECOVERY_SURFACE_FIXTURE_IDS = [
  'recovery.session-valid-restore',
  'recovery.session-revoked',
  'recovery.session-mismatch',
  'recovery.draft-restore',
  'recovery.draft-restore-failed',
  'recovery.capacity',
  'recovery.command',
  'recovery.deferred-capability',
  'recovery.event-overflow',
  'recovery.projection-stale',
  'recovery.write-revocation',
  'recovery.scope-exit',
  'recovery.reset-incomplete',
  'recovery.device-local',
  'recovery.legacy-reliability',
  'recovery.legacy-read-only',
] as const;

export type RecoverySurfaceFixtureId =
  typeof RECOVERY_SURFACE_FIXTURE_IDS[number];

export interface RecoverySurfaceFixtureSnapshot {
  readonly surfaceId: RecoverySurfaceFixtureId | null;
  readonly revision: number;
}

const listeners = new Set<() => void>();
let snapshot: RecoverySurfaceFixtureSnapshot = {
  surfaceId: null,
  revision: 0,
};

const fixtureDraft: DraftProjection = {
  key: 'chat:restored-draft',
  kind: 'chat',
  surfaceKind: 'chat',
  targetId: 'restored-draft',
  updatedAtMs: 1,
  envelope: create(MobileDraftEnvelopeV2Schema, {
    schemaRevision: 2,
    stationPeerId: 'fixture-station',
    actorPtid: 'fixture-actor',
    surfaceKind: MobileDraftSurfaceKind.CHAT_COMPOSER,
    targetId: 'restored-draft',
    payload: {
      case: 'chat',
      value: {
        text: 'Saved draft',
        replyToMessageId: '',
        attachmentRefs: [],
      },
    },
  }),
};

const fixtureCommand = {
  commandId: 'fixture-command',
  orderingKey: 'fixture-ordering-key',
  state: 'unknown-outcome' as const,
  attemptCount: 1,
  typedLastError: MobileDurableCommandErrorCode.TRANSPORT,
  createdAtMs: 1,
  updatedAtMs: 2,
  nextAttemptAtMs: null,
  envelope: create(MobileDurableCommandEnvelopeV2Schema, {
    schemaRevision: 2,
    commandId: 'fixture-command',
    stationPeerId: 'fixture-station',
    actorPtid: 'fixture-actor',
    orderingKey: 'fixture-ordering-key',
    attemptCount: 1,
    state: MobileDurableCommandState.UNKNOWN_OUTCOME,
    typedLastError: MobileDurableCommandErrorCode.TRANSPORT,
  }),
};

export function useRecoverySurfaceFixture(): RecoverySurfaceFixtureSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setRecoverySurfaceFixture(
  surfaceId: RecoverySurfaceFixtureId | null,
): RecoverySurfaceFixtureSnapshot {
  if (snapshot.surfaceId === surfaceId) return snapshot;
  snapshot = {
    surfaceId,
    revision: snapshot.revision + 1,
  };
  listeners.forEach((listener) => listener());
  return snapshot;
}

export function isRecoverySurfaceFixtureId(
  value: unknown,
): value is RecoverySurfaceFixtureId {
  return typeof value === 'string'
    && (RECOVERY_SURFACE_FIXTURE_IDS as readonly string[]).includes(value);
}

export function recoveryStateForFixture(
  surfaceId: RecoverySurfaceFixtureId | null,
): RecoveryState | null {
  switch (surfaceId) {
    case 'recovery.session-revoked':
      return {
        kind: 'device-local-flag',
        reason: 'session-expired',
        since: 1,
      };
    case 'recovery.session-mismatch':
      return {
        kind: 'session-mismatch',
        expectedStationPeerId: 'saved-station',
        actualStationPeerId: 'observed-station',
        detectedAtMs: 1,
      };
    case 'recovery.draft-restore':
    case 'recovery.draft-restore-failed':
      return {
        kind: 'draft-restore-pending',
        drafts: [fixtureDraft],
        discoveredAtMs: 1,
      };
    case 'recovery.capacity':
      return {
        kind: 'capacity-read-only',
        currentDepth: 256,
        maxCapacity: 256,
        currentBytes: 8 * 1024 * 1024,
        maxBytes: 8 * 1024 * 1024,
        exhaustionCauses: ['record-count', 'byte-capacity'],
      };
    case 'recovery.command':
      return {
        kind: 'command-recovery',
        commands: [fixtureCommand],
      };
    case 'recovery.deferred-capability':
      return {
        kind: 'deferred-capability',
        unavailableRuntimes: [{
          runtimeId: 'fixture-module',
          title: 'Unavailable feature',
          status: 'failed',
          errorMessage: null,
        }],
      };
    case 'recovery.event-overflow':
      return {
        kind: 'event-overflow-reconcile',
        staleDomains: [{
          domain: 'social',
          staleness: {
            stale: true,
            reason: 'event-overflow',
            since: 1,
          },
        }],
      };
    case 'recovery.projection-stale':
      return {
        kind: 'event-overflow-reconcile',
        staleDomains: [{
          domain: 'moments',
          staleness: {
            stale: true,
            reason: 'projection-stale',
            since: 1,
          },
        }],
      };
    case 'recovery.write-revocation':
      return {
        kind: 'write-revocation',
        admission: {
          open: false,
          reason: 'session-revalidation',
          closedAt: 1,
        },
      };
    case 'recovery.reset-incomplete':
      return { kind: 'reliability-reset-recovery' };
    case 'recovery.device-local':
      return {
        kind: 'device-local-flag',
        reason: 'no-network',
        since: 1,
      };
    case 'recovery.legacy-reliability':
      return {
        kind: 'legacy-reliability-recovery',
        archivedLegacyFiles: 2,
        retainedReadOnly: false,
      };
    case 'recovery.legacy-read-only':
      return {
        kind: 'legacy-reliability-recovery',
        archivedLegacyFiles: 2,
        retainedReadOnly: true,
      };
    default:
      return null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): RecoverySurfaceFixtureSnapshot {
  return snapshot;
}
