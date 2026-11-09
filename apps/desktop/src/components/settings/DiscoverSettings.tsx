import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Drawer,
  Dialog,
  Empty,
  Icon,
  Segmented,
  Spin,
  Tag,
  Text,
  TextField,
  TextArea,
  type Tone,
} from '@peers-touch/ui';

import { api } from '../../services/desktop_api';
import type {
  MarketSkillDetail,
  MarketSkillEntry,
  MarketSummary,
} from '../../services/desktop_api';
import { usePrefetch } from '../../kernel/usePrefetch';
import { PageColumn } from '../../layout/PageColumn';
import { MarketplacePackageCard } from './discover/PackageCard';
import {
  confirmRequest,
  notifyError,
  notifyInfo,
  notifySuccess,
} from '../../ui/feedback';

type TabKey = 'agents' | 'skills' | 'tools';
const PACKAGE_BATCH_SIZE = 24;

interface MarketplaceCatalog {
  failedSources: number;
  markets: MarketSummary[];
  packages: MarketSkillEntry[];
}

async function loadSourcePackages(marketId: string): Promise<MarketSkillEntry[]> {
  const packages: MarketSkillEntry[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await api.listMarketSkills(marketId, undefined, cursor, PACKAGE_BATCH_SIZE);
    packages.push(...page.skills);
    cursor = page.nextCursor;
    if (cursor && !seenCursors.add(cursor)) {
      throw new Error('marketplace pagination cursor repeated');
    }
    if (packages.length > 500) {
      throw new Error('marketplace package limit exceeded');
    }
  } while (cursor);
  return packages;
}

