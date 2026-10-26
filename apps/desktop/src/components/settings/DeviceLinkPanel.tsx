import { Button, Modal } from '@lobehub/ui';
import { Schema } from '@peers-touch/schema';
import { Typography, Radio, Spin, theme } from 'antd';
import { Smartphone, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useDeviceLinkStore } from '../../store/deviceLink';
import { useSessionStore } from '../../store/session';
import { deviceLinkActions } from '../../runtimes/deviceLinkRuntime';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { SettingsSection } from './SettingsLayout';

export function DeviceLinkPanel() {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const open = useDeviceLinkStore((s) => s.open);
  const busy = useDeviceLinkStore((s) => s.busy);
  const error = useDeviceLinkStore((s) => s.error);
  const projection = useDeviceLinkStore((s) => s.projection);
  const avatar = useDeviceLinkStore((s) => s.avatar);
  const selectedId = useDeviceLinkStore((s) => s.selectedClaimId);
  const user = useSessionStore((s) => s.currentUser);
  const [failedQrOffer, setFailedQrOffer] = useState<string | null>(null);
  const qrFailed = !!projection && failedQrOffer === projection.offerId;
  const selected = projection?.claims.find((claim) => claim.id === selectedId);
  const complete = projection?.state === 8;
  const terminal = (projection?.state ?? 0) >= 9;
  const waiting = !!projection && projection.state >= 3 && projection.state < 8;
  const parsed = projection?.qrLink ? Schema.parse(projection.qrLink) : null;
  const content = parsed?.status === 'recognized' && parsed.link.kind === 'action' ? parsed.link : null;
  const label = (key: string) => t(`provider.deviceLink.${key}`);

  return (
    <SettingsSection title={label('devices')} subtitle={label('description')}>
      <div>
        <Button icon={<Smartphone size={16} />} onClick={() => { void deviceLinkActions.start(); }}>
          {label('start')}
        </Button>
      </div>
      {open && (
        <Modal open title={label('start')} width={440} footer={null}
          onCancel={() => { void deviceLinkActions.close(); }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: token.marginMD, paddingBlock: token.paddingSM, minWidth: 0 }}>
            <UserSquareAvatar name={user?.name} remoteUrl={user?.avatarUrl} size={48} />
            <Typography.Text strong style={{ maxWidth: '100%', overflowWrap: 'anywhere', textAlign: 'center' }}>
              {user?.name}
            </Typography.Text>
            <Typography.Text type="secondary">
              {projection?.stationName || label('station')}
            </Typography.Text>
            <div data-pt-device-link-code style={{ width: '100%', maxWidth: 360, aspectRatio: '1',
              display: 'grid', placeItems: 'center', background: token.colorBgContainer,
              borderRadius: token.borderRadiusLG, overflow: 'hidden' }}>
              {complete ? <CheckCircle2 size={48} color={token.colorSuccess} /> :
                terminal ? <Typography.Text>{label('expired')}</Typography.Text> :
                content ? <Schema.QRCode content={content} title={label('qrLabel')}
                  onError={() => setFailedQrOffer(projection!.offerId)}
                  errorLabel={label('qrFailed')} constraints={{ size: 360, style: 'peers',
                    maxVersion: 24, minModulePixels: 3,
                    ...(avatar ? { avatar: { asset: avatar, shape: 'rounded' as const } } : {}) }} /> :
                waiting ? <Smartphone size={48} color={token.colorPrimary} /> : <Spin />}
            </div>
            <div role="status" aria-live="polite" style={{ textAlign: 'center', minHeight: token.fontSize * 2 }}>
              {complete ? label('complete') : terminal ? label('expired') :
                waiting ? label('finishing') : selected ? label('approvePrompt') : label('scanHint')}
            </div>
            {projection && projection.claims.length > 1 && (
              <Radio.Group value={selectedId} onChange={(e) => deviceLinkActions.select(e.target.value)}
                style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: token.marginSM }}>
                {projection.claims.map((claim) => (
                  <Radio key={claim.id} value={claim.id}>
                    {claim.deviceLabel || label(claim.platform)}
                  </Radio>
                ))}
              </Radio.Group>
            )}
            {selected && (
              <>
                <Typography.Text>{selected.deviceLabel || label(selected.platform)}</Typography.Text>
                <Typography.Text style={{ fontSize: token.fontSizeHeading2, letterSpacing: '0.16em',
                  fontVariantNumeric: 'tabular-nums' }} aria-label={`${label('comparison')} ${selected.comparisonCode}`}>
                  {selected.comparisonCode}
                </Typography.Text>
                <Typography.Text type="secondary">{label('compareHint')}</Typography.Text>
                <Button block type="primary" loading={busy}
                  onClick={() => { void deviceLinkActions.decide(selected, true); }}>{label('allow')}</Button>
                <Button block disabled={busy}
                  onClick={() => { void deviceLinkActions.decide(selected, false); }}>{label('deny')}</Button>
              </>
            )}
            {error && <Typography.Text role="alert" type="danger">{label('failed')}</Typography.Text>}
            {(complete || terminal || qrFailed || (error && !projection)) && (
              <Button block type="primary" loading={busy}
                onClick={() => { void deviceLinkActions.start(); }}>
                {complete ? label('addAnother') : label('refresh')}
              </Button>
            )}
            {error && projection && !terminal && !complete && (
              <Button block disabled={busy} onClick={() => { void deviceLinkActions.retry(); }}>{label('retry')}</Button>
            )}
          </div>
        </Modal>
      )}
    </SettingsSection>
  );
}
