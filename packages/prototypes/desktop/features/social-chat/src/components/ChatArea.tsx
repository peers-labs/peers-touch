import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  FileText,
  Image as ImageIcon,
  Lock,
  Mic,
  MicOff,
  MoreHorizontal,
  Paperclip,
  Phone,
  PhoneIncoming,
  PhoneOff,
  Search,
  Send,
  ShieldCheck,
  Smile,
  Video,
  VideoOff,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import { T } from '../theme';
import { Avatar } from './Avatar';
import { USERS, type MockMessage, type MockConversation } from '../mock';

interface ChatAreaProps {
  conversation: MockConversation | null;
  messages: MockMessage[];
  onToggleDetail: () => void;
  onSendMessage: (conversationId: string, content: string) => void;
  backgroundImageUrl?: string;
  compact?: boolean;
}

type CallState =
  | 'idle'
  | 'outgoing'
  | 'incoming'
  | 'ringing_all_devices'
  | 'active'
  | 'active_here'
  | 'reconnecting'
  | 'ended'
  | 'handled_elsewhere'
  | 'failed';
type MediaKind = 'audio' | 'video';
type EndReason = 'hangup' | 'canceled' | 'rejected' | 'missed' | 'denied' | 'network';

const CALL_STATES: CallState[] = [
  'idle',
  'outgoing',
  'incoming',
  'ringing_all_devices',
  'active',
  'active_here',
  'reconnecting',
  'ended',
  'handled_elsewhere',
  'failed',
];
const CALL_REASONS: EndReason[] = ['hangup', 'canceled', 'rejected', 'missed', 'denied', 'network'];
const endReasonText: Record<EndReason, { title: string; tone: 'neutral' | 'bad' }> = {
  hangup: { title: 'Call ended', tone: 'neutral' },
  canceled: { title: 'Call canceled', tone: 'neutral' },
  rejected: { title: 'Call declined', tone: 'neutral' },
  missed: { title: 'No answer', tone: 'bad' },
  denied: { title: 'Microphone / camera permission denied', tone: 'bad' },
  network: { title: 'Connection failed - please retry', tone: 'bad' },
};

function formatMessageTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MessageStatus({ status }: { status?: MockMessage['status'] }) {
  if (!status) return null;
  if (status === 'failed') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: T.textDanger }}>
        <AlertCircle size={11} /> Failed
      </span>
    );
  }
  if (status === 'read') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <CheckCheck size={11} /> Read
      </span>
    );
  }
  if (status === 'delivered') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <CheckCheck size={11} /> Delivered
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <Check size={11} /> Sent
    </span>
  );
}

function AttachmentPreview({ message, isOwn }: { message: MockMessage; isOwn: boolean }) {
  if (message.type !== 'file' && message.type !== 'image') return null;
  const Icon = message.type === 'image' ? ImageIcon : FileText;
  return (
    <div
      style={{
        marginTop: message.content ? T.space2 : 0,
        display: 'flex',
        alignItems: 'center',
        gap: T.space2,
        padding: T.space2,
        borderRadius: T.radiusMd,
        background: isOwn ? 'rgba(255,255,255,0.16)' : T.bg,
        border: `1px solid ${isOwn ? 'rgba(255,255,255,0.18)' : T.borderSubtle}`,
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: T.radiusMd,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isOwn ? T.textOnPrimary : T.primary,
          background: isOwn ? 'rgba(255,255,255,0.14)' : 'rgba(107,91,214,0.08)',
          flexShrink: 0,
        }}
      >
        <Icon size={18} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: T.fontSm, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {message.attachmentName}
        </span>
        <span style={{ display: 'block', fontSize: T.fontXs, opacity: 0.72 }}>
          {message.attachmentMeta}
        </span>
      </span>
    </div>
  );
}

