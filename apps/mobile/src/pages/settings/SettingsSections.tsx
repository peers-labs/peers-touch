/**
 * SettingsSections.tsx — Pure renderer components for each settings section.
 *
 * Each section receives or binds only the controller slice it needs.
 * Sections never fetch or write directly; controller hooks own side effects.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationClearBatchResult } from '@peers-touch/client-chat-core';
import {
  Button as PButton,
  Checkbox,
  Empty as PEmpty,
  Icon,
  IconButton,
  NumberField,
  Select,
  Switch,
  Tag,
  Text,
  TextArea,
  TextField,
} from '@peers-touch/ui';

import { useMobileI18n } from '../../app/mobileI18n';
import type { MobileLanguage } from '../../runtimes/languageRuntime';
import { ChatRetentionPreset } from '../../gen/proto/domain/chat/storage_pb';
import { MobileNotice } from '../../components/MobileNotice';
import { MobileAvatar } from '../../components/MobileAvatar';
import type { MobileStationRouteCandidate } from '../../features/station/stationRegistry';
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

const PERMISSION_STATUS_TONES: Record<DevicePermission['status'], 'info' | 'success' | 'danger' | 'warning' | undefined> = {
  not_determined: 'info',
  granted: 'success',
  denied: 'danger',
  restricted: 'warning',
  unsupported: undefined,
};

// ---------------------------------------------------------------------------
// Profile section
// ---------------------------------------------------------------------------

export function ProfileSection({
  profile,
  actorIdentity,
  disabled,
  onPatch,
}: {
  profile: EditableProfileDraft | null;
  actorIdentity: string | undefined;
  disabled: boolean;
  onPatch: (patch: Partial<EditableProfileDraft>) => void;
}) {
  const { t } = useMobileI18n();
  return (
    <section className="settings-section">
      <div className="settings-section-body">
      <div className="settings-section-header">
        <Icon iconId="user" size={16} />
        <Text strong>{t('mobile.settings.section.profile')}</Text>
      </div>
      <div className="settings-row">
        <Text tone="secondary">{t('mobile.settings.profile.userId')}</Text>
        <Text>{actorIdentity || t('mobile.settings.notLoggedIn')}</Text>
      </div>
      <label className="settings-profile-field">
        <Text tone="secondary">{t('mobile.settings.profile.displayName')}</Text>
        <TextField
          value={profile?.displayName ?? ''}
          disabled={disabled || !profile}
          onValueChange={(value) => onPatch({ displayName: value })}
        />
      </label>
      <label className="settings-profile-field">
        <Text tone="secondary">{t('mobile.settings.profile.bio')}</Text>
        <TextArea
          value={profile?.note ?? ''}
          disabled={disabled || !profile}
          minimumRows={2}
          maximumRows={5}
          onValueChange={(value) => onPatch({ note: value })}
        />
      </label>
      <label className="settings-profile-field">
        <Text tone="secondary">{t('mobile.settings.profile.avatarUrl')}</Text>
        <TextField
          value={profile?.avatar ?? ''}
          disabled={disabled || !profile}
          inputMode="url"
          onValueChange={(value) => onPatch({ avatar: value })}
        />
      </label>
      <label className="settings-profile-field">
        <Text tone="secondary">{t('mobile.settings.profile.headerUrl')}</Text>
        <TextField
          value={profile?.header ?? ''}
          disabled={disabled || !profile}
          inputMode="url"
          onValueChange={(value) => onPatch({ header: value })}
        />
      </label>
      <label className="settings-profile-field">
        <Text tone="secondary">{t('mobile.settings.profile.region')}</Text>
        <TextField
          value={profile?.region ?? ''}
          disabled={disabled || !profile}
          onValueChange={(value) => onPatch({ region: value })}
        />
      </label>
      <label className="settings-profile-field">
        <Text tone="secondary">{t('mobile.settings.profile.timezone')}</Text>
        <TextField
          value={profile?.timezone ?? ''}
          disabled={disabled || !profile}
          onValueChange={(value) => onPatch({ timezone: value })}
        />
      </label>
      </div>
    </section>
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
    <section className="settings-section">
      <div className="settings-section-body">
      <div className="settings-section-header">
        <Icon iconId="bell" size={16} />
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
          <Tag tone={PERMISSION_STATUS_TONES[permission.status]}>
            {t(PERMISSION_STATUS_KEYS[permission.status])}
          </Tag>
          {permission.canRequest && onRequestPermission ? (
            <PButton
              actionId="notification-enable"
              emphasis="secondary"
              density="compact"
              onActivate={() => void onRequestPermission()}
            >
              {t('common.action.enable')}
            </PButton>
          ) : null}
        </div>
      ) : null}
      {controller.loading ? (
        <Text tone="secondary">{t('mobile.settings.storage.calculating')}</Text>
      ) : controller.unavailable ? (
        <>
          <Text tone="secondary">{t('mobile.launch.unavailable')}</Text>
          <PButton
            actionId="notification-retry"
            fullWidth
            onActivate={() => void controller.reload()}
          >
            {t('common.action.retry')}
          </PButton>
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
                  onCheckedChange={(checked) => controller.patch(field, checked)}
                />
              </div>
            );
          })}
        </>
      )}
      </div>
    </section>
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

const DISCOVERABILITY_OPTIONS = [
  { value: 'hidden', labelKey: 'mobile.settings.privacy.discoverability.hidden' },
  { value: 'by_handle', labelKey: 'mobile.settings.privacy.discoverability.byHandle' },
  { value: 'indexed', labelKey: 'mobile.settings.privacy.discoverability.indexed' },
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
    <section className="settings-section">
      <div className="settings-section-body">
      <div className="settings-section-header">
        <Icon iconId="lock" size={16} />
        <Text strong>{t('mobile.settings.section.privacy')}</Text>
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.privacy.discoverability')}</Text>
        <Select<string>
          aria-label={t('mobile.settings.privacy.discoverability')}
          value={profile?.discoverability || undefined}
          disabled={controlsDisabled}
          data-privacy-setting="discoverability"
          onValueChange={(value) => onPatch({ discoverability: value as EditableProfileDraft['discoverability'] })}
          options={DISCOVERABILITY_OPTIONS.map(({ value, labelKey }) => ({
            value,
            label: t(labelKey),
          }))}
          style={{ minWidth: 144 }}
        />
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.privacy.defaultVisibility')}</Text>
        <Select<string>
          aria-label={t('mobile.settings.privacy.defaultVisibility')}
          value={profile?.defaultVisibility || undefined}
          disabled={controlsDisabled}
          data-privacy-setting="defaultVisibility"
          onValueChange={(value) => onPatch({ defaultVisibility: value as string })}
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
          onCheckedChange={(checked) => onPatch({ manuallyApprovesFollowers: checked })}
        />
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.privacy.messagePermission')}</Text>
        <Select<string>
          aria-label={t('mobile.settings.privacy.messagePermission')}
          value={profile?.messagePermission || undefined}
          disabled={controlsDisabled}
          data-privacy-setting="messagePermission"
          onValueChange={(value) => onPatch({ messagePermission: value as string })}
          options={MESSAGE_PERMISSION_OPTIONS.map(({ value, labelKey }) => ({
            value,
            label: t(labelKey),
          }))}
          style={{ minWidth: 144 }}
        />
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.privacy.autoExpire')}</Text>
        <NumberField
          aria-label={t('mobile.settings.privacy.autoExpire')}
          value={profile?.autoExpireDays ?? null}
          precision={0}
          disabled={controlsDisabled}
          data-privacy-setting="autoExpireDays"
          onValueChange={(value) => {
            if (typeof value === 'number') onPatch({ autoExpireDays: value });
          }}
          style={{ width: 112 }}
        />
      </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Device preferences section (local-only)
// ---------------------------------------------------------------------------

// Dark rendering is pinned off until mobile owns a complete dark color
// contract (see RENDERED_COLOR_SCHEME in deviceSettingsRuntime). The stored
// 'dark' preference is preserved, just not offered as a choice yet.
const THEME_OPTIONS: { value: Exclude<ThemeMode, 'dark'>; labelKey: string }[] = [
  { value: 'system', labelKey: 'mobile.settings.device.theme.system' },
  { value: 'light', labelKey: 'mobile.settings.device.theme.light' },
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
    <section className="settings-section">
      <div className="settings-section-body">
      <div className="settings-section-header">
        <Icon iconId="palette" size={16} />
        <Text strong>{t('mobile.settings.section.devicePrefs')}</Text>
      </div>
      {loading ? (
        <Text tone="secondary">{t('mobile.settings.storage.calculating')}</Text>
      ) : unavailable || !prefs ? (
        <>
          <Text tone="secondary">{t('mobile.settings.device.unavailable')}</Text>
          <PButton
            actionId="device-prefs-retry"
            fullWidth
            onActivate={() => void onRetry()}
          >
            {t('common.action.retry')}
          </PButton>
        </>
      ) : (
        <>
          <div className="settings-row">
            <Text>{t('mobile.settings.device.theme')}</Text>
            <Select<Exclude<ThemeMode, 'dark'>>
              density="compact"
              value={prefs.theme === 'dark' ? 'system' : prefs.theme}
              onValueChange={(value) => onPatch({ theme: value as Exclude<ThemeMode, 'dark'> })}
              options={THEME_OPTIONS.map(({ value, labelKey }) => ({
                value,
                label: t(labelKey),
              }))}
              style={{ width: 120 }}
            />
          </div>
          <div className="settings-row">
            <Text>{t('mobile.settings.device.fontSize')}</Text>
            <Select<FontSizePreset>
              density="compact"
              value={prefs.fontSize}
              onValueChange={(value) => onPatch({ fontSize: value as FontSizePreset })}
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
              checked={prefs.compactMode}
              onCheckedChange={(checked) => onPatch({ compactMode: checked })}
            />
          </div>
          <div className="settings-row">
            <Text>{t('mobile.settings.device.mediaAutoDownload')}</Text>
            <Text tone="secondary">{t('mobile.launch.unavailable')}</Text>
          </div>
        </>
      )}
      </div>
    </section>
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
    <section className="settings-section">
      <div className="settings-section-body">
      <div className="settings-section-header">
        <Icon iconId="globe" size={16} />
        <Text strong>{t('mobile.settings.section.language')}</Text>
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.section.language')}</Text>
        <Select<string>
          density="compact"
          value={language}
          disabled={languageStatus === 'saving'}
          onValueChange={(value) => void setLanguage(value as MobileLanguage)}
          options={languages.map((option) => ({
            value: option.code,
            label: option.nativeName,
          }))}
          style={{ width: 140 }}
        />
      </div>
      {languageStatus === 'failed' ? (
        <div className="settings-row" role="alert">
          <Text tone="danger">
            {t(languageError ?? 'mobile.settings.language.saveFailed')}
          </Text>
          <PButton
            actionId="language-retry"
            emphasis="secondary"
            density="compact"
            onActivate={() => void retryLanguage()}
          >
            {t('common.action.retry')}
          </PButton>
        </div>
      ) : null}
      </div>
    </section>
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
  const storageProductSurface = confirmingBatchClear
    ? 'settings.storage-confirm'
    : batchRunning
      ? 'settings.storage-progress'
      : batchResult?.status === 'partial_failure'
        ? 'settings.storage-partial-failure'
        : confirmingChatCacheClear
          ? 'settings.storage-clear-confirm'
          : projection.cleanup.status === 'failed'
            ? 'settings.storage-clear-failed'
            : projection.retention.status === 'succeeded'
              ? 'settings.storage-retention'
              : batchMode
                ? 'settings.storage-manage'
                : undefined;

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
    <section
      className="settings-section"
      data-chat-storage-surface
      data-product-surface={storageProductSurface}
    >
      <div className="settings-section-body">
      <div className="settings-section-header">
        <Icon iconId="hard-drive" size={16} />
        <Text strong>{t('mobile.settings.section.storage')}</Text>
        <PButton
          emphasis="quiet"
          density="compact"
          actionId="chat-storage-batch-manage"
          data-chat-storage-batch-manage
          className="settings-header-action"
          leading={<Icon iconId={batchMode ? 'close' : 'square-check'} size={14} />}
          availability={batchRunning || !snapshot || snapshot.conversations.length === 0
            ? { kind: 'disabled', reason: t('mobile.settings.storage.batchManage') }
            : undefined}
          onActivate={toggleBatchMode}
        >
          {batchMode
            ? t('mobile.settings.storage.batchDone')
            : t('mobile.settings.storage.batchManage')}
        </PButton>
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
              <Text tone="secondary">
                {t(`mobile.settings.storage.${String(key)}`)}
              </Text>
              <Text>{formatBytes(value as bigint)}</Text>
            </div>
          ))}
          <div className="settings-row">
            <Text tone="secondary">
              {new Date(Number(snapshot.measuredAtUnixMs)).toLocaleString()}
            </Text>
            {projection.stale || snapshot.issues.length > 0 ? (
              <Tag tone="warning">{t('mobile.settings.storage.stale')}</Tag>
            ) : null}
            <IconButton
              actionId="chat-storage-refresh"
              iconId="rotate-ccw"
              iconSize={14}
              label={t('mobile.settings.storage.retry')}
              data-chat-storage-refresh
              execution={projection.status === 'measuring' ? 'pending' : 'idle'}
              onActivate={() => void mobileChatStorageProjectionRuntime.refresh()}
            />
          </div>
          <TextField
            clearable
            aria-label={t('mobile.settings.storage.search')}
            data-chat-storage-search
            placeholder={t('mobile.settings.storage.search')}
            value={query}
            onValueChange={setQuery}
          />
          {batchMode ? (
            <div className="settings-dirty-actions" data-chat-storage-batch-actions>
              <div className="settings-row">
                <Checkbox
                  checked={allVisibleSelected}
                  disabled={batchRunning || conversations.length === 0}
                  indeterminate={!allVisibleSelected && someVisibleSelected}
                  data-chat-storage-batch-select-all
                  onCheckedChange={(checked) => toggleVisibleConversations(checked)}
                >
                  {t('mobile.settings.storage.batchSelectAll')}
                </Checkbox>
                <Text tone="secondary" data-chat-storage-batch-selection>
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
                    <PButton
                      fullWidth
                      emphasis="secondary"
                      actionId="chat-storage-batch-cancel"
                      availability={batchRunning
                        ? { kind: 'disabled', reason: t('mobile.settings.storage.batchCancel') }
                        : undefined}
                      onActivate={() => setBatchConfirmationRevision(null)}
                    >
                      {t('mobile.settings.storage.batchCancel')}
                    </PButton>
                    <PButton
                      fullWidth
                      tone="danger"
                      emphasis="primary"
                      actionId="chat-storage-batch-confirm-apply"
                      data-chat-storage-batch-confirm-apply
                      leading={<Icon iconId="delete" size={14} />}
                      execution={batchRunning ? 'pending' : 'idle'}
                      onActivate={() => void clearSelectedConversations()}
                    >
                      {t('mobile.settings.storage.batchConfirmAction')}
                    </PButton>
                  </div>
                </>
              ) : (
                <PButton
                  fullWidth
                  tone="danger"
                  actionId="chat-storage-batch-clear"
                  data-chat-storage-batch-clear
                  leading={<Icon iconId="delete" size={14} />}
                  availability={batchRunning || selectedConversations.length === 0
                    ? { kind: 'disabled', reason: t('mobile.settings.storage.batchClearSelected') }
                    : undefined}
                  onActivate={() => setBatchConfirmationRevision(snapshot.revision)}
                >
                  {t('mobile.settings.storage.batchClearSelected')}
                </PButton>
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
              <PButton
                fullWidth
                emphasis="secondary"
                actionId="chat-storage-batch-retry"
                data-chat-storage-batch-retry
                availability={batchRunning
                  ? { kind: 'disabled', reason: t('mobile.settings.storage.batchRetry') }
                  : undefined}
                onActivate={() => setBatchConfirmationRevision(snapshot.revision)}
              >
                {t('mobile.settings.storage.batchRetry')}
              </PButton>
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
                    onCheckedChange={(checked) => {
                      toggleConversation(usage.conversationId, checked);
                    }}
                  />
                ) : null}
                <div className="settings-storage-conversation-label">
                  <Text strong truncate>
                    {usage.conversationName || usage.conversationId}
                  </Text>
                  <Text tone="secondary">
                    {usage.conversationKind === 2
                      ? t('mobile.settings.storage.group')
                      : t('mobile.settings.storage.direct')}
                  </Text>
                </div>
                <Text>{formatBytes(usage.messageBytes + usage.mediaBytes)}</Text>
              </div>
            ))}
            {conversations.length === 0 ? (
              <Text tone="secondary">{t('mobile.settings.storage.empty')}</Text>
            ) : null}
          </div>
        </>
      ) : (
        <div className="settings-row" role={projection.status === 'unavailable' ? 'alert' : 'status'}>
          <Text tone="secondary">
            {projection.status === 'unavailable'
              ? t('mobile.settings.storage.unavailable')
              : t('mobile.settings.storage.calculating')}
          </Text>
          <IconButton
            actionId="chat-storage-refresh-unavailable"
            iconId="rotate-ccw"
            iconSize={14}
            label={t('mobile.settings.storage.retry')}
            data-chat-storage-refresh
            execution={projection.status === 'measuring' ? 'pending' : 'idle'}
            onActivate={() => void mobileChatStorageProjectionRuntime.refresh()}
          />
        </div>
      )}
      <div className="settings-dirty-actions" data-chat-storage-retention>
        <div className="settings-row">
          <div className="setting-copy">
            <Text strong>{t('mobile.settings.storage.retentionTitle')}</Text>
            <Text tone="secondary">
              {t('mobile.settings.storage.retentionDescription')}
            </Text>
          </div>
          <Select<ChatRetentionPreset>
            aria-label={t('mobile.settings.storage.retentionTitle')}
            data-chat-storage-retention-select
            disabled={!snapshot || retentionSaving || chatCleanupRunning}
            pending={retentionSaving}
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
            onValueChange={(value) => {
              void mobileChatStorageProjectionRuntime.setRetention(value as ChatRetentionPreset);
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
            <Text tone="secondary">
              {t('mobile.settings.storage.clearChatCacheDescription')}
            </Text>
          </div>
          {!confirmingChatCacheClear ? (
            <PButton
              actionId="chat-storage-clear-cache"
              data-chat-storage-clear-cache
              leading={<Icon iconId="delete" size={14} />}
              availability={chatCleanupRunning || !snapshot
                ? { kind: 'disabled', reason: t('mobile.settings.storage.clearChatCacheAction') }
                : undefined}
              onActivate={() => setChatCacheConfirmationRevision(snapshot?.revision ?? null)}
            >
              {t('mobile.settings.storage.clearChatCacheAction')}
            </PButton>
          ) : null}
        </div>
        {confirmingChatCacheClear ? (
          <>
            <MobileNotice tone="info">
              {t('mobile.settings.storage.clearChatCacheConfirm')}
            </MobileNotice>
            <div className="settings-station-actions" data-chat-storage-clear-confirm>
              <PButton
                fullWidth
                emphasis="secondary"
                actionId="chat-storage-clear-cancel"
                availability={chatCleanupRunning
                  ? { kind: 'disabled', reason: t('mobile.settings.storage.clearChatCacheCancel') }
                  : undefined}
                onActivate={() => setChatCacheConfirmationRevision(null)}
              >
                {t('mobile.settings.storage.clearChatCacheCancel')}
              </PButton>
              <PButton
                fullWidth
                tone="danger"
                emphasis="primary"
                actionId="chat-storage-clear-confirm-apply"
                data-chat-storage-clear-confirm-apply
                leading={<Icon iconId="delete" size={14} />}
                execution={chatCleanupRunning ? 'pending' : 'idle'}
                onActivate={() => {
                  void mobileChatStorageProjectionRuntime.clearCache().then(() => {
                    setChatCacheConfirmationRevision(null);
                  });
                }}
              >
                {t('mobile.settings.storage.clearChatCacheConfirmAction')}
              </PButton>
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
      <PButton
        fullWidth
        actionId="mobile-device-cache-clear"
        data-mobile-device-cache-clear
        execution={status === 'clearing' ? 'pending' : 'idle'}
        availability={status === 'clearing'
          ? { kind: 'disabled', reason: t('mobile.settings.storage.clearDeviceCache') }
          : undefined}
        onActivate={() => void onClearCache()}
      >
        {t('mobile.settings.storage.clearDeviceCache')}
      </PButton>
      {status === 'cleared' ? (
        <Text tone="success">{t('mobile.settings.storage.deviceCacheCleared')}</Text>
      ) : null}
      {status === 'error' ? (
        <Text tone="danger">{t('mobile.settings.storage.deviceCacheClearFailed')}</Text>
      ) : null}
      </div>
    </section>
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
  const productSurface = loading
    ? 'settings.permission-loading'
    : permissions.some((permission) => permission.status === 'denied')
      ? 'settings.permission-denied'
      : undefined;
  return (
    <section
      className="settings-section"
      data-product-surface={productSurface}
    >
      <div className="settings-section-body">
      <div className="settings-section-header">
        <Icon iconId="shield" size={16} />
        <Text strong>{t('mobile.settings.section.permissions')}</Text>
      </div>
      {loading ? (
        <Text tone="secondary">{t('mobile.settings.storage.calculating')}</Text>
      ) : unavailable ? (
        <>
          <Text tone="secondary">{t('mobile.launch.unavailable')}</Text>
          <PButton
            fullWidth
            actionId="permissions-retry"
            onActivate={() => void onRefresh()}
          >
            {t('common.action.retry')}
          </PButton>
        </>
      ) : (
        <>
          {permissions.length === 0 ? (
            <Text tone="secondary">{t('mobile.launch.unavailable')}</Text>
          ) : permissions.map((permission) => (
            <div className="settings-row" key={permission.kind}>
              <Text>{t(PERMISSION_LABEL_KEYS[permission.kind])}</Text>
              <Tag
                tone={PERMISSION_STATUS_TONES[permission.status]}
                data-permission-status={permission.status}
              >
                {t(PERMISSION_STATUS_KEYS[permission.status])}
              </Tag>
              {permission.canRequest && permission.status !== 'granted' ? (
                <PButton
                  actionId={`permission-enable-${permission.kind}`}
                  emphasis="secondary"
                  density="compact"
                  onActivate={() => void onRequest(permission.kind)}
                >
                  {t('common.action.enable')}
                </PButton>
              ) : null}
            </div>
          ))}
        </>
      )}
      </div>
    </section>
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
    <section className="settings-section">
      <div className="settings-section-body">
      <div className="settings-section-header">
        <Icon iconId="ban" size={16} />
        <Text strong>{t('mobile.settings.section.blocked')}</Text>
      </div>
      {status === 'loading' ? (
        <Text tone="secondary">{t('mobile.settings.storage.calculating')}</Text>
      ) : status === 'unavailable' ? (
        <>
          <Text tone="secondary" role="alert">
            {t('mobile.launch.unavailable')}
          </Text>
          <PButton
            fullWidth
            actionId="blocked-users-retry"
            onActivate={() => void onRetry()}
          >
            {t('common.action.retry')}
          </PButton>
        </>
      ) : users.length === 0 ? (
        <PEmpty description={t('mobile.settings.noBlockedUsers')} />
      ) : (
        users.map((item) => (
          <div
            className="settings-row"
            data-blocked-user={item.targetPtid}
            key={item.targetPtid}
          >
            <MobileAvatar
              src={item.avatar}
              identityKey={item.targetPtid}
              name={item.displayName || t('mobile.contacts.unknownUser')}
            >
              {(item.displayName || t('mobile.contacts.unknownUser')).slice(0, 1).toUpperCase()}
            </MobileAvatar>
            <div className="settings-station-copy settings-blocked-user-copy">
              <Text>{item.displayName || t('mobile.contacts.unknownUser')}</Text>
              <Text className="settings-blocked-user-ptid" copyValue={item.targetPtid}>{item.targetPtid}</Text>
              {item.homeStationPeerId ? (
                <Text tone="secondary">{item.homeStationPeerId}</Text>
              ) : null}
            </div>
            <PButton
              actionId={`blocked-user-unblock-${item.targetPtid}`}
              className="settings-blocked-user-action"
              emphasis="secondary"
              density="compact"
              leading={<Icon iconId="rotate-ccw" size={13} />}
              execution={unblockingPtid === item.targetPtid ? 'pending' : 'idle'}
              availability={unblockingPtid !== null
                ? { kind: 'disabled', reason: t('mobile.contacts.unblock') }
                : undefined}
              onActivate={() => void onUnblock(item.targetPtid)}
            >
              {t('mobile.contacts.unblock')}
            </PButton>
          </div>
        ))
      )}
      {errorKey ? (
        <Text tone="danger" role="alert">{t(errorKey)}</Text>
      ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Station section
// ---------------------------------------------------------------------------

export function StationSection({
  stationLabel,
  stationUrl,
  identityVerified,
  routes = [],
  activeRouteId = '',
  onChangeRoute = async () => {},
  onChangeStation,
  onLogout,
  loggingOut,
}: {
  stationLabel: string;
  stationUrl: string;
  identityVerified: boolean;
  routes?: MobileStationRouteCandidate[];
  activeRouteId?: string;
  onChangeRoute?: (route: MobileStationRouteCandidate) => Promise<void>;
  onChangeStation: () => Promise<void>;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const { t } = useMobileI18n();
  return (
    <section className="settings-section">
      <div className="settings-section-body">
      <div className="settings-section-header">
        <Icon iconId="server" size={16} />
        <Text strong>{t('mobile.settings.section.station')}</Text>
      </div>
      <div className="settings-station-header">
        <div className="settings-station-copy">
          <Text strong>{stationLabel}</Text>
          <Text tone="secondary" truncate>{stationUrl}</Text>
        </div>
        <Tag
          tone={identityVerified ? 'success' : undefined}
          data-station-trust={identityVerified ? 'verified' : 'unverified'}
        >
          {identityVerified
            ? t('mobile.launch.verified')
            : t('mobile.launch.unverified')}
        </Tag>
      </div>
      <div className="settings-station-routes" role="group" aria-label={t('mobile.launch.route')}>
        {routes.map((route) => (
          <PButton
            key={route.routeId}
            actionId={`station-route-${route.routeId}`}
            emphasis={route.routeId === activeRouteId ? 'primary' : 'secondary'}
            density="compact"
            aria-pressed={route.routeId === activeRouteId}
            data-station-route-id={route.routeId}
            data-station-route-type={route.routeType}
            onActivate={() => void onChangeRoute(route)}
          >
            {route.routeType === 'relay'
              ? t('mobile.launch.viaRelay')
              : t('mobile.launch.direct')}
          </PButton>
        ))}
      </div>
      <div className="settings-station-actions">
        <PButton
          fullWidth
          actionId="station-change"
          emphasis="secondary"
          onActivate={() => void onChangeStation()}
        >
          {t('mobile.settings.station.changeStation')}
        </PButton>
        <PButton
          fullWidth
          actionId="station-logout"
          tone="danger"
          execution={loggingOut ? 'pending' : 'idle'}
          onActivate={onLogout}
        >
          {loggingOut ? t('mobile.settings.station.loggingOut') : t('mobile.settings.logout')}
        </PButton>
      </div>
      </div>
    </section>
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
  const productSurface = conflict
    ? 'settings.detail-conflict'
    : saveStatus === 'saving'
      ? 'settings.detail-saving'
      : saveStatus === 'saved'
        ? 'settings.detail-saved'
        : saveStatus === 'error'
          ? 'settings.detail-failed'
          : dirty
            ? 'settings.detail-dirty'
            : undefined;

  return (
    <div
      className="settings-dirty-bar"
      data-product-surface={productSurface}
    >
      {conflict && (
        <div className="settings-dirty-conflict">
          <Text tone="warning">{t('mobile.settings.dirty.conflict')}</Text>
          <PButton
            actionId="settings-dirty-reload"
            emphasis="secondary"
            density="compact"
            onActivate={onReload}
          >{t('mobile.settings.dirty.reload')}</PButton>
        </div>
      )}
      {saveStatus === 'saved' && !dirty && (
        <Text tone="success">{t('mobile.settings.dirty.saved')}</Text>
      )}
      {saveError && saveStatus === 'error' && !conflict && (
        <Text tone="danger">{t(saveError)}</Text>
      )}
      {dirty && !conflict && (
        <div className="settings-dirty-actions">
          <Text tone="secondary">{t('mobile.settings.dirty.unsavedChanges')}</Text>
          <div className="settings-dirty-buttons">
            <PButton
              actionId="settings-dirty-discard"
              emphasis="secondary"
              density="compact"
              onActivate={onDiscard}
            >
              {t('mobile.settings.dirty.discardChanges')}
            </PButton>
            <PButton
              actionId="settings-dirty-save"
              emphasis="primary"
              density="compact"
              execution={saveStatus === 'saving' ? 'pending' : 'idle'}
              onActivate={onSave}
            >
              {saveStatus === 'saving' ? t('mobile.settings.dirty.saving') : t('mobile.settings.dirty.saveChanges')}
            </PButton>
          </div>
        </div>
      )}
    </div>
  );
}
