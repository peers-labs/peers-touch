import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  createMCPServer: vi.fn(),
  refreshMCPServer: vi.fn(),
}));

vi.mock('./desktop_api', () => ({
  api: apiMock,
}));

import { mcpService } from './mcp-service';

describe('MCP Station projection service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates through the Station-owned server command', async () => {
    apiMock.createMCPServer.mockResolvedValue({ name: 'fixture' });

    await mcpService.create({
      name: 'fixture',
      type: 'stdio',
      executionOwner: 'station',
    });

    expect(apiMock.createMCPServer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'fixture',
        executionOwner: 'station',
      }),
    );
  });

  it('refreshes tools through the execution owner selected by Station', async () => {
    apiMock.refreshMCPServer.mockResolvedValue({ name: 'fixture' });

    await mcpService.refresh('fixture');

    expect(apiMock.refreshMCPServer).toHaveBeenCalledWith('fixture');
  });
});
