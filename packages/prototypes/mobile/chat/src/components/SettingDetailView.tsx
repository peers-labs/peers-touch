import { useState, type ReactNode } from 'react';
import {
  Avatar,
  Button,
  Empty,
  Input,
  InputNumber,
  Select,
  Switch,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeft,
  Ban,
  Bell,
  Check,
  Globe,
  HardDrive,
  Palette,
  Server,
  Shield,
  ShieldCheck,
  Trash2,
  User,
} from 'lucide-react';

import type { SettingEntry } from '../types';
import { GRADIENTS } from '../types';
import copy from '../../../../../locales/en/common.json';
import { PersonAvatar } from './PersonAvatar';

const { Text } = Typography;

export function SettingDetailView({
  setting,
  onBack,
  onChangeStation,
}: {
  setting: SettingEntry;
  onBack: () => void;
  onChangeStation: () => void;
}) {
  const SettingIcon = setting.icon;
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
          <SettingCard icon={<User size={16} />} title={copy['mobile.settings.section.profile']}>
            <div className="mp-setting-profile-summary">
              <PersonAvatar background={GRADIENTS[0]} name="Alice Chen" size={56} />
              <span>
                <Text strong>Alice Chen</Text>
                <Text type="secondary">@alice@product.peers</Text>
              </span>
            </div>
            <label className="mp-setting-field">
              <Text type="secondary">{copy['mobile.settings.profile.displayName']}</Text>
              <Input
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  markDirty();
                }}
              />
            </label>
            <label className="mp-setting-field">
              <Text type="secondary">{copy['mobile.settings.profile.bio']}</Text>
              <Input.TextArea
                value={bio}
                autoSize={{ minRows: 2, maxRows: 4 }}
                onChange={(event) => {
                  setBio(event.target.value);
                  markDirty();
                }}
              />
            </label>
          </SettingCard>
        );

      case 'notifications':
        return (
          <SettingCard icon={<Bell size={16} />} title={copy['mobile.settings.section.notifications']}>
            {[
              ['enabled', copy['mobile.settings.notifications.enabled']],
              ['push', copy['mobile.settings.notifications.push']],
              ['sound', copy['mobile.settings.notifications.sound']],
            ].map(([field, label]) => (
              <div className="mp-setting-detail-row" key={field}>
                <span className="mp-setting-detail-label">{label}</span>
                <Switch
                  checked={notifications[field as keyof typeof notifications]}
                  onChange={(checked) => {
                    setNotifications((current) => ({ ...current, [field]: checked }));
                    markDirty();
                  }}
                />
              </div>
            ))}
            <div className="mp-setting-owner-note">
              <ShieldCheck size={15} />
              <span>Category preferences are saved by this Station. Device permission is currently allowed.</span>
            </div>
          </SettingCard>
        );

      case 'privacy-security':
        return (
          <>
            <SettingCard icon={<Shield size={16} />} title={copy['mobile.settings.section.privacy']}>
              <div className="mp-setting-detail-row">
                <span className="mp-setting-detail-label">
                  {copy['mobile.settings.privacy.defaultVisibility']}
                </span>
                <Select
                  value={defaultVisibility}
                  onChange={(value) => {
                    setDefaultVisibility(value);
                    markDirty();
                  }}
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
                  onChange={(checked) => {
                    setManuallyApprovesFollowers(checked);
                    markDirty();
                  }}
                />
              </div>
              <div className="mp-setting-detail-row">
                <span className="mp-setting-detail-label">
                  {copy['mobile.settings.privacy.messagePermission']}
                </span>
                <Select
                  value={messagePermission}
                  onChange={(value) => {
                    setMessagePermission(value);
                    markDirty();
                  }}
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
                <InputNumber
                  value={autoExpireDays}
                  min={0}
                  precision={0}
                  onChange={(value) => {
                    if (typeof value === 'number') {
                      setAutoExpireDays(value);
                      markDirty();
                    }
                  }}
                />
              </div>
            </SettingCard>
            <SettingCard icon={<ShieldCheck size={16} />} title={copy['mobile.settings.section.permissions']}>
              {[
                copy['mobile.settings.permissions.camera'],
                copy['mobile.settings.permissions.microphone'],
                copy['mobile.settings.section.notifications'],
              ].map((label) => (
                <div className="mp-setting-detail-row" key={label}>
                  <span className="mp-setting-detail-label">{label}</span>
                  <Tag color="green">{copy['mobile.settings.permissions.status.granted']}</Tag>
                </div>
              ))}
            </SettingCard>
          </>
        );

      case 'blocked-users':
        return (
          <SettingCard icon={<Ban size={16} />} title={copy['mobile.settings.section.blocked']}>
            {blockedUsers.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={copy['mobile.settings.noBlockedUsers']}
              />
            ) : blockedUsers.map((user) => (
              <div className="mp-setting-detail-row mp-blocked-user-row" key={user.handle}>
                <Avatar size={40} style={{ background: GRADIENTS[1] }}>{user.initials}</Avatar>
                <div className="mp-blocked-user-copy">
                  <div className="mp-setting-detail-label">{user.name}</div>
                  <div className="mp-setting-detail-value">{user.handle}</div>
                </div>
                <Button
                  className="mp-blocked-user-action"
                  size="small"
                  onClick={() => setBlockedUsers((current) => (
                    current.filter((item) => item.handle !== user.handle)
                  ))}
                >
                  {copy['mobile.contacts.unblock']}
                </Button>
              </div>
            ))}
          </SettingCard>
        );

      case 'chat-settings':
        return (
          <>
            <SettingCard icon={<Palette size={16} />} title={copy['mobile.settings.section.devicePrefs']}>
              <div className="mp-setting-detail-row">
                <span className="mp-setting-detail-label">{copy['mobile.settings.device.theme']}</span>
                <Select
                  value={theme}
                  onChange={(value) => {
                    setTheme(value);
                    markDirty();
                  }}
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
                  onChange={(value) => {
                    setFontSize(value);
                    markDirty();
                  }}
                  options={[
                    { value: 'small', label: copy['mobile.settings.device.fontSize.small'] },
                    { value: 'medium', label: copy['mobile.settings.device.fontSize.medium'] },
                    { value: 'large', label: copy['mobile.settings.device.fontSize.large'] },
                  ]}
                />
              </div>
              <div className="mp-setting-detail-row">
                <span className="mp-setting-detail-label">{copy['mobile.settings.device.compactMode']}</span>
                <Switch
                  checked={compactMode}
                  onChange={(checked) => {
                    setCompactMode(checked);
                    markDirty();
                  }}
                />
              </div>
            </SettingCard>
            <SettingCard icon={<HardDrive size={16} />} title={copy['mobile.settings.section.storage']}>
              <div className="mp-setting-detail-row">
                <span>
                  <span className="mp-setting-detail-label">{copy['mobile.settings.storage.total']}</span>
                  <span className="mp-setting-detail-value">128 MB on this device</span>
                </span>
                <Button>{copy['mobile.settings.storage.batchManage']}</Button>
              </div>
              <div className="mp-setting-detail-row">
                <span className="mp-setting-detail-label">{copy['mobile.settings.storage.retentionTitle']}</span>
                <Select
                  value="forever"
                  options={[
                    { value: 'forever', label: copy['mobile.settings.storage.retentionForever'] },
                    { value: '90', label: copy['mobile.settings.storage.retention90Days'] },
                  ]}
                />
              </div>
              <Button
                icon={<Trash2 size={15} />}
                onClick={() => setCacheConfirmOpen(true)}
              >
                {copy['mobile.settings.storage.clearChatCacheAction']}
              </Button>
            </SettingCard>
          </>
        );

      case 'station-connection':
        return (
          <SettingCard icon={<Server size={16} />} title={copy['mobile.settings.section.station']}>
            <div className="mp-station-summary">
              <span>
                <Text strong>Product Station</Text>
                <Text type="secondary">{copy['mobile.settings.connected']}</Text>
              </span>
              <Tag color="green">{copy['mobile.launch.verified']}</Tag>
            </div>
            <Button onClick={() => setStationConfirmOpen(true)}>
              {copy['mobile.settings.station.changeStation']}
            </Button>
            <Button danger onClick={() => setLogoutConfirmOpen(true)}>
              {copy['mobile.settings.logout']}
            </Button>
          </SettingCard>
        );

      case 'language':
        return (
          <SettingCard icon={<Globe size={16} />} title={copy['mobile.settings.section.language']}>
            <Select
              value={language}
              onChange={setLanguage}
              options={[
                { value: 'en', label: 'English' },
                { value: 'zh-CN', label: '简体中文' },
              ]}
            />
          </SettingCard>
        );

      case 'about':
        return (
          <SettingCard icon={<ShieldCheck size={16} />} title={copy['mobile.settings.aboutApp']}>
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">{copy['mobile.settings.aboutApp']}</span>
              <span className="mp-setting-detail-value">1.0.0</span>
            </div>
          </SettingCard>
        );

      case 'safety-number':
      case 'chat-background':
      case 'encryption':
        return (
          <div className="mp-setting-unavailable">
            <SettingIcon size={32} />
            <Text strong>{setting.label}</Text>
            <Text type="secondary">{copy['mobile.launch.unavailable']}</Text>
          </div>
        );
    }
  }

  return (
    <div className="mp-detail-page">
      <header className="mp-detail-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <h2 className="mp-detail-header-title">{setting.label}</h2>
      </header>
      <div className="mp-setting-detail-content">
        {saved ? (
          <div className="mp-setting-saved">
            <Check size={15} />
            {copy['mobile.settings.dirty.saved']}
          </div>
        ) : null}
        {dirty ? (
          <div className="mp-settings-dirty-bar">
            <Text>{copy['mobile.settings.dirty.unsavedChanges']}</Text>
            <span>
              <Button onClick={() => setDirty(false)}>
                {copy['mobile.settings.dirty.discardChanges']}
              </Button>
              <Button
                type="primary"
                onClick={() => {
                  setDirty(false);
                  setSaved(true);
                }}
              >
                {copy['mobile.settings.dirty.saveChanges']}
              </Button>
            </span>
          </div>
        ) : null}
        {renderContent()}
      </div>
      {cacheConfirmOpen ? (
        <ConfirmDialog
          id="settings-cache-confirm"
          title={copy['mobile.settings.storage.clearChatCacheAction']}
          description={copy['mobile.settings.storage.clearChatCacheConfirm']}
          confirmLabel={copy['mobile.settings.storage.clearChatCacheConfirmAction']}
          danger
          onCancel={() => setCacheConfirmOpen(false)}
          onConfirm={() => setCacheConfirmOpen(false)}
        />
      ) : null}
      {stationConfirmOpen ? (
        <ConfirmDialog
          id="settings-station-confirm"
          title={copy['mobile.settings.station.changeStation']}
          description="Product Station is the active verified Station. Changing it ends the current account scope."
          confirmLabel={copy['mobile.settings.station.changeStation']}
          onCancel={() => setStationConfirmOpen(false)}
          onConfirm={onChangeStation}
        />
      ) : null}
      {logoutConfirmOpen ? (
        <ConfirmDialog
          id="settings-logout-confirm"
          title={copy['mobile.settings.station.logoutConfirmTitle']}
          description={copy['mobile.settings.station.logoutConfirmBody']}
          confirmLabel={copy['mobile.settings.logout']}
          danger
          onCancel={() => setLogoutConfirmOpen(false)}
          onConfirm={onChangeStation}
        />
      ) : null}
    </div>
  );
}

function SettingCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mp-setting-detail-card">
      <header className="mp-setting-section-header">
        {icon}
        <Text strong>{title}</Text>
      </header>
      {children}
    </section>
  );
}

function ConfirmDialog({
  id,
  title,
  description,
  confirmLabel,
  danger = false,
  onCancel,
  onConfirm,
}: {
  id: string;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mp-confirm-backdrop" onClick={onCancel}>
      <section
        className="mp-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mp-confirm-title" id={`${id}-title`}>{title}</h2>
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
