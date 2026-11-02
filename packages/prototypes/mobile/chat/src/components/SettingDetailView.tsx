import { useState } from 'react';
import {
  Button,
  Empty,
  Icon,
  Select,
  Switch,
  Tag,
  Text,
  TextArea,
  TextField,
} from '@peers-touch/ui';
import type { IconName, SettingEntry } from '../types';
import { demoAvatarUrls } from '../data';
import copy from '../../../../../locales/en/common.json';
import { IdentityAvatar } from './IdentityAvatar';

export function SettingDetailView({
  setting,
  onBack,
  onChangeStation,
}: {
  setting: SettingEntry;
  onBack: () => void;
  onChangeStation: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [displayName, setDisplayName] = useState('Alice Chen');
  const [bio, setBio] = useState('Design systems and launch readiness.');
  const [notifications, setNotifications] = useState({
    enabled: true,
    push: true,
    sound: false,
  });
  const [defaultVisibility, setDefaultVisibility] = useState('followers');
  const [manuallyApprovesFollowers, setManuallyApprovesFollowers] = useState(true);
  const [messagePermission, setMessagePermission] = useState('friends');
  const [autoExpireDays, setAutoExpireDays] = useState(30);
  const [theme, setTheme] = useState('system');
  const [fontSize, setFontSize] = useState('medium');
  const [compactMode, setCompactMode] = useState(false);
  const [language, setLanguage] = useState('en');
  const [cacheConfirmOpen, setCacheConfirmOpen] = useState(false);
  const [stationConfirmOpen, setStationConfirmOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState([
    { handle: '@morgan@design.peers', name: 'Morgan Lee', initials: 'ML' },
    { handle: '@jordan@design.peers', name: 'Jordan Kim', initials: 'JK' },
  ]);

  function markDirty() {
    setDirty(true);
    setSaved(false);
  }

  function renderContent() {
    switch (setting.id) {
      case 'account-info':
        return (
          <SettingCard iconId="circle-user" title={copy['mobile.settings.section.profile']}>
            <div className="mp-setting-profile-summary">
              <IdentityAvatar
                name="Alice Chen"
                initials="AC"
                src={demoAvatarUrls.alice}
                size={56}
              />
              <span>
                <Text strong>Alice Chen</Text>
                <Text tone="secondary">@alice@product.peers</Text>
              </span>
            </div>
            <label className="mp-setting-field">
              <Text tone="secondary">{copy['mobile.settings.profile.displayName']}</Text>
              <TextField
                value={displayName}
                onValueChange={(value) => { setDisplayName(value); markDirty(); }}
              />
            </label>
            <label className="mp-setting-field">
              <Text tone="secondary">{copy['mobile.settings.profile.bio']}</Text>
              <TextArea
                value={bio}
                minimumRows={2}
                maximumRows={4}
                onValueChange={(value) => { setBio(value); markDirty(); }}
              />
            </label>
          </SettingCard>
        );

      case 'notifications':
        return (
          <SettingCard iconId="bell" title={copy['mobile.settings.section.notifications']}>
            {([
              ['enabled', copy['mobile.settings.notifications.enabled']],
              ['push', copy['mobile.settings.notifications.push']],
              ['sound', copy['mobile.settings.notifications.sound']],
            ] as const).map(([field, label]) => (
              <div className="mp-setting-detail-row" key={field}>
                <span className="mp-setting-detail-label">{label}</span>
                <Switch
                  checked={notifications[field]}
                  aria-label={label}
                  onCheckedChange={(checked) => {
                    setNotifications((current) => ({ ...current, [field]: checked }));
                    markDirty();
                  }}
                />
              </div>
            ))}
            <div className="mp-setting-owner-note">
              <Icon iconId="shield-check" size={15} />
              <span>Category preferences are saved by this Station. Device permission is currently allowed.</span>
            </div>
          </SettingCard>
        );

      case 'privacy-security':
        return (
          <>
            <SettingCard iconId="shield-check" title={copy['mobile.settings.section.privacy']}>
              <div className="mp-setting-detail-row">
                <span className="mp-setting-detail-label">
                  {copy['mobile.settings.privacy.defaultVisibility']}
                </span>
                <Select
                  value={defaultVisibility}
                  density="compact"
                  onValueChange={(value) => { setDefaultVisibility(String(value)); markDirty(); }}
                  options={[
                    { value: 'public', label: copy['mobile.settings.privacy.visibility.public'] },
                    { value: 'followers', label: copy['mobile.settings.privacy.visibility.followers'] },
                    { value: 'private', label: copy['mobile.settings.privacy.visibility.private'] },
                  ]}
                />
              </div>
              <div className="mp-setting-detail-row">
                <span className="mp-setting-detail-label">
                  {copy['mobile.settings.privacy.manuallyApprovesFollowers']}
                </span>
                <Switch
                  checked={manuallyApprovesFollowers}
                  aria-label={copy['mobile.settings.privacy.manuallyApprovesFollowers']}
                  onCheckedChange={(checked) => { setManuallyApprovesFollowers(checked); markDirty(); }}
                />
              </div>
              <div className="mp-setting-detail-row">
                <span className="mp-setting-detail-label">
                  {copy['mobile.settings.privacy.messagePermission']}
                </span>
                <Select
                  value={messagePermission}
                  density="compact"
                  onValueChange={(value) => { setMessagePermission(String(value)); markDirty(); }}
                  options={[
                    { value: 'everyone', label: copy['mobile.settings.privacy.message.everyone'] },
                    { value: 'friends', label: copy['mobile.settings.privacy.message.friends'] },
                    { value: 'none', label: copy['mobile.settings.privacy.message.none'] },
                  ]}
                />
              </div>
              <div className="mp-setting-detail-row">
                <span className="mp-setting-detail-label">
                  {copy['mobile.settings.privacy.autoExpire']}
                </span>
                <TextField
                  type="number"
                  value={String(autoExpireDays)}
                  aria-label="Auto-expire days"
                  style={{ width: 96 }}
                  onValueChange={(value) => {
                    const parsed = Number(value);
                    if (!Number.isNaN(parsed)) {
                      setAutoExpireDays(parsed);
                      markDirty();
                    }
                  }}
                />
              </div>
            </SettingCard>
            <SettingCard iconId="shield-check" title={copy['mobile.settings.section.permissions']}>
              {[
                copy['mobile.settings.permissions.camera'],
                copy['mobile.settings.permissions.microphone'],
                copy['mobile.settings.section.notifications'],
              ].map((label) => (
                <div className="mp-setting-detail-row" key={label}>
                  <span className="mp-setting-detail-label">{label}</span>
                  <Tag tone="success">{copy['mobile.settings.permissions.status.granted']}</Tag>
                </div>
              ))}
            </SettingCard>
          </>
        );

      case 'blocked-users':
        return (
          <SettingCard iconId="ban" title={copy['mobile.settings.section.blocked']}>
            {blockedUsers.length === 0 ? (
              <Empty description={copy['mobile.settings.noBlockedUsers']} />
            ) : blockedUsers.map((user) => (
              <div className="mp-setting-detail-row mp-blocked-user-row" key={user.handle}>
                <IdentityAvatar name={user.name} initials={user.initials} size={40} />
                <div className="mp-blocked-user-copy">
                  <div className="mp-setting-detail-label">{user.name}</div>
                  <div className="mp-setting-detail-value">{user.handle}</div>
                </div>
                <Button className="mp-blocked-user-action" density="compact" actionId={`blocked.unblock.${user.handle}`}
                  onActivate={() => setBlockedUsers((current) => (
                    current.filter((item) => item.handle !== user.handle)
                  ))}>
                  {copy['mobile.contacts.unblock']}
                </Button>
              </div>
            ))}
          </SettingCard>
        );

      case 'chat-settings':
        return (
          <>
            <SettingCard iconId="sliders-horizontal" title={copy['mobile.settings.section.devicePrefs']}>
              <div className="mp-setting-detail-row">
                <span className="mp-setting-detail-label">{copy['mobile.settings.device.theme']}</span>
                <Select
                  value={theme}
                  density="compact"
                  onValueChange={(value) => { setTheme(String(value)); markDirty(); }}
                  options={[
                    { value: 'system', label: copy['mobile.settings.device.theme.system'] },
                    { value: 'light', label: copy['mobile.settings.device.theme.light'] },
                    { value: 'dark', label: copy['mobile.settings.device.theme.dark'] },
                  ]}
                />
              </div>
              <div className="mp-setting-detail-row">
                <span className="mp-setting-detail-label">{copy['mobile.settings.device.fontSize']}</span>
                <Select
                  value={fontSize}
                  density="compact"
                  onValueChange={(value) => { setFontSize(String(value)); markDirty(); }}
                  options={[
                    { value: 'small', label: copy['mobile.settings.device.fontSize.small'] },
                    { value: 'medium', label: copy['mobile.settings.device.fontSize.medium'] },
                    { value: 'large', label: copy['mobile.settings.device.fontSize.large'] },
                  ]}
                />
              </div>
              <div className="mp-setting-detail-row">
                <span className="mp-setting-detail-label">{copy['mobile.settings.device.compactMode']}</span>
                <Switch checked={compactMode} aria-label={copy['mobile.settings.device.compactMode']}
                  onCheckedChange={(checked) => { setCompactMode(checked); markDirty(); }} />
              </div>
            </SettingCard>
            <SettingCard iconId="hard-drive" title={copy['mobile.settings.section.storage']}>
              <div className="mp-setting-detail-row">
                <span>
                  <span className="mp-setting-detail-label">{copy['mobile.settings.storage.total']}</span>
                  <span className="mp-setting-detail-value">128 MB on this device</span>
                </span>
                <Button actionId="storage.batch-manage" density="compact">
                  {copy['mobile.settings.storage.batchManage']}
                </Button>
              </div>
              <div className="mp-setting-detail-row">
                <span className="mp-setting-detail-label">{copy['mobile.settings.storage.retentionTitle']}</span>
                <Select
                  value="forever"
                  density="compact"
                  options={[
                    { value: 'forever', label: copy['mobile.settings.storage.retentionForever'] },
                    { value: '90', label: copy['mobile.settings.storage.retention90Days'] },
                  ]}
                />
              </div>
              <Button actionId="storage.clear-cache"
                leading={<Icon iconId="delete" size={15} />}
                onActivate={() => setCacheConfirmOpen(true)}>
                {copy['mobile.settings.storage.clearChatCacheAction']}
              </Button>
            </SettingCard>
          </>
        );

      case 'station-connection':
        return (
          <SettingCard iconId="server" title={copy['mobile.settings.section.station']}>
            <div className="mp-station-summary">
              <span>
                <Text strong>Product Station</Text>
                <Text tone="secondary">{copy['mobile.settings.connected']}</Text>
              </span>
              <Tag tone="success">{copy['mobile.launch.verified']}</Tag>
            </div>
            <Button actionId="station.change" onActivate={() => setStationConfirmOpen(true)}>
              {copy['mobile.settings.station.changeStation']}
            </Button>
            <Button actionId="station.logout" tone="danger"
              onActivate={() => setLogoutConfirmOpen(true)}>
              {copy['mobile.settings.logout']}
            </Button>
          </SettingCard>
        );

      case 'language':
        return (
          <SettingCard iconId="languages" title={copy['mobile.settings.section.language']}>
            <Select
              value={language}
              onValueChange={(value) => { setLanguage(String(value)); markDirty(); }}
              options={[
                { value: 'en', label: 'English' },
                { value: 'zh-CN', label: '简体中文' },
              ]}
            />
          </SettingCard>
        );

      case 'about':
        return (
          <SettingCard iconId="info" title={copy['mobile.settings.aboutApp']}>
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">{copy['mobile.settings.aboutApp']}</span>
              <span className="mp-setting-detail-value">1.0.0</span>
            </div>
          </SettingCard>
        );

      case 'encryption':
        return (
          <SettingCard iconId="lock-keyhole" title="Encryption">
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">Message encryption</span>
              <Tag tone="success">End-to-end encrypted</Tag>
            </div>
            <Text tone="secondary" className="mp-setting-owner-note">
              <Icon iconId="shield-check" size={15} />
              <span>Messages are encrypted on this Station and its trusted devices.</span>
            </Text>
          </SettingCard>
        );

      case 'safety-number':
      case 'chat-background':
        return null;
    }
  }

  return (
    <div className="mp-detail-page">
      <header className="mp-detail-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label="Back">
          <Icon iconId="arrow-left" size={22} />
        </button>
        <h2 className="mp-detail-header-title">{setting.label}</h2>
      </header>
      <div className="mp-setting-detail-content">
        {saved ? (
          <div className="mp-setting-saved">
            <Icon iconId="check" size={15} />
            {copy['mobile.settings.dirty.saved']}
          </div>
        ) : null}
        {dirty ? (
          <div className="mp-settings-dirty-bar">
            <Text>{copy['mobile.settings.dirty.unsavedChanges']}</Text>
            <span style={{ display: 'flex', gap: 8 }}>
              <Button actionId="settings.discard" density="compact"
                onActivate={() => setDirty(false)}>
                {copy['mobile.settings.dirty.discardChanges']}
              </Button>
              <Button actionId="settings.save" emphasis="primary" density="compact"
                onActivate={() => { setDirty(false); setSaved(true); }}>
                {copy['mobile.settings.dirty.saveChanges']}
              </Button>
            </span>
          </div>
        ) : null}
        {renderContent()}
      </div>
      <ConfirmState open={cacheConfirmOpen}
        title={copy['mobile.settings.storage.clearChatCacheAction']}
        description={copy['mobile.settings.storage.clearChatCacheConfirm']}
        confirmLabel={copy['mobile.settings.storage.clearChatCacheConfirmAction']}
        danger
        onCancel={() => setCacheConfirmOpen(false)}
        onConfirm={() => setCacheConfirmOpen(false)} />
      <ConfirmState open={stationConfirmOpen}
        title={copy['mobile.settings.station.changeStation']}
        description="Product Station is the active verified Station. Changing it ends the current account scope."
        confirmLabel={copy['mobile.settings.station.changeStation']}
        onCancel={() => setStationConfirmOpen(false)}
        onConfirm={onChangeStation} />
      <ConfirmState open={logoutConfirmOpen}
        title={copy['mobile.settings.station.logoutConfirmTitle']}
        description={copy['mobile.settings.station.logoutConfirmBody']}
        confirmLabel={copy['mobile.settings.logout']}
        danger
        onCancel={() => setLogoutConfirmOpen(false)}
        onConfirm={onChangeStation} />
    </div>
  );
}

function SettingCard({
  iconId,
  title,
  children,
}: {
  iconId: IconName;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mp-setting-detail-card">
      <header className="mp-setting-section-header">
        <Icon iconId={iconId} size={16} />
        <Text strong>{title}</Text>
      </header>
      {children}
    </section>
  );
}

function ConfirmState({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="mp-confirm-backdrop" onClick={onCancel}>
      <section
        className="mp-confirm-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mp-confirm-title">{title}</h2>
        <p className="mp-confirm-desc">{description}</p>
        <div className="mp-confirm-actions">
          <button type="button" className="mp-confirm-btn" onClick={onCancel}>
            {copy['common.action.cancel']}
          </button>
          <button
            type="button"
            className={`mp-confirm-btn ${danger ? 'mp-confirm-btn--danger' : 'mp-confirm-btn--primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
