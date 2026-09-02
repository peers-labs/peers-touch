import { ChatPage } from '../../../pages/ChatPage';
import { AgentProfilePage } from '../../../pages/AgentProfilePage';
import { PortalPanel } from '../../portal';
import { useActiveAgentSlice } from '../useActiveAgentStores';

interface ConversationRailProps {
  narrow: boolean;
  onOpenProfile: (agentName: string) => void;
  onOpenChat: (agentName: string) => void;
  onOpenOrchestration?: () => void;
}

export function ConversationRail({
  narrow,
  onOpenProfile,
  onOpenChat,
  onOpenOrchestration,
}: ConversationRailProps) {
  const { selectedAgent, currentSurface } = useActiveAgentSlice((state) => ({
    selectedAgent: state.selectedAgent,
    currentSurface: state.agentSurfaces[state.selectedAgent] || 'chat',
  }));

  return (
    <main
      data-pt-conversation-rail
      data-pt-agent-surface={currentSurface}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        position: 'relative',
        display: 'flex',
        background: '#fff',
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {currentSurface === 'profile' ? (
          <AgentProfilePage
            agentName={selectedAgent}
            onBack={() => onOpenChat(selectedAgent)}
            onOpenOrchestration={onOpenOrchestration}
            embedded
          />
        ) : (
          <ChatPage onOpenProfile={() => onOpenProfile(selectedAgent)} narrow={narrow} />
        )}
      </div>
      {!narrow && currentSurface === 'chat' ? (
        <aside data-pt-agent-inspector style={{ display: 'contents' }}>
          <PortalPanel />
        </aside>
      ) : null}
    </main>
  );
}
