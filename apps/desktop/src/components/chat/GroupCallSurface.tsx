import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { theme, Typography } from 'antd';
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
import { ActionIcon, toast } from '@lobehub/ui';

const { Text } = Typography;

type DisplayMode = 'compact' | 'expanded' | 'fullscreen';

const TRAY_EDGE = 20;
const TRAY_MAX_WIDTH = 360;

function ParticipantTile({
  participant,
  isLocal,
}: {
  participant: Participant;
  isLocal: boolean;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const qualityColor =
    participant.connectionQuality === 'excellent' || participant.connectionQuality === 'good'
      ? token.colorSuccess
      : participant.connectionQuality === 'poor'
        ? token.colorWarning
        : token.colorError;

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
    <Flexbox
      data-group-call-participant={participant.actorPtid}
      data-group-call-participant-local={isLocal ? 'true' : 'false'}
      data-group-call-camera={participant.isCameraEnabled ? 'on' : 'off'}
      data-group-call-microphone={participant.isMicEnabled ? 'on' : 'off'}
      align="center"
      justify="center"
      style={{
        width: 80,
        height: 80,
        borderRadius: 12,
        background: token.colorFillSecondary,
        border: participant.isSpeaking
          ? `2px solid ${token.colorPrimary}`
          : `1px solid ${token.colorBorderSecondary}`,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <video
        ref={videoRef}
        muted={isLocal}
        aria-label={participant.actorPtid}
        style={{
          display: participant.isCameraEnabled ? 'block' : 'none',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          borderRadius: 10,
        }}
      />
      {!participant.isCameraEnabled && (
        <Text strong ellipsis style={{ fontSize: 11, maxWidth: 68, textAlign: 'center' }}>
          {isLocal ? t('chat.groupCall.you') : participant.actorPtid.slice(0, 12)}
        </Text>
      )}
      <Flexbox
        horizontal
        align="center"
        gap={2}
        style={{
          position: 'absolute',
          bottom: 4,
          left: 4,
          right: 4,
          justifyContent: 'center',
        }}
      >
        {!participant.isMicEnabled && <MicOff size={10} color={token.colorTextTertiary} />}
        {!participant.isCameraEnabled && <CameraOff size={10} color={token.colorTextTertiary} />}
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: qualityColor,
            display: 'inline-block',
          }}
        />
      </Flexbox>
    </Flexbox>
  );
}

function ParticipantAudio({ participant }: { participant: Participant }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => groupCallManager.attachParticipantMedia(
    participant.actorPtid,
    null,
    audioRef.current,
  ), [participant.actorPtid, participant.isMicEnabled]);

  return (
    <audio
      ref={audioRef}
      data-group-call-remote-audio={participant.actorPtid}
      aria-label={participant.actorPtid}
    />
  );
}

