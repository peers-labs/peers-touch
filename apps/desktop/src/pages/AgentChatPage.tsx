import { AgentWorkbench } from '../components/agent/workbench/AgentWorkbench';

interface AgentChatPageProps {
  onNavigateAgentCanvas?: () => void;
}

export function AgentChatPage({ onNavigateAgentCanvas }: AgentChatPageProps) {
  return <AgentWorkbench onOpenOrchestration={onNavigateAgentCanvas} />;
}
