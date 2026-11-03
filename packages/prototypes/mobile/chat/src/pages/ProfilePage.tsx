import { useState } from 'react';
import { useT } from '../i18n';
import { Icon } from '@peers-touch/ui';
import type { SettingEntry, SettingGroup } from '../types';
import type { AvatarRenderState } from '../types';
import { demoSelfIdentity } from '../data';
import { IdentityAvatar } from '../components/IdentityAvatar';

export function ProfilePage({ avatarState, onChangeStation, onSettingClick }: {
  avatarState: AvatarRenderState;
  onChangeStation: () => void;
  onSettingClick: (s: SettingEntry) => void;
}) {
  const t = useT();
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const settingGroups: SettingGroup[] = [
    {
      title: 'Account',
      items: [
        { id: 'account-info', label: 'Account Info', iconId: 'circle-user' },
        { id: 'notifications', label: 'Notifications', value: 'In-app', iconId: 'bell' },
        { id: 'privacy-security', label: 'Privacy & Security', iconId: 'shield-check' },
        { id: 'blocked-users', label: 'Blocked Users', value: '2', iconId: 'ban' },
      ],
    },
    {
      title: 'Chat',
      items: [
        { id: 'chat-settings', label: 'Chat Settings', iconId: 'message-circle' },
      ],
    },
    {
      title: 'Network',
      items: [
        { id: 'station-connection', label: 'Station Connection', value: 'Product Station', iconId: 'server' },
        { id: 'encryption', label: 'Encryption', value: 'Active', iconId: 'lock-keyhole' },
        { id: 'language', label: 'Language', value: 'English', iconId: 'languages' },
      ],
    },
    {
      title: 'About',
      items: [
        { id: 'about', label: 'About Peers Touch', value: 'v1.0.0', iconId: 'info' },
      ],
    },
  ];

  return (
    <div className="mp-page">
      <header className="mp-header">
        <h1 className="mp-header-title">{t('common.me')}</h1>
        <span style={{ width: 36 }} />
      </header>

      <div className="mp-profile-body">
        <button
          type="button"
          className="mp-profile-trigger"
          onClick={() => onSettingClick(settingGroups[0]!.items[0]!)}
        >
          <div className="mp-profile-header">
            <IdentityAvatar name={demoSelfIdentity.name} initials={demoSelfIdentity.initials} src={demoSelfIdentity.avatarUrl}
              size={52} renderState={avatarState} />
            <div className="mp-profile-info">
              <strong className="mp-profile-name">{demoSelfIdentity.name}</strong>
              <span className="mp-profile-did">Local identity · Local Station</span>
            </div>
            <span className="mp-row-chevron"><Icon iconId="chevron-right" size={20} /></span>
          </div>
        </button>

        {settingGroups.map((group) => (
          <div key={group.title} className="mp-settings-group">
            <div className="mp-settings-group-title">{group.title}</div>
            <div className="mp-settings-card">
              {group.items.map((item, idx) => (
                <button
                  key={item.label}
                  type="button"
                  className={`mp-setting-row ${idx > 0 ? 'mp-setting-row--border' : ''}`}
                  onClick={() => onSettingClick(item)}
                >
                  <span className="mp-setting-icon">
                    <Icon iconId={item.iconId} size={16} />
                  </span>
                  <span className="mp-setting-label">{item.label}</span>
                  {item.value && <span className="mp-setting-value">{item.value}</span>}
                  <span className="mp-row-chevron"><Icon iconId="chevron-right" size={17} /></span>
                </button>
              ))}
            </div>
          </div>
        ))}

        <button type="button" className="mp-sign-out" onClick={() => setLogoutConfirmOpen(true)}>
          {t('mobile.settings.logout')}
        </button>
      </div>
      {logoutConfirmOpen ? (
        <div className="mp-confirm-backdrop" onClick={() => setLogoutConfirmOpen(false)}>
          <section
            className="mp-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-logout-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="mp-confirm-title" id="profile-logout-title">
              {t('mobile.settings.station.logoutConfirmTitle')}
            </h2>
            <p className="mp-confirm-desc">
              {t('mobile.settings.station.logoutConfirmBody')}
            </p>
            <div className="mp-confirm-actions">
              <button type="button" className="mp-confirm-btn" onClick={() => setLogoutConfirmOpen(false)}>
                {t('common.action.cancel')}
              </button>
              <button type="button" className="mp-confirm-btn mp-confirm-btn--danger" onClick={onChangeStation}>
                {t('mobile.settings.logout')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
