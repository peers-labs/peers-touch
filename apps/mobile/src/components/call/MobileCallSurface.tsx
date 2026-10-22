import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  X,
} from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { MobileAvatar } from '../MobileAvatar';
import { useSocialActorIdentity } from '../../features/social/useSocialActorIdentity';
import {
  mobileCallManager,
  type CallSnapshot,
} from '../../features/call/callState';

export function MobileCallSurface() {
  const { t } = useMobileI18n();
  const [snapshot, setSnapshot] = useState<CallSnapshot | null>(
    mobileCallManager.getSnapshot(),
  );
  const peerIdentity = useSocialActorIdentity({
    actorPtid: snapshot?.peerPtid ?? '',
  });
  const [error, setError] = useState('');
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);

  useEffect(() => mobileCallManager.subscribe(setSnapshot), []);
  useEffect(() => {
    if (!snapshot) return;
    if (localVideo.current) localVideo.current.srcObject = snapshot.localStream ?? null;
    if (remoteVideo.current) remoteVideo.current.srcObject = snapshot.remoteStream ?? null;
    if (remoteAudio.current) remoteAudio.current.srcObject = snapshot.remoteStream ?? null;
  }, [snapshot?.localStream, snapshot?.remoteStream]);

  if (!snapshot) return null;
  const incoming = snapshot.state === 'incoming'
    || snapshot.state === 'ringing_all_devices';
  const terminal = snapshot.state === 'ended'
    || snapshot.state === 'handled_elsewhere';
  const active = snapshot.state === 'active_here'
    || snapshot.state === 'reconnecting';
  const run = async (operation: () => Promise<unknown>) => {
    setError('');
    try {
      await operation();
    } catch {
      setError(t('mobile.call.operationFailed'));
    }
  };

  return (
    <div
      className={`mobile-call-surface ${active ? 'active' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('mobile.call.surfaceLabel')}
    >
      {snapshot.mediaKind === 'video' && active ? (
        <div className="mobile-call-video-stage">
          <video ref={remoteVideo} className="mobile-call-remote-video" autoPlay playsInline />
          <video ref={localVideo} className="mobile-call-local-video" autoPlay muted playsInline />
        </div>
      ) : (
        <MobileAvatar
          identityKey={peerIdentity.actorPtid}
          name={peerIdentity.displayName || t('mobile.contacts.unknownUser')}
          src={peerIdentity.avatar}
          size={72}
        />
      )}
      <audio ref={remoteAudio} autoPlay />

      <div className="mobile-call-copy">
        {snapshot.mediaKind === 'video' && active ? (
          <MobileAvatar
            identityKey={peerIdentity.actorPtid}
            name={peerIdentity.displayName || t('mobile.contacts.unknownUser')}
            src={peerIdentity.avatar}
            size={40}
          />
        ) : null}
        <strong>{peerIdentity.displayName || t('mobile.contacts.unknownUser')}</strong>
        <span>
          {t(`mobile.call.state.${snapshot.state}`)}
        </span>
        {error ? <span className="mobile-call-error">{error}</span> : null}
      </div>

      <div className="mobile-call-actions">
        {incoming ? (
          <>
            <button
              type="button"
              className="mobile-call-control danger"
              aria-label={t('mobile.call.decline')}
              onClick={() => { void run(() => mobileCallManager.rejectCall()); }}
            >
              <PhoneOff size={22} />
            </button>
            <button
              type="button"
              className="mobile-call-control accept"
              aria-label={t('mobile.call.accept')}
              onClick={() => { void run(() => mobileCallManager.acceptCall()); }}
            >
              <Phone size={22} />
            </button>
          </>
        ) : null}

        {active ? (
          <>
            <button
              type="button"
              className={`mobile-call-control ${snapshot.micMuted ? 'selected' : ''}`}
              aria-label={t(snapshot.micMuted ? 'mobile.call.unmute' : 'mobile.call.mute')}
              onClick={() => mobileCallManager.toggleMicrophone()}
            >
              {snapshot.micMuted ? <MicOff size={22} /> : <Mic size={22} />}
            </button>
            {snapshot.mediaKind === 'video' ? (
              <button
                type="button"
                className={`mobile-call-control ${snapshot.cameraOff ? 'selected' : ''}`}
                aria-label={t(snapshot.cameraOff ? 'mobile.call.cameraOn' : 'mobile.call.cameraOff')}
                onClick={() => mobileCallManager.toggleCamera()}
              >
                {snapshot.cameraOff ? <CameraOff size={22} /> : <Camera size={22} />}
              </button>
            ) : null}
            <button
              type="button"
              className="mobile-call-control danger"
              aria-label={t('mobile.call.end')}
              onClick={() => { void run(() => mobileCallManager.endCall()); }}
            >
              <PhoneOff size={22} />
            </button>
          </>
        ) : null}

        {snapshot.state === 'outgoing' ? (
          <button
            type="button"
            className="mobile-call-control danger"
            aria-label={t('mobile.call.cancel')}
            onClick={() => { void run(() => mobileCallManager.endCall()); }}
          >
            <PhoneOff size={22} />
          </button>
        ) : null}

        {terminal ? (
          <button
            type="button"
            className="mobile-call-control"
            aria-label={t('common.action.close')}
            onClick={() => mobileCallManager.dismiss()}
          >
            <X size={22} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
