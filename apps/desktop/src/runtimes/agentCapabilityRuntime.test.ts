import { describe, expect, it, vi } from 'vitest';

import type { AgentCapabilitySessionList } from '../services/desktop_api';
import {
  browserCapabilitySessionNeedsRefresh,
  ensureFreshBrowserCapabilitySession,
  reconcileAgentCapabilityProjection,
  selectActiveCapabilitySession,
} from './agentCapabilityRuntime';

type CapabilitySession = AgentCapabilitySessionList['sessions'][number];

function session(
  sessionId: string,
  platform: string,
  expiresAtSeconds: number,
  leaseRevision = 1,
): CapabilitySession {
  return {
    session_id: sessionId,
    ptid: 'ptid:actor-1',
    device_id: `device-${sessionId}`,
    platform,
    typed_capabilities: [],
    expires_at: { seconds: expiresAtSeconds, nanos: 0 },
    connection_id: `connection-${sessionId}`,
    lease_id: `lease-${sessionId}`,
    lease_revision: leaseRevision,
  };
}

describe('selectActiveCapabilitySession', () => {
  const nowMs = 1_000_000;

  it('prefers the active session matching the current shell', () => {
    const sessions = [
      session('desktop-session', 'CLIENT_PLATFORM_DESKTOP', 2_000),
      session('browser-session', 'CLIENT_PLATFORM_BROWSER', 2_000),
    ];

    expect(selectActiveCapabilitySession(sessions, true, nowMs)?.session_id)
      .toBe('browser-session');
    expect(selectActiveCapabilitySession(sessions, false, nowMs)?.session_id)
      .toBe('desktop-session');
  });

  it('does not fall back to the only active session from another platform', () => {
    const sessions = [
      session('expired-browser', 'CLIENT_PLATFORM_BROWSER', 900),
      session('desktop-session', 'CLIENT_PLATFORM_DESKTOP', 2_000),
    ];

    expect(selectActiveCapabilitySession(sessions, true, nowMs)).toBeUndefined();
  });

  it('rejects expired sessions and does not guess across multiple platforms', () => {
    const sessions = [
      session('expired-desktop', 'CLIENT_PLATFORM_DESKTOP', 900),
      session('mobile-a', 'CLIENT_PLATFORM_MOBILE', 2_000),
      session('mobile-b', 'CLIENT_PLATFORM_MOBILE', 3_000),
    ];

    expect(selectActiveCapabilitySession(sessions, false, nowMs)).toBeUndefined();
  });

  it('chooses the freshest preferred session deterministically', () => {
    const sessions = [
      session('browser-old', 'CLIENT_PLATFORM_BROWSER', 2_000, 5),
      session('browser-new', 'CLIENT_PLATFORM_BROWSER', 3_000, 1),
    ];

    expect(selectActiveCapabilitySession(sessions, true, nowMs)?.session_id)
      .toBe('browser-new');
  });
});

describe('Browser capability session freshness', () => {
  const nowMs = 1_000_000;

  it('refreshes a Browser session before the next reconcile could observe expiry', () => {
    expect(browserCapabilitySessionNeedsRefresh([
      session('browser-expiring', 'CLIENT_PLATFORM_BROWSER', 1_060),
    ], nowMs)).toBe(true);
    expect(browserCapabilitySessionNeedsRefresh([
      session('browser-fresh', 'CLIENT_PLATFORM_BROWSER', 1_061),
    ], nowMs)).toBe(false);
  });

  it('restarts the Browser owner and waits for a fresh Station lease', async () => {
    const refreshed = {
      sessions: [
        session('browser-refreshed', 'CLIENT_PLATFORM_BROWSER', 1_300, 1),
      ],
    };
    const lifecycle = {
      close: vi.fn().mockResolvedValue(undefined),
      open: vi.fn().mockResolvedValue(undefined),
      list: vi.fn()
        .mockResolvedValueOnce({ sessions: [] })
        .mockResolvedValue(refreshed),
    };
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(ensureFreshBrowserCapabilitySession({
      sessions: [
        session('browser-expiring', 'CLIENT_PLATFORM_BROWSER', 1_050, 4),
      ],
    }, lifecycle, {
      now: () => nowMs,
      sleep: wait,
    })).resolves.toBe(refreshed);

    expect(lifecycle.close).toHaveBeenCalledOnce();
    expect(lifecycle.open).toHaveBeenCalledOnce();
    expect(lifecycle.list).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
    expect(lifecycle.close.mock.invocationCallOrder[0])
      .toBeLessThan(lifecycle.open.mock.invocationCallOrder[0]);
  });

  it('preserves a fresh Browser session without cycling its owner', async () => {
    const current = {
      sessions: [
        session('browser-fresh', 'CLIENT_PLATFORM_BROWSER', 1_300, 7),
      ],
    };
    const lifecycle = {
      close: vi.fn().mockResolvedValue(undefined),
      open: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue(current),
    };

    await expect(ensureFreshBrowserCapabilitySession(
      current,
      lifecycle,
      { now: () => nowMs },
    )).resolves.toBe(current);
    expect(lifecycle.close).not.toHaveBeenCalled();
    expect(lifecycle.open).not.toHaveBeenCalled();
    expect(lifecycle.list).not.toHaveBeenCalled();
  });
});

describe('reconcileAgentCapabilityProjection', () => {
  it('reconciles descriptors with catalog and per-Agent authority state', async () => {
    const authorityStore = {
      loadCatalog: vi.fn().mockResolvedValue(undefined),
      loadKnowledgeDescriptors: vi.fn().mockResolvedValue(undefined),
      loadAgent: vi.fn().mockResolvedValue(undefined),
    };

    await reconcileAgentCapabilityProjection(
      authorityStore,
      ['agent-1', 'agent-2'],
      'session-desktop',
    );

    expect(authorityStore.loadCatalog).toHaveBeenCalledOnce();
    expect(authorityStore.loadKnowledgeDescriptors).toHaveBeenCalledOnce();
    expect(authorityStore.loadAgent).toHaveBeenNthCalledWith(1, 'agent-1', {
      clientCapabilitySessionId: 'session-desktop',
    });
    expect(authorityStore.loadAgent).toHaveBeenNthCalledWith(2, 'agent-2', {
      clientCapabilitySessionId: 'session-desktop',
    });
  });
});
