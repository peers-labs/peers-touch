import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Icon, IconButton, Popover, TextField } from '@peers-touch/ui';
import { api } from '../../services/desktop_api';
import type {
  StationEntry,
  StationRouteCandidate,
  StationRouteHealth,
} from '../../services/desktop_api';
import { markStationUserChoice } from '../../services/stationDefault';
import { log } from '../../utils/logger';

type StationHealthStatus = 'unknown' | 'checking' | 'online' | 'offline';

interface AddFeedback {
  tone: 'success' | 'danger';
  text: string;
}

/**
 * Compact Station control embedded in the auth card footer. The trigger shows
 * only the active Station's friendly short id + reachability (never a raw
 * host); the popover lists registered Stations, switches the active one, and
 * accepts a manually entered Station URL. Cloud X-Config suggestions are out
 * of scope for the calm auth surface.
 */
export function StationSwitcher() {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<StationEntry[]>([]);
  const [activeStationPeerId, setActiveStationPeerId] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [feedback, setFeedback] = useState<AddFeedback | null>(null);

  const loadStations = useCallback(async () => {
    try {
      const result = await api.stationList();
      setEntries(result.entries ?? []);
      setActiveStationPeerId(result.active_station_peer_id ?? '');
    } catch (error) {
      log.warn('StationSwitcher', 'Failed to load Station registry', { error });
    }
  }, []);

  useEffect(() => {
    void loadStations();
  }, [loadStations]);

  useEffect(() => {
    if (open) void loadStations();
  }, [open, loadStations]);

  const selectRoute = useCallback(
    async (entry: StationEntry, route: StationRouteCandidate) => {
      const current = entries.find(
        (candidate) => candidate.station_peer_id === activeStationPeerId,
      );
      if (
        current &&
        current.station_peer_id !== entry.station_peer_id &&
        !window.confirm(t('common.stationPicker.confirmStationChange'))
      ) {
        return;
      }
      try {
        const result = await api.stationSetActive(entry.station_peer_id, route.route_id);
        markStationUserChoice();
        setActiveStationPeerId(result.active_station_peer_id ?? entry.station_peer_id);
        setEntries((currentEntries) =>
          currentEntries.map((candidate) =>
            candidate.station_peer_id === entry.station_peer_id
              ? {
                  ...candidate,
                  active_route_id: result.active_route_id ?? route.route_id,
                  route_revision: result.binding.route_revision,
                  lifecycle_generation: result.binding.lifecycle_generation,
                }
              : candidate,
          ),
        );
      } catch (error) {
        log.error('StationSwitcher', 'Failed to select Station', {
          stationPeerId: entry.station_peer_id,
          routeId: route.route_id,
          error,
        });
      }
    },
    [activeStationPeerId, entries, t],
  );

  const handleAdd = useCallback(async () => {
    const input = inputValue.trim();
    if (!input || adding) return;
    setAdding(true);
    setFeedback(null);
    try {
      const discovered = await api.stationAdd(input);
      const discoveredEntry = discovered.entries[0];
      const alreadyKnown = discoveredEntry
        ? entries.some(
            (candidate) => candidate.station_peer_id === discoveredEntry.station_peer_id,
          )
        : false;
      setInputValue('');
      await loadStations();
      if (
        discovered.entries.length === 1 &&
        discovered.entries[0]?.routes.length === 1
      ) {
        const entry = discovered.entries[0];
        const route = entry.routes[0];
        if (entry && route) {
          await selectRoute(entry, route);
        }
      }
      setFeedback({
        tone: 'success',
        text: alreadyKnown
          ? t('common.stationPicker.addAlreadyPresent')
          : t('common.stationPicker.addSuccess'),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      setFeedback({
        tone: 'danger',
        text: detail
          ? t('common.stationPicker.addFailedWithReason', { reason: detail })
          : t('common.stationPicker.addFailed'),
      });
    } finally {
      setAdding(false);
    }
  }, [adding, entries, inputValue, loadStations, selectRoute, t]);

  const handleRemove = useCallback(
    async (entry: StationEntry) => {
      markStationUserChoice();
      try {
        await api.stationRemove(entry.station_peer_id);
        await loadStations();
      } catch (error) {
        log.error('StationSwitcher', 'Failed to remove Station', {
          stationPeerId: entry.station_peer_id,
          error,
        });
      }
    },
    [loadStations],
  );

  const activeEntry =
    entries.find((entry) => entry.station_peer_id === activeStationPeerId) ??
    (entries.length === 1 ? entries[0] : undefined);
  const activeRoute = activeEntry ? routeOf(activeEntry) : undefined;
  const activeStatus = statusFromRoute(activeRoute);
  const activeLabel =
    activeEntry?.display_name ||
    shortPeerId(activeEntry?.station_peer_id) ||
    t('common.stationPicker.fallbackLabel');

  const panel = (
    <div className="pt-station-panel">
      <div className="pt-station-panel-title">{t('common.stationPicker.title')}</div>
      <div className="pt-station-list">
        {entries.map((entry) => {
          const route = routeOf(entry);
          const isActive = entry.station_peer_id === activeStationPeerId;
          const status = statusFromRoute(route);
          const name = entry.display_name || shortPeerId(entry.station_peer_id);
          return (
            <div key={entry.station_peer_id} className="pt-station-row" style={{ display: 'flex', gap: 4 }}>
              <Button
                actionId={`auth.station.select.${entry.station_peer_id}`}
                fullWidth
                emphasis={isActive ? 'secondary' : 'quiet'}
                className="pt-station-row"
                leading={<span className="pt-station-dot" data-status={status} />}
                trailing={isActive ? <Icon iconId="check" size={14} /> : undefined}
                onActivate={() => route && void selectRoute(entry, route)}
              >
                <span className="pt-station-meta">
                  <span>
                    {name}
                    <span className="pt-station-row-endpoint">
                      {route?.endpoint_origin}
                    </span>
                  </span>
                </span>
              </Button>
              {!isActive && (
                <IconButton
                  actionId={`auth.station.remove.${entry.station_peer_id}`}
                  iconId="delete"
                  label={t('common.stationPicker.removeLabel', { station: name })}
                  emphasis="quiet"
                  density="compact"
                  onActivate={() => void handleRemove(entry)}
                />
              )}
            </div>
          );
        })}
        {entries.length === 0 && (
          <div style={{ padding: '10px 4px', fontSize: 12, color: 'var(--pt-secondary)', textAlign: 'center' }}>
            {t('common.stationPicker.empty')}
          </div>
        )}
      </div>
      <div className="pt-station-add">
        <TextField
          aria-label={t('common.stationPicker.inputLabel')}
          placeholder={t('common.stationPicker.placeholder')}
          value={inputValue}
          disabled={adding}
          leading={<Icon iconId="server" size={15} />}
          onValueChange={(value) => {
            setInputValue(value);
            if (feedback) setFeedback(null);
          }}
          onEnter={() => void handleAdd()}
        />
        <IconButton
          actionId="auth.station.add"
          iconId="plus"
          label={t('common.stationPicker.addLabel')}
          emphasis="primary"
          availability={!inputValue.trim()
            ? { kind: 'disabled', reason: t('common.stationPicker.placeholder') }
            : undefined}
          onActivate={() => void handleAdd()}
        />
      </div>
      {feedback && <Alert tone={feedback.tone} title={feedback.text} />}
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="top"
      label={t('common.stationPicker.title')}
      content={panel}
    >
      <Button
        actionId="auth.station.switch"
        fullWidth
        emphasis="secondary"
        className="pt-auth-station-trigger"
        aria-label={t('common.stationPicker.triggerLabel')}
        leading={<span className="pt-station-dot" data-status={activeStatus} />}
        trailing={<Icon iconId="route" size={15} />}
      >
        <span className="pt-station-meta">
          <Icon iconId="server" size={15} />
          <span className="pt-station-name">{activeLabel}</span>
        </span>
      </Button>
    </Popover>
  );
}

function routeOf(entry: StationEntry): StationRouteCandidate | undefined {
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

function shortPeerId(value?: string): string {
  const peerId = value?.trim() ?? '';
  if (peerId.length <= 22) return peerId;
  return `${peerId.slice(0, 10)}...${peerId.slice(-8)}`;
}
