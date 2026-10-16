import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Drawer, Input, Popover, Spin, Tooltip, theme } from 'antd';
import {
  Check,
  ChevronDown,
  Globe2,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { ANTD_PRIMARY_BUTTON_STYLE, T } from './theme';

type StationHealth = 'unknown' | 'checking' | 'online' | 'offline';
type LanguageCode = 'en' | 'zh-CN';

interface PrototypeStation {
  url: string;
  label: string;
  health: StationHealth;
}

const STATIONS_STORAGE_KEY = 'pt.prototype.desktop.auth.stations';
const ACTIVE_STATION_STORAGE_KEY = 'pt.prototype.desktop.auth.active-station';
const LANGUAGE_STORAGE_KEY = 'pt.prototype.desktop.language';

const INITIAL_STATIONS: PrototypeStation[] = [
  { url: 'https://aspen.station.test', label: 'Aspen Station', health: 'unknown' },
  { url: 'https://harbor.station.test', label: 'Harbor Station', health: 'unknown' },
];

const LANGUAGES: Array<{ code: LanguageCode; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '简体中文' },
];

function readStoredStations(): PrototypeStation[] {
  if (typeof window === 'undefined') return INITIAL_STATIONS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STATIONS_STORAGE_KEY) ?? '');
    if (!Array.isArray(parsed)) return INITIAL_STATIONS;
    const stations = parsed.filter((item): item is PrototypeStation => (
      typeof item?.url === 'string'
      && typeof item?.label === 'string'
      && ['unknown', 'checking', 'online', 'offline'].includes(item?.health)
    ));
    return stations.length > 0 ? stations : INITIAL_STATIONS;
  } catch {
    return INITIAL_STATIONS;
  }
}

function readStoredLanguage(): LanguageCode {
  if (typeof window === 'undefined') return 'en';
  return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'zh-CN' ? 'zh-CN' : 'en';
}

