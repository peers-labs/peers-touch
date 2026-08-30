/**
 * Mobile Prototype — polished IM prototype for Peers-Touch.
 *
 * Entry state machine: station-selection → access-gate-chain → shell.
 * Shell tabs: Chats / Moments / Contacts / Me.
 * Chat supports full-screen thread with composer, reply, action sheet.
 */

import { useMemo, useState } from 'react';
import { ConfigProvider, Select, Typography } from 'antd';
import type { LaunchState, StationEntry } from './types';
import { demoStations } from './data';
import {
  BlockingRecoveryScreen,
  type BlockingEvidenceScenario,
  type ShellEvidenceScenario,
} from './components/ExperienceRecovery';
import { LaunchScreen } from './pages/LaunchScreen';
import { AuthGateScreen } from './pages/AuthGateScreen';
import { MobileShell } from './MobileShell';
import './mobilePrototype.css';

const { Text } = Typography;

type EvidenceScenario =
  | 'journey'
  | 'station-removal'
  | BlockingEvidenceScenario
  | ShellEvidenceScenario;

const evidenceScenarioOptions: Array<{ label: string; value: EvidenceScenario }> = [
  { label: 'Default journey', value: 'journey' },
  { label: 'Station removal confirmation', value: 'station-removal' },
  { label: 'Station identity mismatch', value: 'station-identity-mismatch' },
  { label: 'OAuth expired', value: 'oauth-expired' },
  { label: 'Session revoked', value: 'session-revoked' },
  { label: 'Unknown write outcome', value: 'unknown-write' },
  { label: 'Command ledger full', value: 'ledger-full' },
  { label: 'Draft restored', value: 'draft-restored' },
];

const blockingScenarios: BlockingEvidenceScenario[] = [
  'station-identity-mismatch',
  'oauth-expired',
  'session-revoked',
];

const shellScenarios: ShellEvidenceScenario[] = [
  'unknown-write',
  'ledger-full',
  'draft-restored',
];

function getInitialEvidenceScenario(): EvidenceScenario {
  const scenario = new URLSearchParams(window.location.search).get('scenario');
  return evidenceScenarioOptions.some((option) => option.value === scenario)
    ? scenario as EvidenceScenario
    : 'journey';
}

// ── antd theme ─────────────────────────────────────────────────
const antdTheme = {
  token: {
    colorPrimary: '#6366f1',
    colorInfo: '#6366f1',
    borderRadius: 10,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif",
    colorBgContainer: '#ffffff',
  },
  components: {
    Button: { borderRadius: 10, controlHeight: 40, fontWeight: 600 },
    Input: { borderRadius: 10, controlHeight: 40 },
    Card: { borderRadiusLG: 16 },
    List: { paddingContentHorizontalLG: 0 },
  },
};

export function MobilePrototype() {
  const [launchState, setLaunchState] = useState<LaunchState>('station-selection');
  const [stations, setStations] = useState<StationEntry[]>(demoStations);
  const [activeUrl, setActiveUrl] = useState('http://localhost:9000');
  const [scenes, setScenes] = useState<string[]>(['Launch']);
  const [evidenceScenario, setEvidenceScenario] = useState<EvidenceScenario>(
    getInitialEvidenceScenario,
  );

  const activeStation = useMemo(
    () => stations.find((s) => s.url === activeUrl),
    [stations, activeUrl],
  );

  function handleContinue() {
    setLaunchState('access-gate-chain');
    setScenes(['Launch', 'Auth Gate']);
  }

  function handleLogin() {
    setLaunchState('shell');
    setScenes(['Launch', 'Auth Gate', 'Shell']);
  }

  function handleBackToLaunch() {
    setLaunchState('station-selection');
    setScenes(['Launch']);
  }

  function handleSelectStation(url: string) {
    setActiveUrl(url);
  }

  function handleRemoveStation(url: string) {
    setStations((prev) => prev.filter((s) => s.url !== url));
    if (activeUrl === url) {
      const remaining = stations.filter((s) => s.url !== url);
      setActiveUrl(remaining.length > 0 ? remaining[0].url : '');
    }
  }

  function handleAddStation() {
    const newUrl = 'https://new-station.peers.social';
    if (!stations.find((s) => s.url === newUrl)) {
      setStations((prev) => [...prev, { url: newUrl, label: 'New Station', online: true }]);
      setActiveUrl(newUrl);
    }
  }

  function returnToJourney(nextState: LaunchState) {
    setEvidenceScenario('journey');
    setLaunchState(nextState);
    setScenes(nextState === 'station-selection' ? ['Launch'] : ['Launch', 'Auth Gate']);
  }

  function renderSurface() {
    if (blockingScenarios.includes(evidenceScenario as BlockingEvidenceScenario)) {
      return (
        <BlockingRecoveryScreen
          scenario={evidenceScenario as BlockingEvidenceScenario}
          onPrimary={() => returnToJourney(
            evidenceScenario === 'station-identity-mismatch' ? 'station-selection' : 'access-gate-chain',
          )}
          onSecondary={() => returnToJourney(
            evidenceScenario === 'oauth-expired' ? 'access-gate-chain' : 'station-selection',
          )}
        />
      );
    }

    if (shellScenarios.includes(evidenceScenario as ShellEvidenceScenario) && activeStation) {
      return (
        <MobileShell
          stationLabel={activeStation.label}
          onChangeStation={handleBackToLaunch}
          recoveryScenario={evidenceScenario as ShellEvidenceScenario}
          onRecoveryClose={() => {
            setLaunchState('shell');
            setScenes(['Launch', 'Auth Gate', 'Shell']);
            setEvidenceScenario('journey');
          }}
        />
      );
    }

    if (launchState === 'station-selection') {
      return (
        <LaunchScreen
          stations={stations}
          activeUrl={activeUrl}
          onSelectStation={handleSelectStation}
          onRemoveStation={handleRemoveStation}
          onAddStation={handleAddStation}
          onContinue={handleContinue}
          showRemovalConfirmation={evidenceScenario === 'station-removal'}
        />
      );
    }

    if (launchState === 'access-gate-chain' && activeStation) {
      return (
        <AuthGateScreen
          stationLabel={activeStation.label}
          stationUrl={activeStation.url}
          onBack={handleBackToLaunch}
          onLogin={handleLogin}
        />
      );
    }

    if (launchState === 'shell' && activeStation) {
      return <MobileShell stationLabel={activeStation.label} onChangeStation={handleBackToLaunch} />;
    }

    return null;
  }

  return (
    <ConfigProvider theme={antdTheme}>
      <div className="mobile-prototype-scope">
        <div className="mp-workbench">
          <div className="mp-evidence-toolbar">
            <Text strong>Evidence scenario</Text>
            <Select
              aria-label="Evidence scenario"
              value={evidenceScenario}
              options={evidenceScenarioOptions}
              onChange={(value) => setEvidenceScenario(value)}
            />
          </div>
          <div className="mp-scene-label">
            {(evidenceScenario === 'journey' ? scenes : ['Evidence', evidenceScenario]).map(
              (scene, index) => (<span key={scene}>{index + 1}. {scene}</span>),
            )}
          </div>

          <div className="mp-device" role="region" aria-label="Mobile device preview">
            <div className="mp-status-bar">
              <span>9:41</span>
              <span className="mp-status-right">
                <span className="mp-status-text">5G</span>
                <span className="mp-status-text">100%</span>
              </span>
            </div>

            <div className="mp-app-shell">
              {renderSurface()}
            </div>
          </div>
        </div>
      </div>
    </ConfigProvider>
  );
}

export default MobilePrototype;
