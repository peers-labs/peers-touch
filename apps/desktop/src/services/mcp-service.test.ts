import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CapabilityOperationSchema,
  CapabilityOperationStatus,
} from '../gen/proto/domain/agent/capability_pb';

const apiMock = vi.hoisted(() => ({
  takeOverCapabilityOperation: vi.fn(),
}));

vi.mock('./desktop_api', () => ({
  api: apiMock,
}));

import { mcpService } from './mcp-service';

describe('MCP service recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not manufacture external idempotency during takeover', async () => {
    const disconnected = create(CapabilityOperationSchema, {
      operationId: 'operation-1',
      idempotencyKey: 'station-command-idempotency-key',
      operationKind: 'connect',
      status: CapabilityOperationStatus.DISCONNECTED,
      revision: 4n,
      sideEffectStartedAt: {
        seconds: 1n,
        nanos: 0,
      },
    });
    apiMock.takeOverCapabilityOperation.mockResolvedValue(disconnected);

    await mcpService.takeOverOperation(disconnected);

    expect(apiMock.takeOverCapabilityOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'operation-1',
        expectedRevision: 4n,
        cleanupOnly: false,
        externalIdempotencyKey: '',
      }),
    );
  });
});
