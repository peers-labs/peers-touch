/**
 * Mobile Prototype — polished IM prototype for Peers-Touch.
 *
 * Entry state machine: station-selection → access-gate-chain → shell.
 * Shell tabs: Chats / Moments / Contacts / Me.
 * Chat supports full-screen thread with composer, reply, action sheet.
 */

import { useMemo, useReducer, useState } from 'react';
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
import {
  createSocialDemo,
  socialDemoReducer,
  socialEvidenceScenarios,
  type SocialEvidenceScenario,
} from './socialDemo';
import { SocialEvidenceControls } from './components/SocialEvidenceControls';
import { SearchEvidenceControls } from './components/SearchEvidenceControls';
import { emptySearchDemo, searchDemoReducer } from './searchDemo';
import { MultiDeviceDemo } from './components/MultiDeviceDemo';
import './mobilePrototype.css';

const { Text } = Typography;

type EvidenceScenario =
  | 'journey'
  | 'station-removal'
  | 'session-revoked'
  | 'long-lists'
  | 'search-controlled'
  | 'multi-device-companion'
  | 'multi-device-read-cursor'
  | BlockingEvidenceScenario
  | ShellEvidenceScenario
  | SocialEvidenceScenario;

const evidenceScenarioOptions: Array<{ label: string; value: EvidenceScenario }> = [
  { label: 'Default journey', value: 'journey' },
  { label: 'Station removal confirmation', value: 'station-removal' },
  { label: 'Station identity mismatch', value: 'station-identity-mismatch' },
  { label: 'OAuth expired', value: 'oauth-expired' },
  { label: 'Session revoked', value: 'session-revoked' },
  { label: 'Unknown write outcome', value: 'unknown-write' },
  { label: 'Command ledger full', value: 'ledger-full' },
  { label: 'Draft restored', value: 'draft-restored' },
  { label: 'Social unavailable / lifecycle retry', value: 'social-unavailable' },
  { label: 'Find People / no Federation membership', value: 'find-people-no-membership' },
  { label: 'Find People / active Federation', value: 'find-people-member' },
  { label: 'Accepted contact / Direct opening', value: 'contact-direct' },
  { label: 'Friend request / unknown outcome', value: 'request-unknown' },
  { label: 'Long lists / sample data only', value: 'long-lists' },
  { label: 'Search / controlled outcomes', value: 'search-controlled' },
  { label: 'Multi-device: sender companion', value: 'multi-device-companion' },
  { label: 'Multi-device: read cursor convergence', value: 'multi-device-read-cursor' },
];

const blockingScenarios: BlockingEvidenceScenario[] = [
  'station-identity-mismatch',
  'oauth-expired',
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
  const [socialDemo, dispatchSocialDemo] = useReducer(socialDemoReducer, evidenceScenario, createSocialDemo);
  const [searchState, dispatchSearch] = useReducer(searchDemoReducer, emptySearchDemo);
  const socialScenario = socialEvidenceScenarios.find((scenario) => scenario === evidenceScenario);
  const longLists = evidenceScenario === 'long-lists' || evidenceScenario === 'search-controlled';

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
    selectEvidenceScenario('journey');
    setLaunchState('station-selection');
    setScenes(['Launch']);
  }

  function selectEvidenceScenario(scenario: EvidenceScenario) {
    setEvidenceScenario(scenario);
    dispatchSocialDemo({ type: 'reset', scenario });
    dispatchSearch({ type: 'reset' });
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
    setScenes(
      nextState === 'station-selection'
        ? ['Launch']
        : nextState === 'shell'
          ? ['Launch', 'Auth Gate', 'Shell']
          : ['Launch', 'Auth Gate'],
    );
  }

  function renderSurface() {
    if (evidenceScenario === 'multi-device-companion' || evidenceScenario === 'multi-device-read-cursor') {
      return <MultiDeviceDemo scenario={evidenceScenario} />;
    }

    if (evidenceScenario === 'session-revoked' && activeStation) {
      return (
        <AuthGateScreen
          stationLabel={activeStation.label}
          expiredSession={{
            displayName: 'Alice Chen',
            email: 'alice@peers.social',
          }}
          onBack={handleBackToLaunch}
          onLogin={() => returnToJourney('shell')}
        />
      );
    }

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

    const shellRecovery = shellScenarios.find((scenario) => scenario === evidenceScenario);
    if ((socialScenario || shellRecovery || longLists || launchState === 'shell') && activeStation) {
      return (
        <MobileShell
          key={longLists ? evidenceScenario : socialScenario ?? 'shell'}
          stationLabel={activeStation.label}
          onChangeStation={handleBackToLaunch}
          recoveryScenario={shellRecovery}
          longLists={longLists}
          searchDemo={evidenceScenario === 'search-controlled'
            ? { state: searchState, dispatch: dispatchSearch } : undefined}
          socialScenario={socialScenario}
          socialDemo={socialDemo}
          dispatchSocialDemo={dispatchSocialDemo}
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
          onBack={handleBackToLaunch}
          onLogin={handleLogin}
        />
      );
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
              onChange={selectEvidenceScenario}
            />
          </div>
          {longLists && (
            <div className="mp-evidence-controls" role="note">
              <Text>Sample only: 240 conversations / 240 contacts / 240 pending requests / 240 members / 480 messages. No backend or native proof.</Text>
            </div>
          )}
          {evidenceScenario === 'search-controlled' && (
            <SearchEvidenceControls state={searchState} dispatch={dispatchSearch} />
          )}
          {!longLists && (socialScenario || launchState === 'shell') && (
            <SocialEvidenceControls state={socialDemo} dispatch={dispatchSocialDemo} />
          )}
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
