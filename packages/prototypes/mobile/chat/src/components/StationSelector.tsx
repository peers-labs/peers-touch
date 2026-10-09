import { useState } from 'react';
import { Button, Modal, Tag, Typography } from 'antd';
import { AlertTriangle, Check, Plus, Server, X } from 'lucide-react';
import type { StationEntry } from '../types';

const { Text } = Typography;

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
        <Text strong>Your Station</Text>
        <Tag color={activeUrl ? 'green' : 'default'}>{activeUrl ? 'Selected' : 'Required'}</Tag>
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
              aria-label="Add Station"
              disabled={!canAdd}
              onClick={handleAdd}
            >
              <Plus size={17} aria-hidden="true" />
            </button>
          </div>
          {hasEntries && (
            <Button type="text" className="mp-station-cancel-btn" onClick={closeStationInput}>Cancel</Button>
          )}
        </div>
      )}

      {showStationInput && stationUrl.trim().toLowerCase().startsWith('http://') && (
        <Text className="mp-station-field-helper">
          <AlertTriangle size={12} aria-hidden="true" />
          <span>HTTP is unencrypted. Trusted networks only.</span>
        </Text>
      )}

      <div className="mp-station-list">
        {entries.length === 0 ? (
          <div className="mp-station-empty">
            <Server size={18} />
            <Text type="secondary">No stations configured</Text>
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
                  <span className="mp-station-entry-icon"><Server size={18} /></span>
                  <span className="mp-station-entry-copy">
                    <Text strong={isActive} className="mp-truncate">{entry.label}</Text>
                  </span>
                  <span className={`mp-station-entry-status ${status.className}`}>{status.label}</span>
                  <span className="mp-station-check-slot">
                    {isActive && <Check size={16} className="mp-station-check" />}
                  </span>
                </button>
                <Button
                  type="text"
                  className="mp-station-remove"
                  aria-label={`Remove ${entry.label}`}
                  icon={<X size={16} />}
                  onClick={() => setPendingRemoval(entry)}
                />
              </div>
            );
          })
        )}
      </div>

      {hasEntries && !addingStation && (
        <Button type="text" className="mp-station-add-btn" icon={<Plus size={14} />} onClick={() => setAddingStation(true)}>
          Add Station
        </Button>
      )}

      {pendingRemoval && (
        <div className="mp-station-remove-boundary" role="region" aria-label="Station removal confirmation">
          <Modal
            open
            getContainer={false}
            rootClassName="mp-station-remove-modal"
            title="Remove Station?"
            okText="Remove"
            okButtonProps={{ danger: true }}
            cancelText="Keep Station"
            onCancel={() => setPendingRemoval(null)}
            onOk={() => {
              onRemove(pendingRemoval.url);
              setPendingRemoval(null);
            }}
          >
            <Text>
              This removes the saved connection from this device. Data on the Station is not deleted.
            </Text>
          </Modal>
        </div>
      )}
    </section>
  );
}
