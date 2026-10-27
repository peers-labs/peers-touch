import { Flexbox } from 'react-layout-kit';
import { DraggablePanel } from '@lobehub/ui';
import { Drawer, theme } from 'antd';

import { usePortalStore } from '../../store/portal';
import { useChatStore } from '../../store/chat';
import { useChatArtifactStore, type ChatFileArtifact } from '../../store/chatArtifacts';
import { PortalHeader } from './PortalHeader';
import { ArtifactListView } from './views/ArtifactListView';
import { ArtifactDetailView } from './views/ArtifactDetailView';
import { ToolDetailView } from './views/ToolDetailView';
import { ThreadView } from './views/ThreadView';
import { TopicCommentsView } from './views/TopicCommentsView';
import { WorkingFilesView } from './views/WorkingFilesView';
import { WorkingProgressView } from './views/WorkingProgressView';
import { AgentOverviewView } from './views/AgentOverviewView';
import { TurnDetailsView } from './views/TurnDetailsView';

// Selector fallback must keep a stable reference: a fresh [] per selection
// makes useSyncExternalStore detect an endless snapshot mismatch (React #185).
const EMPTY_ARTIFACTS: ChatFileArtifact[] = [];

export function PortalPanel({ artifactsOnly = false, overlay = false }: {
  artifactsOnly?: boolean;
  overlay?: boolean;
}) {
  const { token } = theme.useToken();
  const expanded = usePortalStore((s) => s.expanded);
  const activeView = usePortalStore((s) => s.activeView);
  const messages = useChatStore((s) => s.messages);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const allArtifacts = useChatArtifactStore(
    (s) => s.byConversationId[currentSessionKey] ?? EMPTY_ARTIFACTS,
  );

  if (!expanded) return null;
  if (artifactsOnly && activeView
    && activeView.type !== 'artifacts' && activeView.type !== 'artifactDetail') return null;
  if (artifactsOnly && activeView?.type === 'artifactDetail'
    && !allArtifacts.some(artifact => artifact.id === activeView.artifact.id)) return null;

  const isFullHeightView = activeView?.type === 'thread' || activeView?.type === 'topicComments';

  const renderView = () => {
    if (!activeView || activeView.type === 'artifacts') {
      return <ArtifactListView artifacts={allArtifacts} />;
    }
    if (activeView.type === 'artifactDetail') {
      const artifact = allArtifacts.find((item) => item.id === activeView.artifact.id);
      return artifact ? <ArtifactDetailView artifact={artifact} /> : null;
    }
    if (activeView.type === 'toolDetail') {
      const msg = messages.find((m) => m.id === activeView.messageId);
      const toolCall = msg?.toolCalls?.find((tc) => tc.id === activeView.toolCallId);
      if (!toolCall) return <ArtifactListView artifacts={allArtifacts} />;
      return <ToolDetailView toolCall={toolCall} />;
    }
    if (activeView.type === 'turnDetails') {
      return <TurnDetailsView turnId={activeView.turnId} />;
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

  const content = (
      <Flexbox
        data-pt-agent-portal
        data-pt-agent-portal-view={activeView?.type ?? 'artifacts'}
        data-agent-turn-details={activeView?.type === 'turnDetails' ? activeView.turnId : undefined}
        style={{
          height: '100%',
          background: token.colorBgContainer,
          borderLeft: `1px solid ${token.colorBorderSecondary}`,
          overflow: 'hidden',
        }}
      >
        <PortalHeader activeView={activeView} artifactsOnly={artifactsOnly} />
        <Flexbox style={{ flex: 1, overflow: isFullHeightView ? 'hidden' : 'auto', padding: isFullHeightView ? 0 : 16 }}>
          {renderView()}
        </Flexbox>
      </Flexbox>
  );
  if (overlay) {
    return (
      <Drawer
        open
        placement="right"
        width="min(560px, 100%)"
        getContainer={false}
        closable={false}
        onClose={() => usePortalStore.getState().close()}
        styles={{ body: { padding: 0 } }}
      >
        {content}
      </Drawer>
    );
  }
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
      {content}
    </DraggablePanel>
  );
}