async function loadMarketplaceCatalog(): Promise<MarketplaceCatalog> {
  const markets = await api.listSkillMarkets();
  const results = await Promise.allSettled(
    markets
      .filter((source) => source.synced)
      .map((source) => loadSourcePackages(source.id)),
  );

  return {
    failedSources: results.filter((result) => result.status === 'rejected').length,
    markets,
    packages: results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
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

export const DiscoverSettings = memo(() => {
  const { t } = useTranslation('agent');

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
  const [sourceId, setSourceId] = useState('');
  const [sourcePublisherId, setSourcePublisherId] = useState('');
  const [sourceSigningKeyId, setSourceSigningKeyId] = useState('');
  const [sourcePublicKey, setSourcePublicKey] = useState('');
  const [sourceManifestPath, setSourceManifestPath] = useState(
    'packages/agent-catalog/official-catalog.v1.envelope.json',
  );
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
        label: (
          <span data-testid="marketplace-tab-agents" className="sc-discover-tab">
            <Icon iconId="bot" size={14} />
            {t('agent.marketplace.tabs.agents')}
          </span>
        ),
        value: 'agents' as TabKey,
      },
      {
        label: (
          <span data-testid="marketplace-tab-skills" className="sc-discover-tab">
            <Icon iconId="puzzle" size={14} />
            {t('agent.marketplace.tabs.skills')}
          </span>
        ),
        value: 'skills' as TabKey,
      },
      {
        label: (
          <span data-testid="marketplace-tab-tools" className="sc-discover-tab">
            <Icon iconId="wrench" size={14} />
            {t('agent.marketplace.tabs.tools')}
          </span>
        ),
        value: 'tools' as TabKey,
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
      const failed = results.filter(
        (result) => result.status === 'rejected' || result.value.stale,
      ).length;
      reloadCatalog();
      if (failed > 0) {
        notifyInfo(t('agent.marketplace.syncPartial', {
          failed,
          total: markets.length,
        }));
      } else {
        notifySuccess(t('agent.marketplace.syncSuccess'));
      }
    } finally {
      setSyncing(false);
    }
  }, [markets, reloadCatalog, t]);

  const resetSourceForm = () => {
    setSourceUrl('');
    setSourceName('');
    setSourceBranch('main');
    setSourceId('');
    setSourcePublisherId('');
    setSourceSigningKeyId('');
    setSourcePublicKey('');
    setSourceManifestPath(
      'packages/agent-catalog/official-catalog.v1.envelope.json',
    );
  };

  const handleAddSource = useCallback(async () => {
    const url = sourceUrl.trim();
    if (
      !url
      || !sourceId.trim()
      || !sourcePublisherId.trim()
      || !sourceSigningKeyId.trim()
      || !sourcePublicKey.trim()
      || !sourceManifestPath.trim()
    ) {
      notifyInfo(t('agent.marketplace.sourceUrlRequired'));
      return;
    }

    setAddingSource(true);
    let sourceAdded = false;
    try {
      const result = await api.addSkillMarketSource(
        url,
        sourceName.trim() || defaultNameFromUrl(url),
        sourceBranch.trim() || 'main',
        {
          sourceId: sourceId.trim(),
          publisherId: sourcePublisherId.trim(),
          signingKeyId: sourceSigningKeyId.trim(),
          publicKeyBase64: sourcePublicKey.trim(),
          manifestPath: sourceManifestPath.trim(),
        },
      );
      if (!('id' in result) || typeof result.id !== 'string' || !result.id) {
        throw new Error(t('agent.marketplace.addSourceFailed'));
      }
      sourceAdded = true;
      await api.syncSkillMarket(result.id);
      notifySuccess(t('agent.marketplace.addSourceSuccess'));
    } catch (error) {
      const fallbackKey = sourceAdded
        ? 'agent.marketplace.addedButSyncFailed'
        : 'agent.marketplace.addSourceFailed';
      const detail = error instanceof Error ? error.message : t(fallbackKey);
      notifyError(detail);
    } finally {
      if (sourceAdded) {
        setAddSourceOpen(false);
        resetSourceForm();
        reloadCatalog();
      }
      setAddingSource(false);
    }
  }, [
    reloadCatalog,
    sourceBranch,
    sourceId,
    sourceManifestPath,
    sourceName,
    sourcePublicKey,
    sourcePublisherId,
    sourceSigningKeyId,
    sourceUrl,
    t,
  ]);

  const handleInstall = useCallback(async (entry: MarketSkillEntry) => {
    if (!entry.marketId) return;
    if (entry.installPolicy === 'blocked' || entry.revoked) {
      notifyError(t('agent.marketplace.installBlocked'));
      return;
    }
    let riskAcknowledged = false;
    if (entry.installPolicy === 'confirmation_required') {
      riskAcknowledged = await confirmRequest({
        tone: 'danger',
        title: t('agent.marketplace.riskConfirmTitle'),
        description: t('agent.marketplace.riskConfirmDescription', {
          name: entry.name,
          risk: entry.riskLevel || t('agent.marketplace.risk.unknown'),
        }),
        confirmLabel: t('agent.marketplace.install'),
        cancelLabel: t('agent.settings.cancel'),
      });
      if (!riskAcknowledged) return;
    }
    try {
      await api.installMarketSkill(entry.marketId, entry.filePath, riskAcknowledged);
      notifySuccess(t('agent.marketplace.installSuccess'));
      setSelectedEntry(null);
      setSelectedDetail(null);
      reloadCatalog();
    } catch (error) {
      const detail = error instanceof Error ? error.message : t('agent.marketplace.installFailed');
      notifyError(detail);
    }
  }, [reloadCatalog, t]);

  const handleUninstall = useCallback(async (entry: MarketSkillEntry) => {
    if (!entry.marketId) return;
    try {
      await api.uninstallMarketSkill(entry.marketId, entry.filePath);
      notifySuccess(t('agent.marketplace.uninstallSuccess'));
      setSelectedEntry(null);
      setSelectedDetail(null);
      reloadCatalog();
    } catch (error) {
      const detail = error instanceof Error ? error.message : t('agent.marketplace.uninstallFailed');
      notifyError(detail);
    }
  }, [reloadCatalog, t]);

  const handleRemoveSource = useCallback((market: MarketSummary) => {
    if (market.builtIn) return;
    void confirmRequest({
      tone: 'danger',
      title: t('agent.marketplace.removeSourceTitle'),
      description: t('agent.marketplace.removeSourceDescription', { name: market.name }),
      confirmLabel: t('agent.marketplace.removeSource'),
      cancelLabel: t('agent.settings.cancel'),
      onConfirm: async () => {
        try {
          await api.removeSkillMarketSource(market.id);
          reloadCatalog();
        } catch (error) {
          const detail = error instanceof Error
            ? error.message
            : t('agent.marketplace.removeSourceFailed');
          notifyError(detail);
          throw error;
        }
      },
    });
  }, [reloadCatalog, t]);

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
      notifyError(detail);
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  const closeDetail = () => {
    setSelectedEntry(null);
    setSelectedDetail(null);
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="sc-discover-loading">
          <Spin />
        </div>
      );
    }

    if (catalogError) {
      return (
        <Alert
          tone="danger"
          title={t('agent.marketplace.loadFailed')}
          description={catalogError instanceof Error ? catalogError.message : undefined}
          action={(
            <Button
              actionId="marketplace-retry"
              density="compact"
              label={t('agent.marketplace.retry')}
              onActivate={reloadCatalog}
            />
          )}
        />
      );
    }

    if (markets.length === 0) {
      return (
        <div className="sc-discover-empty">
          <Empty
            icon={<Icon iconId="store" size={40} />}
            description={t('agent.marketplace.noMarketSource')}
            action={(
              <Button
                actionId="marketplace-add-first-source"
                leading={<Icon iconId="plus" size={14} />}
                label={t('agent.marketplace.addSource')}
                onActivate={() => setAddSourceOpen(true)}
              />
            )}
          />
        </div>
      );
    }

    if (filteredPackages.length === 0) {
      return (
        <div className="sc-discover-empty">
          <Empty
            icon={<Icon iconId="search" size={40} />}
            description={search
              ? t('agent.marketplace.noResults')
              : t('agent.marketplace.noPackagesForTab')}
          />
        </div>
      );
    }

    return (
      <div className="sc-discover-content">
        <div className="sc-discover-grid">
          {visiblePackages.map((entry) => (
            <MarketplacePackageCard
              key={`${entry.marketId}-${entry.filePath}`}
              entry={entry}
              onInstall={handleInstall}
              onOpen={handleOpenDetail}
              onUninstall={handleUninstall}
            />
          ))}
        </div>
        {visiblePackages.length < filteredPackages.length && (
          <div className="sc-discover-load-more">
            <Button
              actionId="marketplace-load-more"
              label={t('agent.marketplace.loadMore', {
                shown: visiblePackages.length,
                total: filteredPackages.length,
              })}
              onActivate={() => setVisibleLimit((limit) => limit + PACKAGE_BATCH_SIZE)}
            />
          </div>
        )}
      </div>
    );
  };

  const detail = selectedDetail || selectedEntry;
  const detailPackageType = detail?.packageType || 'skill';

  const detailRows: { label: string; value: React.ReactNode; full?: boolean }[] = detail ? [
    {
      label: t('agent.marketplace.detail.packageType'),
      value: t(`agent.marketplace.packageType.${detailPackageType}`),
    },
    { label: t('agent.marketplace.detail.version'), value: detail.version || '1' },
    {
      label: t('agent.marketplace.detail.publisher'),
      value: selectedDetail?.publisher || detail.author || t('agent.marketplace.unknownPublisher'),
    },
    {
      label: t('agent.marketplace.detail.license'),
      value: detail.license || t('agent.marketplace.notProvided'),
    },
    {
      label: t('agent.marketplace.detail.trust'),
      value: detail.trustLevel || t('agent.marketplace.trust.unknown'),
    },
    {
      label: t('agent.marketplace.detail.risk'),
      value: detail.riskLevel || t('agent.marketplace.risk.unknown'),
    },
    {
      label: t('agent.marketplace.detail.source'),
      value: selectedDetail?.repository || detail.source || detail.filePath,
      full: true,
    },
    {
      label: t('agent.marketplace.detail.signature'),
      value: detail.signatureStatus || t('agent.marketplace.signature.invalid'),
    },
    {
      label: t('agent.marketplace.detail.policy'),
      value: t(`agent.marketplace.policy.${detail.installPolicy || 'blocked'}`),
    },
  ] : [];

  return (
    <div className="sc-discover" data-testid="marketplace-page">
      <PageColumn tier="standard">
        <div className="sc-discover-column">
        <div className="sc-discover-header">
          <div className="sc-discover-header__text">
            <h2 className="sc-discover-title">{t('agent.marketplace.title')}</h2>
            <span className="sc-discover-summary">
              {t('agent.marketplace.summary', {
                packages: packages.length,
                sources: markets.length,
              })}
            </span>
          </div>
          <div className="sc-discover-header__actions">
            <Button
              actionId="marketplace-sync"
              leading={<Icon iconId="refresh-cw" size={14} />}
              execution={syncing ? 'pending' : 'idle'}
              label={t('agent.marketplace.sync')}
              onActivate={() => void handleSyncAll()}
            />
            <Button
              actionId="marketplace-add-source"
              emphasis="primary"
              leading={<Icon iconId="plus" size={14} />}
              label={t('agent.marketplace.addSource')}
              onActivate={() => setAddSourceOpen(true)}
            />
          </div>
        </div>

        {markets.length > 0 && (
          <div className="sc-discover-sources">
            {markets.map((market) => {
              let tone: Tone = 'neutral';
              if (market.revoked || market.signatureStatus === 'invalid') tone = 'danger';
              else if (market.stale) tone = 'warning';
              else if (market.synced) tone = 'success';
              return (
                <Tag
                  key={market.id}
                  tone={tone}
                  data-testid={`marketplace-source-${market.id}`}
                  title={[
                    market.url,
                    market.branch,
                    market.catalogRevision,
                    market.publicKeyFingerprint,
                    market.error,
                  ].filter(Boolean).join('\n')}
                  leading={market.signatureStatus === 'verified'
                    ? <Icon iconId="shield-check" size={10} />
                    : undefined}
                  onDismiss={market.builtIn ? undefined : () => handleRemoveSource(market)}
                  dismissLabel={t('agent.marketplace.removeSource')}
                >
                  {market.name} · {market.skillCount} · {market.trustLevel}
                </Tag>
              );
            })}
          </div>
        )}

        {catalog && catalog.failedSources > 0 && (
          <Alert
            tone="warning"
            title={t('agent.marketplace.partialLoadFailed', {
              count: catalog.failedSources,
            })}
          />
        )}

        <div className="sc-discover-toolbar">
          <Segmented<TabKey>
            density="compact"
            options={tabOptions}
            value={activeTab}
            onValueChange={(value) => {
              if (value === 'agents' || value === 'skills' || value === 'tools') {
                setActiveTab(value);
                setVisibleLimit(PACKAGE_BATCH_SIZE);
              }
            }}
          />
          <TextField
            className="sc-discover-search"
            clearable
            leading={<Icon iconId="search" size={14} />}
            placeholder={t('agent.marketplace.search')}
            value={search}
            onValueChange={(value) => {
              setSearch(value);
              setVisibleLimit(PACKAGE_BATCH_SIZE);
            }}
          />
        </div>

        <div className="sc-discover-stage">
          {renderContent()}
        </div>

        <Dialog
          open={addSourceOpen}
          onDismiss={() => setAddSourceOpen(false)}
          title={t('agent.marketplace.addSource')}
          width={520}
          footer={(
            <Button
              actionId="marketplace-add-and-sync"
              emphasis="primary"
              execution={addingSource ? 'pending' : 'idle'}
              label={t('agent.marketplace.addAndSync')}
              onActivate={() => void handleAddSource()}
            />
          )}
        >
          <div className="sc-discover-source-form">
            <TextField
              autoFocus
              placeholder={t('agent.marketplace.sourceUrl')}
              value={sourceUrl}
              onValueChange={(value) => {
                setSourceUrl(value);
                if (!sourceName.trim()) setSourceName(defaultNameFromUrl(value));
              }}
            />
            <TextField
              placeholder={t('agent.marketplace.sourceName')}
              value={sourceName}
              onValueChange={setSourceName}
            />
            <TextField
              placeholder={t('agent.marketplace.sourceId')}
              value={sourceId}
              onValueChange={setSourceId}
            />
            <TextField
              placeholder={t('agent.marketplace.sourceBranch')}
              value={sourceBranch}
              onValueChange={setSourceBranch}
            />
            <TextField
              placeholder={t('agent.marketplace.sourceManifestPath')}
              value={sourceManifestPath}
              onValueChange={setSourceManifestPath}
            />
            <TextField
              placeholder={t('agent.marketplace.sourcePublisherId')}
              value={sourcePublisherId}
              onValueChange={setSourcePublisherId}
            />
            <TextField
              placeholder={t('agent.marketplace.sourceSigningKeyId')}
              value={sourceSigningKeyId}
              onValueChange={setSourceSigningKeyId}
            />
            <TextArea
              rows={3}
              placeholder={t('agent.marketplace.sourcePublicKey')}
              value={sourcePublicKey}
              onValueChange={setSourcePublicKey}
            />
          </div>
        </Dialog>

        <Drawer
          width={720}
          title={detail?.name}
          open={Boolean(selectedEntry)}
          onDismiss={closeDetail}
          extra={detail?.installed ? (
            <Button
              actionId="marketplace-detail-uninstall"
              tone="danger"
              label={t('agent.marketplace.uninstall')}
              onActivate={() => detail && void handleUninstall(detail)}
            />
          ) : (
            <Button
              actionId="marketplace-detail-install"
              emphasis="primary"
              label={t('agent.marketplace.install')}
              availability={(detail?.installPolicy === 'blocked' || detail?.revoked)
                ? { kind: 'disabled', reason: t('agent.marketplace.installBlocked') }
                : undefined}
              onActivate={() => detail && void handleInstall(detail)}
            />
          )}
        >
          {detailLoading ? (
            <div className="sc-discover-loading">
              <Spin />
            </div>
          ) : detail ? (
            <div
              className="sc-discover-detail"
              data-package-id={detail.identifier}
              data-testid="marketplace-package-detail"
            >
              <dl className="sc-discover-descriptions">
                {detailRows.map((row) => (
                  <div
                    key={row.label}
                    className={`sc-discover-descriptions__item${row.full ? ' is-full' : ''}`}
                  >
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
                {detail.contentHash && (
                  <div className="sc-discover-descriptions__item is-full">
                    <dt>{t('agent.marketplace.detail.digest')}</dt>
                    <dd><code className="sc-discover-digest">{detail.contentHash}</code></dd>
                  </div>
                )}
                {detail.revoked && (
                  <div className="sc-discover-descriptions__item is-full">
                    <dt>{t('agent.marketplace.detail.revocation')}</dt>
                    <dd>
                      <Tag tone="danger">{t('agent.marketplace.revoked')}</Tag>
                      {detail.revokedAt}
                    </dd>
                  </div>
                )}
                {detail.scanVerdict && (
                  <div className="sc-discover-descriptions__item is-full">
                    <dt>{t('agent.marketplace.detail.scan')}</dt>
                    <dd>{detail.scanVerdict}</dd>
                  </div>
                )}
                {detail.installed && detail.targetAuthority && (
                  <div className="sc-discover-descriptions__item is-full">
                    <dt>{t('agent.marketplace.detail.authority')}</dt>
                    <dd>{detail.targetAuthority}</dd>
                  </div>
                )}
              </dl>
              {selectedDetail?.content && (
                <div className="sc-discover-content-pre">
                  <Text strong>{t('agent.marketplace.detail.content')}</Text>
                  <pre className="sc-discover-pre">{selectedDetail.content}</pre>
                </div>
              )}
            </div>
          ) : null}
        </Drawer>
        </div>
      </PageColumn>
    </div>
  );
});

DiscoverSettings.displayName = 'DiscoverSettings';
