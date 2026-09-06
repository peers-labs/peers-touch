import {
  api,
  type Agent,
  type AgentPackage,
  type AgentPackageExportResult,
  type AgentPackageImportResult,
  type AgentChatConfig,
  parseAgentChatConfig,
  type GrowthSnapshot,
  type MemoryItem,
  type SkillItem,
  type SchedulerStatusResponse,
  type AgentExecuteTurnInput,
  type AgentTurnStreamError,
  type AgentTurnStreamController,
  type StreamEvent,
  streamAgentTurn,
} from './desktop_api';

export type { Agent, AgentPackage, AgentChatConfig, GrowthSnapshot, AgentExecuteTurnInput };

export class AgentService {
  async list(): Promise<Agent[]> {
    return api.listAgents();
  }

  async get(id: string): Promise<Agent> {
    return api.getAgent(id);
  }

  async create(data: { name: string; title?: string; description?: string; model?: string; system_prompt?: string }): Promise<Agent> {
    return api.createAgent(data);
  }

  async update(id: string, data: Record<string, string>): Promise<Agent> {
    return api.updateAgent(id, data);
  }

  async delete(id: string): Promise<{ ok: boolean }> {
    return api.deleteAgent(id);
  }

  async duplicate(id: string, name: string): Promise<Agent> {
    return api.duplicateAgent(id, name);
  }

  async exportPackage(id: string, options?: { includeLocalPaths?: boolean }): Promise<AgentPackageExportResult> {
    return api.exportAgentPackage(id, options);
  }

  async importPackage(pkg: AgentPackage | Record<string, unknown>, name?: string): Promise<AgentPackageImportResult> {
    return api.importAgentPackage(pkg, name);
  }

  async search(query: string): Promise<Agent[]> {
    return api.searchAgents(query);
  }

  parseConfig(agent: Agent): { chatConfig: AgentChatConfig } {
    return { chatConfig: parseAgentChatConfig(agent) };
  }

  async getGrowthSnapshot(agentId: string): Promise<GrowthSnapshot> {
    const { getAgentGrowthSnapshot } = await import('./desktop_api');
    return getAgentGrowthSnapshot(agentId);
  }

  async getMemories(agentId: string): Promise<MemoryItem[]> {
    const { getAgentMemories } = await import('./desktop_api');
    return getAgentMemories(agentId);
  }

  async getSkills(agentId: string): Promise<SkillItem[]> {
    const { getAgentSkills } = await import('./desktop_api');
    return getAgentSkills(agentId);
  }

  async submitFeedback(
    agentId: string,
    turnId: string,
    conversationId: string,
    signal: 'positive' | 'negative',
    comment?: string,
  ): Promise<void> {
    const { submitAgentFeedback } = await import('./desktop_api');
    await submitAgentFeedback(agentId, turnId, conversationId, signal, comment);
  }

  async startScheduler(agentId: string): Promise<void> {
    const { startAgentScheduler } = await import('./desktop_api');
    return startAgentScheduler(agentId);
  }

  async stopScheduler(): Promise<void> {
    const { stopAgentScheduler } = await import('./desktop_api');
    return stopAgentScheduler();
  }

  async getSchedulerStatus(): Promise<SchedulerStatusResponse> {
    const { getAgentSchedulerStatus } = await import('./desktop_api');
    return getAgentSchedulerStatus();
  }

  streamTurn(
    input: AgentExecuteTurnInput,
    onEvent: (event: StreamEvent) => void,
    onDone: () => void,
    onError: (err: AgentTurnStreamError) => void,
    sourcePtid: string,
  ): AgentTurnStreamController {
    return streamAgentTurn(input, onEvent, onDone, onError, sourcePtid);
  }
}

export const agentService = new AgentService();
