import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, Icon, IconButton, Spin, Text, TextField } from '@peers-touch/ui';

import { useMobileI18n } from '../../app/mobileI18n';
import {
  buildStationUrl,
  type MobileStationEntry,
} from './stationRegistry';
import { stationDisplayName } from './stationDisplayName';
import type { XConfigSuggestion } from '../../services/mobileCommands';

export type StationSelectorSurfaceFixture =
  | 'address'
  | 'address-invalid'
  | 'remove-confirm';

export function StationSelector({
  activeStationPeerId,
  entries,
  error,
  checking,
  verifyingUrls,
  checkedUrls,
  suggestions,
  surfaceFixture,
  onAdd,
  onSelectSuggestion,
  onSelect,
  onRemove,
  onScan,
}: {
  activeStationPeerId: string;
  entries: MobileStationEntry[];
  error: string | null;
  checking: boolean;
  verifyingUrls: string[];
  checkedUrls: string[];
  suggestions: XConfigSuggestion[];
  surfaceFixture?: StationSelectorSurfaceFixture;
  onAdd: (stationUrl: string) => boolean | Promise<boolean>;
  onSelectSuggestion: (seedId: string) => boolean | Promise<boolean>;
  onSelect: (stationPeerId: string) => void | Promise<void>;
  onRemove: (stationPeerId: string) => void;
  onScan?: () => void;
}) {
  const { t } = useMobileI18n();
  const [stationUrl, setStationUrl] = useState(() => (
    surfaceFixture === 'address'
      ? 'http://station.local:18280'
      : surfaceFixture === 'address-invalid'
        ? 'station.local'
        : ''
  ));
  const [addingStation, setAddingStation] = useState(
    surfaceFixture === 'address' || surfaceFixture === 'address-invalid',
  );
  const [pendingRemoval, setPendingRemoval] = useState<MobileStationEntry | null>(null);
  const [selectingSuggestionId, setSelectingSuggestionId] = useState<string | null>(null);
  const [failedSuggestionId, setFailedSuggestionId] = useState<string | null>(null);
  const hasEntries = entries.length > 0;
  const showStationInput = !hasEntries || addingStation;
  const normalizedUrl = useMemo(() => buildStationUrl(stationUrl), [stationUrl]);
  const canAdd = Boolean(normalizedUrl);
  const visibleSuggestions = visibleXConfigSuggestions(entries, suggestions);

  useEffect(() => {
    if (surfaceFixture === 'remove-confirm' && entries[0]) {
      setPendingRemoval(entries[0]);
    }
  }, [entries, surfaceFixture]);

  async function submit() {
    if (!normalizedUrl || checking) return;
    const added = await onAdd(normalizedUrl);
    if (added) {
      setStationUrl('');
      if (hasEntries) setAddingStation(false);
    }
  }

  function closeStationInput() {
    setStationUrl('');
    setAddingStation(false);
  }

  function confirmStationRemoval() {
    if (!pendingRemoval) return;
    onRemove(pendingRemoval.stationPeerId);
    setPendingRemoval(null);
  }

  async function selectSuggestion(suggestion: XConfigSuggestion) {
    if (!suggestion.actionable || selectingSuggestionId) return;
    setSelectingSuggestionId(suggestion.seedId);
    setFailedSuggestionId(null);
    try {
      const accepted = await onSelectSuggestion(suggestion.seedId);
      if (!accepted) setFailedSuggestionId(suggestion.seedId);
    } catch {
      setFailedSuggestionId(suggestion.seedId);
    } finally {
      setSelectingSuggestionId(null);
    }
  }

  const showsHttpWarning = surfaceFixture === 'address'
    || buildStationUrl(stationUrl)?.startsWith('http://');

  const pendingRemovalLabel = pendingRemoval
    ? stationDisplayName(
      pendingRemoval.label,
      pendingRemoval.url,
      t('common.stationPicker.fallbackLabel'),
    )
    : '';

  return (
    <section className="station-selector">
      {onScan ? (
        <Button
          actionId="station-scan"
          className="station-scan-entry"
          fullWidth
          leading={<Icon iconId="scan-line" size={20} />}
          availability={checking
            ? { kind: 'disabled', reason: t('mobile.deviceLink.scan') }
            : undefined}
          onActivate={onScan}
        >
          {t('mobile.deviceLink.scan')}
        </Button>
      ) : null}
      <div className="station-selector-header">
        <div>
          <Text strong>{t('mobile.launch.station')}</Text>
          {hasEntries && !showStationInput ? (
            <Text className="station-helper-line">
              {activeStationPeerId
                ? t('mobile.launch.changeTarget')
                : t('mobile.launch.chooseRecent')}
            </Text>
          ) : null}
        </div>
        <span className={`station-selection-state ${activeStationPeerId ? 'selected' : ''}`}>
          {activeStationPeerId ? t('mobile.launch.selected') : t('mobile.launch.required')}
        </span>
      </div>

      {showStationInput ? (
        <div className={`station-input-row ${hasEntries ? 'with-cancel' : ''}`}>
          <div
            className="station-url-field"
            data-product-surface={
              surfaceFixture === 'address-invalid'
                ? 'entry.station-address-invalid'
                : 'entry.station-address'
            }
          >
            <TextField
              className="station-address-field"
              data-acceptance-id="station-address-input"
              value={stationUrl}
              placeholder={t('mobile.launch.placeholder')}
              aria-label={t('common.stationPicker.inputLabel')}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              onValueChange={setStationUrl}
              onEnter={() => void submit()}
              trailing={
                <IconButton
                  actionId="station.submit"
                  iconId="plus"
                  iconSize={17}
                  label={t('mobile.launch.addStation')}
                  emphasis="quiet"
                  execution={checking ? 'pending' : 'idle'}
                  availability={!canAdd || checking
                    ? { kind: 'disabled', reason: t('mobile.launch.addStation') }
                    : undefined}
                  onActivate={() => void submit()}
                />
              }
            />
          </div>
          {hasEntries ? (
            <IconButton
              actionId="station.input-cancel"
              iconId="close"
              iconSize={16}
              label={t('common.action.cancel')}
              emphasis="quiet"
              onActivate={closeStationInput}
            />
          ) : null}
        </div>
      ) : null}

      {showStationInput && showsHttpWarning ? (
        <Text className="station-field-helper warning">
          <Icon iconId="warning" size={12} />
          <span>{t('mobile.launch.helperHttpWarning')}</span>
        </Text>
      ) : null}

      {error ? (
        <Text tone="danger" className="station-error" role="alert">
          {error}
        </Text>
      ) : null}

      <div className="station-list">
        {entries.length === 0 && visibleSuggestions.length === 0 ? (
          <div
            className="station-empty"
            data-product-surface="entry.station-empty"
          >
            <Icon iconId="server" size={18} />
            <Text tone="secondary">{t('mobile.launch.emptyStations')}</Text>
          </div>
        ) : (
          entries.map((entry) => {
            const isActive = entry.stationPeerId === activeStationPeerId;
            const status = getStationStatus(
              entry,
              verifyingUrls.includes(entry.url),
              checkedUrls.includes(entry.url),
              t,
            );
            const displayName = stationDisplayName(
              entry.label,
              entry.url,
              t('common.stationPicker.fallbackLabel'),
            );
            const surfaceId = status.className === 'validating'
              ? 'entry.station-verifying'
              : status.className === 'offline'
                ? 'entry.station-unavailable'
                : undefined;
            return (
              <div
                key={entry.stationPeerId}
                className={`station-entry ${isActive ? 'active' : ''}`}
                data-product-surface={surfaceId}
              >
                <button
                  type="button"
                  className="station-entry-main"
                  aria-pressed={isActive}
                  onClick={() => onSelect(entry.stationPeerId)}
                >
                  <Icon iconId="server" size={18} />
                  <span className="station-entry-copy">
                    <Text strong={isActive} className="mobile-truncate">{displayName}</Text>
                  </span>
                  <span className={`station-entry-status ${status.className}`}>
                    {status.label}
                  </span>
                  <span className="station-entry-check" aria-hidden="true">
                    {isActive ? <Icon iconId="check" size={16} /> : null}
                  </span>
                </button>
                <button
                  type="button"
                  className="station-remove"
                  aria-label={t('common.action.delete')}
                  data-entry-action="remove-station"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPendingRemoval(entry);
                  }}
                >
                  <Icon iconId="delete" size={15} />
                </button>
              </div>
            );
          })
        )}
        {visibleSuggestions.length > 0 ? (
          <>
            <div className="station-suggestion-heading">
              {t('common.stationPicker.suggestions')}
            </div>
            {visibleSuggestions.map((suggestion) => {
              const selecting = selectingSuggestionId === suggestion.seedId;
              const failed = failedSuggestionId === suggestion.seedId;
              const status = failed
                ? t('common.stationPicker.suggestionInvalid')
                : suggestion.freshness === 'stale'
                  ? t('common.stationPicker.suggestionStale')
                  : t('common.stationPicker.suggested');
              return (
                <button
                  type="button"
                  key={suggestion.seedId}
                  className={`station-suggestion ${failed ? 'failed' : ''}`}
                  data-x-config-seed-id={suggestion.seedId}
                  data-x-config-freshness={suggestion.freshness}
                  disabled={!suggestion.actionable || selecting}
                  onClick={() => void selectSuggestion(suggestion)}
                >
                  {selecting
                    ? <Spin size="small" />
                    : suggestion.kind === 'relay'
                      ? <Icon iconId="radio-tower" size={18} />
                      : <Icon iconId="cloud" size={18} />}
                  <span className="station-entry-copy">
                    <Text strong className="mobile-truncate">{suggestion.displayName}</Text>
                    <Text tone="secondary" className="mobile-truncate">
                      {suggestion.canonicalOrigin}
                    </Text>
                  </span>
                  <span className={`station-entry-status ${failed ? 'offline' : ''}`} aria-live={failed ? 'polite' : undefined}>
                    {status}
                  </span>
                </button>
              );
            })}
          </>
        ) : null}
      </div>

      {hasEntries && !addingStation ? (
        <Button
          actionId="station-add-secondary"
          className="station-add-secondary"
          emphasis="quiet"
          leading={<Icon iconId="plus" size={15} />}
          onActivate={() => setAddingStation(true)}
        >
          {t('mobile.launch.addStation')}
        </Button>
      ) : null}

      <Dialog
        open={pendingRemoval !== null}
        onDismiss={() => setPendingRemoval(null)}
        title={t('common.stationPicker.removeLabel', { station: pendingRemovalLabel })}
        closeLabel={t('common.action.cancel')}
      >
        <section
          className="entry-confirmation"
          data-product-surface="entry.station-remove-confirm"
        >
          <Text tone="secondary">{t('mobile.launch.stationRemoveBody')}</Text>
          <div className="entry-confirmation-actions">
            <button
              type="button"
              className="entry-confirmation-button"
              onClick={() => setPendingRemoval(null)}
            >
              {t('common.action.cancel')}
            </button>
            <button
              type="button"
              className="entry-confirmation-button danger"
              onClick={confirmStationRemoval}
            >
              {t('common.action.delete')}
            </button>
          </div>
        </section>
      </Dialog>
    </section>
  );
}

