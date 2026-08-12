export type ChatPresenceTag = 'p2p' | 'relay' | 'same-station' | 'online' | 'offline';

export function isPresenceOnline(state: number | string): boolean {
  return state === 1 || state === 'PRESENCE_STATE_ONLINE' || state === 'ONLINE';
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
