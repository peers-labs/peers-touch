import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Camera,
  CameraOff,
  Laptop,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RotateCcw,
  X,
} from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import {
  mobileCallManager,
  type CallSnapshot,
} from '../../features/call/callState';
import { useSocialActorIdentity } from '../../features/social/useSocialActorIdentity';
import { MobileAvatar } from '../MobileAvatar';

export function MobileCallSurface() {
  const { t } = useMobileI18n();
  const [snapshot, setSnapshot] = useState<CallSnapshot | null>(
    mobileCallManager.getSnapshot(),
  );
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const peerIdentity = useSocialActorIdentity({
    actorPtid: snapshot?.peerPtid ?? '',
    displayName: t('mobile.contacts.unknownUser'),
  });

  useEffect(() => mobileCallManager.subscribe(setSnapshot), []);
  useEffect(() => {
    setError('');
  }, [snapshot?.callId]);
  useEffect(() => {
    if (!snapshot) return;
    if (localVideo.current) localVideo.current.srcObject = snapshot.localStream ?? null;
    if (remoteVideo.current) remoteVideo.current.srcObject = snapshot.remoteStream ?? null;
    if (remoteAudio.current) remoteAudio.current.srcObject = snapshot.remoteStream ?? null;
  }, [snapshot?.localStream, snapshot?.remoteStream]);
  useEffect(() => {
    if (!snapshot?.startedAt || snapshot.state !== 'active_here') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [snapshot?.startedAt, snapshot?.state]);

  if (!snapshot) return null;
  const incoming = snapshot.state === 'incoming'
    || snapshot.state === 'ringing_all_devices';
  const terminal = snapshot.state === 'ended'
    || snapshot.state === 'handled_elsewhere';
  const active = snapshot.state === 'active_here'
    || snapshot.state === 'reconnecting';
  const remoteVideoReady = Boolean(
    snapshot.remoteStream?.getVideoTracks().length,
  );
  const localVideoReady = Boolean(
    snapshot.localStream?.getVideoTracks().length,
  ) && !snapshot.cameraOff;
  const status = snapshot.state === 'active_here' && snapshot.startedAt
    ? formatCallDuration(Math.max(0, now - snapshot.startedAt))
    : terminalCallStatus(snapshot, t);
  const retryable = snapshot.state === 'ended'
    && snapshot.endReason !== 'hangup'
    && snapshot.endReason !== 'canceled';
  const run = async (operation: () => Promise<unknown>) => {
    setError('');
    try {
      await operation();
    } catch (operationError) {
      setError(callOperationError(operationError, t));
    }
  };

  return (
    <div
      className={[
        'mobile-call-surface',
        snapshot.mediaKind,
        snapshot.state,
        active ? 'active' : '',
      ].filter(Boolean).join(' ')}
      data-chat-call-peer-ptid={peerIdentity.actorPtid}
      data-chat-call-peer-name={peerIdentity.displayName}
      data-chat-call-media-kind={snapshot.mediaKind}
      data-chat-call-state={snapshot.state}
      role="dialog"
      aria-modal="true"
      aria-label={t('mobile.call.surfaceLabel')}
    >
      <div className="mobile-call-trust">
        <span className="mobile-call-trust-dot" aria-hidden="true" />
        {t('mobile.call.encryptedSignaling')}
      </div>

      {snapshot.mediaKind === 'video' && active ? (
        <div className="mobile-call-video-stage">
          <video
            ref={remoteVideo}
            className={`mobile-call-remote-video ${remoteVideoReady ? 'visible' : ''}`}
            autoPlay
            playsInline
          />
          {!remoteVideoReady ? (
            <div className="mobile-call-video-placeholder">
              <MobileAvatar
                src={peerIdentity.avatar}
                name={peerIdentity.displayName}
                identityKey={peerIdentity.actorPtid}
                size={104}
              />
              <span>{peerIdentity.displayName}</span>
            </div>
          ) : null}
          <div className="mobile-call-local-video-frame">
            <video
              ref={localVideo}
              className={`mobile-call-local-video ${localVideoReady ? 'visible' : ''}`}
              autoPlay
              muted
              playsInline
            />
            {!localVideoReady ? (
              <span className="mobile-call-local-video-placeholder">
                {t('mobile.call.you')}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mobile-call-avatar" aria-hidden="true">
          <MobileAvatar
            src={peerIdentity.avatar}
            name={peerIdentity.displayName}
            identityKey={peerIdentity.actorPtid}
            size={132}
          />
          <span className="mobile-call-avatar-ring" />
        </div>
      )}
      <audio ref={remoteAudio} autoPlay />

      <div className="mobile-call-copy">
        <strong>{peerIdentity.displayName}</strong>
        <span role="status" aria-live="polite">{status}</span>
        {snapshot.state === 'handled_elsewhere' ? (
          <span className="mobile-call-resolution">
            <Laptop size={14} />
            {t('mobile.call.otherDevice')}
          </span>
        ) : null}
        {error ? <span className="mobile-call-error">{error}</span> : null}
      </div>

      <div className="mobile-call-actions">
        {incoming ? (
          <>
            <CallControl
              action="decline"
              label={t('mobile.call.decline')}
              tone="danger"
              onClick={() => { void run(() => mobileCallManager.rejectCall()); }}
            >
              <PhoneOff size={22} />
            </CallControl>
            <CallControl
              action="accept"
              autoFocus
              label={t('mobile.call.accept')}
              tone="accept"
              onClick={() => { void run(() => mobileCallManager.acceptCall()); }}
            >
              <Phone size={22} />
            </CallControl>
          </>
        ) : null}

        {active ? (
          <>
            <CallControl
              action="microphone"
              autoFocus
              label={t(snapshot.micMuted ? 'mobile.call.unmute' : 'mobile.call.mute')}
              selected={snapshot.micMuted}
              onClick={() => mobileCallManager.toggleMicrophone()}
            >
              {snapshot.micMuted ? <MicOff size={22} /> : <Mic size={22} />}
            </CallControl>
            {snapshot.mediaKind === 'video' ? (
              <CallControl
                action="camera"
                label={t(snapshot.cameraOff ? 'mobile.call.cameraOn' : 'mobile.call.cameraOff')}
                selected={snapshot.cameraOff}
                onClick={() => mobileCallManager.toggleCamera()}
              >
                {snapshot.cameraOff ? <CameraOff size={22} /> : <Camera size={22} />}
              </CallControl>
            ) : null}
            <CallControl
              action="end"
              label={t('mobile.call.end')}
              tone="danger"
              onClick={() => { void run(() => mobileCallManager.endCall()); }}
            >
              <PhoneOff size={22} />
            </CallControl>
          </>
        ) : null}

        {snapshot.state === 'outgoing' ? (
          <CallControl
            action="end"
            autoFocus
            label={t('mobile.call.cancel')}
            tone="danger"
            onClick={() => { void run(() => mobileCallManager.endCall()); }}
          >
            <PhoneOff size={22} />
          </CallControl>
        ) : null}

        {terminal ? (
          <>
            {retryable ? (
              <CallControl
                action="retry"
                label={t('mobile.call.retry')}
                onClick={() => { void run(() => mobileCallManager.retryCall()); }}
              >
                <RotateCcw size={22} />
              </CallControl>
            ) : null}
            <CallControl
              action="dismiss"
              autoFocus={!retryable}
              label={t('common.action.close')}
              onClick={() => mobileCallManager.dismiss()}
            >
              <X size={22} />
            </CallControl>
          </>
        ) : null}
      </div>
    </div>
  );
}

function CallControl({
  action,
  autoFocus = false,
  children,
  label,
  onClick,
  selected,
  tone = 'default',
}: {
  readonly action: string;
  readonly autoFocus?: boolean;
  readonly children: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
  readonly selected?: boolean;
  readonly tone?: 'default' | 'accept' | 'danger';
}) {
  return (
    <button
      type="button"
      data-chat-call-action={action}
      className={[
        'mobile-call-control',
        tone,
        selected ? 'selected' : '',
      ].filter(Boolean).join(' ')}
      aria-label={label}
      aria-pressed={selected}
      autoFocus={autoFocus}
      title={label}
      onClick={onClick}
    >
      <span className="mobile-call-control-icon">{children}</span>
      <span>{label}</span>
    </button>
  );
}

function terminalCallStatus(
  snapshot: CallSnapshot,
  t: (key: string) => string,
): string {
  if (snapshot.state === 'handled_elsewhere') {
    return t('mobile.call.state.handled_elsewhere');
  }
  if (snapshot.state !== 'ended' || !snapshot.endReason) {
    return t(`mobile.call.state.${snapshot.state}`);
  }
  if (snapshot.endReason === 'media-failed' && snapshot.mediaFailure) {
    return t(`mobile.call.mediaFailure.${snapshot.mediaFailure}`);
  }
  return t(`mobile.call.endReason.${snapshot.endReason}`);
}

function formatCallDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1_000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function callOperationError(
  error: unknown,
  t: (key: string) => string,
): string {
  if (error && typeof error === 'object' && 'name' in error) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return t('mobile.call.mediaFailure.permission-denied');
    }
    if (
      error.name === 'NotFoundError'
      || error.name === 'NotReadableError'
      || error.name === 'OverconstrainedError'
    ) {
      return t('mobile.call.mediaFailure.device-unavailable');
    }
    if (error.name === 'NotSupportedError' || error.name === 'TypeError') {
      return t('mobile.call.mediaFailure.unsupported');
    }
  }
  return t('mobile.call.operationFailed');
}
