import { toast } from '@lobehub/ui';
import { useAgentStore } from '../../../store/agent';
import i18n from '../../../i18n';

export type OpenCreatedAgentProfile = (agentName: string) => void;

let creating = false;

/** Every creation entry performs the same mutation and immediately enters Profile. */
export function openAgentCreateFlow(openProfile: OpenCreatedAgentProfile): void {
  if (creating) return;
  creating = true;
  const state = useAgentStore.getState();
  const existing = new Set(state.agents.map((agent) => agent.name));
  let name = 'new-agent';
  for (let suffix = 2; existing.has(name); suffix += 1) {
    name = `new-agent-${suffix}`;
  }
  void state.createAgent({
    name,
    title: i18n.t('agent.chat.newAgentTitle', { ns: 'agent' }),
    description: '',
    avatar: '🤖',
    visibility: 'private',
    workspaceMode: 'agent',
  }).then((agent) => {
    openProfile(agent.name);
  }).catch((error: unknown) => {
    toast.error(error instanceof Error ? error.message : String(error));
  }).finally(() => {
    creating = false;
  });
}
