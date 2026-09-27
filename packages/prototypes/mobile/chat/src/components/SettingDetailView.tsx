import { useState } from 'react';
import {
  Avatar,
  Button,
  InputNumber,
  Select,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { ArrowLeft } from 'lucide-react';
import type { SettingEntry } from '../types';
import { GRADIENTS } from '../types';
import copy from '../../../../../locales/en/common.json';

const { Text } = Typography;

export function SettingDetailView({ setting, onBack }: { setting: SettingEntry; onBack: () => void }) {
  const [toggle1, setToggle1] = useState(true);
  const [toggle2, setToggle2] = useState(false);
  const [toggle3, setToggle3] = useState(true);
  const [toggle4, setToggle4] = useState(true);
  const [toggle5, setToggle5] = useState(true);
  const [defaultVisibility, setDefaultVisibility] = useState('followers');
  const [manuallyApprovesFollowers, setManuallyApprovesFollowers] = useState(true);
  const [messagePermission, setMessagePermission] = useState('friends');
  const [autoExpireDays, setAutoExpireDays] = useState(30);
  const [blockedUsers, setBlockedUsers] = useState([
    {
      ptid: 'ptid:v1:actor:remote:p:bob:7c21',
      name: 'Bob Lin',
      station: 'station-two',
      initials: 'BL',
    },
    {
      ptid: 'ptid:v1:actor:remote:p:carol:92af',
      name: 'Carol Wu',
      station: 'station-three',
      initials: 'CW',
    },
  ]);

  function renderContent() {
    if (setting.label === 'Account Info') {
      return (
        <div className="mp-setting-detail-content">
          <div className="mp-setting-detail-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Avatar size={56} style={{ background: GRADIENTS[0], borderRadius: 16 }}>AC</Avatar>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <Text strong style={{ fontSize: 16 }}>Alice Chen</Text>
              <Text type="secondary" style={{ fontSize: 13 }}>alice@peers.social</Text>
            </div>
            <Button size="small" type="primary" style={{ borderRadius: 20 }}>Edit</Button>
          </div>
          <div className="mp-setting-detail-card">
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">Display Name</span>
              <span className="mp-setting-detail-value">Alice Chen</span>
            </div>
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">Email</span>
              <span className="mp-setting-detail-value">alice@peers.social</span>
            </div>
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">User ID</span>
              <span className="mp-setting-detail-value" style={{ fontFamily: 'monospace', fontSize: 12 }}>ptid:v1:alice:a3f9</span>
            </div>
          </div>
        </div>
      );
    }

    if (setting.label === 'Notifications') {
      return (
        <div className="mp-setting-detail-content">
          <div className="mp-setting-detail-card">
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">Message Notifications</span>
              <button type="button" className={`mp-toggle ${toggle1 ? 'active' : ''}`} onClick={() => setToggle1(!toggle1)} />
            </div>
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">Group Notifications</span>
              <button type="button" className={`mp-toggle ${toggle2 ? 'active' : ''}`} onClick={() => setToggle2(!toggle2)} />
            </div>
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">Sound</span>
              <button type="button" className={`mp-toggle ${toggle3 ? 'active' : ''}`} onClick={() => setToggle3(!toggle3)} />
            </div>
          </div>
          <div className="mp-setting-detail-card">
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">Preview Messages</span>
              <button type="button" className={`mp-toggle ${toggle4 ? 'active' : ''}`} onClick={() => setToggle4(!toggle4)} />
            </div>
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">Vibrate</span>
              <button type="button" className={`mp-toggle ${toggle5 ? 'active' : ''}`} onClick={() => setToggle5(!toggle5)} />
            </div>
          </div>
        </div>
      );
    }

    if (setting.label === copy['mobile.settings.privacySecurity']) {
      return (
        <div className="mp-setting-detail-content">
          <div className="mp-setting-detail-card">
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">
                {copy['mobile.settings.privacy.defaultVisibility']}
              </span>
              <Select
                aria-label={copy['mobile.settings.privacy.defaultVisibility']}
                value={defaultVisibility}
                data-prototype-privacy-setting="defaultVisibility"
                onChange={setDefaultVisibility}
                options={[
                  {
                    value: 'public',
                    label: copy['mobile.settings.privacy.visibility.public'],
                  },
                  {
                    value: 'unlisted',
                    label: copy['mobile.settings.privacy.visibility.unlisted'],
                  },
                  {
                    value: 'followers',
                    label: copy['mobile.settings.privacy.visibility.followers'],
                  },
                  {
                    value: 'private',
                    label: copy['mobile.settings.privacy.visibility.private'],
                  },
                ]}
                style={{ minWidth: 144 }}
              />
            </div>
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">
                {copy['mobile.settings.privacy.manuallyApprovesFollowers']}
              </span>
              <Switch
                aria-label={copy['mobile.settings.privacy.manuallyApprovesFollowers']}
                checked={manuallyApprovesFollowers}
                data-prototype-privacy-setting="manuallyApprovesFollowers"
                onChange={setManuallyApprovesFollowers}
              />
            </div>
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">
                {copy['mobile.settings.privacy.messagePermission']}
              </span>
              <Select
                aria-label={copy['mobile.settings.privacy.messagePermission']}
                value={messagePermission}
                data-prototype-privacy-setting="messagePermission"
                onChange={setMessagePermission}
                options={[
                  {
                    value: 'everyone',
                    label: copy['mobile.settings.privacy.message.everyone'],
                  },
                  {
                    value: 'friends',
                    label: copy['mobile.settings.privacy.message.friends'],
                  },
                  {
                    value: 'none',
                    label: copy['mobile.settings.privacy.message.none'],
                  },
                ]}
                style={{ minWidth: 144 }}
              />
            </div>
            <div className="mp-setting-detail-row">
              <span className="mp-setting-detail-label">
                {copy['mobile.settings.privacy.autoExpire']}
              </span>
              <InputNumber
                aria-label={copy['mobile.settings.privacy.autoExpire']}
                value={autoExpireDays}
                min={0}
                max={2_147_483_647}
                precision={0}
                data-prototype-privacy-setting="autoExpireDays"
                onChange={(value) => {
                  if (typeof value === 'number') setAutoExpireDays(value);
                }}
                style={{ width: 112 }}
              />
            </div>
          </div>
        </div>
      );
    }

    if (setting.label === copy['mobile.settings.blockedUsers']) {
      return (
        <div className="mp-setting-detail-content">
          <div className="mp-setting-detail-card">
            {blockedUsers.length === 0 ? (
              <div className="mp-setting-detail-row">
                <span className="mp-setting-detail-label">
                  {copy['mobile.settings.noBlockedUsers']}
                </span>
              </div>
            ) : blockedUsers.map((user) => (
              <div className="mp-setting-detail-row mp-blocked-user-row" key={user.ptid}>
                <Avatar size={40} style={{ background: GRADIENTS[1] }}>
                  {user.initials}
                </Avatar>
                <div className="mp-blocked-user-copy">
                  <div className="mp-setting-detail-label">{user.name}</div>
                  <div className="mp-setting-detail-value">{user.ptid}</div>
                  <div className="mp-setting-detail-value">{user.station}</div>
                </div>
                <Button
                  className="mp-blocked-user-action"
                  size="small"
                  onClick={() => setBlockedUsers((current) => (
                    current.filter((item) => item.ptid !== user.ptid)
                  ))}
                >
                  {copy['mobile.contacts.unblock']}
                </Button>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Default/generic setting view
    const SettingIcon = setting.icon;
    return (
      <div className="mp-setting-detail-content">
        <div className="mp-setting-detail-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 28 }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 16, background: `${setting.tint}14`, color: setting.tint }}>
            <SettingIcon size={28} />
          </span>
          <Text strong style={{ fontSize: 16 }}>{setting.label}</Text>
          {setting.value && <Tag color="default">{setting.value}</Tag>}
          <Text type="secondary" style={{ textAlign: 'center', fontSize: 13 }}>
            Configure your {setting.label.toLowerCase()} preferences here.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className="mp-detail-page">
      <header className="mp-detail-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <h2 className="mp-detail-header-title">{setting.label}</h2>
      </header>
      {renderContent()}
    </div>
  );
}
