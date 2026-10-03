import { beforeEach, describe, expect, it, vi } from 'vitest';

const mcpApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  toggle: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('../services/mcp-service', () => ({
  mcpService: mcpApi,
}));

import { useMCPStore } from './mcp';

describe('MCP Station projection store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMCPStore.getState().reset();
    mcpApi.list.mockResolvedValue([]);
  });

  it('creates a Station-owned stdio server and reloads canonical state', async () => {
    mcpApi.create.mockResolvedValue({ name: 'fixture' });

    await useMCPStore.getState().createServer({
      name: 'fixture',
      type: 'stdio',
      executionOwner: 'station',
      command: 'python3',
    });

    expect(mcpApi.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'fixture',
      executionOwner: 'station',
    }));
    expect(mcpApi.list).toHaveBeenCalledOnce();
  });

  it('refreshes either runtime through the same Station server revision command', async () => {
    mcpApi.refresh.mockResolvedValue({ name: 'fixture' });

    await useMCPStore.getState().testServer('fixture');

    expect(mcpApi.refresh).toHaveBeenCalledWith('fixture');
    expect(mcpApi.list).toHaveBeenCalledOnce();
  });
});
