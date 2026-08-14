import { useCallback, useEffect, useMemo, useState } from 'react';
import { log } from '@/utils/logger';
import { Flexbox } from 'react-layout-kit';
import {
  Card, Descriptions, Divider, Drawer, Empty, Modal,
  Popconfirm, Progress, Select, Spin, Switch, Typography, Upload, message, theme,
} from 'antd';
import { Alert, Avatar, Button, Input, Tabs, Tag, Tooltip, TextArea } from '@lobehub/ui';
import {
  BookOpen, ChevronRight, Code2, Download, Edit, ExternalLink,
  FolderOpen, History, Link as LinkIcon, Plus, RefreshCw, RotateCcw, Search,
  Trash2, Upload as UploadIcon,
} from 'lucide-react';
import { LazyMarkdown } from './LazyMarkdown';
import { chatMarkdownProps } from './messages/markdownConfig';
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
import { useSkillStore } from '../store/skill';
import { SettingsContainer } from './settings/SettingsLayout';
const { Text, Title, Paragraph } = Typography;

export function SkillsTab() {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
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
      message.error(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSkill(id);
      message.success(t('provider.skills.deleted'));
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleImportDone = (result: SkillImportResult | SkillImportBatchResult) => {
    if ('imported' in result) {
      message.success(t('provider.skills.importedBatch', { total: result.total, kind: result.kind }));
    } else {
      message.success(result.isNew ? t('provider.skills.importedSingle', { name: result.name }) : t('provider.skills.updatedSingle', { name: result.name }));
    }
    setImportModal(null);
    loadSkills();
  };

  const handleOpenDir = async () => {
    try {
      await api.openSkillsDir();
    } catch (e: any) {
      message.error(e.message);
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
    <SettingsContainer fullHeight>
      <Flexbox horizontal justify="space-between" align="center">
        <Title level={5} style={{ margin: 0 }}>{t('provider.skills.title')}</Title>
        <Flexbox horizontal gap={8}>
          <Button size="small" icon={<Plus size={14} />} onClick={() => setImportModal('create')}>
            {t('provider.skills.create')}
          </Button>
          <Button size="small" icon={<LinkIcon size={14} />} onClick={() => setImportModal('source')}>
            {t('provider.skills.fromUrl')}
          </Button>
          <Button size="small" icon={<UploadIcon size={14} />} onClick={() => setImportModal('zip')}>
            {t('provider.skills.uploadZip')}
          </Button>
        </Flexbox>
      </Flexbox>
      <Input
        size="small"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('provider.skills.searchPlaceholder')}
        prefix={<Search size={12} />}
        allowClear
        style={{ fontSize: 12 }}
      />
      {error && (
        <Alert
          type="error"
          showIcon
          message={t('provider.skills.operationFailed')}
          description={error}
        />
      )}

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'installed',
            label: t('provider.skills.tab.installed', { count: skills.length }),
            children: (
              <Flexbox gap={12}>
                <Flexbox horizontal justify="flex-start" align="center" gap={8}>
                  <Button
                    size="small"
                    type="text"
                    icon={<FolderOpen size={14} />}
                    onClick={handleOpenDir}
                  >
                    {t('provider.skills.openLocalDir')}
                  </Button>
                </Flexbox>
                {filteredInstalled.length === 0 && !loading && (
                  <Empty description={t('provider.skills.noInstalled')} />
                )}
                {filteredInstalled.map((s) => (
                  <SkillCard
                    key={s.id}
                    skill={s}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                    onDetail={() => setDetail({ kind: 'installed', key: s.id })}
                    token={token}
                  />
                ))}
              </Flexbox>
            ),
          },
          {
            key: 'builtin',
            label: t('provider.skills.tab.builtin', { count: builtins.length }),
            children: (
              <Flexbox gap={12}>
                {filteredBuiltins.length === 0 && !loading && (
                  <Empty description={t('provider.skills.noBuiltin')} />
                )}
                {filteredBuiltins.map((s) => (
                  <Card
                    key={s.identifier}
                    size="small"
                    style={{ borderColor: token.colorBorderSecondary, cursor: 'pointer' }}
                    onClick={() => setDetail({ kind: 'builtin', key: s.identifier })}
                  >
                    <Flexbox horizontal justify="space-between" align="center">
                      <Flexbox horizontal gap={12} align="center">
                        <span style={{ fontSize: 20 }}>{s.avatar || '📄'}</span>
                        <Flexbox>
                          <Text strong>{s.name}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {s.description || t('provider.skills.builtInSkill')}
                          </Text>
                        </Flexbox>
                      </Flexbox>
                      <Flexbox horizontal gap={4}>
                        {s.useCount > 0 && <Tag color="gold">{t('provider.skills.usedCount', { count: s.useCount })}</Tag>}
                        <Tag color="blue">{t('provider.skills.builtInTag')}</Tag>
                        {s.keywords.slice(0, 3).map((kw) => (
                          <Tag key={kw} style={{ fontSize: 11 }}>{kw}</Tag>
                        ))}
                      </Flexbox>
                    </Flexbox>
                  </Card>
                ))}
              </Flexbox>
            ),
          },
          {
            key: 'market',
            label: t('provider.skills.tab.market'),
            children: <MarketTab onInstalled={loadSkills} />,
          },
        ]}
      />

      {importModal === 'source' && (
        <ImportFromAddressModal
          onDone={handleImportDone}
          onCancel={() => setImportModal(null)}
        />
      )}
      {importModal === 'zip' && (
        <ImportZipModal
          onDone={handleImportDone}
          onCancel={() => setImportModal(null)}
        />
      )}
      {importModal === 'create' && (
        <CreateSkillModal
          onDone={handleImportDone}
          onCancel={() => setImportModal(null)}
        />
      )}
      {detail && (
        <SkillDetailBoard
          detail={detail}
          onClose={() => { setDetail(null); loadSkills(); }}
        />
      )}
    </SettingsContainer>
  );
}

