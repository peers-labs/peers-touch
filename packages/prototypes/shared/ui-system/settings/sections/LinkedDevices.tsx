/**
 * LinkedDevices — authorized-device table with the simulated QR linking
 * flow (qr → comparison-code approval → finishing → complete/expired).
 *
 * Lives under Network › Your Station (desktop Settings IA). Completing a
 * link appends a real row; five rows per page and the pager/total only
 * appear beyond one page.
 */
import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Button, Dialog, IconButton, QrCode, Tag } from '@peers-touch/ui';
import { locTag, useT, type Locale } from '../../prefs';
import { SettingsSection } from '../SettingsPrimitives';
import '../settings.css';

const LINKING_DEVICE_MODEL = 'iPhone 15';
const DEVICE_PAGE_SIZE = 5;

interface LinkedDevice {
  id: string;
  model: string;
  joinedAt: number;
  lastUsedAt: number;
  current?: boolean;
}

const INITIAL_DEVICES: LinkedDevice[] = [
  { id: 'dev-1', model: 'MacBook Pro 14″', joinedAt: Date.UTC(2025, 9, 3), lastUsedAt: Date.now() - 2 * 3_600_000, current: true },
  { id: 'dev-2', model: 'iPhone 15', joinedAt: Date.UTC(2025, 9, 3), lastUsedAt: Date.now() - 26 * 3_600_000 },
  { id: 'dev-3', model: 'iPad Air', joinedAt: Date.UTC(2025, 11, 15), lastUsedAt: Date.now() - 9 * 86_400_000 },
  { id: 'dev-4', model: 'MacBook Air (Home)', joinedAt: Date.UTC(2026, 5, 20), lastUsedAt: Date.now() - 41 * 86_400_000 },
  { id: 'dev-5', model: 'Pixel 8', joinedAt: Date.UTC(2026, 7, 1), lastUsedAt: Date.now() - 63 * 86_400_000 },
  { id: 'dev-6', model: 'Web · Safari', joinedAt: Date.UTC(2025, 9, 21), lastUsedAt: Date.now() - 11 * 86_400_000 },
];

type LinkStage = 'qr' | 'approve' | 'finishing' | 'complete' | 'expired';

