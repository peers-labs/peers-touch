import { Button, Card, Tag, Typography } from 'antd';
import { Server } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import logo from '../assets/logo.png';
import type { MobileAuthSession } from '../features/auth/authSession';
import type { StoredStationRegistry } from '../features/station/stationRegistry';

const { Text } = Typography;

export function SettingsPage({
  stationRegistry,
  authSession,
  onChangeStation,
  onLogout,
}: {
  stationRegistry: StoredStationRegistry;
  authSession: MobileAuthSession | null;
  onChangeStation: () => void;
  onLogout: () => Promise<void>;
}) {
  const { t } = useMobileI18n();
  const activeStation = stationRegistry.entries.find((entry) => entry.url === stationRegistry.activeUrl);
  const displayName = authSession?.actor?.displayName || authSession?.actor?.username || authSession?.actor?.email;

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="header-title">{t('mobile.settings.title')}</h1>
      </header>

      <Card className="settings-profile" bordered={false}>
        <img src={logo} alt="Peers Touch" className="profile-logo" />
        <div className="profile-info">
          <Text strong className="profile-name">
            {displayName || t('mobile.settings.notLoggedIn')}
          </Text>
          <Text type="secondary">{authSession ? t('mobile.settings.connected') : t('mobile.settings.loginHint')}</Text>
        </div>
      </Card>

      <Card className="settings-station-card" bordered={false}>
        <div className="settings-station-header">
          <span className="settings-station-icon">
            <Server size={18} />
          </span>
          <div className="settings-station-copy">
            <Text strong>{activeStation?.label || t('mobile.launch.station')}</Text>
            <Text type="secondary" ellipsis>
              {stationRegistry.activeUrl || t('mobile.settings.stationNotSelected')}
            </Text>
          </div>
          <Tag color={activeStation?.online ? 'green' : 'default'}>
            {activeStation?.online ? t('mobile.launch.verified') : t('mobile.launch.unverified')}
          </Tag>
        </div>
        <Button block onClick={onChangeStation}>
          {t('mobile.auth.changeStation')}
        </Button>
      </Card>

      <div className="settings-actions">
        <Button block onClick={onLogout}>
          {t('mobile.settings.logout')}
        </Button>
      </div>
    </div>
  );
}
