import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  isPresenceOnline,
  resolveChatPresenceTag,
  resolvePresenceOnline,
  shouldApplyPresenceRevision,
} from './chatPresence';

const presenceHookSource = readFileSync(
  new URL('../hooks/usePresence.ts', import.meta.url),
  'utf8',
);
const rustPresenceDomainSource = readFileSync(
  new URL('../../src-tauri/src/domain/presence/mod.rs', import.meta.url),
  'utf8',
);

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
    expect(isPresenceOnline('online')).toBe(true);
    expect(isPresenceOnline('PRESENCE_STATE_OFFLINE')).toBe(false);
    expect(resolvePresenceOnline(0)).toBeNull();
  });

  it('rejects snapshots older than a realtime presence event', () => {
    expect(shouldApplyPresenceRevision(undefined, 1)).toBe(true);
    expect(shouldApplyPresenceRevision(4, 4)).toBe(true);
    expect(shouldApplyPresenceRevision(5, 4)).toBe(false);
  });

  it('keeps window focus out of offline presence semantics', () => {
    expect(presenceHookSource).not.toContain("fire('app_background')");
    expect(rustPresenceDomainSource).not.toContain('AppBackground');
    expect(presenceHookSource).toContain(
      'export const PRESENCE_HEARTBEAT_INTERVAL_MS = 30 * 1000',
    );
  });
});
