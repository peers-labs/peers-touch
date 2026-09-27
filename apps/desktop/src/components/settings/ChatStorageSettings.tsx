import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@lobehub/ui';
import type { ConversationClearBatchResult } from '@peers-touch/client-chat-core';
import { Flexbox } from 'react-layout-kit';
import { Checkbox, Input, Segmented, Tag, Typography, theme } from 'antd';
import {
  CheckSquare2,
  Clock3,
  Database,
  FileImage,
  HardDrive,
  MessageSquare,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ChatRetentionPreset } from '../../gen/proto/domain/chat/storage_pb';

import {
  chatStorageProjectionRuntime,
  chatStorageReleasedBytes,
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
  const [clearConfirmationRevision, setClearConfirmationRevision] = useState<string | null>(null);
  const [batchConfirmationRevision, setBatchConfirmationRevision] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ completedCount: 0, totalCount: 0 });
  const [batchResult, setBatchResult] = useState<ConversationClearBatchResult | null>(null);
  const [selectedConversationIds, setSelectedConversationIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const batchAttemptRef = useRef(0);
  const snapshot = projection.snapshot;
  const scopeRevisionRef = useRef<string | null>(snapshot?.revision ?? null);
  const confirmingClearCache = clearConfirmationRevision === snapshot?.revision;
  const confirmingBatchClear = batchConfirmationRevision === snapshot?.revision;
  const releasedBytes = chatStorageReleasedBytes(projection.cleanup.result);
  const retentionReleasedBytes = chatStorageReleasedBytes(projection.retention.result);
  const cleanupRunning = projection.cleanup.status === 'clearing';
  const retentionSaving = projection.retention.status === 'saving';
  const retentionPreset = snapshot?.retentionPolicy?.retentionPreset
    ?? ChatRetentionPreset.CHAT_RETENTION_PRESET_FOREVER;

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
  const selectedConversations = snapshot?.conversations.filter(
    (usage) => selectedConversationIds.has(usage.conversationId),
  ) ?? [];
  const selectedReclaimableBytes = selectedConversations.reduce(
    (total, usage) => total + usage.reclaimableBytes,
    0n,
  );
  const allVisibleSelected = conversations.length > 0
    && conversations.every((usage) => selectedConversationIds.has(usage.conversationId));
  const someVisibleSelected = conversations.some(
    (usage) => selectedConversationIds.has(usage.conversationId),
  );

  useEffect(() => {
    const revision = snapshot?.revision ?? null;
    if (scopeRevisionRef.current !== null && scopeRevisionRef.current !== revision) {
      batchAttemptRef.current += 1;
      setBatchMode(false);
      setBatchRunning(false);
      setBatchProgress({ completedCount: 0, totalCount: 0 });
      setBatchResult(null);
      setSelectedConversationIds(new Set());
      setBatchConfirmationRevision(null);
    }
    scopeRevisionRef.current = revision;
  }, [snapshot?.revision]);

  const toggleBatchMode = () => {
    if (batchRunning) return;
    setBatchMode((current) => !current);
    setSelectedConversationIds(new Set());
    setBatchConfirmationRevision(null);
    setBatchResult(null);
  };

  const toggleConversation = (conversationId: string, checked: boolean) => {
    setSelectedConversationIds((current) => {
      const next = new Set(current);
      if (checked) next.add(conversationId);
      else next.delete(conversationId);
      return next;
    });
    setBatchResult(null);
  };

  const toggleVisibleConversations = (checked: boolean) => {
    setSelectedConversationIds((current) => {
      const next = new Set(current);
      for (const usage of conversations) {
        if (checked) next.add(usage.conversationId);
        else next.delete(usage.conversationId);
      }
      return next;
    });
    setBatchResult(null);
  };

  const clearSelectedConversations = async () => {
    if (!snapshot) return;
    const selectedIds = snapshot.conversations
      .map((usage) => usage.conversationId)
      .filter((conversationId) => selectedConversationIds.has(conversationId));
    if (selectedIds.length === 0 || batchRunning) return;
    const attempt = batchAttemptRef.current + 1;
    batchAttemptRef.current = attempt;
    setBatchConfirmationRevision(null);
    setBatchResult(null);
    setBatchProgress({ completedCount: 0, totalCount: selectedIds.length });
    setBatchRunning(true);
    try {
      const result = await chatStorageProjectionRuntime.clearConversations(
        selectedIds,
        ({ completedCount, totalCount }) => {
          if (batchAttemptRef.current !== attempt) return;
          setBatchProgress({ completedCount, totalCount });
        },
      );
      if (batchAttemptRef.current !== attempt) return;
      if (result.status === 'scope_changed') {
        setBatchMode(false);
        setBatchResult(null);
        setSelectedConversationIds(new Set());
        return;
      }
      setBatchResult(result);
      const retryIds = [...result.failedIds, ...result.remainingIds];
      setSelectedConversationIds(new Set(retryIds));
      if (result.status === 'succeeded') setBatchMode(false);
    } finally {
      if (batchAttemptRef.current === attempt) setBatchRunning(false);
    }
  };

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
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        gap={12}
        data-chat-storage-summary
        data-chat-storage-physical-bytes={String(snapshot.physicalTotalBytes)}
        data-chat-storage-measured-at={String(snapshot.measuredAtUnixMs)}
      >
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
            aria-label={t('settings.storage.retry')}
            data-chat-storage-refresh
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
            data-chat-storage-category={category.key}
            data-chat-storage-category-bytes={String(category.value)}
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
        title={t('settings.storage.retentionTitle')}
        subtitle={t('settings.storage.retentionDescription')}
      >
        <Flexbox horizontal align="center" gap={10} data-chat-storage-retention>
          <Clock3 size={18} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
          <Segmented<ChatRetentionPreset>
            block
            disabled={retentionSaving || cleanupRunning}
            options={[
              {
                label: (
                  <span data-chat-storage-retention-option="forever">
                    {t('settings.storage.retentionForever')}
                  </span>
                ),
                value: ChatRetentionPreset.CHAT_RETENTION_PRESET_FOREVER,
              },
              {
                label: (
                  <span data-chat-storage-retention-option="365">
                    {t('settings.storage.retentionYear')}
                  </span>
                ),
                value: ChatRetentionPreset.CHAT_RETENTION_PRESET_365_DAYS,
              },
              {
                label: (
                  <span data-chat-storage-retention-option="90">
                    {t('settings.storage.retention90Days')}
                  </span>
                ),
                value: ChatRetentionPreset.CHAT_RETENTION_PRESET_90_DAYS,
              },
              {
                label: (
                  <span data-chat-storage-retention-option="30">
                    {t('settings.storage.retention30Days')}
                  </span>
                ),
                value: ChatRetentionPreset.CHAT_RETENTION_PRESET_30_DAYS,
              },
            ]}
            value={retentionPreset}
            onChange={(value) => {
              void chatStorageProjectionRuntime.setRetention(value);
            }}
          />
        </Flexbox>
        <div data-chat-storage-retention-preset={String(retentionPreset)}>
          {retentionSaving ? (
            <Text type="secondary" role="status">
              {t('settings.storage.retentionSaving')}
            </Text>
          ) : null}
          {projection.retention.status === 'succeeded' ? (
            <Text
              type="success"
              role="status"
              data-chat-storage-retention-result="succeeded"
              data-chat-storage-retention-released-bytes={String(retentionReleasedBytes ?? 0n)}
            >
              {t('settings.storage.retentionSaved')}
            </Text>
          ) : null}
          {projection.retention.status === 'failed' ? (
            <Text
              type="danger"
              role="alert"
              data-chat-storage-retention-result="failed"
            >
              {t('settings.storage.retentionFailed')}
            </Text>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('settings.storage.clearCacheTitle')}
        subtitle={t('settings.storage.clearCacheDescription')}
      >
        {confirmingClearCache ? (
          <Flexbox
            gap={12}
            data-chat-storage-clear-confirm
            style={{
              padding: 16,
              borderRadius: 8,
              background: token.colorFillQuaternary,
            }}
          >
            <Text>{t('settings.storage.clearCacheConfirm')}</Text>
            <Flexbox horizontal justify="end" gap={8}>
              <Button
                disabled={cleanupRunning}
                onClick={() => setClearConfirmationRevision(null)}
              >
                {t('settings.storage.clearCacheCancel')}
              </Button>
              <Button
                danger
                type="primary"
                data-chat-storage-clear-confirm-apply
                icon={<Trash2 size={14} />}
                loading={cleanupRunning}
                onClick={() => {
                  void chatStorageProjectionRuntime.clearCache().then(() => {
                    setClearConfirmationRevision(null);
                  });
                }}
              >
                {t('settings.storage.clearCacheConfirmAction')}
              </Button>
            </Flexbox>
          </Flexbox>
        ) : (
          <Button
            data-chat-storage-clear-cache
            icon={<Trash2 size={14} />}
            disabled={cleanupRunning}
            onClick={() => setClearConfirmationRevision(snapshot.revision)}
          >
            {t('settings.storage.clearCacheAction')}
          </Button>
        )}
        {projection.cleanup.status === 'succeeded' && releasedBytes !== null ? (
          <Text
            type="success"
            role="status"
            data-chat-storage-clear-result="succeeded"
            data-chat-storage-released-bytes={String(releasedBytes)}
          >
            {t('settings.storage.clearCacheReleased', {
              bytes: formatBytes(releasedBytes),
            })}
          </Text>
        ) : null}
        {projection.cleanup.status === 'failed' ? (
          <Text
            type="danger"
            role="alert"
            data-chat-storage-clear-result="failed"
          >
            {releasedBytes === null
              ? t('settings.storage.clearCacheFailed')
              : t('settings.storage.clearCacheFailedWithReleased', {
                  bytes: formatBytes(releasedBytes),
                })}
          </Text>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title={t('settings.storage.conversations')}
        subtitle={t('settings.storage.conversationCount', {
          count: conversations.length,
        })}
        extra={(
          <Button
            data-chat-storage-batch-manage
            icon={batchMode ? <X size={14} /> : <CheckSquare2 size={14} />}
            disabled={batchRunning || snapshot.conversations.length === 0}
            onClick={toggleBatchMode}
          >
            {batchMode
              ? t('settings.storage.batchDone')
              : t('settings.storage.batchManage')}
          </Button>
        )}
      >
        <Flexbox horizontal gap={8}>
          <Input.Search
            allowClear
            aria-label={t('settings.storage.search')}
            data-chat-storage-search
            placeholder={t('settings.storage.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div data-chat-storage-sort={sortMode}>
            <Segmented<SortMode>
              value={sortMode}
              options={[
                {
                  label: (
                    <span data-chat-storage-sort-option="size">
                      {t('settings.storage.sortSize')}
                    </span>
                  ),
                  value: 'size',
                },
                {
                  label: (
                    <span data-chat-storage-sort-option="recent">
                      {t('settings.storage.sortRecent')}
                    </span>
                  ),
                  value: 'recent',
                },
              ]}
              onChange={setSortMode}
            />
          </div>
        </Flexbox>
        {batchMode ? (
          <Flexbox gap={10} data-chat-storage-batch-actions>
            <Flexbox horizontal align="center" justify="space-between" gap={12}>
              <Checkbox
                checked={allVisibleSelected}
                disabled={batchRunning || conversations.length === 0}
                indeterminate={!allVisibleSelected && someVisibleSelected}
                data-chat-storage-batch-select-all
                onChange={(event) => toggleVisibleConversations(event.target.checked)}
              >
                {t('settings.storage.batchSelectAll')}
              </Checkbox>
              <Text type="secondary" data-chat-storage-batch-selection>
                {t('settings.storage.batchSelection', {
                  bytes: formatBytes(selectedReclaimableBytes),
                  count: selectedConversations.length,
                })}
              </Text>
            </Flexbox>
            {confirmingBatchClear ? (
              <Flexbox
                gap={10}
                data-chat-storage-batch-confirm
                data-chat-storage-batch-estimated-bytes={String(selectedReclaimableBytes)}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: token.colorFillQuaternary,
                }}
              >
                <Text>
                  {t('settings.storage.batchConfirm', {
                    bytes: formatBytes(selectedReclaimableBytes),
                    count: selectedConversations.length,
                  })}
                </Text>
                <Flexbox horizontal justify="end" gap={8}>
                  <Button
                    disabled={batchRunning}
                    onClick={() => setBatchConfirmationRevision(null)}
                  >
                    {t('settings.storage.batchCancel')}
                  </Button>
                  <Button
                    danger
                    type="primary"
                    data-chat-storage-batch-confirm-apply
                    icon={<Trash2 size={14} />}
                    loading={batchRunning}
                    onClick={() => void clearSelectedConversations()}
                  >
                    {t('settings.storage.batchConfirmAction')}
                  </Button>
                </Flexbox>
              </Flexbox>
            ) : (
              <Button
                danger
                data-chat-storage-batch-clear
                icon={<Trash2 size={14} />}
                disabled={batchRunning || selectedConversations.length === 0}
                onClick={() => setBatchConfirmationRevision(snapshot.revision)}
              >
                {t('settings.storage.batchClearSelected')}
              </Button>
            )}
          </Flexbox>
        ) : null}
        {batchRunning ? (
          <Text type="secondary" role="status" data-chat-storage-batch-progress>
            {t('settings.storage.batchProgress', batchProgress)}
          </Text>
        ) : null}
        {batchResult?.status === 'succeeded' ? (
          <Text
            type="success"
            role="status"
            data-chat-storage-batch-result="succeeded"
            data-chat-storage-batch-succeeded={String(batchResult.succeededIds.length)}
            data-chat-storage-batch-failed="0"
            data-chat-storage-released-bytes={String(batchResult.releasedBytes)}
          >
            {t('settings.storage.batchSucceeded', {
              bytes: formatBytes(batchResult.releasedBytes),
              count: batchResult.succeededIds.length,
            })}
          </Text>
        ) : null}
        {batchResult?.status === 'partial_failure' ? (
          <Flexbox horizontal align="center" justify="space-between" gap={12}>
            <Text
              type="danger"
              role="alert"
              data-chat-storage-batch-result="partial_failure"
              data-chat-storage-batch-succeeded={String(batchResult.succeededIds.length)}
              data-chat-storage-batch-failed={String(batchResult.failedIds.length)}
              data-chat-storage-released-bytes={String(batchResult.releasedBytes)}
            >
              {t('settings.storage.batchPartial', {
                bytes: formatBytes(batchResult.releasedBytes),
                failed: batchResult.failedIds.length,
                succeeded: batchResult.succeededIds.length,
                total: batchResult.requestedIds.length,
              })}
            </Text>
            <Button
              data-chat-storage-batch-retry
              disabled={batchRunning}
              onClick={() => setBatchConfirmationRevision(snapshot.revision)}
            >
              {t('settings.storage.batchRetry')}
            </Button>
          </Flexbox>
        ) : null}
        <Flexbox gap={0} data-chat-storage-conversations>
          {conversations.map((usage) => (
            <Flexbox
              key={usage.conversationId}
              horizontal
              align="center"
              justify="space-between"
              gap={16}
              data-chat-storage-conversation={usage.conversationId}
              data-chat-storage-message-bytes={String(usage.messageBytes)}
              data-chat-storage-media-bytes={String(usage.mediaBytes)}
              data-chat-storage-reclaimable-bytes={String(usage.reclaimableBytes)}
              data-chat-storage-selected={String(
                selectedConversationIds.has(usage.conversationId),
              )}
              style={{
                minHeight: 56,
                padding: '10px 0',
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              {batchMode ? (
                <Checkbox
                  aria-label={t('settings.storage.batchSelectConversation', {
                    name: usage.conversationName || usage.conversationId,
                  })}
                  checked={selectedConversationIds.has(usage.conversationId)}
                  disabled={batchRunning}
                  data-chat-storage-conversation-select={usage.conversationId}
                  onChange={(event) => {
                    toggleConversation(usage.conversationId, event.target.checked);
                  }}
                />
              ) : null}
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
