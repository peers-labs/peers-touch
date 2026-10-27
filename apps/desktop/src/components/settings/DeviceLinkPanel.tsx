import { Button, Modal } from '@lobehub/ui';
import { Schema } from '@peers-touch/schema';
import { Typography, Radio, Spin, theme } from 'antd';
import { Smartphone, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState, type CSSProperties } from 'react';
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
  const showQr = !complete && !terminal && !waiting && !selected;
  const status = complete ? label('complete') : terminal ? label('expired')
    : waiting ? label('finishing') : selected ? label('approvePrompt') : label('scanHint');
  // One fixed stage hosts every phase. Only one phase layer renders at a
  // time and every layer uses the same geometry, so swapping QR -> code ->
  // spinner -> result never resizes the modal or shifts the controls below
  // it (instant swap keeps the transition meaningful with motion disabled).
  const stageHeight = 280;
  const stageStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: token.marginXS,
    overflow: 'auto',
    paddingBlock: token.paddingXS,
  };

  return (
    <SettingsSection title={label('devices')} subtitle={label('description')}>
      <div>
        <Button icon={<Smartphone size={16} />} onClick={() => { void deviceLinkActions.start(); }}>
          {label('start')}
        </Button>
      </div>
      {open && (
        <Modal open title={label('start')} width={360} footer={null}
          styles={{ body: { display: 'grid', gap: token.marginSM, paddingBlock: token.paddingSM } }}
          onCancel={() => { void deviceLinkActions.close(); }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: token.marginSM, minWidth: 0 }}>
            <UserSquareAvatar name={user?.name} remoteUrl={user?.avatarUrl} size={32} />
            <div style={{ minWidth: 0, display: 'grid', gap: 2 }}>
              <Typography.Text strong ellipsis style={{ maxWidth: 260 }}>
                {user?.name}
              </Typography.Text>
              <Typography.Text type="secondary" ellipsis style={{ fontSize: token.fontSizeSM, maxWidth: 260 }}>
                {projection?.stationName || label('station')}
              </Typography.Text>
            </div>
          </div>

          <div style={{ position: 'relative', height: stageHeight, width: '100%' }}>
            {showQr && (
              <div style={stageStyle} data-pt-device-link-stage="qr">
                <div data-pt-device-link-code style={{ width: 280, height: 280, display: 'grid', placeItems: 'center',
                  background: token.colorBgContainer, borderRadius: token.borderRadiusLG, overflow: 'hidden' }}>
                  {qrFailed ? <Typography.Text type="danger" style={{ textAlign: 'center' }}>{label('qrFailed')}</Typography.Text> :
                    content ? <Schema.QRCode content={content} title={label('qrLabel')}
                      onError={() => setFailedQrOffer(projection!.offerId)}
                      errorLabel={label('qrFailed')}
                      constraints={{ size: 280, style: 'peers', maxVersion: 17, minModulePixels: 3 }} /> :
                    <Spin size="small" />}
                </div>
              </div>
            )}

            {selected && !waiting && !complete && !terminal && (
              <div style={stageStyle} data-pt-device-link-stage="approve">
                {projection && projection.claims.length > 1 && (
                  <Radio.Group value={selectedId} size="small"
                    onChange={(event) => deviceLinkActions.select(event.target.value)}
                    style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
                    {projection.claims.map((claim) => (
                      <Radio key={claim.id} value={claim.id}>
                        {claim.deviceLabel || label(claim.platform)}
                      </Radio>
                    ))}
                  </Radio.Group>
                )}
                <Typography.Text strong>{selected.deviceLabel || label(selected.platform)}</Typography.Text>
                <Typography.Text style={{ fontSize: token.fontSizeHeading2, letterSpacing: '0.16em',
                  fontVariantNumeric: 'tabular-nums' }} aria-label={`${label('comparison')} ${selected.comparisonCode}`}>
                  {selected.comparisonCode}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, textAlign: 'center' }}>
                  {label('compareHint')}
                </Typography.Text>
                <div style={{ display: 'flex', gap: token.marginSM, width: '100%' }}>
                  <Button block type="primary" loading={busy}
                    onClick={() => { void deviceLinkActions.decide(selected, true); }}>{label('allow')}</Button>
                  <Button block disabled={busy}
                    onClick={() => { void deviceLinkActions.decide(selected, false); }}>{label('deny')}</Button>
                </div>
              </div>
            )}

            {waiting && (
              <div style={stageStyle} data-pt-device-link-stage="finishing">
                <Spin />
              </div>
            )}

            {complete && (
              <div style={stageStyle} data-pt-device-link-stage="complete">
                <CheckCircle2 size={44} color={token.colorSuccess} />
              </div>
            )}

            {terminal && (
              <div style={stageStyle} data-pt-device-link-stage="expired">
                <Typography.Text type="secondary">{label('expired')}</Typography.Text>
              </div>
            )}
          </div>

          <div role={error ? 'alert' : 'status'} aria-live="polite"
            style={{ textAlign: 'center', minHeight: token.fontSizeSM * 1.8, fontSize: token.fontSizeSM,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: error ? token.colorError : undefined }}>
            {error ? label('failed') : status}
          </div>
          {/* Reserved slot sized to the real 36px action buttons, so footer
              presence (Done/Add another/Refresh) never changes modal height. */}
          <div style={{ display: 'flex', gap: token.marginSM, height: 36 }}>
            {complete && <>
              <Button block type="primary" onClick={() => { void deviceLinkActions.close(); }}>{label('done')}</Button>
              <Button block loading={busy} onClick={() => { void deviceLinkActions.start(); }}>{label('addAnother')}</Button>
            </>}
            {(terminal || qrFailed || (error && !projection)) && (
              <Button block type="primary" loading={busy} onClick={() => { void deviceLinkActions.start(); }}>
                {label('refresh')}
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