function formatDate(ts: number, locale: Locale): string {
  return new Date(ts).toLocaleDateString(locTag(locale), { year: 'numeric', month: 'short', day: 'numeric' });
}
function formatDateTime(ts: number, locale: Locale): string {
  return new Date(ts).toLocaleString(locTag(locale), {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function LinkedDevices() {
  const { t, locale } = useT();
  const [devices, setDevices] = useState<LinkedDevice[]>(INITIAL_DEVICES);
  const [devicePage, setDevicePage] = useState(1);
  const [linkOpen, setLinkOpen] = useState(false);
  const [stage, setStage] = useState<LinkStage>('qr');

  const devicePages = Math.max(1, Math.ceil(devices.length / DEVICE_PAGE_SIZE));
  const visibleDevices = devices.slice((devicePage - 1) * DEVICE_PAGE_SIZE, devicePage * DEVICE_PAGE_SIZE);
  const removeDevice = (id: string) => {
    setDevices(list => {
      const next = list.filter(device => device.id !== id);
      setDevicePage(page => Math.min(page, Math.max(1, Math.ceil(next.length / DEVICE_PAGE_SIZE))));
      return next;
    });
  };

  const openDeviceLink = () => { setStage('qr'); setLinkOpen(true); };
  const allow = () => {
    setStage('finishing');
    window.setTimeout(() => {
      const now = Date.now();
      setDevices(list => [{
        id: `local-${now}`, model: LINKING_DEVICE_MODEL, joinedAt: now, lastUsedAt: now,
      }, ...list]);
      setDevicePage(1);
      setStage('complete');
    }, 800);
  };

  return (
    <SettingsSection icon={Smartphone} title={t('station.authorizedDevices')} subtitle={t('station.authorizedDesc')}
      extra={
        <Button actionId="device.link-start" emphasis="secondary" density="compact" leading={<Smartphone size={14} />}
          label={t('account.linkDevice')} onActivate={openDeviceLink} />
      }>
      <div className="sk-device-list" data-device-count={devices.length}>
        <div className="sk-device-row is-head">
          <span>{t('account.deviceModel')}</span>
          <span>{t('account.deviceJoined')}</span>
          <span>{t('account.deviceLastUsed')}</span>
          <span />
        </div>
        {visibleDevices.map(device => (
          <div className="sk-device-row" key={device.id} data-device-id={device.id}>
            <span className="sk-device-model">
              <Smartphone size={14} className="sk-device-icon" />
              <strong>{device.model}</strong>
              {device.current && <Tag tone="info">{t('account.deviceCurrent')}</Tag>}
            </span>
            <span>{formatDate(device.joinedAt, locale)}</span>
            <span>{formatDateTime(device.lastUsedAt, locale)}</span>
            <span className="sk-device-op">
              {!device.current && (
                <IconButton iconId="delete" iconSize={14} density="compact" emphasis="quiet"
                  actionId={`device.remove-${device.id}`}
                  label={t('account.deviceRemoveAria', { name: device.model })}
                  onActivate={() => removeDevice(device.id)} />
              )}
            </span>
          </div>
        ))}
      </div>
      {devices.length > DEVICE_PAGE_SIZE && (
        <div className="sk-device-pager" data-device-pager>
          <span>{t('account.deviceCount', { n: devices.length })} · {t('account.devicePage', { page: devicePage, pages: devicePages })}</span>
          <span className="sk-device-pager-controls">
            <IconButton iconId="chevron-left" iconSize={14} density="compact" emphasis="quiet"
              actionId="device.page-prev" label={t('account.devicePrev')}
              availability={devicePage === 1 ? { kind: 'disabled', reason: t('doc.firstPage') } : undefined}
              onActivate={() => setDevicePage(page => Math.max(1, page - 1))} />
            <IconButton iconId="chevron-right" iconSize={14} density="compact" emphasis="quiet"
              actionId="device.page-next" label={t('account.deviceNext')}
              availability={devicePage === devicePages ? { kind: 'disabled', reason: t('doc.lastPage') } : undefined}
              onActivate={() => setDevicePage(page => Math.min(devicePages, page + 1))} />
          </span>
        </div>
      )}

      <Dialog open={linkOpen} onDismiss={() => setLinkOpen(false)} title={t('account.linkDialogTitle')} width={400}
        closeLabel={t('common.close')}
        footer={stage === 'complete'
          ? <Button actionId="device.link-done" emphasis="primary" label={t('common.done')} onActivate={() => setLinkOpen(false)} />
          : stage === 'expired'
            ? <Button actionId="device.link-refresh" emphasis="primary" label={t('account.refreshQr')} onActivate={() => setStage('qr')} />
            : undefined}>
        <div className="sk-device-stage" data-stage={stage}>
          {stage === 'qr' && (
            <>
              <QrCode value="peers-touch://device-link/offer/local-909" label={t('account.qrLabel')} size={220} />
              <p className="sk-device-hint">{t('account.qrHint')}</p>
              <Button actionId="device.link-simulate" emphasis="quiet" label={t('account.simulateScan')}
                onActivate={() => setStage('approve')} />
            </>
          )}
          {stage === 'approve' && (
            <>
              <strong>{t('account.deviceRequesting', { model: LINKING_DEVICE_MODEL })}</strong>
              <span className="sk-device-code">47 2096</span>
              <p className="sk-device-hint">{t('account.codeHint')}</p>
              <div className="sk-device-decide">
                <Button actionId="device.link-allow" emphasis="primary" label={t('common.allow')} onActivate={allow} />
                <Button actionId="device.link-deny" emphasis="secondary" label={t('common.deny')}
                  onActivate={() => setStage('expired')} />
              </div>
            </>
          )}
          {stage === 'finishing' && <span className="sk-device-status" role="status">{t('account.deviceFinishing')}</span>}
          {stage === 'complete' && <span className="sk-device-status" role="status">{t('account.deviceComplete')}</span>}
          {stage === 'expired' && <span className="sk-device-status" role="status">{t('account.deviceExpired')}</span>}
        </div>
      </Dialog>
    </SettingsSection>
  );
}
