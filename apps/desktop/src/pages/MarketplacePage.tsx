// Marketplace discovery page — unified browse/search for agents, skills, and MCP servers.
// Part of P3-M2 "Marketplace / Discovery".

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { SearchBar } from '@lobehub/ui';
import { Segmented, Empty, App, theme } from 'antd';
import { Bot, Puzzle, Server } from 'lucide-react';

import { api } from '../services/desktop_api';
import type { Agent, MarketSkillEntry, MarketSummary, MCPServerItem } from '../services/desktop_api';
import { MarketplaceAgentCard } from './marketplace/AgentCard';
import { MarketplaceSkillCard } from './marketplace/SkillCard';
import { MarketplaceMCPCard } from './marketplace/MCPCard';

type TabKey = 'agents' | 'skills' | 'mcp';

export const MarketplacePage = memo(() => {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const { message } = App.useApp();

  const [activeTab, setActiveTab] = useState<TabKey>('agents');
  const [search, setSearch] = useState('');

  // ── Data state ──
  const [agents, setAgents] = useState<Agent[]>([]);
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [skills, setSkills] = useState<MarketSkillEntry[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServerItem[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Fetch data on mount ──
  useEffect(() => {
    void loadAgents();
    void loadMarkets();
    void loadMCPServers();
  }, []);

  const loadAgents = async () => {
    const result = await api.listAgents();
    setAgents(result);
  };

  const loadMarkets = async () => {
    const result = await api.listSkillMarkets();
    setMarkets(result);
    // Auto-load skills from first market if available
    if (result.length > 0 && result[0].synced) {
      await loadSkillsFromMarket(result[0].id);
    }
  };

  const loadSkillsFromMarket = async (marketId: string) => {
    setLoading(true);
    try {
      const result = await api.listMarketSkills(marketId);
      setSkills(result.skills);
    } finally {
      setLoading(false);
    }
  };

  const loadMCPServers = async () => {
    const result = await api.listMCPServers();
    setMcpServers(result);
  };

  // ── Filtered results ──
  const filteredAgents = useMemo(() => {
    if (!search) return agents;
    const q = search.toLowerCase();
    return agents.filter(
      (a) => a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q),
    );
  }, [agents, search]);

  const filteredSkills = useMemo(() => {
    if (!search) return skills;
    const q = search.toLowerCase();
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [skills, search]);

  const filteredMCP = useMemo(() => {
    if (!search) return mcpServers;
    const q = search.toLowerCase();
    return mcpServers.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [mcpServers, search]);

  // ── Actions ──
  const handleCloneAgent = useCallback(
    async (agent: Agent) => {
      try {
        const pkg = await api.exportAgentPackage(agent.id);
        await api.importAgentPackage(pkg, `${agent.title} (Clone)`);
        void message.success(t('agent.marketplace.cloneSuccess'));
        void loadAgents();
      } catch {
        void message.error(t('agent.marketplace.cloneFailed'));
      }
    },
    [message, t],
  );

  const handleInstallSkill = useCallback(
    async (skill: MarketSkillEntry) => {
      if (!skill.marketId) return;
      try {
        await api.installMarketSkill(skill.marketId, skill.filePath);
        void message.success(t('agent.marketplace.installSuccess'));
        if (skill.marketId) {
          void loadSkillsFromMarket(skill.marketId);
        }
      } catch {
        void message.error(t('agent.marketplace.installFailed'));
      }
    },
    [message, t],
  );

  // ── Tab options ──
  const tabOptions = useMemo(
    () => [
      { label: t('agent.marketplace.tabs.agents'), value: 'agents' as TabKey, icon: <Bot size={14} /> },
      { label: t('agent.marketplace.tabs.skills'), value: 'skills' as TabKey, icon: <Puzzle size={14} /> },
      { label: t('agent.marketplace.tabs.mcp'), value: 'mcp' as TabKey, icon: <Server size={14} /> },
    ],
    [t],
  );

  // ── Render grid content ──
  const renderContent = () => {
    if (activeTab === 'agents') {
      if (filteredAgents.length === 0) {
        return (
          <Empty
            description={search ? t('agent.marketplace.noResults') : t('agent.marketplace.empty')}
          />
        );
      }
      return (
        <Flexbox gap={token.marginMD} horizontal wrap="wrap">
          {filteredAgents.map((agent) => (
            <MarketplaceAgentCard
              key={agent.id}
              agent={agent}
              onClone={handleCloneAgent}
            />
          ))}
        </Flexbox>
      );
    }

    if (activeTab === 'skills') {
      if (filteredSkills.length === 0) {
        return (
          <Empty
            description={
              search
                ? t('agent.marketplace.noResults')
                : markets.length === 0
                  ? t('agent.marketplace.noMarketSource')
                  : t('agent.marketplace.empty')
            }
          />
        );
      }
      return (
        <Flexbox gap={token.marginMD} horizontal wrap="wrap">
          {filteredSkills.map((skill) => (
            <MarketplaceSkillCard
              key={`${skill.marketId}-${skill.filePath}`}
              skill={skill}
              onInstall={handleInstallSkill}
            />
          ))}
        </Flexbox>
      );
    }

    // MCP tab
    if (filteredMCP.length === 0) {
      return (
        <Empty
          description={search ? t('agent.marketplace.noResults') : t('agent.marketplace.empty')}
        />
      );
    }
    return (
      <Flexbox gap={token.marginMD} horizontal wrap="wrap">
        {filteredMCP.map((server) => (
          <MarketplaceMCPCard key={server.name} server={server} />
        ))}
      </Flexbox>
    );
  };

  return (
    <Flexbox
      padding={token.paddingLG}
      gap={token.marginLG}
      style={{ height: '100%', overflow: 'auto' }}
    >
      {/* Header */}
      <Flexbox gap={token.marginSM}>
        <h2 style={{ margin: 0, fontSize: token.fontSizeHeading4, color: token.colorText }}>
          {t('agent.marketplace.title')}
        </h2>
      </Flexbox>

      {/* Tabs + Search */}
      <Flexbox horizontal gap={token.marginMD} align="center" justify="space-between">
        <Segmented
          options={tabOptions}
          value={activeTab}
          onChange={(val) => setActiveTab(val as TabKey)}
        />
        <SearchBar
          placeholder={t('agent.marketplace.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          style={{ width: 260 }}
          enableShortKey={false}
        />
      </Flexbox>

      {/* Content */}
      <Flexbox style={{ flex: 1, minHeight: 0 }}>
        {loading ? null : renderContent()}
      </Flexbox>
    </Flexbox>
  );
});

MarketplacePage.displayName = 'MarketplacePage';