function MessageBubble({ message, isOwn, compact }: { message: MockMessage; isOwn: boolean; compact?: boolean }) {
  if (message.type === 'system') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: `${T.space2}px 0` }}>
        <span
          style={{
            maxWidth: 520,
            padding: `${T.space1}px ${T.space3}px`,
            borderRadius: T.radiusFull,
            background: T.bgSubtle,
            color: T.textTertiary,
            fontSize: T.fontXs,
            lineHeight: 1.5,
            textAlign: 'center',
          }}
        >
          {message.content}
        </span>
      </div>
    );
  }
  const sender = USERS[message.senderId];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isOwn ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        gap: T.space2,
        padding: `${T.space1}px 0`,
      }}
    >
      {!isOwn && <Avatar name={sender?.name ?? 'Unknown'} size={32} />}
      <div style={{ maxWidth: compact ? '82%' : '68%', minWidth: 0 }}>
        {!isOwn && (
          <div style={{ fontSize: T.fontXs, color: T.textTertiary, marginBottom: 2, paddingLeft: 2 }}>
            {sender?.name ?? 'Unknown'}
          </div>
        )}
        <div
          style={{
            padding: `${T.space2}px ${T.space3}px`,
            borderRadius: isOwn ? `${T.radiusLg}px ${T.radiusSm}px ${T.radiusLg}px ${T.radiusLg}px` : `${T.radiusSm}px ${T.radiusLg}px ${T.radiusLg}px ${T.radiusLg}px`,
            background: isOwn ? T.primary : T.bgMuted,
            color: isOwn ? T.textOnPrimary : T.text,
            fontSize: T.fontBase,
            lineHeight: 1.5,
            wordBreak: 'break-word',
          }}
        >
          {message.content ? <div>{message.content}</div> : null}
          <AttachmentPreview message={message} isOwn={isOwn} />
        </div>
        <div
          style={{
            fontSize: T.fontXs,
            color: T.textQuaternary,
            marginTop: 2,
            textAlign: isOwn ? 'right' : 'left',
            paddingLeft: isOwn ? 0 : 2,
            paddingRight: isOwn ? 2 : 0,
          }}
        >
          {formatMessageTime(message.timestamp)}
          {isOwn ? <span style={{ marginLeft: T.space1 }}><MessageStatus status={message.status} /></span> : null}
        </div>
      </div>
    </div>
  );
}

function trustColor(tone: MockConversation['trustTone']) {
  if (tone === 'verified') return T.success;
  if (tone === 'attention') return T.warning;
  if (tone === 'remote') return T.textTertiary;
  return T.primary;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function HeaderIconButton({
  icon: Icon,
  title,
  active,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        border: 'none',
        background: active ? T.bgHover : 'transparent',
        borderRadius: T.radiusMd,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: active ? T.primary : T.textSecondary,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = T.bgHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = active ? T.bgHover : 'transparent')}
    >
      <Icon size={18} />
    </button>
  );
}

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
    neutral: { bg: hover ? T.bgHover : T.bgMuted, fg: T.textSecondary, border: T.border },
    danger: { bg: T.textDanger, fg: T.textOnPrimary, border: T.textDanger },
    accept: { bg: T.success, fg: T.textOnPrimary, border: T.success },
  }[tone];
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 42,
        height: 42,
        borderRadius: T.radiusFull,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: palette.fg,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      <Icon size={18} />
    </button>
  );
}

