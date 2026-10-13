/**
 * Mobile Prototype — polished IM prototype for Peers-Touch.
 *
 * Entry state machine: station-selection → access-gate-chain → shell.
 * Shell tabs: Chats / Moments / Contacts / Me.
 * Chat supports full-screen thread with composer, reply, action sheet.
 */

import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import { ConfigProvider, Segmented, Select, Typography, theme as antdTheme } from 'antd';
import type { LaunchState, MobileUiEvidence, StationEntry } from './types';
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
import {
  callEvidenceScenarioOptions,
  isPrototypeCallScenario,
  type PrototypeCallScenario,
} from './callPrototype';
import {
  createAntdTokenTheme,
  createDesignTokenCssVariables,
  type DesignThemeMode,
} from '../../../shared/design-tokens';
import './mobilePrototype.css';

const { Text } = Typography;

type EvidenceScenario =
  | 'journey'
  | 'chat-delivery-recovery'
  | 'station-removal'
  | 'session-revoked'
  | 'long-lists'
  | 'search-controlled'
  | BlockingEvidenceScenario
  | ShellEvidenceScenario
  | SocialEvidenceScenario
  | PrototypeCallScenario
  | MobileUiScenario;

type MobileUiScenario =
  | 'chat-default'
  | 'chat-list-loading'
  | 'chat-list-refreshing'
  | 'chat-list-empty'
  | 'chat-list-error'
  | 'chat-thread-loading'
  | 'chat-history-loading'
  | 'chat-thread-error'
  | 'chat-unknown-outcome'
  | 'avatar-loading'
  | 'avatar-fallback'
  | 'long-content'
  | 'content-projection';

