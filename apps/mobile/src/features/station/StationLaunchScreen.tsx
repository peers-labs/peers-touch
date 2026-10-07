import { Button } from 'antd';

import { useMobileI18n } from '../../app/mobileI18n';
import logo from '../../assets/logo.png';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { StationSelector } from './StationSelector';
import { activeStationEntry, type StationProtocol, type StoredStationRegistry } from './stationRegistry';

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

  return (
    <main className="launch-screen">
      <div className="launch-topbar">
        <LanguageSwitcher />
      </div>

      <section className="launch-content" aria-labelledby="launch-title">
        <header className="launch-brand">
          <img src={logo} alt="Peers Touch" className="launch-brand-logo" />
          <div className="launch-brand-copy">
            <span>{t('mobile.launch.brand')}</span>
            <h1 id="launch-title">{t('mobile.launch.title')}</h1>
            <p>{t('mobile.launch.subtitle')}</p>
          </div>
        </header>

        <div className="launch-panel">
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
            <Button block size="large" type="primary" loading={checking} disabled={!activeStation} onClick={onContinue}>
              {activeStation
                ? t('mobile.launch.enterStationWithName', {
                    station: activeStation.label,
                  })
                : t('mobile.launch.continue')}
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
