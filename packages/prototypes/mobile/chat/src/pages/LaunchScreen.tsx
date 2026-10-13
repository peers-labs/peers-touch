import { Button, Card, Typography } from 'antd';
import { LockKeyhole, RadioTower } from 'lucide-react';
import type { StationEntry } from '../types';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { StationSelector } from '../components/StationSelector';
import logo from '../assets/logo.png';

const { Text } = Typography;

export function LaunchScreen({
  stations, activeUrl, onSelectStation, onRemoveStation, onAddStation, onContinue,
  showRemovalConfirmation = false,
}: {
  stations: StationEntry[];
  activeUrl: string;
  onSelectStation: (url: string) => void;
  onRemoveStation: (url: string) => void;
  onAddStation: (url: string) => void;
  onContinue: () => void;
  showRemovalConfirmation?: boolean;
}) {
  const activeStation = stations.find((station) => station.url === activeUrl);
  const canContinue = activeStation?.online === true;

  return (
    <main className="mp-launch-screen">
      <div className="mp-access-network" aria-hidden="true">
        <span /><span /><span /><span /><span /><span />
      </div>
      <div className="mp-launch-topbar">
        <LanguageSwitcher />
      </div>

      <div className="mp-launch-body">
        <Card className="mp-launch-card" variant="borderless">
          <section className="mp-launch-brand">
            <img src={logo} alt="Peers Touch" className="mp-launch-hero-logo" />
            <div>
              <h1>Choose your Station</h1>
              <Text type="secondary">Your Station hosts your account and connects Peers Touch.</Text>
            </div>
          </section>
          <StationSelector
            entries={stations}
            activeUrl={activeUrl}
            onSelect={onSelectStation}
            onRemove={onRemoveStation}
            onAdd={onAddStation}
            showRemovalConfirmation={showRemovalConfirmation}
          />
          <div className="mp-launch-actions">
            <Button block size="large" type="primary" disabled={!canContinue} onClick={onContinue}>
              {activeStation?.online === undefined ? 'Verifying Station...' : 'Continue'}
            </Button>
          </div>
          <div className="mp-launch-trust">
            <LockKeyhole size={13} />
            <span>The selected Station is verified before sign-in.</span>
          </div>
        </Card>
      </div>
      <div className="mp-access-status">
        <RadioTower size={13} />
        Federated network ready
      </div>
    </main>
  );
}
