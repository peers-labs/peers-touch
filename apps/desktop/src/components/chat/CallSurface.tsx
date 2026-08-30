// Call surface — renders the ringing modal AND the in-call HUD.
//
// Mounting strategy: this component subscribes to the
// `callP2p` manager's call-snapshot stream once at the page
// level (see SocialChatPage.tsx). It is intentionally peer-aware
// rather than per-conversation: a user can be on chat A while
// receiving a call from peer B, and the modal needs to surface the
// inbound call regardless of which session is currently open.
//
// State machine:
//   idle/ended    — render nothing
//   incoming      — full-screen ringing modal (Accept / Decline)
//   outgoing      — small floating HUD ("Ringing…" / Cancel)
//   active        — full HUD with mute / camera / hangup, plus
//                   <video> elements for both streams.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Dropdown, Modal, theme, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  Camera, CameraOff, Mic, MicOff, Phone, PhoneIncoming, PhoneOff, Settings, Video,
} from 'lucide-react';
import {
  callP2p,
  type CallEndReason,
  type CallMediaDevices,
  type CallSnapshot,
} from '../../modules/p2p/callP2p';
import { log } from '../../utils/logger';
import { toast } from '@lobehub/ui';

const { Text, Title } = Typography;

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
  const [now, setNow] = useState(() => Date.now());
  const [devices, setDevices] = useState<CallMediaDevices>({ audioInputs: [], videoInputs: [] });
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
  }, [active?.snapshot.localStream, active?.snapshot.remoteStream]);

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

  // ── INCOMING CALL: full-screen modal ──
  if (snapshot.state === 'incoming') {
    return (
      <Modal
        open
        closable={false}
        footer={null}
        centered
        maskClosable={false}
        styles={{ body: { padding: 0 } }}
        width={360}
      >
        <Flexbox align="center" gap={16} style={{ padding: '32px 24px' }}>
          <Flexbox
            align="center"
            justify="center"
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              background: token.colorPrimary,
              color: '#fff',
            }}
          >
            <PhoneIncoming size={36} />
          </Flexbox>
          <Title level={4} style={{ margin: 0, textAlign: 'center' }}>
            {t('chat.social.call.incomingTitle', {
              kind: isVideo ? t('chat.social.call.videoBadge') : t('chat.social.call.audioBadge'),
            })}
          </Title>
          <Text type="secondary" ellipsis style={{ maxWidth: 280 }}>
            {t('chat.social.call.incomingFrom', { from: peerPtid })}
          </Text>
          <Flexbox horizontal gap={12} style={{ marginTop: 8 }}>
            <Button
              danger
              size="large"
              icon={<PhoneOff size={18} />}
              onClick={handleDecline}
            >
              {t('chat.social.call.decline')}
            </Button>
            <Button
              type="primary"
              size="large"
              icon={isVideo ? <Video size={18} /> : <Phone size={18} />}
              onClick={handleAccept}
            >
              {t('chat.social.call.accept')}
            </Button>
          </Flexbox>
        </Flexbox>
      </Modal>
    );
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

  return (
    <Flexbox
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: isVideo ? 360 : 260,
        background: token.colorBgElevated,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 12,
        boxShadow: token.boxShadowSecondary,
        zIndex: 1000,
        overflow: 'hidden',
      }}
    >
      {/* Remote video (only if isVideo & media plane is up). For
          voice-only or ringing states we show a hero icon instead.
          The element stays mounted across a reconnect so recovery is
          seamless. */}
      {isVideo && hasMedia ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          muted={false}
          style={{
            width: '100%',
            height: 200,
            background: '#000',
            objectFit: 'cover',
          }}
        />
      ) : (
        <Flexbox
          align="center"
          justify="center"
          style={{ height: isVideo ? 200 : 100, background: token.colorFillTertiary }}
        >
          {isVideo ? (
            <Video size={48} style={{ color: token.colorTextTertiary }} />
          ) : (
            <Phone size={36} style={{ color: token.colorTextTertiary }} />
          )}
        </Flexbox>
      )}

      {/* Reconnecting banner — overlays the media so the user knows the
          call is recovering rather than frozen (voice-video-calls.md §6.5). */}
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

      {/* Local self-view PiP — only when video and not muted off. */}
      {isVideo && hasMedia && !snapshot.cameraOff && (
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 80,
            height: 60,
            background: '#000',
            borderRadius: 6,
            objectFit: 'cover',
            border: `1px solid ${token.colorBorder}`,
          }}
        />
      )}

      {/* Always-on remote audio — invisible. The browser autoplay
          policy lets us start audio without a click because we just
          accepted a getUserMedia prompt, which counts as a user
          gesture. */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      <Flexbox style={{ padding: 12 }} gap={8}>
        <Flexbox horizontal align="center" justify="space-between">
          <Text strong ellipsis style={{ maxWidth: 200 }}>
            {peerPtid}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {isActive
              ? formatDuration(elapsed)
              : isReconnecting
                ? t('chat.social.call.reconnecting')
                : snapshot.state === 'outgoing'
                  ? t('chat.social.call.ringing')
                  : t('chat.social.call.connecting')}
          </Text>
        </Flexbox>

        <Flexbox horizontal gap={8} justify="center" style={{ marginTop: 4 }}>
          {hasMedia && (
            <Tooltip title={snapshot.micMuted ? t('chat.social.call.unmuteMic') : t('chat.social.call.muteMic')}>
              <Button
                shape="circle"
                size="large"
                icon={snapshot.micMuted ? <MicOff size={18} /> : <Mic size={18} />}
                onClick={() => callP2p.toggleMic(myDid, peerPtid, !snapshot.micMuted)}
              />
            </Tooltip>
          )}

          {hasMedia && isVideo && (
            <Tooltip title={snapshot.cameraOff ? t('chat.social.call.cameraOn') : t('chat.social.call.cameraOff')}>
              <Button
                shape="circle"
                size="large"
                icon={snapshot.cameraOff ? <CameraOff size={18} /> : <Camera size={18} />}
                onClick={() => callP2p.toggleCamera(myDid, peerPtid, !snapshot.cameraOff)}
              />
            </Tooltip>
          )}

          {hasMedia && deviceMenu.length > 0 && (
            <Dropdown
              menu={{ items: deviceMenu }}
              trigger={['click']}
              placement="top"
            >
              <Tooltip title={t('chat.social.call.devices')}>
                <Button shape="circle" size="large" icon={<Settings size={18} />} />
              </Tooltip>
            </Dropdown>
          )}

          <Tooltip title={hasMedia ? t('chat.social.call.hangup') : t('chat.social.call.cancel')}>
            <Button
              danger
              type="primary"
              shape="circle"
              size="large"
              icon={<PhoneOff size={18} />}
              onClick={handleHangup}
            />
          </Tooltip>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}
