import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Modal, Spin, Typography } from 'antd';
import type { MobileAuthSession } from '../../features/auth/authSession';
import { useMobileI18n } from '../../app/mobileI18n';
import { MobileNotice } from '../../components/MobileNotice';
import { BoundedList } from '../../components/BoundedList';
import { ActorDeviceStatus, type ActorDevice } from '../../gen/proto/domain/actor/actor_pb';
import { configureNativePin, pinErrorKey, readNativePin, type NativePinStatus } from '../../services/nativePin';
import { createSecurityGateway } from '../../services/gateways/securityGateway';
import { SettingsExitBoundary } from './SettingsExitBoundary';
import { useSettingsRequests } from './useSettingsRequests';
import { RecoverySection } from './RecoverySection';

function usePinController(session: MobileAuthSession | null) {
  const scope = useMemo(() => session ? {
    stationPeerId: session.stationPeerId, actorPtid: session.actorRef.ptid,
  } : null, [session]);
  const [status, setStatus] = useState<NativePinStatus | null>(null);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discard = () => { setCurrentPin(''); setNewPin(''); setConfirmation(''); setError(null); };
  const reload = useCallback(async () => {
    if (!scope) return;
    try { setStatus(await readNativePin(scope)); setError(null); }
    catch (failure) { setError(pinErrorKey(failure)); }
  }, [scope]);
  useEffect(() => { void reload(); }, [reload]);
  const save = async (remove = false) => {
    if (!scope || busy) return false;
    if (!remove && newPin !== confirmation) { setError('mobile.settings.security.pinMismatch'); return false; }
    setBusy(true);
    setError(null);
    try {
      const next = await configureNativePin({ ...scope, currentPin, newPin, remove });
      setStatus(next);
      discard();
      return true;
    } catch (failure) {
      setError(pinErrorKey(failure));
      return false;
    } finally { setBusy(false); }
  };
  return {
    status, currentPin, newPin, confirmation, busy, error,
    setCurrentPin, setNewPin, setConfirmation, reload, discard, save,
    owner: {
      dirty: Boolean(currentPin || newPin || confirmation), conflict: false,
      saveStatus: busy ? 'saving' : 'idle', saveError: error,
      save: () => save(), discard, reload,
    },
  };
}

function DeviceSection({ session }: { session: MobileAuthSession }) {
  const { t } = useMobileI18n();
  const gateway = useMemo(() => createSecurityGateway(session), [session]);
  const requests = useSettingsRequests(gateway);
  const [devices, setDevices] = useState<ActorDevice[] | null>(null);
  const [selected, setSelected] = useState<ActorDevice | null>(null);
  const reload = useCallback(async () => {
    const result = await requests.run((signal) => gateway.listDevices(signal));
    if (result) setDevices(result.devices);
  }, [gateway, requests.run]);
  useEffect(() => { void reload(); }, [reload]);
  const revoke = async () => {
    const device = selected;
    setSelected(null);
    if (!device) return;
    const result = await requests.run(async (signal) => {
      await gateway.revokeDevice(device, signal);
      return gateway.listDevices(signal);
    }, true);
    if (result) setDevices(result.devices);
  };
  return <Card className="settings-section" variant="borderless">
    <div className="settings-section-heading"><Typography.Text strong>{t('mobile.settings.security.devices')}</Typography.Text>
      <Button loading={requests.busy} onClick={() => void reload()}>{t('common.action.refresh')}</Button></div>
    {requests.error ? <MobileNotice>{t(requests.error)}</MobileNotice> : null}
    {devices === null && !requests.error ? <Spin /> : null}
    <BoundedList surfaceKey="settings:devices" items={devices ?? []} itemKey={(device) => device.ref?.deviceId ?? ''} size={40}>
      {(items) => items.map((device) => {
        const current = device.ref?.deviceId === session.deviceId;
        const revoked = device.status === ActorDeviceStatus.REVOKED;
        return <div className="settings-device-row" key={device.ref?.deviceId} data-device-id={device.ref?.deviceId}>
          <div><Typography.Text strong>{device.label || t('mobile.settings.security.device')}</Typography.Text>
            <Typography.Paragraph type="secondary">{t(current ? 'mobile.settings.security.currentDevice'
              : revoked ? 'mobile.settings.security.revoked' : 'mobile.settings.security.authorized')}</Typography.Paragraph></div>
          {!current && !revoked ? <Button danger disabled={requests.busy} onClick={() => setSelected(device)}>
            {t('common.action.remove')}</Button> : null}
        </div>;
      })}
    </BoundedList>
    <Modal open={selected !== null} title={t('mobile.settings.security.removeDevice')} okButtonProps={{ danger: true }}
      okText={t('common.action.remove')} cancelText={t('common.action.cancel')} onOk={() => void revoke()}
      onCancel={() => setSelected(null)} destroyOnHidden>{t('mobile.settings.security.removeDeviceBody')}</Modal>
  </Card>;
}

export function SecurityDetail({ session, onBack }: { session: MobileAuthSession | null; onBack: () => void }) {
  const { t } = useMobileI18n();
  const pin = usePinController(session);
  const [confirmRemove, setConfirmRemove] = useState(false);
  return <SettingsExitBoundary title={t('mobile.settings.security.title')} settingId="security" owner={pin.owner} onBack={onBack}>
    <Card className="settings-section" variant="borderless">
      <Typography.Text strong>{t('mobile.settings.security.pin')}</Typography.Text>
      <Typography.Paragraph type="secondary">{t('mobile.settings.security.pinBody')}</Typography.Paragraph>
      {!pin.status && !pin.error ? <Spin /> : null}
      {pin.error ? <MobileNotice>{t(pin.error)}</MobileNotice> : null}
      <div className="settings-security-form">
        {pin.status?.configured ? <label>{t('mobile.settings.security.currentPin')}
          <Input.Password value={pin.currentPin} inputMode="numeric" autoComplete="off" maxLength={16}
            data-pin-field="current" onChange={(event) => pin.setCurrentPin(event.target.value)} disabled={pin.busy} />
        </label> : null}
        <label>{t('mobile.settings.security.newPin')}
          <Input.Password value={pin.newPin} inputMode="numeric" autoComplete="off" maxLength={16}
            data-pin-field="new" onChange={(event) => pin.setNewPin(event.target.value)} disabled={pin.busy} />
        </label>
        <label>{t('mobile.settings.security.confirmPin')}
          <Input.Password value={pin.confirmation} inputMode="numeric" autoComplete="off" maxLength={16}
            data-pin-field="confirm" onChange={(event) => pin.setConfirmation(event.target.value)} disabled={pin.busy} />
        </label>
        <Button type="primary" block loading={pin.busy} disabled={!pin.status || pin.newPin.length < 4}
          data-pin-action="save" onClick={() => void pin.save()}>{t('common.action.save')}</Button>
        {pin.status?.configured ? <Button danger block disabled={pin.busy || !pin.currentPin}
          data-pin-action="remove" onClick={() => setConfirmRemove(true)}>{t('mobile.settings.security.removePin')}</Button> : null}
      </div>
    </Card>
    {session ? <><RecoverySection session={session} /><DeviceSection session={session} /></> : null}
    <Modal open={confirmRemove} title={t('mobile.settings.security.removePin')} okButtonProps={{ danger: true }}
      okText={t('common.action.remove')} cancelText={t('common.action.cancel')} onOk={() => {
        setConfirmRemove(false); void pin.save(true);
      }} onCancel={() => setConfirmRemove(false)} destroyOnHidden>{t('mobile.settings.security.removePinBody')}</Modal>
  </SettingsExitBoundary>;
}
