import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, CallControl, Icon, Spin, restoreNavigationFocus } from '@peers-touch/ui';
import type { GroupCallSnapshot, Participant } from '@peers-touch/client-chat-core/group-call';
import { useMobileI18n } from '../../app/mobileI18n';
import { useSocialStore } from '../../features/social/socialStore';
import {
  mobileGroupCallManager, readMobileGroupInvitation, subscribeMobileGroupCallRooms,
  declineMobileGroupInvitation, suppressMobileGroupInvitation, readMobileGroupCallRooms,
} from '../../features/call/groupCallRuntime';
import { mobileMediaReservation } from '../../features/call/mediaReservation';
import { mobileCallManager } from '../../features/call/callState';
import { MobileAvatar } from '../MobileAvatar';
import './mobileCall.css';

interface ParticipantIdentity { name: string; avatar?: string }

function useCallFocusScope(onEscape: () => void) {
  const stage = useRef<HTMLDivElement>(null);
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = stage.current;
    if (!root) return;
    root.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); escape.current(); }
      if (event.key !== 'Tab') return;
      const controls = [...root.querySelectorAll<HTMLElement>('button:not([disabled]),[tabindex="0"]')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    root.addEventListener('keydown', onKey);
    return () => { root.removeEventListener('keydown', onKey); restoreNavigationFocus(previous); };
  }, []);
  return stage;
}

function ParticipantTile({ participant, identity, revision, attach, onPlaybackBlocked }: {
  participant: Participant; revision: number;
  identity: ParticipantIdentity;
  attach: typeof mobileGroupCallManager.attachParticipantMedia;
  onPlaybackBlocked: () => void;
}) {
  const { t } = useMobileI18n();
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const detach = attach(participant.participantId, video.current, audio.current);
    if (!participant.isLocal && audio.current?.srcObject) {
      void audio.current.play().catch(onPlaybackBlocked);
    }
    return detach;
  }, [attach, participant.participantId, revision, onPlaybackBlocked]);
  const name = participant.isLocal ? t('mobile.groupCall.you')
    : identity.name || t('mobile.contacts.unknownUser');
  return <div className="mobile-group-call-tile" data-speaking={participant.isSpeaking || undefined}
    data-group-call-participant={participant.actorPtid} data-group-call-participant-id={participant.participantId}
    data-group-call-participant-local={String(participant.isLocal)}
    data-group-call-camera={participant.isCameraEnabled ? 'on' : 'off'}
    data-group-call-microphone={participant.isMicEnabled ? 'on' : 'off'}>
    <video ref={video} autoPlay playsInline muted={participant.isLocal} aria-label={name}
      hidden={!participant.isCameraEnabled} />
    {!participant.isCameraEnabled && <MobileAvatar identityKey={participant.actorPtid} name={name} src={identity.avatar} size={64} />}
    {!participant.isLocal && <audio ref={audio} autoPlay data-group-call-remote-audio={participant.actorPtid} aria-label={name} />}
    <div className="mobile-group-call-tile-label"><strong>{name}</strong>
      {!participant.isMicEnabled && <Icon iconId="mic-off" size={14} />}
    </div>
  </div>;
}

const attach = mobileGroupCallManager.attachParticipantMedia.bind(mobileGroupCallManager);

