export type ChatPresenceTag = 'p2p' | 'relay' | 'same-station' | 'online' | 'offline';

export function resolvePresenceOnline(state: number | string): boolean | null {
  if (state === 1) return true;
  if (state === 2) return false;
  const normalized = String(state).trim().toUpperCase();
  if (normalized === 'PRESENCE_STATE_ONLINE' || normalized === 'ONLINE') return true;
  if (normalized === 'PRESENCE_STATE_OFFLINE' || normalized === 'OFFLINE') return false;
  return null;
}

export function isPresenceOnline(state: number | string): boolean {
  return resolvePresenceOnline(state) === true;
}

export function shouldApplyPresenceRevision(
  currentRevision: number | undefined,
  incomingRevision: number,
): boolean {
  return incomingRevision >= (currentRevision ?? 0);
}

export function resolveChatPresenceTag(input: {
  presenceKnown: boolean;
  online: boolean;
  sameStation: boolean;
  p2pState?: string;
  transport?: 'direct' | 'relay' | null;
}): ChatPresenceTag | null {
  if (input.p2pState === 'connected' && input.transport === 'direct') return 'p2p';
  if (input.p2pState === 'connected' && input.transport === 'relay') return 'relay';
  if (!input.presenceKnown) return null;
  if (!input.online) return 'offline';
  if (input.sameStation) return 'same-station';
  return 'online';
}
