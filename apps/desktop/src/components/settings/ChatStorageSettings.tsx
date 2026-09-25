import { useMemo, useState } from 'react';
import { Button } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';
import { Input, Segmented, Tag, Typography, theme } from 'antd';
import {
  Database,
  FileImage,
  HardDrive,
  MessageSquare,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  chatStorageProjectionRuntime,
  useChatStorageProjection,
} from '../../runtimes/chatStorageRuntime';
import { SettingsContainer, SettingsSection } from './SettingsLayout';

const { Text, Title } = Typography;

type SortMode = 'size' | 'recent';

export function ChatStorageSettings() {
  const { token } = theme.useToken();
  const { t } = useTranslation('settings');
  const projection = useChatStorageProjection();
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('size');
  const snapshot = projection.snapshot;
  const conversations = useMemo(() => {
    if (!snapshot) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return snapshot.conversations
      .slice()
      .filter((usage) => {
        if (!normalizedQuery) return true;
        return `${usage.conversationName} ${usage.conversationId}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      })
      .sort((left, right) => {
        if (sortMode === 'recent') {
          return Number(right.lastActivityUnixMs - left.lastActivityUnixMs);
        }
        const leftBytes = left.messageBytes + left.mediaBytes;
        const rightBytes = right.messageBytes + right.mediaBytes;
        return rightBytes === leftBytes
          ? left.conversationId.localeCompare(right.conversationId)
          : rightBytes > leftBytes ? 1 : -1;
      });
  }, [query, snapshot, sortMode]);

  if (!snapshot) {
    return (
      <SettingsContainer fullHeight maxWidth={900}>
        <Flexbox align="center" justify="center" gap={12} style={{ padding: 64 }}>
          <HardDrive size={28} style={{ color: token.colorTextTertiary }} />
          <Text type="secondary">
            {projection.status === 'unavailable'
              ? t('settings.storage.unavailable')
              : t('settings.storage.measuring')}
          </Text>
          {projection.status === 'unavailable' ? (
            <Button
              icon={<RefreshCw size={14} />}
              onClick={() => void chatStorageProjectionRuntime.refresh()}
            >
              {t('settings.storage.retry')}
            </Button>
          ) : null}
        </Flexbox>
      </SettingsContainer>
    );
  }

  const categories = [
    {
      key: 'message',
      label: t('settings.storage.message'),
      value: snapshot.messageBytes,
      icon: <MessageSquare size={18} style={{ color: token.colorPrimary }} />,
    },
    {
      key: 'media',
      label: t('settings.storage.media'),
      value: snapshot.mediaBytes,
      icon: <FileImage size={18} style={{ color: token.colorSuccess }} />,
    },
    {
      key: 'cache',
      label: t('settings.storage.cache'),
      value: snapshot.cacheBytes,
      icon: <HardDrive size={18} style={{ color: token.colorWarning }} />,
    },
    {
      key: 'system',
      label: t('settings.storage.system'),
      value: snapshot.systemBytes,
      icon: <Database size={18} style={{ color: token.colorTextSecondary }} />,
    },
  ];

  return (
    <SettingsContainer fullHeight maxWidth={900}>
      <Flexbox horizontal align="center" justify="space-between" gap={12}>
        <Flexbox gap={2}>
          <Title level={4} style={{ margin: 0 }}>
            {formatBytes(snapshot.physicalTotalBytes)}
          </Title>
          <Text type="secondary">
            {t('settings.storage.total')}
            {' · '}
            {new Date(Number(snapshot.measuredAtUnixMs)).toLocaleString()}
          </Text>
        </Flexbox>
        <Flexbox horizontal align="center" gap={8}>
          {projection.status === 'measuring' ? (
            <Tag>{t('settings.storage.measuring')}</Tag>
          ) : null}
          {projection.stale || snapshot.issues.length > 0 ? (
            <Tag color="warning">{t('settings.storage.stale')}</Tag>
          ) : null}
          <Button
            icon={<RefreshCw size={14} />}
            loading={projection.status === 'measuring'}
            onClick={() => void chatStorageProjectionRuntime.refresh()}
          />
        </Flexbox>
      </Flexbox>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
        }}
      >
        {categories.map((category) => (
          <Flexbox
            key={category.key}
            gap={8}
            style={{
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 8,
              padding: 16,
              background: token.colorBgContainer,
            }}
          >
            <Flexbox horizontal align="center" gap={8}>
              {category.icon}
              <Text type="secondary">{category.label}</Text>
            </Flexbox>
            <Text strong style={{ fontSize: 20 }}>
              {formatBytes(category.value)}
            </Text>
          </Flexbox>
        ))}
      </div>

      <SettingsSection
        title={t('settings.storage.conversations')}
        subtitle={t('settings.storage.conversationCount', {
          count: conversations.length,
        })}
      >
        <Flexbox horizontal gap={8}>
          <Input.Search
            allowClear
            aria-label={t('settings.storage.search')}
            placeholder={t('settings.storage.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Segmented<SortMode>
            value={sortMode}
            options={[
              { label: t('settings.storage.sortSize'), value: 'size' },
              { label: t('settings.storage.sortRecent'), value: 'recent' },
            ]}
            onChange={setSortMode}
          />
        </Flexbox>
        <Flexbox gap={0}>
          {conversations.map((usage) => (
            <Flexbox
              key={usage.conversationId}
              horizontal
              align="center"
              justify="space-between"
              gap={16}
              style={{
                minHeight: 56,
                padding: '10px 0',
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <Flexbox gap={2} style={{ minWidth: 0 }}>
                <Text strong ellipsis>
                  {usage.conversationName || usage.conversationId}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {usage.conversationKind === 2
                    ? t('settings.storage.group')
                    : t('settings.storage.direct')}
                  {' · '}
                  {new Date(Number(usage.lastActivityUnixMs)).toLocaleString()}
                </Text>
              </Flexbox>
              <Flexbox align="end" gap={2} style={{ flexShrink: 0 }}>
                <Text strong>{formatBytes(usage.messageBytes + usage.mediaBytes)}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('settings.storage.breakdown', {
                    message: formatBytes(usage.messageBytes),
                    media: formatBytes(usage.mediaBytes),
                  })}
                </Text>
              </Flexbox>
            </Flexbox>
          ))}
          {conversations.length === 0 ? (
            <Text type="secondary" style={{ padding: '24px 0', textAlign: 'center' }}>
              {t('settings.storage.empty')}
            </Text>
          ) : null}
        </Flexbox>
      </SettingsSection>
    </SettingsContainer>
  );
}

function formatBytes(value: bigint): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const amount = bytes / 1024 ** exponent;
  return `${amount >= 10 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`;
}
