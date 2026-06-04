import { Button, Card, Typography } from 'antd';

import { useMobileI18n } from '../../app/mobileI18n';
import logo from '../../assets/logo.png';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { StationSelector } from './StationSelector';
import type { StationProtocol, StoredStationRegistry } from './stationRegistry';

const { Text, Title } = Typography;

export function StationLaunchScreen({
  registry,
  error,
  checking,
  verifyingUrls,
  onAddStation,
  onSelectStation,
  onRemoveStation,
  onContinue,
}: {
  registry: StoredStationRegistry;
  error: string | null;
  checking: boolean;
  verifyingUrls: string[];
  onAddStation: (protocol: StationProtocol, address: string) => boolean | Promise<boolean>;
  onSelectStation: (url: string) => void | Promise<void>;
  onRemoveStation: (url: string) => void;
  onContinue: () => void | Promise<void>;
}) {
  const { t } = useMobileI18n();
  const activeStation = registry.entries.find((entry) => entry.url === registry.activeUrl);
  const activeStationLabel = activeStation?.label || registry.activeUrl;

  return (
    <main className="launch-screen">
      <section className="launch-brand">
        <div className="launch-brand-top">
          <img src={logo} alt="Peers Touch" className="launch-logo" />
          <LanguageSwitcher />
        </div>
        <div>
          <Text className="launch-kicker">{t('mobile.launch.brand')}</Text>
          <Title level={1} className="launch-title">
            {t('mobile.launch.title')}
          </Title>
        </div>
      </section>

      <Card className="launch-card" bordered={false}>
        <div className="launch-card-content">
          <div className="launch-copy">
            <Text className="launch-copy-title">{t('mobile.launch.subtitle')}</Text>
          </div>

          <StationSelector
            activeUrl={registry.activeUrl}
            entries={registry.entries}
            error={error}
            checking={checking}
            verifyingUrls={verifyingUrls}
            onAdd={onAddStation}
            onSelect={onSelectStation}
            onRemove={onRemoveStation}
          />

          <div className="launch-actions">
            {activeStationLabel ? (
              <div className="launch-target">
                <Text type="secondary">{t('mobile.launch.activeStation')}</Text>
                <Text strong ellipsis>
                  {activeStationLabel}
                </Text>
              </div>
            ) : null}
            <Button block size="large" type="primary" loading={checking} disabled={!registry.activeUrl} onClick={onContinue}>
              {t('mobile.launch.enterStation')}
            </Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
