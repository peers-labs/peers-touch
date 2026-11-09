import {
  messagingStatus,
  privateSocialStatus,
  readStationRouteBinding,
  type MessagingRuntimeStatus,
  type PrivateSocialReconciliationReport,
  type PrivateSocialRuntimeStatus,
  type StationRouteBindingProjection,
} from '../../services/mobileCommands';
import {
  readPrivateMomentsSnapshot,
  type PrivateMomentsRuntimeSnapshot,
} from '../../runtimes/privateMomentsRuntime';

export type MobileDebugSectionStatus = 'ok' | 'empty' | 'error';

export interface MobileDebugSection<T> {
  readonly status: MobileDebugSectionStatus;
  readonly data: T | null;
  readonly error: string | null;
}

export interface MobilePrivateMomentsDiagnostic {
  readonly active: boolean;
  readonly reconciling: boolean;
  readonly stationPeerId: string | null;
  readonly actorPtid: string | null;
  readonly deviceId: string | null;
  readonly lifecycleGeneration: string;
  readonly activationGeneration: number;
  readonly publishCount: number;
  readonly readCount: number;
  readonly commentCount: number;
  readonly lastReport: PrivateSocialReconciliationReport | null;
  readonly errorMessage: string | null;
}

export interface MobileDebugSnapshot {
  readonly capturedAtMillis: number;
  readonly stationRoute: MobileDebugSection<StationRouteBindingProjection>;
  readonly messaging: MobileDebugSection<MessagingRuntimeStatus>;
  readonly privateSocial: MobileDebugSection<PrivateSocialRuntimeStatus>;
  readonly privateMoments: MobileDebugSection<MobilePrivateMomentsDiagnostic>;
}

function describeSectionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function collectSection<T>(
  read: () => Promise<T | null>,
): Promise<MobileDebugSection<T>> {
  try {
    const data = await read();
    const empty = data === null || data === undefined;
    return { status: empty ? 'empty' as const : 'ok' as const, data, error: null };
  } catch (error) {
    return {
      status: 'error' as const,
      data: null,
      error: describeSectionError(error),
    };
  }
}

function projectPrivateMoments(
  source: PrivateMomentsRuntimeSnapshot,
): MobilePrivateMomentsDiagnostic {
  return {
    active: source.active,
    reconciling: source.reconciling,
    stationPeerId: source.stationPeerId,
    actorPtid: source.actorPtid,
    deviceId: source.deviceId,
    lifecycleGeneration: source.lifecycleGeneration,
    activationGeneration: source.activationGeneration,
    publishCount: source.projections.length,
    readCount: Object.keys(source.postsById).length,
    commentCount: source.comments.length,
    lastReport: source.lastReport,
    errorMessage: source.errorMessage,
  };
}

export async function collectMobileDebugSnapshot(): Promise<MobileDebugSnapshot> {
  const [stationRoute, messaging, privateSocial] = await Promise.all([
    collectSection(() => readStationRouteBinding()),
    collectSection(() => messagingStatus()),
    collectSection(() => privateSocialStatus()),
  ]);

  return {
    capturedAtMillis: Date.now(),
    stationRoute,
    messaging,
    privateSocial,
    privateMoments: {
      status: 'ok',
      data: projectPrivateMoments(readPrivateMomentsSnapshot()),
      error: null,
    },
  };
}
