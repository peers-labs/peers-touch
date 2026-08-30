import { Button, Card, Typography } from 'antd';

import { useMobileI18n } from '../../app/mobileI18n';
import logo from '../../assets/logo.png';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { StationNetworkIntro } from '../../components/StationNetworkIntro';
import { StationSelector } from './StationSelector';
import { activeStationEntry, type StationProtocol, type StoredStationRegistry } from './stationRegistry';

const { Text, Title } = Typography;

function stationDisplayName(entryLabel?: string, stationUrl?: string): string {
  if (entryLabel) return entryLabel;
  if (!stationUrl) return '';

  try {
    return new URL(stationUrl).hostname;
  } catch {
    return stationUrl;
  }
}

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
  onSelectStation: (stationPeerId: string) => void | Promise<void>;
  onRemoveStation: (stationPeerId: string) => void;
  onContinue: () => void | Promise<void>;
}) {
  const { t } = useMobileI18n();
  const activeStation = activeStationEntry(registry);
  const activeStationLabel = stationDisplayName(activeStation?.label, activeStation?.url);
  const networkIntroLabels = {
    title: t('auth.network.title'),
    personal: t('auth.network.personal'),
    actor: t('auth.network.actor'),
    relay: t('auth.network.relay'),
    relayLink: t('auth.network.relayLink'),
    alice: t('auth.network.alice'),
    service: t('auth.network.service'),
    station: t('auth.network.station'),
    bob: t('auth.network.bob'),
    agent: t('auth.network.agent'),
    joining: t('auth.network.joining'),
    yourStation: t('auth.network.yourStation'),
    messageFlow: t('auth.network.messageFlow'),
    imageFlow: t('auth.network.imageFlow'),
    fileFlow: t('auth.network.fileFlow'),
    taskFlow: t('auth.network.taskFlow'),
  };

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

      <div className="station-network-panel">
        <StationNetworkIntro
          selectedStationName={activeStationLabel || t('auth.network.defaultStationName')}
          labels={networkIntroLabels}
        />
      </div>

      <Card className="launch-card" bordered={false}>
        <div className="launch-card-content">
          <div className="launch-copy">
            <Text className="launch-copy-title">{t('mobile.launch.subtitle')}</Text>
          </div>

          <StationSelector
            activeStationPeerId={registry.activeStationPeerId}
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
                <Text strong className="mobile-truncate">
                  {activeStationLabel}
                </Text>
              </div>
            ) : null}
            <Button block size="large" type="primary" loading={checking} disabled={!activeStation} onClick={onContinue}>
              {t('mobile.launch.enterStation')}
            </Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
