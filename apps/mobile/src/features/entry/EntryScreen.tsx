import { useEffect, useState } from 'react';
import { Button, Spin } from 'antd';
import { PencilLine, ScanLine } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import logo from '../../assets/logo.png';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import type { AuthRuntimeSnapshot } from '../../runtimes/authRuntime';
import { AccessGateHost } from '../auth/AccessGateHost';
import type {
  AccessDecision,
  RememberedLoginAccount,
  StationLoginInput,
} from '../auth/authSession';
import {
  StationSelector,
  stationAvailabilityState,
  type StationSelectorSurfaceFixture,
} from '../station/StationSelector';
import { stationDisplayName } from '../station/stationDisplayName';
import {
  activeStationEntry,
  type StoredStationRegistry,
} from '../station/stationRegistry';
import type { XConfigSuggestion } from '../../services/mobileCommands';

export interface EntryGateProps {
  decision: AccessDecision | null;
  stationLabel: string;
  stationUrl: string;
  error: string | null;
  loading: boolean;
  rememberedAccounts: RememberedLoginAccount[];
  oauthOverride?: Partial<AuthRuntimeSnapshot>;
  forceSessionExpired?: boolean;
  onBack: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onLogin: (input: Omit<StationLoginInput, 'stationPeerId' | 'stationUrl'>) => Promise<void>;
  onInviteCode: (code: string) => Promise<void>;
  onSchemaSubmit: (values: Record<string, string | boolean | number>) => Promise<void>;
}

export function EntryScreen({
  registry,
  error,
  checking,
  verifyingUrls,
  checkedUrls,
  suggestions,
  surfaceFixture,
  handshake = false,
  gate = null,
  onAddStation,
  onSelectSuggestion,
  onSelectStation,
  onRemoveStation,
  onContinue,
  onScan,
}: {
  registry: StoredStationRegistry;
  error: string | null;
  checking: boolean;
  verifyingUrls: string[];
  checkedUrls: string[];
  suggestions: XConfigSuggestion[];
  surfaceFixture?: StationSelectorSurfaceFixture;
  handshake?: boolean;
  gate?: EntryGateProps | null;
  onAddStation: (stationUrl: string) => boolean | Promise<boolean>;
  onSelectSuggestion: (seedId: string) => boolean | Promise<boolean>;
  onSelectStation: (stationPeerId: string) => void | Promise<void>;
  onRemoveStation: (stationPeerId: string) => void;
  onContinue: () => void | Promise<void>;
  onScan?: () => void;
}) {
  const { t } = useMobileI18n();
  const activeStation = activeStationEntry(registry);
  const [changing, setChanging] = useState(false);

  // A fresh gate attempt means the picked Station is active again; collapse
  // the inline Station list without an extra round trip.
  useEffect(() => {
    if (gate?.decision?.attemptId) setChanging(false);
  }, [gate?.decision?.attemptId]);

  const activeStationDisplayName = activeStation
    ? stationDisplayName(
        activeStation.label,
        activeStation.url,
        t('common.stationPicker.fallbackLabel'),
      )
    : null;
  const gateActive = Boolean(gate?.decision) && !changing;
  const showSelector = !gate?.decision || changing;
  const verifyingActive = Boolean(
    activeStation && verifyingUrls.includes(activeStation.url),
  );
  const activeStatus = activeStation
    ? stationAvailabilityState(
        activeStation,
        verifyingUrls.includes(activeStation.url),
        checkedUrls.includes(activeStation.url),
      )
    : 'unknown';

  return (
    <main
      className="launch-screen entry-screen"
      data-product-surface={
        gateActive ? 'entry.access-gate' : 'entry.station-selection'
      }
    >
      <div className="launch-topbar entry-topbar">
        {onScan ? (
          <button
            type="button"
            className="entry-scan-button"
            aria-label={t('mobile.deviceLink.scan')}
            title={t('mobile.deviceLink.scan')}
            onClick={onScan}
          >
            <ScanLine size={19} aria-hidden="true" />
          </button>
        ) : null}
        <LanguageSwitcher />
      </div>

      <section className="launch-content" aria-labelledby="entry-title">
        <header className="launch-brand">
          <img src={logo} alt="Peers Touch" className="launch-brand-logo" />
          <div className="launch-brand-copy">
            <h1 id="entry-title">{t('mobile.launch.title')}</h1>
            {activeStation && activeStationDisplayName ? (
              <p className="launch-active-target">
                <span className="launch-active-target-name">
                  {activeStationDisplayName}
                </span>
                <span className="launch-active-target-origin">
                  {displayStationOrigin(activeStation.url)}
                </span>
              </p>
            ) : null}
          </div>
        </header>

        {activeStation && gate?.decision && !changing ? (
          <div
            className="entry-active-station"
            data-product-surface="entry.active-station-summary"
          >
            <span className="entry-active-station-copy">
              <span className="entry-active-station-name">
                {activeStationDisplayName}
              </span>
              <span className={`entry-active-station-status ${activeStatus}`}>
                {verifyingActive || checking
                  ? t('mobile.launch.validating')
                  : activeStatus === 'online'
                    ? t('mobile.launch.verified')
                    : activeStatus === 'offline'
                      ? t('mobile.launch.unavailable')
                      : t('mobile.launch.unknown')}
              </span>
            </span>
            <button
              type="button"
              className="entry-change-station"
              data-entry-action="change-station"
              disabled={checking}
              onClick={() => setChanging(true)}
            >
              <PencilLine size={14} aria-hidden="true" />
              {t('mobile.launch.changeStation')}
            </button>
          </div>
        ) : null}

        {handshake && !gate?.decision ? (
          <div className="entry-handshake" role="status">
            <Spin size="small" />
            <span>{t('mobile.launch.validating')}</span>
          </div>
        ) : null}

        {showSelector ? (
          <div className="launch-panel">
            <StationSelector
              activeStationPeerId={registry.activeStationPeerId}
              entries={registry.entries}
              error={error}
              checking={checking}
              verifyingUrls={verifyingUrls}
              checkedUrls={checkedUrls}
              suggestions={suggestions}
              surfaceFixture={surfaceFixture}
              onAdd={onAddStation}
              onSelectSuggestion={onSelectSuggestion}
              onSelect={onSelectStation}
              onRemove={onRemoveStation}
              onScan={undefined}
            />
            {!gate?.decision ? (
              <div className="launch-actions">
                <Button
                  block
                  size="large"
                  type="primary"
                  loading={checking}
                  disabled={!activeStation || !checkedUrls.includes(activeStation?.url ?? '')
                    || verifyingUrls.includes(activeStation?.url ?? '')}
                  onClick={onContinue}
                >
                  {t('mobile.launch.continue')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {gateActive && gate ? (
          <AccessGateHost
            embedded
            decision={gate.decision}
            stationLabel={gate.stationLabel}
            stationUrl={gate.stationUrl}
            error={gate.error}
            loading={gate.loading}
            rememberedAccounts={gate.rememberedAccounts}
            oauthOverride={gate.oauthOverride}
            forceSessionExpired={gate.forceSessionExpired}
            onBack={gate.onBack}
            onRefresh={gate.onRefresh}
            onLogin={gate.onLogin}
            onInviteCode={gate.onInviteCode}
            onSchemaSubmit={gate.onSchemaSubmit}
          />
        ) : null}
      </section>
    </main>
  );
}

function displayStationOrigin(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
