import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Copy,
  Loader2,
  Plus,
  RadioTower,
  Server,
  Trash2,
  Wifi,
} from 'lucide-react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/desktop_api';
import type {
  StationEntry,
  StationRouteCandidate,
  StationRouteHealth,
} from '../../services/desktop_api';
import { log } from '../../utils/logger';
import { dispatchStationActiveChanged } from './stationRegistryEvents';

type StationHealthStatus = 'unknown' | 'checking' | 'online' | 'offline';

type DesignToken = ReturnType<typeof theme.useToken>['token'];

const PANEL_WIDTH = 336;
const COPY_CONFIRM_MS = 1200;
const TRIGGER_WIDTH = 190;
const TRIGGER_STATUS_SLOT_SIZE = 16;

export function StationPicker() {
  const { token } = theme.useToken();
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<StationEntry[]>([]);
  const [activeStationPeerId, setActiveStationPeerId] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [checkingStationPeerId, setCheckingStationPeerId] = useState<string | null>(null);
  const [hoveredStationPeerId, setHoveredStationPeerId] = useState<string | null>(null);
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [triggerHovered, setTriggerHovered] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const copyResetTimerRef = useRef<number | null>(null);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, openRight: true });

  const loadStations = useCallback(async () => {
    const requestId = ++requestRef.current;
    try {
      const result = await api.stationList();
      if (requestRef.current !== requestId) return;
      setEntries(result.entries ?? []);
      setActiveStationPeerId(result.active_station_peer_id ?? '');
    } catch (error) {
      log.error('StationPicker', 'Failed to load Station registry', { error });
    }
  }, []);

  useEffect(() => {
    void loadStations();
  }, [loadStations]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const openRight = window.innerWidth - rect.right >= PANEL_WIDTH;
    setPanelPos({
      top: rect.top - 4,
      left: openRight ? rect.left : rect.right,
      openRight,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadStations();
    updatePosition();
    const handleClickOutside = (event: globalThis.MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current
        && !triggerRef.current.contains(target)
        && panelRef.current
        && !panelRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', updatePosition);
    return () => {
      requestRef.current += 1;
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', updatePosition);
    };
  }, [loadStations, open, updatePosition]);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  const selectRoute = async (
    entry: StationEntry,
    route: StationRouteCandidate,
    confirmPrivacyChange = true,
  ) => {
    const current = entries.find((candidate) => candidate.station_peer_id === activeStationPeerId);
    const stationChanges = current?.station_peer_id !== entry.station_peer_id;
    const routeChanges = !stationChanges && current?.active_route_id !== route.route_id;
    if (
      confirmPrivacyChange
      && stationChanges
      && current
      && !window.confirm(t('common.stationPicker.confirmStationChange'))
    ) return;
    if (
      confirmPrivacyChange
      && routeChanges
      && !window.confirm(t('common.stationPicker.confirmRouteChange'))
    ) return;

    try {
      const result = await api.stationSetActive(entry.station_peer_id, route.route_id);
      setActiveStationPeerId(result.active_station_peer_id ?? entry.station_peer_id);
      setEntries((currentEntries) => currentEntries.map((candidate) => (
        candidate.station_peer_id === entry.station_peer_id
          ? {
              ...candidate,
              active_route_id: result.active_route_id ?? route.route_id,
              route_revision: result.binding.route_revision,
              lifecycle_generation: result.binding.lifecycle_generation,
            }
          : candidate
      )));
      dispatchStationActiveChanged({
        stationPeerId: entry.station_peer_id,
        routeId: result.active_route_id ?? route.route_id,
        displayName: entry.display_name ?? undefined,
      });
    } catch (error) {
      log.error('StationPicker', 'Failed to select Station route', {
        stationPeerId: entry.station_peer_id,
        routeId: route.route_id,
        error,
      });
    }
  };

  const probeStation = async (entry: StationEntry, event: ReactMouseEvent) => {
    event.stopPropagation();
    const route = activeRoute(entry);
    if (!route) return;
    setCheckingStationPeerId(entry.station_peer_id);
    try {
      const result = await api.stationProbe(route.endpoint_origin);
      setEntries((current) => mergeDiscoveredEntries(current, result.entries));
    } catch (error) {
      log.warn('StationPicker', 'Failed to verify Station route', {
        stationPeerId: entry.station_peer_id,
        error,
      });
    } finally {
      setCheckingStationPeerId((current) => (
        current === entry.station_peer_id ? null : current
      ));
    }
  };

  const handleAdd = async () => {
    const input = inputValue.trim();
    if (!input) return;
    setAdding(true);
    try {
      const discovered = await api.stationAdd(input);
      setInputValue('');
      await loadStations();
      if (discovered.entries.length === 1 && discovered.entries[0]?.routes.length === 1) {
        const entry = discovered.entries[0];
        const route = entry.routes[0];
        if (entry && route) await selectRoute(entry, route, false);
      }
    } catch (error) {
      log.error('StationPicker', 'Failed to discover Station input', { error });
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (entry: StationEntry, event: ReactMouseEvent) => {
    event.stopPropagation();
    try {
      await api.stationRemove(entry.station_peer_id);
      await loadStations();
    } catch (error) {
      log.error('StationPicker', 'Failed to remove Station', {
        stationPeerId: entry.station_peer_id,
        error,
      });
    }
  };

  const handleCopy = async (route: StationRouteCandidate, event: ReactMouseEvent) => {
    event.stopPropagation();
    try {
      await writeClipboardText(route.endpoint_origin);
      setCopiedEndpoint(route.endpoint_origin);
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopiedEndpoint(null);
        copyResetTimerRef.current = null;
      }, COPY_CONFIRM_MS);
    } catch (error) {
      log.error('StationPicker', 'Failed to copy Station endpoint', { error });
    }
  };

  const activeEntry = entries.find(
    (entry) => entry.station_peer_id === activeStationPeerId,
  ) ?? (entries.length === 1 ? entries[0] : undefined);
  const currentRoute = activeEntry ? activeRoute(activeEntry) : undefined;
  const currentStatus = checkingStationPeerId === activeEntry?.station_peer_id
    ? 'checking'
    : statusFromRoute(currentRoute);
  const displayLabel = activeEntry?.display_name
    || shortPeerId(activeEntry?.station_peer_id)
    || t('common.stationPicker.fallbackLabel');

  return (
    <>
      <div ref={triggerRef} style={{ position: 'relative', display: 'inline-block' }}>
        <StationPickerTrigger
          token={token}
          open={open}
          hovered={triggerHovered}
          label={displayLabel}
          status={currentStatus}
          statusText={statusLabel(currentStatus, t)}
          triggerLabel={t('common.stationPicker.triggerLabel')}
          onToggle={() => setOpen(!open)}
          onMouseEnter={() => setTriggerHovered(true)}
          onMouseLeave={() => setTriggerHovered(false)}
        />
      </div>

      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: panelPos.top,
            left: panelPos.left,
            transform: panelPos.openRight ? 'translate(0, -100%)' : 'translate(-100%, -100%)',
            width: PANEL_WIDTH,
            background: token.colorBgElevated,
            borderRadius: 8,
            boxShadow: `0 18px 48px rgba(15, 23, 42, 0.16), 0 0 0 1px ${token.colorBorderSecondary}`,
            padding: 10,
            zIndex: 10000,
          }}
        >
          <div style={{ padding: '4px 6px 10px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: token.colorText }}>
              {t('common.stationPicker.title')}
            </div>
            <div style={{ marginTop: 2, fontSize: 11, color: token.colorTextQuaternary }}>
              {t('common.stationPicker.subtitle')}
            </div>
          </div>

          <div style={{ maxHeight: 276, overflowY: 'auto', paddingRight: 2 }}>
            {entries.map((entry) => (
              <StationRow
                key={entry.station_peer_id}
                entry={entry}
                active={entry.station_peer_id === activeStationPeerId}
                hovered={entry.station_peer_id === hoveredStationPeerId}
                checking={entry.station_peer_id === checkingStationPeerId}
                copiedEndpoint={copiedEndpoint}
                token={token}
                directLabel={t('common.stationPicker.direct')}
                relayLabel={t('common.stationPicker.viaRelay')}
                verifyLabel={t('common.stationPicker.verify')}
                removeLabel={t('common.stationPicker.removeLabel', {
                  station: entry.display_name || shortPeerId(entry.station_peer_id),
                })}
                copyLabel={t('common.stationPicker.copyEndpoint')}
                statusText={statusLabel(
                  checkingStationPeerId === entry.station_peer_id
                    ? 'checking'
                    : statusFromRoute(activeRoute(entry)),
                  t,
                )}
                onSelect={(route) => void selectRoute(entry, route)}
                onProbe={(event) => void probeStation(entry, event)}
                onCopy={(route, event) => void handleCopy(route, event)}
                onRemove={(event) => void handleRemove(entry, event)}
                onMouseEnter={() => setHoveredStationPeerId(entry.station_peer_id)}
                onMouseLeave={() => setHoveredStationPeerId(null)}
              />
            ))}
            {entries.length === 0 && (
              <div style={{ padding: 18, fontSize: 12, color: token.colorTextQuaternary, textAlign: 'center' }}>
                {t('common.stationPicker.empty')}
              </div>
            )}
          </div>

          <div style={{ height: 1, background: token.colorBorderSecondary, margin: '10px 4px' }} />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: 4,
              background: inputFocused ? token.colorBgContainer : token.colorFillQuaternary,
              border: `1px solid ${inputFocused ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
              borderRadius: 8,
              boxShadow: inputFocused ? `0 0 0 3px ${token.colorPrimaryBg}` : 'none',
            }}
          >
            <input
              type="text"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleAdd();
              }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder={t('common.stationPicker.placeholder')}
              disabled={adding}
              aria-label={t('common.stationPicker.inputLabel')}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '7px 8px',
                fontSize: 12,
                fontFamily: 'inherit',
                background: 'transparent',
                border: 'none',
                color: token.colorText,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={adding || !inputValue.trim()}
              aria-label={t('common.stationPicker.addLabel')}
              title={t('common.stationPicker.addLabel')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                background: token.colorPrimary,
                border: 'none',
                borderRadius: 7,
                cursor: adding || !inputValue.trim() ? 'not-allowed' : 'pointer',
                opacity: adding || !inputValue.trim() ? 0.5 : 1,
                flexShrink: 0,
              }}
            >
              {adding ? <Loader2 size={14} color="#fff" /> : <Plus size={14} color="#fff" />}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function StationPickerTrigger(props: {
  token: DesignToken;
  open: boolean;
  hovered: boolean;
  label: string;
  status: StationHealthStatus;
  statusText: string;
  triggerLabel: string;
  onToggle: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const { token, open, hovered, label, status, statusText } = props;
  return (
    <button
      type="button"
      data-station-picker-trigger
      onClick={props.onToggle}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
      aria-label={props.triggerLabel}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: TRIGGER_WIDTH,
        padding: '6px 10px',
        background: hovered || open ? token.colorFillQuaternary : token.colorBgContainer,
        border: `1px solid ${open ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
        borderRadius: 8,
        boxShadow: open ? `0 0 0 3px ${token.colorPrimaryBg}` : 'none',
        cursor: 'pointer',
        color: hovered || open ? token.colorText : token.colorTextSecondary,
        fontSize: 12,
        fontFamily: 'inherit',
      }}
    >
      <Server size={14} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
        {label}
      </span>
      {status === 'unknown' ? (
        <span aria-hidden="true" style={{ width: TRIGGER_STATUS_SLOT_SIZE, height: TRIGGER_STATUS_SLOT_SIZE }} />
      ) : (
        <StationStatus status={status} token={token} label={statusText} compact />
      )}
    </button>
  );
}

