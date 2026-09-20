import { create } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CapabilityOperationSchema,
  CapabilityOperationStatus,
} from '../gen/proto/domain/agent/capability_pb';

const mcpApi = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  toggle: vi.fn(),
  startLifecycle: vi.fn(),
  getOperation: vi.fn(),
  cancelOperation: vi.fn(),
  takeOverOperation: vi.fn(),
  takeOverCleanup: vi.fn(),
}));

vi.mock('../services/mcp-service', () => ({
  mcpService: mcpApi,
}));

import {
  isMcpOperationRetryable,
  useMCPStore,
} from './mcp';

function operation(
  status: CapabilityOperationStatus,
  operationKind = 'test',
) {
  return create(CapabilityOperationSchema, {
    operationId: 'operation-1',
    operationKind,
    status,
    revision: 3n,
  });
}

describe('MCP lifecycle store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useMCPStore.getState().reset();
    mcpApi.list.mockResolvedValue([]);
  });

  afterEach(() => {
    useMCPStore.getState().reset();
    vi.useRealTimers();
  });

  it('starts install through Station after staging local configuration', async () => {
    const dispatched = operation(CapabilityOperationStatus.DISPATCHED, 'install');
    mcpApi.create.mockResolvedValue(dispatched);

    await useMCPStore.getState().createServer({
      name: 'fixture',
      type: 'stdio',
      command: 'python3',
    });

    expect(mcpApi.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'fixture',
    }));
    expect(mcpApi.startLifecycle).not.toHaveBeenCalled();
    expect(useMCPStore.getState().operationsByServer.fixture).toBe(dispatched);
  });

  it('restores and polls an active Station operation from the persisted reference', async () => {
    const dispatched = operation(CapabilityOperationStatus.DISPATCHED);
    const succeeded = operation(CapabilityOperationStatus.SUCCEEDED);
    mcpApi.list
      .mockResolvedValueOnce([{
        name: 'fixture',
        title: 'Fixture',
        description: '',
        type: 'stdio',
        source: 'user',
        enabled: true,
        metaAvatar: '',
        metaTags: [],
        toolCount: 0,
        status: 'pending',
        operationId: 'operation-1',
        operationKind: 'test',
      }])
      .mockResolvedValue([]);
    mcpApi.getOperation
      .mockResolvedValueOnce(dispatched)
      .mockResolvedValueOnce(succeeded);

    await useMCPStore.getState().loadServers();
    expect(useMCPStore.getState().operationsByServer.fixture).toBe(dispatched);

    await vi.advanceTimersByTimeAsync(500);
    expect(useMCPStore.getState().operationsByServer.fixture).toBe(succeeded);
    expect(mcpApi.list).toHaveBeenCalledTimes(2);
  });

  it('uses fenced takeover for a disconnected operation', async () => {
    const disconnected = operation(CapabilityOperationStatus.DISCONNECTED);
    const dispatched = operation(CapabilityOperationStatus.DISPATCHED, 'reconnect');
    useMCPStore.setState({
      servers: [{
        name: 'fixture',
        title: 'Fixture',
        description: '',
        type: 'stdio',
        source: 'user',
        enabled: true,
        metaAvatar: '',
        metaTags: [],
        toolCount: 0,
        status: 'disconnected',
      }],
      operationsByServer: { fixture: disconnected },
    });
    mcpApi.takeOverOperation.mockResolvedValue(dispatched);

    await useMCPStore.getState().reconnectServer('fixture');

    expect(mcpApi.takeOverOperation).toHaveBeenCalledWith(disconnected);
    expect(mcpApi.startLifecycle).not.toHaveBeenCalled();
    expect(useMCPStore.getState().operationsByServer.fixture).toBe(dispatched);
  });

  it('never marks unknown side effects as automatically retryable', () => {
    expect(isMcpOperationRetryable(
      operation(CapabilityOperationStatus.UNKNOWN_SIDE_EFFECT),
    )).toBe(false);
  });
});
