// Call surface — renders the compact global call tray and scalable video view.
//
// Mounting strategy: this component subscribes to the
// `callP2p` manager's call-snapshot stream once at the page
// level (see SocialChatPage.tsx). It is intentionally peer-aware
// rather than per-conversation: a user can be on chat A while
// receiving a call from peer B, and the tray needs to surface the
// inbound call regardless of which session is currently open.
//
// State machine:
//   idle/ended    — render nothing
//   incoming      — compact global tray (Accept / Decline)
//   outgoing      — compact global tray ("Ringing…" / Cancel)
//   active        — compact tray or expanded video with media controls.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Dropdown, theme, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  Camera,
  CameraOff,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PanelTop,
  Phone,
  PhoneIncoming,
  PhoneOff,
  Settings,
  Video,
} from 'lucide-react';
import {
  callP2p,
  type CallEndReason,
  type CallMediaDevices,
  type CallSnapshot,
} from '../../modules/p2p/callP2p';
import { log } from '../../utils/logger';
import { ActionIcon, toast } from '@lobehub/ui';

const { Text } = Typography;

type CallDisplayMode = 'compact' | 'chat' | 'fullscreen';

const CALL_TRAY_EDGE = 20;
const CALL_TRAY_MAX_WIDTH = 320;

/** Map a terminal call result onto a localized, user-explainable
 *  message key. Phase 1 acceptance (voice-video-calls.md §11) requires
 *  rejected / missed / canceled / permission-denied / network-failed to
 *  be visually distinct; a normal hangup needs no toast. */
const END_REASON_KEY: Record<CallEndReason, string | null> = {
  hangup: null,
  rejected: 'chat.social.call.resultRejected',
  'no-answer': 'chat.social.call.resultNoAnswer',
  busy: 'chat.social.call.resultBusy',
  canceled: null,
  'media-failed': 'chat.social.call.resultMediaFailed',
  'network-failed': 'chat.social.call.resultNetworkFailed',
  'handled-elsewhere': null,
};

interface ActivePeer {
  myDid: string;
  peerPtid: string;
  snapshot: CallSnapshot;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function CallSurface() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  // We track the *single* active call snapshot. The manager already
  // refuses overlapping calls (it auto-rejects a second
  // CALL_REQUEST while one is in flight) so we never need to
  // surface more than one at a time.
  const [active, setActive] = useState<ActivePeer | null>(null);
  const [displayMode, setDisplayMode] = useState<CallDisplayMode>('compact');
  const [now, setNow] = useState(() => Date.now());
  const [devices, setDevices] = useState<CallMediaDevices>({ audioInputs: [], videoInputs: [] });
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Subscribe once. Snapshot in == snapshot in state; we filter
  // terminal states (idle/ended) by clearing `active`.
  useEffect(() => {
    callP2p.setOnCall((myDid, peerPtid, snapshot) => {
      if (snapshot.state === 'idle' || snapshot.state === 'ended') {
        // Surface a distinct, localized result for non-trivial endings
        // (declined / missed / busy / permission / network). A clean
        // hangup or self-cancel needs no toast.
        if (snapshot.state === 'ended' && snapshot.endReason) {
          const key = END_REASON_KEY[snapshot.endReason];
          if (key) toast.error(t(key));
        }
        setActive((cur) => (cur && cur.peerPtid === peerPtid ? null : cur));
        return;
      }
      setActive({ myDid, peerPtid, snapshot });
    });
    return () => {
      callP2p.setOnCall(null);
    };
  }, [t]);

  useEffect(() => {
    setDisplayMode('compact');
  }, [active?.myDid, active?.peerPtid, active?.snapshot.mediaKind]);

