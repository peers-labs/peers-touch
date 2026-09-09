/**
 * SettingsSections.tsx — Pure renderer components for each settings section.
 *
 * Each section receives only the data it needs and callback props.
 * Sections never fetch or write directly — the controller hook owns
 * all side effects.
 */

import { Button, Card, Collapse, Empty, List, Modal, Select, Switch, Tag, Typography } from 'antd';
import {
  Ban,
  Bell,
  ChevronRight,
  Globe,
  HardDrive,
  Lock,
  Monitor,
  Palette,
  RotateCcw,
  Server,
  Shield,
  User,
} from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import type { AccountPreference } from '../../services/gateways/profileGateway';
import type { DevicePreferences, FontSizePreset, ThemeMode } from './devicePreferences';

const { Text } = Typography;

// ---------------------------------------------------------------------------
// Profile section
// ---------------------------------------------------------------------------

export function ProfileSection({
  displayName,
  onEditProfile,
}: {
  displayName: string | undefined;
  onEditProfile: () => void;
}) {
  const { t } = useMobileI18n();
  return (
    <Card className="settings-section" bordered={false}>
      <div className="settings-section-header">
        <User size={16} />
        <Text strong>{t('mobile.settings.section.profile')}</Text>
      </div>
      <div className="settings-row">
        <Text type="secondary">{t('mobile.settings.profile.displayName')}</Text>
        <Text>{displayName || '—'}</Text>
      </div>
      <Button block onClick={onEditProfile}>
        {t('mobile.settings.profile.editProfile')}
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Notifications section (account preferences)
// ---------------------------------------------------------------------------

export function NotificationsSection({
  prefs,
  onPatch,
  disabled,
}: {
  prefs: AccountPreference | null;
  onPatch: (patch: Partial<AccountPreference>) => void;
  disabled: boolean;
}) {
  const { t } = useMobileI18n();
  return (
    <Card className="settings-section" bordered={false}>
      <div className="settings-section-header">
        <Bell size={16} />
        <Text strong>{t('mobile.settings.section.notifications')}</Text>
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.notifications.enabled')}</Text>
        <Switch
          size="small"
          checked={prefs?.notificationEnabled ?? true}
          disabled={disabled || !prefs}
          onChange={(checked) => onPatch({ notificationEnabled: checked })}
        />
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.notifications.push')}</Text>
        <Switch
          size="small"
          checked={prefs?.pushEnabled ?? true}
          disabled={disabled || !prefs}
          onChange={(checked) => onPatch({ pushEnabled: checked })}
        />
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.notifications.sound')}</Text>
        <Switch
          size="small"
          checked={prefs?.soundEnabled ?? true}
          disabled={disabled || !prefs}
          onChange={(checked) => onPatch({ soundEnabled: checked })}
        />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Privacy section (account preferences)
// ---------------------------------------------------------------------------

const VISIBILITY_OPTIONS = [
  { value: 'public', labelKey: 'mobile.settings.privacy.visibility.public' },
  { value: 'followers', labelKey: 'mobile.settings.privacy.visibility.followers' },
  { value: 'private', labelKey: 'mobile.settings.privacy.visibility.private' },
] as const;

const MESSAGE_PERMISSION_OPTIONS = [
  { value: 'everyone', labelKey: 'mobile.settings.privacy.message.everyone' },
  { value: 'friends', labelKey: 'mobile.settings.privacy.message.friends' },
  { value: 'none', labelKey: 'mobile.settings.privacy.message.none' },
] as const;

export function PrivacySection({
  prefs,
  onPatch,
  disabled,
}: {
  prefs: AccountPreference | null;
  onPatch: (patch: Partial<AccountPreference>) => void;
  disabled: boolean;
}) {
  const { t } = useMobileI18n();
  return (
    <Card className="settings-section" bordered={false}>
      <div className="settings-section-header">
        <Lock size={16} />
        <Text strong>{t('mobile.settings.section.privacy')}</Text>
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.privacy.defaultVisibility')}</Text>
        <Select
          size="small"
          value={prefs?.defaultPostVisibility ?? 'public'}
          disabled={disabled || !prefs}
          onChange={(value) => onPatch({ defaultPostVisibility: value })}
          options={VISIBILITY_OPTIONS.map(({ value, labelKey }) => ({
            value,
            label: t(labelKey),
          }))}
          style={{ width: 140 }}
        />
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.privacy.messagePermission')}</Text>
        <Select
          size="small"
          value={prefs?.messagePermission ?? 'everyone'}
          disabled={disabled || !prefs}
          onChange={(value) => onPatch({ messagePermission: value })}
          options={MESSAGE_PERMISSION_OPTIONS.map(({ value, labelKey }) => ({
            value,
            label: t(labelKey),
          }))}
          style={{ width: 140 }}
        />
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.privacy.autoExpire')}</Text>
        <Select
          size="small"
          value={prefs?.autoExpireDays ?? 0}
          disabled={disabled || !prefs}
          onChange={(value) => onPatch({ autoExpireDays: value })}
          options={[
            { value: 0, label: '—' },
            { value: 7, label: '7' },
            { value: 30, label: '30' },
            { value: 90, label: '90' },
            { value: 365, label: '365' },
          ]}
          style={{ width: 80 }}
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
  onPatch,
}: {
  prefs: DevicePreferences;
  onPatch: (patch: Partial<DevicePreferences>) => void;
}) {
  const { t } = useMobileI18n();
  return (
    <Card className="settings-section" bordered={false}>
      <div className="settings-section-header">
        <Palette size={16} />
        <Text strong>{t('mobile.settings.section.devicePrefs')}</Text>
      </div>
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
        <Switch
          size="small"
          checked={prefs.mediaAutoDownload}
          onChange={(checked) => onPatch({ mediaAutoDownload: checked })}
        />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Language section
// ---------------------------------------------------------------------------

export function LanguageSection() {
  const { t, language, languages, setLanguage } = useMobileI18n();
  return (
    <Card className="settings-section" bordered={false}>
      <div className="settings-section-header">
        <Globe size={16} />
        <Text strong>{t('mobile.settings.section.language')}</Text>
      </div>
      <div className="settings-row">
        <Text>{t('mobile.settings.section.language')}</Text>
        <Select
          size="small"
          value={language}
          onChange={(value) => setLanguage(value)}
          options={languages.map((option) => ({
            value: option.code,
            label: option.nativeName,
          }))}
          style={{ width: 140 }}
        />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Storage section
// ---------------------------------------------------------------------------

export function StorageSection({
  onClearCache,
}: {
  onClearCache: () => void;
}) {
  const { t } = useMobileI18n();
  return (
    <Card className="settings-section" bordered={false}>
      <div className="settings-section-header">
        <HardDrive size={16} />
        <Text strong>{t('mobile.settings.section.storage')}</Text>
      </div>
      <Button block onClick={onClearCache}>
        {t('mobile.settings.storage.clearCache')}
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Permissions section
// ---------------------------------------------------------------------------

export function PermissionsSection() {
  const { t } = useMobileI18n();
  return (
    <Card className="settings-section" bordered={false}>
      <div className="settings-section-header">
        <Shield size={16} />
        <Text strong>{t('mobile.settings.section.permissions')}</Text>
      </div>
      <Text type="secondary">{t('mobile.settings.permissions.hint')}</Text>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Blocked users section
// ---------------------------------------------------------------------------

export function BlockedUsersSection({
  blockedUsers,
  onUnblock,
}: {
  blockedUsers: { targetPtid: string }[];
  onUnblock: (ptid: string) => void;
}) {
  const { t } = useMobileI18n();
  return (
    <Card className="settings-section" bordered={false}>
      <div className="settings-section-header">
        <Ban size={16} />
        <Text strong>{t('mobile.settings.section.blocked')}</Text>
      </div>
      {blockedUsers.length > 0 ? (
        <List
          size="small"
          dataSource={blockedUsers}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button
                  key="unblock"
                  size="small"
                  icon={<RotateCcw size={13} />}
                  onClick={() => onUnblock(item.targetPtid)}
                >
                  {t('mobile.contacts.unblock')}
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={<Text copyable>{item.targetPtid}</Text>}
                description={<Tag color="error">{t('mobile.contacts.blocked')}</Tag>}
              />
            </List.Item>
          )}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.settings.noBlockedUsers')} />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Station section
// ---------------------------------------------------------------------------

export function StationSection({
  stationLabel,
  stationUrl,
  online,
  onChangeStation,
  onLogout,
  loggingOut,
}: {
  stationLabel: string;
  stationUrl: string;
  online: boolean;
  onChangeStation: () => void;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const { t } = useMobileI18n();
  return (
    <Card className="settings-section" bordered={false}>
      <div className="settings-section-header">
        <Server size={16} />
        <Text strong>{t('mobile.settings.section.station')}</Text>
      </div>
      <div className="settings-station-header">
        <div className="settings-station-copy">
          <Text strong>{stationLabel}</Text>
          <Text type="secondary" ellipsis>{stationUrl}</Text>
        </div>
        <Tag color={online ? 'green' : 'default'}>
          {online ? t('mobile.launch.verified') : t('mobile.launch.unverified')}
        </Tag>
      </div>
      <div className="settings-station-actions">
        <Button block onClick={onChangeStation}>
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
