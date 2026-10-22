import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../services/desktop_api';

const api = vi.hoisted(() => ({
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  getAgent: vi.fn(),
  getSelectedAgent: vi.fn(),
  listAvailableModels: vi.fn(),
  listModelConfig: vi.fn(),
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

import {
  isActiveMutationConflict,
  resolveAvailableModelSelection,
  useAgentStore,
} from './agent';

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
      error: null,
      saveStateByAgentId: {},
      profileDraftsByAgentId: {},
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
    api.listAvailableModels.mockResolvedValue({ models: [], default: '' });
    api.listModelConfig.mockResolvedValue({});
    api.listAgentsWithMeta.mockResolvedValue({
      agents: [agent],
      defaultAgent: agent.name,
      selectedAgent: agent.name,
    });
    api.setSelectedAgent.mockResolvedValue(undefined);
  });

  it('falls back when the selected model is no longer available', () => {
    expect(resolveAvailableModelSelection([
      {
        id: 'model-2',
        display_name: 'Model 2',
        provider_id: 'provider-2',
        provider_name: 'Provider 2',
        type: 'chat',
        context_window: 128000,
        enabled: true,
      },
    ], 'model-1', 'provider-1', 'model-2')).toEqual({
      modelId: 'model-2',
      providerId: 'provider-2',
    });
  });

  it('rolls back only the rejected Profile and preserves another Agent update', async () => {
    const other = { ...agent, id: 'agent-2', name: 'other' };
    useAgentStore.setState({ agents: [agent, other] });
    let reject!: (reason: Error) => void;
    api.updateAgent.mockReturnValueOnce(new Promise((_accept, fail) => { reject = fail; }));
    const save = useAgentStore.getState().updateAgentProfile(agent.id, { soulMd: 'pending' });
    const changedOther = { ...other, title: 'Concurrent accepted title' };
    useAgentStore.setState((state) => ({
      agents: state.agents.map((item) => item.id === other.id ? changedOther : item),
    }));
    await expect(useAgentStore.getState().updateAgentProfile(agent.id, { agentsMd: 'racing' }))
      .rejects.toThrow('already being saved');
    reject(new Error('version conflict'));
    await expect(save).rejects.toThrow('version conflict');
    expect(useAgentStore.getState().agents).toEqual([agent, changedOther]);
  });

  it('retains failed document edits and only clears the successfully saved version', async () => {
    useAgentStore.getState().setProfileDraft(agent.id, { soulMd: 'first', agentsMd: 'instructions' });
    api.updateAgent.mockRejectedValueOnce(new Error('offline'));
    await expect(useAgentStore.getState().updateAgentProfile(agent.id, { soulMd: 'first' }))
      .rejects.toThrow('offline');
    expect(useAgentStore.getState().profileDraftsByAgentId[agent.id])
      .toEqual({ soulMd: 'first', agentsMd: 'instructions' });

    let accept!: (value: Agent) => void;
    api.updateAgent.mockReturnValueOnce(new Promise((resolve) => { accept = resolve; }));
    const save = useAgentStore.getState().updateAgentProfile(agent.id, { soulMd: 'first' });
    useAgentStore.getState().setProfileDraft(agent.id, { soulMd: 'newer' });
    accept({ ...agent, soulMd: 'first', version: 8 });
    await save;
    expect(useAgentStore.getState().profileDraftsByAgentId[agent.id])
      .toEqual({ soulMd: 'newer', agentsMd: 'instructions' });
    expect(useAgentStore.getState().saveStateByAgentId[agent.id]).toBe('dirty');

    await useAgentStore.getState().updateAgentProfile(agent.id, { soulMd: 'newer' });
    expect(useAgentStore.getState().profileDraftsByAgentId[agent.id])
      .toEqual({ agentsMd: 'instructions' });
  });

  it('keeps provider identity when model ids collide', () => {
    const models = [
      {
        id: 'default',
        display_name: 'Codex Default',
        provider_id: 'codex-cli',
        provider_name: 'Codex CLI',
        type: 'chat',
        context_window: 128000,
        enabled: true,
      },
      {
        id: 'default',
        display_name: 'TRAE Default',
        provider_id: 'trae-cli',
        provider_name: 'TRAE CLI',
        type: 'chat',
        context_window: 128000,
        enabled: true,
      },
    ];

    expect(resolveAvailableModelSelection(
      models,
      'default',
      'trae-cli',
      'default',
      'codex-cli',
    )).toEqual({
      modelId: 'default',
      providerId: 'trae-cli',
    });
    expect(resolveAvailableModelSelection(
      models,
      'default',
      '',
      'default',
      'codex-cli',
    )).toEqual({
      modelId: 'default',
      providerId: 'codex-cli',
    });
  });

  it('removes disabled models from the composer projection', async () => {
    api.listAvailableModels.mockResolvedValueOnce({
      default: 'model-disabled',
      models: [
        {
          id: 'model-disabled',
          display_name: 'Disabled',
          provider_id: 'provider-1',
          provider_name: 'Provider 1',
          type: 'chat',
          context_window: 128000,
          enabled: false,
        },
        {
          id: 'model-ready',
          display_name: 'Ready',
          provider_id: 'provider-2',
          provider_name: 'Provider 2',
          type: 'chat',
          context_window: 128000,
          enabled: true,
        },
      ],
    });

    await useAgentStore.getState().loadModels();

    expect(useAgentStore.getState()).toMatchObject({
      availableModels: [expect.objectContaining({ id: 'model-ready' })],
      defaultModel: 'model-ready',
      defaultProviderId: 'provider-2',
    });
  });

  it('loads the Settings-owned default model when it is available', async () => {
    api.listAvailableModels.mockResolvedValueOnce({
      default: 'model-1',
      models: [
        {
          id: 'model-1',
          display_name: 'Model 1',
          provider_id: 'provider-1',
          provider_name: 'Provider 1',
          type: 'chat',
          context_window: 128000,
          enabled: true,
        },
        {
          id: 'model-2',
          display_name: 'Model 2',
          provider_id: 'provider-2',
          provider_name: 'Provider 2',
          type: 'chat',
          context_window: 128000,
          enabled: true,
        },
      ],
    });
    api.listModelConfig.mockResolvedValueOnce({
      default: { provider: 'provider-2', model: 'model-2' },
    });

    await useAgentStore.getState().loadModels();

    expect(useAgentStore.getState().defaultModel).toBe('model-2');
    expect(useAgentStore.getState().defaultProviderId).toBe('provider-2');
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
