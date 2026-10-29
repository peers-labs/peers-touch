export interface SessionIdentityScope {
  readonly actorPtid: string;
  readonly stationPeerId: string;
  readonly sessionEpoch: number;
}

/** Pure projection of the session owner's completed native Station binding. */
export function sessionIdentityScope(session: {
  readonly authenticated: boolean;
  readonly currentUser: { readonly actorPtid: string } | null;
  readonly stationPeerId: string | null;
  readonly sessionEpoch: number;
}): SessionIdentityScope | null {
  if (!session.authenticated || !session.currentUser || !session.stationPeerId) return null;
  return {
    actorPtid: session.currentUser.actorPtid,
    stationPeerId: session.stationPeerId,
    sessionEpoch: session.sessionEpoch,
  };
}
