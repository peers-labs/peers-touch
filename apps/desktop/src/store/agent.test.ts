import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../services/desktop_api';

const api = vi.hoisted(() => ({
  getAgent: vi.fn(),
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
