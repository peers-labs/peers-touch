import { usePageContext } from '../kernel/usePageContext';
import { AgentChatPage } from './AgentChatPage';

export function AgentChatPageContainer() {
  const { navigation } = usePageContext();
  return (
    <AgentChatPage
      onNavigateAgentCanvas={() => navigation.navigateTo('agent-orchestration')}
      onNavigateMarketplace={() => navigation.navigateTo('marketplace')}
    />
  );
}
