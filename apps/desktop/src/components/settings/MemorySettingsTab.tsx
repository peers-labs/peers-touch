import { useCallback, useEffect, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { theme } from 'antd';
import {
  CheckCircle2,
  CircleDot,
  Database,
  HelpCircle,
  RefreshCw,
  RotateCcw,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  api,
  type ConfigFieldMeta,
  type EmbeddingModelInfo,
} from '../../services/desktop_api';

const { Text } = Typography;

type SectionData = Record<string, ConfigFieldMeta>;

function SourceBadge({ meta }: { meta: ConfigFieldMeta }) {
  const { token } = theme.useToken();
  const isCustom = meta.source === 'custom';
  return (
    <Tooltip title={isCustom ? `Customized. Default: ${JSON.stringify(meta.default)}` : 'Config file default'}>
      <CircleDot size={12} style={{ color: isCustom ? token.colorPrimary : token.colorTextQuaternary, cursor: 'help' }} />
    </Tooltip>
  );
}

interface EmbeddingStatus {
  provider: string;
  model: string;
  dimensions: number;
  vector_count: number;
}

export function MemorySettingsTab() {
  const { token } = theme.useToken();
  const [memoryData, setMemoryData] = useState<SectionData | null>(null);
  const [embeddingData, setEmbeddingData] = useState<SectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reembedding, setReembedding] = useState(false);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);

  const [embeddingCatalog, setEmbeddingCatalog] = useState<EmbeddingModelInfo[]>([]);
  const [resolvedEmb, setResolvedEmb] = useState<{ provider_id: string; provider_name: string; model: string }>({ provider_id: '', provider_name: '', model: '' });

  const [pgTesting, setPgTesting] = useState(false);
  const [pgTestResult, setPgTestResult] = useState<{ ok: boolean; has_pgvector?: boolean; error?: string } | null>(null);

  const [memoryForm] = Form.useForm();
  const [embeddingForm] = Form.useForm();

  const storageValue = Form.useWatch('storage', memoryForm);
  const selectedProvider = Form.useWatch('provider', embeddingForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mem, emb, catalog] = await Promise.all([
        api.getConfigSection('memory'),
        api.getConfigSection('embedding'),
        api.listEmbeddingModels(),
      ]);
      setMemoryData(mem);
      setEmbeddingData(emb);
      setEmbeddingCatalog(catalog.models || []);
      setResolvedEmb(catalog.resolved);

      memoryForm.setFieldsValue({
        enabled: mem.enabled?.value ?? false,
        storage: mem.storage?.value || 'sqlite',
        postgres_dsn: mem.postgres_dsn?.value || '',
        vector_weight: mem.vector_weight?.value ?? 0.7,
        keyword_weight: mem.keyword_weight?.value ?? 0.3,
        embedding_dimensions: mem.embedding_dimensions?.value ?? 0,
        tuning_enabled: mem.tuning_enabled?.value ?? false,
      });

      // Use configured values if set, otherwise use resolved defaults
      const cfgProvider = emb.provider?.value || catalog.resolved.provider_id;
      const cfgModel = emb.model?.value || catalog.resolved.model;
      embeddingForm.setFieldsValue({
        provider: cfgProvider,
        model: cfgModel,
      });

      api.getEmbeddingStatus().then(setEmbeddingStatus).catch(() => {});
    } catch {
      message.error('Failed to load config');
    } finally {
      setLoading(false);
    }
  }, [memoryForm, embeddingForm]);

  useEffect(() => { load(); }, [load]);

  // Derive unique providers from catalog
  const catalogProviders = useMemo(() => {
    const seen = new Set<string>();
    return embeddingCatalog
      .map((m) => m.provider)
      .filter((p) => { if (seen.has(p)) return false; seen.add(p); return true; });
  }, [embeddingCatalog]);

  // Models filtered by selected provider
  const providerModels = useMemo(() => {
    if (!selectedProvider) return [];
    return embeddingCatalog.filter((m) => m.provider === selectedProvider);
  }, [embeddingCatalog, selectedProvider]);

  const hasAnyCustom = (data: SectionData | null) =>
    data ? Object.values(data).some((f) => f.source === 'custom') : false;

  // ── Memory ──

  const handleSaveMemory = async () => {
    setSaving(true);
    try {
      const values = { ...memoryForm.getFieldsValue() };
      if (values.storage !== 'postgres') delete values.postgres_dsn;
      await api.setConfigSection('memory', values);
      message.success('Memory config saved. Restart to apply.');
      await load();
    } catch { message.error('Failed to save'); }
    finally { setSaving(false); }
  };

  const handleResetSection = async (section: string) => {
    setSaving(true);
    try {
      const data = section === 'memory' ? memoryData : embeddingData;
      if (data) {
        for (const field of Object.keys(data)) {
          if (data[field].source === 'custom') await api.resetConfigField(section, field);
        }
      }
      message.success('Reset to defaults. Restart to apply.');
      await load();
    } catch { message.error('Failed to reset'); }
    finally { setSaving(false); }
  };

  // ── Embedding ──

  const handleSaveEmbedding = async () => {
    const values = embeddingForm.getFieldsValue();
    const newModel = values.model || '';
    const currentModel = embeddingStatus?.model || resolvedEmb.model || '—';
    const hasVectors = (embeddingStatus?.vector_count ?? 0) > 0;
    const modelChanged = newModel !== currentModel && currentModel !== '';

    if (modelChanged && hasVectors) {
      const newInfo = embeddingCatalog.find((m) => m.id === newModel);
      const oldInfo = embeddingCatalog.find((m) => m.id === currentModel);
      message.warning({
        content: (
          <Flexbox gap={4}>
            <Text strong>Embedding model changed</Text>
            <Text style={{ fontSize: 13 }}>
              From {oldInfo?.name || currentModel} → {newInfo?.name || newModel}
              {newInfo ? ` (${newInfo.dimensions}d)` : ''}
            </Text>
            <Text type="warning" style={{ fontSize: 13 }}>
              {embeddingStatus?.vector_count.toLocaleString()} existing vectors will NOT be migrated.
              Only new memories will use the new model. Use "Re-embed All" after restart to recompute old vectors.
            </Text>
          </Flexbox>
        ),
        duration: 8,
      });
    }

    setSaving(true);
    try {
      await api.setConfigSection('embedding', values);
      message.success('Embedding config saved. Restart to apply.');
      await load();
    } catch { message.error('Failed to save'); }
    finally { setSaving(false); }
  };

  // ── Re-embed ──

  const handleReEmbed = async () => {
    const count = embeddingStatus?.vector_count ?? 0;
    setReembedding(true);
    try {
      const result = await api.reEmbed();
      message.success(`Re-embedded ${result.reembedded_count} / ${count} memories.`);
      await load();
    } catch { message.error('Re-embedding failed.'); }
    finally { setReembedding(false); }
  };

  // ── PG test ──

  const handleTestPg = async () => {
    const dsn = memoryForm.getFieldValue('postgres_dsn');
    if (!dsn) { message.warning('Enter a PostgreSQL DSN first'); return; }
    setPgTesting(true);
    setPgTestResult(null);
    try { setPgTestResult(await api.testPostgresConnection(dsn)); }
    catch { setPgTestResult({ ok: false, error: 'Request failed' }); }
    finally { setPgTesting(false); }
  };

  if (loading) return <Flexbox align="center" justify="center" style={{ padding: 60 }}><Spin /></Flexbox>;

  const cardStyle: React.CSSProperties = {
    padding: 20,
    background: token.colorBgContainer,
    borderRadius: 12,
    border: `1px solid ${token.colorBorderSecondary}`,
    display: 'flex',
    flexDirection: 'column',
  };

  return (
    <Flexbox gap={16} style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'stretch' }}>

        {/* ─── Memory ─── */}
        <div style={cardStyle}>
          <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 16 }}>
            <Flexbox horizontal align="center" gap={8}>
              <Database size={16} style={{ color: token.colorPrimary }} />
              <Text strong style={{ fontSize: 15 }}>Memory</Text>
              {hasAnyCustom(memoryData) && <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>customized</Tag>}
            </Flexbox>
            <Flexbox horizontal gap={6}>
              {hasAnyCustom(memoryData) && (
                <Button size="small" icon={<RotateCcw size={12} />} onClick={() => handleResetSection('memory')} loading={saving}>Reset</Button>
              )}
              <Button size="small" type="primary" onClick={handleSaveMemory} loading={saving}>Save</Button>
            </Flexbox>
          </Flexbox>

          <Form form={memoryForm} layout="vertical" size="small" style={{ flex: 1 }}>
            <Form.Item name="enabled" valuePropName="checked" label={
              <Flexbox horizontal align="center" gap={6}><span>Enable Memory System</span>{memoryData?.enabled && <SourceBadge meta={memoryData.enabled} />}</Flexbox>
            }><Switch /></Form.Item>
            <Form.Item name="tuning_enabled" valuePropName="checked" label={
              <Flexbox horizontal align="center" gap={6}>
                <span>调优</span>
                {memoryData?.tuning_enabled && <SourceBadge meta={memoryData.tuning_enabled} />}
                <Tooltip title="开启后会持久化 memory 命中过程（检索命中摘要与评分），用于调优分析。">
                  <HelpCircle size={12} style={{ color: token.colorTextQuaternary }} />
                </Tooltip>
              </Flexbox>
            }><Switch /></Form.Item>

            <Form.Item name="storage" label={
              <Flexbox horizontal align="center" gap={6}><span>Storage Backend</span>{memoryData?.storage && <SourceBadge meta={memoryData.storage} />}</Flexbox>
            }>
              <Select options={[
                { value: 'sqlite', label: 'SQLite (zero-config)' },
                { value: 'postgres', label: 'PostgreSQL + pgvector' },
              ]} />
            </Form.Item>

            {storageValue === 'postgres' && (
              <>
                <Form.Item name="postgres_dsn" label={
                  <Flexbox horizontal align="center" gap={6}><span>Connection String</span>{memoryData?.postgres_dsn && <SourceBadge meta={memoryData.postgres_dsn} />}</Flexbox>
                }>
                  <Input.TextArea rows={2} placeholder="postgres://user:pass@host:5432/db?sslmode=disable" style={{ fontFamily: 'monospace', fontSize: 12 }} />
                </Form.Item>
                <Flexbox horizontal gap={8} align="center" style={{ marginBottom: 12 }}>
                  <Button size="small" icon={<Zap size={12} />} onClick={handleTestPg} loading={pgTesting}>Test</Button>
                  {pgTestResult && (pgTestResult.ok ? (
                    <Flexbox horizontal align="center" gap={4}>
                      <CheckCircle2 size={14} style={{ color: token.colorSuccess }} />
                      <Text style={{ fontSize: 12, color: token.colorSuccess }}>Connected{pgTestResult.has_pgvector ? ' · pgvector OK' : ''}</Text>
                      {!pgTestResult.has_pgvector && <Tag color="warning" style={{ fontSize: 10 }}>pgvector missing</Tag>}
                    </Flexbox>
                  ) : (
                    <Flexbox horizontal align="center" gap={4}>
                      <XCircle size={14} style={{ color: token.colorError }} />
                      <Text style={{ fontSize: 12, color: token.colorError }}>{pgTestResult.error}</Text>
                    </Flexbox>
                  ))}
                </Flexbox>
                <Alert type="warning" showIcon style={{ marginBottom: 12, fontSize: 12 }} message="No data migration" description="Switching backend does not migrate existing memories." />
              </>
            )}

            <Flexbox horizontal gap={16}>
              <Form.Item name="vector_weight" label={
                <Flexbox horizontal align="center" gap={6}><span>Vector Weight</span>{memoryData?.vector_weight && <SourceBadge meta={memoryData.vector_weight} />}</Flexbox>
              } style={{ flex: 1 }}>
                <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="keyword_weight" label={
                <Flexbox horizontal align="center" gap={6}><span>Keyword Weight</span>{memoryData?.keyword_weight && <SourceBadge meta={memoryData.keyword_weight} />}</Flexbox>
              } style={{ flex: 1 }}>
                <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Flexbox>

            <Form.Item name="embedding_dimensions" label={
              <Flexbox horizontal align="center" gap={6}>
                <span>Embedding Dimensions</span>
                {memoryData?.embedding_dimensions && <SourceBadge meta={memoryData.embedding_dimensions} />}
                <Tooltip title="0 = auto-detect from model."><HelpCircle size={12} style={{ color: token.colorTextQuaternary }} /></Tooltip>
              </Flexbox>
            }>
              <InputNumber min={0} step={1} style={{ width: '100%' }} placeholder="0 (auto)" />
            </Form.Item>
          </Form>
        </div>

        {/* ─── Embedding ─── */}
        <div style={cardStyle}>
          <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 16 }}>
            <Flexbox horizontal align="center" gap={8}>
              <Zap size={16} style={{ color: token.colorPrimary }} />
              <Text strong style={{ fontSize: 15 }}>Embedding</Text>
              {hasAnyCustom(embeddingData) && <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>customized</Tag>}
            </Flexbox>
            <Flexbox horizontal gap={6}>
              {hasAnyCustom(embeddingData) && (
                <Button size="small" icon={<RotateCcw size={12} />} onClick={() => handleResetSection('embedding')} loading={saving}>Reset</Button>
              )}
              <Button size="small" type="primary" onClick={handleSaveEmbedding} loading={saving}>Save</Button>
            </Flexbox>
          </Flexbox>

          {/* Resolved (effective) embedding — always show */}
          <Flexbox gap={4} style={{ padding: '10px 12px', borderRadius: 8, background: token.colorFillQuaternary, border: `1px solid ${token.colorBorderSecondary}`, marginBottom: 16 }}>
            <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Currently In Use</Text>
            <Flexbox horizontal gap={6} wrap="wrap" align="center">
              <Tag color="blue">{resolvedEmb.provider_name || resolvedEmb.provider_id || 'Not configured'}</Tag>
              <Tag color="cyan">{resolvedEmb.model || '—'}</Tag>
              {embeddingStatus && <>
                <Tag>{embeddingStatus.dimensions || 'auto'}d</Tag>
                <Tag color="purple">{embeddingStatus.vector_count.toLocaleString()} vectors</Tag>
              </>}
            </Flexbox>
          </Flexbox>

          <Form form={embeddingForm} layout="vertical" size="small" style={{ flex: 1 }}>
            <Form.Item name="provider" label={
              <Flexbox horizontal align="center" gap={6}>
                <span>Provider</span>
                {embeddingData?.provider && <SourceBadge meta={embeddingData.provider} />}
                <Tooltip title="Must match a configured provider in Settings → Providers.">
                  <HelpCircle size={12} style={{ color: token.colorTextQuaternary }} />
                </Tooltip>
              </Flexbox>
            }>
              <Select
                placeholder="Select embedding provider"
                options={catalogProviders.map((p) => ({ value: p, label: p }))}
                onChange={() => {
                  // Clear model when provider changes — model must follow provider
                  embeddingForm.setFieldValue('model', undefined);
                }}
              />
            </Form.Item>

            <Form.Item name="model" label={
              <Flexbox horizontal align="center" gap={6}>
                <span>Model</span>
                {embeddingData?.model && <SourceBadge meta={embeddingData.model} />}
                <Tooltip title="Changing model after vectors exist requires re-embedding.">
                  <HelpCircle size={12} style={{ color: token.colorTextQuaternary }} />
                </Tooltip>
              </Flexbox>
            }>
              {selectedProvider ? (
                <Select
                  placeholder="Select a model"
                  showSearch
                  allowClear
                  filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
                  options={providerModels.map((m) => ({
                    value: m.id,
                    label: `${m.name} (${m.dimensions}d)`,
                  }))}
                  notFoundContent={<Text type="secondary" style={{ fontSize: 12 }}>No embedding models for this provider</Text>}
                />
              ) : (
                <Select disabled placeholder="Select a provider first" />
              )}
            </Form.Item>
          </Form>

          {/* Re-embed at the bottom */}
          {embeddingStatus && embeddingStatus.vector_count > 0 && (
            <Flexbox gap={8} style={{ padding: 12, borderRadius: 8, background: token.colorFillQuaternary, border: `1px solid ${token.colorBorderSecondary}`, marginTop: 'auto' }}>
              <Flexbox horizontal align="center" justify="space-between">
                <Flexbox gap={2}>
                  <Text strong style={{ fontSize: 13 }}>Vector Re-alignment</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {embeddingStatus.vector_count.toLocaleString()} vectors · {embeddingStatus.model || resolvedEmb.model || '—'} · {embeddingStatus.dimensions || 'auto'}d
                  </Text>
                </Flexbox>
                <Button size="small" icon={<RefreshCw size={12} />} onClick={handleReEmbed} loading={reembedding}>Re-embed All</Button>
              </Flexbox>
            </Flexbox>
          )}
        </div>
      </div>

      <Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
        Changes require a restart to take effect. Config file values are used as defaults.
      </Text>
    </Flexbox>
  );
}
