import type { MessageInitShape } from '@bufbuild/protobuf';
import type { MobileAuthSession } from '../../features/auth/authSession';
import * as agent from '../../gen/proto/domain/agent/agent_pb';
import * as memory from '../../gen/proto/domain/agent/memory_pb';
import * as skill from '../../gen/proto/domain/agent/skill_pb';
import { createAgentSettingsRpc } from './agentSettingsRpc';

export function createAgentKnowledgeGateway(session: MobileAuthSession) {
  const rpc = createAgentSettingsRpc(session);
  return {
    listAgents: (page: number, signal?: AbortSignal) => rpc(
      'agent_list', agent.ListAgentsRequestSchema, agent.ListAgentsResponseSchema,
      { visibility: agent.AgentVisibility.PRIVATE, page, pageSize: 40 }, signal,
    ),
    getAgent: (agentId: string, signal?: AbortSignal) => rpc(
      'agent_get', agent.GetAgentRequestSchema, agent.GetAgentResponseSchema, { agentId }, signal,
    ),
    updateAgent: (input: MessageInitShape<typeof agent.UpdateAgentRequestSchema>, signal?: AbortSignal) => rpc(
      'agent_update', agent.UpdateAgentRequestSchema, agent.UpdateAgentResponseSchema, input, signal,
    ),
    listSkills: (agentId: string, signal?: AbortSignal) => rpc(
      'skill_list', skill.ListSkillsRequestSchema, skill.ListSkillsResponseSchema, { agentId }, signal,
    ),
    getSkill: (agentId: string, skillId: string, signal?: AbortSignal) => rpc(
      'skill_get', skill.GetSkillRequestSchema, skill.GetSkillResponseSchema, { agentId, skillId }, signal,
    ),
    installSkill: (input: MessageInitShape<typeof skill.InstallSkillRequestSchema>, signal?: AbortSignal) => rpc(
      'skill_install', skill.InstallSkillRequestSchema, skill.InstallSkillResponseSchema, input, signal,
    ),
    updateSkill: (input: MessageInitShape<typeof skill.UpdateSkillRequestSchema>, signal?: AbortSignal) => rpc(
      'skill_update', skill.UpdateSkillRequestSchema, skill.UpdateSkillResponseSchema, input, signal,
    ),
    deleteSkill: (agentId: string, skillId: string, signal?: AbortSignal) => rpc(
      'skill_delete', skill.DeleteSkillRequestSchema, skill.DeleteSkillResponseSchema, { agentId, skillId }, signal,
    ),
    listMemories: (agentId: string, page: number, signal?: AbortSignal) => rpc(
      'memory_list', memory.ListMemoriesRequestSchema, memory.ListMemoriesResponseSchema,
      { agentId, page, pageSize: 40, orderBy: 'updated_at' }, signal,
    ),
    getMemory: (id: string, signal?: AbortSignal) => rpc(
      'memory_get', memory.GetMemoryRequestSchema, memory.GetMemoryResponseSchema, { id }, signal,
    ),
    updateMemory: (agentId: string, id: string, content: string, signal?: AbortSignal) => rpc(
      'memory_update', memory.WriteMemoryRequestSchema, memory.WriteMemoryResponseSchema,
      { agentId, oldContent: id, content }, signal,
    ),
    deleteMemory: (agentId: string, id: string, signal?: AbortSignal) => rpc(
      'memory_delete', memory.DeleteMemoryRequestSchema, memory.DeleteMemoryResponseSchema, { agentId, id }, signal,
    ),
    importMemories: (input: MessageInitShape<typeof memory.ImportMemoriesRequestSchema>, signal?: AbortSignal) => rpc(
      'memory_import', memory.ImportMemoriesRequestSchema, memory.ImportMemoriesResponseSchema, input, signal,
    ),
    searchMemories: (input: MessageInitShape<typeof memory.SearchMemoriesRequestSchema>, signal?: AbortSignal) => rpc(
      'memory_search', memory.SearchMemoriesRequestSchema, memory.SearchMemoriesResponseSchema, input, signal,
    ),
    embeddingStatus: (signal?: AbortSignal) => rpc(
      'memory_embedding_status', memory.EmbeddingStatusRequestSchema, memory.EmbeddingStatusResponseSchema, {}, signal,
    ),
  };
}

export type AgentKnowledgeGateway = ReturnType<typeof createAgentKnowledgeGateway>;
