import { useEffect, useRef, useState } from 'react';
import { CallControl } from '@peers-touch/ui';
import './mobileCall.css';

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
  }, [snapshot?.localStream, snapshot?.remoteStream, snapshot?.state, snapshot?.mediaKind]);

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
          <video ref={remoteVideo} className="mobile-call-remote-video" autoPlay muted playsInline />
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
            <CallControl actionId="direct-call.decline" label={t('mobile.call.decline')} iconId="phone-off"
              tone="danger" onActivate={() => { void run(() => mobileCallManager.rejectCall()); }} />
            <CallControl actionId="direct-call.accept" label={t('mobile.call.accept')} iconId="phone"
              onActivate={() => { void run(() => mobileCallManager.acceptCall()); }} />
          </>
        ) : null}

        {active ? (
          <>
            <CallControl actionId="direct-call.microphone" iconId={snapshot.micMuted ? 'mic-off' : 'mic'}
              label={t(snapshot.micMuted ? 'mobile.groupCall.unmute' : 'mobile.groupCall.mute')}
              selected={snapshot.micMuted} onActivate={() => mobileCallManager.toggleMicrophone()} />
            {snapshot.mediaKind === 'video' ? (
              <CallControl actionId="direct-call.camera" iconId={snapshot.cameraOff ? 'camera-off' : 'camera'}
                label={t(snapshot.cameraOff ? 'mobile.groupCall.cameraOn' : 'mobile.groupCall.cameraOff')}
                selected={snapshot.cameraOff} onActivate={() => mobileCallManager.toggleCamera()} />
            ) : null}
            <CallControl actionId="direct-call.end" label={t('mobile.call.end')} iconId="phone-off"
              tone="danger" onActivate={() => { void run(() => mobileCallManager.endCall()); }} />
          </>
        ) : null}

        {snapshot.state === 'outgoing' ? (
          <CallControl actionId="direct-call.cancel" label={t('mobile.call.cancel')} iconId="phone-off"
            tone="danger" onActivate={() => { void run(() => mobileCallManager.endCall()); }} />
        ) : null}

        {terminal ? (
          <CallControl actionId="direct-call.close" label={t('common.action.close')} iconId="close"
            onActivate={() => mobileCallManager.dismiss()} />
        ) : null}
      </div>
    </div>
  );
}
