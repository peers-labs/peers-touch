import {
  Camera,
  CameraOff,
  Laptop,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Video,
  X,
} from 'lucide-react';
import type { PrototypeCallSnapshot } from '../callPrototype';

export function MobileCallSurface({
  snapshot,
  onChange,
  onDismiss,
}: {
  snapshot: PrototypeCallSnapshot;
  onChange: (snapshot: PrototypeCallSnapshot) => void;
  onDismiss: () => void;
}) {
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
          <div className="mp-call-local-video" aria-label="Your local video">
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
            <Laptop size={14} />
            {snapshot.winningDeviceLabel}
          </span>
        ) : null}
      </div>

      <div className="mp-call-actions">
        {incoming ? (
          <>
            <CallControl label="Decline" tone="danger" onClick={end}>
              <PhoneOff size={22} />
            </CallControl>
            <CallControl
              autoFocus
              label="Accept"
              tone="accept"
              onClick={() => onChange({
                ...snapshot,
                state: 'active_here',
                micMuted: false,
                cameraOff: false,
              })}
            >
              {snapshot.mediaKind === 'video' ? <Video size={22} /> : <Phone size={22} />}
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
              {snapshot.micMuted ? <MicOff size={22} /> : <Mic size={22} />}
            </CallControl>
            {snapshot.mediaKind === 'video' ? (
              <CallControl
                label={snapshot.cameraOff ? 'Turn camera on' : 'Turn camera off'}
                selected={snapshot.cameraOff}
                onClick={() => onChange({ ...snapshot, cameraOff: !snapshot.cameraOff })}
              >
                {snapshot.cameraOff ? <CameraOff size={22} /> : <Camera size={22} />}
              </CallControl>
            ) : null}
            <CallControl label="End call" tone="danger" onClick={end}>
              <PhoneOff size={22} />
            </CallControl>
          </>
        ) : null}

        {snapshot.state === 'outgoing' ? (
          <CallControl autoFocus label="Cancel" tone="danger" onClick={end}>
            <PhoneOff size={22} />
          </CallControl>
        ) : null}

        {terminal ? (
          <CallControl autoFocus label="Close" onClick={onDismiss}>
            <X size={22} />
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
