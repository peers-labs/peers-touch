import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationClearBatchResult } from '@peers-touch/client-chat-core';
import {
  Button,
  Checkbox,
  Icon,
  Segmented,
  Tag,
  Text,
  TextField,
} from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';

import { ChatRetentionPreset } from '../../gen/proto/domain/chat/storage_pb';

import {
  chatStorageProjectionRuntime,
  chatStorageReleasedBytes,
  useChatStorageProjection,
} from '../../runtimes/chatStorageRuntime';
import { SettingsContainer, SettingsSection, SettingsRow } from './SettingsLayout';

type SortMode = 'size' | 'recent';

export function ChatStorageSettings() {
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
      <SettingsContainer fullHeight tier="standard">
        <div className="sc-storage-status">
          <Icon iconId="hard-drive" size={28} className="sc-storage-status__icon" />
          <Text tone="secondary">
            {projection.status === 'unavailable'
              ? t('settings.storage.unavailable')
              : t('settings.storage.measuring')}
          </Text>
          {projection.status === 'unavailable' ? (
            <Button
              actionId="storage-status-retry"
              leading={<Icon iconId="refresh-cw" size={14} />}
              label={t('settings.storage.retry')}
              onActivate={() => void chatStorageProjectionRuntime.refresh()}
            />
          ) : null}
        </div>
      </SettingsContainer>
    );
  }

  const categories = [
    {
      key: 'message',
      label: t('settings.storage.message'),
      value: snapshot.messageBytes,
      icon: 'message-square' as const,
      tone: 'accent',
    },
    {
      key: 'media',
      label: t('settings.storage.media'),
      value: snapshot.mediaBytes,
      icon: 'file-image' as const,
      tone: 'success',
    },
    {
      key: 'cache',
      label: t('settings.storage.cache'),
      value: snapshot.cacheBytes,
      icon: 'hard-drive' as const,
      tone: 'warning',
    },
    {
      key: 'system',
      label: t('settings.storage.system'),
      value: snapshot.systemBytes,
      icon: 'database' as const,
      tone: 'secondary',
    },
  ];

  return (
    <SettingsContainer fullHeight tier="standard">
      <div
        className="sc-storage-summary"
        data-chat-storage-summary
        data-chat-storage-physical-bytes={String(snapshot.physicalTotalBytes)}
        data-chat-storage-measured-at={String(snapshot.measuredAtUnixMs)}
      >
        <div className="sc-storage-summary__head">
          <h4 className="sc-storage-summary__total">
            {formatBytes(snapshot.physicalTotalBytes)}
          </h4>
          <Text tone="secondary">
            {t('settings.storage.total')}
            {' · '}
            {new Date(Number(snapshot.measuredAtUnixMs)).toLocaleString()}
          </Text>
        </div>
        <div className="sc-storage-summary__actions">
          {projection.status === 'measuring' ? (
            <Tag>{t('settings.storage.measuring')}</Tag>
          ) : null}
          {projection.stale || snapshot.issues.length > 0 ? (
            <Tag tone="warning">{t('settings.storage.stale')}</Tag>
          ) : null}
          <Button
            aria-label={t('settings.storage.retry')}
            actionId="storage-refresh"
            data-chat-storage-refresh
            leading={<Icon iconId="refresh-cw" size={14} />}
            execution={projection.status === 'measuring' ? 'pending' : 'idle'}
            label={t('settings.storage.retry')}
            onActivate={() => void chatStorageProjectionRuntime.refresh()}
          />
        </div>
      </div>

      <div className="sc-storage-categories">
        {categories.map((category) => (
          <div
            key={category.key}
            className="sc-storage-category"
            data-chat-storage-category={category.key}
            data-chat-storage-category-bytes={String(category.value)}
          >
            <div className={`sc-storage-category__head sc-storage-category__head--${category.tone}`}>
              <Icon iconId={category.icon} size={18} />
              <Text tone="secondary">{category.label}</Text>
            </div>
            <Text strong className="sc-storage-category__value">
              {formatBytes(category.value)}
            </Text>
          </div>
        ))}
      </div>

      <SettingsSection
        title={t('settings.storage.retentionTitle')}
        subtitle={t('settings.storage.retentionDescription')}
      >
        <SettingsRow label={<Icon iconId="clock-3" size={18} />}>
          <div className="sc-storage-retention" data-chat-storage-retention>
            <Segmented<ChatRetentionPreset>
              className="sc-storage-segmented"
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
              onValueChange={(value) => {
                if (typeof value === 'number') {
                  void chatStorageProjectionRuntime.setRetention(value);
                }
              }}
            />
          </div>
        </SettingsRow>
        <div className="sc-storage-inline-status" data-chat-storage-retention-preset={String(retentionPreset)}>
          {retentionSaving ? (
            <Text tone="secondary" role="status">
              {t('settings.storage.retentionSaving')}
            </Text>
          ) : null}
          {projection.retention.status === 'succeeded' ? (
            <Text
              tone="success"
              role="status"
              data-chat-storage-retention-result="succeeded"
              data-chat-storage-retention-released-bytes={String(retentionReleasedBytes ?? 0n)}
            >
              {t('settings.storage.retentionSaved')}
            </Text>
          ) : null}
          {projection.retention.status === 'failed' ? (
            <Text
              tone="danger"
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
        <SettingsRow label={<Icon iconId="delete" size={18} />}>
          {confirmingClearCache ? (
            <div className="sc-storage-confirm" data-chat-storage-clear-confirm>
              <Text>{t('settings.storage.clearCacheConfirm')}</Text>
              <div className="sc-storage-confirm__actions">
                <Button
                  actionId="storage-clear-cancel"
                  label={t('settings.storage.clearCacheCancel')}
                  availability={cleanupRunning
                    ? { kind: 'disabled', reason: t('settings.storage.clearCacheCancel') }
                    : undefined}
                  onActivate={() => setClearConfirmationRevision(null)}
                />
                <Button
                  actionId="storage-clear-apply"
                  data-chat-storage-clear-confirm-apply
                  tone="danger"
                  emphasis="primary"
                  leading={<Icon iconId="delete" size={14} />}
                  execution={cleanupRunning ? 'pending' : 'idle'}
                  label={t('settings.storage.clearCacheConfirmAction')}
                  onActivate={() => {
                    void chatStorageProjectionRuntime.clearCache().then(() => {
                      setClearConfirmationRevision(null);
                    });
                  }}
                />
              </div>
            </div>
          ) : (
            <Button
              actionId="storage-clear-open"
              data-chat-storage-clear-cache
              leading={<Icon iconId="delete" size={14} />}
              label={t('settings.storage.clearCacheAction')}
              availability={cleanupRunning
                ? { kind: 'disabled', reason: t('settings.storage.clearCacheAction') }
                : undefined}
              onActivate={() => setClearConfirmationRevision(snapshot.revision)}
            />
          )}
        </SettingsRow>
        {projection.cleanup.status === 'succeeded' && releasedBytes !== null ? (
          <Text
            tone="success"
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
            tone="danger"
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
            actionId="storage-batch-manage"
            data-chat-storage-batch-manage
            leading={<Icon iconId={batchMode ? 'close' : 'square-check'} size={14} />}
            label={batchMode
              ? t('settings.storage.batchDone')
              : t('settings.storage.batchManage')}
            availability={(batchRunning || snapshot.conversations.length === 0)
              ? { kind: 'disabled', reason: t('settings.storage.batchManage') }
              : undefined}
            onActivate={toggleBatchMode}
          />
        )}
      >
        <div className="sc-storage-toolbar">
          <TextField
            className="sc-storage-search"
            clearable
            aria-label={t('settings.storage.search')}
            data-chat-storage-search
            leading={<Icon iconId="search" size={14} className="sc-storage-search__icon" />}
            placeholder={t('settings.storage.search')}
            value={query}
            onValueChange={setQuery}
          />
          <div data-chat-storage-sort={sortMode}>
            <Segmented<SortMode>
              density="compact"
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
              onValueChange={(value) => {
                if (value === 'size' || value === 'recent') setSortMode(value);
              }}
            />
          </div>
        </div>
        {batchMode ? (
          <div className="sc-storage-batch" data-chat-storage-batch-actions>
            <div className="sc-storage-batch__head">
              <Checkbox
                checked={allVisibleSelected}
                indeterminate={!allVisibleSelected && someVisibleSelected}
                disabled={batchRunning || conversations.length === 0}
                data-chat-storage-batch-select-all
                onCheckedChange={toggleVisibleConversations}
              >
                {t('settings.storage.batchSelectAll')}
              </Checkbox>
              <Text tone="secondary" data-chat-storage-batch-selection>
                {t('settings.storage.batchSelection', {
                  bytes: formatBytes(selectedReclaimableBytes),
                  count: selectedConversations.length,
                })}
              </Text>
            </div>
            {confirmingBatchClear ? (
              <div
                className="sc-storage-confirm"
                data-chat-storage-batch-confirm
                data-chat-storage-batch-estimated-bytes={String(selectedReclaimableBytes)}
                data-chat-storage-batch-selected-count={String(selectedConversations.length)}
                data-chat-storage-batch-scope="current-device"
              >
                <Text>
                  {t('settings.storage.batchConfirm', {
                    bytes: formatBytes(selectedReclaimableBytes),
                    count: selectedConversations.length,
                  })}
                </Text>
                <div className="sc-storage-confirm__actions">
                  <Button
                    actionId="storage-batch-cancel"
                    label={t('settings.storage.batchCancel')}
                    availability={batchRunning
                      ? { kind: 'disabled', reason: t('settings.storage.batchCancel') }
                      : undefined}
                    onActivate={() => setBatchConfirmationRevision(null)}
                  />
                  <Button
                    actionId="storage-batch-apply"
                    data-chat-storage-batch-confirm-apply
                    tone="danger"
                    emphasis="primary"
                    leading={<Icon iconId="delete" size={14} />}
                    execution={batchRunning ? 'pending' : 'idle'}
                    label={t('settings.storage.batchConfirmAction')}
                    onActivate={() => void clearSelectedConversations()}
                  />
                </div>
              </div>
            ) : (
              <Button
                actionId="storage-batch-clear"
                data-chat-storage-batch-clear
                tone="danger"
                leading={<Icon iconId="delete" size={14} />}
                label={t('settings.storage.batchClearSelected')}
                availability={(batchRunning || selectedConversations.length === 0)
                  ? { kind: 'disabled', reason: t('settings.storage.batchClearSelected') }
                  : undefined}
                onActivate={() => setBatchConfirmationRevision(snapshot.revision)}
              />
            )}
          </div>
        ) : null}
        {batchRunning ? (
          <Text
            tone="secondary"
            role="status"
            data-chat-storage-batch-progress
            data-chat-storage-batch-completed={String(batchProgress.completedCount)}
            data-chat-storage-batch-total={String(batchProgress.totalCount)}
          >
            {t('settings.storage.batchProgress', batchProgress)}
          </Text>
        ) : null}
        {batchResult?.status === 'succeeded' ? (
          <Text
            tone="success"
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
          <div className="sc-storage-batch__partial">
            <Text
              tone="danger"
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
              actionId="storage-batch-retry"
              data-chat-storage-batch-retry
              label={t('settings.storage.batchRetry')}
              availability={batchRunning
                ? { kind: 'disabled', reason: t('settings.storage.batchRetry') }
                : undefined}
              onActivate={() => setBatchConfirmationRevision(snapshot.revision)}
            />
          </div>
        ) : null}
        <div className="sc-storage-conversations" data-chat-storage-conversations>
          {conversations.map((usage) => (
            <div
              key={usage.conversationId}
              className="sc-storage-conversation"
              data-chat-storage-conversation={usage.conversationId}
              data-chat-storage-message-bytes={String(usage.messageBytes)}
              data-chat-storage-media-bytes={String(usage.mediaBytes)}
              data-chat-storage-reclaimable-bytes={String(usage.reclaimableBytes)}
              data-chat-storage-selected={String(
                selectedConversationIds.has(usage.conversationId),
              )}
            >
              {batchMode ? (
                <Checkbox
                  aria-label={t('settings.storage.batchSelectConversation', {
                    name: usage.conversationName || usage.conversationId,
                  })}
                  checked={selectedConversationIds.has(usage.conversationId)}
                  disabled={batchRunning}
                  data-chat-storage-conversation-select={usage.conversationId}
                  onCheckedChange={(checked) => {
                    toggleConversation(usage.conversationId, checked);
                  }}
                />
              ) : null}
              <div className="sc-storage-conversation__meta">
                <Text strong truncate>
                  {usage.conversationName || usage.conversationId}
                </Text>
                <Text tone="secondary" className="sc-storage-conversation__detail">
                  {usage.conversationKind === 2
                    ? t('settings.storage.group')
                    : t('settings.storage.direct')}
                  {' · '}
                  {new Date(Number(usage.lastActivityUnixMs)).toLocaleString()}
                </Text>
              </div>
              <div className="sc-storage-conversation__size">
                <Text strong>{formatBytes(usage.messageBytes + usage.mediaBytes)}</Text>
                <Text tone="secondary" className="sc-storage-conversation__detail">
                  {t('settings.storage.breakdown', {
                    message: formatBytes(usage.messageBytes),
                    media: formatBytes(usage.mediaBytes),
                  })}
                </Text>
              </div>
            </div>
          ))}
          {conversations.length === 0 ? (
            <Text tone="secondary" className="sc-storage-conversations__empty">
              {t('settings.storage.empty')}
            </Text>
          ) : null}
        </div>
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
