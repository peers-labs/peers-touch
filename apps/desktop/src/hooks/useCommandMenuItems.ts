import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../store/agent';
import { useAgentTopicStore } from '../store/agentTopics';
import { useCommandMenuStore } from '../store/commandMenu';
import { fuzzyMatchMulti } from '../utils/fuzzyMatch';
import type { CommandItem } from '../store/commandMenu';
import type { Page } from '../types/navigation';

interface CommandMenuDeps {
  navigateTo: (page: Page) => void;
  navigateToAgentSurface: (agentName: string, surface: 'chat' | 'profile') => void;
  navigateToSettings: (tab: string) => void;
}

interface GroupedCommands {
  pages: CommandItem[];
  agents: CommandItem[];
  topics: CommandItem[];
  actions: CommandItem[];
}

const PAGE_ICONS: Record<string, string> = {
  home: 'Home',
  chat: 'MessageSquare',
  agent: 'Bot',
  evaluation: 'FlaskConical',
  settings: 'Settings',
  search: 'Search',
  notes: 'FileText',
  'agent-profile': 'UserCircle',
  'agent-orchestration': 'Network',
  'agent-groups': 'Users',
  marketplace: 'Store',
  'custom-plugins': 'Puzzle',
};

export function useCommandMenuItems(deps: CommandMenuDeps): GroupedCommands {
  const { navigateTo, navigateToAgentSurface, navigateToSettings } = deps;
  const { t } = useTranslation('agent');
  const query = useCommandMenuStore((s) => s.query);
  const agents = useAgentStore((s) => s.agents);
  const topicsByAgentId = useAgentTopicStore((s) => s.topicsByAgentId);

  return useMemo(() => {
    const allItems: CommandItem[] = [];

    // Pages
    const pageEntries: Array<{ id: string; page: Page; titleKey: string }> = [
      { id: 'page:home', page: 'home', titleKey: 'agent.commandMenu.page.home' },
      { id: 'page:chat', page: 'chat', titleKey: 'agent.commandMenu.page.chat' },
      { id: 'page:agent', page: 'agent', titleKey: 'agent.commandMenu.page.agent' },
      { id: 'page:evaluation', page: 'evaluation', titleKey: 'agent.commandMenu.page.evaluation' },
      { id: 'page:search', page: 'search', titleKey: 'agent.commandMenu.page.search' },
      { id: 'page:notes', page: 'notes', titleKey: 'agent.commandMenu.page.notes' },
      { id: 'page:marketplace', page: 'marketplace', titleKey: 'agent.commandMenu.page.marketplace' },
      { id: 'page:agent-groups', page: 'agent-groups', titleKey: 'agent.commandMenu.page.agentGroups' },
      { id: 'page:settings', page: 'settings', titleKey: 'agent.commandMenu.page.settings' },
      { id: 'page:custom-plugins', page: 'custom-plugins', titleKey: 'agent.commandMenu.page.customPlugins' },
    ];

    for (const entry of pageEntries) {
      const title = t(entry.titleKey);
      allItems.push({
        id: entry.id,
        type: 'page',
        title,
        icon: PAGE_ICONS[entry.page] ?? 'FileText',
        action: () => navigateTo(entry.page),
      });
    }

    // Agents
    for (const agent of agents) {
      const displayName = agent.title || agent.name;
      allItems.push({
        id: `agent:${agent.name}`,
        type: 'agent',
        title: displayName,
        subtitle: agent.description || undefined,
        icon: 'Bot',
        action: () => navigateToAgentSurface(agent.name, 'chat'),
      });
    }

    // Topics — take the most recent topics across all agents (max 20)
    const allTopics: Array<{ agentId: string; title: string; key: string }> = [];
    for (const [agentId, topics] of Object.entries(topicsByAgentId)) {
      for (const topic of topics.slice(0, 5)) {
        if (topic.title) {
          allTopics.push({ agentId, title: topic.title, key: topic.key });
        }
      }
    }
    for (const topic of allTopics.slice(0, 20)) {
      allItems.push({
        id: `topic:${topic.key}`,
        type: 'topic',
        title: topic.title,
        subtitle: topic.agentId,
        icon: 'MessagesSquare',
        action: () => navigateToAgentSurface(topic.agentId, 'chat'),
      });
    }

    // Actions
    const actionEntries: Array<{ id: string; titleKey: string; icon: string; action: () => void }> = [
      {
        id: 'action:new-chat',
        titleKey: 'agent.commandMenu.newChat',
        icon: 'Plus',
        action: () => navigateTo('chat'),
      },
      {
        id: 'action:create-agent',
        titleKey: 'agent.commandMenu.createAgent',
        icon: 'PlusCircle',
        action: () => navigateTo('marketplace'),
      },
      {
        id: 'action:open-settings',
        titleKey: 'agent.commandMenu.settings',
        icon: 'Settings',
        action: () => navigateToSettings('general'),
      },
    ];

    for (const entry of actionEntries) {
      allItems.push({
        id: entry.id,
        type: 'action',
        title: t(entry.titleKey),
        icon: entry.icon,
        action: entry.action,
      });
    }

    // Filter by query using fuzzy matching
    const filtered = query
      ? allItems
          .map((item) => ({ item, score: fuzzyMatchMulti(query, item.title, item.subtitle) }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score)
          .map(({ item }) => item)
      : allItems;

    // Group by type
    const grouped: GroupedCommands = { pages: [], agents: [], topics: [], actions: [] };
    for (const item of filtered) {
      grouped[`${item.type}s` as keyof GroupedCommands].push(item);
    }

    return grouped;
  }, [query, agents, topicsByAgentId, navigateTo, navigateToAgentSurface, navigateToSettings, t]);
}
