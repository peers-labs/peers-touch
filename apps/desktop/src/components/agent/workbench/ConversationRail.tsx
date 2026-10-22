import { useEffect, useState } from 'react';
import { ChatPage } from '../../../pages/ChatPage';
import { AgentProfilePage } from '../../../pages/AgentProfilePage';
import { useActiveAgentSlice } from '../useActiveAgentStores';
import { PortalPanel } from '../../portal';

interface ConversationRailProps {
  narrow: boolean;
  onOpenChat: (agentName: string) => void;
  onOpenOrchestration?: () => void;
}

export function ConversationRail({
  narrow,
  onOpenChat,
  onOpenOrchestration,
}: ConversationRailProps) {
  const { selectedAgent, currentSurface } = useActiveAgentSlice((state) => ({
    selectedAgent: state.selectedAgent,
    currentSurface: state.agentSurfaces[state.selectedAgent] || 'chat',
  }));
  const [profileMounted, setProfileMounted] = useState(
    currentSurface === 'profile',
  );

  useEffect(() => {
    if (currentSurface === 'profile') setProfileMounted(true);
  }, [currentSurface]);

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
        <div
          data-pt-agent-chat-frame
          aria-hidden={currentSurface !== 'chat'}
          style={{
            display: currentSurface === 'chat' ? 'flex' : 'none',
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            flexDirection: 'column',
          }}
        >
          <ChatPage narrow={narrow} />
        </div>
        {(profileMounted || currentSurface === 'profile') && (
          <div
            data-pt-agent-profile-frame
            aria-hidden={currentSurface !== 'profile'}
            style={{
              display: currentSurface === 'profile' ? 'flex' : 'none',
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              flexDirection: 'column',
            }}
          >
            <AgentProfilePage
              agentName={selectedAgent}
              onBack={() => onOpenChat(selectedAgent)}
              onOpenOrchestration={onOpenOrchestration}
              embedded
            />
          </div>
        )}
      </div>
      {currentSurface === 'chat' && <PortalPanel artifactsOnly overlay={narrow} />}
    </main>
  );
}
