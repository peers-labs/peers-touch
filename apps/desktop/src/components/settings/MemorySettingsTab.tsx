import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Icon, Spin, Tag, Text, Tooltip } from '@peers-touch/ui';
import { RefreshCw, Zap } from 'lucide-react';
import { api } from '../../services/desktop_api';
import {
  SettingsContainer,
  SettingsSection,
  SettingsRow,
} from './SettingsLayout';
import { useTranslation } from 'react-i18next';
import { notifyError, notifySuccess } from '../../ui/feedback';

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

  useEffect(() => { void load(); }, [load]);

  const handleReEmbed = async () => {
    setReembedding(true);
    try {
      const result = await api.reEmbed();
      notifySuccess(t('provider.memory.reembedDone', { count: result.reembedded_count ?? 0 }));
      await load();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : t('provider.memory.reembedFailed'));
    } finally {
      setReembedding(false);
    }
  };

  if (loading) {
    return (
      <SettingsContainer tier="standard">
        <div className="sc-memory-loading"><Spin /></div>
      </SettingsContainer>
    );
  }

  const embeddingReady = !!embedding?.provider && !!embedding?.model;

  return (
    <SettingsContainer tier="standard">
      <SettingsSection
        icon={<Icon iconId="database" size={16} />}
        title={t('provider.memory.memory')}
        extra={
          <Button
            actionId="memory-refresh"
            density="compact"
            leading={<RefreshCw size={14} />}
            execution={loading ? 'pending' : 'idle'}
            label={t('provider.memory.refreshStatus')}
            onActivate={() => void load()}
          />
        }
      >
        {unavailable && (
          <Alert
            className="sc-memory-alert"
            tone="danger"
            title={t('provider.memory.stationUnavailable')}
            description={t('provider.memory.stationUnavailableDesc')}
          />
        )}

        <SettingsRow
          label={
            <span className="sc-memory-label">
              {t('provider.memory.embeddingModel')}
              <Tooltip label={t('provider.memory.embeddingModelTooltip')}>
                <Icon iconId="circle-question-mark" size={12} className="sc-memory-label__help" />
              </Tooltip>
            </span>
          }
        >
          {embeddingReady ? (
            <Tag tone="success">{embedding!.provider} / {embedding!.model}</Tag>
          ) : (
            <Tag>{t('provider.memory.embeddingUnavailable')}</Tag>
          )}
        </SettingsRow>

        {embeddingReady ? (
          <div className="sc-memory-facts">
            <Tag>{t('provider.memory.dimensions', { count: embedding!.dimensions })}</Tag>
            <Tag>{t('provider.memory.vectorCount', { count: embedding!.vector_count })}</Tag>
            {stats && (
              <Tag>{t('provider.memory.storageBytes', { bytes: formatStorage(stats.storage_bytes) })}</Tag>
            )}
          </div>
        ) : (
          <Alert
            tone="info"
            icon={<Zap size={14} />}
            title={t('provider.memory.ftsMode')}
            description={t('provider.memory.ftsDesc')}
          />
        )}

        {stats && (
          <SettingsRow vertical label={t('provider.memory.statsByLayer')}>
            <div className="sc-memory-layers__tags">
              {Object.entries(stats.by_layer || {}).map(([layer, count]) => (
                <Tag key={layer}>{layer}: {count}</Tag>
              ))}
              <Tag tone="info">{t('provider.memory.totalEntries', { count: stats.total })}</Tag>
            </div>
          </SettingsRow>
        )}

        {embeddingReady && (
          <SettingsRow
            label={t('provider.memory.reembed')}
            description={t('provider.memory.reembedHint')}
          >
            <Button
              actionId="memory-reembed"
              density="compact"
              leading={<RefreshCw size={14} />}
              execution={reembedding ? 'pending' : 'idle'}
              label={t('provider.memory.reembed')}
              onActivate={() => void handleReEmbed()}
            />
          </SettingsRow>
        )}

        <Text tone="secondary" className="sc-memory-managed-note">
          {t('provider.memory.stationManaged')}
        </Text>
      </SettingsSection>
    </SettingsContainer>
  );
}