export function stationAvailabilityState(
  entry: MobileStationEntry,
  verifying: boolean,
  checked: boolean,
): 'validating' | 'unknown' | 'online' | 'offline' {
  if (verifying) return 'validating';
  if (!checked) return 'unknown';
  return entry.online ? 'online' : 'offline';
}

export function visibleXConfigSuggestions(
  entries: MobileStationEntry[],
  suggestions: XConfigSuggestion[],
): XConfigSuggestion[] {
  const verifiedOrigins = new Set(
    entries.flatMap((entry) => (
      entry.routes?.length
        ? entry.routes.map((route) => route.endpointOrigin)
        : [entry.url]
    )),
  );
  return suggestions.filter(
    (suggestion) => !verifiedOrigins.has(suggestion.canonicalOrigin),
  );
}

function getStationStatus(
  entry: MobileStationEntry,
  verifying: boolean,
  checked: boolean,
  t: (key: string) => string,
): { className: string; label: string } {
  const state = stationAvailabilityState(entry, verifying, checked);

  if (verifying) {
    return { className: 'validating', label: t('mobile.launch.validating') };
  }

  if (!checked) {
    return { className: 'unknown', label: t('mobile.launch.unknown') };
  }

  if (state === 'online') {
    return { className: 'online', label: t('mobile.launch.verified') };
  }

  return { className: 'offline', label: t('mobile.launch.unavailable') };
}
