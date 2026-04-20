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
  Check,
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
import { SettingsContainer, SettingsSection } from './SettingsLayout';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

type SectionData = Record<string, ConfigFieldMeta>;

function SourceBadge({ meta, t }: { meta: ConfigFieldMeta; t: (key: string, opts?: Record<string, unknown>) => string }) {
  const { token } = theme.useToken();
  const isCustom = meta.source === 'custom';
  return (
    <Tooltip title={isCustom ? t('provider.memory.customizedDefault', { value: JSON.stringify(meta.default) }) : t('provider.memory.configDefault')}>
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
  const { t } = useTranslation('provider');
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
      message.error(t('provider.memory.failedToLoad'));
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
      message.success(t('provider.memory.savedRestart'));
      await load();
    } catch { message.error(t('provider.memory.failedToSave')); }
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
      message.success(t('provider.memory.resetDefaults'));
      await load();
    } catch { message.error(t('provider.memory.failedToReset')); }
    finally { setSaving(false); }
  };

  const handleEmbeddingModelChange = (value: string | undefined) => {
    if (!currentEmbedding || !value) {
      return;
    }
    if (value !== currentEmbedding) {
      Modal.confirm({
        title: t('provider.memory.embeddingChangeTitle'),
        content: t('provider.memory.embeddingChangeContent'),
        okText: t('provider.memory.embeddingChangeContinue'),
        cancelText: t('common.action.cancel', { ns: 'common' }),
        okButtonProps: { danger: true },
        onCancel: () => {
          memoryForm.setFieldValue('embedding_model', currentEmbedding);
        },
      });
    }
  };

  const handleTestPg = async () => {
    const dsn = memoryForm.getFieldValue('postgres_dsn');
    if (!dsn) { message.warning(t('provider.memory.enterDsnFirst')); return; }
    setPgTesting(true);
    setPgTestResult(null);
    try { setPgTestResult(await api.testPostgresConnection(dsn)); }
    catch { setPgTestResult({ ok: false, error: t('provider.memory.requestFailed') }); }
    finally { setPgTesting(false); }
  };

  const selectedEmbeddingValue = Form.useWatch('embedding_model', memoryForm);

  if (loading) return <Flexbox align="center" justify="center" style={{ padding: 60 }}><Spin /></Flexbox>;

  const noEmbeddingAvailable = embeddingOptions.length === 0;

  return (
    <SettingsContainer fullHeight>
      <SettingsSection
        icon={<Database size={16} style={{ color: token.colorPrimary }} />}
        title={t('provider.memory.memory')}
        extra={
          <Flexbox horizontal gap={6} align="center">
            {hasAnyCustom(memoryData) && <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>{t('provider.memory.customized')}</Tag>}
            {hasAnyCustom(memoryData) && (
              <Button size="small" icon={<RotateCcw size={14} />} onClick={handleResetSection} loading={saving}>{t('provider.memory.reset')}</Button>
            )}
            <Button size="small" type="primary" icon={<Check size={14} />} onClick={handleSaveMemory} loading={saving}>{t('provider.memory.save')}</Button>
          </Flexbox>
        }
      >

        <Form form={memoryForm} layout="vertical" size="small">
          <Form.Item name="enabled" valuePropName="checked" label={
            <Flexbox horizontal align="center" gap={6}><span>{t('provider.memory.enableMemory')}</span>{memoryData?.enabled && <SourceBadge meta={memoryData.enabled} t={t} />}</Flexbox>
          }><Switch /></Form.Item>

          <Form.Item name="embedding_model" label={
            <Flexbox horizontal align="center" gap={6}>
              <span>{t('provider.memory.embeddingModel')}</span>
              <Tooltip title={t('provider.memory.embeddingModelTooltip')}>
                <HelpCircle size={12} style={{ color: token.colorTextQuaternary }} />
              </Tooltip>
            </Flexbox>
          }>
            <Select
              placeholder={noEmbeddingAvailable ? t('provider.memory.noEmbeddingAvailable') : t('provider.memory.selectEmbedding')}
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
              notFoundContent={<Text type="secondary" style={{ fontSize: 12 }}>{t('provider.memory.noEmbeddingFound')}</Text>}
            />
          </Form.Item>

          {noEmbeddingAvailable && (
            <Alert
              type="info"
              showIcon
              icon={<Zap size={14} />}
              style={{ marginBottom: 12, fontSize: 12 }}
              message={t('provider.memory.ftsMode')}
              description={t('provider.memory.ftsDesc')}
            />
          )}

          {!noEmbeddingAvailable && !selectedEmbeddingValue && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12, fontSize: 12 }}
              message={t('provider.memory.noEmbeddingSelected')}
              description={t('provider.memory.noEmbeddingSelectedDesc')}
            />
          )}

          <Form.Item name="tuning_enabled" valuePropName="checked" label={
            <Flexbox horizontal align="center" gap={6}>
              <span>{t('provider.memory.tuning')}</span>
              {memoryData?.tuning_enabled && <SourceBadge meta={memoryData.tuning_enabled} t={t} />}
              <Tooltip title={t('provider.memory.tuningTooltip')}>
                <HelpCircle size={12} style={{ color: token.colorTextQuaternary }} />
              </Tooltip>
            </Flexbox>
          }><Switch /></Form.Item>

          <Form.Item name="storage" label={
            <Flexbox horizontal align="center" gap={6}><span>{t('provider.memory.storageBackend')}</span>{memoryData?.storage && <SourceBadge meta={memoryData.storage} t={t} />}</Flexbox>
          }>
            <Select options={[
              { value: 'sqlite', label: t('provider.memory.storageSqlite') },
              { value: 'postgres', label: t('provider.memory.storagePostgres') },
            ]} />
          </Form.Item>

          {storageValue === 'postgres' && (
            <>
              <Form.Item name="postgres_dsn" label={
                <Flexbox horizontal align="center" gap={6}><span>{t('provider.memory.connectionString')}</span>{memoryData?.postgres_dsn && <SourceBadge meta={memoryData.postgres_dsn} t={t} />}</Flexbox>
              }>
                <TextArea rows={2} placeholder={t('provider.memory.connectionPlaceholder')} style={{ fontFamily: 'monospace', fontSize: 12 }} />
              </Form.Item>
              <Flexbox horizontal gap={8} align="center" style={{ marginBottom: 12 }}>
                <Button size="small" icon={<Zap size={14} />} onClick={handleTestPg} loading={pgTesting}>{t('provider.memory.test')}</Button>
                {pgTestResult && (pgTestResult.ok ? (
                  <Flexbox horizontal align="center" gap={4}>
                    <CheckCircle2 size={14} style={{ color: token.colorSuccess }} />
                    <Text style={{ fontSize: 12, color: token.colorSuccess }}>{t('provider.memory.connected')}{pgTestResult.has_pgvector ? t('provider.memory.pgvectorOk') : ''}</Text>
                    {!pgTestResult.has_pgvector && <Tag color="warning" style={{ fontSize: 10 }}>{t('provider.memory.pgvectorMissing')}</Tag>}
                  </Flexbox>
                ) : (
                  <Flexbox horizontal align="center" gap={4}>
                    <XCircle size={14} style={{ color: token.colorError }} />
                    <Text style={{ fontSize: 12, color: token.colorError }}>{pgTestResult.error}</Text>
                  </Flexbox>
                ))}
              </Flexbox>
              <Alert type="warning" showIcon style={{ marginBottom: 12, fontSize: 12 }} message={t('provider.memory.noMigration')} description={t('provider.memory.noMigrationDesc')} />
            </>
          )}

          <Flexbox horizontal gap={16}>
            <Form.Item name="vector_weight" label={
              <Flexbox horizontal align="center" gap={6}><span>{t('provider.memory.vectorWeight')}</span>{memoryData?.vector_weight && <SourceBadge meta={memoryData.vector_weight} t={t} />}</Flexbox>
            } style={{ flex: 1 }}>
              <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="keyword_weight" label={
              <Flexbox horizontal align="center" gap={6}><span>{t('provider.memory.keywordWeight')}</span>{memoryData?.keyword_weight && <SourceBadge meta={memoryData.keyword_weight} t={t} />}</Flexbox>
            } style={{ flex: 1 }}>
              <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
            </Form.Item>
          </Flexbox>
        </Form>

      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('provider.memory.restartNote')}
      </Text>
      </SettingsSection>
    </SettingsContainer>
  );
}
