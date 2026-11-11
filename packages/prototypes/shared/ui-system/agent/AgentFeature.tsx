/**
 * AgentFeature — the Agent module surface for the Frontend Eles desktop
 * frame.
 *
 * It owns only surface-level state (selection, rail collapse, local seed
 * mutations, drawer routing) and composes the rails from peers-ui primitives.
 * A "task" is not a separate construct here: starting work means creating a
 * new conversation topic in the topic rail, so there is a single Agents
 * surface:
 *
 *   roster 230/48 · topic rail 238/48 · conversation · workbench
 *
 * Below the narrow breakpoint the rails become mutually exclusive; below
 * ultra-narrow both leave the reading path and open as transient Drawers.
 */
import { useMemo, useState } from 'react';
import { Drawer, Flex, Heading, IconButton } from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../prefs';
import { SEED_AGENTS, SEED_TOPICS } from './agent-data';
import { ConversationPane } from './conversation/ConversationPane';
import { seedForTopic } from './conversation/conversation-data';
import { deriveLayout, useContainerWidth } from './hooks';
import { AgentRoster } from './AgentRoster';
import { TopicRail } from './TopicRail';
import { Workbench } from './workbench/Workbench';
import { AgentProfile } from './profile/AgentProfile';
import { CreateAgentDialog, type CreateAgentInput } from './CreateAgentDialog';
import type { AgentRecord, AgentSurface, TopicRecord } from './types';
import './agent.css';

type DrawerKind = 'agents' | 'topics' | null;

