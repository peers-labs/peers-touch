import { Button, Card } from 'antd';

import { useMobileI18n } from '../../app/mobileI18n';
import logo from '../../assets/logo.png';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { StationSelector } from './StationSelector';
import {
  activeStationEntry,
  type MobileStationRouteCandidate,
  type StationProtocol,
  type StoredStationRegistry,
} from './stationRegistry';

export function StationLaunchScreen({
  registry,
  error,
  checking,
  verifyingUrls,
  onAddStation,
  onSelectStation,
  onSelectStationRoute,
  onRemoveStation,
  onContinue,
}: {
  registry: StoredStationRegistry;
  error: string | null;
  checking: boolean;
  verifyingUrls: string[];
  onAddStation: (protocol: StationProtocol, address: string) => boolean | Promise<boolean>;
  onSelectStation: (stationPeerId: string) => void | Promise<void>;
  onSelectStationRoute: (
    stationPeerId: string,
    route: MobileStationRouteCandidate,
  ) => void | Promise<void>;
  onRemoveStation: (stationPeerId: string) => void;
  onContinue: () => void | Promise<void>;
}) {
  const { t } = useMobileI18n();
  const activeStation = activeStationEntry(registry);

  return (
    <main className="launch-screen">
      <div className="launch-topbar">
        <LanguageSwitcher />
      </div>

      <div className="launch-hero">
        <img src={logo} alt="Peers Touch" className="launch-hero-logo" />
      </div>

      <div className="launch-body">
        <Card className="launch-card" bordered={false}>
          <StationSelector
            activeStationPeerId={registry.activeStationPeerId}
            entries={registry.entries}
            error={error}
            checking={checking}
            verifyingUrls={verifyingUrls}
            onAdd={onAddStation}
            onSelect={onSelectStation}
            onSelectRoute={onSelectStationRoute}
            onRemove={onRemoveStation}
          />
          <div className="launch-actions">
            <Button block size="large" type="primary" loading={checking} disabled={!activeStation} onClick={onContinue}>
              {t('mobile.launch.continue')}
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}
