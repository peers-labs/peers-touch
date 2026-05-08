// Call surface — renders the ringing modal AND the in-call HUD.
//
// Mounting strategy: this component subscribes to the
// `friendChatP2p` manager's call-snapshot stream once at the page
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
import { Button, Modal, theme, Tooltip, Typography } from 'antd';
import {
  Camera, CameraOff, Mic, MicOff, Phone, PhoneIncoming, PhoneOff, Video,
} from 'lucide-react';
import {
  friendChatP2p,
  type CallSnapshot,
} from '../../modules/p2p/friendChatP2p';
import { log } from '../../utils/logger';
import { toast } from '@lobehub/ui';

const { Text, Title } = Typography;

interface ActivePeer {
  myDid: string;
  peerDid: string;
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
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Subscribe once. Snapshot in == snapshot in state; we filter
  // terminal states (idle/ended) by clearing `active`.
  useEffect(() => {
    friendChatP2p.setOnCall((myDid, peerDid, snapshot) => {
      if (snapshot.state === 'idle' || snapshot.state === 'ended') {
        setActive((cur) => (cur && cur.peerDid === peerDid ? null : cur));
        return;
      }
      setActive({ myDid, peerDid, snapshot });
    });
    return () => {
      friendChatP2p.setOnCall(null);
    };
  }, []);

  // Tick clock for the in-call duration label. Cheap (1Hz).
  useEffect(() => {
    if (!active || active.snapshot.state !== 'active') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

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
  const { myDid, peerDid, snapshot } = active;
  const isVideo = snapshot.mediaKind === 'video';

  const handleAccept = async () => {
    try {
      await friendChatP2p.acceptCall(myDid, peerDid);
    } catch (error) {
      log.warn('callSurface', 'accept failed', error);
      toast.error(t('chat.social.call.mediaDenied'));
    }
  };

  const handleDecline = () => {
    friendChatP2p.rejectCall(myDid, peerDid).catch(() => {});
  };

  const handleHangup = () => {
    friendChatP2p.endCall(myDid, peerDid).catch(() => {});
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
            {t('chat.social.call.incomingFrom', { from: peerDid })}
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

  // ── OUTGOING (ringing) + ACTIVE: floating HUD ──
  // Anchored to the bottom-right so it doesn't cover the chat list
  // (mirrors WhatsApp / Slack patterns). User can keep typing in
  // the chat behind the HUD.
  const isActive = snapshot.state === 'active';
  const elapsed = isActive && snapshot.startedAt ? now - snapshot.startedAt : 0;

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
      {/* Remote video (only if isVideo & active). For voice-only or
          ringing states we show a hero icon instead. */}
      {isVideo && isActive ? (
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

      {/* Local self-view PiP — only when video and not muted off. */}
      {isVideo && isActive && !snapshot.cameraOff && (
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
            {peerDid}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {isActive
              ? formatDuration(elapsed)
              : snapshot.state === 'outgoing'
                ? t('chat.social.call.ringing')
                : t('chat.social.call.connecting')}
          </Text>
        </Flexbox>

        <Flexbox horizontal gap={8} justify="center" style={{ marginTop: 4 }}>
          {isActive && (
            <Tooltip title={snapshot.micMuted ? t('chat.social.call.unmuteMic') : t('chat.social.call.muteMic')}>
              <Button
                shape="circle"
                size="large"
                icon={snapshot.micMuted ? <MicOff size={18} /> : <Mic size={18} />}
                onClick={() => friendChatP2p.toggleMic(myDid, peerDid, !snapshot.micMuted)}
              />
            </Tooltip>
          )}

          {isActive && isVideo && (
            <Tooltip title={snapshot.cameraOff ? t('chat.social.call.cameraOn') : t('chat.social.call.cameraOff')}>
              <Button
                shape="circle"
                size="large"
                icon={snapshot.cameraOff ? <CameraOff size={18} /> : <Camera size={18} />}
                onClick={() => friendChatP2p.toggleCamera(myDid, peerDid, !snapshot.cameraOff)}
              />
            </Tooltip>
          )}

          <Tooltip title={isActive ? t('chat.social.call.hangup') : t('chat.social.call.cancel')}>
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
