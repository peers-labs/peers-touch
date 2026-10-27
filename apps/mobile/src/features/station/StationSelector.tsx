import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Typography } from 'antd';
import {
  AlertTriangle,
  Check,
  Cloud,
  LoaderCircle,
  Plus,
  RadioTower,
  Server,
  Trash2,
  X,
  ScanLine,
} from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import {
  buildStationUrl,
  type MobileStationEntry,
} from './stationRegistry';
import { stationDisplayName } from './stationDisplayName';
import type { XConfigSuggestion } from '../../services/mobileCommands';

const { Text, Title } = Typography;

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

  return (
    <section className="station-selector">
      {onScan ? (
        <Button
          className="station-scan-entry"
          block
          size="large"
          icon={<ScanLine size={20} />}
          disabled={checking}
          onClick={onScan}
        >
          {t('mobile.deviceLink.scan')}
        </Button>
      ) : null}
      <div className="station-selector-header">
        <div>
          <Text strong>{t('mobile.launch.station')}</Text>
          {hasEntries && !showStationInput ? (
            <Text className="station-helper-line">
              {t('mobile.launch.changeTarget')}
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
            className={`station-url-control ${error ? 'error' : ''}`}
            data-product-surface={
              surfaceFixture === 'address-invalid'
                ? 'entry.station-address-invalid'
                : 'entry.station-address'
            }
          >
            <Input
              className="station-address-input"
              value={stationUrl}
              placeholder={t('mobile.launch.placeholder')}
              aria-label={t('common.stationPicker.inputLabel')}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              variant="borderless"
              onChange={(event) => setStationUrl(event.target.value)}
              onPressEnter={submit}
            />
            <button
              type="button"
              className="station-submit"
              aria-label={t('mobile.launch.addStation')}
              disabled={!canAdd || checking}
              onClick={submit}
            >
              {checking
                ? <LoaderCircle className="station-submit-spinner" size={17} aria-hidden="true" />
                : <Plus size={17} aria-hidden="true" />}
            </button>
          </div>
          {hasEntries ? (
            <Button
              className="station-input-cancel"
              icon={<X size={16} />}
              aria-label={t('common.action.cancel')}
              onClick={closeStationInput}
            />
          ) : null}
        </div>
      ) : null}

      {showStationInput && showsHttpWarning ? (
        <Text className="station-field-helper warning">
          <AlertTriangle size={12} aria-hidden="true" />
          <span>{t('mobile.launch.helperHttpWarning')}</span>
        </Text>
      ) : null}

      {error ? (
        <Text type="danger" className="station-error" role="alert">
          {error}
        </Text>
      ) : null}

      <div className="station-list">
        {entries.length === 0 && visibleSuggestions.length === 0 ? (
          <div
            className="station-empty"
            data-product-surface="entry.station-empty"
          >
            <Server size={18} />
            <Text type="secondary">{t('mobile.launch.emptyStations')}</Text>
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
                  <Server size={18} aria-hidden="true" />
                  <span className="station-entry-copy">
                    <Text strong={isActive} className="mobile-truncate">{displayName}</Text>
                  </span>
                  <span className={`station-entry-status ${status.className}`}>
                    {status.label}
                  </span>
                  <span className="station-entry-check" aria-hidden="true">
                    {isActive ? <Check size={16} /> : null}
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
                  <Trash2 size={15} aria-hidden="true" />
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
                    ? <LoaderCircle className="station-submit-spinner" size={18} aria-hidden="true" />
                    : suggestion.kind === 'relay'
                      ? <RadioTower size={18} aria-hidden="true" />
                      : <Cloud size={18} aria-hidden="true" />}
                  <span className="station-entry-copy">
                    <Text strong className="mobile-truncate">{suggestion.displayName}</Text>
                    <Text type="secondary" className="mobile-truncate">
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
        <Button className="station-add-secondary" type="text" icon={<Plus size={15} />} onClick={() => setAddingStation(true)}>
          {t('mobile.launch.addStation')}
        </Button>
      ) : null}

      <Modal
        open={pendingRemoval !== null}
        onCancel={() => setPendingRemoval(null)}
        footer={null}
        destroyOnClose
      >
        <section
          className="entry-confirmation"
          data-product-surface="entry.station-remove-confirm"
        >
          <Title level={1}>
            {t('common.stationPicker.removeLabel', {
              station: pendingRemoval
                ? stationDisplayName(
                    pendingRemoval.label,
                    pendingRemoval.url,
                    t('common.stationPicker.fallbackLabel'),
                  )
                : '',
            })}
          </Title>
          <Text type="secondary">{t('mobile.launch.stationRemoveBody')}</Text>
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
      </Modal>
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