// ────────────────────────────────────────────────────────
// Market Tab
// ────────────────────────────────────────────────────────

function MarketTab({ onInstalled }: { onInstalled: () => void }) {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
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
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMarkets(); }, [loadMarkets]);

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal justify="space-between" align="center">
        <Text type="secondary">
          {t('provider.skills.market.browseDesc')}
        </Text>
        <Button icon={<Plus size={14} />} onClick={() => setAddModal(true)} size="small">
          {t('provider.skills.market.addMarket')}
        </Button>
      </Flexbox>

      {loading && markets.length === 0 && <Spin />}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 12,
      }}>
        {markets.map((m) => (
          <MarketCard
            key={m.id}
            market={m}
            token={token}
            onClick={() => setSelectedMarket(m)}
            onDelete={async () => {
              try {
                await api.removeSkillMarketSource(m.id);
                loadMarkets();
              } catch (e: any) {
                message.error(e.message);
              }
            }}
          />
        ))}
        {!loading && markets.length === 0 && (
          <Empty
            description={t('provider.skills.market.noMarkets')}
            style={{ gridColumn: '1 / -1' }}
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
        <AddMarketModal
          onDone={() => { setAddModal(false); loadMarkets(); }}
          onCancel={() => setAddModal(false)}
        />
      )}
    </Flexbox>
  );
}

function MarketCard({
  market,
  token,
  onClick,
  onDelete,
}: {
  market: MarketSummary;
  token: any;
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
      message.success(t('provider.skills.market.synced', { total: result.total }));
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card
      hoverable
      size="small"
      style={{
        borderColor: token.colorBorderSecondary,
        minHeight: 140,
        display: 'flex',
        flexDirection: 'column',
      }}
      styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', padding: 16 } }}
      onClick={onClick}
    >
      <Flexbox gap={8} style={{ flex: 1 }}>
        <Flexbox horizontal justify="space-between" align="flex-start">
          <Flexbox horizontal gap={10} align="center">
            <Avatar
              size={36}
              shape="square"
              style={{
                background: token.colorPrimaryBg,
                color: token.colorPrimary,
                fontSize: 18,
              }}
            >
              {market.name.charAt(0).toUpperCase()}
            </Avatar>
            <Flexbox>
              <Text strong style={{ fontSize: 14 }}>{market.name}</Text>
              <Flexbox horizontal gap={6} align="center" style={{ marginTop: 2 }}>
                <Tag color={market.synced ? 'green' : 'default'}>
                  {market.synced ? t('provider.skills.market.syncedStatus') : t('provider.skills.market.notSynced')}
                </Tag>
                {market.synced && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('provider.skills.market.skillCount', { count: market.skillCount })}
                  </Text>
                )}
              </Flexbox>
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal gap={4}>
            <Tooltip title={t('provider.skills.market.sync')}>
              <Button
                type="text"
                size="small"
                loading={syncing}
                icon={<RefreshCw size={14} />}
                onClick={handleSync}
              />
            </Tooltip>
            <Popconfirm title={t('provider.skills.market.removeConfirm')} onConfirm={(e) => { e?.stopPropagation(); onDelete(); }}>
              <Button
                type="text"
                size="small"
                danger
                icon={<Trash2 size={14} />}
                onClick={(e) => e.stopPropagation()}
              />
            </Popconfirm>
          </Flexbox>
        </Flexbox>
        <Paragraph
          type="secondary"
          style={{ fontSize: 12, margin: 0, flex: 1 }}
          ellipsis={{ rows: 2 }}
        >
          {market.url}
        </Paragraph>
        {market.error && (
          <Text type="danger" style={{ fontSize: 11 }}>{market.error}</Text>
        )}
      </Flexbox>
    </Card>
  );
}