function StationRow(props: {
  entry: StationEntry;
  active: boolean;
  hovered: boolean;
  checking: boolean;
  copiedEndpoint: string | null;
  token: DesignToken;
  directLabel: string;
  relayLabel: string;
  verifyLabel: string;
  removeLabel: string;
  copyLabel: string;
  statusText: string;
  onSelect: (route: StationRouteCandidate) => void;
  onProbe: (event: ReactMouseEvent) => void;
  onCopy: (route: StationRouteCandidate, event: ReactMouseEvent) => void;
  onRemove: (event: ReactMouseEvent) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const { entry, token } = props;
  const route = activeRoute(entry);
  const title = entry.display_name || shortPeerId(entry.station_peer_id);
  const status = props.checking ? 'checking' : statusFromRoute(route);
  return (
    <div
      data-station-peer-id={entry.station_peer_id}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
      style={{
        padding: 9,
        marginBottom: 5,
        background: props.active ? token.colorPrimaryBg : props.hovered ? token.colorFillQuaternary : 'transparent',
        border: `1px solid ${props.active ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StationStatus
          status={status}
          token={token}
          label={props.statusText}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 650 }}>
            {title}
          </div>
          <div style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, color: token.colorTextQuaternary }}>
            {shortPeerId(entry.station_peer_id)}
          </div>
        </div>
        <IconAction
          visible={props.hovered || props.checking}
          label={props.verifyLabel}
          token={token}
          onClick={props.onProbe}
          icon={<Loader2 size={13} style={props.checking ? { animation: 'spin 1s linear infinite' } : undefined} />}
        />
        {!props.active && (
          <IconAction
            visible={props.hovered}
            label={props.removeLabel}
            token={token}
            onClick={props.onRemove}
            icon={<Trash2 size={13} />}
          />
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        {entry.routes.map((candidate) => {
          const selected = props.active && candidate.route_id === entry.active_route_id;
          const label = candidate.route_type === 'direct'
            ? props.directLabel
            : props.relayLabel;
          return (
            <button
              type="button"
              key={candidate.route_id}
              data-station-route-id={candidate.route_id}
              data-station-route-type={candidate.route_type}
              onClick={() => props.onSelect(candidate)}
              aria-pressed={selected}
              title={candidate.endpoint_origin}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                minWidth: 0,
                padding: '5px 7px',
                border: `1px solid ${selected ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
                borderRadius: 6,
                background: selected ? token.colorBgContainer : 'transparent',
                color: selected ? token.colorPrimary : token.colorTextSecondary,
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: 'inherit',
              }}
            >
              {candidate.route_type === 'direct' ? <Wifi size={12} /> : <RadioTower size={12} />}
              <span>{label}</span>
              {selected && <Check size={11} />}
            </button>
          );
        })}
        {route && (
          <IconAction
            visible
            active={props.copiedEndpoint === route.endpoint_origin}
            label={props.copyLabel}
            token={token}
            onClick={(event) => props.onCopy(route, event)}
            icon={props.copiedEndpoint === route.endpoint_origin ? <Check size={13} /> : <Copy size={13} />}
          />
        )}
      </div>
    </div>
  );
}

