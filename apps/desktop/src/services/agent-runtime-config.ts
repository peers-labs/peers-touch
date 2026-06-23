import {
  type Agent,
  type AgentChatConfig,
  type AgentExecuteTurnKnowledgeResource,
  type AgentKnowledgeResource,
  parseAgentChatConfig,
  parseAgentKnowledgeResources,
} from './desktop_api';

export interface AgentRuntimeConfig {
  workspaceRoot?: string;
  contextWindowSize?: number;
  maxRetries?: number;
  knowledgeResources?: AgentExecuteTurnKnowledgeResource[];
}

export function buildAgentRuntimeConfig(agent?: Agent): AgentRuntimeConfig {
  if (!agent) return {};
  const config: AgentChatConfig = parseAgentChatConfig(agent);
  const workspaceRoot = config.workspace?.root?.trim() || undefined;
  const contextWindowSize = config.contextWindowSize && config.contextWindowSize > 0
    ? config.contextWindowSize
    : undefined;
  const maxRetries = config.providerFallback?.enabled === false
    ? 0
    : config.providerFallback?.maxRetries;
  const knowledgeResources = parseAgentKnowledgeResources(agent)
    .filter((resource) => resource.policy !== 'disabled')
    .map((resource) => toTurnKnowledgeResource(resource, agent.id));

  return {
    workspaceRoot,
    contextWindowSize,
    maxRetries,
    knowledgeResources,
  };
}

function toTurnKnowledgeResource(
  resource: AgentKnowledgeResource,
  agentId: string,
): AgentExecuteTurnKnowledgeResource {
  return {
    resource_id: resource.id,
    agent_id: agentId,
    type: toProtoKnowledgeResourceType(resource.type),
    title: resource.title,
    source: resource.source,
    policy: toProtoKnowledgeResourcePolicy(resource.policy),
    status: toProtoKnowledgeResourceStatus(resource.status),
    last_indexed_at: resource.lastIndexedAt,
  };
}

function toProtoKnowledgeResourceType(type: AgentKnowledgeResource['type']): AgentExecuteTurnKnowledgeResource['type'] {
  switch (type) {
    case 'folder':
      return 2;
    case 'project':
      return 3;
    case 'url':
      return 4;
    case 'notebook':
      return 5;
    case 'workspace':
      return 6;
    default:
      return 1;
  }
}

function toProtoKnowledgeResourcePolicy(policy: AgentKnowledgeResource['policy']): AgentExecuteTurnKnowledgeResource['policy'] {
  switch (policy) {
    case 'auto':
      return 2;
    case 'always':
      return 3;
    case 'disabled':
      return 4;
    default:
      return 1;
  }
}

function toProtoKnowledgeResourceStatus(status: AgentKnowledgeResource['status']): AgentExecuteTurnKnowledgeResource['status'] {
  switch (status) {
    case 'pending_index':
      return 2;
    case 'indexed':
      return 3;
    case 'error':
      return 4;
    default:
      return 1;
  }
}