function friendlyStationLabel(url: string): string {
  try {
    const host = new URL(url).hostname;
    const name = host.split('.')[0] || 'New';
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} Station`;
  } catch {
    return 'New Station';
  }
}

function normalizedStationUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function statusLabel(status: StationHealth): string {
  return {
    unknown: 'Not checked',
    checking: 'Checking',
    online: 'Online',
    offline: 'Offline',
  }[status];
}

function StationStatus({ status }: { status: StationHealth }) {
  const { token } = theme.useToken();
  if (status === 'unknown') return null;
  if (status === 'checking') {
    return <Spin aria-label="Checking Station" size="small" />;
  }
  const Icon = status === 'online' ? Wifi : WifiOff;
  return (
    <Icon
      aria-label={statusLabel(status)}
      color={status === 'online' ? token.colorSuccess : token.colorError}
      size={14}
    />
  );
}

export function AuthUtilityBarPrototype() {
  const { token } = theme.useToken();
  const [stations, setStations] = useState<PrototypeStation[]>(readStoredStations);
  const [activeUrl, setActiveUrl] = useState(() => {
    if (typeof window === 'undefined') return INITIAL_STATIONS[0].url;
    return window.localStorage.getItem(ACTIVE_STATION_STORAGE_KEY) ?? INITIAL_STATIONS[0].url;
  });
  const [stationOpen, setStationOpen] = useState(false);
  const [stationInput, setStationInput] = useState('');
  const [stationError, setStationError] = useState('');
  const [language, setLanguage] = useState<LanguageCode>(readStoredLanguage);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
  ));
  const probeTimersRef = useRef<Record<string, number>>({});
  const stationTriggerRef = useRef<HTMLButtonElement>(null);
  const languageTriggerRef = useRef<HTMLButtonElement>(null);

  const activeStation = useMemo(
    () => stations.find((station) => station.url === activeUrl) ?? stations[0],
    [activeUrl, stations],
  );

  useEffect(() => {
    window.localStorage.setItem(STATIONS_STORAGE_KEY, JSON.stringify(stations));
  }, [stations]);

  useEffect(() => {
    if (!activeStation) return;
    if (activeUrl !== activeStation.url) setActiveUrl(activeStation.url);
    window.localStorage.setItem(ACTIVE_STATION_STORAGE_KEY, activeStation.url);
  }, [activeStation, activeUrl]);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => () => {
    Object.values(probeTimersRef.current).forEach(timer => window.clearTimeout(timer));
  }, []);

  const probeStation = (url: string) => {
    if (probeTimersRef.current[url]) window.clearTimeout(probeTimersRef.current[url]);
    setStations(current => current.map(station => (
      station.url === url ? { ...station, health: 'checking' } : station
    )));
    probeTimersRef.current[url] = window.setTimeout(() => {
      setStations(current => current.map(station => (
        station.url === url
          ? { ...station, health: url.includes('offline') ? 'offline' : 'online' }
          : station
      )));
      delete probeTimersRef.current[url];
    }, 520);
  };

  useEffect(() => {
    if (!stationOpen) return;
    stations.forEach(station => probeStation(station.url));
    // Opening the production picker performs a fresh probe of every known Station.
    // The prototype mirrors that visible lifecycle with deterministic local fixtures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationOpen]);

  const addStation = () => {
    const url = normalizedStationUrl(stationInput);
    if (!url) {
      setStationError('Enter a valid HTTP or HTTPS Station URL.');
      return;
    }
    if (stations.some(station => station.url === url)) {
      setStationError('This Station is already in the list.');
      return;
    }
    setStations(current => [
      ...current,
      { url, label: friendlyStationLabel(url), health: 'unknown' },
    ]);
    setStationInput('');
    setStationError('');
    probeStation(url);
  };

  const removeStation = (url: string) => {
    if (url === activeStation?.url) return;
    if (probeTimersRef.current[url]) window.clearTimeout(probeTimersRef.current[url]);
    delete probeTimersRef.current[url];
    setStations(current => current.filter(station => station.url !== url));
  };

  const handleStationOpenChange = (open: boolean) => {
    setStationOpen(open);
    if (!open && !narrow) {
      window.setTimeout(() => stationTriggerRef.current?.focus(), 0);
    }
  };

  const handleLanguageOpenChange = (open: boolean) => {
    setLanguageOpen(open);
    if (!open) {
      window.setTimeout(() => languageTriggerRef.current?.focus(), 0);
    }
  };

  const stationContent = (
    <div data-pt-prototype-station-panel style={{ width: narrow ? '100%' : 304 }}>
      <div style={{ padding: '4px 4px 10px' }}>
        <div style={{ color: token.colorText, fontSize: 13, fontWeight: 650 }}>Stations</div>
        <div style={{ color: token.colorTextTertiary, fontSize: 11, marginTop: 2 }}>
          Choose the Station that owns this sign-in.
        </div>
      </div>
      <div style={{ display: 'grid', gap: 4, maxHeight: 224, overflowY: 'auto' }}>
        {stations.map(station => {
          const selected = station.url === activeStation?.url;
          return (
            <div
              data-pt-prototype-station-row={station.url}
              key={station.url}
              style={{
                alignItems: 'center',
                background: selected ? T.primaryWash : 'transparent',
                border: `1px solid ${selected ? T.primaryDisabled : 'transparent'}`,
                borderRadius: 10,
                display: 'grid',
                gap: 8,
                gridTemplateColumns: '18px minmax(0, 1fr) auto',
                minHeight: 52,
                padding: '7px 8px',
              }}
            >
              <StationStatus status={station.health} />
              <button
                data-pt-prototype-station-select={station.url}
                onClick={() => setActiveUrl(station.url)}
                style={{
                  background: 'transparent',
                  border: 0,
                  color: token.colorText,
                  cursor: 'pointer',
                  minWidth: 0,
                  padding: 0,
                  textAlign: 'left',
                }}
                type="button"
              >
                <span style={{ display: 'block', fontSize: 13, fontWeight: selected ? 650 : 500 }}>
                  {station.label}
                </span>
                <span style={{
                  color: token.colorTextQuaternary,
                  display: 'block',
                  fontSize: 11,
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {statusLabel(station.health)}
                </span>
              </button>
              <div style={{ alignItems: 'center', display: 'flex', gap: 2 }}>
                {selected ? (
                  <span style={{ color: T.primary, fontSize: 10, fontWeight: 650 }}>
                    Selected
                  </span>
                ) : null}
                <Tooltip title="Probe Station">
                  <Button
                    aria-label={`Probe ${station.label}`}
                    data-pt-prototype-station-probe={station.url}
                    icon={<RefreshCw size={13} />}
                    onClick={() => probeStation(station.url)}
                    size="small"
                    type="text"
                  />
                </Tooltip>
                {!selected ? (
                  <Tooltip title="Remove Station">
                    <Button
                      aria-label={`Remove ${station.label}`}
                      data-pt-prototype-station-remove={station.url}
                      danger
                      icon={<Trash2 size={13} />}
                      onClick={() => removeStation(station.url)}
                      size="small"
                      type="text"
                    />
                  </Tooltip>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, marginTop: 8, paddingTop: 10 }}>
        <div data-focus-boundary style={{
          alignItems: 'center',
          border: `1px solid ${stationError ? token.colorError : token.colorBorder}`,
          borderRadius: 10,
          display: 'grid',
          gap: 4,
          gridTemplateColumns: 'minmax(0, 1fr) 32px',
          padding: 3,
        }}>
          <Input
            aria-label="Station URL"
            data-pt-prototype-station-input
            onChange={event => {
              setStationInput(event.target.value);
              setStationError('');
            }}
            onPressEnter={addStation}
            placeholder="https://station.example"
            value={stationInput}
            variant="borderless"
          />
          <Button
            aria-label="Add Station"
            data-pt-prototype-station-add
            disabled={!stationInput.trim()}
            icon={<Plus size={14} />}
            onClick={addStation}
            size="small"
            style={stationInput.trim() ? ANTD_PRIMARY_BUTTON_STYLE : undefined}
            type="primary"
          />
        </div>
        {stationError ? (
          <div role="alert" style={{ color: token.colorError, fontSize: 11, margin: '6px 4px 0' }}>
            {stationError}
          </div>
        ) : null}
      </div>
    </div>
  );

  const languageContent = (
    <div data-pt-prototype-language-panel style={{ display: 'grid', gap: 2, width: 156 }}>
      {LANGUAGES.map(option => (
        <Button
          block
          data-pt-prototype-language={option.code}
          icon={language === option.code ? <Check size={14} /> : <span style={{ width: 14 }} />}
          key={option.code}
          onClick={() => {
            setLanguage(option.code);
            handleLanguageOpenChange(false);
          }}
          style={{ justifyContent: 'flex-start' }}
          type="text"
        >
          {option.label}
        </Button>
      ))}
    </div>
  );

  const stationTrigger = (
    <button
      aria-expanded={stationOpen}
      aria-label="Choose Station"
      data-pt-prototype-station-trigger
      onClick={narrow ? () => setStationOpen(open => !open) : undefined}
      ref={stationTriggerRef}
      type="button"
      style={{
        alignItems: 'center',
        background: token.colorBgContainer,
        border: `1px solid ${stationOpen ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
        borderRadius: 10,
        color: token.colorTextSecondary,
        cursor: 'pointer',
        display: 'grid',
        fontSize: 12,
        gap: 8,
        gridTemplateColumns: '16px minmax(0, 1fr) 16px',
        height: 34,
        padding: '0 10px',
        width: 180,
      }}
    >
      <Server size={14} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left', whiteSpace: 'nowrap' }}>
        {activeStation?.label ?? 'Choose a Station'}
      </span>
      <span style={{ alignItems: 'center', display: 'inline-flex', height: 16, justifyContent: 'center', width: 16 }}>
        <StationStatus status={activeStation?.health ?? 'unknown'} />
      </span>
    </button>
  );

  return (
    <div
      data-pt-prototype-auth-utilities
      style={{
        alignItems: 'center',
        bottom: 20,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        left: 20,
        maxWidth: 'calc(100% - 40px)',
        position: 'absolute',
        zIndex: 20,
      }}
    >
      {narrow ? (
        <>
          {stationTrigger}
          <Drawer
            closable
            size={380}
            onClose={() => {
              setStationOpen(false);
              window.setTimeout(() => stationTriggerRef.current?.focus(), 340);
            }}
            open={stationOpen}
            placement="bottom"
            styles={{
              body: { padding: 16 },
              section: { borderRadius: '16px 16px 0 0' },
            }}
            title="Station access"
          >
            {stationContent}
          </Drawer>
        </>
      ) : (
        <Popover
          arrow={false}
          content={stationContent}
          onOpenChange={handleStationOpenChange}
          open={stationOpen}
          placement="topLeft"
          trigger="click"
        >
          {stationTrigger}
        </Popover>
      )}
      <Popover
        arrow={false}
        content={languageContent}
        onOpenChange={handleLanguageOpenChange}
        open={languageOpen}
        placement="topLeft"
        trigger="click"
      >
        <button
          aria-expanded={languageOpen}
          aria-label="Choose language"
          data-pt-prototype-language-trigger
          ref={languageTriggerRef}
          type="button"
          style={{
            alignItems: 'center',
            background: token.colorBgContainer,
            border: `1px solid ${languageOpen ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
            borderRadius: 10,
            color: token.colorTextSecondary,
            cursor: 'pointer',
            display: 'grid',
            fontSize: 12,
            gap: 6,
            gridTemplateColumns: '16px minmax(0, 1fr) 14px',
            height: 34,
            padding: '0 10px',
            width: 116,
          }}
        >
          <Globe2 size={14} />
          <span>{language === 'zh-CN' ? '简体中文' : 'English'}</span>
          <ChevronDown size={12} />
        </button>
      </Popover>
    </div>
  );
}
