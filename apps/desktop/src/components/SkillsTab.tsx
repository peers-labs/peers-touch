import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { log } from '@/utils/logger';
import {
  Alert,
  Button,
  Card,
  ConfirmAction,
  Dialog,
  Divider,
  Drawer,
  Empty,
  FilePicker,
  Flex,
  Icon,
  IconButton,
  Progress,
  Segmented,
  Select,
  Spin,
  Switch,
  Tag,
  Text,
  TextArea,
  TextField,
  Tooltip,
  type Tone,
} from '@peers-touch/ui';
import { LazyMarkdown } from './LazyMarkdown';
import { useTranslation } from 'react-i18next';
import {
  api,
  type MarketSkillDetail,
  type MarketSkillEntry,
  type MarketSummary,
  type BuiltinSkillRecord,
  type SkillImportBatchResult,
  type SkillImportResult,
  type SkillListItem,
  type SkillRecord,
  type SkillResourceNode,
  type SkillVersionItem,
  type SkillZipValidation,
} from '../services/desktop_api';
import { isTextResourceReadable, skillService } from '../services/skill-service';
import { useSkillStore } from '../store/skill';
import { SettingsContainer } from './settings/SettingsLayout';
import { confirmRequest, notifyError, notifySuccess, notifyWarning } from '../ui/feedback';

function SkillAvatar({ children, size = 36, variant = 'muted' }: { children: ReactNode; size?: number; variant?: 'primary' | 'muted' }) {
  return (
    <span
      className={variant === 'primary' ? 'sc-skill-avatar sc-skill-avatar--primary' : 'sc-skill-avatar'}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {children}
    </span>
  );
}

function DetailDescriptions({ items }: { items: Array<{ label: string; node?: ReactNode }> }) {
  return (
    <dl className="sc-skill-desc">
      {items
        .filter((i) => i.node !== undefined && i.node !== null && i.node !== '')
        .map((i) => (
          <div key={i.label} className="sc-skill-desc__item">
            <dt>{i.label}</dt>
            <dd>{i.node}</dd>
          </div>
        ))}
    </dl>
  );
}

export function SkillsTab() {
  const { t } = useTranslation('provider');
  const skills = useSkillStore(s => s.skills);
  const builtins = useSkillStore(s => s.builtins);
  const loading = useSkillStore(s => s.loading);
  const error = useSkillStore(s => s.error);
  const loadSkills = useSkillStore(s => s.loadSkills);
  const toggleSkill = useSkillStore(s => s.toggleSkill);
  const deleteSkill = useSkillStore(s => s.deleteSkill);
  const [activeTab, setActiveTab] = useState('installed');
  const [query, setQuery] = useState('');

  const [importModal, setImportModal] = useState<'source' | 'create' | 'zip' | null>(null);
  const [detail, setDetail] = useState<{ kind: 'installed' | 'builtin'; key: string } | null>(null);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await toggleSkill(id, enabled);
    } catch (e: any) {
      notifyError(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSkill(id);
      notifySuccess(t('provider.skills.deleted'));
    } catch (e: any) {
      notifyError(e.message);
    }
  };

  const handleImportDone = (result: SkillImportResult | SkillImportBatchResult) => {
    if ('imported' in result) {
      notifySuccess(t('provider.skills.importedBatch', { total: result.total, kind: result.kind }));
    } else {
      notifySuccess(result.isNew ? t('provider.skills.importedSingle', { name: result.name }) : t('provider.skills.updatedSingle', { name: result.name }));
    }
    setImportModal(null);
    loadSkills();
  };

  const handleOpenDir = async () => {
    try {
      await api.openSkillsDir();
    } catch (e: any) {
      notifyError(e.message);
    }
  };

  const filteredInstalled = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) =>
      [s.name, s.identifier, s.description, s.metaTitle, ...s.metaTags].join(' ').toLowerCase().includes(q));
  }, [skills, query]);

  const filteredBuiltins = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return builtins;
    return builtins.filter((s) =>
      [s.name, s.identifier, s.description, ...s.keywords].join(' ').toLowerCase().includes(q));
  }, [builtins, query]);

  return (
    <SettingsContainer tier="standard">
      <Flex direction="row" justify="space-between" align="center">
        <Text strong style={{ fontSize: 15 }}>{t('provider.skills.title')}</Text>
        <Flex direction="row" gap={8}>
          <Button
            actionId="skills-create-open"
            density="compact"
            leading={<Icon iconId="plus" size={14} />}
            label={t('provider.skills.create')}
            onActivate={() => setImportModal('create')}
          />
          <Button
            actionId="skills-from-url"
            density="compact"
            leading={<Icon iconId="link" size={14} />}
            label={t('provider.skills.fromUrl')}
            onActivate={() => setImportModal('source')}
          />
          <Button
            actionId="skills-upload-zip"
            density="compact"
            leading={<Icon iconId="upload" size={14} />}
            label={t('provider.skills.uploadZip')}
            onActivate={() => setImportModal('zip')}
          />
        </Flex>
      </Flex>
      <TextField
        clearable
        leading={<Icon iconId="search" size={12} />}
        value={query}
        onValueChange={setQuery}
        placeholder={t('provider.skills.searchPlaceholder')}
        style={{ fontSize: 12 }}
      />
      {error && (
        <Alert tone="danger" title={t('provider.skills.operationFailed')} description={error} />
      )}

      <Segmented<string>
        value={activeTab}
        onValueChange={(value) => { if (value) setActiveTab(value); }}
        options={[
          { value: 'installed', label: t('provider.skills.tab.installed', { count: skills.length }) },
          { value: 'builtin', label: t('provider.skills.tab.builtin', { count: builtins.length }) },
          { value: 'market', label: t('provider.skills.tab.market') },
        ]}
      />

      {activeTab === 'installed' && (
        <Flex gap={12}>
          <Button
            actionId="skills-open-dir"
            emphasis="quiet"
            density="compact"
            leading={<Icon iconId="folder-open" size={14} />}
            label={t('provider.skills.openLocalDir')}
            onActivate={handleOpenDir}
          />
          {filteredInstalled.length === 0 && !loading && (
            <Empty icon={<Icon iconId="sparkles" size={32} />} description={t('provider.skills.noInstalled')} />
          )}
          {filteredInstalled.map((s) => (
            <SkillCard
              key={s.id}
              skill={s}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onDetail={() => setDetail({ kind: 'installed', key: s.id })}
            />
          ))}
        </Flex>
      )}

      {activeTab === 'builtin' && (
        <Flex gap={12}>
          {filteredBuiltins.length === 0 && !loading && (
            <Empty icon={<Icon iconId="blocks" size={32} />} description={t('provider.skills.noBuiltin')} />
          )}
          {filteredBuiltins.map((s) => (
            <Card
              key={s.identifier}
              flat
              className="sc-skill-card sc-skill-card--clickable"
              onClick={() => setDetail({ kind: 'builtin', key: s.identifier })}
            >
              <Flex direction="row" justify="space-between" align="center">
                <Flex direction="row" gap={12} align="center">
                  <span style={{ fontSize: 20 }}>{s.avatar || '📄'}</span>
                  <Flex>
                    <Text strong>{s.name}</Text>
                    <Text tone="secondary" style={{ fontSize: 12 }}>
                      {s.description || t('provider.skills.builtInSkill')}
                    </Text>
                  </Flex>
                </Flex>
                <Flex direction="row" gap={4}>
                  {s.useCount > 0 && <Tag tone="warning">{t('provider.skills.usedCount', { count: s.useCount })}</Tag>}
                  <Tag tone="info">{t('provider.skills.builtInTag')}</Tag>
                  {s.keywords.slice(0, 3).map((kw) => (
                    <Tag key={kw} style={{ fontSize: 11 }}>{kw}</Tag>
                  ))}
                </Flex>
              </Flex>
            </Card>
          ))}
        </Flex>
      )}

      {activeTab === 'market' && <MarketTab onInstalled={loadSkills} />}

      {importModal === 'source' && (
        <ImportFromAddressModal onDone={handleImportDone} onCancel={() => setImportModal(null)} />
      )}
      {importModal === 'zip' && (
        <ImportZipModal onDone={handleImportDone} onCancel={() => setImportModal(null)} />
      )}
      {importModal === 'create' && (
        <CreateSkillModal onDone={handleImportDone} onCancel={() => setImportModal(null)} />
      )}
      {detail && (
        <SkillDetailBoard detail={detail} onClose={() => { setDetail(null); loadSkills(); }} />
      )}
    </SettingsContainer>
  );
}

