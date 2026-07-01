import { registerPage } from '../kernel/page';
import { AgentChatPageContainer } from './AgentChatPageContainer';

export function registerAgentChatPage(): void {
  registerPage({
    id: 'agent',
    title: 'Agent',
    factory: () => <AgentChatPageContainer />,
    preload: 'idle',
    keepAlive: 'forever',
    runtimes: ['agentCapability', 'agentTopic', 'social'],
  });
}
