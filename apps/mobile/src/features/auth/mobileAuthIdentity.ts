import type { ActorRef } from '../../gen/proto/domain/actor/actor_pb';

export type MobileActorRef = Pick<ActorRef, 'ptid'> & {
  acct?: ActorRef['acct'];
  kind?: ActorRef['kind'] | string;
};

export interface MobileAuthSession {
  stationPeerId: string;
  stationUrl: string;
  sessionId: string;
  deviceId: string;
  lifecycleGeneration: number;
  expiresAt?: string;
  actorRef: MobileActorRef;
  authenticatedAt: number;
}

export interface MobileAuthScope {
  stationPeerId: string;
  ptid: string;
  deviceId: string;
  lifecycleGeneration: number;
}

export function mobileAuthScope(session: MobileAuthSession): MobileAuthScope {
  const stationPeerId = session.stationPeerId.trim();
  const ptid = session.actorRef.ptid.trim();
  const deviceId = session.deviceId.trim();
  const lifecycleGeneration = session.lifecycleGeneration;
  if (
    !stationPeerId
    || !ptid
    || !deviceId
    || !Number.isSafeInteger(lifecycleGeneration)
    || lifecycleGeneration <= 0
  ) {
    throw new Error('mobile.auth.missingIdentityScope');
  }
  return { stationPeerId, ptid, deviceId, lifecycleGeneration };
}

export function mobileAuthScopeKey(session: MobileAuthSession): string {
  const scope = mobileAuthScope(session);
  return `${scope.stationPeerId}|${scope.ptid}|${scope.deviceId}|${scope.lifecycleGeneration}`;
}

export function isMobileAuthSessionValid(
  session: MobileAuthSession | null | undefined,
  now = Date.now(),
): session is MobileAuthSession {
  if (
    !session
    || !session.stationPeerId.trim()
    || !session.stationUrl.trim()
    || !session.sessionId.trim()
    || !session.deviceId.trim()
    || !Number.isSafeInteger(session.lifecycleGeneration)
    || session.lifecycleGeneration <= 0
    || !session.actorRef.ptid.trim()
    || !Number.isFinite(session.authenticatedAt)
  ) {
    return false;
  }
  if (!session.expiresAt) return true;

  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function parseMobileAuthSession(value: unknown): MobileAuthSession | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<MobileAuthSession>;
  const actorRef = input.actorRef;
  const stationPeerId = typeof input.stationPeerId === 'string' ? input.stationPeerId.trim() : '';
  const stationUrl = typeof input.stationUrl === 'string' ? input.stationUrl.replace(/\/+$/, '') : '';
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
  const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';
  const lifecycleGeneration = Number(input.lifecycleGeneration);
  const ptid = typeof actorRef?.ptid === 'string' ? actorRef.ptid.trim() : '';
  const authenticatedAt = Number(input.authenticatedAt);

  if (
    !stationPeerId
    || !stationUrl
    || !sessionId
    || !deviceId
    || !Number.isSafeInteger(lifecycleGeneration)
    || lifecycleGeneration <= 0
    || !ptid
    || !Number.isFinite(authenticatedAt)
  ) {
    return null;
  }

  return {
    stationPeerId,
    stationUrl,
    sessionId,
    deviceId,
    lifecycleGeneration,
    expiresAt: optionalString(input.expiresAt),
    actorRef: {
      ptid,
      acct: optionalString(actorRef?.acct),
      kind: actorRef?.kind,
    },
    authenticatedAt,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