// ────────────────────────────────────────────────────────
// Market Tab
// ────────────────────────────────────────────────────────

function MarketTab({ onInstalled }: { onInstalled: () => void }) {
  const { t } = useTranslation('provider');
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMarket, setSelectedMarket] = useState<MarketSummary | null>(null);
  const [addModal, setAddModal] = useState(false);

  const loadMarkets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listSkillMarkets();
      setMarkets(data);
    } catch (e: any) {
      notifyError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMarkets(); }, [loadMarkets]);

  return (
    <Flex gap={16}>
      <Flex direction="row" justify="space-between" align="center">
        <Text tone="secondary">{t('provider.skills.market.browseDesc')}</Text>
        <Button
          actionId="skills-market-add"
          density="compact"
          leading={<Icon iconId="plus" size={14} />}
          label={t('provider.skills.market.addMarket')}
          onActivate={() => setAddModal(true)}
        />
      </Flex>

      {loading && markets.length === 0 && <Flex align="center" justify="center" style={{ padding: 48 }}><Spin active /></Flex>}

      <div className="sc-skill-market-grid">
        {markets.map((m) => (
          <MarketCard
            key={m.id}
            market={m}
            onClick={() => setSelectedMarket(m)}
            onDelete={async () => {
              try {
                await api.removeSkillMarketSource(m.id);
                loadMarkets();
              } catch (e: any) {
                notifyError(e.message);
              }
            }}
          />
        ))}
        {!loading && markets.length === 0 && (
          <Empty
            className="sc-skill-market-empty"
            icon={<Icon iconId="store" size={32} />}
            description={t('provider.skills.market.noMarkets')}
          />
        )}
      </div>

      {selectedMarket && (
        <MarketBrowserDialog
          market={selectedMarket}
          onClose={() => { setSelectedMarket(null); loadMarkets(); }}
          onInstalled={onInstalled}
        />
      )}

      {addModal && (
        <AddMarketModal onDone={() => { setAddModal(false); loadMarkets(); }} onCancel={() => setAddModal(false)} />
      )}
    </Flex>
  );
}

