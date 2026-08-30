import { useState } from 'react';
import { Avatar, Button, Tag, Typography } from 'antd';
import { ArrowLeft } from 'lucide-react';
import type { SettingEntry } from '../types';
import { GRADIENTS } from '../types';

const { Text } = Typography;

export function SettingDetailView({ setting, onBack }: { setting: SettingEntry; onBack: () => void }) {
  const [toggle1, setToggle1] = useState(true);
  const [toggle2, setToggle2] = useState(false);
  const [toggle3, setToggle3] = useState(true);
  const [toggle4, setToggle4] = useState(true);
  const [toggle5, setToggle5] = useState(true);

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
