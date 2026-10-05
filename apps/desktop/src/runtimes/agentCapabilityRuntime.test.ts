import { describe, expect, it, vi } from 'vitest';

import type { AgentCapabilitySessionList } from '../services/desktop_api';
import {
  authorityEventAgentId,
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

  it('selects the active Desktop session', () => {
    const sessions = [
      session('desktop-session', 'CLIENT_PLATFORM_DESKTOP', 2_000),
      session('mobile-session', 'CLIENT_PLATFORM_MOBILE', 2_000),
    ];

    expect(selectActiveCapabilitySession(sessions, nowMs)?.session_id)
      .toBe('desktop-session');
  });

  it('does not fall back to the only active session from another platform', () => {
    const sessions = [
      session('expired-desktop', 'CLIENT_PLATFORM_DESKTOP', 900),
      session('mobile-session', 'CLIENT_PLATFORM_MOBILE', 2_000),
    ];

    expect(selectActiveCapabilitySession(sessions, nowMs)).toBeUndefined();
  });

  it('rejects expired sessions and does not guess across multiple platforms', () => {
    const sessions = [
      session('expired-desktop', 'CLIENT_PLATFORM_DESKTOP', 900),
      session('mobile-a', 'CLIENT_PLATFORM_MOBILE', 2_000),
      session('mobile-b', 'CLIENT_PLATFORM_MOBILE', 3_000),
    ];

    expect(selectActiveCapabilitySession(sessions, nowMs)).toBeUndefined();
  });

  it('chooses the freshest preferred session deterministically', () => {
    const sessions = [
      session('desktop-old', 'CLIENT_PLATFORM_DESKTOP', 2_000, 5),
      session('desktop-new', 'CLIENT_PLATFORM_DESKTOP', 3_000, 1),
    ];

    expect(selectActiveCapabilitySession(sessions, nowMs)?.session_id)
      .toBe('desktop-new');
  });
});

describe('authorityEventAgentId', () => {
  it('accepts only the canonical authority invalidation envelope', () => {
    expect(authorityEventAgentId({
      streamId: 'stream-1',
      agentId: 'agent-1',
      event: 'agent.authority.invalidated',
      data: { payload: { agent_id: 'agent-1' } },
    })).toBe('agent-1');
    expect(authorityEventAgentId({
      streamId: 'stream-1',
      agentId: 'agent-1',
      event: 'agent.updated',
      data: { payload: { agent_id: 'agent-1' } },
    })).toBe('');
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