function defaultNameFromUrl(url: string): string {
  const u = url.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const idx = u.lastIndexOf('/');
  return idx >= 0 ? u.slice(idx + 1) : u;
}

function AddMarketModal({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('provider');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('main');
  const [branchCustom, setBranchCustom] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (url.trim()) {
      setName((n) => (n ? n : defaultNameFromUrl(url)));
    }
  }, [url]);

  const handleOk = async () => {
    if (!url.trim()) {
      message.warning(t('provider.skills.market.add.urlRequired'));
      return;
    }
    setLoading(true);
    try {
      const br = branch === 'custom' ? branchCustom.trim() || 'main' : branch;
      await api.addSkillMarketSource(url.trim(), name.trim() || undefined, br || undefined);
      message.success(t('provider.skills.market.add.success'));
      onDone();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('provider.skills.market.add.title')}
      open
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={loading}
      okText={t('provider.skills.market.add.ok')}
    >
      <Flexbox gap={12} style={{ paddingBlock: 12 }}>
        <Text type="secondary">
          {t('provider.skills.market.add.desc')}
        </Text>
        <Input
          placeholder={t('provider.skills.market.add.urlPlaceholder')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
        />
        <Input
          placeholder={t('provider.skills.market.add.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Flexbox gap={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>{t('provider.skills.market.add.branch')}</Text>
          <Flexbox horizontal gap={8}>
            <Select
              value={branch}
              onChange={setBranch}
              style={{ minWidth: 120 }}
              options={[
                { value: 'main', label: 'main' },
                { value: 'master', label: 'master' },
                { value: 'custom', label: t('provider.skills.market.add.custom') },
              ]}
            />
            {branch === 'custom' && (
              <Input
                placeholder={t('provider.skills.market.add.branchPlaceholder')}
                value={branchCustom}
                onChange={(e) => setBranchCustom(e.target.value)}
                style={{ flex: 1 }}
              />
            )}
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────
// Market Browser Dialog — shows skills in a market
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
  const { token } = theme.useToken();
  const [skills, setSkills] = useState<MarketSkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<MarketSkillEntry | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.listMarketSkills(market.id, searchQuery || undefined);
      setSkills(result.skills || []);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [market.id, searchQuery]);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const handleInstall = async (entry: MarketSkillEntry) => {
    setInstalling(entry.filePath);
    try {
      await api.installMarketSkill(market.id, entry.filePath);
      message.success(t('provider.skills.market.installSuccess', { name: entry.name }));
      onInstalled();
      loadSkills();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setInstalling(null);
    }
  };

  const handleUninstall = async (entry: MarketSkillEntry) => {
    setInstalling(entry.filePath);
    try {
      await api.uninstallMarketSkill(market.id, entry.filePath);
      message.success(t('provider.skills.market.uninstallSuccess', { name: entry.name }));
      onInstalled();
      loadSkills();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setInstalling(null);
    }
  };

  return (
    <>
      <Drawer
        title={
          <Flexbox horizontal gap={10} align="center">
            <Avatar
              size={28}
              shape="square"
              style={{ background: token.colorPrimaryBg, color: token.colorPrimary }}
            >
              {market.name.charAt(0).toUpperCase()}
            </Avatar>
            <Flexbox>
              <Text strong>{market.name}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('provider.skills.market.skillsAvailable', { count: skills.length })}
              </Text>
            </Flexbox>
          </Flexbox>
        }
        open
        onClose={onClose}
        size="large"
        placement="right"
      >
        <Flexbox gap={16}>
          <Input
            size="small"
            prefix={<Search size={12} />}
            placeholder={t('provider.skills.market.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onPressEnter={loadSkills}
            allowClear
            style={{ fontSize: 12 }}
          />

          {loading && <Spin style={{ alignSelf: 'center', marginTop: 40 }} />}

          {!loading && skills.length === 0 && (
            <Empty description={t('provider.skills.market.noSkills')} />
          )}

          <Flexbox gap={8}>
            {skills.map((entry) => (
              <Card
                key={entry.filePath}
                size="small"
                hoverable
                style={{ borderColor: token.colorBorderSecondary, cursor: 'pointer' }}
                onClick={() => setSelectedSkill(entry)}
              >
                <Flexbox horizontal justify="space-between" align="center">
                  <Flexbox horizontal gap={12} align="center" style={{ flex: 1, minWidth: 0 }}>
                    <Avatar
                      size={40}
                      shape="square"
                      style={{
                        background: token.colorFillSecondary,
                        color: token.colorTextSecondary,
                        fontSize: 18,
                        flexShrink: 0,
                      }}
                    >
                      {entry.name.charAt(0).toUpperCase()}
                    </Avatar>
                    <Flexbox style={{ minWidth: 0 }}>
                      <Text strong ellipsis>{entry.name}</Text>
                      <Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                        ellipsis
                      >
                        {entry.description || entry.identifier}
                      </Text>
                      <Flexbox horizontal gap={4} wrap="wrap" style={{ marginTop: 4 }}>
                        {entry.packageType && <Tag>{entry.packageType}</Tag>}
                        {entry.trustLevel && <Tag color="cyan">{entry.trustLevel}</Tag>}
                        {entry.riskLevel && (
                          <Tag color={entry.riskLevel === 'low' ? 'green' : 'orange'}>
                            {t('provider.skills.market.risk', { level: entry.riskLevel })}
                          </Tag>
                        )}
                      </Flexbox>
                    </Flexbox>
                  </Flexbox>
                  <Flexbox horizontal gap={8} align="center" style={{ flexShrink: 0 }}>
                    {entry.installed ? (
                      <>
                        <Tag color="green">{t('provider.skills.market.installed')}</Tag>
                        <Popconfirm
                          title={t('provider.skills.market.uninstallConfirm')}
                          onConfirm={(e) => {
                            e?.stopPropagation();
                            handleUninstall(entry);
                          }}
                        >
                          <Button
                            type="text"
                            danger
                            icon={<Trash2 size={14} />}
                            loading={installing === entry.filePath}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </Popconfirm>
                      </>
                    ) : (
                      <Button
                        type="text"
                        icon={<Plus size={14} />}
                        loading={installing === entry.filePath}
                        onClick={(e) => { e.stopPropagation(); handleInstall(entry); }}
                      />
                    )}
                    <ChevronRight size={14} style={{ color: token.colorTextQuaternary }} />
                  </Flexbox>
                </Flexbox>
              </Card>
            ))}
          </Flexbox>
        </Flexbox>
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
// Market Skill Detail Modal — LobeHub-style detail view
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
  const { token } = theme.useToken();
  const [detail, setDetail] = useState<MarketSkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    setLoading(true);
    api.getMarketSkillDetail(marketId, entry.filePath)
      .then(setDetail)
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false));
  }, [marketId, entry.filePath]);

  const skillData = detail || entry;

  return (
    <Modal
      open
      onCancel={onClose}
      width={800}
      footer={null}
      styles={{
        body: { padding: 0 },
      }}
    >
      {/* Header — icon + title + description + install button */}
      <Flexbox style={{ padding: '24px 24px 0' }} gap={16}>
        <Flexbox horizontal gap={16} align="flex-start">
          <Avatar
            size={56}
            shape="square"
            style={{
              background: token.colorFillSecondary,
              color: token.colorTextSecondary,
              fontSize: 28,
              flexShrink: 0,
            }}
          >
            {(detail?.avatar) || skillData.name.charAt(0).toUpperCase()}
          </Avatar>
          <Flexbox style={{ flex: 1, minWidth: 0 }} gap={4}>
            <Flexbox horizontal justify="space-between" align="center">
              <Text strong style={{ fontSize: 18 }}>{skillData.name}</Text>
              {skillData.installed ? (
                <Flexbox horizontal gap={8} align="center">
                  <Tag color="green" style={{ fontSize: 13 }}>{t('provider.skills.market.installed')}</Tag>
                  <Popconfirm title={t('provider.skills.market.uninstallConfirm')} onConfirm={onUninstall}>
                    <Button danger icon={<Trash2 size={14} />} loading={installing}>
                      {t('provider.skills.market.uninstall')}
                    </Button>
                  </Popconfirm>
                </Flexbox>
              ) : (
                <Button
                  type="primary"
                  icon={<Download size={14} />}
                  onClick={onInstall}
                  loading={installing}
                >
                  {t('provider.skills.market.install')}
                </Button>
              )}
            </Flexbox>
            <Text type="secondary">{skillData.description || skillData.identifier}</Text>
            <Flexbox horizontal gap={6} wrap="wrap">
              {skillData.packageType && <Tag>{skillData.packageType}</Tag>}
              {skillData.trustLevel && <Tag color="cyan">{skillData.trustLevel}</Tag>}
              {skillData.riskLevel && (
                <Tag color={skillData.riskLevel === 'low' ? 'green' : 'orange'}>
                  {t('provider.skills.market.risk', { level: skillData.riskLevel })}
                </Tag>
              )}
              {skillData.scanVerdict && <Tag color="blue">{skillData.scanVerdict}</Tag>}
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </Flexbox>

      {/* Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        style={{ padding: '0 24px' }}
        items={[
          {
            key: 'overview',
            label: (
              <Flexbox horizontal gap={6} align="center">
                <BookOpen size={14} />
                <span>{t('provider.skills.detail.overview')}</span>
              </Flexbox>
            ),
            children: loading ? (
              <Spin style={{ display: 'block', margin: '40px auto' }} />
            ) : (
              <MarketSkillOverview detail={detail} token={token} />
            ),
          },
          {
            key: 'content',
            label: (
              <Flexbox horizontal gap={6} align="center">
                <Code2 size={14} />
                <span>SKILL.md</span>
              </Flexbox>
            ),
            children: loading ? (
              <Spin style={{ display: 'block', margin: '40px auto' }} />
            ) : (
              <MarketSkillContent detail={detail} token={token} />
            ),
          },
        ]}
      />
    </Modal>
  );
}

function MarketSkillOverview({ detail }: { detail: MarketSkillDetail | null; token?: any }) {
  const { t } = useTranslation('provider');
  if (!detail) return <Empty description={t('common.state.loading', { ns: 'common' })} />;

  const sections = parseSkillProtocol(detail.content);

  return (
    <Flexbox gap={16} style={{ paddingBottom: 24 }}>
      {/* Markdown content */}
      {sections.body && (
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          <LazyMarkdown {...chatMarkdownProps} fontSize={14}>{sections.body}</LazyMarkdown>
        </div>
      )}

      {detail.author && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <Flexbox gap={4}>
            <Text strong style={{ fontSize: 12 }}>{t('provider.skills.detail.developedBy')}</Text>
            <Flexbox horizontal gap={6} align="center">
              <Text>{detail.author}</Text>
              {detail.authorUrl && (
                <a href={detail.authorUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={12} />
                </a>
              )}
            </Flexbox>
          </Flexbox>
        </>
      )}

      <Divider style={{ margin: '8px 0' }} />
      <Text strong style={{ fontSize: 12 }}>{t('provider.skills.detail.details')}</Text>
      <Descriptions column={2} size="small" bordered={false}>
        {detail.version && (
          <Descriptions.Item label={t('provider.skills.detail.version')}>{detail.version}</Descriptions.Item>
        )}
        {detail.license && (
          <Descriptions.Item label={t('provider.skills.detail.license')}>{detail.license}</Descriptions.Item>
        )}
        {detail.author && (
          <Descriptions.Item label={t('provider.skills.detail.author')}>{detail.author}</Descriptions.Item>
        )}
        {detail.publisher && (
          <Descriptions.Item label={t('provider.skills.market.publisher')}>{detail.publisher}</Descriptions.Item>
        )}
        {detail.repository && (
          <Descriptions.Item label={t('provider.skills.market.repository')}>
            <a href={detail.repository} target="_blank" rel="noopener noreferrer">{detail.repository}</a>
          </Descriptions.Item>
        )}
        {detail.homepage && (
          <Descriptions.Item label={t('provider.skills.market.homepage')}>
            <a href={detail.homepage} target="_blank" rel="noopener noreferrer">{detail.homepage}</a>
          </Descriptions.Item>
        )}
      </Descriptions>

      {((detail.keywords?.length ?? 0) > 0 || (detail.tags?.length ?? 0) > 0) && (
        <Flexbox horizontal gap={4} wrap="wrap">
          {(detail.tags || []).map(t => <Tag key={t} color="blue">{t}</Tag>)}
          {(detail.keywords || []).map(kw => <Tag key={kw}>{kw}</Tag>)}
        </Flexbox>
      )}
    </Flexbox>
  );
}

