import { useState } from 'react';
import { Button, Modal, Tag, Typography } from 'antd';
import { Check, Plus, Server, X } from 'lucide-react';
import type { StationEntry } from '../types';

const { Text } = Typography;

export function StationSelector({
  entries, activeUrl, onSelect, onRemove, onAdd, showRemovalConfirmation = false,
}: {
  entries: StationEntry[];
  activeUrl: string;
  onSelect: (url: string) => void;
  onRemove: (url: string) => void;
  onAdd: () => void;
  showRemovalConfirmation?: boolean;
}) {
  const [protocol, setProtocol] = useState<'http' | 'https'>('https');
  const [address, setAddress] = useState('');
  const [addingStation, setAddingStation] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<StationEntry | null>(
    showRemovalConfirmation
      ? entries.find((entry) => entry.url === activeUrl) ?? entries[0] ?? null
      : null,
  );
  const hasEntries = entries.length > 0;
  const showStationInput = !hasEntries || addingStation;

  function getStatus(entry: StationEntry): { className: string; label: string } {
    if (entry.online === undefined) return { className: 'validating', label: 'Validating' };
    if (entry.online) return { className: 'online', label: 'Verified' };
    return { className: 'offline', label: 'Unavailable' };
  }

  function closeStationInput() {
    setAddress('');
    setAddingStation(false);
  }

  function handleAdd() {
    onAdd();
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
            <button type="button" className="mp-station-protocol" onClick={() => setProtocol(protocol === 'https' ? 'http' : 'https')}>
              {protocol.toUpperCase()}
            </button>
            <input
              className="mp-station-address"
              value={address}
              placeholder="localhost:9000"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              onChange={(e) => setAddress(e.target.value)}
            />
            {address && (
              <button type="button" className="mp-station-clear" aria-label="Clear" onClick={() => setAddress('')}>
                <X size={16} />
              </button>
            )}
          </div>
          <Button type="primary" icon={<Plus size={16} />} onClick={handleAdd} />
          {hasEntries && (
            <Button type="text" className="mp-station-cancel-btn" onClick={closeStationInput}>Cancel</Button>
          )}
        </div>
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
                    <Text type="secondary" className="mp-truncate">{entry.url}</Text>
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
