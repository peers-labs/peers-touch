import type { Agent } from '../../../services/desktop_api';

export function channelAgentLabel(agents: Agent[], agentId: string): string {
  const agent = agents.find((candidate) => candidate.id === agentId);
  return agent?.title || agent?.name || agentId;
}