function MarketSkillContent({ detail, token }: { detail: MarketSkillDetail | null; token: any }) {
  const { t } = useTranslation('provider');
  if (!detail) return <Empty description={t('common.state.loading', { ns: 'common' })} />;

  return (
    <Flexbox gap={12} style={{ paddingBottom: 24 }}>
      <Card
        size="small"
        style={{ borderColor: token.colorBorderSecondary }}
      >
        <div style={{
          maxHeight: 500,
          overflow: 'auto',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          fontSize: 12,
          lineHeight: 1.6,
        }}>
          {detail.content}
        </div>
      </Card>
    </Flexbox>
  );
}

// ────────────────────────────────────────────────────────
// Existing components (SkillCard, ImportFromAddressModal, etc.)
// ────────────────────────────────────────────────────────

function SkillCard({
  skill,
  onToggle,
  onDelete,
  onDetail,
  token,
}: {
  skill: SkillListItem;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onDetail: () => void;
  token: any;
}) {
  const { t } = useTranslation('provider');
  const sourceColors: Record<string, string> = {
    url: 'cyan',
    github: 'purple',
    zip: 'orange',
    user: 'green',
    market: 'blue',
  };

  return (
    <Card
      size="small"
      hoverable
      style={{ borderColor: token.colorBorderSecondary, cursor: 'default' }}
    >
      <Flexbox horizontal justify="space-between" align="center">
        <Flexbox
          horizontal gap={12} align="center"
          style={{ cursor: 'pointer', flex: 1 }}
          onClick={onDetail}
        >
          <span style={{ fontSize: 20 }}>{skill.metaAvatar || '📄'}</span>
          <Flexbox>
            <Flexbox horizontal gap={6} align="center">
              <Text strong>{skill.metaTitle || skill.name}</Text>
              {skill.version && (
                <Text type="secondary" style={{ fontSize: 11 }}>v{skill.version}</Text>
              )}
            </Flexbox>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {skill.description || skill.identifier}
            </Text>
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal gap={8} align="center">
          {skill.metaTags?.slice(0, 2).map((tag) => (
            <Tag key={tag} style={{ fontSize: 11, margin: 0 }}>{tag}</Tag>
          ))}
          {skill.useCount > 0 && (
            <Tag color="gold" style={{ margin: 0 }}>
              {t('provider.skills.usedCount', { count: skill.useCount })}
            </Tag>
          )}
          <Tag color={sourceColors[skill.source] || 'default'} style={{ margin: 0 }}>
            {skill.source}
          </Tag>
          {skill.trustLevel && (
            <Tag color="cyan" style={{ margin: 0 }}>
              {skill.trustLevel}
            </Tag>
          )}
          {skill.scanVerdict && (
            <Tag color={skill.scanVerdict === 'safe' ? 'green' : 'orange'} style={{ margin: 0 }}>
              {skill.scanVerdict}
            </Tag>
          )}
          <Tooltip title={skill.enabled ? t('common.action.disable', { ns: 'common' }) : t('common.action.enable', { ns: 'common' })}>
            <Switch
              size="small"
              checked={skill.enabled}
              onChange={(checked) => onToggle(skill.id, checked)}
            />
          </Tooltip>
          <Popconfirm title={t('provider.skills.deleteConfirm')} onConfirm={() => onDelete(skill.id)}>
            <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
          </Popconfirm>
        </Flexbox>
      </Flexbox>
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
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('provider.skills.import.title')}
      open
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={loading}
      okText={t('provider.skills.import.ok')}
    >
      <Flexbox gap={12} style={{ paddingBlock: 12 }}>
        <Text type="secondary">
          {t('provider.skills.import.desc1')}
          <br />
          {t('provider.skills.import.desc2')}
        </Text>
        <Input
          placeholder={t('provider.skills.import.placeholder')}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onPressEnter={handleOk}
          autoFocus
        />
      </Flexbox>
    </Modal>
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
      message.error(e.message);
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
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('provider.skills.zip.title')}
      open
      onCancel={onCancel}
      footer={
        <Flexbox horizontal justify="flex-end" gap={8}>
          <Button onClick={onCancel}>{t('provider.skills.zip.cancel')}</Button>
          <Button loading={loading} onClick={handleValidate} disabled={!file || stage === 'importing'}>
            {t('provider.skills.zip.validate')}
          </Button>
          <Button type="primary" loading={loading} onClick={handleImport} disabled={!validation?.valid || stage !== 'ready'}>
            {t('provider.skills.zip.import')}
          </Button>
        </Flexbox>
      }
    >
      <Flexbox gap={12} style={{ paddingBlock: 12 }}>
        <Text type="secondary">
          {t('provider.skills.zip.desc')}
        </Text>
        <Upload
          accept=".zip"
          maxCount={1}
          beforeUpload={(nextFile) => {
            setFile(nextFile);
            setValidation(null);
            setStage('idle');
            setProgress(0);
            return false;
          }}
          onRemove={() => {
            setFile(null);
            setValidation(null);
            setStage('idle');
            setProgress(0);
          }}
        >
          <Button icon={<UploadIcon size={14} />}>{t('provider.skills.zip.selectZip')}</Button>
        </Upload>
        {file && <Text type="secondary">{t('provider.skills.zip.selected', { name: file.name })}</Text>}
        {(stage === 'validating' || stage === 'ready' || stage === 'importing') && (
          <Progress percent={progress} status={validation?.valid === false ? 'exception' : 'active'} />
        )}
        {validation && (
          <Alert
            type={validation.valid ? 'success' : 'error'}
            message={validation.valid ? t('provider.skills.zip.validated', { name: validation.skillName || validation.skillPath }) : validation.error || t('provider.skills.zip.invalidFormat')}
          />
        )}
      </Flexbox>
    </Modal>
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
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('provider.skills.createModal.title')}
      open
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={loading}
      okText={t('provider.skills.createModal.ok')}
      width={640}
    >
      <Flexbox gap={12} style={{ paddingBlock: 12 }}>
        <Input
          placeholder={t('provider.skills.createModal.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('provider.skills.createModal.formatDesc')}
        </Text>
        <TextArea
          rows={14}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
        />
      </Flexbox>
    </Modal>
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
  const { token } = theme.useToken();
  const [skill, setSkill] = useState<SkillRecord | BuiltinSkillRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const [versions, setVersions] = useState<SkillVersionItem[]>([]);
  const [versionTotal, setVersionTotal] = useState(0);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [rollbackVersion, setRollbackVersion] = useState<number | null>(null);
  const canEdit = detail.kind === 'installed';

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
      message.success(t('provider.skills.detail.updated'));
      setEditing(false);
      if (detail.kind === 'installed') {
        await loadInstalledSkill();
        await loadVersions();
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleRollback = async (version: number) => {
    setRollbackVersion(version);
    try {
      await api.rollbackSkill(detail.key, version);
      message.success(t('provider.skills.detail.rollbackSuccess', { version }));
      await loadInstalledSkill();
      await loadVersions();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setRollbackVersion(null);
    }
  };

  if (!skill) return null;
  const installedSkill = 'resourceTree' in skill ? skill : null;

  return (
    <Modal
      title={installedSkill?.metaTitle || skill.name}
      open
      onCancel={onClose}
      width={700}
      footer={
        editing && canEdit ? (
          <Flexbox horizontal gap={8} justify="flex-end">
            <Button onClick={() => setEditing(false)}>{t('provider.skills.detail.cancel')}</Button>
            <Button type="primary" onClick={handleSave}>{t('provider.skills.detail.save')}</Button>
          </Flexbox>
        ) : (
          <Button onClick={() => setEditing(true)} icon={<Edit size={14} />} disabled={!canEdit}>
            {t('provider.skills.detail.editContent')}
          </Button>
        )
      }
    >
      <Flexbox gap={12} style={{ paddingBlock: 8 }}>
        <Flexbox horizontal gap={8} wrap="wrap">
          {installedSkill?.source && <Tag color="blue">{installedSkill.source}</Tag>}
          {installedSkill?.trustLevel && <Tag color="cyan">{installedSkill.trustLevel}</Tag>}
          {installedSkill?.scanVerdict && <Tag color={installedSkill.scanVerdict === 'safe' ? 'green' : 'orange'}>{installedSkill.scanVerdict}</Tag>}
          {installedSkill?.version && <Tag>v{installedSkill.version}</Tag>}
          {installedSkill?.license && <Tag color="green">{installedSkill.license}</Tag>}
          {installedSkill?.authorName && <Tag>by {installedSkill.authorName}</Tag>}
          {skill.useCount > 0 && <Tag color="gold">used {skill.useCount}</Tag>}
        </Flexbox>

        {skill.description && (
          <Text type="secondary">{skill.description}</Text>
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
          <Flexbox horizontal gap={4} wrap="wrap">
            <Text type="secondary" style={{ fontSize: 12 }}>{t('provider.skills.detail.keywords')}</Text>
            {skill.keywords.map((kw: string) => (
              <Tag key={kw} style={{ fontSize: 11 }}>{kw}</Tag>
            ))}
          </Flexbox>
        )}

        {editing ? (
          <TextArea
            rows={16}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
        ) : (
          <SkillProtocolPreview skill={skill} content={skill.content} token={token} />
        )}
      </Flexbox>
    </Modal>
  );
}

function SkillProtocolPreview({ skill, content, token }: { skill: SkillRecord | BuiltinSkillRecord; content: string; token: any }) {
  const { t } = useTranslation('provider');
  const sections = parseSkillProtocol(content);
  return (
    <Flexbox gap={12}>
      {'resourceTree' in skill && skill.resourceTree && (
        <SkillResourceTreePanel skill={skill} token={token} />
      )}
      <Card size="small" style={{ borderColor: token.colorBorderSecondary }}>
        <Text strong>{t('provider.skills.detail.manifest')}</Text>
        <div className="selectable" style={{ marginTop: 8, fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {sections.frontmatter || t('provider.skills.detail.noFrontmatter')}
        </div>
      </Card>
      <Card size="small" style={{ borderColor: token.colorBorderSecondary }}>
        <Text strong>{t('provider.skills.detail.content')}</Text>
        <div className="selectable" style={{ marginTop: 8, maxHeight: 360, overflow: 'auto' }}>
          <LazyMarkdown {...chatMarkdownProps} fontSize={14}>{sections.body || ''}</LazyMarkdown>
        </div>
      </Card>
      <Card size="small" style={{ borderColor: token.colorBorderSecondary }}>
        <Text strong>{t('provider.skills.detail.rawProtocol')}</Text>
        <div className="selectable" style={{ marginTop: 8, maxHeight: 220, overflow: 'auto', fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {content}
        </div>
      </Card>
    </Flexbox>
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
    <Card size="small">
      <Flexbox gap={10}>
        <Flexbox horizontal justify="space-between" align="center">
          <Flexbox horizontal gap={8} align="center">
            <History size={14} />
            <Text strong>{t('provider.skills.detail.versions')}</Text>
            <Tag>v{currentVersion}</Tag>
            <Tag>{t('provider.skills.detail.versionTotal', { total })}</Tag>
          </Flexbox>
          <Button type="text" size="small" icon={<RefreshCw size={14} />} loading={loading} onClick={onRefresh}>
            {t('provider.skills.detail.refreshVersions')}
          </Button>
        </Flexbox>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('provider.skills.detail.rollbackPolicy')}
        </Text>
        {versions.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('provider.skills.detail.noVersions')} />
        ) : (
          <Flexbox gap={8}>
            {versions.map((version) => {
              const versionNumber = version.version;
              const createdAt = version.created_at || version.createdAt || '';
              const versionId = version.version_id || version.versionId || `${versionNumber}`;
              return (
                <Card key={versionId} size="small" styles={{ body: { padding: 10 } }}>
                  <Flexbox horizontal justify="space-between" align="center" gap={8}>
                    <Flexbox gap={4}>
                      <Flexbox horizontal gap={6} align="center">
                        <Tag color={versionNumber === currentVersion ? 'green' : 'blue'}>
                          v{versionNumber}
                        </Tag>
                        <Tag>{version.trigger}</Tag>
                      </Flexbox>
                      {createdAt && <Text type="secondary" style={{ fontSize: 12 }}>{createdAt}</Text>}
                    </Flexbox>
                    <Popconfirm
                      title={t('provider.skills.detail.rollbackConfirm', { version: versionNumber })}
                      onConfirm={() => onRollback(versionNumber)}
                    >
                      <Button
                        size="small"
                        icon={<RotateCcw size={14} />}
                        loading={rollbackVersion === versionNumber}
                        disabled={versionNumber === currentVersion}
                      >
                        {t('provider.skills.detail.rollback')}
                      </Button>
                    </Popconfirm>
                  </Flexbox>
                </Card>
              );
            })}
          </Flexbox>
        )}
      </Flexbox>
    </Card>
  );
}

function SkillResourceTreePanel({ skill, token }: { skill: SkillRecord; token: any }) {
  const { t } = useTranslation('provider');
  const resources = skill.resourceTree?.resources || [];
  const runtimeLoad = skill.runtimeLoad;

  return (
    <Card size="small" style={{ borderColor: token.colorBorderSecondary }}>
      <Flexbox gap={10}>
        <Flexbox horizontal justify="space-between" align="center">
          <Text strong>{t('provider.skills.detail.resources')}</Text>
          <Tag color="blue">{runtimeLoad?.systemPrompt.policy || 'index-only'}</Tag>
        </Flexbox>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {runtimeLoad?.systemPrompt.description || t('provider.skills.detail.resourcePolicyDesc')}
        </Text>
        <Flexbox horizontal gap={8} wrap="wrap">
          <Tag color="green">
            {t('provider.skills.detail.systemPromptLoads', { count: runtimeLoad?.systemPrompt.loadedResources.length ?? 0 })}
          </Tag>
          <Tag color="purple">
            {t('provider.skills.detail.skillViewLoads', { count: runtimeLoad?.skillView.loadedResources.length ?? 0 })}
          </Tag>
          {runtimeLoad?.skillView.bytes !== undefined && (
            <Tag>{t('provider.skills.detail.resourceBytes', { bytes: runtimeLoad.skillView.bytes })}</Tag>
          )}
        </Flexbox>
        <Flexbox gap={8}>
          {resources.map((resource) => (
            <SkillResourceRow key={resource.id} resource={resource} token={token} />
          ))}
        </Flexbox>
      </Flexbox>
    </Card>
  );
}

function SkillResourceRow({ resource, token }: { resource: SkillResourceNode; token: any }) {
  const { t } = useTranslation('provider');
  const hash = resource.sha256 ? `${resource.sha256.slice(0, 12)}...` : '';

  return (
    <Card
      size="small"
      style={{ borderColor: token.colorBorderSecondary, background: token.colorFillQuaternary }}
      styles={{ body: { padding: 10 } }}
    >
      <Flexbox gap={6}>
        <Flexbox horizontal justify="space-between" align="center">
          <Flexbox horizontal gap={8} align="center">
            <Code2 size={14} />
            <Text strong style={{ fontSize: 13 }}>{resource.path}</Text>
            <Tag>{resource.kind}</Tag>
            {resource.role && <Tag color="cyan">{resource.role}</Tag>}
          </Flexbox>
          <Tag color={resource.loadedAtRuntime ? 'green' : 'default'}>
            {resource.loadedAtRuntime
              ? t('provider.skills.detail.loaded')
              : t('provider.skills.detail.onDemand')}
          </Tag>
        </Flexbox>
        {resource.summary && (
          <Text type="secondary" style={{ fontSize: 12 }}>{resource.summary}</Text>
        )}
        <Flexbox horizontal gap={6} wrap="wrap">
          <Tag>{t('provider.skills.detail.resourceBytes', { bytes: resource.bytes })}</Tag>
          <Tag>{t('provider.skills.detail.resourceLines', { lines: resource.lineCount })}</Tag>
          <Tag>{t('provider.skills.detail.loadTrigger', { trigger: resource.loadTrigger })}</Tag>
          {hash && <Tag>{t('provider.skills.detail.sha256', { hash })}</Tag>}
        </Flexbox>
      </Flexbox>
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