function IconAction(props: {
  visible: boolean;
  active?: boolean;
  label: string;
  token: DesignToken;
  icon: ReactNode;
  onClick: (event: ReactMouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        border: 'none',
        borderRadius: 6,
        background: props.visible ? props.token.colorFillSecondary : 'transparent',
        color: props.active ? props.token.colorSuccess : props.visible ? props.token.colorTextSecondary : 'transparent',
        cursor: props.visible ? 'pointer' : 'default',
        pointerEvents: props.visible ? 'auto' : 'none',
        flexShrink: 0,
      }}
    >
      {props.icon}
    </button>
  );
}

function StationStatus(props: {
  status: StationHealthStatus;
  token: DesignToken;
  label: string;
  compact?: boolean;
}) {
  const { status, token, label, compact = false } = props;
  if (status === 'checking') {
    return <Loader2 size={compact ? 12 : 14} aria-label={label} style={{ color: token.colorPrimary, flexShrink: 0 }} />;
  }
  const fill = status === 'online'
    ? token.colorSuccess
    : status === 'offline'
      ? token.colorError
      : token.colorTextQuaternary;
  return (
    <span
      aria-label={label}
      title={label}
      style={{
        width: compact ? 12 : 16,
        height: compact ? 12 : 16,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span style={{ width: compact ? 7 : 9, height: compact ? 7 : 9, borderRadius: 999, background: fill }} />
    </span>
  );
}

function activeRoute(entry: StationEntry): StationRouteCandidate | undefined {
  return entry.routes.find((route) => route.route_id === entry.active_route_id);
}

function statusFromRoute(route?: StationRouteCandidate): StationHealthStatus {
  if (!route) return 'unknown';
  const mapping: Record<StationRouteHealth, StationHealthStatus> = {
    available: 'online',
    degraded: 'offline',
    unavailable: 'offline',
    revoked: 'offline',
  };
  return mapping[route.health];
}

function mergeDiscoveredEntries(
  current: StationEntry[],
  discovered: StationEntry[],
): StationEntry[] {
  const replacements = new Map(
    discovered.map((entry) => [entry.station_peer_id, entry]),
  );
  const merged = current.map(
    (entry) => replacements.get(entry.station_peer_id) ?? entry,
  );
  for (const entry of discovered) {
    if (!current.some((candidate) => candidate.station_peer_id === entry.station_peer_id)) {
      merged.push(entry);
    }
  }
  return merged;
}

function shortPeerId(value?: string): string {
  const peerId = value?.trim() ?? '';
  if (peerId.length <= 22) return peerId;
  return `${peerId.slice(0, 10)}...${peerId.slice(-8)}`;
}

function statusLabel(
  status: StationHealthStatus,
  translate: (key: string) => string,
): string {
  return translate(`common.stationPicker.status.${status}`);
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand('copy')) throw new Error('clipboard copy command failed');
  } finally {
    document.body.removeChild(textarea);
  }
}
