import { useT } from '../i18n';
import { Button, Icon } from '@peers-touch/ui';
import type { StationEntry } from '../types';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { StationSelector } from '../components/StationSelector';
import logo from '../assets/logo.png';

export function LaunchScreen({
  stations, activeUrl, onSelectStation, onRemoveStation, onAddStation, onContinue,
  showRemovalConfirmation = false, offline = false,
}: {
  stations: StationEntry[];
  activeUrl: string;
  onSelectStation: (url: string) => void;
  onRemoveStation: (url: string) => void;
  onAddStation: (url: string) => void;
  onContinue: () => void;
  showRemovalConfirmation?: boolean;
  offline?: boolean;
}) {
  const t = useT();
  const activeStation = stations.find((station) => station.url === activeUrl);

  return (
    <main className="mp-launch-screen">
      <div className="mp-launch-topbar">
        <LanguageSwitcher />
      </div>

      <section className="mp-launch-content" aria-labelledby="mp-launch-title">
        <header className="mp-launch-brand">
          <img src={logo} alt="Peers Touch" className="mp-launch-brand-logo" />
          <div className="mp-launch-brand-copy">
            <span>Peers</span>
            <h1 id="mp-launch-title">{t('mobile.launch.connectStation')}</h1>
            <p>{t('mobile.launch.chooseRecent')}</p>
          </div>
        </header>

        <div className="mp-launch-panel">
          <StationSelector
            entries={stations}
            activeUrl={activeUrl}
            onSelect={onSelectStation}
            onRemove={onRemoveStation}
            onAdd={onAddStation}
            showRemovalConfirmation={showRemovalConfirmation}
          />
          <div className="mp-launch-actions">
            <Button actionId="launch.continue" emphasis="primary" fullWidth
              availability={!activeUrl ? { kind: 'disabled', reason: 'Choose a Station first' } : undefined}
              onActivate={onContinue}>
              {activeStation ? `Open ${activeStation.label}` : 'Continue'}
            </Button>
          </div>
        </div>
      </section>

      {offline && (
        <section className="mp-launch-offline" role="status">
          <Icon iconId="wifi-off" size={17} />
          <div>
            <strong>{t('mobile.launch.offlineMode')}</strong>
            <span>{t('mobile.launch.offlineBody')}</span>
            <div className="mp-launch-offline-actions">
              <Button actionId="launch.retry" emphasis="primary" density="compact"
                leading={<Icon iconId="refresh-ccw" size={14} />}>{t('mobile.ui.retry')}</Button>
              <Button actionId="launch.change" density="compact">{t('mobile.launch.changeStation')}</Button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
