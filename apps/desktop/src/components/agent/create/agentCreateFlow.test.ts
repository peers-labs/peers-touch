import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAgent = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock('@lobehub/ui', () => ({ toast: { error: toastError } }));
vi.mock('../../../store/agent', () => ({
  useAgentStore: {
    getState: () => ({
      agents: [{ name: 'new-agent' }, { name: 'new-agent-2' }],
      createAgent,
    }),
  },
}));
vi.mock('../../../i18n', () => ({ default: { t: () => 'New Agent' } }));

import { openAgentCreateFlow } from './agentCreateFlow';

describe('shared Agent creation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates identity once and enters the authoritative Profile after acceptance', async () => {
    let resolve!: (agent: { name: string }) => void;
    createAgent.mockReturnValueOnce(new Promise((accept) => { resolve = accept; }));
    const openProfile = vi.fn();
    openAgentCreateFlow(openProfile);
    openAgentCreateFlow(openProfile);
    expect(createAgent).toHaveBeenCalledTimes(1);
    expect(createAgent).toHaveBeenCalledWith({
      name: 'new-agent-3', title: 'New Agent', description: '',
      avatar: '🤖', visibility: 'private', workspaceMode: 'agent',
    });
    expect(openProfile).not.toHaveBeenCalled();
    resolve({ name: 'station-owned-name' });
    await vi.waitFor(() => expect(openProfile).toHaveBeenCalledWith('station-owned-name'));
  });

  it('reports rejection and permits a subsequent creation', async () => {
    createAgent.mockRejectedValueOnce(new Error('station unavailable'));
    const openProfile = vi.fn();
    openAgentCreateFlow(openProfile);
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith('station unavailable'));
    expect(openProfile).not.toHaveBeenCalled();
    createAgent.mockResolvedValueOnce({ name: 'recovered-agent' });
    openAgentCreateFlow(openProfile);
    await vi.waitFor(() => expect(openProfile).toHaveBeenCalledWith('recovered-agent'));
  });
});
