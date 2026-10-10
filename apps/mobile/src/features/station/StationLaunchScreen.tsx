import { Button } from 'antd';

import { useMobileI18n } from '../../app/mobileI18n';
import logo from '../../assets/logo.png';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import {
  StationSelector,
  type StationSelectorSurfaceFixture,
} from './StationSelector';
import { activeStationEntry, type StoredStationRegistry } from './stationRegistry';

export function StationLaunchScreen({
  registry,
  error,
  checking,
  verifyingUrls,
  checkedUrls,
  surfaceFixture,
  onAddStation,
  onSelectStation,
  onRemoveStation,
  onContinue,
}: {
  registry: StoredStationRegistry;
  error: string | null;
  checking: boolean;
  verifyingUrls: string[];
  checkedUrls: string[];
  surfaceFixture?: StationSelectorSurfaceFixture;
  onAddStation: (stationUrl: string) => boolean | Promise<boolean>;
  onSelectStation: (stationPeerId: string) => void | Promise<void>;
  onRemoveStation: (stationPeerId: string) => void;
  onContinue: () => void | Promise<void>;
}) {
  const { t } = useMobileI18n();
  const activeStation = activeStationEntry(registry);
  const activeStationChecked = Boolean(
    activeStation
      && checkedUrls.includes(activeStation.url)
      && !verifyingUrls.includes(activeStation.url),
  );
  const activeStationUnavailable = Boolean(
    activeStationChecked && activeStation?.online !== true,
  );

  return (
    <main
      className="launch-screen"
      data-product-surface="entry.station-selection"
    >
      <div className="launch-topbar">
        <LanguageSwitcher />
      </div>

      <section className="launch-content" aria-labelledby="launch-title">
        <header className="launch-brand">
          <img src={logo} alt="Peers Touch" className="launch-brand-logo" />
          <div className="launch-brand-copy">
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
            checkedUrls={checkedUrls}
            surfaceFixture={surfaceFixture}
            onAdd={onAddStation}
            onSelect={onSelectStation}
            onRemove={onRemoveStation}
          />
          <div className="launch-actions">
            <Button
              block
              size="large"
              type="primary"
              loading={checking}
              disabled={!activeStation || !activeStationChecked}
              onClick={onContinue}
            >
              {t(activeStationUnavailable ? 'common.action.retry' : 'mobile.launch.continue')}
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