export function AgentFeature() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const { ref, width } = useContainerWidth<HTMLDivElement>();

  const [agents, setAgents] = useState<readonly AgentRecord[]>(SEED_AGENTS);
  const [topics, setTopics] = useState<readonly TopicRecord[]>(SEED_TOPICS);
  const [selectedAgentId, setSelectedAgentId] = useState(SEED_AGENTS[0].id);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [agentRailOpen, setAgentRailOpen] = useState(true);
  const [topicRailOpen, setTopicRailOpen] = useState(true);
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [surface, setSurface] = useState<AgentSurface>('chat');
  const [createOpen, setCreateOpen] = useState(false);

  const layout = deriveLayout(width, agentRailOpen, topicRailOpen);
  const isProfile = surface === 'profile';
  const isChat = surface === 'chat';

  const selectedAgent = agents.find(a => a.id === selectedAgentId) ?? agents[0];
  const scopedTopics = useMemo(
    () => topics.filter(topic => topic.agentId === selectedAgentId),
    [topics, selectedAgentId],
  );
  const selectedTopic = scopedTopics.find(item => item.id === selectedTopicId) ?? null;

  const selectAgent = (id: string) => {
    setSelectedAgentId(id);
    setSelectedTopicId(null);
    setDrawer(null);
    setSurface('chat');
  };

  const openProfile = (id: string) => {
    setSelectedAgentId(id);
    setSurface('profile');
    setDrawer(null);
  };

  const createAgent = (input: CreateAgentInput) => {
    const id = `agent-${Date.now()}`;
    const record: AgentRecord = {
      id,
      name: input.name,
      description: input.description || t('agent.roster.create.defaultDescription'),
      avatarMode: 'initial',
      avatarValue: input.name.trim()[0]?.toLocaleUpperCase() ?? '?',
      status: 'active',
      defaultModel: input.defaultModel,
      topicCount: 0,
    };
    setAgents(previous => [record, ...previous]);
    selectAgent(id);
  };

  const updateIdentity = (patch: Partial<Pick<AgentRecord, 'name' | 'description' | 'avatarMode' | 'avatarValue'>>) => {
    setAgents(previous => previous.map(agent =>
      agent.id === selectedAgentId ? { ...agent, ...patch } : agent));
  };

  const deleteAgent = (id: string) => {
    setAgents(previous => previous.filter(agent => agent.id !== id));
    setTopics(previous => previous.filter(topic => topic.agentId !== id));
    if (id === selectedAgentId) {
      const remaining = agents.filter(agent => agent.id !== id);
      if (remaining[0]) setSelectedAgentId(remaining[0].id);
    }
  };

  const deleteTopics = (ids: readonly string[]) => {
    setTopics(previous => previous.filter(topic => !ids.includes(topic.id)));
    if (selectedTopicId && ids.includes(selectedTopicId)) setSelectedTopicId(null);
  };

  const renameTopic = (id: string, title: string) => {
    setTopics(previous => previous.map(topic =>
      topic.id === id ? { ...topic, title } : topic));
  };

  const pinTopic = (id: string, pinned: boolean) => {
    setTopics(previous => previous.map(topic =>
      topic.id === id ? { ...topic, pinned } : topic));
  };

  const renderRoster = (forceExpanded = false) => (
    <AgentRoster
      agents={agents}
      selectedAgentId={selectedAgentId}
      collapsed={forceExpanded ? false : layout.agentRail === 'collapsed'}
      embedded={forceExpanded}
      onToggle={() => setAgentRailOpen(open => !open)}
      onSelectAgent={selectAgent}
      onOpenProfile={openProfile}
      onCreateAgent={() => setCreateOpen(true)}
      onDeleteAgent={deleteAgent}
    />
  );

  const renderTopicRail = (forceExpanded = false) => (
    <TopicRail
      agent={selectedAgent}
      topics={scopedTopics}
      selectedTopicId={selectedTopicId}
      collapsed={forceExpanded ? false : layout.topicRail === 'collapsed'}
      fullWidth={forceExpanded}
      onToggle={() => setTopicRailOpen(open => !open)}
      onSelect={(id) => { setSelectedTopicId(id); setDrawer(null); setSurface('chat'); }}
      onNewTopic={() => setDrawer(null)}
      onOpenProfile={() => openProfile(selectedAgentId)}
      onRename={renameTopic}
      onPin={pinTopic}
      onDelete={deleteTopics}
    />
  );

  const renderSurface = () => {
    if (isProfile) {
      return (
        <AgentProfile
          agent={selectedAgent}
          onBack={() => setSurface('chat')}
          onIdentityChange={updateIdentity}
        />
      );
    }
    return (
      <>
        <Flex direction="row" align="center" justify="space-between" className="pa-conversation__bar">
          <Flex direction="row" align="center" gap={8} className="pa-conversation__title">
            {layout.ultraNarrow && (
              <IconButton
                actionId="agent.ultra.switch-agent"
                iconId="panel-left-open"
                iconSize={17}
                label={t('agent.roster.title')}
                emphasis="quiet"
                onActivate={() => setDrawer('agents')}
              />
            )}
            <Heading level={4} truncate>
              {selectedTopic?.title ?? selectedAgent.name}
            </Heading>
          </Flex>
          <Flex direction="row" align="center" gap={4}>
            {layout.ultraNarrow && (
              <IconButton
                actionId="agent.ultra.topics"
                iconId="hash"
                iconSize={17}
                label={t('agent.topic.title')}
                emphasis="quiet"
                onActivate={() => setDrawer('topics')}
              />
            )}
          </Flex>
        </Flex>
        <Flex direction="row" className="pa-conversation__main">
          <ConversationPane
            topicId={selectedTopic?.id ?? null}
            topicTitle={selectedTopic?.title ?? selectedAgent.name}
          />
          {layout.workbenchVisible && (
            <Workbench
              messages={seedForTopic(selectedTopic?.id ?? 'default')}
              title={selectedTopic?.title ?? selectedAgent.name}
              agentName={selectedAgent.name}
            />
          )}
        </Flex>
      </>
    );
  };

  return (
    <Flex
      ref={ref}
      direction="row"
      className="pa-shell"
      data-agent-surface={surface}
      data-layout={layout.ultraNarrow ? 'ultra-narrow' : layout.narrow ? 'narrow' : 'wide'}
      aria-label={t('nav.agent')}
    >
      {!layout.ultraNarrow && renderRoster()}
      {!layout.ultraNarrow && isChat && renderTopicRail()}

      <Flex className="pa-conversation" direction="column" style={{ flex: 1, minWidth: 0 }}>
        {renderSurface()}
      </Flex>

      <Drawer
        open={drawer === 'agents'}
        title={t('agent.roster.title')}
        side="left"
        width={300}
        closeLabel={t('agent.common.cancel')}
        onDismiss={() => setDrawer(null)}
      >
        {renderRoster(true)}
      </Drawer>
      <Drawer
        open={drawer === 'topics'}
        title={t('agent.topic.title')}
        side="left"
        width={320}
        closeLabel={t('agent.common.cancel')}
        onDismiss={() => setDrawer(null)}
      >
        {renderTopicRail(true)}
      </Drawer>

      <CreateAgentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createAgent}
      />
    </Flex>
  );
}
