import { useEffect, useState } from 'react';
import { Button, Card, Empty, List, Modal, Tag, Typography } from 'antd';
import { Ban, RotateCcw, Server } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import logo from '../assets/logo.png';
import type { MobileAuthSession } from '../features/auth/authSession';
import { useSocialStore } from '../features/social/socialStore';
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
  const [blockedOpen, setBlockedOpen] = useState(false);
  const activeStation = stationRegistry.entries.find((entry) => entry.url === stationRegistry.activeUrl);
  const displayName = authSession?.actor?.displayName || authSession?.actor?.username || authSession?.actor?.email;
  const blockedUsers = useSocialStore((state) => state.blockedUsers);
  const refreshBlockedUsers = useSocialStore((state) => state.refreshBlockedUsers);
  const unblockUser = useSocialStore((state) => state.unblockUser);

  useEffect(() => {
    if (authSession) void refreshBlockedUsers().catch(() => undefined);
  }, [authSession, refreshBlockedUsers]);

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
        <Button block icon={<Ban size={15} />} onClick={() => setBlockedOpen(true)} disabled={!authSession}>
          {t('mobile.settings.blockedUsers')}
        </Button>
        <Button block onClick={onLogout}>
          {t('mobile.settings.logout')}
        </Button>
      </div>

      <Modal
        title={t('mobile.settings.blockedUsers')}
        open={blockedOpen}
        footer={null}
        onCancel={() => setBlockedOpen(false)}
        destroyOnClose
      >
        {blockedUsers.length > 0 ? (
          <List
            dataSource={blockedUsers}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button
                    key="unblock"
                    size="small"
                    icon={<RotateCcw size={13} />}
                    onClick={() => unblockUser(item.targetDid)}
                  >
                    {t('mobile.contacts.unblock')}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={<Text copyable>{item.targetDid}</Text>}
                  description={<Tag color="error">{t('mobile.contacts.blocked')}</Tag>}
                />
              </List.Item>
            )}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.settings.noBlockedUsers')} />
        )}
      </Modal>
    </div>
  );
}
