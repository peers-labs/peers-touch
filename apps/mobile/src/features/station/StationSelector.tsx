import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Tag, Typography } from 'antd';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  LoaderCircle,
  Plus,
  Server,
  Trash2,
  X,
} from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import {
  buildStationUrl,
  splitStationInput,
  type MobileStationEntry,
  type StationProtocol,
} from './stationRegistry';
import { stationDisplayName } from './stationDisplayName';

const { Text, Title } = Typography;

export type StationSelectorSurfaceFixture =
  | 'address'
  | 'address-invalid'
  | 'remove-confirm';

export function defaultStationAddress(
  configuredUrl: string | undefined,
): { protocol: StationProtocol; address: string } {
  return splitStationInput(configuredUrl ?? '', 'https');
}

export function StationSelector({
  activeStationPeerId,
  entries,
  error,
  checking,
  verifyingUrls,
  checkedUrls,
  surfaceFixture,
  onAdd,
  onSelect,
  onRemove,
}: {
  activeStationPeerId: string;
  entries: MobileStationEntry[];
  error: string | null;
  checking: boolean;
  verifyingUrls: string[];
  checkedUrls: string[];
  surfaceFixture?: StationSelectorSurfaceFixture;
  onAdd: (protocol: StationProtocol, address: string) => boolean | Promise<boolean>;
  onSelect: (stationPeerId: string) => void | Promise<void>;
  onRemove: (stationPeerId: string) => void;
}) {
  const { t } = useMobileI18n();
  const configuredDefault = defaultStationAddress(
    surfaceFixture || entries.length > 0
      ? undefined
      : import.meta.env.VITE_DEFAULT_STATION_URL,
  );
  const [protocol, setProtocol] = useState<StationProtocol>(
    surfaceFixture === 'address'
      ? 'http'
      : surfaceFixture === 'address-invalid'
        ? 'https'
        : configuredDefault.protocol,
  );
  const [address, setAddress] = useState(() => (
    surfaceFixture === 'address'
      ? 'station.local:18280'
      : surfaceFixture === 'address-invalid'
        ? 'not a valid station'
        : configuredDefault.address
  ));
  const [addingStation, setAddingStation] = useState(
    surfaceFixture === 'address' || surfaceFixture === 'address-invalid',
  );
  const [protocolPickerOpen, setProtocolPickerOpen] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<MobileStationEntry | null>(null);
  const hasEntries = entries.length > 0;
  const showStationInput = !hasEntries || addingStation;
  const canAdd = useMemo(() => Boolean(buildStationUrl({ protocol, address })), [address, protocol]);

  useEffect(() => {
    if (surfaceFixture === 'remove-confirm' && entries[0]) {
      setPendingRemoval(entries[0]);
    }
  }, [entries, surfaceFixture]);

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
    setProtocolPickerOpen(false);
    setAddingStation(false);
  }

  function confirmStationRemoval() {
    if (!pendingRemoval) return;
    onRemove(pendingRemoval.stationPeerId);
    setPendingRemoval(null);
  }

  return (
    <section className="station-selector">
      <div className="station-selector-header">
        <div>
          <Text strong>{t('mobile.launch.station')}</Text>
          {hasEntries && !showStationInput ? (
            <Text className="station-helper-line">
              {t('mobile.launch.changeTarget')}
            </Text>
          ) : null}
        </div>
        <Tag color={activeStationPeerId ? 'green' : 'default'}>
          {activeStationPeerId ? t('mobile.launch.selected') : t('mobile.launch.required')}
        </Tag>
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
            <button
              type="button"
              className="station-protocol-select"
              aria-label={t('mobile.launch.protocol')}
              aria-expanded={protocolPickerOpen}
              onClick={() => setProtocolPickerOpen(true)}
            >
              <span>{protocol.toUpperCase()}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <Input
              className="station-address-input"
              value={address}
              placeholder={t('mobile.launch.placeholder')}
              aria-label={t('mobile.launch.stationAddress')}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              variant="borderless"
              onChange={(event) => updateAddress(event.target.value)}
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

      {showStationInput && isHttp ? (
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
        {entries.length === 0 ? (
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
                  <Trash2 size={15} />
                </button>
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

      <Modal
        open={protocolPickerOpen}
        onCancel={() => setProtocolPickerOpen(false)}
        footer={null}
        className="station-protocol-sheet"
        rootClassName="station-protocol-sheet-root"
        title={t('mobile.launch.protocol')}
        destroyOnClose
      >
        <div className="station-protocol-options">
          {(['https', 'http'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={option === protocol ? 'active' : ''}
              aria-pressed={option === protocol}
              onClick={() => {
                setProtocol(option);
                setProtocolPickerOpen(false);
              }}
            >
              <span>{option.toUpperCase()}</span>
              <small>
                {t(
                  option === 'https'
                    ? 'mobile.launch.protocolHttps'
                    : 'mobile.launch.protocolHttp',
                )}
              </small>
              {option === protocol ? <Check size={17} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
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
