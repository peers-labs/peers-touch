import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Camera,
  CameraOff,
  Expand,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneOff,
  Users,
} from 'lucide-react';
import { groupCallManager } from '../../modules/groupCall';
import type { GroupCallSnapshot, Participant } from '../../modules/groupCall';
import { log } from '../../utils/logger';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { useChatActorIdentity } from './useChatActorIdentity';
import { useSocialChatStore } from '../../store/socialChat';
import { notifyError } from '../../ui/feedback';

type DisplayMode = 'compact' | 'expanded' | 'fullscreen';

const TRAY_EDGE = 20;
const TRAY_MAX_WIDTH = 360;

function GroupCallButton({
  label,
  onClick,
  tone,
  children,
  extra,
}: {
  label: string;
  onClick: () => void;
  tone?: 'danger' | 'muted';
  children: React.ReactNode;
  extra?: Record<string, string>;
}) {
  return (
    <button
      type="button"
      className={`sc-gcall__btn${tone ? ` sc-gcall__btn--${tone}` : ''}`}
      aria-label={label}
      title={label}
      data-group-call-display-mode-target={extra?.['data-group-call-display-mode-target']}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ParticipantBadge({ actorPtid }: { actorPtid: string }) {
  const identity = useChatActorIdentity(actorPtid);
  return (
    <span className="sc-gcall__badge" title={identity.displayName}>
      <UserSquareAvatar remoteUrl={identity.avatarUrl} name={identity.displayName} size={24} />
      <span>{identity.displayName}</span>
    </span>
  );
}

function ParticipantTile({
  participant,
  isLocal,
}: {
  participant: Participant;
  isLocal: boolean;
}) {
  const { t } = useTranslation('chat');
  const identity = useChatActorIdentity(participant.actorPtid);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const qualityTone =
    participant.connectionQuality === 'excellent' || participant.connectionQuality === 'good'
      ? 'good'
      : participant.connectionQuality === 'poor'
        ? 'poor'
        : 'bad';

  useEffect(() => groupCallManager.attachParticipantMedia(
    participant.actorPtid,
    videoRef.current,
    null,
  ), [
    participant.actorPtid,
    participant.isCameraEnabled,
    participant.isMicEnabled,
  ]);

  return (
    <div
      className={`sc-gcall__tile${participant.isSpeaking ? ' is-speaking' : ''}`}
      data-group-call-participant={participant.actorPtid}
      data-group-call-participant-local={isLocal ? 'true' : 'false'}
      data-group-call-camera={participant.isCameraEnabled ? 'on' : 'off'}
      data-group-call-microphone={participant.isMicEnabled ? 'on' : 'off'}
    >
      <video
        ref={videoRef}
        muted={isLocal}
        aria-label={identity.displayName}
        style={{ display: participant.isCameraEnabled ? 'block' : 'none' }}
      />
      {!participant.isCameraEnabled && (
        <UserSquareAvatar
          remoteUrl={identity.avatarUrl}
          name={identity.displayName}
          size={44}
        />
      )}
      <div className="sc-gcall__tile-meta">
        <span className="sc-gcall__tile-name">
          {isLocal ? t('chat.groupCall.you') : identity.displayName}
        </span>
        {!participant.isMicEnabled && <MicOff size={10} />}
        {!participant.isCameraEnabled && <CameraOff size={10} />}
        <span className={`sc-gcall__quality sc-gcall__quality--${qualityTone}`} />
      </div>
    </div>
  );
}

function ParticipantAudio({ participant }: { participant: Participant }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const identity = useChatActorIdentity(participant.actorPtid);

  useEffect(() => groupCallManager.attachParticipantMedia(
    participant.actorPtid,
    null,
    audioRef.current,
  ), [participant.actorPtid, participant.isMicEnabled]);

  return (
    <audio
      ref={audioRef}
      data-group-call-remote-audio={participant.actorPtid}
      aria-label={identity.displayName}
    />
  );
}

export function GroupCallSurface() {
  const { t } = useTranslation('chat');
  const [snapshot, setSnapshot] = useState<GroupCallSnapshot>(
    () => groupCallManager.getSnapshot(),
  );
  const groupName = useSocialChatStore((state) => (
    state.groups.find((group) => group.ulid === snapshot.groupUlid)?.name
    || state.conversations.find((group) => group.conversationId === snapshot.groupUlid)?.name
    || ''
  ));
  const [, setActiveRooms] = useState<Map<string, string>>(new Map());
  const [displayMode, setDisplayMode] = useState<DisplayMode>('compact');
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const unsub = groupCallManager.onSnapshot((s) => {
      setSnapshot(s);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = groupCallManager.onRoomEvent((event) => {
      setActiveRooms((prev) => {
        const next = new Map(prev);
        if (event.kind === 'room_active') {
          next.set(event.groupUlid, event.roomName);
        } else if (event.kind === 'room_ended') {
          next.delete(event.groupUlid);
        }
        return next;
      });
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (snapshot.state === 'idle') setDisplayMode('compact');
  }, [snapshot.state]);

  const handleLeave = useCallback(() => {
    groupCallManager.leaveGroupCall();
  }, []);

  const handleToggleMic = useCallback(async () => {
    try {
      await groupCallManager.setMicEnabled(!snapshot.localMicEnabled);
    } catch (error) {
      log.warn('groupCallSurface', 'toggle mic failed', error);
      notifyError(t('chat.groupCall.failed'));
    }
  }, [snapshot.localMicEnabled, t]);

  const handleToggleCamera = useCallback(async () => {
    try {
      await groupCallManager.setCameraEnabled(!snapshot.localCameraEnabled);
    } catch (error) {
      log.warn('groupCallSurface', 'toggle camera failed', error);
      notifyError(t('chat.groupCall.failed'));
    }
  }, [snapshot.localCameraEnabled, t]);

  useEffect(() => {
    if (displayMode !== 'fullscreen' || !surfaceRef.current) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDisplayMode('compact');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [displayMode]);

  if (snapshot.state === 'idle') return null;

  const stateLabel =
    snapshot.state === 'connecting'
      ? t('chat.groupCall.connecting')
      : snapshot.state === 'reconnecting'
        ? t('chat.groupCall.reconnecting')
        : snapshot.state === 'failed'
          ? t('chat.groupCall.failed')
          : t('chat.groupCall.active');

  const participantCount = snapshot.participants.length;
  const connected = snapshot.state === 'connected';

  const surface = (
    <div
      ref={surfaceRef}
      className={`sc-gcall sc-gcall--${displayMode}`}
      data-group-call-surface
      data-group-call-state={snapshot.state}
      data-group-call-display-mode={displayMode}
      role="dialog"
      aria-live="polite"
      aria-label={t('chat.groupCall.active')}
      style={displayMode === 'expanded'
        ? { width: `min(${TRAY_MAX_WIDTH + 200}px, calc(100vw - ${TRAY_EDGE * 2}px))` }
        : undefined}
    >
      {/* Header bar */}
      <div className="sc-gcall__header">
        <span className={`sc-gcall__state-glyph${connected ? ' is-connected' : ''}`}>
          <Users size={18} />
        </span>
        <div className="sc-gcall__heading">
          <strong>{groupName || stateLabel}</strong>
          <span>
            {groupName ? `${stateLabel} · ` : ''}
            {t('chat.groupCall.participants', { count: participantCount })}
          </span>
        </div>

        {/* Display mode toggles */}
        <div className="sc-gcall__display-toggle">
          {displayMode === 'compact' ? (
            <GroupCallButton
              label={t('chat.groupCall.videoCall')}
              onClick={() => setDisplayMode('expanded')}
              extra={{ 'data-group-call-display-mode-target': 'expanded' }}
            >
              <Maximize2 size={15} />
            </GroupCallButton>
          ) : (
            <>
              {displayMode === 'expanded' && (
                <GroupCallButton
                  label={t('chat.groupCall.fullscreen')}
                  onClick={() => setDisplayMode('fullscreen')}
                  extra={{ 'data-group-call-display-mode-target': 'fullscreen' }}
                >
                  <Expand size={15} />
                </GroupCallButton>
              )}
              <GroupCallButton
                label={t('chat.groupCall.compact')}
                onClick={() => setDisplayMode('compact')}
                extra={{ 'data-group-call-display-mode-target': 'compact' }}
              >
                <Minimize2 size={15} />
              </GroupCallButton>
            </>
          )}
        </div>
      </div>

      {displayMode === 'compact' && snapshot.participants.length > 0 ? (
        <div className="sc-gcall__badges">
          {snapshot.participants.slice(0, 4).map((participant) => (
            <ParticipantBadge key={participant.actorPtid} actorPtid={participant.actorPtid} />
          ))}
        </div>
      ) : null}

      <div aria-hidden="true" style={{ display: 'none' }}>
        {snapshot.participants.slice(1).map((participant) => (
          <ParticipantAudio key={participant.actorPtid} participant={participant} />
        ))}
      </div>

      {/* Participant grid (expanded modes only) */}
      {displayMode !== 'compact' && (
        <div className="sc-gcall__grid">
          {snapshot.participants.map((p, i) => (
            <ParticipantTile
              key={p.actorPtid}
              participant={p}
              isLocal={i === 0}
            />
          ))}
        </div>
      )}

      {/* Controls bar */}
      <div className="sc-gcall__controls">
        <GroupCallButton
          label={snapshot.localMicEnabled
            ? t('chat.groupCall.mic.on')
            : t('chat.groupCall.mic.off')}
          tone={snapshot.localMicEnabled ? undefined : 'muted'}
          onClick={handleToggleMic}
        >
          {snapshot.localMicEnabled ? <Mic size={15} /> : <MicOff size={15} />}
        </GroupCallButton>
        <GroupCallButton
          label={snapshot.localCameraEnabled
            ? t('chat.groupCall.camera.on')
            : t('chat.groupCall.camera.off')}
          tone={snapshot.localCameraEnabled ? undefined : 'muted'}
          onClick={handleToggleCamera}
        >
          {snapshot.localCameraEnabled ? <Camera size={15} /> : <CameraOff size={15} />}
        </GroupCallButton>
        <GroupCallButton
          label={t('chat.groupCall.leave')}
          tone="danger"
          onClick={handleLeave}
        >
          <PhoneOff size={15} />
        </GroupCallButton>
      </div>
    </div>
  );

  return createPortal(surface, document.body);
}
