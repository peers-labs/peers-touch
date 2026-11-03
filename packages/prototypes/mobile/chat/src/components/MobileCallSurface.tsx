import { useT } from '../i18n';
import { Icon } from '@peers-touch/ui';
import type { PrototypeCallSnapshot } from '../callPrototype';

export function MobileCallSurface({
  snapshot,
  onChange,
  onDismiss,
}: {
  snapshot: PrototypeCallSnapshot;
  onChange: (s: PrototypeCallSnapshot) => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const incoming = snapshot.state === 'incoming'
    || snapshot.state === 'ringing_all_devices';
  const active = snapshot.state === 'active_here'
    || snapshot.state === 'reconnecting';
  const terminal = snapshot.state === 'handled_elsewhere'
    || snapshot.state === 'ended';

  const end = () => onChange({ ...snapshot, state: 'ended' });
  const status = callStatus(snapshot);

  return (
    <div
      className={`mp-call-surface ${snapshot.mediaKind} ${snapshot.state} ${active ? 'active' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${snapshot.peerName} call`}
      data-prototype-call-state={snapshot.state}
    >
      <div className="mp-call-trust">
        <span className="mp-call-trust-dot" />
        Encrypted call signaling
      </div>

      {snapshot.mediaKind === 'video' && active ? (
        <div className="mp-call-video-stage">
          <div className="mp-call-remote-video" aria-label={`${snapshot.peerName} remote video`}>
            <span className="mp-call-video-initials">{snapshot.peerInitials}</span>
            <span className="mp-call-video-name">{snapshot.peerName}</span>
          </div>
          <div className="mp-call-local-video" aria-label={t('mobile.call.localVideo')}>
            <span>YC</span>
          </div>
        </div>
      ) : (
        <div className="mp-call-avatar" aria-hidden="true">
          <span>{snapshot.peerInitials}</span>
          <span className="mp-call-avatar-ring" />
        </div>
      )}

      <div className="mp-call-copy">
        <strong>{snapshot.peerName}</strong>
        <span role="status" aria-live="polite">{status}</span>
        {snapshot.state === 'handled_elsewhere' ? (
          <span className="mp-call-resolution">
            <Icon iconId="monitor-smartphone" size={14} />
            {snapshot.winningDeviceLabel}
          </span>
        ) : null}
      </div>

      <div className="mp-call-actions">
        {incoming ? (
          <>
            <CallControl label={t('mobile.call.decline')} tone="danger" onClick={end}>
              <Icon iconId="phone-off" size={22} />
            </CallControl>
            <CallControl
              autoFocus
              label={t('mobile.call.accept')}
              tone="accept"
              onClick={() => onChange({
                ...snapshot,
                state: 'active_here',
                micMuted: false,
                cameraOff: false,
              })}
            >
              <Icon iconId={snapshot.mediaKind === 'video' ? 'video' : 'phone'} size={22} />
            </CallControl>
          </>
        ) : null}

        {active ? (
          <>
            <CallControl
              autoFocus
              label={snapshot.micMuted ? 'Unmute' : 'Mute'}
              selected={snapshot.micMuted}
              onClick={() => onChange({ ...snapshot, micMuted: !snapshot.micMuted })}
            >
              <Icon iconId={snapshot.micMuted ? 'mic-off' : 'mic'} size={22} />
            </CallControl>
            {snapshot.mediaKind === 'video' ? (
              <CallControl
                label={snapshot.cameraOff ? 'Turn camera on' : 'Turn camera off'}
                selected={snapshot.cameraOff}
                onClick={() => onChange({ ...snapshot, cameraOff: !snapshot.cameraOff })}
              >
                <Icon iconId={snapshot.cameraOff ? 'camera-off' : 'camera'} size={22} />
              </CallControl>
            ) : null}
            <CallControl label={t('mobile.call.end')} tone="danger" onClick={end}>
              <Icon iconId="phone-off" size={22} />
            </CallControl>
          </>
        ) : null}

        {snapshot.state === 'outgoing' ? (
          <CallControl autoFocus label={t('mobile.call.cancel')} tone="danger" onClick={end}>
            <Icon iconId="phone-off" size={22} />
          </CallControl>
        ) : null}

        {terminal ? (
          <CallControl autoFocus label={t('mobile.call.close')} onClick={onDismiss}>
            <Icon iconId="close" size={22} />
          </CallControl>
        ) : null}
      </div>
    </div>
  );
}

function callStatus(snapshot: PrototypeCallSnapshot): string {
  switch (snapshot.state) {
    case 'outgoing':
      return snapshot.mediaKind === 'video' ? 'Starting video call...' : 'Calling...';
    case 'ringing_all_devices':
    case 'incoming':
      return `Incoming ${snapshot.mediaKind} call`;
    case 'active_here':
      return '00:42';
    case 'reconnecting':
      return 'Reconnecting...';
    case 'handled_elsewhere':
      return 'Answered on another device';
    case 'ended':
      return 'Call ended';
  }
}

function CallControl({
  children,
  autoFocus = false,
  label,
  onClick,
  selected,
  tone = 'default',
}: {
  children: React.ReactNode;
  autoFocus?: boolean;
  label: string;
  onClick: () => void;
  selected?: boolean;
  tone?: 'default' | 'accept' | 'danger';
}) {
  return (
    <button
      type="button"
      className={`mp-call-control ${tone} ${selected ? 'selected' : ''}`}
      aria-label={label}
      aria-pressed={selected}
      autoFocus={autoFocus}
      title={label}
      onClick={onClick}
    >
      <span className="mp-call-control-icon">{children}</span>
      <span>{label}</span>
    </button>
  );
}