  // Tick clock for the in-call duration label. Cheap (1Hz).
  useEffect(() => {
    if (!active || active.snapshot.state !== 'active') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  // Enumerate input devices for the picker once media is flowing (labels
  // are only populated after a getUserMedia grant) and refresh on
  // hot-plug. Skipped entirely while no call is up to avoid surfacing an
  // empty, label-less list.
  const hasMediaPlane =
    !!active && (active.snapshot.state === 'active' || active.snapshot.state === 'reconnecting');
  useEffect(() => {
    if (!hasMediaPlane || !navigator.mediaDevices) return;
    let cancelled = false;
    const refresh = () => {
      callP2p.listMediaDevices().then((d) => {
        if (!cancelled) setDevices(d);
      });
    };
    refresh();
    navigator.mediaDevices.addEventListener?.('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.('devicechange', refresh);
    };
  }, [hasMediaPlane]);

  // Bind media streams to the <video>/<audio> elements whenever the
  // snapshot's stream identity changes. Setting srcObject is
  // idempotent for the same MediaStream instance, so this is safe
  // to re-run on every render.
  useEffect(() => {
    if (!active) return;
    if (localVideoRef.current && active.snapshot.localStream) {
      localVideoRef.current.srcObject = active.snapshot.localStream;
    }
    if (remoteVideoRef.current && active.snapshot.remoteStream) {
      remoteVideoRef.current.srcObject = active.snapshot.remoteStream;
    }
    if (remoteAudioRef.current && active.snapshot.remoteStream) {
      // We render BOTH a <video> and an <audio> for the remote
      // stream — voice-only calls have no video tracks, and
      // muxing audio through the <video> only works once it's
      // visible. Keeping a dedicated <audio> sidesteps both.
      remoteAudioRef.current.srcObject = active.snapshot.remoteStream;
    }
  }, [active?.snapshot.localStream, active?.snapshot.remoteStream, displayMode]);

  useEffect(() => {
    const expanded =
      active?.snapshot.mediaKind === 'video' && displayMode !== 'compact';
    const surface = surfaceRef.current;
    if (!expanded || !surface || typeof document === 'undefined') return;

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const scope = displayMode === 'fullscreen'
      ? document.body
      : surface.parentElement;
    const inertSiblings = scope
      ? Array.from(scope.children).filter((element) => element !== surface)
      : [];

    for (const sibling of inertSiblings) {
      sibling.setAttribute('inert', '');
    }
    surface.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDisplayMode('compact');
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      for (const sibling of inertSiblings) {
        sibling.removeAttribute('inert');
      }
      previousFocus?.focus();
    };
  }, [active?.snapshot.mediaKind, displayMode]);

  if (!active) return null;
  const { myDid, peerPtid, snapshot } = active;
  const isVideo = snapshot.mediaKind === 'video';

  const handleAccept = async () => {
    try {
      await callP2p.acceptCall(myDid, peerPtid);
    } catch (error) {
      log.warn('callSurface', 'accept failed', error);
      toast.error(t('chat.social.call.mediaDenied'));
    }
  };

  const handleDecline = () => {
    callP2p.rejectCall(myDid, peerPtid).catch(() => {});
  };

  const handleHangup = () => {
    callP2p.endCall(myDid, peerPtid).catch(() => {});
  };

  const handleSwitchAudio = (deviceId: string) => {
    callP2p.switchAudioDevice(myDid, peerPtid, deviceId).catch((error) => {
      log.warn('callSurface', 'switch mic failed', error);
      toast.error(t('chat.social.call.deviceSwitchFailed'));
    });
  };

  const handleSwitchVideo = (deviceId: string) => {
    callP2p.switchVideoDevice(myDid, peerPtid, deviceId).catch((error) => {
      log.warn('callSurface', 'switch camera failed', error);
      toast.error(t('chat.social.call.deviceSwitchFailed'));
    });
  };

  // Incoming calls use the same global compact tray boundary as Agent
  // background operations so they remain actionable without blocking Chat.
  if (snapshot.state === 'incoming') {
    const incomingSurface = (
      <Flexbox
        data-chat-call-surface
        data-chat-call-state="incoming"
        data-chat-call-media-kind={snapshot.mediaKind}
        data-chat-call-display-mode="compact"
        role="dialog"
        aria-live="assertive"
        aria-label={t('chat.social.call.incomingTitle', {
          kind: isVideo ? t('chat.social.call.videoBadge') : t('chat.social.call.audioBadge'),
        })}
        horizontal
        align="center"
        gap={10}
        style={{
          position: 'fixed',
          right: CALL_TRAY_EDGE,
          bottom: CALL_TRAY_EDGE,
          zIndex: 1100,
          width: `min(${CALL_TRAY_MAX_WIDTH}px, calc(100vw - ${CALL_TRAY_EDGE * 2}px))`,
          minHeight: 64,
          padding: '10px 12px',
          borderRadius: 14,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgElevated,
          boxShadow: token.boxShadowSecondary,
          boxSizing: 'border-box',
        }}
      >
        <Flexbox
          align="center"
          justify="center"
          style={{
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: 10,
            background: token.colorPrimaryBg,
            color: token.colorPrimary,
          }}
        >
          <PhoneIncoming size={20} />
        </Flexbox>
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <Text strong ellipsis style={{ fontSize: 13 }}>
            {t('chat.social.call.incomingTitle', {
              kind: isVideo ? t('chat.social.call.videoBadge') : t('chat.social.call.audioBadge'),
            })}
          </Text>
          <Text type="secondary" ellipsis style={{ fontSize: 11 }}>
            {t('chat.social.call.incomingFrom', { from: peerPtid })}
          </Text>
        </Flexbox>
        <Flexbox horizontal align="center" gap={4} style={{ flexShrink: 0 }}>
          <ActionIcon
            icon={PhoneOff}
            title={t('chat.social.call.decline')}
            size={{ blockSize: 32, size: 15 }}
            onClick={handleDecline}
            style={{ borderRadius: 999, background: token.colorError, color: token.colorTextLightSolid }}
          />
          <ActionIcon
            icon={isVideo ? Video : Phone}
            title={t('chat.social.call.accept')}
            size={{ blockSize: 32, size: 15 }}
            onClick={() => void handleAccept()}
            style={{ borderRadius: 999, background: token.colorSuccess, color: token.colorTextLightSolid }}
          />
        </Flexbox>
      </Flexbox>
    );
    return typeof document === 'undefined'
      ? incomingSurface
      : createPortal(incomingSurface, document.body);
  }

  // ── OUTGOING (ringing) + ACTIVE + RECONNECTING: floating HUD ──
  // Anchored to the bottom-right so it doesn't cover the chat list
  // (mirrors WhatsApp / Slack patterns). User can keep typing in
  // the chat behind the HUD.
  const isActive = snapshot.state === 'active';
  const isReconnecting = snapshot.state === 'reconnecting';
  // The media plane stays mounted across a reconnect — keep the <video>
  // elements alive and tracks bound so recovery is seamless.
  const hasMedia = isActive || isReconnecting;
  const elapsed = isActive && snapshot.startedAt ? now - snapshot.startedAt : 0;

  // Build the device-picker menu. Each input kind becomes a group with a
  // selectable item per device; the currently-captured device shows a
  // check. Labels fall back to a generic numbered name when the browser
  // withholds them (e.g. before any permission grant on this origin).
  const deviceMenu: MenuProps['items'] = [];
  if (devices.audioInputs.length > 0) {
    deviceMenu.push({
      type: 'group',
      label: t('chat.social.call.selectMic'),
      children: devices.audioInputs.map((d, i) => ({
        key: `audio:${d.deviceId}`,
        label: d.label || t('chat.social.call.deviceFallbackMic', { index: i + 1 }),
        onClick: () => handleSwitchAudio(d.deviceId),
        ...(snapshot.audioDeviceId === d.deviceId ? { icon: <Mic size={14} /> } : {}),
      })),
    });
  }
  if (isVideo && devices.videoInputs.length > 0) {
    deviceMenu.push({
      type: 'group',
      label: t('chat.social.call.selectCamera'),
      children: devices.videoInputs.map((d, i) => ({
        key: `video:${d.deviceId}`,
        label: d.label || t('chat.social.call.deviceFallbackCamera', { index: i + 1 }),
        onClick: () => handleSwitchVideo(d.deviceId),
        ...(snapshot.videoDeviceId === d.deviceId ? { icon: <Camera size={14} /> } : {}),
      })),
    });
  }

  const effectiveDisplayMode: CallDisplayMode = isVideo ? displayMode : 'compact';
  const expandedVideo = isVideo && effectiveDisplayMode !== 'compact';
  const status = isActive
    ? formatDuration(elapsed)
    : isReconnecting
      ? t('chat.social.call.reconnecting')
      : snapshot.state === 'outgoing'
        ? t('chat.social.call.ringing')
        : t('chat.social.call.connecting');
  const neutralControlStyle = {
    borderRadius: 999,
    border: `1px solid ${token.colorBorderSecondary}`,
    background: token.colorBgContainer,
    color: token.colorTextSecondary,
  };

  const callControls = (
    <Flexbox horizontal align="center" gap={4} style={{ flexShrink: 0 }}>
      {hasMedia && (
        <ActionIcon
          icon={snapshot.micMuted ? MicOff : Mic}
          title={snapshot.micMuted ? t('chat.social.call.unmuteMic') : t('chat.social.call.muteMic')}
          size={{ blockSize: 32, size: 15 }}
          onClick={() => callP2p.toggleMic(myDid, peerPtid, !snapshot.micMuted)}
          style={neutralControlStyle}
        />
      )}
      {hasMedia && isVideo && (
        <ActionIcon
          icon={snapshot.cameraOff ? CameraOff : Camera}
          title={snapshot.cameraOff ? t('chat.social.call.cameraOn') : t('chat.social.call.cameraOff')}
          size={{ blockSize: 32, size: 15 }}
          onClick={() => callP2p.toggleCamera(myDid, peerPtid, !snapshot.cameraOff)}
          style={neutralControlStyle}
        />
      )}
      {hasMedia && deviceMenu.length > 0 && (
        <Dropdown menu={{ items: deviceMenu }} trigger={['click']} placement="top">
          <ActionIcon
            icon={Settings}
            title={t('chat.social.call.devices')}
            size={{ blockSize: 32, size: 15 }}
            style={neutralControlStyle}
          />
        </Dropdown>
      )}
      <ActionIcon
        icon={PhoneOff}
        title={hasMedia ? t('chat.social.call.hangup') : t('chat.social.call.cancel')}
        size={{ blockSize: 32, size: 15 }}
        onClick={handleHangup}
        style={{ borderRadius: 999, background: token.colorError, color: token.colorTextLightSolid }}
      />
    </Flexbox>
  );

  const surface = (
    <Flexbox
      ref={surfaceRef}
      data-chat-call-surface
      data-chat-call-state={snapshot.state}
      data-chat-call-media-kind={snapshot.mediaKind}
      data-chat-call-display-mode={effectiveDisplayMode}
      role={expandedVideo ? 'dialog' : 'status'}
      aria-modal={effectiveDisplayMode === 'fullscreen' ? true : undefined}
      aria-label={isVideo ? t('chat.social.call.startVideo') : t('chat.social.call.startAudio')}
      tabIndex={expandedVideo ? -1 : undefined}
      style={{
        position: effectiveDisplayMode === 'chat' ? 'absolute' : 'fixed',
        ...(effectiveDisplayMode === 'compact'
          ? {
              right: CALL_TRAY_EDGE,
              bottom: CALL_TRAY_EDGE,
              width: `min(${CALL_TRAY_MAX_WIDTH}px, calc(100vw - ${CALL_TRAY_EDGE * 2}px))`,
            }
          : { inset: 0, width: '100%', height: '100%' }),
        background: isVideo ? '#000' : token.colorBgElevated,
        border: effectiveDisplayMode === 'compact'
          ? `1px solid ${token.colorBorderSecondary}`
          : 'none',
        borderRadius: effectiveDisplayMode === 'compact' ? 14 : 0,
        boxShadow: effectiveDisplayMode === 'compact' ? token.boxShadowSecondary : 'none',
        zIndex: effectiveDisplayMode === 'fullscreen' ? 2000 : 1100,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {!isVideo && (
        <Flexbox
          horizontal
          align="center"
          gap={10}
          style={{
            minHeight: 64,
            padding: '10px 12px',
            background: token.colorBgElevated,
            boxSizing: 'border-box',
          }}
        >
          <Flexbox
            align="center"
            justify="center"
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: 10,
              background: token.colorPrimaryBg,
              color: token.colorPrimary,
            }}
          >
            <Phone size={20} />
          </Flexbox>
          <Flexbox flex={1} style={{ minWidth: 0 }}>
            <Text strong ellipsis style={{ fontSize: 13 }}>{peerPtid}</Text>
            <Text type="secondary" ellipsis style={{ fontSize: 11 }}>{status}</Text>
          </Flexbox>
          {callControls}
        </Flexbox>
      )}

      {isVideo && (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: expandedVideo ? undefined : 184,
            flex: expandedVideo ? 1 : undefined,
            minHeight: 0,
            background: '#000',
          }}
        >
          {hasMedia ? (
            <video
              data-chat-call-remote-video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted={false}
              style={{ width: '100%', height: '100%', background: '#000', objectFit: 'cover' }}
            />
          ) : (
            <Flexbox align="center" justify="center" style={{ width: '100%', height: '100%', background: token.colorFillTertiary }}>
              <Video size={expandedVideo ? 54 : 40} style={{ color: token.colorTextTertiary }} />
            </Flexbox>
          )}

          {isReconnecting && (
            <Flexbox
              align="center"
              justify="center"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                padding: '6px 12px',
                background: token.colorWarning,
                color: token.colorTextLightSolid,
                fontSize: 12,
                zIndex: 1,
              }}
            >
              {t('chat.social.call.reconnecting')}
            </Flexbox>
          )}
          {hasMedia && !snapshot.cameraOff && (
            <video
              data-chat-call-local-video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={{
                position: 'absolute',
                right: expandedVideo ? 16 : 8,
                bottom: expandedVideo ? 16 : 8,
                width: expandedVideo ? 136 : 72,
                height: expandedVideo ? 92 : 52,
                background: '#000',
                borderRadius: 6,
                objectFit: 'cover',
                border: `1px solid ${token.colorBorder}`,
              }}
            />
          )}

