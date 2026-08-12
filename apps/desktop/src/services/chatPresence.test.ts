import { describe, expect, it } from 'vitest';

import { isPresenceOnline, resolveChatPresenceTag } from './chatPresence';

describe('chat presence tag projection', () => {
  it('prioritizes active media transport over Station reachability', () => {
    expect(resolveChatPresenceTag({
      presenceKnown: true,
      online: true,
      sameStation: true,
      p2pState: 'connected',
      transport: 'direct',
    })).toBe('p2p');
    expect(resolveChatPresenceTag({
      presenceKnown: true,
      online: true,
      sameStation: true,
      p2pState: 'connected',
      transport: 'relay',
    })).toBe('relay');
  });

  it('projects same-Station, remote-online, offline, and unknown states', () => {
    expect(resolveChatPresenceTag({ presenceKnown: true, online: true, sameStation: true })).toBe('same-station');
    expect(resolveChatPresenceTag({ presenceKnown: true, online: true, sameStation: false })).toBe('online');
    expect(resolveChatPresenceTag({ presenceKnown: true, online: false, sameStation: true })).toBe('offline');
    expect(resolveChatPresenceTag({ presenceKnown: false, online: false, sameStation: true })).toBeNull();
  });

  it('accepts protobuf JSON and numeric online states', () => {
    expect(isPresenceOnline(1)).toBe(true);
    expect(isPresenceOnline('PRESENCE_STATE_ONLINE')).toBe(true);
    expect(isPresenceOnline('PRESENCE_STATE_OFFLINE')).toBe(false);
  });
});
