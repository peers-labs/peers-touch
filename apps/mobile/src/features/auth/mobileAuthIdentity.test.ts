import { describe, expect, it } from 'vitest';

import {
  isMobileAuthSessionValid,
  type MobileAuthSession,
} from './mobileAuthIdentity';

const session: MobileAuthSession = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  deviceId: 'device-a',
  lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

describe('Mobile auth session validity', () => {
  it('requires the complete Station and PTID-bound public scope', () => {
    expect(isMobileAuthSessionValid(session, 100)).toBe(true);
    expect(isMobileAuthSessionValid({
      ...session,
      actorRef: { ptid: '' },
    }, 100)).toBe(false);
    expect(isMobileAuthSessionValid({ ...session, sessionId: '' }, 100)).toBe(false);
    expect(isMobileAuthSessionValid({ ...session, deviceId: '' }, 100)).toBe(false);
    expect(isMobileAuthSessionValid({ ...session, lifecycleGeneration: 0 }, 100)).toBe(false);
  });

  it('rejects expired or malformed explicit expiry values', () => {
    expect(isMobileAuthSessionValid({
      ...session,
      expiresAt: '2026-09-17T00:00:00.000Z',
    }, Date.parse('2026-09-16T00:00:00.000Z'))).toBe(true);
    expect(isMobileAuthSessionValid({
      ...session,
      expiresAt: '2026-09-17T00:00:00.000Z',
    }, Date.parse('2026-09-17T00:00:00.000Z'))).toBe(false);
    expect(isMobileAuthSessionValid({
      ...session,
      expiresAt: 'not-a-date',
    }, 100)).toBe(false);
  });
});
