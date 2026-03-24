import { useCallback, useEffect, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import {
  Alert, Avatar, Button, Card, Descriptions, Divider, Drawer, Empty, Input, Modal,
  Popconfirm, Progress, Select, Spin, Switch, Tabs, Tag, Tooltip, Typography, Upload, message, theme,
} from 'antd';
import {
  BookOpen, ChevronRight, Code2, Download, Edit, ExternalLink,
  FolderOpen, Link as LinkIcon, Plus, RefreshCw, Search,
  Trash2, Upload as UploadIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  api,
  type BuiltinSkillInfo,
  type MarketSkillDetail,
  type MarketSkillEntry,
  type MarketSummary,
  type SkillImportBatchResult,
  type SkillImportResult,
  type SkillListItem,
  type SkillZipValidation,
} from '../services/desktop_api';
const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

export function SkillsTab() {
  const { token } = theme.useToken();
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [builtins, setBuiltins] = useState<BuiltinSkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('installed');
  const [query, setQuery] = useState('');

  const [importModal, setImportModal] = useState<'source' | 'create' | 'zip' | null>(null);
  const [detail, setDetail] = useState<{ kind: 'installed' | 'builtin'; key: string } | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listSkills();
      setSkills(data.skills);
      setBuiltins(data.builtin);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await api.toggleSkill(id, enabled);
      setSkills((prev) => prev.map((s) => s.id === id ? { ...s, enabled } : s));
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteSkill(id);
      setSkills((prev) => prev.filter((s) => s.id !== id));
      message.success('Skill deleted');
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleImportDone = (result: SkillImportResult | SkillImportBatchResult) => {
    if ('imported' in result) {
      message.success(`Imported ${result.total} skill(s) from ${result.kind}`);
    } else {
      message.success(result.isNew ? `Skill "${result.name}" imported` : `Skill "${result.name}" updated`);
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
    <Flexbox style={{ padding: 24, height: '100%', overflow: 'auto' }} gap={24}>
      <Flexbox horizontal justify="space-between" align="center">
        <Title level={5} style={{ margin: 0 }}>Skills</Title>
        <Flexbox horizontal gap={8}>
          <Button icon={<Plus size={14} />} onClick={() => setImportModal('create')}>
            Create
          </Button>
          <Button icon={<LinkIcon size={14} />} onClick={() => setImportModal('source')}>
            From URL / Git
          </Button>
          <Button icon={<UploadIcon size={14} />} onClick={() => setImportModal('zip')}>
            Upload ZIP
          </Button>
        </Flexbox>
      </Flexbox>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, keyword, description..."
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'installed',
            label: `Installed (${skills.length})`,
            children: (
              <Flexbox gap={12}>
                <Flexbox horizontal justify="flex-start" align="center" gap={8}>
                  <Button
                    size="small"
                    type="text"
                    icon={<FolderOpen size={14} />}
                    onClick={handleOpenDir}
                  >
                    Open Local Directory
                  </Button>
                </Flexbox>
                {filteredInstalled.length === 0 && !loading && (
                  <Empty description="No installed skills yet" />
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
            label: `Built-in (${builtins.length})`,
            children: (
              <Flexbox gap={12}>
                {filteredBuiltins.length === 0 && !loading && (
                  <Empty description="No built-in skills" />
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
                            {s.description || 'Built-in skill'}
                          </Text>
                        </Flexbox>
                      </Flexbox>
                      <Flexbox horizontal gap={4}>
                        {s.useCount > 0 && <Tag color="gold">used {s.useCount}</Tag>}
                        <Tag color="blue">built-in</Tag>
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
            label: 'Market',
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
    </Flexbox>
  );
}

// ────────────────────────────────────────────────────────
// Market Tab
// ────────────────────────────────────────────────────────

function MarketTab({ onInstalled }: { onInstalled: () => void }) {
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
          Browse skill collections from configured repositories.
        </Text>
        <Button icon={<Plus size={14} />} onClick={() => setAddModal(true)} size="small">
          Add Market
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
            description="No markets configured"
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
  const [syncing, setSyncing] = useState(false);

  const handleSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSyncing(true);
    try {
      const result = await api.syncSkillMarket(market.id);
      message.success(`Synced: ${result.total} skill(s) found`);
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
                  {market.synced ? '已同步' : '未同步'}
                </Tag>
                {market.synced && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {market.skillCount} 个 skill
                  </Text>
                )}
              </Flexbox>
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal gap={4}>
            <Tooltip title="Sync">
              <Button
                type="text"
                size="small"
                loading={syncing}
                icon={<RefreshCw size={12} />}
                onClick={handleSync}
              />
            </Tooltip>
            <Popconfirm title="Remove this market?" onConfirm={(e) => { e?.stopPropagation(); onDelete(); }}>
              <Button
                type="text"
                size="small"
                danger
                icon={<Trash2 size={12} />}
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
      message.warning('Git 地址必填');
      return;
    }
    setLoading(true);
    try {
      const br = branch === 'custom' ? branchCustom.trim() || 'main' : branch;
      await api.addSkillMarketSource(url.trim(), name.trim() || undefined, br || undefined);
      message.success('Market 已添加并拉取');
      onDone();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="添加 Skill Market"
      open
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={loading}
      okText="添加并拉取"
    >
      <Flexbox gap={12} style={{ paddingBlock: 12 }}>
        <Text type="secondary">
          配置 Git 仓库地址，系统将使用 git clone 拉取到本地。私有仓库需提前配置 SSH 或 credential，拉取失败时请申请访问权限。
        </Text>
        <Input
          placeholder="Git 地址 (https://... 或 git@...)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
        />
        <Input
          placeholder="Market 名称（默认取 URL 最后一段）"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Flexbox gap={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>分支</Text>
          <Flexbox horizontal gap={8}>
            <Select
              value={branch}
              onChange={setBranch}
              style={{ minWidth: 120 }}
              options={[
                { value: 'main', label: 'main' },
                { value: 'master', label: 'master' },
                { value: 'custom', label: '自定义' },
              ]}
            />
            {branch === 'custom' && (
              <Input
                placeholder="输入分支名"
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
      message.success(`"${entry.name}" installed`);
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
                {skills.length} skill(s) available
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
            prefix={<Search size={14} />}
            placeholder="Search skills by name or keyword, press Enter to search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onPressEnter={loadSkills}
            allowClear
          />

          {loading && <Spin style={{ alignSelf: 'center', marginTop: 40 }} />}

          {!loading && skills.length === 0 && (
            <Empty description="No skills found" />
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
                    </Flexbox>
                  </Flexbox>
                  <Flexbox horizontal gap={8} align="center" style={{ flexShrink: 0 }}>
                    {entry.installed ? (
                      <Tag color="green">Installed</Tag>
                    ) : (
                      <Button
                        type="text"
                        icon={<Plus size={16} />}
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
  installing,
}: {
  marketId: string;
  entry: MarketSkillEntry;
  onClose: () => void;
  onInstall: () => void;
  installing: boolean;
}) {
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
              {entry.installed ? (
                <Tag color="green" style={{ fontSize: 13 }}>Installed</Tag>
              ) : (
                <Button
                  type="primary"
                  icon={<Download size={14} />}
                  onClick={onInstall}
                  loading={installing}
                >
                  Install
                </Button>
              )}
            </Flexbox>
            <Text type="secondary">{skillData.description || skillData.identifier}</Text>
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
                <span>Overview</span>
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
  if (!detail) return <Empty description="Loading..." />;

  const sections = parseSkillProtocol(detail.content);

  return (
    <Flexbox gap={16} style={{ paddingBottom: 24 }}>
      {/* Markdown content */}
      {sections.body && (
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{sections.body}</ReactMarkdown>
        </div>
      )}

      {detail.author && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <Flexbox gap={4}>
            <Text strong style={{ fontSize: 12 }}>Developed by</Text>
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
      <Text strong style={{ fontSize: 12 }}>Details</Text>
      <Descriptions column={2} size="small" bordered={false}>
        {detail.version && (
          <Descriptions.Item label="Version">{detail.version}</Descriptions.Item>
        )}
        {detail.license && (
          <Descriptions.Item label="License">{detail.license}</Descriptions.Item>
        )}
        {detail.author && (
          <Descriptions.Item label="Author">{detail.author}</Descriptions.Item>
        )}
      </Descriptions>

      {(detail.keywords?.length > 0 || detail.tags?.length > 0) && (
        <Flexbox horizontal gap={4} wrap="wrap">
          {(detail.tags || []).map(t => <Tag key={t} color="blue">{t}</Tag>)}
          {(detail.keywords || []).map(kw => <Tag key={kw}>{kw}</Tag>)}
        </Flexbox>
      )}
    </Flexbox>
  );
}

function MarketSkillContent({ detail, token }: { detail: MarketSkillDetail | null; token: any }) {
  if (!detail) return <Empty description="Loading..." />;

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
              used {skill.useCount}
            </Tag>
          )}
          <Tag color={sourceColors[skill.source] || 'default'} style={{ margin: 0 }}>
            {skill.source}
          </Tag>
          <Tooltip title={skill.enabled ? 'Disable' : 'Enable'}>
            <Switch
              size="small"
              checked={skill.enabled}
              onChange={(checked) => onToggle(skill.id, checked)}
            />
          </Tooltip>
          <Popconfirm title="Delete this skill?" onConfirm={() => onDelete(skill.id)}>
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
      title="Import Skill from URL / Git"
      open
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={loading}
      okText="Import"
    >
      <Flexbox gap={12} style={{ paddingBlock: 12 }}>
        <Text type="secondary">
          1. SKILL.md direct link (raw file address)
          <br />
          2. Git repository address. Supports git/http. Please ensure you have pull access locally.
        </Text>
        <Input
          placeholder="https://code.byted.org/org/repo.git or git@code.byted.org:org/repo.git"
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
      title="Upload Skill ZIP"
      open
      onCancel={onCancel}
      footer={
        <Flexbox horizontal justify="flex-end" gap={8}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button loading={loading} onClick={handleValidate} disabled={!file || stage === 'importing'}>
            Validate
          </Button>
          <Button type="primary" loading={loading} onClick={handleImport} disabled={!validation?.valid || stage !== 'ready'}>
            Import
          </Button>
        </Flexbox>
      }
    >
      <Flexbox gap={12} style={{ paddingBlock: 12 }}>
        <Text type="secondary">
          ZIP 结构要求：根目录或单层目录下仅包含一个 SKILL.md，内容需符合标准 frontmatter + markdown body。
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
          <Button icon={<UploadIcon size={14} />}>Select ZIP</Button>
        </Upload>
        {file && <Text type="secondary">Selected: {file.name}</Text>}
        {(stage === 'validating' || stage === 'ready' || stage === 'importing') && (
          <Progress percent={progress} status={validation?.valid === false ? 'exception' : 'active'} />
        )}
        {validation && (
          <Alert
            type={validation.valid ? 'success' : 'error'}
            message={validation.valid ? `Validated: ${validation.skillName || validation.skillPath}` : validation.error || 'Invalid zip format'}
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
      title="Create Custom Skill"
      open
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={loading}
      okText="Create"
      width={640}
    >
      <Flexbox gap={12} style={{ paddingBlock: 12 }}>
        <Input
          placeholder="Skill name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          Use SKILL.md format: YAML frontmatter (name, description, keywords, etc.) followed by Markdown body.
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
  const { token } = theme.useToken();
  const [skill, setSkill] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const canEdit = detail.kind === 'installed';

  useEffect(() => {
    const load = async () => {
      const data = detail.kind === 'installed'
        ? await api.getSkill(detail.key)
        : await api.getBuiltinSkill(detail.key);
      setSkill(data);
      setContent(data.content || '');
    };
    load().catch(console.error);
  }, [detail]);

  const handleSave = async () => {
    try {
      await api.updateSkill(detail.key, { content });
      message.success('Skill updated');
      setEditing(false);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  if (!skill) return null;

  return (
    <Modal
      title={skill.metaTitle || skill.name}
      open
      onCancel={onClose}
      width={700}
      footer={
        editing && canEdit ? (
          <Flexbox horizontal gap={8} justify="flex-end">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="primary" onClick={handleSave}>Save</Button>
          </Flexbox>
        ) : (
          <Button onClick={() => setEditing(true)} icon={<Edit size={14} />} disabled={!canEdit}>
            Edit Content
          </Button>
        )
      }
    >
      <Flexbox gap={12} style={{ paddingBlock: 8 }}>
        <Flexbox horizontal gap={8} wrap="wrap">
          {skill.source && <Tag color="blue">{skill.source}</Tag>}
          {skill.version && <Tag>v{skill.version}</Tag>}
          {skill.license && <Tag color="green">{skill.license}</Tag>}
          {skill.authorName && <Tag>by {skill.authorName}</Tag>}
          {skill.useCount > 0 && <Tag color="gold">used {skill.useCount}</Tag>}
        </Flexbox>

        {skill.description && (
          <Text type="secondary">{skill.description}</Text>
        )}

        {skill.keywords?.length > 0 && (
          <Flexbox horizontal gap={4} wrap="wrap">
            <Text type="secondary" style={{ fontSize: 12 }}>Keywords: </Text>
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
          <SkillProtocolPreview content={skill.content} token={token} />
        )}
      </Flexbox>
    </Modal>
  );
}

function SkillProtocolPreview({ content, token }: { content: string; token: any }) {
  const sections = parseSkillProtocol(content);
  return (
    <Flexbox gap={12}>
      <Card size="small" style={{ borderColor: token.colorBorderSecondary }}>
        <Text strong>Manifest</Text>
        <div style={{ marginTop: 8, fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {sections.frontmatter || 'No frontmatter'}
        </div>
      </Card>
      <Card size="small" style={{ borderColor: token.colorBorderSecondary }}>
        <Text strong>Content</Text>
        <div style={{ marginTop: 8, maxHeight: 360, overflow: 'auto' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{sections.body || ''}</ReactMarkdown>
        </div>
      </Card>
      <Card size="small" style={{ borderColor: token.colorBorderSecondary }}>
        <Text strong>Raw Protocol</Text>
        <div style={{ marginTop: 8, maxHeight: 220, overflow: 'auto', fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {content}
        </div>
      </Card>
    </Flexbox>
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
