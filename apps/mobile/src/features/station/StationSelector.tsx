import { useMemo, useState } from 'react';
import { Button, Input, Select, Tag, Typography } from 'antd';
import { AlertTriangle, Check, Plus, Server, Trash2, X } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import {
  buildStationUrl,
  splitStationInput,
  type MobileStationEntry,
  type StationProtocol,
} from './stationRegistry';

const { Text } = Typography;

export function StationSelector({
  activeUrl,
  entries,
  error,
  checking,
  verifyingUrls,
  onAdd,
  onSelect,
  onRemove,
}: {
  activeUrl: string;
  entries: MobileStationEntry[];
  error: string | null;
  checking: boolean;
  verifyingUrls: string[];
  onAdd: (protocol: StationProtocol, address: string) => boolean | Promise<boolean>;
  onSelect: (url: string) => void | Promise<void>;
  onRemove: (url: string) => void;
}) {
  const { t } = useMobileI18n();
  const [protocol, setProtocol] = useState<StationProtocol>('https');
  const [address, setAddress] = useState('');
  const [addingStation, setAddingStation] = useState(false);
  const hasEntries = entries.length > 0;
  const showStationInput = !hasEntries || addingStation;
  const canAdd = useMemo(() => Boolean(buildStationUrl({ protocol, address })), [address, protocol]);

  function updateAddress(value: string) {
    const next = splitStationInput(value, protocol);
    setProtocol(next.protocol);
    setAddress(next.address);
  }

  async function submit() {
    if (!canAdd || checking) return;
    const added = await onAdd(protocol, address);
    if (added) setAddress('');
    if (added && hasEntries) setAddingStation(false);
  }

  const isHttp = protocol === 'http';

  function closeStationInput() {
    setAddress('');
    setProtocol('https');
    setAddingStation(false);
  }

  return (
    <section className="station-selector">
      <div className="station-selector-header">
        <div>
          <Text strong>{t('mobile.launch.station')}</Text>
          <Text className={`station-helper-line ${isHttp ? 'warning' : ''}`}>
            {isHttp ? <AlertTriangle size={13} /> : null}
            <span>{isHttp ? t('mobile.launch.helperHttpWarning') : t('mobile.launch.changeTarget')}</span>
          </Text>
        </div>
        <Tag color={activeUrl ? 'green' : 'default'}>
          {activeUrl ? t('mobile.launch.selected') : t('mobile.launch.required')}
        </Tag>
      </div>

      {showStationInput ? (
        <div className={`station-input-row ${hasEntries ? 'with-cancel' : ''}`}>
          <div className={`station-url-control ${error ? 'error' : ''}`}>
            <Select
              className="station-protocol-select"
              popupMatchSelectWidth={false}
              suffixIcon={null}
              variant="borderless"
              options={[
                { label: 'HTTPS', value: 'https' },
                { label: 'HTTP', value: 'http' },
              ]}
              value={protocol}
              onChange={(value) => setProtocol(value as StationProtocol)}
            />
            <Input
              className="station-address-input"
              value={address}
              placeholder={t('mobile.launch.placeholder')}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              variant="borderless"
              onChange={(event) => updateAddress(event.target.value)}
              onPressEnter={submit}
            />
          </div>
          <Button icon={<Plus size={16} />} loading={checking} disabled={!canAdd || checking} onClick={submit} />
          {hasEntries ? (
            <Button className="station-input-cancel" icon={<X size={16} />} onClick={closeStationInput} />
          ) : null}
        </div>
      ) : null}

      {error ? <Text type="danger" className="station-error">{error}</Text> : null}

      <div className="station-list">
        {entries.length === 0 ? (
          <div className="station-empty">
            <Server size={18} />
            <Text type="secondary">{t('mobile.launch.emptyStations')}</Text>
          </div>
        ) : (
          entries.map((entry) => {
            const isActive = entry.url === activeUrl;
            const status = getStationStatus(entry, verifyingUrls.includes(entry.url), t);
            return (
              <div
                key={entry.url}
                role="button"
                tabIndex={0}
                className={`station-entry ${isActive ? 'active' : ''}`}
                onClick={() => onSelect(entry.url)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onSelect(entry.url);
                }}
              >
                <Server size={18} />
                <span className="station-entry-copy">
                  <Text strong={isActive}>{entry.label}</Text>
                  <Text type="secondary" ellipsis>{entry.url}</Text>
                </span>
                <span className={`station-entry-status ${status.className}`}>
                  {status.label}
                </span>
                {isActive ? <Check size={16} /> : null}
                <span
                  className="station-remove"
                  role="button"
                  tabIndex={0}
                  aria-label={t('common.action.delete')}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(entry.url);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    onRemove(entry.url);
                  }}
                >
                  <Trash2 size={15} />
                </span>
              </div>
            );
          })
        )}
      </div>

      {hasEntries && !addingStation ? (
        <Button className="station-add-secondary" type="text" icon={<Plus size={15} />} onClick={() => setAddingStation(true)}>
          {t('mobile.launch.addStation')}
        </Button>
      ) : null}
    </section>
  );
}

function getStationStatus(
  entry: MobileStationEntry,
  verifying: boolean,
  t: (key: string) => string,
): { className: string; label: string } {
  if (verifying || entry.online === undefined) {
    return { className: 'validating', label: t('mobile.launch.validating') };
  }

  if (entry.online) {
    return { className: 'online', label: t('mobile.launch.verified') };
  }

  return { className: 'offline', label: t('mobile.launch.unavailable') };
}
