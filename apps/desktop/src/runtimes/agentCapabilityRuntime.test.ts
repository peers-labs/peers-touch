import { describe, expect, it, vi } from 'vitest';

import type { AgentCapabilitySessionList } from '../services/desktop_api';
import {
  authorityEventAgentId,
  reconcileAgentCapabilityProjection,
  selectActiveCapabilitySession,
  selectAuthorityStreamAgentIds,
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

describe('selectAuthorityStreamAgentIds', () => {
  const agents = Array.from({ length: 7 }, (_, index) => ({
    id: `agent-${index + 1}`,
    name: `Agent ${index + 1}`,
  }));

  it('prioritizes the selected Agent within a bounded stream set', () => {
    expect(selectAuthorityStreamAgentIds(agents, 'Agent 7')).toEqual([
      'agent-7',
      'agent-1',
      'agent-2',
      'agent-3',
    ]);
  });

  it('uses stable roster order when the selected Agent is unavailable', () => {
    expect(selectAuthorityStreamAgentIds(agents, 'Missing')).toEqual([
      'agent-1',
      'agent-2',
      'agent-3',
      'agent-4',
    ]);
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

  it('bounds per-Agent authority projection concurrency', async () => {
    let activeLoads = 0;
    let maximumActiveLoads = 0;
    const releases: Array<() => void> = [];
    const authorityStore = {
      loadCatalog: vi.fn().mockResolvedValue(undefined),
      loadKnowledgeDescriptors: vi.fn().mockResolvedValue(undefined),
      loadAgent: vi.fn(async () => {
        activeLoads += 1;
        maximumActiveLoads = Math.max(maximumActiveLoads, activeLoads);
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        activeLoads -= 1;
      }),
    };

    const reconciliation = reconcileAgentCapabilityProjection(
      authorityStore,
      ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'],
    );
    await vi.waitFor(() => {
      expect(authorityStore.loadAgent).toHaveBeenCalledTimes(2);
    });
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => {
      expect(authorityStore.loadAgent).toHaveBeenCalledTimes(4);
    });
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => {
      expect(authorityStore.loadAgent).toHaveBeenCalledTimes(5);
    });
    releases.splice(0).forEach((release) => release());
    await reconciliation;

    expect(maximumActiveLoads).toBe(2);
    expect(authorityStore.loadAgent).toHaveBeenCalledTimes(5);
  });

  it('settles all Agent projections before propagating a failure', async () => {
    const failure = new Error('agent-2 failed');
    const authorityStore = {
      loadCatalog: vi.fn().mockResolvedValue(undefined),
      loadKnowledgeDescriptors: vi.fn().mockResolvedValue(undefined),
      loadAgent: vi.fn(async (agentId: string) => {
        if (agentId === 'agent-2') throw failure;
      }),
    };

    await expect(reconcileAgentCapabilityProjection(
      authorityStore,
      ['agent-1', 'agent-2', 'agent-3'],
    )).rejects.toBe(failure);

    expect(authorityStore.loadAgent).toHaveBeenCalledTimes(3);
  });
});