const evidenceScenarioOptions: Array<{ label: string; value: EvidenceScenario }> = [
  { label: 'Default journey', value: 'journey' },
  { label: 'Chat / delivery recovery', value: 'chat-delivery-recovery' },
  { label: 'Station removal confirmation', value: 'station-removal' },
  { label: 'Station identity mismatch', value: 'station-identity-mismatch' },
  { label: 'OAuth expired', value: 'oauth-expired' },
  { label: 'Session revoked', value: 'session-revoked' },
  { label: 'Unknown write outcome', value: 'unknown-write' },
  { label: 'Command ledger full', value: 'ledger-full' },
  { label: 'Draft restored', value: 'draft-restored' },
  { label: 'Social unavailable / lifecycle retry', value: 'social-unavailable' },
  { label: 'Conversation unavailable / lifecycle retry', value: 'social-detail-unavailable' },
  { label: 'Find People / no Federation membership', value: 'find-people-no-membership' },
  { label: 'Find People / active Federation', value: 'find-people-member' },
  { label: 'Accepted contact / Direct opening', value: 'contact-direct' },
  { label: 'Friend request / unknown outcome', value: 'request-unknown' },
  { label: 'Long lists / sample data only', value: 'long-lists' },
  { label: 'Search / controlled outcomes', value: 'search-controlled' },
  { label: 'UI / clean default shell', value: 'chat-default' },
  { label: 'UI / conversation first load', value: 'chat-list-loading' },
  { label: 'UI / cached conversation refresh', value: 'chat-list-refreshing' },
  { label: 'UI / empty conversation list', value: 'chat-list-empty' },
  { label: 'UI / cached conversation error', value: 'chat-list-error' },
  { label: 'UI / thread first load', value: 'chat-thread-loading' },
  { label: 'UI / older history loading', value: 'chat-history-loading' },
  { label: 'UI / thread route unavailable', value: 'chat-thread-error' },
  { label: 'UI / unknown delivery outcome', value: 'chat-unknown-outcome' },
  { label: 'UI / avatar loading', value: 'avatar-loading' },
  { label: 'UI / avatar fallback', value: 'avatar-fallback' },
  { label: 'UI / long localized content', value: 'long-content' },
  { label: 'UI / human content & trust slots', value: 'content-projection' },
  ...callEvidenceScenarioOptions,
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

const mobileUiScenarios: MobileUiScenario[] = [
  'chat-default',
  'chat-list-loading',
  'chat-list-refreshing',
  'chat-list-empty',
  'chat-list-error',
  'chat-thread-loading',
  'chat-history-loading',
  'chat-thread-error',
  'chat-unknown-outcome',
  'avatar-loading',
  'avatar-fallback',
  'long-content',
  'content-projection',
];

function resolveMobileUiEvidence(scenario: EvidenceScenario): MobileUiEvidence {
  return {
    avatarState: scenario === 'avatar-loading'
      ? 'loading'
      : scenario === 'avatar-fallback'
        ? 'failed'
        : 'ready',
    chatListState: scenario === 'chat-list-loading'
      ? 'initial-loading'
      : scenario === 'chat-list-refreshing'
        ? 'refreshing'
        : scenario === 'chat-list-empty'
          ? 'empty'
          : scenario === 'chat-list-error'
            ? 'cached-error'
            : 'ready',
    chatThreadState: scenario === 'chat-thread-loading'
      ? 'initial-loading'
      : scenario === 'chat-history-loading'
        ? 'history-loading'
        : scenario === 'chat-thread-error'
          ? 'route-error'
          : scenario === 'chat-unknown-outcome'
            ? 'unknown-outcome'
            : 'ready',
    longContent: scenario === 'long-content',
  };
}

function getInitialEvidenceScenario(): EvidenceScenario {
  const scenario = new URLSearchParams(window.location.search).get('scenario');
  return evidenceScenarioOptions.some((option) => option.value === scenario)
    ? scenario as EvidenceScenario
    : 'journey';
}

export function MobilePrototype() {
  const [launchState, setLaunchState] = useState<LaunchState>('station-selection');
  const [stations, setStations] = useState<StationEntry[]>(
    () => demoStations.map((station) => ({ ...station, online: undefined })),
  );
  const [activeUrl, setActiveUrl] = useState('http://localhost:9000');
  const verificationTimers = useRef<Map<string, number>>(new Map());
  const [scenes, setScenes] = useState<string[]>(['Launch']);
  const [evidenceScenario, setEvidenceScenario] = useState<EvidenceScenario>(
    getInitialEvidenceScenario,
  );
  const [themeMode, setThemeMode] = useState<DesignThemeMode>('light');
  const [socialDemo, dispatchSocialDemo] = useReducer(socialDemoReducer, evidenceScenario, createSocialDemo);
  const [searchState, dispatchSearch] = useReducer(searchDemoReducer, emptySearchDemo);
  const socialScenario = socialEvidenceScenarios.find((scenario) => scenario === evidenceScenario);
  const callScenario = isPrototypeCallScenario(evidenceScenario)
    ? evidenceScenario
    : undefined;
  const longLists = evidenceScenario === 'long-lists' || evidenceScenario === 'search-controlled';
  const mobileUiEvidence = useMemo(
    () => resolveMobileUiEvidence(evidenceScenario),
    [evidenceScenario],
  );
  const isMobileUiScenario = mobileUiScenarios.includes(evidenceScenario as MobileUiScenario);
  const theme = useMemo(() => ({
    ...createAntdTokenTheme(themeMode),
    algorithm: themeMode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
  }), [themeMode]);
  const cssVariables = useMemo(
    () => createDesignTokenCssVariables(themeMode) as CSSProperties,
    [themeMode],
  );

  const activeStation = useMemo(
    () => stations.find((s) => s.url === activeUrl),
    [stations, activeUrl],
  );

  useEffect(() => {
    beginStationVerification(activeUrl);
    return () => {
      verificationTimers.current.forEach((timer) => window.clearTimeout(timer));
      verificationTimers.current.clear();
    };
  }, []);

  function beginStationVerification(url: string) {
    if (!url) return;
    const existingTimer = verificationTimers.current.get(url);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);
    setStations((previous) => previous.map((station) => (
      station.url === url ? { ...station, online: undefined } : station
    )));
    const timer = window.setTimeout(() => {
      setStations((previous) => previous.map((station) => (
        station.url === url ? { ...station, online: true } : station
      )));
      verificationTimers.current.delete(url);
    }, 700);
    verificationTimers.current.set(url, timer);
  }

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
    const station = stations.find((entry) => entry.url === url);
    if (station?.online !== true) beginStationVerification(url);
  }

  function handleRemoveStation(url: string) {
    setStations((prev) => prev.filter((s) => s.url !== url));
    if (activeUrl === url) {
      const remaining = stations.filter((s) => s.url !== url);
      setActiveUrl(remaining.length > 0 ? remaining[0].url : '');
    }
  }

  function handleAddStation(url: string) {
    if (!stations.find((station) => station.url === url)) {
      const label = url.replace(/^https?:\/\//, '').split(/[/:]/)[0]
        .split('.')
        .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
        .join(' ');
      setStations((previous) => [...previous, {
        url,
        label: label || 'New Station',
        online: undefined,
      }]);
      setActiveUrl(url);
      beginStationVerification(url);
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
    if ((socialScenario || shellRecovery || callScenario || longLists || isMobileUiScenario || evidenceScenario === 'chat-delivery-recovery' || launchState === 'shell') && activeStation) {
      return (
        <MobileShell
          key={longLists || callScenario || isMobileUiScenario || evidenceScenario === 'chat-delivery-recovery'
            ? evidenceScenario
            : socialScenario ?? 'shell'}
          stationLabel={activeStation.label}
          onChangeStation={handleBackToLaunch}
          recoveryScenario={shellRecovery}
          longLists={longLists}
          focusChatJourney={evidenceScenario === 'chat-delivery-recovery'}
          uiEvidence={mobileUiEvidence}
          deliveryRecovery={evidenceScenario === 'chat-delivery-recovery'}
          contentProjection={evidenceScenario === 'content-projection'}
          callScenario={callScenario}
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
    <ConfigProvider theme={theme}>
      <div
        className="mobile-prototype-scope"
        data-theme={themeMode}
        style={cssVariables}
      >
        <div className="mp-workbench">
          <div className="mp-evidence-toolbar">
            <Text strong>Evidence scenario</Text>
            <Select
              aria-label="Evidence scenario"
              value={evidenceScenario}
              options={evidenceScenarioOptions}
              onChange={selectEvidenceScenario}
            />
            <Text strong>Theme</Text>
            <Segmented
              aria-label="Preview theme"
              value={themeMode}
              options={[
                { label: 'Light', value: 'light' },
                { label: 'Dark', value: 'dark' },
              ]}
              onChange={(value) => setThemeMode(value as DesignThemeMode)}
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
