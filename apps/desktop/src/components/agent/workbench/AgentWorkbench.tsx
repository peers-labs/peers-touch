import { useCallback, useEffect, useRef, useState } from 'react';
import { theme } from 'antd';
import { useActiveAgentSlice } from '../useActiveAgentStores';
import { AgentRail } from './AgentRail';
import { ConversationRail } from './ConversationRail';
import { deriveAgentWorkbenchLayout } from './layout';
import { TopicRail } from './TopicRail';

interface AgentWorkbenchProps {
  onOpenOrchestration?: () => void;
  onNavigateMarketplace?: () => void;
}

export function AgentWorkbench({ onOpenOrchestration, onNavigateMarketplace }: AgentWorkbenchProps) {
  const { token } = theme.useToken();
  const rootRef = useRef<HTMLDivElement>(null);
  const previousNarrowRef = useRef<boolean | null>(null);
  const [width, setWidth] = useState(1200);
  const [topicRailOpen, setTopicRailOpen] = useState(true);
  const {
    selectedAgent,
    agentRailOpen,
    setSelectedAgent,
    setAgentSurface,
    setAgentRailOpen,
  } = useActiveAgentSlice((state) => ({
    selectedAgent: state.selectedAgent,
    agentRailOpen: state.agentRosterOpen,
    setSelectedAgent: state.setSelectedAgent,
    setAgentSurface: state.setAgentSurface,
    setAgentRailOpen: state.setAgentRosterOpen,
  }));
  const layout = deriveAgentWorkbenchLayout(width, agentRailOpen, topicRailOpen);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const updateWidth = (nextWidth: number) => {
      if (nextWidth <= 0) return;
      const nextLayout = deriveAgentWorkbenchLayout(
        nextWidth,
        agentRailOpen,
        topicRailOpen,
      );
      const previousNarrow = previousNarrowRef.current;
      previousNarrowRef.current = nextLayout.narrow;
      setWidth(nextWidth);
      if (nextLayout.narrow && previousNarrow !== true) {
        setAgentRailOpen(false);
        setTopicRailOpen(false);
      }
    };
    updateWidth(root.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => updateWidth(entry.contentRect.width));
    observer.observe(root);
    return () => observer.disconnect();
  }, [agentRailOpen, setAgentRailOpen, topicRailOpen]);

  const openSurface = useCallback(
    (agentName: string, surface: 'chat' | 'profile') => {
      const name = agentName || selectedAgent;
      if (!name) return;
      if (name !== selectedAgent) setSelectedAgent(name);
      setAgentSurface(name, surface);
    },
    [selectedAgent, setAgentSurface, setSelectedAgent],
  );

  return (
    <div
      ref={rootRef}
      data-v1-agent-workbench
      data-pt-agent-workbench
      data-pt-agent-layout={layout.narrow ? 'narrow' : 'wide'}
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        position: 'relative',
        display: 'flex',
        overflow: 'hidden',
        background: token.colorBgContainer,
        color: token.colorText,
      }}
    >
      <AgentRail
        collapsed={layout.agentRail === 'collapsed'}
        onToggle={() => setAgentRailOpen(!agentRailOpen)}
        onOpenProfile={(agentName) => openSurface(agentName, 'profile')}
      />
      {layout.topicRail !== 'hidden' ? (
        <TopicRail
          collapsed={layout.topicRail === 'collapsed'}
          onToggle={() => setTopicRailOpen((open) => !open)}
          onOpenProfile={(agentName) => openSurface(agentName, 'profile')}
          onOpenChat={(agentName) => openSurface(agentName, 'chat')}
          onNavigateMarketplace={onNavigateMarketplace}
        />
      ) : null}
      <ConversationRail
        narrow={layout.narrow}
        onOpenProfile={(agentName) => openSurface(agentName, 'profile')}
        onOpenChat={(agentName) => openSurface(agentName, 'chat')}
        onOpenOrchestration={onOpenOrchestration}
      />
    </div>
  );
}
