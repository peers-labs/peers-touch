/**
 * peers-touch Voice / Video Call — interaction prototype.
 *
 * This prototype does NOT build its own app chrome. It REUSES the shared
 * desktop container shell (`@peers-touch/prototype-desktop-shell`) — the same
 * SideNav + content-area framework the main-worktree prototype standard
 * mandates — and mounts a friend-chat page as the `chat` kernel page, exactly
 * the way atelier is reused as an applet. The call experience is a *block* laid
 * on top of that chat page: it mirrors the real
 * `apps/desktop/src/components/chat/CallSurface.tsx` (centered ringing modal +
 * bottom-right floating HUD) over the real `SocialChatPage` layout
 * (sub-nav + session list + conversation).
 *
 * It is NOT product code: no WebRTC, no signaling, no store/kernel/tauri. A
 * reviewer toolbar walks every call state the design enumerates
 * (architecture/realtime/voice-video-calls.md §6):
 *   idle / outgoing / incoming / active / reconnecting / ended / failed.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { DesktopShell } from '@peers-touch/prototype-desktop-shell';
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Wifi,
  WifiOff,
  Check,
  CheckCheck,
  ShieldCheck,
  Search,
  Info,
  Send,
  Smile,
  Paperclip,
  MessageCircle,
  Contact,
  type LucideIcon,
} from 'lucide-react';
import { T } from './theme';

/* ------------------------------------------------------------------ types */

type CallState =
  | 'idle'
  | 'outgoing'
  | 'incoming'
  | 'active'
  | 'reconnecting'
  | 'ended'
  | 'failed';
type MediaKind = 'audio' | 'video';
type EndReason = 'hangup' | 'canceled' | 'rejected' | 'missed' | 'denied' | 'network';

/* ------------------------------------------------------------- mock data  */
/* prototype-only mock; real data comes from the friend-chat runtime.        */

const me = { name: 'Alex' };
const peer = {
  name: 'Sarah Jenkins',
  avatar: 'https://picsum.photos/seed/sarah/240/240',
  remoteVideo: 'https://picsum.photos/seed/sarahcall/900/640',
  online: true,
};

const messages = [
  { id: 'm1', mine: false, text: 'Hey Alex, are we still on for the meeting?', time: '10:30', status: 'read' },
  { id: 'm2', mine: true, text: 'Yes, absolutely. I have the presentation ready.', time: '10:35', status: 'read' },
  { id: 'm3', mine: false, text: 'Great! Let me call you to walk through it.', time: '10:42', status: 'delivered' },
];

const endReasonText: Record<EndReason, { title: string; tone: 'neutral' | 'bad' }> = {
  hangup: { title: 'Call ended', tone: 'neutral' },
  canceled: { title: 'Call canceled', tone: 'neutral' },
  rejected: { title: 'Call declined', tone: 'neutral' },
  missed: { title: 'No answer', tone: 'bad' },
  denied: { title: 'Microphone / camera permission denied', tone: 'bad' },
  network: { title: 'Connection failed — please retry', tone: 'bad' },
};

/* --------------------------------------------------------------- helpers  */

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function Avatar({ size, ring }: { size: number; ring?: boolean }) {
  return (
    <img
      src={peer.avatar}
      alt={peer.name}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        objectFit: 'cover',
        boxShadow: ring ? `0 0 0 4px ${T.primaryWash}` : undefined,
      }}
    />
  );
}

/** A circular control button — mirrors antd `<Button shape="circle">` in the real HUD. */
function CircleButton({
  icon: Icon,
  title,
  tone = 'neutral',
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  tone?: 'neutral' | 'danger' | 'accept';
  onClick?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const palette = {
    neutral: { bg: hover ? T.fillTertiary : T.fillQuaternary, fg: T.textSecondary, border: T.border },
    danger: { bg: T.danger, fg: T.white, border: T.danger },
    accept: { bg: T.success, fg: T.white, border: T.success },
  }[tone];
  return (
    <div
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 44,
        height: 44,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: palette.fg,
        backgroundColor: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      <Icon size={19} />
    </div>
  );
}

/* ---------------------------------------------- chat page (block content) */
/* Mirrors SocialChatPage: sub-nav (48) + session list (260) + conversation. */

function ChatSubNav() {
  const items: { key: string; icon: LucideIcon; active?: boolean }[] = [
    { key: 'chats', icon: MessageCircle, active: true },
    { key: 'contacts', icon: Contact },
  ];
  return (
    <div
      style={{
        width: 48,
        minWidth: 48,
        height: '100%',
        paddingTop: 12,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        borderRight: `1px solid ${T.border}`,
        backgroundColor: T.bg,
      }}
    >
      {items.map(({ key, icon: Icon, active }) => (
        <div
          key={key}
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: active ? T.primary : T.textTertiary,
            backgroundColor: active ? T.primaryWash : 'transparent',
          }}
        >
          <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
        </div>
      ))}
    </div>
  );
}

