import { Button, Card, Typography } from 'antd';
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
  onAddStation: () => void;
  onContinue: () => void;
  showRemovalConfirmation?: boolean;
}) {
  return (
    <main className="mp-launch-screen">
      <div className="mp-launch-topbar">
        <LanguageSwitcher />
      </div>

      <div className="mp-launch-hero">
        <img src={logo} alt="Peers Touch" className="mp-launch-hero-logo" />
      </div>

      <div className="mp-launch-body">
        <Card className="mp-launch-card" variant="borderless">
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
              Continue
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}
