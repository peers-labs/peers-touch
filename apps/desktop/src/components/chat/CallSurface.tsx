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

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Popover as PtPopover } from '@peers-touch/ui';
import {
  Camera,
  CameraOff,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PanelTop,
  Phone,
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
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { useChatActorIdentity } from './useChatActorIdentity';
import { notifyError } from '../../ui/feedback';

type CallDisplayMode = 'compact' | 'chat' | 'fullscreen';

// North-star .sk-call-hud anchors the floating tray 22px from the viewport edge.
const CALL_TRAY_EDGE = 22;
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

function CallButton({
  label,
  onClick,
  variant = 'neutral',
  size = 32,
  pressed,
  children,
  extra,
}: {
  label: string;
  onClick: () => void;
  variant?: 'neutral' | 'danger' | 'success' | 'glass';
  size?: number;
  pressed?: boolean;
  children: ReactNode;
  extra?: Record<string, string>;
}) {
  return (
    <button
      type="button"
      className={`sc-call__btn sc-call__btn--${variant}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-chat-call-display-mode-target={extra?.['data-chat-call-display-mode-target']}
      data-chat-call-camera={extra?.['data-chat-call-camera']}
      style={{ width: size, height: size }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function CallSurface() {
  const { t } = useTranslation('chat');
  // We track the *single* active call snapshot. The manager already
  // refuses overlapping calls (it auto-rejects a second
  // CALL_REQUEST while one is in flight) so we never need to
  // surface more than one at a time.
  const [active, setActive] = useState<ActivePeer | null>(null);
  const peerIdentity = useChatActorIdentity(active?.peerPtid ?? '');
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
          if (key) notifyError(t(key));
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

  // Stream identity can stay unchanged while a camera or display transition
  // mounts new elements. Bind after those transitions as well.
  useEffect(() => {
    if (!active) return;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = active.snapshot.localStream ?? null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = active.snapshot.remoteStream ?? null;
    }
    if (remoteAudioRef.current) {
      // The dedicated audio element is the only audible remote outlet.
      remoteAudioRef.current.srcObject = active.snapshot.remoteStream ?? null;
    }
  }, [
    active?.snapshot.localStream, active?.snapshot.remoteStream,
    active?.snapshot.mediaKind, active?.snapshot.cameraOff, hasMediaPlane, displayMode,
  ]);

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
      notifyError(t('chat.social.call.mediaDenied'));
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
      notifyError(t('chat.social.call.deviceSwitchFailed'));
    });
  };

  const handleSwitchVideo = (deviceId: string) => {
    callP2p.switchVideoDevice(myDid, peerPtid, deviceId).catch((error) => {
      log.warn('callSurface', 'switch camera failed', error);
      notifyError(t('chat.social.call.deviceSwitchFailed'));
    });
  };

  // Incoming calls use the same global compact tray boundary as Agent
  // background operations so they remain actionable without blocking Chat.
  if (snapshot.state === 'incoming') {
    const incomingTitle = t('chat.social.call.incomingTitle', {
      kind: isVideo ? t('chat.social.call.videoBadge') : t('chat.social.call.audioBadge'),
    });
    const incomingSurface = (
      <div
        className="sc-call sc-call--tray"
        data-chat-call-surface
        data-chat-call-state="incoming"
        data-chat-call-media-kind={snapshot.mediaKind}
        data-chat-call-display-mode="compact"
        role="dialog"
        aria-live="assertive"
        aria-label={incomingTitle}
        style={{ width: `min(${CALL_TRAY_MAX_WIDTH}px, calc(100vw - ${CALL_TRAY_EDGE * 2}px))` }}
      >
        <UserSquareAvatar
          remoteUrl={peerIdentity.avatarUrl}
          name={peerIdentity.displayName}
          size={40}
        />
        <div className="sc-call__tray-body">
          <strong>{incomingTitle}</strong>
          <span>{t('chat.social.call.incomingFrom', { from: peerIdentity.displayName })}</span>
        </div>
        <div className="sc-call__tray-actions">
          <CallButton label={t('chat.social.call.decline')} variant="danger" onClick={handleDecline}>
            <PhoneOff size={15} />
          </CallButton>
          <CallButton label={t('chat.social.call.accept')} variant="success" onClick={() => void handleAccept()}>
            {isVideo ? <Video size={15} /> : <Phone size={15} />}
          </CallButton>
        </div>
      </div>
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

  const deviceMenu = (
    <div className="sc-call__devices">
      {devices.audioInputs.length > 0 && (
        <>
          <div className="sc-call__devices-label">{t('chat.social.call.selectMic')}</div>
          {devices.audioInputs.map((d, i) => (
            <button
              type="button"
              key={`audio:${d.deviceId}`}
              className={`sc-call__device${snapshot.audioDeviceId === d.deviceId ? ' is-active' : ''}`}
              onClick={() => handleSwitchAudio(d.deviceId)}
            >
              {snapshot.audioDeviceId === d.deviceId && <Mic size={13} />}
              <span>{d.label || t('chat.social.call.deviceFallbackMic', { index: i + 1 })}</span>
            </button>
          ))}
        </>
      )}
      {isVideo && devices.videoInputs.length > 0 && (
        <>
          <div className="sc-call__devices-label">{t('chat.social.call.selectCamera')}</div>
          {devices.videoInputs.map((d, i) => (
            <button
              type="button"
              key={`video:${d.deviceId}`}
              className={`sc-call__device${snapshot.videoDeviceId === d.deviceId ? ' is-active' : ''}`}
              onClick={() => handleSwitchVideo(d.deviceId)}
            >
              {snapshot.videoDeviceId === d.deviceId && <Camera size={13} />}
              <span>{d.label || t('chat.social.call.deviceFallbackCamera', { index: i + 1 })}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );

  const effectiveDisplayMode: CallDisplayMode = isVideo ? displayMode : 'compact';
  const expandedVideo = isVideo && effectiveDisplayMode !== 'compact';
  const status = isActive
    ? formatDuration(elapsed)
    : isReconnecting
      ? t('chat.social.call.reconnecting')
      : snapshot.state === 'outgoing'
        ? t('chat.social.call.ringing')
        : t('chat.social.call.connecting');

  const callControls = (
    <div className="sc-call__controls">
      {hasMedia && (
        <CallButton
          label={snapshot.micMuted ? t('chat.social.call.unmuteMic') : t('chat.social.call.muteMic')}
          pressed={snapshot.micMuted}
          onClick={() => callP2p.toggleMic(myDid, peerPtid, !snapshot.micMuted)}
        >
          {snapshot.micMuted ? <MicOff size={15} /> : <Mic size={15} />}
        </CallButton>
      )}
      {hasMedia && isVideo && (
        <CallButton
          label={snapshot.cameraOff ? t('chat.social.call.cameraOn') : t('chat.social.call.cameraOff')}
          pressed={snapshot.cameraOff}
          onClick={() => callP2p.toggleCamera(myDid, peerPtid, !snapshot.cameraOff)}
          extra={{ 'data-chat-call-camera': 'true' }}
        >
          {snapshot.cameraOff ? <CameraOff size={15} /> : <Camera size={15} />}
        </CallButton>
      )}
      {hasMedia && (devices.audioInputs.length > 0 || (isVideo && devices.videoInputs.length > 0)) && (
        <PtPopover placement="top" content={deviceMenu} label={t('chat.social.call.devices')}>
          <CallButton label={t('chat.social.call.devices')} onClick={() => {}}>
            <Settings size={15} />
          </CallButton>
        </PtPopover>
      )}
      <CallButton
        label={hasMedia ? t('chat.social.call.hangup') : t('chat.social.call.cancel')}
        variant="danger"
        onClick={handleHangup}
      >
        <PhoneOff size={15} />
      </CallButton>
    </div>
  );

  const surface = (
    <div
      ref={surfaceRef}
      className={`sc-call sc-call--${effectiveDisplayMode}${isVideo ? ' is-video' : ' is-audio'}`}
      data-chat-call-surface
      data-chat-call-state={snapshot.state}
      data-chat-call-media-kind={snapshot.mediaKind}
      data-chat-call-display-mode={effectiveDisplayMode}
      role={expandedVideo ? 'dialog' : 'status'}
      aria-modal={effectiveDisplayMode === 'fullscreen' ? true : undefined}
      aria-label={isVideo ? t('chat.social.call.startVideo') : t('chat.social.call.startAudio')}
      tabIndex={expandedVideo ? -1 : undefined}
      style={effectiveDisplayMode === 'compact'
        ? {
            width: `min(${CALL_TRAY_MAX_WIDTH}px, calc(100vw - ${CALL_TRAY_EDGE * 2}px))`,
          }
        : undefined}
    >
      {!isVideo && (
        <div className="sc-call__bar">
          <UserSquareAvatar
            remoteUrl={peerIdentity.avatarUrl}
            name={peerIdentity.displayName}
            size={40}
          />
          <div className="sc-call__bar-body">
            <strong>{peerIdentity.displayName}</strong>
            <span>{status}</span>
          </div>
          {callControls}
        </div>
      )}

      {isVideo && (
        <div className="sc-call__video">
          {hasMedia ? (
            <video
              data-chat-call-remote-video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted
            />
          ) : (
            <div className="sc-call__video-placeholder">
              <UserSquareAvatar
                remoteUrl={peerIdentity.avatarUrl}
                name={peerIdentity.displayName}
                size={expandedVideo ? 80 : 56}
              />
            </div>
          )}

          {isReconnecting && (
            <div className="sc-call__reconnecting">{t('chat.social.call.reconnecting')}</div>
          )}
          {hasMedia && !snapshot.cameraOff && (
            <video
              data-chat-call-local-video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={expandedVideo ? 'is-expanded' : ''}
            />
          )}

          <div className="sc-call__display-modes">
            {([
              ['compact', Minimize2, 'chat.social.call.compactWindow'],
              ['chat', PanelTop, 'chat.social.call.fillChat'],
              ['fullscreen', Maximize2, 'chat.social.call.fullscreen'],
            ] as const).map(([mode, Glyph, titleKey]) => (
              <CallButton
                key={mode}
                label={t(titleKey)}
                variant="glass"
                size={28}
                pressed={effectiveDisplayMode === mode}
                onClick={() => setDisplayMode(mode)}
                extra={{ 'data-chat-call-display-mode-target': mode }}
              >
                <Glyph size={14} />
              </CallButton>
            ))}
          </div>
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
        <div className={`sc-call__footer${expandedVideo ? ' is-expanded' : ''}`}>
          <div className="sc-call__footer-id">
            <UserSquareAvatar
              remoteUrl={peerIdentity.avatarUrl}
              name={peerIdentity.displayName}
              size={32}
            />
            <strong>{peerIdentity.displayName}</strong>
            <span>{status}</span>
          </div>
          {callControls}
        </div>
      )}
    </div>
  );

  return effectiveDisplayMode === 'chat' || typeof document === 'undefined'
    ? surface
    : createPortal(surface, document.body);
}
