import type { ActorRef } from '../../gen/proto/domain/actor/actor_pb';

export type MobileActorRef = Pick<ActorRef, 'ptid'> & {
  acct?: ActorRef['acct'];
  kind?: ActorRef['kind'] | string;
};

export interface MobileAuthSession {
  stationPeerId: string;
  stationUrl: string;
  sessionId: string;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
  actorRef: MobileActorRef;
  authenticatedAt: number;
}

export interface MobileAuthScope {
  stationPeerId: string;
  ptid: string;
}

export function mobileAuthScope(session: MobileAuthSession): MobileAuthScope {
  const stationPeerId = session.stationPeerId.trim();
  const ptid = session.actorRef.ptid.trim();
  if (!stationPeerId || !ptid) {
    throw new Error('mobile.auth.missingIdentityScope');
  }
  return { stationPeerId, ptid };
}

export function mobileAuthScopeKey(session: MobileAuthSession): string {
  const scope = mobileAuthScope(session);
  return `${scope.stationPeerId}|${scope.ptid}`;
}

export function parseMobileAuthSession(value: unknown): MobileAuthSession | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<MobileAuthSession>;
  const actorRef = input.actorRef;
  const stationPeerId = typeof input.stationPeerId === 'string' ? input.stationPeerId.trim() : '';
  const stationUrl = typeof input.stationUrl === 'string' ? input.stationUrl.replace(/\/+$/, '') : '';
  const accessToken = typeof input.accessToken === 'string' ? input.accessToken : '';
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
  const ptid = typeof actorRef?.ptid === 'string' ? actorRef.ptid.trim() : '';
  const authenticatedAt = Number(input.authenticatedAt);

  if (!stationPeerId || !stationUrl || !sessionId || !accessToken || !ptid || !Number.isFinite(authenticatedAt)) {
    return null;
  }

  return {
    stationPeerId,
    stationUrl,
    sessionId,
    accessToken,
    refreshToken: optionalString(input.refreshToken),
    tokenType: optionalString(input.tokenType),
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
