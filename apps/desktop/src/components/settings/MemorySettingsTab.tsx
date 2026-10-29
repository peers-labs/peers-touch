import { useCallback, useEffect, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Alert, Button, Spin, Tag, Tooltip, Typography, theme, message } from 'antd';
import { Database, HelpCircle, RefreshCw, Zap } from 'lucide-react';
import { api } from '../../services/desktop_api';
import { SettingsContainer, SettingsSection } from './SettingsLayout';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

interface EmbeddingStatus {
  provider: string;
  model: string;
  dimensions: number;
  vector_count: number;
}

function formatStorage(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function MemorySettingsTab() {
  const { token } = theme.useToken();
  const { t } = useTranslation('provider');
  const [embedding, setEmbedding] = useState<EmbeddingStatus | null>(null);
  const [stats, setStats] = useState<{ total: number; storage_bytes: number; by_layer: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [reembedding, setReembedding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [embeddingStatus, memoryStats] = await Promise.all([
        api.getEmbeddingStatus(),
        api.getMemoryStats(),
      ]);
      setEmbedding(embeddingStatus);
      setStats(memoryStats);
      setUnavailable(false);
    } catch {
      setEmbedding(null);
      setStats(null);
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleReEmbed = async () => {
    setReembedding(true);
    try {
      const result = await api.reEmbed();
      message.success(t('provider.memory.reembedDone', { count: result.reembedded_count ?? 0 }));
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('provider.memory.reembedFailed'));
    } finally {
      setReembedding(false);
    }
  };

  if (loading) {
    return (
      <SettingsContainer fullHeight tier="standard">
        <Flexbox align="center" justify="center" style={{ padding: 60 }}><Spin /></Flexbox>
      </SettingsContainer>
    );
  }

  const embeddingReady = !!embedding?.provider && !!embedding?.model;

  return (
    <SettingsContainer fullHeight tier="standard">
      <SettingsSection
        icon={<Database size={16} style={{ color: token.colorPrimary }} />}
        title={t('provider.memory.memory')}
        extra={
          <Button size="small" icon={<RefreshCw size={14} />} onClick={load} loading={loading}>
            {t('provider.memory.refreshStatus')}
          </Button>
        }
      >
        {unavailable && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message={t('provider.memory.stationUnavailable')}
            description={t('provider.memory.stationUnavailableDesc')}
          />
        )}

        <Flexbox gap={14}>
          <Flexbox horizontal align="center" justify="space-between">
            <Flexbox horizontal align="center" gap={8}>
              <Text strong style={{ fontSize: 13 }}>{t('provider.memory.embeddingModel')}</Text>
              <Tooltip title={t('provider.memory.embeddingModelTooltip')}>
                <HelpCircle size={12} style={{ color: token.colorTextQuaternary }} />
              </Tooltip>
            </Flexbox>
            {embeddingReady ? (
              <Tag color="green">{embedding!.provider} / {embedding!.model}</Tag>
            ) : (
              <Tag>{t('provider.memory.embeddingUnavailable')}</Tag>
            )}
          </Flexbox>

          {embeddingReady ? (
            <Flexbox horizontal gap={24} style={{ fontSize: 13, color: token.colorTextSecondary }}>
              <span>{t('provider.memory.dimensions', { count: embedding!.dimensions })}</span>
              <span>{t('provider.memory.vectorCount', { count: embedding!.vector_count })}</span>
              {stats && <span>{t('provider.memory.storageBytes', { bytes: formatStorage(stats.storage_bytes) })}</span>}
            </Flexbox>
          ) : (
            <Alert
              type="info"
              showIcon
              icon={<Zap size={14} />}
              style={{ fontSize: 12 }}
              message={t('provider.memory.ftsMode')}
              description={t('provider.memory.ftsDesc')}
            />
          )}

          {stats && (
            <Flexbox gap={6}>
              <Text strong style={{ fontSize: 13 }}>{t('provider.memory.statsByLayer')}</Text>
              <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
                {Object.entries(stats.by_layer || {}).map(([layer, count]) => (
                  <Tag key={layer}>{layer}: {count}</Tag>
                ))}
                <Tag color="blue">{t('provider.memory.totalEntries', { count: stats.total })}</Tag>
              </Flexbox>
            </Flexbox>
          )}

          {embeddingReady && (
            <Flexbox>
              <Button
                size="small"
                icon={<RefreshCw size={14} />}
                onClick={handleReEmbed}
                loading={reembedding}
                style={{ alignSelf: 'flex-start' }}
              >
                {t('provider.memory.reembed')}
              </Button>
              <Text type="secondary" style={{ fontSize: 11, marginTop: 6 }}>
                {t('provider.memory.reembedHint')}
              </Text>
            </Flexbox>
          )}

          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('provider.memory.stationManaged')}
          </Text>
        </Flexbox>
      </SettingsSection>
    </SettingsContainer>
  );
}