export function GroupCallSurface() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [snapshot, setSnapshot] = useState<GroupCallSnapshot>(
    () => groupCallManager.getSnapshot(),
  );
  const [activeRooms, setActiveRooms] = useState<Map<string, string>>(new Map());
  const [displayMode, setDisplayMode] = useState<DisplayMode>('compact');
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  void activeRooms;

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
      toast.error(t('chat.groupCall.failed'));
    }
  }, [snapshot.localMicEnabled, t]);

  const handleToggleCamera = useCallback(async () => {
    try {
      await groupCallManager.setCameraEnabled(!snapshot.localCameraEnabled);
    } catch (error) {
      log.warn('groupCallSurface', 'toggle camera failed', error);
      toast.error(t('chat.groupCall.failed'));
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

  const compactSurface = (
    <Flexbox
      ref={surfaceRef}
      data-group-call-surface
      data-group-call-state={snapshot.state}
      data-group-call-display-mode={displayMode}
      role="dialog"
      aria-live="polite"
      aria-label={t('chat.groupCall.active')}
      style={{
        position: 'fixed',
        right: TRAY_EDGE,
        bottom: TRAY_EDGE,
        zIndex: 1100,
        width:
          displayMode === 'fullscreen'
            ? '100vw'
            : displayMode === 'expanded'
              ? `min(${TRAY_MAX_WIDTH + 200}px, calc(100vw - ${TRAY_EDGE * 2}px))`
              : `min(${TRAY_MAX_WIDTH}px, calc(100vw - ${TRAY_EDGE * 2}px))`,
        ...(displayMode === 'fullscreen'
          ? { top: 0, left: 0, right: 0, bottom: 0, borderRadius: 0 }
          : {}),
        maxHeight: displayMode === 'fullscreen' ? '100vh' : 400,
        padding: '10px 12px',
        borderRadius: displayMode === 'fullscreen' ? 0 : 14,
        border:
          displayMode === 'fullscreen'
            ? 'none'
            : `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgElevated,
        boxShadow: displayMode === 'fullscreen' ? 'none' : token.boxShadowSecondary,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* Header bar */}
      <Flexbox horizontal align="center" gap={10} style={{ marginBottom: 8 }}>
        <Flexbox
          align="center"
          justify="center"
          style={{
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: 10,
            background:
              snapshot.state === 'connected'
                ? token.colorSuccessBg
                : token.colorWarningBg,
            color:
              snapshot.state === 'connected'
                ? token.colorSuccess
                : token.colorWarning,
          }}
        >
          <Users size={18} />
        </Flexbox>
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <Text strong ellipsis style={{ fontSize: 13 }}>
            {stateLabel}
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('chat.groupCall.participants', { count: participantCount })}
          </Text>
        </Flexbox>

        {/* Display mode toggles */}
        <Flexbox horizontal align="center" gap={2} style={{ flexShrink: 0 }}>
          {displayMode === 'compact' ? (
            <ActionIcon
              icon={Maximize2}
              size="small"
              onClick={() => setDisplayMode('expanded')}
              data-group-call-display-mode-target="expanded"
              title={t('chat.groupCall.videoCall')}
            />
          ) : (
            <>
              {displayMode === 'expanded' && (
                <ActionIcon
                  icon={Expand}
                  size="small"
                  onClick={() => setDisplayMode('fullscreen')}
                  data-group-call-display-mode-target="fullscreen"
                  title={t('chat.groupCall.fullscreen')}
                />
              )}
              <ActionIcon
                icon={Minimize2}
                size="small"
                onClick={() => setDisplayMode('compact')}
                data-group-call-display-mode-target="compact"
                title={t('chat.groupCall.compact')}
              />
            </>
          )}
        </Flexbox>
      </Flexbox>

      <div aria-hidden="true" style={{ display: 'none' }}>
        {snapshot.participants.slice(1).map((participant) => (
          <ParticipantAudio key={participant.actorPtid} participant={participant} />
        ))}
      </div>

      {/* Participant grid (expanded modes only) */}
      {displayMode !== 'compact' && (
        <Flexbox
          horizontal
          wrap="wrap"
          gap={8}
          align="flex-start"
          style={{
            padding: '8px 0',
            maxHeight: displayMode === 'fullscreen' ? 'calc(100vh - 120px)' : 240,
            overflowY: 'auto',
          }}
        >
          {snapshot.participants.map((p, i) => (
            <ParticipantTile
              key={p.actorPtid}
              participant={p}
              isLocal={i === 0}
            />
          ))}
        </Flexbox>
      )}

      {/* Controls bar */}
      <Flexbox horizontal align="center" justify="center" gap={8} style={{ marginTop: 4 }}>
        <ActionIcon
          icon={snapshot.localMicEnabled ? Mic : MicOff}
          size="small"
          onClick={handleToggleMic}
          title={
            snapshot.localMicEnabled
              ? t('chat.groupCall.mic.on')
              : t('chat.groupCall.mic.off')
          }
          style={{
            color: snapshot.localMicEnabled ? token.colorText : token.colorTextTertiary,
          }}
        />
        <ActionIcon
          icon={snapshot.localCameraEnabled ? Camera : CameraOff}
          size="small"
          onClick={handleToggleCamera}
          title={
            snapshot.localCameraEnabled
              ? t('chat.groupCall.camera.on')
              : t('chat.groupCall.camera.off')
          }
          style={{
            color: snapshot.localCameraEnabled ? token.colorText : token.colorTextTertiary,
          }}
        />
        <ActionIcon
          icon={PhoneOff}
          size="small"
          onClick={handleLeave}
          title={t('chat.groupCall.leave')}
          style={{ color: token.colorError }}
        />
      </Flexbox>
    </Flexbox>
  );

  return createPortal(compactSurface, document.body);
}