function Segmented<TValue extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly TValue[];
  value: TValue;
  onChange: (value: TValue) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, background: T.bgMuted, padding: 3, borderRadius: T.radiusMd, flexWrap: 'wrap' }}>
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            onClick={() => onChange(option)}
            style={{
              border: 'none',
              cursor: 'pointer',
              fontSize: T.fontXs,
              padding: `4px ${T.space2}px`,
              borderRadius: T.radiusSm,
              fontWeight: active ? 700 : 500,
              color: active ? T.primary : T.textSecondary,
              background: active ? T.bg : 'transparent',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function CallDiagnosticsMenu({
  state,
  media,
  reason,
  onState,
  onMedia,
  onReason,
  onOpenDetail,
}: {
  state: CallState;
  media: MediaKind;
  reason: EndReason;
  onState: (state: CallState) => void;
  onMedia: (media: MediaKind) => void;
  onReason: (reason: EndReason) => void;
  onOpenDetail: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 42,
        right: 0,
        zIndex: 40,
        width: 320,
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusLg,
        background: T.bg,
        boxShadow: '0 18px 48px rgba(15, 23, 42, 0.16)',
        padding: T.space3,
      }}
    >
      <button
        onClick={onOpenDetail}
        style={{
          width: '100%',
          height: 34,
          border: `1px solid ${T.borderSubtle}`,
          borderRadius: T.radiusMd,
          background: T.bgSubtle,
          color: T.text,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `0 ${T.space3}px`,
          fontSize: T.fontSm,
          fontWeight: 700,
          marginBottom: T.space3,
        }}
      >
        <span>Conversation details</span>
        <MoreHorizontal size={15} />
      </button>
      <div style={{ fontSize: T.fontXs, fontWeight: 800, color: T.textTertiary, letterSpacing: 0.4, marginBottom: T.space2 }}>
        Stream call simulator
      </div>
      <div style={{ display: 'grid', gap: T.space2 }}>
        <Segmented options={CALL_STATES} value={state} onChange={onState} />
        <Segmented options={['audio', 'video'] as const} value={media} onChange={onMedia} />
        {(state === 'ended' || state === 'failed') && (
          <Segmented options={CALL_REASONS} value={reason} onChange={onReason} />
        )}
      </div>
      <div style={{ marginTop: T.space2, color: T.textTertiary, fontSize: T.fontXs, lineHeight: 1.5 }}>
        Hidden by default; use this only to review non-happy-path call states.
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: T.space2 }}>
      <CircleButton icon={Icon} title={label} tone={tone} onClick={onClick} />
      <span style={{ fontSize: T.fontXs, color: T.textTertiary }}>{label}</span>
    </div>
  );
}

