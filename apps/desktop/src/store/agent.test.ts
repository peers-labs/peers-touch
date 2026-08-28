import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../services/desktop_api';

const api = vi.hoisted(() => ({
  updateAgent: vi.fn(),
}));
const capabilityStore = vi.hoisted(() => ({
  loadAgent: vi.fn(),
}));

vi.mock('../services/desktop_api', () => ({
  api,
  parseAgentKnowledgeResources: vi.fn(() => []),
}));

vi.mock('../i18n/index', () => ({
  resolveI18nValue: (value: string) => value,
}));

vi.mock('./agentCapabilities', () => ({
  useAgentCapabilityStore: {
    getState: () => capabilityStore,
  },
}));

import { useAgentStore } from './agent';

const agent: Agent = {
  id: 'agent-1',
  name: 'assistant',
  title: 'Assistant',
  description: '',
  avatar: '',
  backgroundColor: '',
  systemPrompt: '',
  soulMd: '',
  agentsMd: '',
  model: 'model-1',
  provider: 'provider-1',
  effort: '',
  visibility: 'private',
  isolationEnabled: false,
  isolationMode: '',
  isolationRetentionDays: 0,
  workspaceMode: '',
  allowedRoots: '',
  tags: '',
  pinned: false,
  favorite: false,
  sortOrder: 0,
  openingMessage: '',
  openingQuestions: '',
  chatConfig: '{}',
  isDefault: true,
  version: 7,
  createdAt: '',
  updatedAt: '',
};

describe('Agent profile capability reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.setState({
      agents: [agent],
      error: null,
      saveStateByAgentId: {},
      pendingMutations: {},
    });
    api.updateAgent.mockResolvedValue({
      ...agent,
      model: 'model-2',
      version: 8,
    });
    capabilityStore.loadAgent.mockResolvedValue(undefined);
  });

  it('refreshes canonical capability bindings after a successful profile update', async () => {
    await useAgentStore.getState().updateAgentProfile(agent.id, {
      model: 'model-2',
    });

    expect(capabilityStore.loadAgent).toHaveBeenCalledWith(agent.id);
    expect(useAgentStore.getState().agents[0]).toMatchObject({
      model: 'model-2',
      version: 8,
    });
  });

  it('keeps the persisted Agent version when capability refresh fails', async () => {
    capabilityStore.loadAgent.mockRejectedValue(
      new Error('agent.capabilityRefreshFailed'),
    );

    await expect(
      useAgentStore.getState().updateAgentProfile(agent.id, {
        model: 'model-2',
      }),
    ).resolves.toMatchObject({ version: 8 });
    expect(useAgentStore.getState().agents[0]?.version).toBe(8);
    expect(useAgentStore.getState().error).toBe(
      'agent.capabilityRefreshFailed',
    );
  });
});
