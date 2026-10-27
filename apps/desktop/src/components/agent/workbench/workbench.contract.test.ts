import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(
  new URL('../../../pages/AgentChatPage.tsx', import.meta.url),
  'utf8',
);
const sidebarSource = readFileSync(new URL('../../AgentSidebar.tsx', import.meta.url), 'utf8');
const chatSource = readFileSync(
  new URL('../../../pages/ChatPage.tsx', import.meta.url),
  'utf8',
);
const profileSource = readFileSync(
  new URL('../../../pages/AgentProfilePage.tsx', import.meta.url),
  'utf8',
);
const messageListSource = readFileSync(
  new URL('../../MessageList.tsx', import.meta.url),
  'utf8',
);
const topicRuntimeSource = readFileSync(
  new URL('../../../runtimes/agentTopicRuntime.ts', import.meta.url),
  'utf8',
);
const conversationRailSource = readFileSync(
  new URL('./ConversationRail.tsx', import.meta.url),
  'utf8',
);
const agentRailSource = readFileSync(
  new URL('./AgentRail.tsx', import.meta.url),
  'utf8',
);

describe('Agent workbench ownership contract', () => {
  it('keeps AgentChatPage as a pure workbench renderer', () => {
    expect(pageSource).toContain('<AgentWorkbench');
    expect(pageSource).not.toContain('useEffect');
    expect(pageSource).not.toContain('useAgentStore');
    expect(pageSource).not.toContain('useChatStore');
  });

  it('does not bootstrap Agent or Topic business data from AgentSidebar mount', () => {
    expect(sidebarSource).not.toMatch(/useEffect\(\(\) => \{\s*loadAgents\(\)/);
    expect(sidebarSource).not.toMatch(/useEffect\(\(\) => \{\s*loadAgentTopics\(\)/);
  });

  it('assigns selected-Agent topic bootstrap and reconcile to a session runtime', () => {
    expect(topicRuntimeSource).toContain("scope: 'session'");
    expect(topicRuntimeSource).toContain("loadTopicsForAgent(agent.id, reason)");
    expect(topicRuntimeSource).toContain("useAgentStore.subscribe");
    expect(topicRuntimeSource).toContain("bootstrapSession()");
  });

  it('keeps the conversation focused on Topic content and current-topic search', () => {
    expect(chatSource).toContain('data-pt-agent-conversation-header');
    expect(chatSource).toContain('highlightedMessageId={highlightedMessageId}');
    expect(messageListSource).toContain('virtualizer.scrollToIndex(messageIndex');
    expect(chatSource).toContain('<TurnQueueTray />');
    expect(chatSource).not.toContain('ChatTerminalPanel');
    expect(chatSource).not.toContain('TerminalToggleButton');
    expect(chatSource).not.toContain('data-pt-agent-portal-toggle');
  });

  it('keeps Chat and visited Profile frames alive across surface navigation', () => {
    expect(conversationRailSource).toContain('data-pt-agent-chat-frame');
    expect(conversationRailSource).toContain('data-pt-agent-profile-frame');
    expect(conversationRailSource).toContain('<ChatPage narrow={narrow} />');
    expect(conversationRailSource).toContain(
      "display: currentSurface === 'chat' ? 'flex' : 'none'",
    );
    expect(conversationRailSource).toContain(
      "display: currentSurface === 'profile' ? 'flex' : 'none'",
    );
    expect(conversationRailSource).toContain(
      "profileMounted || currentSurface === 'profile'",
    );
    expect(conversationRailSource).not.toContain(
      "currentSurface === 'profile' ? (",
    );
  });

  it('routes Agent roster selection through the Agent Chat session owner', () => {
    expect(agentRailSource).toContain('openAgentChatSession(agent, {');
    expect(agentRailSource).toContain("reason: 'agent-roster-selection'");
    expect(agentRailSource).not.toContain('setSelectedAgent(agent.name)');
  });

  it('keeps Agent row menu actions from dispatching row selection', () => {
    expect(agentRailSource).toContain(
      'onClick: ({ domEvent }) => domEvent.stopPropagation()',
    );
    expect(agentRailSource).toContain('onClick={(event) => event.stopPropagation()}');
  });

  it('keeps Profile on identity documents and Station-backed extensions', () => {
    expect(profileSource).toContain("type ProfileSection = 'identity' | 'extensions'");
    expect(profileSource).toContain('CapabilitySourceKind.SKILL');
    expect(profileSource).toContain('CapabilitySourceKind.MCP');
    expect(profileSource).toContain('upsertBinding({');
    expect(profileSource).toContain('deleteBinding({');
    expect(profileSource).not.toContain('ModelSelect');
    expect(profileSource).not.toContain('MemoryTab');
    expect(profileSource).not.toContain('BuilderPanel');
    expect(profileSource).not.toContain('AgentSettingsModal');
  });

  it('uses the compact Topic rail menu contract', () => {
    expect(sidebarSource).toContain('data-pt-agent-topic-list');
    expect(sidebarSource).toContain(
      'data-pt-agent-topic-load-error={currentAgent?.id}',
    );
    expect(sidebarSource).toContain('data-pt-agent-topic-load-retry');
    expect(sidebarSource).toContain("key: 'pin'");
    expect(sidebarSource).toContain("key: 'rename'");
    expect(sidebarSource).toContain("key: 'delete'");
    expect(sidebarSource).not.toContain("key: 'smart-rename'");
    expect(sidebarSource).not.toContain("key: 'favorite'");
    expect(sidebarSource).not.toContain("key: 'comments'");
    expect(sidebarSource).not.toContain('AgentPicker');
    expect(sidebarSource).toContain("flex: '1 1 0'");
    expect(sidebarSource).toContain("width: 'auto'");
    expect(sidebarSource).toContain('data-pt-agent-topic-profile');
    expect(sidebarSource).toContain('data-pt-agent-topic-search');
    expect(sidebarSource).toContain('data-pt-agent-topic-batch-select');
    expect(sidebarSource).toContain('data-pt-agent-topic-batch-delete');
    expect(
      sidebarSource.match(/style=\{TOPIC_ACTION_SLOT_STYLE\}/g),
    ).toHaveLength(3);
  });
});
