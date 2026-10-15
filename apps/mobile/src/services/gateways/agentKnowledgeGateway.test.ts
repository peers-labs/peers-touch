import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthSession } from '../../features/auth/authSession';
import { ToolExecutionOwner, UpdateAgentRequestSchema } from '../../gen/proto/domain/agent/agent_pb';
import * as memory from '../../gen/proto/domain/agent/memory_pb';
import * as skill from '../../gen/proto/domain/agent/skill_pb';
import * as capability from '../../gen/proto/domain/agent/capability_pb';
import { agentSettingsAdmission } from '../stationTransport';
import { createAgentKnowledgeGateway } from './agentKnowledgeGateway';
import { createMcpSettingsGateway } from './mcpSettingsGateway';

const execute = vi.hoisted(() => vi.fn());
vi.mock('../stationTransport', async (importOriginal) => ({
  ...await importOriginal<typeof import('../stationTransport')>(), executeStationOperation: execute,
}));
const session: MobileAuthSession = {
  stationPeerId: 'station-a', stationUrl: 'https://station.example',
  sessionId: 'session-a', deviceId: 'device-a', lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' }, authenticatedAt: 1,
};

describe('Agent knowledge and remote MCP wire boundary', () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue({ status: 200, contentType: 'application/protobuf', bodyBytes: [] });
  });

  it('keeps a skill toggle bound to its Agent and preserves optional false', async () => {
    await createAgentKnowledgeGateway(session).updateSkill({ agentId: 'agent-a', skillId: 'skill-a', enabled: false });
    const operation = execute.mock.calls[0][1];
    const request = fromBinary(skill.UpdateSkillRequestSchema, Uint8Array.from(operation.body_bytes));
    expect(operation.rpc).toBe('skill_update');
    expect(request).toMatchObject({ agentId: 'agent-a', skillId: 'skill-a', enabled: false });
    expect(request.content).toBeUndefined();
    expect(agentSettingsAdmission(operation.rpc)).toBe('write');
  });

  it('carries the stable memory identity and selected Agent on deletion', async () => {
    await createAgentKnowledgeGateway(session).deleteMemory('agent-a', 'memory-a');
    const operation = execute.mock.calls[0][1];
    expect(fromBinary(memory.DeleteMemoryRequestSchema, Uint8Array.from(operation.body_bytes)))
      .toMatchObject({ id: 'memory-a', agentId: 'agent-a' });
    expect(agentSettingsAdmission(operation.rpc)).toBe('write');
  });

  it('preserves the Agent version and unrelated configuration when changing defaults', async () => {
    await createAgentKnowledgeGateway(session).updateAgent({
      agentId: 'agent-a', name: 'assistant', title: 'Assistant', description: 'Keep this',
      configJson: '{"memory":{"enabled":true}}', providerId: 'provider-a',
      modelName: 'model-a', effort: 'high', thinkingMode: 'auto', version: 9007199254740993n,
    });
    const operation = execute.mock.calls[0][1];
    expect(fromBinary(UpdateAgentRequestSchema, Uint8Array.from(operation.body_bytes))).toMatchObject({
      agentId: 'agent-a', configJson: '{"memory":{"enabled":true}}',
      description: 'Keep this', effort: 'high', version: 9007199254740993n,
    });
    expect(agentSettingsAdmission(operation.rpc)).toBe('write');
  });

  it('preserves MCP revision and command identity beyond JavaScript integer precision', async () => {
    await createMcpSettingsGateway(session).upsert({
      server: { serverId: 'server-a', executionOwner: ToolExecutionOwner.STATION },
      expectedRevision: 9007199254740993n, idempotencyKey: 'command-a',
    });
    const operation = execute.mock.calls[0][1];
    const request = fromBinary(capability.UpsertMcpServerRequestSchema, Uint8Array.from(operation.body_bytes));
    expect(request.expectedRevision).toBe(9007199254740993n);
    expect(request.idempotencyKey).toBe('command-a');
    expect(request.server?.executionOwner).toBe(ToolExecutionOwner.STATION);
    expect(agentSettingsAdmission(operation.rpc)).toBe('write');
  });

  it('decodes the server failure state rather than implying a successful connection', async () => {
    execute.mockResolvedValue({
      status: 200, contentType: 'application/protobuf',
      bodyBytes: Array.from(toBinary(capability.RefreshMcpServerResponseSchema, create(
        capability.RefreshMcpServerResponseSchema, {
          server: { serverId: 'server-a', status: capability.McpServerStatus.FAILED, lastError: 'connection failed' },
        },
      ))),
    });
    const result = await createMcpSettingsGateway(session).refresh({
      serverId: 'server-a', expectedRevision: 1n, idempotencyKey: 'refresh-a',
    });
    expect(result.server?.status).toBe(capability.McpServerStatus.FAILED);
    expect(agentSettingsAdmission('mcp_refresh')).toBe('write');
  });

  it('passes read cancellation and does not expand the renderer path capability', async () => {
    const signal = new AbortController().signal;
    await createAgentKnowledgeGateway(session).getSkill('agent-a', 'skill-a', signal);
    expect(execute.mock.calls[0][1].rpc).toBe('skill_get');
    expect(execute.mock.calls[0][1]).not.toHaveProperty('url');
    expect(execute.mock.calls[0][2]).toBe(signal);
    expect(agentSettingsAdmission('skill_get')).toBe('read');
    expect(agentSettingsAdmission('mcp_list')).toBe('read');
  });
});
