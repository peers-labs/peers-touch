/**
 * SettingsSections.tsx — Pure renderer components for each settings section.
 *
 * Each section receives or binds only the controller slice it needs.
 * Sections never fetch or write directly; controller hooks own side effects.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationClearBatchResult } from '@peers-touch/client-chat-core';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Select,
  Switch,
  Tag,
  Typography,
} from 'antd';
import {
  Ban,
  Bell,
  CheckSquare2,
  Globe,
  HardDrive,
  Lock,
  Palette,
  RefreshCw,
  RotateCcw,
  Server,
  Shield,
  Trash2,
  User,
  X,
} from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { ChatRetentionPreset } from '../../gen/proto/domain/chat/storage_pb';
import { MobileNotice } from '../../components/MobileNotice';
import type {
  DevicePermission,
  DevicePreferences,
  FontSizePreset,
  ThemeMode,
} from './devicePreferences';
import type {
  CacheClearStatus,
  BlockedUserView,
  BlockedUsersStatus,
  EditableProfileDraft,
  NotificationPreferenceBooleanField,
  NotificationPreferencesController,
} from './useSettingsController';
import {
  chatStorageReleasedBytes,
  mobileChatStorageProjectionRuntime,
  useMobileChatStorageProjection,
} from '../../runtimes/chatStorageRuntime';

const { Text } = Typography;

// ---------------------------------------------------------------------------
// Profile section
// ---------------------------------------------------------------------------

export function ProfileSection({
  profile,
  actorPtid,
  disabled,
  onPatch,
}: {
  profile: EditableProfileDraft | null;
  actorPtid: string | undefined;
  disabled: boolean;
  onPatch: (patch: Partial<EditableProfileDraft>) => void;
}) {
  const { t } = useMobileI18n();
  return (
    <Card className="settings-section" variant="borderless">
      <div className="settings-section-header">
        <User size={16} />
        <Text strong>{t('mobile.settings.section.profile')}</Text>
      </div>
      <div className="settings-row">
        <Text type="secondary">{t('mobile.settings.profile.userId')}</Text>
        <Text copyable>{actorPtid || t('mobile.settings.notLoggedIn')}</Text>
      </div>
      <label className="settings-profile-field">
        <Text type="secondary">{t('mobile.settings.profile.displayName')}</Text>
        <Input
          value={profile?.displayName ?? ''}
          disabled={disabled || !profile}
          onChange={(event) => onPatch({ displayName: event.target.value })}
        />
      </label>
      <label className="settings-profile-field">
        <Text type="secondary">{t('mobile.settings.profile.bio')}</Text>
        <Input.TextArea
          value={profile?.note ?? ''}
          disabled={disabled || !profile}
          autoSize={{ minRows: 2, maxRows: 5 }}
          onChange={(event) => onPatch({ note: event.target.value })}
        />
      </label>
      <label className="settings-profile-field">
        <Text type="secondary">{t('mobile.settings.profile.avatarUrl')}</Text>
        <Input
          value={profile?.avatar ?? ''}
          disabled={disabled || !profile}
          inputMode="url"
          onChange={(event) => onPatch({ avatar: event.target.value })}
        />
      </label>
      <label className="settings-profile-field">
        <Text type="secondary">{t('mobile.settings.profile.headerUrl')}</Text>
        <Input
          value={profile?.header ?? ''}
          disabled={disabled || !profile}
          inputMode="url"
          onChange={(event) => onPatch({ header: event.target.value })}
        />
      </label>
      <label className="settings-profile-field">
        <Text type="secondary">{t('mobile.settings.profile.region')}</Text>
        <Input
          value={profile?.region ?? ''}
          disabled={disabled || !profile}
          onChange={(event) => onPatch({ region: event.target.value })}
        />
      </label>
      <label className="settings-profile-field">
        <Text type="secondary">{t('mobile.settings.profile.timezone')}</Text>
        <Input
          value={profile?.timezone ?? ''}
          disabled={disabled || !profile}
          onChange={(event) => onPatch({ timezone: event.target.value })}
        />
      </label>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Notifications section (Station-owned category preferences)
// ---------------------------------------------------------------------------

export function NotificationsSection({
  controller,
  permission,
  permissionLoading,
  permissionUnavailable,
  onRequestPermission,
}: {
  controller: NotificationPreferencesController;
  permission?: DevicePermission;
  permissionLoading?: boolean;
  permissionUnavailable?: boolean;
  onRequestPermission?: () => Promise<void>;
}) {
  return (
    <NotificationPreferenceControls
      controller={controller}
      permission={permission}
      permissionLoading={permissionLoading}
      permissionUnavailable={permissionUnavailable}
      onRequestPermission={onRequestPermission}
    />
  );
}

export function NotificationPreferenceControls({
  controller,
  permission,
  permissionLoading,
  permissionUnavailable,
  onRequestPermission,
}: {
  controller: NotificationPreferencesController;
  permission?: DevicePermission;
  permissionLoading?: boolean;
  permissionUnavailable?: boolean;
  onRequestPermission?: () => Promise<void>;
}) {
  const { t } = useMobileI18n();
  const controls: ReadonlyArray<{
    field: NotificationPreferenceBooleanField;
    labelKey: string;
  }> = [
    {
      field: 'enabled',
      labelKey: 'mobile.settings.notifications.enabled',
    },
    {
      field: 'pushEnabled',
      labelKey: 'mobile.settings.notifications.push',
    },
    {
      field: 'soundEnabled',
      labelKey: 'mobile.settings.notifications.sound',
    },
  ];

  return (
    <Card className="settings-section" variant="borderless">
      <div className="settings-section-header">
        <Bell size={16} />
        <Text strong>{t('mobile.settings.section.notifications')}</Text>
      </div>
      {!permissionLoading
        && !permissionUnavailable
        && permission
        && permission.status !== 'granted' ? (
        <div
          className="settings-row"
          data-notification-permission-required={permission.status}
          role="status"
        >
          <Text>{t('mobile.settings.permissions.hint')}</Text>
          <Tag color={PERMISSION_STATUS_COLORS[permission.status]}>
            {t(PERMISSION_STATUS_KEYS[permission.status])}
          </Tag>
          {permission.canRequest && onRequestPermission ? (
            <Button size="small" onClick={() => void onRequestPermission()}>
              {t('common.action.enable')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {controller.loading ? (
        <Text type="secondary">{t('mobile.settings.storage.calculating')}</Text>
      ) : controller.unavailable ? (
        <>
          <Text type="secondary">{t('mobile.launch.unavailable')}</Text>
          <Button block onClick={() => void controller.reload()}>
            {t('common.action.retry')}
          </Button>
        </>
      ) : (
        <>
          {controls.map(({ field, labelKey }) => {
            const value = aggregateNotificationPreference(
              controller.preferences,
              field,
            );
            return (
              <div className="settings-row" key={field}>
                <Text>{t(labelKey)}</Text>
                <Checkbox
                  aria-label={t(labelKey)}
                  checked={value === 'enabled'}
                  indeterminate={value === 'mixed'}
                  disabled={controller.saveStatus === 'saving'}
                  data-notification-setting={field}
                  data-notification-value={value}
                  onChange={(event) => controller.patch(field, event.target.checked)}
                />
              </div>
            );
          })}
        </>
      )}
    </Card>
  );
}

function aggregateNotificationPreference(
  preferences: NotificationPreferencesController['preferences'],
  field: NotificationPreferenceBooleanField,
): 'enabled' | 'disabled' | 'mixed' {
  const enabledCount = preferences.reduce(
    (count, preference) => count + (preference[field] ? 1 : 0),
    0,
  );
  if (enabledCount === 0) return 'disabled';
  if (enabledCount === preferences.length) return 'enabled';
  return 'mixed';
}

// ---------------------------------------------------------------------------
// Privacy section (Actor Profile owner)
// ---------------------------------------------------------------------------

const VISIBILITY_OPTIONS = [
  { value: 'public', labelKey: 'mobile.settings.privacy.visibility.public' },
  { value: 'unlisted', labelKey: 'mobile.settings.privacy.visibility.unlisted' },
  { value: 'followers', labelKey: 'mobile.settings.privacy.visibility.followers' },
  { value: 'private', labelKey: 'mobile.settings.privacy.visibility.private' },
] as const;

const MESSAGE_PERMISSION_OPTIONS = [
  { value: 'everyone', labelKey: 'mobile.settings.privacy.message.everyone' },
  { value: 'friends', labelKey: 'mobile.settings.privacy.message.friends' },
  { value: 'none', labelKey: 'mobile.settings.privacy.message.none' },
] as const;

export function PrivacySection({
  profile,
  disabled,
  onPatch,
}: {
  profile: EditableProfileDraft | null;
  disabled: boolean;
  onPatch: (patch: Partial<EditableProfileDraft>) => void;
}) {
  const { t } = useMobileI18n();
  const controlsDisabled = disabled || !profile;
  return (
    <Card className="settings-section" variant="borderless">
      <div className="settings-section-header">
        <Lock size={16} />
        <Text strong>{t('mobile.settings.section.privacy')}</Text>
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.privacy.defaultVisibility')}</Text>
        <Select
          aria-label={t('mobile.settings.privacy.defaultVisibility')}
          value={profile?.defaultVisibility || undefined}
          disabled={controlsDisabled}
          data-privacy-setting="defaultVisibility"
          onChange={(value) => onPatch({ defaultVisibility: value })}
          options={VISIBILITY_OPTIONS.map(({ value, labelKey }) => ({
            value,
            label: t(labelKey),
          }))}
          style={{ minWidth: 144 }}
        />
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.privacy.manuallyApprovesFollowers')}</Text>
        <Switch
          aria-label={t('mobile.settings.privacy.manuallyApprovesFollowers')}
          checked={profile?.manuallyApprovesFollowers ?? false}
          disabled={controlsDisabled}
          data-privacy-setting="manuallyApprovesFollowers"
          onChange={(checked) => onPatch({ manuallyApprovesFollowers: checked })}
        />
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.privacy.messagePermission')}</Text>
        <Select
          aria-label={t('mobile.settings.privacy.messagePermission')}
          value={profile?.messagePermission || undefined}
          disabled={controlsDisabled}
          data-privacy-setting="messagePermission"
          onChange={(value) => onPatch({ messagePermission: value })}
          options={MESSAGE_PERMISSION_OPTIONS.map(({ value, labelKey }) => ({
            value,
            label: t(labelKey),
          }))}
          style={{ minWidth: 144 }}
        />
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.privacy.autoExpire')}</Text>
        <InputNumber
          aria-label={t('mobile.settings.privacy.autoExpire')}
          value={profile?.autoExpireDays ?? null}
          min={0}
          max={2_147_483_647}
          precision={0}
          disabled={controlsDisabled}
          data-privacy-setting="autoExpireDays"
          onChange={(value) => {
            if (typeof value === 'number') onPatch({ autoExpireDays: value });
          }}
          style={{ width: 112 }}
        />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Device preferences section (local-only)
// ---------------------------------------------------------------------------

const THEME_OPTIONS: { value: ThemeMode; labelKey: string }[] = [
  { value: 'system', labelKey: 'mobile.settings.device.theme.system' },
  { value: 'light', labelKey: 'mobile.settings.device.theme.light' },
  { value: 'dark', labelKey: 'mobile.settings.device.theme.dark' },
];

const FONT_SIZE_OPTIONS: { value: FontSizePreset; labelKey: string }[] = [
  { value: 'small', labelKey: 'mobile.settings.device.fontSize.small' },
  { value: 'medium', labelKey: 'mobile.settings.device.fontSize.medium' },
  { value: 'large', labelKey: 'mobile.settings.device.fontSize.large' },
];

export function DevicePrefsSection({
  prefs,
  loading,
  unavailable,
  onPatch,
  onRetry,
}: {
  prefs: DevicePreferences | null;
  loading: boolean;
  unavailable: boolean;
  onPatch: (patch: Partial<DevicePreferences>) => void;
  onRetry: () => Promise<void>;
}) {
  const { t } = useMobileI18n();
  return (
    <Card className="settings-section" variant="borderless">
      <div className="settings-section-header">
        <Palette size={16} />
        <Text strong>{t('mobile.settings.section.devicePrefs')}</Text>
      </div>
      {loading ? (
        <Text type="secondary">{t('mobile.settings.storage.calculating')}</Text>
      ) : unavailable || !prefs ? (
        <>
          <Text type="secondary">{t('mobile.settings.device.unavailable')}</Text>
          <Button block onClick={() => void onRetry()}>
            {t('common.action.retry')}
          </Button>
        </>
      ) : (
        <>
          <div className="settings-row">
            <Text>{t('mobile.settings.device.theme')}</Text>
            <Select
              size="small"
              value={prefs.theme}
              onChange={(value) => onPatch({ theme: value })}
              options={THEME_OPTIONS.map(({ value, labelKey }) => ({
                value,
                label: t(labelKey),
              }))}
              style={{ width: 120 }}
            />
          </div>
          <div className="settings-row">
            <Text>{t('mobile.settings.device.fontSize')}</Text>
            <Select
              size="small"
              value={prefs.fontSize}
              onChange={(value) => onPatch({ fontSize: value })}
              options={FONT_SIZE_OPTIONS.map(({ value, labelKey }) => ({
                value,
                label: t(labelKey),
              }))}
              style={{ width: 100 }}
            />
          </div>
          <div className="settings-row">
            <Text>{t('mobile.settings.device.compactMode')}</Text>
            <Switch
              size="small"
              checked={prefs.compactMode}
              onChange={(checked) => onPatch({ compactMode: checked })}
            />
          </div>
          <div className="settings-row">
            <Text>{t('mobile.settings.device.mediaAutoDownload')}</Text>
            <Text type="secondary">{t('mobile.launch.unavailable')}</Text>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Language section
// ---------------------------------------------------------------------------

export function LanguageSection() {
  const {
    t,
    language,
    languages,
    languageStatus,
    languageError,
    setLanguage,
    retryLanguage,
  } = useMobileI18n();
  return (
    <Card className="settings-section" variant="borderless">
      <div className="settings-section-header">
        <Globe size={16} />
        <Text strong>{t('mobile.settings.section.language')}</Text>
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.section.language')}</Text>
        <Select
          size="small"
          value={language}
          loading={languageStatus === 'saving'}
          disabled={languageStatus === 'saving'}
          onChange={(value) => void setLanguage(value)}
          options={languages.map((option) => ({
            value: option.code,
            label: option.nativeName,
          }))}
          style={{ width: 140 }}
        />
      </div>
      {languageStatus === 'failed' ? (
        <div className="settings-row" role="alert">
          <Text type="danger">
            {t(languageError ?? 'mobile.settings.language.saveFailed')}
          </Text>
          <Button size="small" onClick={() => void retryLanguage()}>
            {t('common.action.retry')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Storage section
// ---------------------------------------------------------------------------

export function StorageSection({
  onClearCache,
  status,
}: {
  onClearCache: () => Promise<void>;
  status: CacheClearStatus;
}) {
  const { t } = useMobileI18n();
  const projection = useMobileChatStorageProjection();
  const [query, setQuery] = useState('');
  const [chatCacheConfirmationRevision, setChatCacheConfirmationRevision] = useState<
    string | null
  >(null);
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
  const confirmingChatCacheClear = snapshot !== null
    && chatCacheConfirmationRevision === snapshot.revision;
  const confirmingBatchClear = snapshot !== null
    && batchConfirmationRevision === snapshot.revision;
  const releasedBytes = chatStorageReleasedBytes(projection.cleanup.result);
  const retentionReleasedBytes = chatStorageReleasedBytes(projection.retention.result);
  const chatCleanupRunning = projection.cleanup.status === 'clearing';
  const retentionSaving = projection.retention.status === 'saving';
  const retentionPreset = snapshot?.retentionPolicy?.retentionPreset
    ?? ChatRetentionPreset.CHAT_RETENTION_PRESET_FOREVER;

  const conversations = useMemo(() => {
    if (!snapshot) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return snapshot.conversations.filter((usage) => {
      if (!normalizedQuery) return true;
      return `${usage.conversationName} ${usage.conversationId}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }, [query, snapshot]);
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
    if (!snapshot || batchRunning) return;
    const selectedIds = snapshot.conversations
      .map((usage) => usage.conversationId)
      .filter((conversationId) => selectedConversationIds.has(conversationId));
    if (selectedIds.length === 0) return;
    const attempt = batchAttemptRef.current + 1;
    batchAttemptRef.current = attempt;
    setBatchConfirmationRevision(null);
    setBatchResult(null);
    setBatchProgress({ completedCount: 0, totalCount: selectedIds.length });
    setBatchRunning(true);
    try {
      const result = await mobileChatStorageProjectionRuntime.clearConversations(
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
      setSelectedConversationIds(new Set([
        ...result.failedIds,
        ...result.remainingIds,
      ]));
      if (result.status === 'succeeded') setBatchMode(false);
    } finally {
      if (batchAttemptRef.current === attempt) setBatchRunning(false);
    }
  };

  return (
    <Card
      className="settings-section"
      variant="borderless"
      data-chat-storage-surface
    >
      <div className="settings-section-header">
        <HardDrive size={16} />
        <Text strong>{t('mobile.settings.section.storage')}</Text>
        <Button
          size="small"
          type="text"
          data-chat-storage-batch-manage
          icon={batchMode ? <X size={14} /> : <CheckSquare2 size={14} />}
          disabled={batchRunning || !snapshot || snapshot.conversations.length === 0}
          onClick={toggleBatchMode}
          style={{ marginLeft: 'auto' }}
        >
          {batchMode
            ? t('mobile.settings.storage.batchDone')
            : t('mobile.settings.storage.batchManage')}
        </Button>
      </div>
      {snapshot ? (
        <>
          <div
            className="settings-row"
            data-chat-storage-summary
            data-chat-storage-physical-bytes={String(snapshot.physicalTotalBytes)}
            data-chat-storage-measured-at={String(snapshot.measuredAtUnixMs)}
          >
            <Text>{t('mobile.settings.storage.total')}</Text>
            <Text strong>{formatBytes(snapshot.physicalTotalBytes)}</Text>
          </div>
          {[
            ['message', snapshot.messageBytes],
            ['media', snapshot.mediaBytes],
            ['cache', snapshot.cacheBytes],
            ['system', snapshot.systemBytes],
          ].map(([key, value]) => (
            <div
              className="settings-row"
              key={String(key)}
              data-chat-storage-category={String(key)}
              data-chat-storage-category-bytes={String(value)}
            >
              <Text type="secondary">
                {t(`mobile.settings.storage.${String(key)}`)}
              </Text>
              <Text>{formatBytes(value as bigint)}</Text>
            </div>
          ))}
          <div className="settings-row">
            <Text type="secondary">
              {new Date(Number(snapshot.measuredAtUnixMs)).toLocaleString()}
            </Text>
            {projection.stale || snapshot.issues.length > 0 ? (
              <Tag color="warning">{t('mobile.settings.storage.stale')}</Tag>
            ) : null}
            <Button
              aria-label={t('mobile.settings.storage.retry')}
              data-chat-storage-refresh
              icon={<RefreshCw size={14} />}
              loading={projection.status === 'measuring'}
              onClick={() => void mobileChatStorageProjectionRuntime.refresh()}
            />
          </div>
          <Input.Search
            allowClear
            aria-label={t('mobile.settings.storage.search')}
            data-chat-storage-search
            placeholder={t('mobile.settings.storage.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {batchMode ? (
            <div className="settings-dirty-actions" data-chat-storage-batch-actions>
              <div className="settings-row">
                <Checkbox
                  checked={allVisibleSelected}
                  disabled={batchRunning || conversations.length === 0}
                  indeterminate={!allVisibleSelected && someVisibleSelected}
                  data-chat-storage-batch-select-all
                  onChange={(event) => toggleVisibleConversations(event.target.checked)}
                >
                  {t('mobile.settings.storage.batchSelectAll')}
                </Checkbox>
                <Text type="secondary" data-chat-storage-batch-selection>
                  {t('mobile.settings.storage.batchSelection', {
                    bytes: formatBytes(selectedReclaimableBytes),
                    count: selectedConversations.length,
                  })}
                </Text>
              </div>
              {confirmingBatchClear ? (
                <>
                  <MobileNotice tone="info">
                    {t('mobile.settings.storage.batchConfirm', {
                      bytes: formatBytes(selectedReclaimableBytes),
                      count: selectedConversations.length,
                    })}
                  </MobileNotice>
                  <div
                    className="settings-station-actions"
                    data-chat-storage-batch-confirm
                    data-chat-storage-batch-estimated-bytes={String(selectedReclaimableBytes)}
                    data-chat-storage-batch-selected-count={String(selectedConversations.length)}
                    data-chat-storage-batch-scope="current-device"
                  >
                    <Button
                      block
                      disabled={batchRunning}
                      onClick={() => setBatchConfirmationRevision(null)}
                    >
                      {t('mobile.settings.storage.batchCancel')}
                    </Button>
                    <Button
                      block
                      danger
                      type="primary"
                      data-chat-storage-batch-confirm-apply
                      icon={<Trash2 size={14} />}
                      loading={batchRunning}
                      onClick={() => void clearSelectedConversations()}
                    >
                      {t('mobile.settings.storage.batchConfirmAction')}
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  block
                  danger
                  data-chat-storage-batch-clear
                  icon={<Trash2 size={14} />}
                  disabled={batchRunning || selectedConversations.length === 0}
                  onClick={() => setBatchConfirmationRevision(snapshot.revision)}
                >
                  {t('mobile.settings.storage.batchClearSelected')}
                </Button>
              )}
            </div>
          ) : null}
          {batchRunning ? (
            <Text
              type="secondary"
              role="status"
              data-chat-storage-batch-progress
              data-chat-storage-batch-completed={String(batchProgress.completedCount)}
              data-chat-storage-batch-total={String(batchProgress.totalCount)}
            >
              {t('mobile.settings.storage.batchProgress', batchProgress)}
            </Text>
          ) : null}
          {batchResult?.status === 'succeeded' ? (
            <div
              data-chat-storage-batch-result="succeeded"
              data-chat-storage-batch-succeeded={String(batchResult.succeededIds.length)}
              data-chat-storage-batch-failed="0"
              data-chat-storage-released-bytes={String(batchResult.releasedBytes)}
            >
              <MobileNotice tone="success">
                {t('mobile.settings.storage.batchSucceeded', {
                  bytes: formatBytes(batchResult.releasedBytes),
                  count: batchResult.succeededIds.length,
                })}
              </MobileNotice>
            </div>
          ) : null}
          {batchResult?.status === 'partial_failure' ? (
            <div
              data-chat-storage-batch-result="partial_failure"
              data-chat-storage-batch-succeeded={String(batchResult.succeededIds.length)}
              data-chat-storage-batch-failed={String(batchResult.failedIds.length)}
              data-chat-storage-released-bytes={String(batchResult.releasedBytes)}
            >
              <MobileNotice tone="error">
                {t('mobile.settings.storage.batchPartial', {
                  bytes: formatBytes(batchResult.releasedBytes),
                  failed: batchResult.failedIds.length,
                  succeeded: batchResult.succeededIds.length,
                  total: batchResult.requestedIds.length,
                })}
              </MobileNotice>
              <Button
                block
                data-chat-storage-batch-retry
                disabled={batchRunning}
                onClick={() => setBatchConfirmationRevision(snapshot.revision)}
              >
                {t('mobile.settings.storage.batchRetry')}
              </Button>
            </div>
          ) : null}
          <div className="settings-storage-conversations">
            {conversations.map((usage) => (
              <div
                className="settings-row"
                key={usage.conversationId}
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
                    aria-label={t('mobile.settings.storage.batchSelectConversation', {
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
                <div className="settings-storage-conversation-label">
                  <Text strong ellipsis>
                    {usage.conversationName || usage.conversationId}
                  </Text>
                  <Text type="secondary">
                    {usage.conversationKind === 2
                      ? t('mobile.settings.storage.group')
                      : t('mobile.settings.storage.direct')}
                  </Text>
                </div>
                <Text>{formatBytes(usage.messageBytes + usage.mediaBytes)}</Text>
              </div>
            ))}
            {conversations.length === 0 ? (
              <Text type="secondary">{t('mobile.settings.storage.empty')}</Text>
            ) : null}
          </div>
        </>
      ) : (
        <div className="settings-row" role={projection.status === 'unavailable' ? 'alert' : 'status'}>
          <Text type="secondary">
            {projection.status === 'unavailable'
              ? t('mobile.settings.storage.unavailable')
              : t('mobile.settings.storage.calculating')}
          </Text>
          <Button
            aria-label={t('mobile.settings.storage.retry')}
            data-chat-storage-refresh
            icon={<RefreshCw size={14} />}
            loading={projection.status === 'measuring'}
            onClick={() => void mobileChatStorageProjectionRuntime.refresh()}
          />
        </div>
      )}
      <div className="settings-dirty-actions" data-chat-storage-retention>
        <div className="settings-row">
          <div className="setting-copy">
            <Text strong>{t('mobile.settings.storage.retentionTitle')}</Text>
            <Text type="secondary">
              {t('mobile.settings.storage.retentionDescription')}
            </Text>
          </div>
          <Select<ChatRetentionPreset>
            aria-label={t('mobile.settings.storage.retentionTitle')}
            data-chat-storage-retention-select
            disabled={!snapshot || retentionSaving || chatCleanupRunning}
            loading={retentionSaving}
            value={retentionPreset}
            options={[
              {
                label: (
                  <span data-chat-storage-retention-option="forever">
                    {t('mobile.settings.storage.retentionForever')}
                  </span>
                ),
                value: ChatRetentionPreset.CHAT_RETENTION_PRESET_FOREVER,
              },
              {
                label: (
                  <span data-chat-storage-retention-option="365">
                    {t('mobile.settings.storage.retentionYear')}
                  </span>
                ),
                value: ChatRetentionPreset.CHAT_RETENTION_PRESET_365_DAYS,
              },
              {
                label: (
                  <span data-chat-storage-retention-option="90">
                    {t('mobile.settings.storage.retention90Days')}
                  </span>
                ),
                value: ChatRetentionPreset.CHAT_RETENTION_PRESET_90_DAYS,
              },
              {
                label: (
                  <span data-chat-storage-retention-option="30">
                    {t('mobile.settings.storage.retention30Days')}
                  </span>
                ),
                value: ChatRetentionPreset.CHAT_RETENTION_PRESET_30_DAYS,
              },
            ]}
            onChange={(value) => {
              void mobileChatStorageProjectionRuntime.setRetention(value);
            }}
          />
        </div>
        <div data-chat-storage-retention-preset={String(retentionPreset)}>
          {projection.retention.status === 'succeeded' ? (
            <div
              data-chat-storage-retention-result="succeeded"
              data-chat-storage-retention-released-bytes={String(retentionReleasedBytes ?? 0n)}
            >
              <MobileNotice tone="success">
                {t('mobile.settings.storage.retentionSaved')}
              </MobileNotice>
            </div>
          ) : null}
          {projection.retention.status === 'failed' ? (
            <div data-chat-storage-retention-result="failed">
              <MobileNotice tone="error">
                {t('mobile.settings.storage.retentionFailed')}
              </MobileNotice>
            </div>
          ) : null}
        </div>
      </div>
      <div
        className="settings-dirty-actions"
        data-chat-storage-cache-cleanup
      >
        <div className="settings-row">
          <div className="setting-copy">
            <Text strong>{t('mobile.settings.storage.clearChatCacheTitle')}</Text>
            <Text type="secondary">
              {t('mobile.settings.storage.clearChatCacheDescription')}
            </Text>
          </div>
          {!confirmingChatCacheClear ? (
            <Button
              data-chat-storage-clear-cache
              icon={<Trash2 size={14} />}
              disabled={chatCleanupRunning || !snapshot}
              onClick={() => setChatCacheConfirmationRevision(snapshot?.revision ?? null)}
            >
              {t('mobile.settings.storage.clearChatCacheAction')}
            </Button>
          ) : null}
        </div>
        {confirmingChatCacheClear ? (
          <>
            <MobileNotice tone="info">
              {t('mobile.settings.storage.clearChatCacheConfirm')}
            </MobileNotice>
            <div className="settings-station-actions" data-chat-storage-clear-confirm>
              <Button
                block
                disabled={chatCleanupRunning}
                onClick={() => setChatCacheConfirmationRevision(null)}
              >
                {t('mobile.settings.storage.clearChatCacheCancel')}
              </Button>
              <Button
                block
                danger
                type="primary"
                data-chat-storage-clear-confirm-apply
                icon={<Trash2 size={14} />}
                loading={chatCleanupRunning}
                onClick={() => {
                  void mobileChatStorageProjectionRuntime.clearCache().then(() => {
                    setChatCacheConfirmationRevision(null);
                  });
                }}
              >
                {t('mobile.settings.storage.clearChatCacheConfirmAction')}
              </Button>
            </div>
          </>
        ) : null}
        {projection.cleanup.status === 'succeeded' && releasedBytes !== null ? (
          <div
            data-chat-storage-clear-result="succeeded"
            data-chat-storage-released-bytes={String(releasedBytes)}
          >
            <MobileNotice tone="success">
              {t('mobile.settings.storage.clearChatCacheReleased', {
                bytes: formatBytes(releasedBytes),
              })}
            </MobileNotice>
          </div>
        ) : null}
        {projection.cleanup.status === 'failed' ? (
          <div data-chat-storage-clear-result="failed">
            <MobileNotice tone="error">
              {releasedBytes === null
                ? t('mobile.settings.storage.clearChatCacheFailed')
                : t('mobile.settings.storage.clearChatCacheFailedWithReleased', {
                    bytes: formatBytes(releasedBytes),
                  })}
            </MobileNotice>
          </div>
        ) : null}
      </div>
      <Button
        block
        data-mobile-device-cache-clear
        loading={status === 'clearing'}
        disabled={status === 'clearing'}
        onClick={() => void onClearCache()}
      >
        {t('mobile.settings.storage.clearDeviceCache')}
      </Button>
      {status === 'cleared' ? (
        <Text type="success">{t('mobile.settings.storage.deviceCacheCleared')}</Text>
      ) : null}
      {status === 'error' ? (
        <Text type="danger">{t('mobile.settings.storage.deviceCacheClearFailed')}</Text>
      ) : null}
    </Card>
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

// ---------------------------------------------------------------------------
// Permissions section
// ---------------------------------------------------------------------------

const PERMISSION_LABEL_KEYS: Record<DevicePermission['kind'], string> = {
  camera: 'mobile.settings.permissions.camera',
  microphone: 'mobile.settings.permissions.microphone',
  notifications: 'mobile.settings.section.notifications',
  storage: 'mobile.settings.section.storage',
};

const PERMISSION_STATUS_COLORS: Record<DevicePermission['status'], string> = {
  not_determined: 'blue',
  granted: 'green',
  denied: 'red',
  restricted: 'orange',
  unsupported: 'default',
};

const PERMISSION_STATUS_KEYS: Record<DevicePermission['status'], string> = {
  not_determined: 'mobile.settings.permissions.status.notDetermined',
  granted: 'mobile.settings.permissions.status.granted',
  denied: 'mobile.settings.permissions.status.denied',
  restricted: 'mobile.settings.permissions.status.restricted',
  unsupported: 'mobile.settings.permissions.status.unsupported',
};

export function PermissionsSection({
  permissions,
  loading,
  unavailable,
  onRefresh,
  onRequest,
}: {
  permissions: readonly DevicePermission[];
  loading: boolean;
  unavailable: boolean;
  onRefresh: () => Promise<void>;
  onRequest: (kind: DevicePermission['kind']) => Promise<void>;
}) {
  const { t } = useMobileI18n();
  return (
    <Card className="settings-section" variant="borderless">
      <div className="settings-section-header">
        <Shield size={16} />
        <Text strong>{t('mobile.settings.section.permissions')}</Text>
      </div>
      {loading ? (
        <Text type="secondary">{t('mobile.settings.storage.calculating')}</Text>
      ) : unavailable ? (
        <>
          <Text type="secondary">{t('mobile.launch.unavailable')}</Text>
          <Button block onClick={() => void onRefresh()}>
            {t('common.action.retry')}
          </Button>
        </>
      ) : (
        <>
          {permissions.length === 0 ? (
            <Text type="secondary">{t('mobile.launch.unavailable')}</Text>
          ) : permissions.map((permission) => (
            <div className="settings-row" key={permission.kind}>
              <Text>{t(PERMISSION_LABEL_KEYS[permission.kind])}</Text>
              <Tag
                color={PERMISSION_STATUS_COLORS[permission.status]}
                data-permission-status={permission.status}
              >
                {t(PERMISSION_STATUS_KEYS[permission.status])}
              </Tag>
              {permission.canRequest && permission.status !== 'granted' ? (
                <Button
                  size="small"
                  onClick={() => void onRequest(permission.kind)}
                >
                  {t('common.action.enable')}
                </Button>
              ) : null}
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Blocked users section
// ---------------------------------------------------------------------------

export function BlockedUsersSection({
  users,
  status,
  errorKey,
  unblockingPtid,
  onRetry,
  onUnblock,
}: {
  users: readonly BlockedUserView[];
  status: BlockedUsersStatus;
  errorKey: string | null;
  unblockingPtid: string | null;
  onRetry: () => Promise<void>;
  onUnblock: (targetPtid: string) => Promise<void>;
}) {
  const { t } = useMobileI18n();
  return (
    <Card className="settings-section" variant="borderless">
      <div className="settings-section-header">
        <Ban size={16} />
        <Text strong>{t('mobile.settings.section.blocked')}</Text>
      </div>
      {status === 'loading' ? (
        <Text type="secondary">{t('mobile.settings.storage.calculating')}</Text>
      ) : status === 'unavailable' ? (
        <>
          <Text type="secondary" role="alert">
            {t('mobile.launch.unavailable')}
          </Text>
          <Button block onClick={() => void onRetry()}>
            {t('common.action.retry')}
          </Button>
        </>
      ) : users.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('mobile.settings.noBlockedUsers')}
        />
      ) : (
        users.map((item) => (
          <div
            className="settings-row"
            data-blocked-user={item.targetPtid}
            key={item.targetPtid}
          >
            <Avatar src={item.avatar || undefined}>
              {item.displayName.slice(0, 2).toUpperCase()}
            </Avatar>
            <div className="settings-station-copy settings-blocked-user-copy">
              <Text>{item.displayName}</Text>
              <Text copyable>{item.targetPtid}</Text>
              {item.homeStationPeerId ? (
                <Text type="secondary">{item.homeStationPeerId}</Text>
              ) : null}
            </div>
            <Button
              className="settings-blocked-user-action"
              size="small"
              icon={<RotateCcw size={13} />}
              loading={unblockingPtid === item.targetPtid}
              disabled={unblockingPtid !== null}
              onClick={() => void onUnblock(item.targetPtid)}
            >
              {t('mobile.contacts.unblock')}
            </Button>
          </div>
        ))
      )}
      {errorKey ? (
        <Text type="danger" role="alert">{t(errorKey)}</Text>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Station section
// ---------------------------------------------------------------------------

export function StationSection({
  stationLabel,
  stationUrl,
  identityVerified,
  onChangeStation,
  onLogout,
  loggingOut,
}: {
  stationLabel: string;
  stationUrl: string;
  identityVerified: boolean;
  onChangeStation: () => Promise<void>;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const { t } = useMobileI18n();
  return (
    <Card className="settings-section" variant="borderless">
      <div className="settings-section-header">
        <Server size={16} />
        <Text strong>{t('mobile.settings.section.station')}</Text>
      </div>
      <div className="settings-station-header">
        <div className="settings-station-copy">
          <Text strong>{stationLabel}</Text>
          <Text type="secondary" ellipsis>{stationUrl}</Text>
        </div>
        <Tag
          color={identityVerified ? 'green' : 'default'}
          data-station-trust={identityVerified ? 'verified' : 'unverified'}
        >
          {identityVerified
            ? t('mobile.launch.verified')
            : t('mobile.launch.unverified')}
        </Tag>
      </div>
      <div className="settings-station-actions">
        <Button block onClick={() => void onChangeStation()}>
          {t('mobile.settings.station.changeStation')}
        </Button>
        <Button block danger loading={loggingOut} onClick={onLogout}>
          {loggingOut ? t('mobile.settings.station.loggingOut') : t('mobile.settings.logout')}
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Dirty bar — floating save/discard bar
// ---------------------------------------------------------------------------

export function DirtyBar({
  dirty,
  conflict,
  saveStatus,
  saveError,
  onSave,
  onDiscard,
  onReload,
}: {
  dirty: boolean;
  conflict: boolean;
  saveStatus: string;
  saveError: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onReload: () => void;
}) {
  const { t } = useMobileI18n();

  if (!dirty && !conflict && saveStatus !== 'saved') return null;

  return (
    <div className="settings-dirty-bar">
      {conflict && (
        <div className="settings-dirty-conflict">
          <Text type="warning">{t('mobile.settings.dirty.conflict')}</Text>
          <Button size="small" onClick={onReload}>{t('mobile.settings.dirty.reload')}</Button>
        </div>
      )}
      {saveStatus === 'saved' && !dirty && (
        <Text type="success">{t('mobile.settings.dirty.saved')}</Text>
      )}
      {saveError && saveStatus === 'error' && !conflict && (
        <Text type="danger">{t(saveError)}</Text>
      )}
      {dirty && !conflict && (
        <div className="settings-dirty-actions">
          <Text type="secondary">{t('mobile.settings.dirty.unsavedChanges')}</Text>
          <div className="settings-dirty-buttons">
            <Button size="small" onClick={onDiscard}>
              {t('mobile.settings.dirty.discardChanges')}
            </Button>
            <Button size="small" type="primary" loading={saveStatus === 'saving'} onClick={onSave}>
              {saveStatus === 'saving' ? t('mobile.settings.dirty.saving') : t('mobile.settings.dirty.saveChanges')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