function MarketCard({
  market,
  onClick,
  onDelete,
}: {
  market: MarketSummary;
  onClick: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('provider');
  const [syncing, setSyncing] = useState(false);

  const handleSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSyncing(true);
    try {
      const result = await api.syncSkillMarket(market.id);
      notifySuccess(t('provider.skills.market.synced', { total: result.total }));
    } catch (err: any) {
      notifyError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card flat className="sc-skill-market-card" onClick={onClick}>
      <Flex gap={8} style={{ flex: 1 }}>
        <Flex direction="row" justify="space-between" align="flex-start">
          <Flex direction="row" gap={10} align="center">
            <SkillAvatar size={36} variant="primary">{market.name.charAt(0).toUpperCase()}</SkillAvatar>
            <Flex>
              <Text strong style={{ fontSize: 14 }}>{market.name}</Text>
              <Flex direction="row" gap={6} align="center" style={{ marginTop: 2 }}>
                <Tag tone={market.synced ? 'success' : 'neutral'}>
                  {market.synced ? t('provider.skills.market.syncedStatus') : t('provider.skills.market.notSynced')}
                </Tag>
                {market.synced && (
                  <Text tone="secondary" style={{ fontSize: 12 }}>
                    {t('provider.skills.market.skillCount', { count: market.skillCount })}
                  </Text>
                )}
              </Flex>
            </Flex>
          </Flex>
          <Flex direction="row" gap={4} onClick={(e) => e.stopPropagation()}>
            <Tooltip label={t('provider.skills.market.sync')}>
              <IconButton
                actionId={`skill-market-sync-${market.id}`}
                iconId="refresh-cw"
                iconSize={14}
                density="compact"
                emphasis="quiet"
                execution={syncing ? 'pending' : 'idle'}
                label={t('provider.skills.market.sync')}
                onActivate={handleSync}
              />
            </Tooltip>
            {!market.builtIn && (
              <ConfirmAction
                actionId={`skill-market-remove-${market.id}`}
                title={t('provider.skills.market.removeConfirm')}
                confirmLabel={t('common.action.delete', { ns: 'common' })}
                cancelLabel={t('common.action.cancel', { ns: 'common' })}
                onConfirm={onDelete}
              >
                <IconButton
                  actionId={`skill-market-remove-trigger-${market.id}`}
                  iconId="delete"
                  iconSize={14}
                  density="compact"
                  emphasis="quiet"
                  tone="danger"
                  label={t('provider.skills.market.removeConfirm')}
                />
              </ConfirmAction>
            )}
          </Flex>
        </Flex>
        <Text tone="secondary" className="sc-skill-market-url" title={market.url}>{market.url}</Text>
        <Flex direction="row" gap={4} wrap="wrap">
          <Tag tone={market.signatureStatus === 'verified' ? 'success' : 'danger'}>{market.signatureStatus}</Tag>
          <Tag>{market.trustLevel}</Tag>
          {market.stale && <Tag tone="warning">{t('provider.skills.market.stale')}</Tag>}
          {market.revoked && <Tag tone="danger">{t('provider.skills.market.revoked')}</Tag>}
        </Flex>
        {market.error && (
          <Text tone="danger" style={{ fontSize: 11 }}>{market.error}</Text>
        )}
      </Flex>
    </Card>
  );
}

function defaultNameFromUrl(url: string): string {
  const u = url.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const idx = u.lastIndexOf('/');
  return idx >= 0 ? u.slice(idx + 1) : u;
}

function AddMarketModal({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation('provider');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('main');
  const [branchCustom, setBranchCustom] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [publisherId, setPublisherId] = useState('');
  const [signingKeyId, setSigningKeyId] = useState('');
  const [publicKeyBase64, setPublicKeyBase64] = useState('');
  const [manifestPath, setManifestPath] = useState(
    'packages/agent-catalog/official-catalog.v1.envelope.json',
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (url.trim()) {
      setName((n) => (n ? n : defaultNameFromUrl(url)));
    }
  }, [url]);

  const handleOk = async () => {
    if (
      !url.trim()
      || !sourceId.trim()
      || !publisherId.trim()
      || !signingKeyId.trim()
      || !publicKeyBase64.trim()
      || !manifestPath.trim()
    ) {
      notifyWarning(t('provider.skills.market.add.urlRequired'));
      return;
    }
    setLoading(true);
    try {
      const br = branch === 'custom' ? branchCustom.trim() || 'main' : branch;
      await api.addSkillMarketSource(url.trim(), name.trim() || undefined, br || undefined, {
        sourceId: sourceId.trim(),
        manifestPath: manifestPath.trim(),
        publisherId: publisherId.trim(),
        signingKeyId: signingKeyId.trim(),
        publicKeyBase64: publicKeyBase64.trim(),
      });
      notifySuccess(t('provider.skills.market.add.success'));
      onDone();
    } catch (e: any) {
      notifyError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open
      onDismiss={onCancel}
      title={t('provider.skills.market.add.title')}
      width={560}
      closeLabel={t('common.action.cancel', { ns: 'common' })}
      footer={
        <>
          <Button actionId="skill-market-add-cancel" emphasis="quiet" label={t('common.action.cancel', { ns: 'common' })} onActivate={onCancel} />
          <Button actionId="skill-market-add-ok" emphasis="primary" execution={loading ? 'pending' : 'idle'} label={t('provider.skills.market.add.ok')} onActivate={() => void handleOk()} />
        </>
      }
    >
      <div className="sc-provider-form">
        <Text tone="secondary">{t('provider.skills.market.add.desc')}</Text>
        <TextField autoFocus placeholder={t('provider.skills.market.add.urlPlaceholder')} value={url} onValueChange={setUrl} />
        <TextField placeholder={t('provider.skills.market.add.namePlaceholder')} value={name} onValueChange={setName} />
        <TextField placeholder={t('provider.skills.market.add.sourceIdPlaceholder')} value={sourceId} onValueChange={setSourceId} />
        <Flex direction="row" gap={8} align="center">
          <Text tone="secondary" style={{ fontSize: 12 }}>{t('provider.skills.market.add.branch')}</Text>
          <Select<string>
            value={branch}
            style={{ minWidth: 120 }}
            options={[
              { value: 'main', label: 'main' },
              { value: 'master', label: 'master' },
              { value: 'custom', label: t('provider.skills.market.add.custom') },
            ]}
            onValueChange={(value) => { if (typeof value === 'string') setBranch(value); }}
          />
          {branch === 'custom' && (
            <TextField
              style={{ flex: 1 }}
              placeholder={t('provider.skills.market.add.branchPlaceholder')}
              value={branchCustom}
              onValueChange={setBranchCustom}
            />
          )}
        </Flex>
        <TextField placeholder={t('provider.skills.market.add.manifestPathPlaceholder')} value={manifestPath} onValueChange={setManifestPath} />
        <TextField placeholder={t('provider.skills.market.add.publisherPlaceholder')} value={publisherId} onValueChange={setPublisherId} />
        <TextField placeholder={t('provider.skills.market.add.signingKeyPlaceholder')} value={signingKeyId} onValueChange={setSigningKeyId} />
        <TextArea
          rows={2}
          placeholder={t('provider.skills.market.add.publicKeyPlaceholder')}
          value={publicKeyBase64}
          onValueChange={setPublicKeyBase64}
        />
      </div>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────
// Market Browser Drawer
// ────────────────────────────────────────────────────────

function MarketBrowserDialog({
  market,
  onClose,
  onInstalled,
}: {
  market: MarketSummary;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const { t } = useTranslation('provider');
  const [skills, setSkills] = useState<MarketSkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<MarketSkillEntry | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const packages: MarketSkillEntry[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const result = await api.listMarketSkills(market.id, searchQuery || undefined, cursor, 100);
        packages.push(...(result.skills || []));
        cursor = result.nextCursor;
        if (cursor && !seenCursors.add(cursor)) {
          throw new Error('marketplace pagination cursor repeated');
        }
        if (packages.length > 500) {
          throw new Error('marketplace package limit exceeded');
        }
      } while (cursor);
      setSkills(packages);
    } catch (e: any) {
      notifyError(e.message);
    } finally {
      setLoading(false);
    }
  }, [market.id, searchQuery]);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const installEntry = async (entry: MarketSkillEntry, requireConfirm: boolean) => {
    setInstalling(entry.filePath);
    try {
      await api.installMarketSkill(market.id, entry.filePath, requireConfirm);
      notifySuccess(t('provider.skills.market.installSuccess', { name: entry.name }));
      onInstalled();
      await loadSkills();
    } catch (e: any) {
      notifyError(e.message);
    } finally {
      setInstalling(null);
    }
  };

  const handleInstall = async (entry: MarketSkillEntry) => {
    if (entry.installPolicy === 'blocked' || entry.revoked) {
      notifyError(t('provider.skills.market.installBlocked'));
      return;
    }
    if (entry.installPolicy === 'confirmation_required') {
      void confirmRequest({
        tone: 'danger',
        title: t('provider.skills.market.riskConfirmTitle'),
        description: t('provider.skills.market.riskConfirmDescription', {
          name: entry.name,
          risk: entry.riskLevel || 'unknown',
        }),
        confirmLabel: t('provider.skills.market.install'),
        cancelLabel: t('common.action.cancel', { ns: 'common' }),
        onConfirm: () => installEntry(entry, true),
      });
      return;
    }
    await installEntry(entry, false);
  };

  const handleUninstall = async (entry: MarketSkillEntry) => {
    setInstalling(entry.filePath);
    try {
      await api.uninstallMarketSkill(market.id, entry.filePath);
      notifySuccess(t('provider.skills.market.uninstallSuccess', { name: entry.name }));
      onInstalled();
      loadSkills();
    } catch (e: any) {
      notifyError(e.message);
    } finally {
      setInstalling(null);
    }
  };

  return (
    <>
      <Drawer
        open
        onDismiss={onClose}
        side="right"
        width={720}
        closeLabel={t('common.action.close', { ns: 'common' })}
        title={
          <Flex direction="row" gap={10} align="center">
            <SkillAvatar size={28} variant="primary">{market.name.charAt(0).toUpperCase()}</SkillAvatar>
            <Flex>
              <Text strong>{market.name}</Text>
              <Text tone="secondary" style={{ fontSize: 11 }}>
                {t('provider.skills.market.skillsAvailable', { count: skills.length })}
              </Text>
            </Flex>
          </Flex>
        }
      >
        <Flex gap={16}>
          <TextField
            clearable
            leading={<Icon iconId="search" size={12} />}
            placeholder={t('provider.skills.market.searchPlaceholder')}
            value={searchQuery}
            onValueChange={setSearchQuery}
            onEnter={loadSkills}
            style={{ fontSize: 12 }}
          />

          {loading && <Flex align="center" justify="center" style={{ padding: 40 }}><Spin active /></Flex>}

          {!loading && skills.length === 0 && (
            <Empty icon={<Icon iconId="blocks" size={32} />} description={t('provider.skills.market.noSkills')} />
          )}

          <Flex gap={8}>
            {skills.map((entry) => (
              <Card
                key={entry.filePath}
                flat
                className="sc-skill-card sc-skill-card--clickable"
                onClick={() => setSelectedSkill(entry)}
              >
                <Flex direction="row" justify="space-between" align="center">
                  <Flex direction="row" gap={12} align="center" style={{ flex: 1, minWidth: 0 }}>
                    <SkillAvatar size={40}>{entry.name.charAt(0).toUpperCase()}</SkillAvatar>
                    <Flex style={{ minWidth: 0 }}>
                      <Text strong truncate>{entry.name}</Text>
                      <Text tone="secondary" truncate style={{ fontSize: 12 }}>
                        {entry.description || entry.identifier}
                      </Text>
                      <Flex direction="row" gap={4} wrap="wrap" style={{ marginTop: 4 }}>
                        {entry.packageType && <Tag>{entry.packageType}</Tag>}
                        {entry.trustLevel && <Tag tone="info">{entry.trustLevel}</Tag>}
                        {entry.riskLevel && (
                          <Tag tone={entry.riskLevel === 'low' ? 'success' : 'warning'}>
                            {t('provider.skills.market.risk', { level: entry.riskLevel })}
                          </Tag>
                        )}
                      </Flex>
                    </Flex>
                  </Flex>
                  <Flex direction="row" gap={8} align="center" style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    {entry.installed ? (
                      <>
                        <Tag tone="success">{t('provider.skills.market.installed')}</Tag>
                        <ConfirmAction
                          actionId={`market-uninstall-${entry.filePath}`}
                          title={t('provider.skills.market.uninstallConfirm')}
                          confirmLabel={t('provider.skills.market.uninstall')}
                          cancelLabel={t('common.action.cancel', { ns: 'common' })}
                          onConfirm={() => handleUninstall(entry)}
                        >
                          <IconButton
                            actionId={`market-uninstall-trigger-${entry.filePath}`}
                            iconId="delete"
                            iconSize={14}
                            density="compact"
                            emphasis="quiet"
                            tone="danger"
                            execution={installing === entry.filePath ? 'pending' : 'idle'}
                            label={t('provider.skills.market.uninstall')}
                          />
                        </ConfirmAction>
                      </>
                    ) : (
                      <IconButton
                        actionId={`market-install-${entry.filePath}`}
                        iconId="plus"
                        iconSize={14}
                        density="compact"
                        emphasis="quiet"
                        execution={installing === entry.filePath ? 'pending' : 'idle'}
                        availability={entry.installPolicy === 'blocked' || entry.revoked ? { kind: 'disabled', reason: '' } : undefined}
                        label={t('provider.skills.market.install')}
                        onActivate={() => void handleInstall(entry)}
                      />
                    )}
                    <Icon iconId="chevron-right" size={14} className="sc-skill-chevron" />
                  </Flex>
                </Flex>
              </Card>
            ))}
          </Flex>
        </Flex>
      </Drawer>

      {selectedSkill && (
        <MarketSkillDetailModal
          marketId={market.id}
          entry={selectedSkill}
          onClose={() => setSelectedSkill(null)}
          onInstall={() => handleInstall(selectedSkill)}
          onUninstall={() => handleUninstall(selectedSkill)}
          installing={installing === selectedSkill.filePath}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────
// Market Skill Detail Modal
// ────────────────────────────────────────────────────────

function MarketSkillDetailModal({
  marketId,
  entry,
  onClose,
  onInstall,
  onUninstall,
  installing,
}: {
  marketId: string;
  entry: MarketSkillEntry;
  onClose: () => void;
  onInstall: () => void;
  onUninstall: () => void;
  installing: boolean;
}) {
  const { t } = useTranslation('provider');
  const [detail, setDetail] = useState<MarketSkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    setLoading(true);
    api.getMarketSkillDetail(marketId, entry.filePath)
      .then(setDetail)
      .catch((e) => notifyError(e.message))
      .finally(() => setLoading(false));
  }, [marketId, entry.filePath]);

  const skillData = detail || entry;

  return (
    <Dialog
      open
      onDismiss={onClose}
      width={800}
      closeLabel={t('common.action.close', { ns: 'common' })}
      title={skillData.name}
    >
      <Flex gap={16}>
        <Flex direction="row" gap={16} align="flex-start">
          <SkillAvatar size={56}>{(detail?.avatar) || skillData.name.charAt(0).toUpperCase()}</SkillAvatar>
          <Flex style={{ flex: 1, minWidth: 0 }} gap={4}>
            <Flex direction="row" justify="space-between" align="center">
              <Text strong style={{ fontSize: 18 }}>{skillData.name}</Text>
              {skillData.installed ? (
                <Flex direction="row" gap={8} align="center">
                  <Tag tone="success" style={{ fontSize: 13 }}>{t('provider.skills.market.installed')}</Tag>
                  <ConfirmAction
                    actionId="market-detail-uninstall"
                    title={t('provider.skills.market.uninstallConfirm')}
                    confirmLabel={t('provider.skills.market.uninstall')}
                    cancelLabel={t('common.action.cancel', { ns: 'common' })}
                    onConfirm={onUninstall}
                  >
                    <Button
                      actionId="market-detail-uninstall-btn"
                      tone="danger"
                      leading={<Icon iconId="delete" size={14} />}
                      execution={installing ? 'pending' : 'idle'}
                      label={t('provider.skills.market.uninstall')}
                    />
                  </ConfirmAction>
                </Flex>
              ) : (
                <Button
                  actionId="market-detail-install"
                  emphasis="primary"
                  leading={<Icon iconId="download" size={14} />}
                  execution={installing ? 'pending' : 'idle'}
                  availability={skillData.installPolicy === 'blocked' || skillData.revoked ? { kind: 'disabled', reason: '' } : undefined}
                  label={t('provider.skills.market.install')}
                  onActivate={onInstall}
                />
              )}
            </Flex>
            <Text tone="secondary">{skillData.description || skillData.identifier}</Text>
            <Flex direction="row" gap={6} wrap="wrap">
              {skillData.packageType && <Tag>{skillData.packageType}</Tag>}
              {skillData.trustLevel && <Tag tone="info">{skillData.trustLevel}</Tag>}
              {skillData.riskLevel && (
                <Tag tone={skillData.riskLevel === 'low' ? 'success' : 'warning'}>
                  {t('provider.skills.market.risk', { level: skillData.riskLevel })}
                </Tag>
              )}
              {skillData.scanVerdict && <Tag tone="info">{skillData.scanVerdict}</Tag>}
            </Flex>
          </Flex>
        </Flex>

        <Segmented<string>
          value={activeTab}
          onValueChange={(value) => { if (value) setActiveTab(value); }}
          options={[
            { value: 'overview', label: t('provider.skills.detail.overview'), leading: <Icon iconId="book-open" size={14} /> },
            { value: 'content', label: t('provider.skills.detail.manifestFile'), leading: <Icon iconId="code" size={14} /> },
          ]}
        />

        {loading ? (
          <Flex align="center" justify="center" style={{ padding: 40 }}><Spin active /></Flex>
        ) : activeTab === 'overview' ? (
          <MarketSkillOverview detail={detail} />
        ) : (
          <MarketSkillContent detail={detail} />
        )}
      </Flex>
    </Dialog>
  );
}

function MarketSkillOverview({ detail }: { detail: MarketSkillDetail | null }) {
  const { t } = useTranslation('provider');
  if (!detail) {
    return <Flex align="center" justify="center" style={{ padding: 48 }}><Spin active /></Flex>;
  }

  const sections = parseSkillProtocol(detail.content);

  return (
    <Flex gap={16}>
      {sections.body && (
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          <LazyMarkdown content={sections.body} style={{ fontSize: 14 }} />
        </div>
      )}

      {detail.author && (
        <>
          <Divider />
          <Flex gap={4}>
            <Text strong style={{ fontSize: 12 }}>{t('provider.skills.detail.developedBy')}</Text>
            <Flex direction="row" gap={6} align="center">
              <Text>{detail.author}</Text>
              {detail.authorUrl && (
                <a href={detail.authorUrl} target="_blank" rel="noopener noreferrer">
                  <Icon iconId="external-link" size={12} />
                </a>
              )}
            </Flex>
          </Flex>
        </>
      )}

      <Divider />
      <Text strong style={{ fontSize: 12 }}>{t('provider.skills.detail.details')}</Text>
      <DetailDescriptions
        items={[
          { label: t('provider.skills.detail.version'), node: detail.version },
          { label: t('provider.skills.detail.license'), node: detail.license },
          { label: t('provider.skills.detail.author'), node: detail.author },
          { label: t('provider.skills.market.publisher'), node: detail.publisher },
          { label: t('provider.skills.market.repository'), node: detail.repository ? <a href={detail.repository} target="_blank" rel="noopener noreferrer">{detail.repository}</a> : undefined },
          { label: t('provider.skills.market.homepage'), node: detail.homepage ? <a href={detail.homepage} target="_blank" rel="noopener noreferrer">{detail.homepage}</a> : undefined },
        ]}
      />

      {((detail.keywords?.length ?? 0) > 0 || (detail.tags?.length ?? 0) > 0) && (
        <Flex direction="row" gap={4} wrap="wrap">
          {(detail.tags || []).map((tag) => <Tag key={tag} tone="info">{tag}</Tag>)}
          {(detail.keywords || []).map((kw) => <Tag key={kw}>{kw}</Tag>)}
        </Flex>
      )}
    </Flex>
  );
}

function MarketSkillContent({ detail }: { detail: MarketSkillDetail | null }) {
  if (!detail) {
    return <Flex align="center" justify="center" style={{ padding: 48 }}><Spin active /></Flex>;
  }

  return (
    <Flex gap={12}>
      <Card flat className="sc-skill-content-card">
        <div className="selectable sc-skill-raw">
          {detail.content}
        </div>
      </Card>
    </Flex>
  );
}

// ────────────────────────────────────────────────────────
// Installed / builtin skill card
// ────────────────────────────────────────────────────────

const SKILL_SOURCE_TONES: Record<string, Tone> = {
  url: 'info',
  github: 'neutral',
  zip: 'warning',
  user: 'success',
  market: 'info',
};

function SkillCard({
  skill,
  onToggle,
  onDelete,
  onDetail,
}: {
  skill: SkillListItem;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onDetail: () => void;
}) {
  const { t } = useTranslation('provider');

  return (
    <Card flat className="sc-skill-card">
      <Flex direction="row" justify="space-between" align="center">
        <Flex
          direction="row"
          gap={12}
          align="center"
          className="sc-skill-card__identity"
          onClick={onDetail}
        >
          <span style={{ fontSize: 20 }}>{skill.metaAvatar || '📄'}</span>
          <Flex>
            <Flex direction="row" gap={6} align="center">
              <Text strong>{skill.metaTitle || skill.name}</Text>
              {skill.version && (
                <Text tone="secondary" style={{ fontSize: 11 }}>v{skill.version}</Text>
              )}
            </Flex>
            <Text tone="secondary" style={{ fontSize: 12 }}>
              {skill.description || skill.identifier}
            </Text>
          </Flex>
        </Flex>
        <Flex direction="row" gap={8} align="center">
          {skill.metaTags?.slice(0, 2).map((tag) => (
            <Tag key={tag} style={{ fontSize: 11 }}>{tag}</Tag>
          ))}
          {skill.useCount > 0 && (
            <Tag tone="warning">{t('provider.skills.usedCount', { count: skill.useCount })}</Tag>
          )}
          {typeof skill.resourceCount === 'number' && skill.resourceCount > 0 && (
            <Tag tone="info">{t('provider.skills.resourceCount', { count: skill.resourceCount })}</Tag>
          )}
          <Tag tone={SKILL_SOURCE_TONES[skill.source] ?? 'neutral'}>{skill.source}</Tag>
          {skill.trustLevel && <Tag tone="info">{skill.trustLevel}</Tag>}
          {skill.scanVerdict && (
            <Tag tone={skill.scanVerdict === 'safe' ? 'success' : 'warning'}>{skill.scanVerdict}</Tag>
          )}
          <Tooltip label={skill.enabled ? t('common.action.disable', { ns: 'common' }) : t('common.action.enable', { ns: 'common' })}>
            <Switch
              checked={skill.enabled}
              aria-label={skill.enabled ? t('common.action.disable', { ns: 'common' }) : t('common.action.enable', { ns: 'common' })}
              onCheckedChange={(checked) => onToggle(skill.id, checked)}
            />
          </Tooltip>
          <ConfirmAction
            actionId={`skill-delete-${skill.id}`}
            title={t('provider.skills.deleteConfirm')}
            confirmLabel={t('common.action.delete', { ns: 'common' })}
            cancelLabel={t('common.action.cancel', { ns: 'common' })}
            onConfirm={() => onDelete(skill.id)}
          >
            <IconButton
              actionId={`skill-delete-trigger-${skill.id}`}
              iconId="delete"
              iconSize={14}
              density="compact"
              emphasis="quiet"
              tone="danger"
              label={t('provider.skills.deleteConfirm')}
            />
          </ConfirmAction>
        </Flex>
      </Flex>
    </Card>
  );
}

function ImportFromAddressModal({
  onDone,
  onCancel,
}: {
  onDone: (r: SkillImportResult | SkillImportBatchResult) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('provider');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    if (!address.trim()) return;
    setLoading(true);
    try {
      const result = await api.importSkillFromAddress(address.trim(), undefined);
      onDone(result);
    } catch (e: any) {
      notifyError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open
      onDismiss={onCancel}
      title={t('provider.skills.import.title')}
      closeLabel={t('common.action.cancel', { ns: 'common' })}
      footer={
        <>
          <Button actionId="skill-import-cancel" emphasis="quiet" label={t('common.action.cancel', { ns: 'common' })} onActivate={onCancel} />
          <Button actionId="skill-import-ok" emphasis="primary" execution={loading ? 'pending' : 'idle'} label={t('provider.skills.import.ok')} onActivate={() => void handleOk()} />
        </>
      }
    >
      <div className="sc-provider-form">
        <Text tone="secondary">
          {t('provider.skills.import.desc1')}
          <br />
          {t('provider.skills.import.desc2')}
        </Text>
        <TextField
          autoFocus
          placeholder={t('provider.skills.import.placeholder')}
          value={address}
          onValueChange={setAddress}
          onEnter={handleOk}
        />
      </div>
    </Dialog>
  );
}

function ImportZipModal({
  onDone,
  onCancel,
}: {
  onDone: (r: SkillImportResult) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('provider');
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<SkillZipValidation | null>(null);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<'idle' | 'validating' | 'ready' | 'importing'>('idle');
  const [loading, setLoading] = useState(false);

  const resetPicker = () => {
    setFile(null);
    setValidation(null);
    setStage('idle');
    setProgress(0);
  };

  const handleValidate = async () => {
    if (!file) return;
    setLoading(true);
    setStage('validating');
    setProgress(30);
    try {
      const result = await api.validateSkillZIP(file);
      setValidation(result);
      if (result.valid) {
        setStage('ready');
        setProgress(100);
      } else {
        setStage('idle');
        setProgress(0);
      }
    } catch (e: any) {
      notifyError(e.message);
      setStage('idle');
      setProgress(0);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!file || !validation?.valid) return;
    setLoading(true);
    setStage('importing');
    setProgress(40);
    try {
      const result = await api.importSkillFromZIP(file);
      setProgress(100);
      onDone(result);
    } catch (e: any) {
      notifyError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open
      onDismiss={onCancel}
      title={t('provider.skills.zip.title')}
      closeLabel={t('provider.skills.zip.cancel')}
      footer={
        <>
          <Button actionId="skill-zip-cancel" emphasis="quiet" label={t('provider.skills.zip.cancel')} onActivate={onCancel} />
          <Button
            actionId="skill-zip-validate"
            execution={loading ? 'pending' : 'idle'}
            availability={!file || stage === 'importing' ? { kind: 'disabled', reason: '' } : undefined}
            label={t('provider.skills.zip.validate')}
            onActivate={() => void handleValidate()}
          />
          <Button
            actionId="skill-zip-import"
            emphasis="primary"
            execution={loading ? 'pending' : 'idle'}
            availability={!validation?.valid || stage !== 'ready' ? { kind: 'disabled', reason: '' } : undefined}
            label={t('provider.skills.zip.import')}
            onActivate={() => void handleImport()}
          />
        </>
      }
    >
      <div className="sc-provider-form">
        <Text tone="secondary">{t('provider.skills.zip.desc')}</Text>
        <Flex direction="row" gap={8} align="center">
          <FilePicker
            accept=".zip"
            label={t('provider.skills.zip.selectZip')}
            onFiles={(files) => {
              const next = files[0];
              if (next) {
                setFile(next);
                setValidation(null);
                setStage('idle');
                setProgress(0);
              }
            }}
          />
          {file && (
            <IconButton
              actionId="skill-zip-clear"
              iconId="close"
              iconSize={14}
              density="compact"
              emphasis="quiet"
              label={t('provider.skills.zip.cancel')}
              onActivate={resetPicker}
            />
          )}
        </Flex>
        {file && <Text tone="secondary">{t('provider.skills.zip.selected', { name: file.name })}</Text>}
        {(stage === 'validating' || stage === 'ready' || stage === 'importing') && (
          <Progress
            value={progress}
            maximum={100}
            tone={validation?.valid === false ? 'danger' : 'info'}
            showValue={false}
          />
        )}
        {validation && (
          <Alert
            tone={validation.valid ? 'success' : 'danger'}
            title={validation.valid
              ? t('provider.skills.zip.validated', { name: validation.skillName || validation.skillPath })
              : validation.error || t('provider.skills.zip.invalidFormat')}
          />
        )}
      </div>
    </Dialog>
  );
}

function CreateSkillModal({
  onDone,
  onCancel,
}: {
  onDone: (r: SkillImportResult) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('provider');
  const [name, setName] = useState('');
  const [content, setContent] = useState(`---
name: my-skill
description: A custom skill
keywords: []
---

Your skill instructions here...
`);
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    const n = name.trim() || 'custom-skill';
    setLoading(true);
    try {
      const result = await api.createSkill(n, content);
      onDone(result);
    } catch (e: any) {
      notifyError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open
      onDismiss={onCancel}
      title={t('provider.skills.createModal.title')}
      width={640}
      closeLabel={t('common.action.cancel', { ns: 'common' })}
      footer={
        <>
          <Button actionId="skill-create-cancel" emphasis="quiet" label={t('common.action.cancel', { ns: 'common' })} onActivate={onCancel} />
          <Button actionId="skill-create-ok" emphasis="primary" execution={loading ? 'pending' : 'idle'} label={t('provider.skills.createModal.ok')} onActivate={() => void handleOk()} />
        </>
      }
    >
      <div className="sc-provider-form">
        <TextField
          autoFocus
          placeholder={t('provider.skills.createModal.namePlaceholder')}
          value={name}
          onValueChange={setName}
        />
        <Text tone="secondary" style={{ fontSize: 12 }}>{t('provider.skills.createModal.formatDesc')}</Text>
        <TextArea
          className="sc-skill-code-area"
          rows={14}
          value={content}
          onValueChange={setContent}
        />
      </div>
    </Dialog>
  );
}

function SkillDetailBoard({
  detail,
  onClose,
}: {
  detail: { kind: 'installed' | 'builtin'; key: string };
  onClose: () => void;
}) {
  const { t } = useTranslation('provider');
  const [skill, setSkill] = useState<SkillRecord | BuiltinSkillRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const [versions, setVersions] = useState<SkillVersionItem[]>([]);
  const [versionTotal, setVersionTotal] = useState(0);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [rollbackVersion, setRollbackVersion] = useState<number | null>(null);
  const [activeResource, setActiveResource] = useState<{ path: string; content: string } | null>(null);
  const [resourceLoading, setResourceLoading] = useState(false);
  const canEdit = detail.kind === 'installed';

  const readVersionedResource = useCallback(async (resourcePath: string, owner?: string, contentHash?: string) => {
    if (!skill || !('agentId' in skill) || !skill.agentId) return;
    setResourceLoading(true);
    try {
      const resourceContent = await skillService.readVersionedResource({
        agentId: skill.agentId,
        skillId: skill.id,
        version: Number(skill.version),
        path: resourcePath,
        owner,
        contentHash,
      });
      setActiveResource({ path: resourcePath, content: resourceContent });
    } catch (error) {
      notifyError(t('provider.skills.detail.readResourceFailed'));
      log.error('skills', 'Failed to read skill resource', { path: resourcePath, owner, error: String(error) });
    } finally {
      setResourceLoading(false);
    }
  }, [skill, t]);

  const loadInstalledSkill = useCallback(async () => {
    const data = await api.getSkill(detail.key);
    setSkill(data);
    setContent(data.content || '');
  }, [detail.key]);

  const loadVersions = useCallback(async () => {
    if (detail.kind !== 'installed') return;
    setVersionsLoading(true);
    try {
      const data = await api.listSkillVersions(detail.key);
      setVersions(data.versions || []);
      setVersionTotal(data.total || 0);
    } catch (err) {
      log.error('skills', 'Failed to load skill versions', { id: detail.key, error: String(err) });
    } finally {
      setVersionsLoading(false);
    }
  }, [detail]);

  useEffect(() => {
    const load = async () => {
      if (detail.kind === 'installed') {
        await loadInstalledSkill();
        await loadVersions();
        return;
      }
      const data = await api.getBuiltinSkill(detail.key);
      setSkill(data);
      setContent(data.content || '');
      setVersions([]);
      setVersionTotal(0);
    };
    load().catch((err) => log.error('skills', 'Failed to load skills', { error: String(err) }));
  }, [detail, loadInstalledSkill, loadVersions]);

  const handleSave = async () => {
    try {
      await api.updateSkill(detail.key, { content });
      notifySuccess(t('provider.skills.detail.updated'));
      setEditing(false);
      if (detail.kind === 'installed') {
        await loadInstalledSkill();
        await loadVersions();
      }
    } catch (e: any) {
      notifyError(e.message);
    }
  };

  const handleRollback = async (version: number) => {
    setRollbackVersion(version);
    try {
      await api.rollbackSkill(detail.key, version);
      notifySuccess(t('provider.skills.detail.rollbackSuccess', { version }));
      await loadInstalledSkill();
      await loadVersions();
    } catch (e: any) {
      notifyError(e.message);
    } finally {
      setRollbackVersion(null);
    }
  };

  if (!skill) return null;
  const installedSkill = 'resourceTree' in skill ? skill : null;

  const footer = editing && canEdit ? (
    <>
      <Button actionId="skill-detail-cancel" emphasis="quiet" label={t('provider.skills.detail.cancel')} onActivate={() => setEditing(false)} />
      <Button actionId="skill-detail-save" emphasis="primary" label={t('provider.skills.detail.save')} onActivate={() => void handleSave()} />
    </>
  ) : (
    <Button
      actionId="skill-detail-edit"
      leading={<Icon iconId="edit" size={14} />}
      availability={!canEdit ? { kind: 'disabled', reason: '' } : undefined}
      label={t('provider.skills.detail.editContent')}
      onActivate={() => setEditing(true)}
    />
  );

  return (
    <>
      <Dialog
        open
        onDismiss={onClose}
        width={700}
        title={installedSkill?.metaTitle || skill.name}
        footer={footer}
      >
        <Flex gap={12}>
          <Flex direction="row" gap={8} wrap="wrap">
            {installedSkill?.source && <Tag tone="info">{installedSkill.source}</Tag>}
            {installedSkill?.trustLevel && <Tag tone="info">{installedSkill.trustLevel}</Tag>}
            {installedSkill?.scanVerdict && <Tag tone={installedSkill.scanVerdict === 'safe' ? 'success' : 'warning'}>{installedSkill.scanVerdict}</Tag>}
            {installedSkill?.version && <Tag>v{installedSkill.version}</Tag>}
            {installedSkill?.license && <Tag tone="success">{installedSkill.license}</Tag>}
            {installedSkill?.authorName && <Tag>by {installedSkill.authorName}</Tag>}
            {skill.useCount > 0 && <Tag tone="warning">used {skill.useCount}</Tag>}
          </Flex>

          {skill.description && (
            <Text tone="secondary">{skill.description}</Text>
          )}

          {installedSkill && (
            <SkillVersionHistory
              currentVersion={Number(installedSkill.version || 0)}
              loading={versionsLoading}
              total={versionTotal}
              versions={versions}
              rollbackVersion={rollbackVersion}
              onRefresh={loadVersions}
              onRollback={handleRollback}
            />
          )}

          {skill.keywords?.length > 0 && (
            <Flex direction="row" gap={4} wrap="wrap">
              <Text tone="secondary" style={{ fontSize: 12 }}>{t('provider.skills.detail.keywords')}</Text>
              {skill.keywords.map((kw: string) => (
                <Tag key={kw} style={{ fontSize: 11 }}>{kw}</Tag>
              ))}
            </Flex>
          )}

          {editing ? (
            <TextArea
              className="sc-skill-code-area"
              rows={16}
              value={content}
              onValueChange={setContent}
            />
          ) : (
            <SkillProtocolPreview
              skill={skill}
              content={skill.content}
              onReadResource={readVersionedResource}
              resourceLoading={resourceLoading}
            />
          )}
        </Flex>
      </Dialog>
      <Dialog
        open={activeResource !== null}
        onDismiss={() => setActiveResource(null)}
        title={activeResource?.path}
        width={760}
        closeLabel={t('common.action.close', { ns: 'common' })}
      >
        <div className="selectable" style={{ whiteSpace: 'pre-wrap', maxHeight: '60vh', overflow: 'auto' }}>
          {activeResource?.content}
        </div>
      </Dialog>
    </>
  );
}

function SkillProtocolPreview({
  skill,
  content,
  onReadResource,
  resourceLoading,
}: {
  skill: SkillRecord | BuiltinSkillRecord;
  content: string;
  onReadResource?: (path: string, owner?: string, contentHash?: string) => void;
  resourceLoading?: boolean;
}) {
  const { t } = useTranslation('provider');
  const sections = parseSkillProtocol(content);
  return (
    <Flex gap={12}>
      {'resourceTree' in skill && skill.resourceTree && (
        <SkillResourceTreePanel
          skill={skill}
          onReadResource={onReadResource}
          resourceLoading={resourceLoading}
        />
      )}
      <Card flat className="sc-skill-content-card">
        <Text strong>{t('provider.skills.detail.manifest')}</Text>
        <div className="selectable sc-skill-frontmatter">
          {sections.frontmatter || t('provider.skills.detail.noFrontmatter')}
        </div>
      </Card>
      <Card flat className="sc-skill-content-card">
        <Text strong>{t('provider.skills.detail.content')}</Text>
        <div className="selectable" style={{ marginTop: 8, maxHeight: 360, overflow: 'auto' }}>
          <LazyMarkdown content={sections.body || ''} style={{ fontSize: 14 }} />
        </div>
      </Card>
      <Card flat className="sc-skill-content-card">
        <Text strong>{t('provider.skills.detail.rawProtocol')}</Text>
        <div className="selectable sc-skill-raw" style={{ maxHeight: 220 }}>
          {content}
        </div>
      </Card>
    </Flex>
  );
}

function SkillVersionHistory({
  currentVersion,
  loading,
  total,
  versions,
  rollbackVersion,
  onRefresh,
  onRollback,
}: {
  currentVersion: number;
  loading: boolean;
  total: number;
  versions: SkillVersionItem[];
  rollbackVersion: number | null;
  onRefresh: () => void;
  onRollback: (version: number) => void;
}) {
  const { t } = useTranslation('provider');

  return (
    <Card flat className="sc-skill-version">
      <Flex gap={10}>
        <Flex direction="row" justify="space-between" align="center">
          <Flex direction="row" gap={8} align="center">
            <Icon iconId="history" size={14} />
            <Text strong>{t('provider.skills.detail.versions')}</Text>
            <Tag>v{currentVersion}</Tag>
            <Tag>{t('provider.skills.detail.versionTotal', { total })}</Tag>
          </Flex>
          <Button
            actionId="skill-versions-refresh"
            emphasis="quiet"
            density="compact"
            leading={<Icon iconId="refresh-cw" size={14} />}
            execution={loading ? 'pending' : 'idle'}
            label={t('provider.skills.detail.refreshVersions')}
            onActivate={onRefresh}
          />
        </Flex>
        <Text tone="secondary" style={{ fontSize: 12 }}>{t('provider.skills.detail.rollbackPolicy')}</Text>
        {versions.length === 0 ? (
          <Empty description={t('provider.skills.detail.noVersions')} />
        ) : (
          <Flex gap={8}>
            {versions.map((version) => {
              const versionNumber = version.version;
              const createdAt = version.created_at || version.createdAt || '';
              const versionId = version.version_id || version.versionId || `${versionNumber}`;
              return (
                <Card key={versionId} flat className="sc-skill-version-item">
                  <Flex direction="row" justify="space-between" align="center" gap={8}>
                    <Flex gap={4}>
                      <Flex direction="row" gap={6} align="center">
                        <Tag tone={versionNumber === currentVersion ? 'success' : 'info'}>v{versionNumber}</Tag>
                        <Tag>{version.trigger}</Tag>
                      </Flex>
                      {createdAt && <Text tone="secondary" style={{ fontSize: 12 }}>{createdAt}</Text>}
                    </Flex>
                    <ConfirmAction
                      actionId={`skill-rollback-${versionId}`}
                      title={t('provider.skills.detail.rollbackConfirm', { version: versionNumber })}
                      confirmLabel={t('provider.skills.detail.rollback')}
                      cancelLabel={t('common.action.cancel', { ns: 'common' })}
                      onConfirm={() => onRollback(versionNumber)}
                    >
                      <Button
                        actionId={`skill-rollback-trigger-${versionId}`}
                        density="compact"
                        leading={<Icon iconId="rotate-ccw" size={14} />}
                        execution={rollbackVersion === versionNumber ? 'pending' : 'idle'}
                        availability={versionNumber === currentVersion ? { kind: 'disabled', reason: '' } : undefined}
                        label={t('provider.skills.detail.rollback')}
                      />
                    </ConfirmAction>
                  </Flex>
                </Card>
              );
            })}
          </Flex>
        )}
      </Flex>
    </Card>
  );
}

function SkillResourceTreePanel({
  skill,
  onReadResource,
  resourceLoading,
}: {
  skill: SkillRecord;
  onReadResource?: (path: string, owner?: string, contentHash?: string) => void;
  resourceLoading?: boolean;
}) {
  const { t } = useTranslation('provider');
  const resources = skill.resourceTree?.root.children || [];
  const runtimeLoad = skill.runtimeLoad;

  return (
    <Card flat className="sc-skill-content-card">
      <Flex gap={10}>
        <Flex direction="row" justify="space-between" align="center">
          <Text strong>{t('provider.skills.detail.resources')}</Text>
          <Tag tone="info">{runtimeLoad?.systemPrompt.policy || 'index-only'}</Tag>
        </Flex>
        <Text tone="secondary" style={{ fontSize: 12 }}>
          {runtimeLoad?.systemPrompt.description || t('provider.skills.detail.resourcePolicyDesc')}
        </Text>
        <Flex direction="row" gap={8} wrap="wrap">
          <Tag tone="success">
            {t('provider.skills.detail.systemPromptLoads', { count: runtimeLoad?.systemPrompt.loadedResources.length ?? 0 })}
          </Tag>
          <Tag tone="neutral">
            {t('provider.skills.detail.skillViewLoads', { count: runtimeLoad?.skillView.loadedResources.length ?? 0 })}
          </Tag>
          {runtimeLoad?.skillView.bytes !== undefined && (
            <Tag>{t('provider.skills.detail.resourceBytes', { bytes: runtimeLoad.skillView.bytes })}</Tag>
          )}
        </Flex>
        <Flex gap={8}>
          {resources.map((resource) => (
            <SkillResourceRow
              key={resource.id}
              resource={resource}
              onReadResource={onReadResource && isTextResourceReadable(resource) ? onReadResource : undefined}
              loading={resourceLoading}
            />
          ))}
        </Flex>
      </Flex>
    </Card>
  );
}

function SkillResourceRow({
  resource,
  onReadResource,
  loading,
}: {
  resource: SkillResourceNode;
  onReadResource?: (path: string, owner?: string, contentHash?: string) => void;
  loading?: boolean;
}) {
  const { t } = useTranslation('provider');
  const hash = resource.sha256 ? `${resource.sha256.slice(0, 12)}...` : '';

  return (
    <Card flat className="sc-skill-resource-row">
      <Flex gap={6}>
        <Flex direction="row" justify="space-between" align="center">
          <Flex direction="row" gap={8} align="center">
            <Icon iconId="code" size={14} />
            <Text strong style={{ fontSize: 13 }}>{resource.path}</Text>
            <Tag>{resource.kind}</Tag>
            {resource.role && <Tag tone="info">{resource.role}</Tag>}
            {resource.executionOwner && (
              <Tag tone={resource.executionOwner === 'station' ? 'info' : 'neutral'}>
                {t(resource.executionOwner === 'station'
                  ? 'provider.skills.detail.stationOwner'
                  : 'provider.skills.detail.clientOwner')}
              </Tag>
            )}
          </Flex>
          {onReadResource ? (
            <Button
              actionId={`skill-resource-read-${resource.path}`}
              density="compact"
              execution={loading ? 'pending' : 'idle'}
              label={t('provider.skills.detail.readResource')}
              onActivate={() => onReadResource(resource.path, resource.executionOwner, resource.sha256)}
            />
          ) : (
            <Tag tone={resource.loadedAtRuntime ? 'success' : 'neutral'}>
              {resource.loadedAtRuntime
                ? t('provider.skills.detail.loaded')
                : t('provider.skills.detail.onDemand')}
            </Tag>
          )}
        </Flex>
        {resource.summary && (
          <Text tone="secondary" style={{ fontSize: 12 }}>{resource.summary}</Text>
        )}
        <Flex direction="row" gap={6} wrap="wrap">
          <Tag>{t('provider.skills.detail.resourceBytes', { bytes: resource.bytes })}</Tag>
          {typeof resource.lineCount === 'number' && (
            <Tag>{t('provider.skills.detail.resourceLines', { lines: resource.lineCount })}</Tag>
          )}
          <Tag>{t('provider.skills.detail.loadTrigger', { trigger: resource.loadTrigger })}</Tag>
          {hash && <Tag>{t('provider.skills.detail.sha256', { hash })}</Tag>}
        </Flex>
      </Flex>
    </Card>
  );
}

function parseSkillProtocol(content: string): { frontmatter: string; body: string } {
  const text = content || '';
  if (!text.startsWith('---\n')) {
    return { frontmatter: '', body: text };
  }
  const endIdx = text.indexOf('\n---', 4);
  if (endIdx < 0) {
    return { frontmatter: '', body: text };
  }
  return {
    frontmatter: text.slice(4, endIdx).trim(),
    body: text.slice(endIdx + 4).trim(),
  };
}