function SessionList() {
  return (
    <div
      style={{
        width: 260,
        flexShrink: 0,
        borderRight: `1px solid ${T.border}`,
        backgroundColor: T.navBg,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: 14, borderBottom: `1px solid ${T.borderSoft}` }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            backgroundColor: T.fillTertiary,
            borderRadius: 8,
            padding: '8px 10px',
            color: T.textTertiary,
          }}
        >
          <Search size={15} />
          <span style={{ fontSize: 13 }}>Search messages…</span>
        </div>
      </div>
      <div style={{ padding: 8 }}>
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            padding: 10,
            borderRadius: 10,
            backgroundColor: T.primaryWash,
          }}
        >
          <Avatar size={40} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{peer.name}</span>
              <span style={{ fontSize: 11, color: T.textTertiary }}>10:42</span>
            </div>
            <div
              style={{
                fontSize: 12,
                color: T.textTertiary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              Great! Let me call you to walk…
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConversationHeader({ onStart }: { onStart: (k: MediaKind) => void }) {
  return (
    <div
      style={{
        height: 60,
        flexShrink: 0,
        borderBottom: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 18px',
        gap: 12,
        backgroundColor: T.bg,
      }}
    >
      <Avatar size={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>{peer.name}</div>
        <div style={{ fontSize: 12, color: T.success, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: T.success, display: 'inline-block' }} />
          Online
        </div>
      </div>
      {/* call entry points live in the conversation header (mirrors real ChatMessageArea) */}
      <HeaderIcon icon={Phone} title="Voice call" onClick={() => onStart('audio')} />
      <HeaderIcon icon={Video} title="Video call" onClick={() => onStart('video')} />
      <HeaderIcon icon={Info} title="Info" />
    </div>
  );
}

function HeaderIcon({ icon: Icon, title, onClick }: { icon: LucideIcon; title: string; onClick?: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: hover ? T.primary : T.textSecondary,
        backgroundColor: hover ? T.fillQuaternary : 'transparent',
      }}
    >
      <Icon size={19} />
    </div>
  );
}

function ConversationBody() {
  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        backgroundColor: T.chatBg,
      }}
    >
      {messages.map((m) => (
        <div key={m.id} style={{ display: 'flex', justifyContent: m.mine ? 'flex-end' : 'flex-start' }}>
          <div
            style={{
              maxWidth: '64%',
              padding: '9px 12px',
              borderRadius: 12,
              fontSize: 13.5,
              lineHeight: 1.45,
              color: m.mine ? T.white : T.text,
              backgroundColor: m.mine ? T.primary : T.bg,
              border: m.mine ? 'none' : `1px solid ${T.border}`,
            }}
          >
            <div>{m.text}</div>
            <div
              style={{
                marginTop: 4,
                fontSize: 10.5,
                display: 'flex',
                gap: 4,
                alignItems: 'center',
                justifyContent: 'flex-end',
                color: m.mine ? 'rgba(255,255,255,0.75)' : T.textQuaternary,
              }}
            >
              {m.time}
              {m.mine ? (m.status === 'read' ? <CheckCheck size={12} /> : <Check size={12} />) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Composer() {
  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: `1px solid ${T.border}`,
        padding: 12,
        backgroundColor: T.bg,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Paperclip size={19} color={T.textTertiary} />
      <Smile size={19} color={T.textTertiary} />
      <div
        style={{
          flex: 1,
          backgroundColor: T.fillTertiary,
          borderRadius: 10,
          padding: '9px 12px',
          fontSize: 13,
          color: T.textTertiary,
        }}
      >
        Type a message…
      </div>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          backgroundColor: T.primary,
          color: T.white,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Send size={17} />
      </div>
    </div>
  );
}

/* --------------------------------------------------------- call surfaces  */
/* Faithful to apps/desktop CallSurface: incoming = centered modal;          */
/* outgoing / active / reconnecting = bottom-right floating HUD.             */

/** Incoming — centered ringing modal (real CallSurface uses antd Modal). */
function IncomingModal({ media, onAccept, onReject }: { media: MediaKind; onAccept: () => void; onReject: () => void }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.45)',
      }}
    >
      <div
        style={{
          width: 320,
          borderRadius: 16,
          backgroundColor: T.bg,
          padding: '28px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ position: 'relative' }}>
          <Avatar size={80} ring />
          <span
            style={{
              position: 'absolute',
              right: -2,
              bottom: -2,
              width: 30,
              height: 30,
              borderRadius: '50%',
              backgroundColor: T.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.white,
              border: `3px solid ${T.bg}`,
            }}
          >
            <PhoneIncoming size={15} />
          </span>
        </div>
        <div style={{ marginTop: 16, fontSize: 18, fontWeight: 600, color: T.text }}>{peer.name}</div>
        <div style={{ marginTop: 5, fontSize: 13, color: T.textTertiary }}>
          Incoming {media === 'video' ? 'video' : 'voice'} call…
        </div>
        <div style={{ marginTop: 26, display: 'flex', gap: 40 }}>
          <ModalAction icon={PhoneOff} label="Decline" tone="danger" onClick={onReject} />
          <ModalAction icon={media === 'video' ? Video : Phone} label="Accept" tone="accept" onClick={onAccept} />
        </div>
      </div>
    </div>
  );
}

function ModalAction({
  icon: Icon,
  label,
  tone,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  tone: 'danger' | 'accept';
  onClick: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <CircleButton icon={Icon} title={label} tone={tone} onClick={onClick} />
      <span style={{ fontSize: 12, color: T.textTertiary }}>{label}</span>
    </div>
  );
}

/**
 * Outgoing / active / reconnecting — bottom-right floating HUD, anchored to the
 * content area so the user keeps seeing the conversation behind it (mirrors the
 * real CallSurface fixed bottom-right Flexbox).
 */
function CallHud({
  state,
  media,
  duration,
  micOn,
  camOn,
  onToggleMic,
  onToggleCam,
  onHangup,
  onPeerAccept,
  onSimWeak,
}: {
  state: 'outgoing' | 'active' | 'reconnecting';
  media: MediaKind;
  duration: number;
  micOn: boolean;
  camOn: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onHangup: () => void;
  onPeerAccept: () => void;
  onSimWeak: () => void;
}) {
  const isVideo = media === 'video';
  const isActive = state === 'active' || state === 'reconnecting';
  const reconnecting = state === 'reconnecting';

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 24,
        right: 24,
        zIndex: 25,
        width: isVideo ? 360 : 260,
        backgroundColor: T.bg,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        boxShadow: '0 12px 48px rgba(0,0,0,0.22)',
        overflow: 'hidden',
      }}
    >
      {/* stage: remote video when active+video, otherwise a hero icon block */}
      {isVideo && isActive ? (
        <div style={{ position: 'relative', width: '100%', height: 200, background: '#000' }}>
          <img
            src={peer.remoteVideo}
            alt="remote"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              filter: reconnecting ? 'blur(3px) brightness(0.7)' : 'none',
            }}
          />
          {/* local self-view PiP */}
          {camOn ? (
            <div
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 80,
                height: 60,
                borderRadius: 6,
                border: `1px solid ${T.border}`,
                background: `linear-gradient(135deg, ${T.primary}, #9a8df0)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: T.white,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {me.name}
            </div>
          ) : (
            <div
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 80,
                height: 60,
                borderRadius: 6,
                border: `1px solid ${T.border}`,
                backgroundColor: T.stage,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <VideoOff size={18} color={T.onStageSoft} />
            </div>
          )}
          {/* E2E badge */}
          <span
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              padding: '2px 7px',
              borderRadius: 20,
              backgroundColor: 'rgba(0,0,0,0.45)',
              color: T.onStage,
            }}
          >
            <ShieldCheck size={12} /> E2E
          </span>
        </div>
      ) : (
        <div
          style={{
            height: isVideo ? 200 : 100,
            backgroundColor: T.fillTertiary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isVideo ? <Video size={44} color={T.textTertiary} /> : <Phone size={34} color={T.textTertiary} />}
        </div>
      )}

      {/* meta + controls */}
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: T.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 200,
            }}
          >
            {peer.name}
          </span>
          <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {state === 'outgoing' ? (
              <span style={{ color: T.textTertiary }}>Ringing…</span>
            ) : reconnecting ? (
              <span style={{ color: T.warn, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <WifiOff size={13} /> Reconnecting…
              </span>
            ) : (
              <span style={{ color: T.textTertiary, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Wifi size={13} color={T.success} /> {fmtDuration(duration)}
              </span>
            )}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 2 }}>
          {isActive && (
            <CircleButton
              icon={micOn ? Mic : MicOff}
              title={micOn ? 'Mute' : 'Unmute'}
              tone={micOn ? 'neutral' : 'danger'}
              onClick={onToggleMic}
            />
          )}
          {isActive && isVideo && (
            <CircleButton
              icon={camOn ? Video : VideoOff}
              title={camOn ? 'Camera off' : 'Camera on'}
              tone={camOn ? 'neutral' : 'danger'}
              onClick={onToggleCam}
            />
          )}
          <CircleButton icon={PhoneOff} title={isActive ? 'End' : 'Cancel'} tone="danger" onClick={onHangup} />
        </div>

        {/* reviewer-only simulations (not part of the product UI) */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 4 }}>
          {state === 'outgoing' && <SimHint text="▶ peer accepts" onClick={onPeerAccept} />}
          {isActive && <SimHint text={reconnecting ? '▶ recover' : '▶ weak network'} onClick={onSimWeak} />}
        </div>
      </div>
    </div>
  );
}

/** Ended / failed — toast over the conversation. */
function ResultToast({ reason, duration, onClose }: { reason: EndReason; duration: number; onClose: () => void }) {
  const meta = endReasonText[reason];
  const bad = meta.tone === 'bad';
  return (
    <div
      style={{
        position: 'absolute',
        top: 74,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 25,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 12,
        backgroundColor: T.bg,
        border: `1px solid ${bad ? T.danger : T.border}`,
        boxShadow: '0 12px 36px rgba(0,0,0,0.16)',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bad ? T.dangerWash : T.fillTertiary,
          color: bad ? T.danger : T.textSecondary,
        }}
      >
        <PhoneOff size={18} />
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{meta.title}</div>
        <div style={{ fontSize: 12, color: T.textTertiary }}>
          {reason === 'hangup' ? `Duration ${fmtDuration(duration)}` : 'Tap call to retry'}
        </div>
      </div>
      <div
        onClick={onClose}
        title="Dismiss"
        style={{
          marginLeft: 6,
          fontSize: 12,
          color: T.textTertiary,
          cursor: 'pointer',
          padding: '4px 8px',
          borderRadius: 6,
          backgroundColor: T.fillQuaternary,
        }}
      >
        Dismiss
      </div>
    </div>
  );
}

function SimHint({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      title="Reviewer-only simulation, not part of the product UI"
      style={{
        fontSize: 11,
        color: T.textTertiary,
        cursor: 'pointer',
        padding: '3px 9px',
        borderRadius: 14,
        border: `1px dashed ${T.border}`,
      }}
    >
      {text}
    </div>
  );
}

/* --------------------------------------------------- reviewer state toolbar */

function StateToolbar({
  state,
  media,
  reason,
  onState,
  onMedia,
  onReason,
}: {
  state: CallState;
  media: MediaKind;
  reason: EndReason;
  onState: (s: CallState) => void;
  onMedia: (m: MediaKind) => void;
  onReason: (r: EndReason) => void;
}) {
  const states: CallState[] = ['idle', 'outgoing', 'incoming', 'active', 'reconnecting', 'ended', 'failed'];
  const reasons: EndReason[] = ['hangup', 'canceled', 'rejected', 'missed', 'denied', 'network'];
  return (
    <div
      style={{
        flexShrink: 0,
        padding: '8px 14px',
        borderBottom: `1px solid ${T.border}`,
        backgroundColor: T.navBg,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, letterSpacing: 0.4 }}>PROTOTYPE STATES</span>
      <Seg options={states} value={state} onChange={(v) => onState(v as CallState)} />
      <span style={{ width: 1, height: 18, backgroundColor: T.border }} />
      <Seg options={['audio', 'video']} value={media} onChange={(v) => onMedia(v as MediaKind)} />
      {(state === 'ended' || state === 'failed') && (
        <>
          <span style={{ width: 1, height: 18, backgroundColor: T.border }} />
          <Seg options={reasons} value={reason} onChange={(v) => onReason(v as EndReason)} />
        </>
      )}
    </div>
  );
}

function Seg({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, backgroundColor: T.fillTertiary, padding: 3, borderRadius: 9 }}>
      {options.map((o) => {
        const active = o === value;
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            style={{
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 7,
              fontWeight: active ? 600 : 500,
              color: active ? T.primary : T.textSecondary,
              backgroundColor: active ? T.bg : 'transparent',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------- chat page block (the "积木") ---- */
/**
 * The friend-chat page mounted into the desktop shell's `chat` kernel page.
 * Layout mirrors SocialChatPage; the call experience is the CallSurface-style
 * overlay laid on top. A reviewer toolbar sits above the page so the whole
 * call lifecycle is walkable without a backend.
 */
function ChatPageBlock() {
  const [state, setState] = useState<CallState>('idle');
  const [media, setMedia] = useState<MediaKind>('video');
  const [reason, setReason] = useState<EndReason>('hangup');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [duration, setDuration] = useState(0);
  const timer = useRef<number | null>(null);

  // run the in-call timer while active/reconnecting
  useEffect(() => {
    const counting = state === 'active' || state === 'reconnecting';
    if (counting && timer.current === null) {
      timer.current = window.setInterval(() => setDuration((d) => d + 1), 1000);
    }
    if (!counting && timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
    if (state === 'idle' || state === 'outgoing' || state === 'incoming') setDuration(0);
    return () => {
      if (timer.current !== null) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [state]);

  const startCall = (k: MediaKind) => {
    setMedia(k);
    setMicOn(true);
    setCamOn(k === 'video');
    setState('outgoing');
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: T.bg }}>
      <style>{KEYFRAMES}</style>
      <StateToolbar
        state={state}
        media={media}
        reason={reason}
        onState={setState}
        onMedia={setMedia}
        onReason={setReason}
      />

      {/* SocialChatPage layout: sub-nav + session list + conversation */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex' }}>
        <ChatSubNav />
        <SessionList />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <ConversationHeader onStart={startCall} />
          <ConversationBody />
          <Composer />
        </div>

        {/* CallSurface-style overlays, scoped to this content area */}
        {state === 'incoming' && (
          <IncomingModal
            media={media}
            onAccept={() => setState('active')}
            onReject={() => {
              setReason('rejected');
              setState('ended');
            }}
          />
        )}
        {(state === 'outgoing' || state === 'active' || state === 'reconnecting') && (
          <CallHud
            state={state}
            media={media}
            duration={duration}
            micOn={micOn}
            camOn={camOn}
            onToggleMic={() => setMicOn((v) => !v)}
            onToggleCam={() => setCamOn((v) => !v)}
            onHangup={() => {
              setReason(state === 'outgoing' ? 'canceled' : 'hangup');
              setState('ended');
            }}
            onPeerAccept={() => setState('active')}
            onSimWeak={() => setState(state === 'reconnecting' ? 'active' : 'reconnecting')}
          />
        )}
        {state === 'ended' && <ResultToast reason={reason} duration={duration} onClose={() => setState('idle')} />}
        {state === 'failed' && (
          <ResultToast
            reason={reason === 'hangup' ? 'network' : reason}
            duration={duration}
            onClose={() => setState('idle')}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- root     */

export function CallPrototype() {
  useEffect(() => {
    document.title = 'peers-touch · Voice / Video call prototype';
  }, []);

  // Reuse the shared desktop container shell; mount the chat page block into the
  // `chat` kernel page and land on it. The SideNav / command palette / atelier
  // applet all come from the shared shell, unchanged.
  const pages = useMemo(() => ({ chat: () => <ChatPageBlock /> }), []);
  return <DesktopShell pages={pages} initialPage="chat" />;
}

const KEYFRAMES = `
@keyframes ptBlink { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }
@keyframes ptWave { 0%,100% { transform: scaleY(0.5) } 50% { transform: scaleY(1.2) } }
`;
