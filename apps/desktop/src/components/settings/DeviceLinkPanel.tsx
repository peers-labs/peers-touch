import { Schema } from '@peers-touch/schema';
import { Button, Dialog, Icon, RadioGroup, Spin, Text } from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useDeviceLinkStore } from '../../store/deviceLink';
import { useSessionStore } from '../../store/session';
import { deviceLinkActions } from '../../runtimes/deviceLinkRuntime';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { SettingsSection } from './SettingsLayout';

export function DeviceLinkPanel() {
  const { t } = useTranslation('provider');
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
  // Compact references currently encode at QR v15 (77 modules). With an
  // 8-module quiet zone that is 85 columns; 340 CSS px keeps the nominal
  // module at 4 px (8 physical px at 2x), the independently decodable floor.
  const qrBox = 340;

  return (
    <SettingsSection title={label('devices')} subtitle={label('description')}>
      <div>
        <Button
          actionId="device-link-start"
          emphasis="secondary"
          density="compact"
          leading={<Icon iconId="smartphone" size={14} />}
          label={label('start')}
          onActivate={() => { void deviceLinkActions.start(); }}
        />
      </div>
      {open && (
        <Dialog
          open
          className="sc-device-link-dialog"
          title={label('start')}
          width={400}
          onDismiss={() => { void deviceLinkActions.close(); }}
        >
          <div className="sc-device-link-id">
            <UserSquareAvatar name={user?.name} remoteUrl={user?.avatarUrl} size={32} />
            <div className="sc-device-link-id-meta">
              <Text strong truncate>
                {user?.name}
              </Text>
              <Text tone="secondary" truncate className="sc-device-link-id-station">
                {projection?.stationName || label('station')}
              </Text>
            </div>
          </div>

          <div className="sc-device-link-stage">
            {showQr && (
              <div className="sc-device-link-layer" data-pt-device-link-stage="qr">
                <div className="sc-device-link-qr" data-pt-device-link-code>
                  {qrFailed ? <Text tone="danger">{label('qrFailed')}</Text> :
                    content ? <Schema.QRCode content={content} title={label('qrLabel')}
                      onError={() => setFailedQrOffer(projection!.offerId)}
                      errorLabel={label('qrFailed')}
                      constraints={{ size: qrBox, style: 'peers', maxVersion: 17, minModulePixels: 4 }} /> :
                      <Spin size="small" />}
                </div>
              </div>
            )}

            {selected && !waiting && !complete && !terminal && (
              <div className="sc-device-link-layer" data-pt-device-link-stage="approve">
                {projection && projection.claims.length > 1 && (
                  <RadioGroup
                    className="sc-device-link-claims"
                    value={selectedId ?? undefined}
                    onValueChange={(value) => deviceLinkActions.select(String(value))}
                    options={projection.claims.map((claim) => ({
                      value: claim.id,
                      label: claim.deviceLabel || label(claim.platform),
                    }))}
                  />
                )}
                <Text strong>{selected.deviceLabel || label(selected.platform)}</Text>
                <span
                  className="sc-device-link-code"
                  aria-label={`${label('comparison')} ${selected.comparisonCode}`}
                >
                  {selected.comparisonCode}
                </span>
                <Text tone="secondary" className="sc-device-link-hint">
                  {label('compareHint')}
                </Text>
                <div className="sc-device-link-decide">
                  <Button
                    actionId="device-link-allow"
                    className="sc-device-link-block"
                    emphasis="primary"
                    execution={busy ? 'pending' : 'idle'}
                    label={label('allow')}
                    onActivate={() => { void deviceLinkActions.decide(selected, true); }}
                  />
                  <Button
                    actionId="device-link-deny"
                    className="sc-device-link-block"
                    label={label('deny')}
                    availability={busy ? { kind: 'disabled', reason: label('deny') } : undefined}
                    onActivate={() => { void deviceLinkActions.decide(selected, false); }}
                  />
                </div>
              </div>
            )}

            {waiting && (
              <div className="sc-device-link-layer" data-pt-device-link-stage="finishing">
                <Spin />
              </div>
            )}

            {complete && (
              <div className="sc-device-link-layer" data-pt-device-link-stage="complete">
                <Icon iconId="circle-check-big" size={44} className="sc-device-link-complete" />
              </div>
            )}

            {terminal && (
              <div className="sc-device-link-layer" data-pt-device-link-stage="expired">
                <Text tone="secondary">{label('expired')}</Text>
              </div>
            )}
          </div>

          <div
            className={error ? 'sc-device-link-status is-error' : 'sc-device-link-status'}
            role={error ? 'alert' : 'status'}
            aria-live="polite"
          >
            {error ? label('failed') : status}
          </div>
          {/* Reserved slot sized to the real 36px action buttons, so footer
              presence (Done/Add another/Refresh) never changes modal height. */}
          <div className="sc-device-link-footer">
            {complete && <>
              <Button
                actionId="device-link-done"
                className="sc-device-link-block"
                emphasis="primary"
                label={label('done')}
                onActivate={() => { void deviceLinkActions.close(); }}
              />
              <Button
                actionId="device-link-add-another"
                className="sc-device-link-block"
                execution={busy ? 'pending' : 'idle'}
                label={label('addAnother')}
                onActivate={() => { void deviceLinkActions.start(); }}
              />
            </>}
            {(terminal || qrFailed || (error && !projection)) && (
              <Button
                actionId="device-link-refresh"
                className="sc-device-link-block"
                emphasis="primary"
                execution={busy ? 'pending' : 'idle'}
                label={label('refresh')}
                onActivate={() => { void deviceLinkActions.start(); }}
              />
            )}
            {error && projection && !terminal && !complete && (
              <Button
                actionId="device-link-retry"
                className="sc-device-link-block"
                label={label('retry')}
                availability={busy ? { kind: 'disabled', reason: label('retry') } : undefined}
                onActivate={() => { void deviceLinkActions.retry(); }}
              />
            )}
          </div>
        </Dialog>
      )}
    </SettingsSection>
  );
}
