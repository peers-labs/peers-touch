import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon } from '@lobehub/ui';
import { Drawer, theme } from 'antd';
import { ArrowLeft, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useActiveAgentSlice } from '../useActiveAgentStores';
import { AgentRail } from './AgentRail';
import { ConversationRail } from './ConversationRail';
import { deriveAgentWorkbenchLayout } from './layout';
import { TopicRail } from './TopicRail';

interface AgentWorkbenchProps {
  onOpenOrchestration?: () => void;
}

export function AgentWorkbench({ onOpenOrchestration }: AgentWorkbenchProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const rootRef = useRef<HTMLDivElement>(null);
  const previousNarrowRef = useRef<boolean | null>(null);
  const [width, setWidth] = useState(1200);
  const [topicRailOpen, setTopicRailOpen] = useState(true);
  const [mobileTopicsOpen, setMobileTopicsOpen] = useState(false);
  const [mobileAgentsOpen, setMobileAgentsOpen] = useState(false);
  const {
    selectedAgent,
    currentSurface,
    agentRailOpen,
    setSelectedAgent,
    setAgentSurface,
    setAgentRailOpen,
  } = useActiveAgentSlice((state) => ({
    selectedAgent: state.selectedAgent,
    currentSurface: state.agentSurfaces[state.selectedAgent] || 'chat',
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
      setMobileTopicsOpen(false);
      setMobileAgentsOpen(false);
    },
    [selectedAgent, setAgentSurface, setSelectedAgent],
  );

  return (
    <div
      ref={rootRef}
      data-v1-agent-workbench
      data-pt-agent-workbench
      data-pt-agent-layout={layout.ultraNarrow ? 'ultra-narrow' : layout.narrow ? 'narrow' : 'wide'}
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
      {!layout.ultraNarrow && <AgentRail
        collapsed={layout.agentRail === 'collapsed'}
        onToggle={() => {
          if (layout.narrow && !agentRailOpen) setTopicRailOpen(false);
          setAgentRailOpen(!agentRailOpen);
        }}
        onOpenProfile={(agentName) => openSurface(agentName, 'profile')}
      />}
      {!layout.ultraNarrow && currentSurface === 'chat' ? (
        <TopicRail
          collapsed={layout.topicRail === 'collapsed'}
          onToggle={() => {
            if (layout.narrow && !topicRailOpen) setAgentRailOpen(false);
            setTopicRailOpen((open) => !open);
          }}
          onOpenProfile={(agentName) => openSurface(agentName, 'profile')}
          onOpenChat={(agentName) => openSurface(agentName, 'chat')}
        />
      ) : null}
      <div style={{
        flex: 1, minWidth: 0, minHeight: 0,
        display: layout.ultraNarrow && mobileTopicsOpen ? 'none' : 'flex',
        flexDirection: 'column',
      }}>
        {layout.ultraNarrow && currentSurface === 'chat' && (
          <div style={{ display: 'flex', padding: 4 }}>
            <ActionIcon
              data-pt-agent-mobile-back
              icon={ArrowLeft}
              title={t('agent.sidebar.back')}
              onClick={() => setMobileTopicsOpen(true)}
              size={{ blockSize: 44, size: 18 }}
            />
          </div>
        )}
        <ConversationRail
          narrow={layout.narrow}
          onOpenChat={(agentName) => openSurface(agentName, 'chat')}
          onOpenOrchestration={onOpenOrchestration}
        />
      </div>
      {layout.ultraNarrow && mobileTopicsOpen && currentSurface === 'chat' && (
        <div data-pt-agent-mobile-topics style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: 4 }}>
            <ActionIcon
              data-pt-agent-mobile-switch
              icon={List}
              title={t('agent.sidebar.switchAgent')}
              onClick={() => setMobileAgentsOpen(true)}
              size={{ blockSize: 44, size: 18 }}
            />
            <ActionIcon
              icon={ArrowLeft}
              title={t('agent.sidebar.back')}
              onClick={() => setMobileTopicsOpen(false)}
              size={{ blockSize: 44, size: 18 }}
            />
          </div>
          <TopicRail
            collapsed={false}
            fullWidth
            onToggle={() => setMobileTopicsOpen(false)}
            onOpenProfile={(name) => openSurface(name, 'profile')}
            onOpenChat={(name) => openSurface(name, 'chat')}
          />
        </div>
      )}
      <Drawer
        open={layout.ultraNarrow && mobileAgentsOpen}
        placement="left"
        width={Math.min(320, width)}
        title={t('agent.sidebar.switchAgent')}
        onClose={() => setMobileAgentsOpen(false)}
        getContainer={false}
        destroyOnClose
        styles={{ body: { padding: 0 } }}
      >
        <AgentRail
          collapsed={false}
          onToggle={() => setMobileAgentsOpen(false)}
          onSelectAgent={(agent) => {
            setAgentSurface(agent.name, 'chat');
            setMobileAgentsOpen(false);
            setMobileTopicsOpen(true);
          }}
          onOpenProfile={(name) => openSurface(name, 'profile')}
        />
      </Drawer>
    </div>
  );
}
