import {
  type Agent,
  type AgentExecuteTurnKnowledgeResource,
  type ChatAttachmentInput,
  parseAgentChatConfig,
  parseAgentKnowledgeResources,
} from '../services/desktop_api';
import { buildAgentRuntimeConfig } from '../services/agent-runtime-config';
import {
  extractMessageArtifacts,
  type ChatMessage,
  type DelegationTaskInfo,
  type KnowledgeChunkInfo,
  type MessageArtifact,
  type ToolCallInfo,
} from '../store/chat';
import { redactMaybeJsonText } from '../security/redaction';

export interface AgentTurnDiagnosticsExport {
  version: '2026-06-17.agent-turn-diagnostics.v1';
  exportedAt: string;
  sessionKey: string;
  replay: {
    agentId: string;
    agentName: string;
    provider?: string;
    model?: string;
    platform: 'desktop';
    workspaceRoot?: string;
    contextWindowSize?: number;
    maxRetries?: number;
    knowledgeResources?: AgentExecuteTurnKnowledgeResource[];
    userInput: string;
    attachments: ChatAttachmentInput[];
  };
  agent: {
    id: string;
    name: string;
    provider?: string;
    model?: string;
    tools: string[];
    skills: string[];
    mcpServers: string[];
    knowledgeResourceCount: number;
  };
  messages: Array<{
    id: string;
    role: ChatMessage['role'];
    content: string;
    model?: string;
    timestamp: number;
    toolCalls?: ToolCallInfo[];
    knowledgeChunks?: KnowledgeChunkInfo[];
    error?: string;
  }>;
  latestAssistant?: {
    id: string;
    toolCalls: ToolCallInfo[];
    knowledgeChunks: KnowledgeChunkInfo[];
    delegationResults: DelegationTaskInfo[];
    artifacts: MessageArtifact[];
    processDuration?: number;
    error?: string;
  };
  reproducibility: {
    hiddenLocalState: string[];
    replayNotes: string[];
  };
}

function redactToolCall(tool: ToolCallInfo): ToolCallInfo {
  return {
    ...tool,
    args: redactMaybeJsonText(typeof tool.args === 'string' ? tool.args : undefined) ?? tool.args,
    result: redactMaybeJsonText(typeof tool.result === 'string' ? tool.result : undefined) ?? tool.result,
  };
}

export function buildAgentTurnDiagnosticsExport(input: {
  sessionKey: string;
  messages: ChatMessage[];
  agent?: Agent;
  selectedModel?: string;
}): AgentTurnDiagnosticsExport {
  const agent = input.agent;
  const agentName = agent?.name || '';
  const config = buildAgentRuntimeConfig(agent);
  const chatConfig = agent ? parseAgentChatConfig(agent) : {};
  const latestUser = [...input.messages].reverse().find((message) => message.role === 'user');
  const latestAssistant = [...input.messages].reverse().find((message) => message.role === 'assistant');
  const replayAttachments = latestUser?.attachments
    ?.map((item) => item.attachment)
    .filter((item): item is ChatAttachmentInput => Boolean(item)) ?? [];

  return {
    version: '2026-06-17.agent-turn-diagnostics.v1',
    exportedAt: new Date().toISOString(),
    sessionKey: input.sessionKey,
    replay: {
      agentId: agent?.id || '',
      agentName,
      provider: agent?.provider || undefined,
      model: input.selectedModel || agent?.model || undefined,
      platform: 'desktop',
      workspaceRoot: config.workspaceRoot,
      contextWindowSize: config.contextWindowSize,
      maxRetries: config.maxRetries,
      knowledgeResources: config.knowledgeResources,
      userInput: latestUser?.content || '',
      attachments: replayAttachments,
    },
    agent: {
      id: agent?.id || '',
      name: agentName,
      provider: agent?.provider || undefined,
      model: input.selectedModel || agent?.model || undefined,
      tools: chatConfig.tools || [],
      skills: chatConfig.skills || [],
      mcpServers: chatConfig.mcpServers || [],
      knowledgeResourceCount: agent ? parseAgentKnowledgeResources(agent).length : 0,
    },
    messages: input.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      model: message.model,
      timestamp: message.timestamp,
      toolCalls: message.toolCalls?.map(redactToolCall),
      knowledgeChunks: message.knowledgeChunks,
      error: message.error,
    })),
    latestAssistant: latestAssistant
      ? {
        id: latestAssistant.id,
        toolCalls: latestAssistant.toolCalls?.map(redactToolCall) || [],
        knowledgeChunks: latestAssistant.knowledgeChunks || [],
        delegationResults: latestAssistant.delegationResults || [],
        artifacts: extractMessageArtifacts(latestAssistant),
        processDuration: latestAssistant.processDuration,
        error: latestAssistant.error,
      }
      : undefined,
    reproducibility: {
      hiddenLocalState: [
        'Desktop-local OAuth tokens, MCP credentials, plugin headers, clipboard contents, and local file contents are intentionally excluded.',
      ],
      replayNotes: [
        'Replay through AgentExecuteTurnInput using replay.* fields, then re-approve local tools when prompted.',
      ],
    },
  };
}