function IncomingCallModal({
  conversation,
  media,
  multiDevice = false,
  onAccept,
  onReject,
  onHandledElsewhere,
}: {
  conversation: MockConversation;
  media: MediaKind;
  multiDevice?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onHandledElsewhere?: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15,23,42,0.42)',
      }}
    >
      <div
        style={{
          width: 320,
          borderRadius: T.radiusLg,
          background: T.bg,
          padding: `${T.space6}px ${T.space5}px`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.28)',
        }}
      >
        <div style={{ position: 'relative' }}>
          <Avatar name={conversation.name} size={80} online={conversation.online} groupIcon={conversation.type === 'group'} />
          <span
            style={{
              position: 'absolute',
              right: -2,
              bottom: -2,
              width: 30,
              height: 30,
              borderRadius: T.radiusFull,
              background: T.primary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.textOnPrimary,
              border: `3px solid ${T.bg}`,
            }}
          >
            <PhoneIncoming size={15} />
          </span>
        </div>
        <div style={{ marginTop: T.space4, fontSize: T.fontLg, fontWeight: 700, color: T.text }}>{conversation.name}</div>
        <div style={{ marginTop: 5, fontSize: T.fontSm, color: T.textTertiary }}>
          {multiDevice
            ? `Incoming ${media === 'video' ? 'video' : 'voice'} call on this Mac and your phone`
            : `Incoming ${media === 'video' ? 'video' : 'voice'} call`}
        </div>
        <div style={{ marginTop: T.space6, display: 'flex', gap: 40 }}>
          <ModalAction icon={PhoneOff} label="Decline" tone="danger" onClick={onReject} />
          <ModalAction icon={media === 'video' ? Video : Phone} label="Accept" tone="accept" onClick={onAccept} />
        </div>
        {multiDevice && onHandledElsewhere ? (
          <button onClick={onHandledElsewhere} style={{ ...simButtonStyle, marginTop: T.space4 }}>
            Simulate accepted on phone
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CallHud({
  conversation,
  state,
  media,
  duration,
  micOn,
  camOn,
  audioDevice,
  videoDevice,
  onToggleMic,
  onToggleCam,
  onAudioDevice,
  onVideoDevice,
  onHangup,
  onPeerAccept,
  onSimWeak,
}: {
  conversation: MockConversation;
  state: 'outgoing' | 'active' | 'active_here' | 'reconnecting';
  media: MediaKind;
  duration: number;
  micOn: boolean;
  camOn: boolean;
  audioDevice: string;
  videoDevice: string;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onAudioDevice: (device: string) => void;
  onVideoDevice: (device: string) => void;
  onPeerAccept: () => void;
  onSimWeak: () => void;
}) {
  const isVideo = media === 'video';
  const isActive = state === 'active' || state === 'active_here' || state === 'reconnecting';
  const reconnecting = state === 'reconnecting';

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 22,
        right: 22,
        zIndex: 25,
        width: isVideo ? 360 : 264,
        background: T.bg,
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusLg,
        boxShadow: '0 12px 48px rgba(15,23,42,0.22)',
        overflow: 'hidden',
      }}
    >
      {isVideo && isActive ? (
        <div style={{ position: 'relative', width: '100%', height: 200, background: '#111827' }}>
          <div
            style={{
              width: '100%',
              height: '100%',
              background: reconnecting
                ? 'linear-gradient(135deg, #111827, #312e81)'
                : 'linear-gradient(135deg, #312e81, #6d28d9)',
              filter: reconnecting ? 'blur(1px) brightness(0.82)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.textOnPrimary,
              fontSize: T.fontLg,
              fontWeight: 800,
            }}
          >
            {conversation.name}
          </div>
          <div
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              width: 80,
              height: 60,
              borderRadius: T.radiusSm,
              border: `1px solid rgba(255,255,255,0.28)`,
              background: camOn ? `linear-gradient(135deg, ${T.primary}, #9a8df0)` : '#111827',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.textOnPrimary,
              fontSize: T.fontXs,
              fontWeight: 700,
            }}
          >
            {camOn ? 'You' : <VideoOff size={18} />}
          </div>
          <span
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: T.fontXs,
              padding: '2px 7px',
              borderRadius: T.radiusFull,
              background: 'rgba(0,0,0,0.45)',
              color: T.textOnPrimary,
            }}
          >
            <ShieldCheck size={12} /> E2E
          </span>
        </div>
      ) : (
        <div
          style={{
            height: isVideo ? 200 : 104,
            background: T.bgMuted,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isVideo ? <Video size={44} color={T.textTertiary} /> : <Phone size={34} color={T.textTertiary} />}
        </div>
      )}

      <div style={{ padding: T.space3, display: 'flex', flexDirection: 'column', gap: T.space2 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: T.space2 }}>
          <span style={{ fontSize: T.fontBase, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {conversation.name}
          </span>
          <span style={{ fontSize: T.fontXs, display: 'inline-flex', alignItems: 'center', gap: 4, color: T.textTertiary, flexShrink: 0 }}>
            {state === 'outgoing' ? (
              'Ringing'
            ) : reconnecting ? (
              <><WifiOff size={13} color={T.warning} /> Reconnecting</>
            ) : (
              <><Wifi size={13} color={T.success} /> {fmtDuration(duration)}</>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: T.space3 }}>
          {isActive && (
            <CircleButton icon={micOn ? Mic : MicOff} title={micOn ? 'Mute' : 'Unmute'} tone={micOn ? 'neutral' : 'danger'} onClick={onToggleMic} />
          )}
          {isActive && isVideo && (
            <CircleButton icon={camOn ? Video : VideoOff} title={camOn ? 'Camera off' : 'Camera on'} tone={camOn ? 'neutral' : 'danger'} onClick={onToggleCam} />
          )}
          <CircleButton icon={PhoneOff} title={isActive ? 'End' : 'Cancel'} tone="danger" onClick={onHangup} />
        </div>
        {isActive ? (
          <div style={{ display: 'grid', gridTemplateColumns: isVideo ? '1fr 1fr' : '1fr', gap: T.space2 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: T.fontXs, color: T.textTertiary }}>
              Microphone
              <select
                aria-label="Microphone device"
                value={audioDevice}
                onChange={(event) => onAudioDevice(event.target.value)}
                style={deviceSelectStyle}
              >
                <option>MacBook Microphone</option>
                <option>Studio Display Microphone</option>
              </select>
            </label>
            {isVideo ? (
              <label style={{ display: 'grid', gap: 3, fontSize: T.fontXs, color: T.textTertiary }}>
                Camera
                <select
                  aria-label="Camera device"
                  value={videoDevice}
                  onChange={(event) => onVideoDevice(event.target.value)}
                  style={deviceSelectStyle}
                >
                  <option>FaceTime HD Camera</option>
                  <option>Continuity Camera</option>
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: T.space2, justifyContent: 'center' }}>
          {state === 'outgoing' && <button onClick={onPeerAccept} style={simButtonStyle}>Simulate accept</button>}
          {isActive && <button onClick={onSimWeak} style={simButtonStyle}>{reconnecting ? 'Simulate recover' : 'Simulate weak network'}</button>}
        </div>
      </div>
    </div>
  );
}

const simButtonStyle: CSSProperties = {
  fontSize: T.fontXs,
  color: T.textTertiary,
  cursor: 'pointer',
  padding: `3px ${T.space2}px`,
  borderRadius: T.radiusFull,
  border: `1px dashed ${T.border}`,
  background: T.bg,
};

const deviceSelectStyle: CSSProperties = {
  width: '100%',
  height: 30,
  borderRadius: T.radiusSm,
  border: `1px solid ${T.border}`,
  background: T.bg,
  color: T.text,
  fontSize: T.fontXs,
  padding: `0 ${T.space2}px`,
};

function CallResultToast({
  reason,
  duration,
  onClose,
}: {
  reason: EndReason;
  duration: number;
  onClose: () => void;
}) {
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
        gap: T.space3,
        padding: `${T.space3}px ${T.space4}px`,
        borderRadius: T.radiusLg,
        background: T.bg,
        border: `1px solid ${bad ? T.textDanger : T.border}`,
        boxShadow: '0 12px 36px rgba(15,23,42,0.16)',
      }}
    >
      <PhoneOff size={18} color={bad ? T.textDanger : T.textSecondary} />
      <div>
        <div style={{ fontSize: T.fontSm, fontWeight: 700, color: T.text }}>{meta.title}</div>
        <div style={{ fontSize: T.fontXs, color: T.textTertiary }}>
          {reason === 'hangup' ? `Duration ${fmtDuration(duration)}` : 'Use the call button to retry'}
        </div>
      </div>
      <button
        onClick={onClose}
        style={{
          marginLeft: T.space1,
          fontSize: T.fontXs,
          color: T.textTertiary,
          cursor: 'pointer',
          padding: `4px ${T.space2}px`,
          borderRadius: T.radiusSm,
          border: 'none',
          background: T.bgMuted,
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

function HandledElsewhereToast({ onClose }: { onClose: () => void }) {
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
        gap: T.space3,
        padding: `${T.space3}px ${T.space4}px`,
        borderRadius: T.radiusLg,
        background: T.bg,
        border: `1px solid ${T.border}`,
        boxShadow: '0 12px 36px rgba(15,23,42,0.16)',
      }}
    >
      <CheckCheck size={18} color={T.success} />
      <div>
        <div style={{ fontSize: T.fontSm, fontWeight: 700, color: T.text }}>
          Answered on another device
        </div>
        <div style={{ fontSize: T.fontXs, color: T.textTertiary }}>
          This device stopped ringing and released temporary call resources.
        </div>
      </div>
      <button onClick={onClose} style={{ ...simButtonStyle, marginLeft: T.space1 }}>
        Dismiss
      </button>
    </div>
  );
}

