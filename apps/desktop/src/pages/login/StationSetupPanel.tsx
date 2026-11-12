import { useTranslation } from 'react-i18next';
import { Alert, Button, Icon, IconButton, TextField } from '@peers-touch/ui';

import type { useStationRegistry } from './useStationRegistry';

type StationRegistry = ReturnType<typeof useStationRegistry>;

interface StationSetupPanelProps {
  registry: StationRegistry;
  /**
   * First-run guidance shown above the list when the card is the automatic
   * gate (not when re-opened from the gear). Undefined renders nothing extra.
   */
  autoHint?: string;
  /**
   * Back control rendered at the top of the card when the panel is opened
   * from the gear (a deliberate re-configuration). Undefined on the
   * automatic first-run gate, where leaving is impossible until a Station
   * exists.
   */
  onBack?: () => void;
}

/**
 * Station configuration surface shared by the inline first-run gate card and
 * the gear popover. Pure presentation — all data and mutations come from
 * `useStationRegistry`, so both entry points stay behavior-identical.
 */
export function StationSetupPanel({ registry, autoHint, onBack }: StationSetupPanelProps) {
  const { t } = useTranslation('common');
  const {
    entries,
    activeStationPeerId,
    inputValue,
    setInputValue,
    adding,
    feedback,
    selectRoute,
    handleAdd,
    handleRemove,
    clearFeedback,
  } = registry;

  return (
    <div className="pt-station-panel" data-pt-station-setup>
      {onBack && (
        <Button
          actionId="auth.station.back"
          emphasis="quiet"
          density="compact"
          className="pt-station-panel__back"
          onActivate={onBack}
          leading={<Icon iconId="arrow-left" size={14} />}
        >
          <span style={{ fontSize: 12 }}>{t('common.stationPicker.back')}</span>
        </Button>
      )}
      <div className="pt-station-panel-title">{t('common.stationPicker.title')}</div>
      {autoHint && (
        <p className="pt-station-panel__hint">{autoHint}</p>
      )}
      <div className="pt-station-list">
        {entries.map((entry) => {
          const route = entry.routes.find((r) => r.route_id === entry.active_route_id);
          const isActive = entry.station_peer_id === activeStationPeerId;
          const status = route
            ? ({
                available: 'online',
                degraded: 'offline',
                unavailable: 'offline',
                revoked: 'offline',
              } as const)[route.health]
            : 'unknown';
          const name = entry.display_name || entry.station_peer_id;
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
          <div className="pt-station-panel__empty">
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
            clearFeedback();
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
}
