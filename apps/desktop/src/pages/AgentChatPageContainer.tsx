import { usePageContext } from '../kernel/usePageContext';
import { AgentChatPage } from './AgentChatPage';

export function AgentChatPageContainer() {
  const { navigation } = usePageContext();
  return (
    <AgentChatPage
      onNavigateAgentProfile={(agentName) => {
        navigation.navigateToAgentSurface(agentName, 'profile');
      }}
      onNavigateAgentCanvas={() => navigation.navigateTo('agent-orchestration')}
    />
  );
}