export function ChatArea({
  conversation,
  messages,
  onToggleDetail,
  onSendMessage,
  backgroundImageUrl,
  compact = false,
}: ChatAreaProps) {
  const [inputValue, setInputValue] = useState('');
  const [callState, setCallState] = useState<CallState>('idle');
  const [callMedia, setCallMedia] = useState<MediaKind>('video');
  const [callReason, setCallReason] = useState<EndReason>('hangup');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [audioDevice, setAudioDevice] = useState('MacBook Microphone');
  const [videoDevice, setVideoDevice] = useState('FaceTime HD Camera');
  const [duration, setDuration] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const callTimer = useRef<number | null>(null);
  const visibleMessages = messages;
  const searchResults = searchQuery.trim()
    ? visibleMessages.filter((message) =>
        message.content.toLowerCase().includes(searchQuery.trim().toLowerCase()),
      )
    : [];

  useEffect(() => {
    const counting =
      callState === 'active'
      || callState === 'active_here'
      || callState === 'reconnecting';
    if (counting && callTimer.current === null) {
      callTimer.current = window.setInterval(() => setDuration((value) => value + 1), 1000);
    }
    if (!counting && callTimer.current !== null) {
      window.clearInterval(callTimer.current);
      callTimer.current = null;
    }
    if (
      callState === 'idle'
      || callState === 'outgoing'
      || callState === 'incoming'
      || callState === 'ringing_all_devices'
      || callState === 'handled_elsewhere'
    ) {
      setDuration(0);
    }
    return () => {
      if (callTimer.current !== null) {
        window.clearInterval(callTimer.current);
        callTimer.current = null;
      }
    };
  }, [callState]);

  useEffect(() => {
    setCallState('idle');
    setActionsOpen(false);
  }, [conversation?.id]);

  if (!conversation) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: T.textTertiary,
          fontSize: T.fontLg,
        }}
      >
        Select a conversation to start chatting
      </div>
    );
  }

  const send = () => {
    if (!inputValue.trim()) return;
    onSendMessage(conversation.id, inputValue);
    setInputValue('');
  };
  const startCall = (media: MediaKind) => {
    setCallMedia(media);
    setMicOn(true);
    setCamOn(media === 'video');
    setCallReason('hangup');
    setCallState('outgoing');
  };
  const callChip =
    callState === 'outgoing'
      ? 'Ringing'
      : callState === 'incoming' || callState === 'ringing_all_devices'
        ? callState === 'ringing_all_devices' ? 'Ringing on your devices' : 'Incoming'
        : callState === 'active' || callState === 'active_here' || callState === 'reconnecting'
          ? `${callState === 'reconnecting' ? 'Reconnecting' : 'In call'} · ${fmtDuration(duration)}`
          : null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: compact ? 240 : T.chatReadableMinWidth, position: 'relative' }}>
      {/* Header — same height as session list header */}
      <div
        style={{
          height: T.headerHeight,
          padding: compact ? `0 ${T.space3}px` : `0 ${T.space5}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: T.space2 }}>
            <span style={{ fontSize: T.fontLg, fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conversation.name}</span>
            {!compact && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 7px',
                  borderRadius: T.radiusFull,
                  background: 'rgba(0,0,0,0.035)',
                  color: trustColor(conversation.trustTone),
                  fontSize: T.fontXs,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {conversation.trustTone === 'verified' ? <ShieldCheck size={11} /> : <Lock size={11} />}
                {conversation.trustLabel}
              </span>
            )}
            {callChip && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 7px',
                  borderRadius: T.radiusFull,
                  background: callState === 'reconnecting' ? '#fff7e6' : 'rgba(107,91,214,0.1)',
                  color: callState === 'reconnecting' ? T.warning : T.primary,
                  fontSize: T.fontXs,
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {callState === 'reconnecting' ? <WifiOff size={11} /> : <Phone size={11} />}
                {callChip}
              </span>
            )}
          </div>
          <span style={{ display: 'block', fontSize: T.fontXs, color: T.textTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {conversation.type === 'group'
              ? `${conversation.memberCount} members · ${conversation.detailHint}`
              : `${conversation.online === undefined ? 'Presence unavailable' : conversation.online ? 'Online' : 'Offline'} · ${conversation.detailHint}`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: T.space1, position: 'relative' }}>
          <HeaderIconButton icon={Search} title="Search messages" onClick={() => setSearchOpen(true)} />
          <HeaderIconButton icon={Phone} title="Start voice call" onClick={() => startCall('audio')} />
          <HeaderIconButton icon={Video} title="Start video call" onClick={() => startCall('video')} />
          <HeaderIconButton icon={MoreHorizontal} title="Conversation actions" active={actionsOpen} onClick={() => setActionsOpen((value) => !value)} />
          {actionsOpen && (
            <CallDiagnosticsMenu
              state={callState}
              media={callMedia}
              reason={callReason}
              onState={(state) => {
                setCallState(state);
                setActionsOpen(false);
              }}
              onMedia={setCallMedia}
              onReason={setCallReason}
              onOpenDetail={() => {
                setActionsOpen(false);
                window.setTimeout(onToggleDetail, 0);
              }}
            />
          )}
        </div>
      </div>

      {searchOpen && (
        <div
          style={{
            position: 'absolute',
            inset: `${T.headerHeight}px 0 0`,
            zIndex: 24,
            background: 'rgba(15,23,42,0.28)',
            display: 'flex',
            justifyContent: 'center',
            padding: T.space5,
          }}
        >
          <div style={{ width: 'min(620px, 100%)', alignSelf: 'flex-start', background: T.bg, borderRadius: T.radiusLg, boxShadow: T.shadowLg, padding: T.space4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: T.space3 }}>
              <strong>Search messages</strong>
              <button type="button" aria-label="Close search" onClick={() => setSearchOpen(false)} style={{ width: 28, height: 28, border: 'none', background: 'transparent', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: T.space2, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: `0 ${T.space3}px`, height: 40 }}>
              <Search size={16} color={T.textTertiary} />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search in messages..." style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent' }} />
              {searchQuery && (
                <button type="button" aria-label="Clear search" onClick={() => setSearchQuery('')} style={{ width: 24, height: 24, border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={14} />
                </button>
              )}
            </div>
            <div style={{ marginTop: T.space3, display: 'flex', flexDirection: 'column', gap: T.space1 }}>
              {searchQuery && searchResults.length === 0 && <span style={{ color: T.textTertiary }}>No messages found</span>}
              {searchResults.map((message) => (
                <button key={message.id} type="button" style={{ border: 'none', background: 'transparent', textAlign: 'left', padding: `${T.space2}px 0`, cursor: 'pointer', color: T.text }}>
                  {message.content}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: compact ? `${T.space3}px` : `${T.space4}px ${T.space5}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: T.space2,
          background: backgroundImageUrl
            ? `linear-gradient(rgba(255,255,255,0.72), rgba(255,255,255,0.72)), url("${backgroundImageUrl}") center / cover`
            : conversation.background === 'Graphite' ? '#f7f7f8' : T.bg,
        }}
      >
        {!compact && <div style={{ display: 'flex', justifyContent: 'center', padding: `${T.space1}px 0 ${T.space2}px` }}>
          <span style={{ fontSize: T.fontXs, color: T.textTertiary }}>
            Prototype path: list / conversation / details / action surface
          </span>
        </div>}
        {visibleMessages.length === 0 && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.textTertiary,
              fontSize: T.fontBase,
            }}
          >
            No messages yet.
          </div>
        )}
        {visibleMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} isOwn={msg.senderId === 'user-self'} compact={compact} />
        ))}
      </div>

      {/* Input */}
      <div
        style={{
          padding: compact ? `${T.space2}px ${T.space3}px ${T.space3}px` : `${T.space3}px ${T.space5}px ${T.space4}px`,
          borderTop: `1px solid ${T.border}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: T.space2,
            background: T.bgMuted,
            borderRadius: T.radiusLg,
            padding: `${T.space2}px ${T.space3}px`,
          }}
        >
          <button
            type="button"
            title="Emoji"
            aria-label="Emoji"
            style={{
              width: 28, height: 28, border: 'none', background: 'transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: T.textTertiary, borderRadius: T.radiusSm,
            }}
          >
            <Smile size={18} />
          </button>
          <button
            type="button"
            title="Attach file"
            aria-label="Attach file"
            style={{
              width: 28, height: 28, border: 'none', background: 'transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: T.textTertiary, borderRadius: T.radiusSm,
            }}
          >
            <Paperclip size={18} />
          </button>
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            placeholder={conversation.type === 'group' ? 'Message the group...' : 'Type a private message...'}
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              outline: 'none',
              fontSize: T.fontBase,
              color: T.text,
              padding: `${T.space1}px 0`,
              lineHeight: 1.5,
            }}
          />
          <button
            type="button"
            title="Send message"
            aria-label="Send message"
            aria-disabled={!inputValue.trim()}
            onClick={send}
            style={{
              width: 28, height: 28, border: 'none',
              background: inputValue.trim() ? T.primary : 'transparent',
              cursor: inputValue.trim() ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: inputValue.trim() ? T.textOnPrimary : T.textQuaternary,
              borderRadius: T.radiusFull,
              transition: 'all 0.15s',
            }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
      {(callState === 'incoming' || callState === 'ringing_all_devices') && (
        <IncomingCallModal
          conversation={conversation}
          media={callMedia}
          multiDevice={callState === 'ringing_all_devices'}
          onAccept={() => setCallState(callState === 'ringing_all_devices' ? 'active_here' : 'active')}
          onReject={() => {
            setCallReason('rejected');
            setCallState('ended');
          }}
          onHandledElsewhere={() => setCallState('handled_elsewhere')}
        />
      )}
      {(callState === 'outgoing' || callState === 'active' || callState === 'active_here' || callState === 'reconnecting') && (
        <CallHud
          conversation={conversation}
          state={callState}
          media={callMedia}
          duration={duration}
          micOn={micOn}
          camOn={camOn}
          audioDevice={audioDevice}
          videoDevice={videoDevice}
          onToggleMic={() => setMicOn((value) => !value)}
          onToggleCam={() => setCamOn((value) => !value)}
          onAudioDevice={setAudioDevice}
          onVideoDevice={setVideoDevice}
          onHangup={() => {
            setCallReason(callState === 'outgoing' ? 'canceled' : 'hangup');
            setCallState('ended');
          }}
          onPeerAccept={() => setCallState('active')}
          onSimWeak={() => setCallState(callState === 'reconnecting' ? 'active_here' : 'reconnecting')}
        />
      )}
      {callState === 'handled_elsewhere' && (
        <HandledElsewhereToast onClose={() => setCallState('idle')} />
      )}
      {callState === 'ended' && (
        <CallResultToast reason={callReason} duration={duration} onClose={() => setCallState('idle')} />
      )}
      {callState === 'failed' && (
        <CallResultToast
          reason={callReason === 'hangup' ? 'network' : callReason}
          duration={duration}
          onClose={() => setCallState('idle')}
        />
      )}
    </div>
  );
}
