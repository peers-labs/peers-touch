import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, SearchBar } from '@lobehub/ui';
import { Alert, App, Descriptions, Empty, Input, Modal, Segmented, Spin, Tag, theme } from 'antd';
import { Bot, Plus, Puzzle, RefreshCw, Wrench } from 'lucide-react';

import { api } from '../services/desktop_api';
import type {
  MarketSkillDetail,
  MarketSkillEntry,
  MarketSummary,
} from '../services/desktop_api';
import { usePrefetch } from '../kernel/usePrefetch';
import { MarketplacePackageCard } from './marketplace/PackageCard';

type TabKey = 'agents' | 'skills' | 'tools';
const PACKAGE_BATCH_SIZE = 24;

interface MarketplaceCatalog {
  failedSources: number;
  markets: MarketSummary[];
  packages: MarketSkillEntry[];
}

async function loadMarketplaceCatalog(): Promise<MarketplaceCatalog> {
  const markets = await api.listSkillMarkets();
  const results = await Promise.allSettled(
    markets
      .filter((source) => source.synced)
      .map((source) => api.listMarketSkills(source.id)),
  );

  return {
    failedSources: results.filter((result) => result.status === 'rejected').length,
    markets,
    packages: results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value.skills : [],
    ),
  };
}

function defaultNameFromUrl(url: string): string {
  const normalized = url.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function belongsToTab(entry: MarketSkillEntry, tab: TabKey): boolean {
  const packageType = entry.packageType || 'skill';
  if (tab === 'agents') return packageType === 'agent';
  if (tab === 'tools') return packageType === 'mcp' || packageType === 'plugin';
  return packageType === 'skill';
}

export const MarketplacePage = memo(() => {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const { message } = App.useApp();

  const [activeTab, setActiveTab] = useState<TabKey>('agents');
  const [search, setSearch] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(PACKAGE_BATCH_SIZE);
  const [syncing, setSyncing] = useState(false);
  const {
    value: catalog,
    loading,
    error: catalogError,
    reload: reloadCatalog,
  } = usePrefetch('marketplace.catalog', loadMarketplaceCatalog);
  const markets = useMemo(() => catalog?.markets ?? [], [catalog]);
  const packages = useMemo(() => catalog?.packages ?? [], [catalog]);

  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceBranch, setSourceBranch] = useState('main');
  const [addingSource, setAddingSource] = useState(false);

  const [selectedEntry, setSelectedEntry] = useState<MarketSkillEntry | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<MarketSkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const filteredPackages = useMemo(() => {
    const query = search.trim().toLowerCase();
    return packages.filter((entry) => {
      if (!belongsToTab(entry, activeTab)) return false;
      if (!query) return true;
      return entry.name.toLowerCase().includes(query)
        || entry.description.toLowerCase().includes(query)
        || entry.identifier.toLowerCase().includes(query)
        || entry.keywords?.some((keyword) => keyword.toLowerCase().includes(query));
    });
  }, [activeTab, packages, search]);

  const tabOptions = useMemo(
    () => [
      {
        label: t('agent.marketplace.tabs.agents'),
        value: 'agents' as TabKey,
        icon: <Bot size={14} />,
      },
      {
        label: t('agent.marketplace.tabs.skills'),
        value: 'skills' as TabKey,
        icon: <Puzzle size={14} />,
      },
      {
        label: t('agent.marketplace.tabs.tools'),
        value: 'tools' as TabKey,
        icon: <Wrench size={14} />,
      },
    ],
    [t],
  );
  const visiblePackages = useMemo(
    () => filteredPackages.slice(0, visibleLimit),
    [filteredPackages, visibleLimit],
  );

  const handleSyncAll = useCallback(async () => {
    if (markets.length === 0) {
      setAddSourceOpen(true);
      return;
    }
    setSyncing(true);
    try {
      const results = await Promise.allSettled(
        markets.map((market) => api.syncSkillMarket(market.id)),
      );
      const failed = results.filter((result) => result.status === 'rejected').length;
      reloadCatalog();
      if (failed > 0) {
        void message.warning(t('agent.marketplace.syncPartial', {
          failed,
          total: markets.length,
        }));
      } else {
        void message.success(t('agent.marketplace.syncSuccess'));
      }
    } finally {
      setSyncing(false);
    }
  }, [markets, message, reloadCatalog, t]);

  const handleAddSource = useCallback(async () => {
    const url = sourceUrl.trim();
    if (!url) {
      void message.warning(t('agent.marketplace.sourceUrlRequired'));
      return;
    }

    setAddingSource(true);
    let sourceAdded = false;
    try {
      const result = await api.addSkillMarketSource(
        url,
        sourceName.trim() || defaultNameFromUrl(url),
        sourceBranch.trim() || 'main',
      );
      if (!('id' in result) || typeof result.id !== 'string' || !result.id) {
        throw new Error(t('agent.marketplace.addSourceFailed'));
      }
      sourceAdded = true;
      await api.syncSkillMarket(result.id);
      void message.success(t('agent.marketplace.addSourceSuccess'));
    } catch (error) {
      const fallbackKey = sourceAdded
        ? 'agent.marketplace.addedButSyncFailed'
        : 'agent.marketplace.addSourceFailed';
      const detail = error instanceof Error ? error.message : t(fallbackKey);
      void message.error(detail);
    } finally {
      if (sourceAdded) {
        setAddSourceOpen(false);
        setSourceUrl('');
        setSourceName('');
        setSourceBranch('main');
        reloadCatalog();
      }
      setAddingSource(false);
    }
  }, [message, reloadCatalog, sourceBranch, sourceName, sourceUrl, t]);

  const handleInstall = useCallback(async (entry: MarketSkillEntry) => {
    if (!entry.marketId) return;
    try {
      await api.installMarketSkill(entry.marketId, entry.filePath);
      void message.success(t('agent.marketplace.installSuccess'));
      setSelectedEntry(null);
      setSelectedDetail(null);
      reloadCatalog();
    } catch (error) {
      const detail = error instanceof Error ? error.message : t('agent.marketplace.installFailed');
      void message.error(detail);
    }
  }, [message, reloadCatalog, t]);

  const handleUninstall = useCallback(async (entry: MarketSkillEntry) => {
    if (!entry.marketId) return;
    try {
      await api.uninstallMarketSkill(entry.marketId, entry.filePath);
      void message.success(t('agent.marketplace.uninstallSuccess'));
      setSelectedEntry(null);
      setSelectedDetail(null);
      reloadCatalog();
    } catch (error) {
      const detail = error instanceof Error ? error.message : t('agent.marketplace.uninstallFailed');
      void message.error(detail);
    }
  }, [message, reloadCatalog, t]);

  const handleOpenDetail = useCallback(async (entry: MarketSkillEntry) => {
    setSelectedEntry(entry);
    setSelectedDetail(null);
    if (!entry.marketId) return;

    setDetailLoading(true);
    try {
      const detail = await api.getMarketSkillDetail(entry.marketId, entry.filePath);
      setSelectedDetail(detail);
    } catch (error) {
      const detail = error instanceof Error ? error.message : t('agent.marketplace.detailFailed');
      void message.error(detail);
    } finally {
      setDetailLoading(false);
    }
  }, [message, t]);

  const closeDetail = () => {
    setSelectedEntry(null);
    setSelectedDetail(null);
  };

  const renderContent = () => {
    if (loading) {
      return (
        <Flexbox align="center" justify="center" style={{ minHeight: 220 }}>
          <Spin />
        </Flexbox>
      );
    }

    if (catalogError) {
      return (
        <Alert
          action={(
            <Button size="small" onClick={reloadCatalog}>
              {t('agent.marketplace.retry')}
            </Button>
          )}
          description={catalogError instanceof Error ? catalogError.message : undefined}
          message={t('agent.marketplace.loadFailed')}
          showIcon
          type="error"
        />
      );
    }

    if (markets.length === 0) {
      return (
        <Flexbox align="center" gap={12} style={{ paddingBlock: 40 }}>
          <Empty description={t('agent.marketplace.noMarketSource')} />
          <Button icon={<Plus size={14} />} onClick={() => setAddSourceOpen(true)}>
            {t('agent.marketplace.addSource')}
          </Button>
        </Flexbox>
      );
    }

    if (filteredPackages.length === 0) {
      return (
        <Empty
          description={search
            ? t('agent.marketplace.noResults')
            : t('agent.marketplace.noPackagesForTab')}
        />
      );
    }

    return (
      <Flexbox gap={token.marginLG}>
        <Flexbox horizontal wrap="wrap" gap={token.marginMD}>
          {visiblePackages.map((entry) => (
            <MarketplacePackageCard
              key={`${entry.marketId}-${entry.filePath}`}
              entry={entry}
              onInstall={handleInstall}
              onOpen={handleOpenDetail}
              onUninstall={handleUninstall}
            />
          ))}
        </Flexbox>
        {visiblePackages.length < filteredPackages.length && (
          <Flexbox align="center">
            <Button onClick={() => setVisibleLimit((limit) => limit + PACKAGE_BATCH_SIZE)}>
              {t('agent.marketplace.loadMore', {
                shown: visiblePackages.length,
                total: filteredPackages.length,
              })}
            </Button>
          </Flexbox>
        )}
      </Flexbox>
    );
  };

  const detail = selectedDetail || selectedEntry;
  const detailPackageType = detail?.packageType || 'skill';

  return (
    <Flexbox
      gap={token.marginLG}
      padding={token.paddingLG}
      style={{ height: '100%', overflow: 'auto' }}
    >
      <Flexbox horizontal align="center" justify="space-between" wrap="wrap" gap={12}>
        <Flexbox gap={4}>
          <h2 style={{ margin: 0, fontSize: token.fontSizeHeading4, color: token.colorText }}>
            {t('agent.marketplace.title')}
          </h2>
          <span style={{ color: token.colorTextSecondary, fontSize: token.fontSizeSM }}>
            {t('agent.marketplace.summary', {
              packages: packages.length,
              sources: markets.length,
            })}
          </span>
        </Flexbox>
        <Flexbox horizontal gap={8}>
          <Button
            icon={<RefreshCw size={14} />}
            loading={syncing}
            onClick={handleSyncAll}
          >
            {t('agent.marketplace.sync')}
          </Button>
          <Button
            icon={<Plus size={14} />}
            type="primary"
            onClick={() => setAddSourceOpen(true)}
          >
            {t('agent.marketplace.addSource')}
          </Button>
        </Flexbox>
      </Flexbox>

      {markets.length > 0 && (
        <Flexbox horizontal wrap="wrap" gap={6}>
          {markets.map((market) => (
            <Tag
              key={market.id}
              color={market.error ? 'error' : market.synced ? 'success' : 'default'}
              title={market.error || market.url}
              style={{ margin: 0 }}
            >
              {market.name} · {market.skillCount}
            </Tag>
          ))}
        </Flexbox>
      )}

      {catalog && catalog.failedSources > 0 && (
        <Alert
          message={t('agent.marketplace.partialLoadFailed', {
            count: catalog.failedSources,
          })}
          showIcon
          type="warning"
        />
      )}

      <Flexbox horizontal gap={token.marginMD} align="center" justify="space-between" wrap="wrap">
        <Segmented
          options={tabOptions}
          value={activeTab}
          onChange={(value) => {
            setActiveTab(value as TabKey);
            setVisibleLimit(PACKAGE_BATCH_SIZE);
          }}
        />
        <SearchBar
          allowClear
          enableShortKey={false}
          placeholder={t('agent.marketplace.search')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setVisibleLimit(PACKAGE_BATCH_SIZE);
          }}
          style={{ width: 260 }}
        />
      </Flexbox>

      <Flexbox style={{ flex: 1, minHeight: 0 }}>
        {renderContent()}
      </Flexbox>

      <Modal
        title={t('agent.marketplace.addSource')}
        open={addSourceOpen}
        confirmLoading={addingSource}
        okText={t('agent.marketplace.addAndSync')}
        onCancel={() => setAddSourceOpen(false)}
        onOk={handleAddSource}
      >
        <Flexbox gap={12} style={{ paddingBlock: 12 }}>
          <Input
            autoFocus
            placeholder={t('agent.marketplace.sourceUrl')}
            value={sourceUrl}
            onChange={(event) => {
              const value = event.target.value;
              setSourceUrl(value);
              if (!sourceName.trim()) setSourceName(defaultNameFromUrl(value));
            }}
          />
          <Input
            placeholder={t('agent.marketplace.sourceName')}
            value={sourceName}
            onChange={(event) => setSourceName(event.target.value)}
          />
          <Input
            placeholder={t('agent.marketplace.sourceBranch')}
            value={sourceBranch}
            onChange={(event) => setSourceBranch(event.target.value)}
          />
        </Flexbox>
      </Modal>

      <Modal
        width={720}
        title={detail?.name}
        open={Boolean(selectedEntry)}
        onCancel={closeDetail}
        footer={[
          <Button key="close" onClick={closeDetail}>
            {t('agent.marketplace.close')}
          </Button>,
          detail?.installed ? (
            <Button
              key="uninstall"
              danger
              onClick={() => detail && void handleUninstall(detail)}
            >
              {t('agent.marketplace.uninstall')}
            </Button>
          ) : (
            <Button
              key="install"
              type="primary"
              onClick={() => detail && void handleInstall(detail)}
            >
              {t('agent.marketplace.install')}
            </Button>
          ),
        ]}
      >
        {detailLoading ? (
          <Flexbox align="center" justify="center" style={{ minHeight: 180 }}>
            <Spin />
          </Flexbox>
        ) : detail ? (
          <Flexbox gap={16}>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label={t('agent.marketplace.detail.packageType')}>
                {t(`agent.marketplace.packageType.${detailPackageType}`)}
              </Descriptions.Item>
              <Descriptions.Item label={t('agent.marketplace.detail.version')}>
                {detail.version || '1'}
              </Descriptions.Item>
              <Descriptions.Item label={t('agent.marketplace.detail.publisher')}>
                {selectedDetail?.publisher
                  || detail.author
                  || t('agent.marketplace.unknownPublisher')}
              </Descriptions.Item>
              <Descriptions.Item label={t('agent.marketplace.detail.license')}>
                {detail.license || t('agent.marketplace.notProvided')}
              </Descriptions.Item>
              <Descriptions.Item label={t('agent.marketplace.detail.trust')}>
                {detail.trustLevel || t('agent.marketplace.trust.community')}
              </Descriptions.Item>
              <Descriptions.Item label={t('agent.marketplace.detail.risk')}>
                {detail.riskLevel || t('agent.marketplace.risk.unknown')}
              </Descriptions.Item>
              <Descriptions.Item label={t('agent.marketplace.detail.source')} span={2}>
                {selectedDetail?.repository || detail.source || detail.filePath}
              </Descriptions.Item>
              {detail.scanVerdict && (
                <Descriptions.Item label={t('agent.marketplace.detail.scan')} span={2}>
                  {detail.scanVerdict}
                </Descriptions.Item>
              )}
            </Descriptions>
            {selectedDetail?.content && (
              <Flexbox gap={6}>
                <strong>{t('agent.marketplace.detail.content')}</strong>
                <pre
                  style={{
                    maxHeight: 280,
                    margin: 0,
                    padding: 12,
                    overflow: 'auto',
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusSM,
                    background: token.colorFillQuaternary,
                    color: token.colorText,
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {selectedDetail.content}
                </pre>
              </Flexbox>
            )}
          </Flexbox>
        ) : null}
      </Modal>
    </Flexbox>
  );
});

MarketplacePage.displayName = 'MarketplacePage';