          <Flexbox
            horizontal
            align="center"
            gap={2}
            style={{
              position: 'absolute',
              top: expandedVideo ? 12 : 8,
              right: expandedVideo ? 12 : 8,
              zIndex: 2,
              padding: 3,
              borderRadius: 8,
              background: 'rgba(15,23,42,0.56)',
              backdropFilter: 'blur(12px)',
            }}
          >
            {([
              ['compact', Minimize2, 'chat.social.call.compactWindow'],
              ['chat', PanelTop, 'chat.social.call.fillChat'],
              ['fullscreen', Maximize2, 'chat.social.call.fullscreen'],
            ] as const).map(([mode, Icon, titleKey]) => (
              <ActionIcon
                key={mode}
                data-chat-call-display-mode-target={mode}
                icon={Icon}
                title={t(titleKey)}
                aria-pressed={effectiveDisplayMode === mode}
                size={{ blockSize: 28, size: 14 }}
                onClick={() => setDisplayMode(mode)}
                style={{
                  borderRadius: 6,
                  background: effectiveDisplayMode === mode ? 'rgba(255,255,255,0.2)' : 'transparent',
                  color: token.colorTextLightSolid,
                }}
              />
            ))}
          </Flexbox>
        </div>
      )}

      {/* Remote audio stays mounted independently from video visibility so
          voice-only calls and display-mode changes preserve playback. */}
      <audio
        data-chat-call-remote-audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        style={{ display: 'none' }}
      />

      {isVideo && (
        <Flexbox
          horizontal={expandedVideo}
          align={expandedVideo ? 'center' : undefined}
          justify={expandedVideo ? 'space-between' : undefined}
          gap={expandedVideo ? 16 : 8}
          style={{
            padding: expandedVideo ? '10px 16px' : 12,
            background: token.colorBgElevated,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Flexbox horizontal align="center" justify="space-between" gap={8} style={{ minWidth: 0, flex: 1 }}>
            <Text strong ellipsis>{peerPtid}</Text>
            <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>{status}</Text>
          </Flexbox>
          {callControls}
        </Flexbox>
      )}
    </Flexbox>
  );

  return effectiveDisplayMode === 'chat' || typeof document === 'undefined'
    ? surface
    : createPortal(surface, document.body);
}
