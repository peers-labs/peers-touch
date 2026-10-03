import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../services/desktop_api';

const api = vi.hoisted(() => ({
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  duplicateAgent: vi.fn(),
  getAgent: vi.fn(),
  getSelectedAgent: vi.fn(),
  listAgentsWithMeta: vi.fn(),
  setSelectedAgent: vi.fn(),
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

import { isActiveMutationConflict, useAgentStore } from './agent';

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
      selectedAgent: agent.name,
      defaultAgent: agent.name,
      selectedModel: agent.model,
      selectedProviderId: agent.provider,
      error: null,
      saveStateByAgentId: {},
      pendingMutations: {},
    });
    api.updateAgent.mockResolvedValue({
      ...agent,
      model: 'model-2',
      version: 8,
    });
    api.getAgent.mockResolvedValue({
      ...agent,
      title: 'Authoritative title',
      model: 'model-3',
      provider: 'provider-2',
      version: 8,
    });
    capabilityStore.loadAgent.mockResolvedValue(undefined);
    api.getSelectedAgent.mockResolvedValue(agent.name);
    api.listAgentsWithMeta.mockResolvedValue({
      agents: [agent],
      defaultAgent: agent.name,
      selectedAgent: agent.name,
    });
    api.setSelectedAgent.mockResolvedValue(undefined);
  });

  it('creates exactly one Agent and selects the authoritative result', async () => {
    const created = {
      ...agent,
      id: 'agent-created',
      name: 'research-agent',
      title: 'Research Agent',
      isDefault: false,
      version: 1,
    };
    api.createAgent.mockResolvedValueOnce(created);

    await expect(useAgentStore.getState().createAgent({
      name: created.name,
      title: created.title,
    })).resolves.toMatchObject({
      id: created.id,
      name: created.name,
    });

    expect(api.createAgent).toHaveBeenCalledOnce();
    expect(api.setSelectedAgent).toHaveBeenCalledWith(created.name);
    expect(useAgentStore.getState()).toMatchObject({
      selectedAgent: created.name,
    });
    expect(useAgentStore.getState().agents).toContainEqual(
      expect.objectContaining({ id: created.id }),
    );
  });

  it('uses deterministic unique clone names and selects each clone', async () => {
    api.duplicateAgent
      .mockImplementationOnce(async (_id: string, name: string) => ({
        ...agent,
        id: 'agent-copy-1',
        name,
        isDefault: false,
      }))
      .mockImplementationOnce(async (_id: string, name: string) => ({
        ...agent,
        id: 'agent-copy-2',
        name,
        isDefault: false,
      }));

    await useAgentStore.getState().duplicateAgent(agent.id);
    await useAgentStore.getState().duplicateAgent(agent.id);

    expect(api.duplicateAgent).toHaveBeenNthCalledWith(
      1,
      agent.id,
      'assistant-copy',
    );
    expect(api.duplicateAgent).toHaveBeenNthCalledWith(
      2,
      agent.id,
      'assistant-copy-2',
    );
    expect(useAgentStore.getState().selectedAgent).toBe('assistant-copy-2');
  });

  it('reconciles selection and default after deleting the active Agent', async () => {
    const fallback = {
      ...agent,
      id: 'agent-fallback',
      name: 'fallback',
      title: 'Fallback',
      isDefault: true,
    };
    useAgentStore.setState({
      agents: [{ ...agent, isDefault: true }, fallback],
      selectedAgent: agent.name,
      defaultAgent: agent.name,
    });
    api.deleteAgent.mockResolvedValueOnce(undefined);
    api.getSelectedAgent.mockResolvedValueOnce(fallback.name);
    api.listAgentsWithMeta.mockResolvedValueOnce({
      agents: [fallback],
      defaultAgent: fallback.name,
      selectedAgent: fallback.name,
    });

    await useAgentStore.getState().deleteAgent(agent.id);

    expect(api.deleteAgent).toHaveBeenCalledWith(agent.id);
    expect(useAgentStore.getState()).toMatchObject({
      selectedAgent: fallback.name,
      defaultAgent: fallback.name,
    });
    expect(useAgentStore.getState().agents).toEqual([
      expect.objectContaining({ id: fallback.id, isDefault: true }),
    ]);
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

  it('classifies only the exact Station active mutation conflict code', () => {
    expect(isActiveMutationConflict({
      details: { error_code: 'ADMISSION_ACTIVE_MUTATION_CONFLICT' },
    })).toBe(true);
    expect(isActiveMutationConflict({
      details: { error_code: 'ADMISSION_ACTIVE_MUTATION_CONFLICT_RETRY' },
    })).toBe(false);
    expect(isActiveMutationConflict(new Error('409 version conflict'))).toBe(false);
  });

  it('retains conflict until authoritative Agent reload succeeds', async () => {
    const conflict = Object.assign(new Error('agent.errors.activeMutationConflict'), {
      details: {
        error_code: 'ADMISSION_ACTIVE_MUTATION_CONFLICT',
        locale_key: 'agent.errors.activeMutationConflict',
        retryable: 'true',
        terminal: 'true',
        resource_id: agent.id,
        expected_revision: '7',
        actual_revision: '8',
      },
    });
    api.updateAgent.mockRejectedValueOnce(conflict);

    await expect(
      useAgentStore.getState().updateAgentProfile(agent.id, {
        title: 'Stale title',
      }),
    ).rejects.toBe(conflict);
    expect(useAgentStore.getState().saveStateByAgentId[agent.id]).toBe('conflict');

    const reloadPromise = useAgentStore.getState().reloadAgentProfile(agent.id);
    expect(useAgentStore.getState().saveStateByAgentId[agent.id]).toBe('conflict');

    await expect(reloadPromise).resolves.toMatchObject({
      title: 'Authoritative title',
      version: 8,
    });
    expect(api.getAgent).toHaveBeenCalledWith(agent.id);
    expect(useAgentStore.getState()).toMatchObject({
      selectedModel: 'model-3',
      selectedProviderId: 'provider-2',
      error: null,
    });
    expect(useAgentStore.getState().agents[0]).toMatchObject({
      title: 'Authoritative title',
      version: 8,
    });
    expect(useAgentStore.getState().saveStateByAgentId[agent.id]).toBe('idle');
  });

  it('keeps conflict visible when authoritative Agent reload fails', async () => {
    useAgentStore.setState({
      saveStateByAgentId: { [agent.id]: 'conflict' },
    });
    api.getAgent.mockRejectedValueOnce(new Error('agent.profile.reloadFailed'));

    await expect(
      useAgentStore.getState().reloadAgentProfile(agent.id),
    ).rejects.toThrow('agent.profile.reloadFailed');

    expect(useAgentStore.getState().saveStateByAgentId[agent.id]).toBe('conflict');
  });
});