/** Pure product view, reused by production and the whole-product surface fixture. */
export function MobileGroupCallView({ snapshot, groupName, onLeave, onJoin, onMic, onCamera, attachMedia = attach, identities = {}, declinedCount = 0 }: {
  snapshot: GroupCallSnapshot; groupName: string;
  onLeave: () => void; onJoin: () => void; onMic: () => void; onCamera: () => void;
  attachMedia?: typeof attach;
  identities?: Record<string, ParticipantIdentity>;
  declinedCount?: number;
}) {
  const { t } = useMobileI18n();
  const [now, setNow] = useState(Date.now());
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const stage = useCallFocusScope(onLeave);
  const onBlocked = useRef(() => setPlaybackBlocked(true)).current;
  useEffect(() => {
    if (!snapshot.startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [snapshot.startedAt]);
  const elapsed = snapshot.startedAt ? Math.max(0, Math.floor((now - snapshot.startedAt) / 1000)) : 0;
  const duration = `${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;
  const active = snapshot.state === 'connected' || snapshot.state === 'reconnecting';
  const reason = !active ? { kind: 'disabled' as const, reason: t(`mobile.groupCall.state.${snapshot.state}`) } : undefined;
  return <div ref={stage} className="mobile-group-call-surface" role="dialog" aria-modal="true"
    aria-label={t('mobile.groupCall.label')} data-group-call-surface data-group-call-state={snapshot.state}
    data-product-surface={`chat.group-call-${snapshot.state === 'connected' ? snapshot.mediaKind : snapshot.state}`}
    data-group-call-group={snapshot.groupUlid} data-group-call-room={snapshot.roomName}>
    <div className="mobile-call-trust">{t('mobile.groupCall.privacy')}</div>
    <div className="mobile-group-call-heading"><h1>{groupName || t('mobile.groupCall.label')}</h1>
      <span role="status" aria-live="polite">{active && snapshot.state !== 'reconnecting' ? duration : t(`mobile.groupCall.state.${snapshot.state}`)}</span>
      {snapshot.errorCode && <p role="alert">{t(`mobile.groupCall.error.${snapshot.errorCode}`)}</p>}
      {declinedCount > 0 && <p role="status" data-group-call-declined-count={declinedCount}>
        {t('mobile.groupCall.declinedCount', { count: declinedCount })}
      </p>}
    </div>
    <div className="mobile-group-call-grid">
      {snapshot.participants.map((participant) => <ParticipantTile key={participant.participantId}
        participant={participant} identity={identities[participant.actorPtid] ?? { name: '' }}
        revision={snapshot.mediaRevision} attach={attachMedia} onPlaybackBlocked={onBlocked} />)}
      {snapshot.participants.length === 0 && <div className="mobile-group-call-wait">
        <Icon iconId="users" size={64} />
        {snapshot.state === 'connecting' || snapshot.state === 'leaving' ? <Spin label={t(`mobile.groupCall.state.${snapshot.state}`)} /> : null}
      </div>}
    </div>
    {playbackBlocked && <Button actionId="group-call.play-audio" label={t('mobile.groupCall.playAudio')} onActivate={() => {
      const audio = [...stage.current!.querySelectorAll('audio')];
      void Promise.all(audio.map((element) => element.play())).then(() => setPlaybackBlocked(false)).catch(onBlocked);
    }} />}
    <div className="mobile-call-controls">
      {snapshot.state === 'failed' ? <CallControl actionId="group-call.retry" iconId="phone"
        label={t('common.action.retry')} onActivate={onJoin} /> : <>
        <CallControl actionId="group-call.microphone" iconId={snapshot.localMicEnabled ? 'mic' : 'mic-off'}
          label={t(snapshot.localMicEnabled ? 'mobile.groupCall.mute' : 'mobile.groupCall.unmute')}
          selected={!snapshot.localMicEnabled} availability={reason}
          execution={snapshot.pendingControl === 'microphone' ? 'pending' : 'idle'} onActivate={onMic} />
        <CallControl actionId="group-call.camera" iconId={snapshot.localCameraEnabled ? 'camera' : 'camera-off'}
          label={t(snapshot.localCameraEnabled ? 'mobile.groupCall.cameraOff' : 'mobile.groupCall.cameraOn')}
          selected={!snapshot.localCameraEnabled} availability={reason}
          execution={snapshot.pendingControl === 'camera' ? 'pending' : 'idle'} onActivate={onCamera} />
      </>}
      <CallControl actionId="group-call.leave" iconId={snapshot.state === 'failed' ? 'close' : 'phone-off'}
        label={t(snapshot.state === 'failed' ? 'common.action.close' : active ? 'mobile.groupCall.leave' : 'common.action.cancel')}
        tone="danger" execution={snapshot.state === 'leaving' ? 'pending' : 'idle'} onActivate={onLeave} />
    </div>
  </div>;
}

export function MobileGroupCallInvitationView({ groupName, onJoin, onDismiss }: {
  groupName: string; onJoin: () => void; onDismiss: () => void | Promise<void>;
}) {
  const { t } = useMobileI18n();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const decline = () => {
    if (pending) return;
    setPending(true); setFailed(false);
    void Promise.resolve().then(onDismiss).catch(() => setFailed(true)).finally(() => setPending(false));
  };
  const stage = useCallFocusScope(decline);
  return <div ref={stage} className="mobile-call-surface" role="dialog" aria-modal="true"
    aria-label={t('mobile.groupCall.invitation')} data-group-call-invitation
    data-product-surface="chat.group-call-invitation">
    <div className="mobile-call-trust">{t('mobile.groupCall.privacy')}</div>
    <MobileAvatar name={groupName} size={88} />
    <div className="mobile-call-copy"><h1>{groupName || t('mobile.groupCall.label')}</h1>
      <span>{t('mobile.groupCall.invitation')}</span>
      {failed && <p role="alert">{t('mobile.groupCall.declineFailed')}</p>}
    </div>
    <div className="mobile-call-actions">
      <CallControl actionId="group-call.dismiss-invitation" iconId="phone-off" tone="danger"
        label={t('mobile.groupCall.notNow')} execution={pending ? 'pending' : 'idle'} onActivate={decline} />
      <CallControl actionId="group-call.accept-invitation" iconId="phone" emphasis="primary"
        label={t('mobile.groupCall.join')} onActivate={onJoin} />
    </div>
  </div>;
}

export function MobileGroupCallSurface() {
  useSyncExternalStore((cb) => mobileCallManager.subscribe(cb),
    () => mobileCallManager.getSnapshot(), () => mobileCallManager.getSnapshot());
  const snapshot = useSyncExternalStore(
    (cb) => mobileGroupCallManager.onSnapshot(cb), () => mobileGroupCallManager.getSnapshot(),
    () => mobileGroupCallManager.getSnapshot(),
  );
  const invitation = useSyncExternalStore(subscribeMobileGroupCallRooms, readMobileGroupInvitation, readMobileGroupInvitation);
  const roomProjection = useSyncExternalStore(subscribeMobileGroupCallRooms, readMobileGroupCallRooms, readMobileGroupCallRooms);
  const groupName = useSocialStore((state) => state.messagingConversations.find(
    (group) => group.conversationId === snapshot.groupUlid,
  )?.name ?? '');
  const invitationName = useSocialStore((state) => state.messagingConversations.find(
    (group) => group.conversationId === invitation?.groupUlid,
  )?.name ?? '');
  const profiles = useSocialStore((state) => state.peerProfiles);
  const run = (operation: () => Promise<void>) => { void operation().catch(() => undefined); };
  if (snapshot.state === 'idle') {
    if (!invitation || mobileMediaReservation.isOccupied()) return null;
    return <MobileGroupCallInvitationView groupName={invitationName}
      onDismiss={() => declineMobileGroupInvitation(invitation)}
      onJoin={() => {
        suppressMobileGroupInvitation(invitation);
        run(() => mobileGroupCallManager.joinGroupCall(invitation.groupUlid));
      }} />;
  }
  const identities: Record<string, ParticipantIdentity> = {};
  for (const participant of snapshot.participants) {
    identities[participant.actorPtid] = { name: profiles[participant.actorPtid]?.displayName ?? '', avatar: profiles[participant.actorPtid]?.avatar };
  }
  return <MobileGroupCallView snapshot={snapshot} groupName={groupName} identities={identities}
    declinedCount={roomProjection.get(snapshot.groupUlid)?.declinedActorPtids.length ?? 0}
    onLeave={() => run(() => mobileGroupCallManager.leaveGroupCall())}
    onJoin={() => run(() => mobileGroupCallManager.joinGroupCall(snapshot.groupUlid, snapshot.mediaKind))}
    onMic={() => run(() => mobileGroupCallManager.setMicEnabled(!snapshot.localMicEnabled))}
    onCamera={() => run(() => mobileGroupCallManager.setCameraEnabled(!snapshot.localCameraEnabled))} />;
}
