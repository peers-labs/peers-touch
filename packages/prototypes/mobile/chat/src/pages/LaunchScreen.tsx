import { Button } from 'antd';
import { RefreshCw, WifiOff } from 'lucide-react';
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
  onAddStation: () => void;
  onContinue: () => void;
  showRemovalConfirmation?: boolean;
  offline?: boolean;
}) {
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
            <h1 id="mp-launch-title">Connect Your Station</h1>
            <p>Choose Station</p>
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
            <Button block size="large" type="primary" disabled={!activeUrl} onClick={onContinue}>
              {activeStation ? `Open ${activeStation.label}` : 'Continue'}
            </Button>
          </div>
        </div>
      </section>

      {offline && (
        <section className="mp-launch-offline" role="status">
          <WifiOff size={17} aria-hidden="true" />
          <div>
            <strong>Offline mode</strong>
            <span>No network connection. Retry or choose another Station.</span>
            <div className="mp-launch-offline-actions">
              <Button type="primary" size="small" icon={<RefreshCw size={14} />}>Retry</Button>
              <Button size="small">Change Station</Button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
