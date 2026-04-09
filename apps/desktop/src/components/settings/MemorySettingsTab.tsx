import { useCallback, useEffect, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import {
  Form,
  InputNumber,
  message,
  Modal,
  Select,
  Spin,
  Switch,
  Typography,
  theme,
} from 'antd';
import { Alert, Button, Tag, Tooltip, TextArea } from '@lobehub/ui';
import {
  CheckCircle2,
  CircleDot,
  Database,
  HelpCircle,
  RotateCcw,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  api,
  type ConfigFieldMeta,
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

interface EmbeddingOption {
  provider_id: string;
  provider_name: string;
  model_id: string;
  model_name: string;
}

export function MemorySettingsTab() {
  const { token } = theme.useToken();
  const [memoryData, setMemoryData] = useState<SectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [embeddingOptions, setEmbeddingOptions] = useState<EmbeddingOption[]>([]);
  const [currentEmbedding, setCurrentEmbedding] = useState<string | undefined>(undefined);

  const [pgTesting, setPgTesting] = useState(false);
  const [pgTestResult, setPgTestResult] = useState<{ ok: boolean; has_pgvector?: boolean; error?: string } | null>(null);

  const [memoryForm] = Form.useForm();

  const storageValue = Form.useWatch('storage', memoryForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mem, embeddingResult] = await Promise.all([
        api.getConfigSection('memory'),
        api.listEmbeddingModels(),
      ]);

      setMemoryData(mem);

      const options: EmbeddingOption[] = (embeddingResult.models || []).map(m => ({
        provider_id: m.provider,
        provider_name: m.provider,
        model_id: m.id,
        model_name: m.name || m.id,
      }));
      setEmbeddingOptions(options);

      const savedEmbedding = mem.embedding_model?.value;
      setCurrentEmbedding(savedEmbedding || undefined);

      memoryForm.setFieldsValue({
        enabled: mem.enabled?.value ?? false,
        storage: mem.storage?.value || 'sqlite',
        postgres_dsn: mem.postgres_dsn?.value || '',
        vector_weight: mem.vector_weight?.value ?? 0.7,
        keyword_weight: mem.keyword_weight?.value ?? 0.3,
        embedding_model: savedEmbedding || undefined,
        tuning_enabled: mem.tuning_enabled?.value ?? false,
      });
    } catch {
      message.error('Failed to load config');
    } finally {
      setLoading(false);
    }
  }, [memoryForm]);

  useEffect(() => { load(); }, [load]);

  const hasAnyCustom = (data: SectionData | null) =>
    data ? Object.values(data).some((f) => f.source === 'custom') : false;

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

  const handleResetSection = async () => {
    setSaving(true);
    try {
      if (memoryData) {
        for (const field of Object.keys(memoryData)) {
          if (memoryData[field].source === 'custom') await api.resetConfigField('memory', field);
        }
      }
      message.success('Reset to defaults. Restart to apply.');
      await load();
    } catch { message.error('Failed to reset'); }
    finally { setSaving(false); }
  };

  const handleEmbeddingModelChange = (value: string | undefined) => {
    if (!currentEmbedding || !value) {
      return;
    }
    if (value !== currentEmbedding) {
      Modal.confirm({
        title: 'Embedding Model Change',
        content: 'Switching embedding model will invalidate all existing memory vectors. A full re-embedding will be required. Continue?',
        okText: 'Continue',
        cancelText: 'Cancel',
        okButtonProps: { danger: true },
        onCancel: () => {
          memoryForm.setFieldValue('embedding_model', currentEmbedding);
        },
      });
    }
  };

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
    maxWidth: 640,
  };

  const noEmbeddingAvailable = embeddingOptions.length === 0;
  const selectedEmbeddingValue = Form.useWatch('embedding_model', memoryForm);

  return (
    <Flexbox gap={16} style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div style={cardStyle}>
        <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 16 }}>
          <Flexbox horizontal align="center" gap={8}>
            <Database size={16} style={{ color: token.colorPrimary }} />
            <Text strong style={{ fontSize: 15 }}>Memory</Text>
            {hasAnyCustom(memoryData) && <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>customized</Tag>}
          </Flexbox>
          <Flexbox horizontal gap={6}>
            {hasAnyCustom(memoryData) && (
              <Button size="small" icon={<RotateCcw size={12} />} onClick={handleResetSection} loading={saving}>Reset</Button>
            )}
            <Button size="small" type="primary" onClick={handleSaveMemory} loading={saving}>Save</Button>
          </Flexbox>
        </Flexbox>

        <Form form={memoryForm} layout="vertical" size="small" style={{ flex: 1 }}>
          <Form.Item name="enabled" valuePropName="checked" label={
            <Flexbox horizontal align="center" gap={6}><span>Enable Memory System</span>{memoryData?.enabled && <SourceBadge meta={memoryData.enabled} />}</Flexbox>
          }><Switch /></Form.Item>

          <Form.Item name="embedding_model" label={
            <Flexbox horizontal align="center" gap={6}>
              <span>Embedding Model</span>
              <Tooltip title="Select an embedding model from your configured providers. Models with type 'embedding' will appear here.">
                <HelpCircle size={12} style={{ color: token.colorTextQuaternary }} />
              </Tooltip>
            </Flexbox>
          }>
            <Select
              placeholder={noEmbeddingAvailable ? 'No embedding models available' : 'Select embedding model'}
              allowClear
              disabled={noEmbeddingAvailable}
              onChange={handleEmbeddingModelChange}
              options={embeddingOptions.map((opt) => ({
                value: `${opt.provider_id}:${opt.model_id}`,
                label: (
                  <Flexbox horizontal align="center" gap={6}>
                    <span>{opt.model_name}</span>
                    <Tag style={{ fontSize: 10, margin: 0 }}>{opt.provider_name}</Tag>
                  </Flexbox>
                ),
              }))}
              notFoundContent={<Text type="secondary" style={{ fontSize: 12 }}>No embedding models found in your providers</Text>}
            />
          </Form.Item>

          {noEmbeddingAvailable && (
            <Alert
              type="info"
              showIcon
              icon={<Zap size={14} />}
              style={{ marginBottom: 12, fontSize: 12 }}
              message="Full-Text Search Mode"
              description="No embedding models configured. Memory retrieval will use keyword-based full-text search (FTS). To enable semantic search, add a provider with an embedding model in Settings → Providers."
            />
          )}

          {!noEmbeddingAvailable && !selectedEmbeddingValue && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12, fontSize: 12 }}
              message="No embedding model selected"
              description="Memory retrieval will fall back to keyword-based full-text search. Select an embedding model above to enable semantic search."
            />
          )}

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
                <TextArea rows={2} placeholder="postgres://user:pass@host:5432/db?sslmode=disable" style={{ fontFamily: 'monospace', fontSize: 12 }} />
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
        </Form>
      </div>

      <Text type="secondary" style={{ fontSize: 12, maxWidth: 640 }}>
        Changes require a restart to take effect.
      </Text>
    </Flexbox>
  );
}
