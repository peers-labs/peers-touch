import { useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { DraggablePanel } from '@lobehub/ui';
import { theme } from 'antd';

import { usePortalStore } from '../../store/portal';
import { useChatStore, extractMessageArtifacts } from '../../store/chat';
import { PortalHeader } from './PortalHeader';
import { ArtifactListView } from './views/ArtifactListView';
import { ArtifactDetailView } from './views/ArtifactDetailView';
import { ToolDetailView } from './views/ToolDetailView';
import { ThreadView } from './views/ThreadView';
import { TopicCommentsView } from './views/TopicCommentsView';
import { WorkingFilesView } from './views/WorkingFilesView';
import { WorkingProgressView } from './views/WorkingProgressView';
import { AgentOverviewView } from './views/AgentOverviewView';

export function PortalPanel() {
  const { token } = theme.useToken();
  const expanded = usePortalStore((s) => s.expanded);
  const activeView = usePortalStore((s) => s.activeView);
  const messages = useChatStore((s) => s.messages);

  const allArtifacts = useMemo(
    () => messages.filter((m) => m.role === 'assistant').flatMap((m) => extractMessageArtifacts(m)),
    [messages],
  );

  if (!expanded) return null;

  const isFullHeightView = activeView?.type === 'thread' || activeView?.type === 'topicComments';

  const renderView = () => {
    if (!activeView || activeView.type === 'artifacts') {
      return <ArtifactListView artifacts={allArtifacts} />;
    }
    if (activeView.type === 'artifactDetail') {
      return <ArtifactDetailView artifact={activeView.artifact} />;
    }
    if (activeView.type === 'toolDetail') {
      const msg = messages.find((m) => m.id === activeView.messageId);
      const toolCall = msg?.toolCalls?.find((tc) => tc.id === activeView.toolCallId);
      if (!toolCall) return <ArtifactListView artifacts={allArtifacts} />;
      return <ToolDetailView toolCall={toolCall} />;
    }
    if (activeView.type === 'thread') {
      return <ThreadView sessionKey={activeView.sessionKey} sourceMessageId={activeView.sourceMessageId} />;
    }
    if (activeView.type === 'topicComments') {
      return <TopicCommentsView topicKey={activeView.topicKey} />;
    }
    if (activeView.type === 'workingFiles') {
      return <WorkingFilesView sessionKey={activeView.sessionKey} />;
    }
    if (activeView.type === 'workingProgress') {
      return <WorkingProgressView />;
    }
    if (activeView.type === 'agentOverview') {
      return <AgentOverviewView agentId={activeView.agentId} />;
    }
    return null;
  };

  return (
    <DraggablePanel
      placement="right"
      defaultSize={{ width: 400 }}
      minWidth={320}
      maxWidth={560}
      expand={expanded}
      onExpandChange={(expand) => {
        if (!expand) usePortalStore.getState().collapse();
      }}
    >
      <Flexbox
        data-pt-agent-portal
        data-pt-agent-portal-view={activeView?.type ?? 'artifacts'}
        style={{
          height: '100%',
          background: token.colorBgContainer,
          borderLeft: `1px solid ${token.colorBorderSecondary}`,
          overflow: 'hidden',
        }}
      >
        <PortalHeader activeView={activeView} />
        <Flexbox style={{ flex: 1, overflow: isFullHeightView ? 'hidden' : 'auto', padding: isFullHeightView ? 0 : 16 }}>
          {renderView()}
        </Flexbox>
      </Flexbox>
    </DraggablePanel>
  );
}
