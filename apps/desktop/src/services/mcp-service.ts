import { create } from '@bufbuild/protobuf';
import {
  TakeOverCapabilityCleanupRequestSchema,
  TakeOverCapabilityOperationRequestSchema,
  type CapabilityOperation,
} from '../gen/proto/domain/agent/capability_pb';
import {
  api,
  type McpLifecycleOperationKind,
  type MCPServerItem,
  type MCPServerRecord,
} from './desktop_api';

export type { McpLifecycleOperationKind, MCPServerItem, MCPServerRecord };

export interface MCPServerConfig {
  name: string;
  type: MCPServerRecord['type'];
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled?: boolean;
}

export class MCPService {
  async list(): Promise<MCPServerItem[]> {
    return api.listMCPServers();
  }

  async get(name: string): Promise<MCPServerRecord> {
    return api.getMCPServer(name);
  }

  async create(config: Partial<MCPServerRecord>): Promise<CapabilityOperation> {
    return api.createMCPServer(config);
  }

  async update(
    name: string,
    config: Partial<MCPServerRecord>,
  ): Promise<CapabilityOperation> {
    return api.updateMCPServer(name, config);
  }

  async delete(name: string): Promise<CapabilityOperation> {
    return api.deleteMCPServer(name);
  }

  async toggle(name: string, enabled: boolean): Promise<CapabilityOperation> {
    return api.toggleMCPServer(name, enabled);
  }

  async startLifecycle(
    name: string,
    operationKind: McpLifecycleOperationKind,
    idempotencyKey?: string,
  ): Promise<CapabilityOperation> {
    return api.startMCPLifecycleOperation(name, operationKind, idempotencyKey);
  }

  async getOperation(operationId: string): Promise<CapabilityOperation> {
    return api.getCapabilityOperation(operationId);
  }

  async cancelOperation(operation: CapabilityOperation): Promise<CapabilityOperation> {
    return api.cancelCapabilityOperation(
      operation.operationId,
      operation.revision,
      `mcp-cancel-${operation.operationId}-${operation.revision}`,
    );
  }

  async takeOverOperation(operation: CapabilityOperation): Promise<CapabilityOperation> {
    return api.takeOverCapabilityOperation(create(
      TakeOverCapabilityOperationRequestSchema,
      {
        operationId: operation.operationId,
        expectedRevision: operation.revision,
        cleanupOnly: false,
        externalIdempotencyKey: '',
      },
    ));
  }

  async takeOverCleanup(operation: CapabilityOperation): Promise<CapabilityOperation> {
    return api.takeOverCapabilityOperationCleanup(create(
      TakeOverCapabilityCleanupRequestSchema,
      {
        operationId: operation.operationId,
        expectedCleanupEpoch: operation.cleanupEpoch,
      },
    ));
  }
}

export const mcpService = new MCPService();
