import { useState } from 'react';
import { useT } from '../i18n';
import { Button, Icon, Text } from '@peers-touch/ui';
import type { StationEntry } from '../types';

export function StationSelector({
  entries, activeUrl, onSelect, onRemove, onAdd, showRemovalConfirmation = false,
}: {
  entries: StationEntry[];
  activeUrl: string;
  onSelect: (url: string) => void;
  onRemove: (url: string) => void;
  onAdd: (url: string) => void;
  showRemovalConfirmation?: boolean;
}) {
  const t = useT();
  const [stationUrl, setStationUrl] = useState('');
  const [addingStation, setAddingStation] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<StationEntry | null>(
    showRemovalConfirmation
      ? entries.find((entry) => entry.url === activeUrl) ?? entries[0] ?? null
      : null,
  );
  const hasEntries = entries.length > 0;
  const showStationInput = !hasEntries || addingStation;
  const canAdd = /^https?:\/\/\S+$/i.test(stationUrl.trim());

  function getStatus(entry: StationEntry): { className: string; label: string } {
    if (entry.online === undefined) return { className: 'validating', label: 'Validating' };
    if (entry.online) return { className: 'online', label: 'Verified' };
    return { className: 'offline', label: 'Unavailable' };
  }

  function closeStationInput() {
    setStationUrl('');
    setAddingStation(false);
  }

  function handleAdd() {
    if (!canAdd) return;
    onAdd(stationUrl.trim());
    closeStationInput();
  }

  return (
    <section className="mp-station-selector">
      <div className="mp-station-selector-header">
        <div>
          <Text strong>{t('mobile.station.your')}</Text>
          <Text className="mp-station-helper" tone="secondary">
            Tap a recent Station to change the target
          </Text>
        </div>
        <span className={`mp-station-selection-state ${activeUrl ? 'selected' : ''}`}>
          {activeUrl ? 'Selected' : 'Required'}
        </span>
      </div>

      {showStationInput && (
        <div className="mp-station-input-row">
          <div className="mp-station-url-control">
            <input
              className="mp-station-address"
              value={stationUrl}
              placeholder="http://station.local:18080"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              onChange={(e) => setStationUrl(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleAdd();
              }}
            />
            <button
              type="button"
              className="mp-station-submit"
              aria-label={t('mobile.station.add')}
              disabled={!canAdd}
              onClick={handleAdd}
            >
              <Icon iconId="plus" size={17} />
            </button>
          </div>
          {hasEntries && (
            <Button actionId="station.cancel-add" emphasis="quiet" aria-label={t('mobile.station.cancelAdd')}
              leading={<Icon iconId="close" size={16} />} onActivate={closeStationInput} />
          )}
        </div>
      )}

      {showStationInput && stationUrl.trim().toLowerCase().startsWith('http://') && (
        <Text className="mp-station-field-helper" tone="warning">
          <Icon iconId="attention" size={12} />
          <span>{t('mobile.station.httpWarning')}</span>
        </Text>
      )}

      <div className="mp-station-list">
        {entries.length === 0 ? (
          <div className="mp-station-empty">
            <Icon iconId="server" size={18} />
            <Text tone="secondary">{t('mobile.station.none')}</Text>
          </div>
        ) : (
          entries.map((entry) => {
            const isActive = entry.url === activeUrl;
            const status = getStatus(entry);
            return (
              <div key={entry.url} className={`mp-station-entry ${isActive ? 'active' : ''}`}>
                <button
                  type="button"
                  className="mp-station-entry-main"
                  onClick={() => onSelect(entry.url)}
                >
                  <span className="mp-station-entry-icon"><Icon iconId="server" size={18} /></span>
                  <span className="mp-station-entry-copy">
                    <Text strong={isActive} truncate>{entry.label}</Text>
                  </span>
                  <span className={`mp-station-entry-status ${status.className}`}>{status.label}</span>
                  <span className="mp-station-check-slot">
                    {isActive && <Icon iconId="check" size={16} className="mp-station-check" />}
                  </span>
                </button>
                <button
                  type="button"
                  className="mp-station-remove"
                  aria-label={`Remove ${entry.label}`}
                  onClick={() => setPendingRemoval(entry)}
                >
                  <Icon iconId="delete" size={15} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {hasEntries && !addingStation && (
        <Button actionId="station.add" emphasis="quiet" density="compact"
          leading={<Icon iconId="plus" size={14} />}
          onActivate={() => setAddingStation(true)}>
          Add Station
        </Button>
      )}

      {pendingRemoval && (
        <div className="mp-station-remove-boundary" role="region" aria-label={t('mobile.station.removeConfirmAria')}>
          <div className="mp-confirm-backdrop" onClick={() => setPendingRemoval(null)}>
            <div className="mp-confirm-dialog" onClick={(event) => event.stopPropagation()}>
              <div className="mp-confirm-title">{t('mobile.station.removeTitle')}</div>
              <div className="mp-confirm-desc">
                This removes the saved connection from this device. Data on the Station is not deleted.
              </div>
              <div className="mp-confirm-actions">
                <button type="button" className="mp-confirm-btn" onClick={() => setPendingRemoval(null)}>
                  Keep Station
                </button>
                <button
                  type="button"
                  className="mp-confirm-btn mp-confirm-btn--danger"
                  onClick={() => {
                    onRemove(pendingRemoval.url);
                    setPendingRemoval(null);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
