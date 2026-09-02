import { AgentWorkbench } from '../components/agent/workbench/AgentWorkbench';

interface AgentChatPageProps {
  onNavigateAgentCanvas?: () => void;
  onNavigateMarketplace?: () => void;
}

export function AgentChatPage({ onNavigateAgentCanvas, onNavigateMarketplace }: AgentChatPageProps) {
  return <AgentWorkbench onOpenOrchestration={onNavigateAgentCanvas} onNavigateMarketplace={onNavigateMarketplace} />;
}
