import type { MessageInitShape } from '@bufbuild/protobuf';
import type { MobileAuthSession } from '../../features/auth/authSession';
import * as capability from '../../gen/proto/domain/agent/capability_pb';
import { createAgentSettingsRpc } from './agentSettingsRpc';

export function createMcpSettingsGateway(session: MobileAuthSession) {
  const rpc = createAgentSettingsRpc(session);
  return {
    list: (signal?: AbortSignal) => rpc(
      'mcp_list', capability.ListMcpServersRequestSchema, capability.ListMcpServersResponseSchema,
      { includeDisabled: true }, signal,
    ),
    get: (serverId: string, signal?: AbortSignal) => rpc(
      'mcp_get', capability.GetMcpServerRequestSchema, capability.GetMcpServerResponseSchema, { serverId }, signal,
    ),
    upsert: (input: MessageInitShape<typeof capability.UpsertMcpServerRequestSchema>, signal?: AbortSignal) => rpc(
      'mcp_upsert', capability.UpsertMcpServerRequestSchema, capability.UpsertMcpServerResponseSchema, input, signal,
    ),
    refresh: (input: MessageInitShape<typeof capability.RefreshMcpServerRequestSchema>, signal?: AbortSignal) => rpc(
      'mcp_refresh', capability.RefreshMcpServerRequestSchema, capability.RefreshMcpServerResponseSchema, input, signal,
    ),
    delete: (input: MessageInitShape<typeof capability.DeleteMcpServerRequestSchema>, signal?: AbortSignal) => rpc(
      'mcp_delete', capability.DeleteMcpServerRequestSchema, capability.DeleteMcpServerResponseSchema, input, signal,
    ),
  };
}
