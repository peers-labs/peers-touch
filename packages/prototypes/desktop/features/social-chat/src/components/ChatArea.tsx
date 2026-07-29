import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock3,
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
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Smile,
  Video,
  VideoOff,
  Wifi,
  WifiOff,
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
  onRestoreHistory: (conversationId: string) => void;
  compact?: boolean;
}

const HISTORY_RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000;
type CallState = 'idle' | 'outgoing' | 'incoming' | 'active' | 'reconnecting' | 'ended' | 'failed';
type MediaKind = 'audio' | 'video';
type EndReason = 'hangup' | 'canceled' | 'rejected' | 'missed' | 'denied' | 'network';

const CALL_STATES: CallState[] = ['idle', 'outgoing', 'incoming', 'active', 'reconnecting', 'ended', 'failed'];
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

function formatRemaining(ms: number) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
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
  onAccept,
  onReject,
}: {
  conversation: MockConversation;
  media: MediaKind;
  onAccept: () => void;
  onReject: () => void;
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
          Incoming {media === 'video' ? 'video' : 'voice'} call
        </div>
        <div style={{ marginTop: T.space6, display: 'flex', gap: 40 }}>
          <ModalAction icon={PhoneOff} label="Decline" tone="danger" onClick={onReject} />
          <ModalAction icon={media === 'video' ? Video : Phone} label="Accept" tone="accept" onClick={onAccept} />
        </div>
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
  onToggleMic,
  onToggleCam,
  onHangup,
  onPeerAccept,
  onSimWeak,
}: {
  conversation: MockConversation;
  state: 'outgoing' | 'active' | 'reconnecting';
  media: MediaKind;
  duration: number;
  micOn: boolean;
  camOn: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
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

export function ChatArea({
  conversation,
  messages,
  onToggleDetail,
  onSendMessage,
  onRestoreHistory,
  compact = false,
}: ChatAreaProps) {
  const [inputValue, setInputValue] = useState('');
  const [now, setNow] = useState(Date.now());
  const [callState, setCallState] = useState<CallState>('idle');
  const [callMedia, setCallMedia] = useState<MediaKind>('video');
  const [callReason, setCallReason] = useState<EndReason>('hangup');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [duration, setDuration] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const callTimer = useRef<number | null>(null);
  const historyClearedAt = conversation?.historyClearedAt ?? 0;
  const historyRestoreExpiresAt = historyClearedAt + HISTORY_RESTORE_WINDOW_MS;
  const canRestoreHistory = historyClearedAt > 0 && now < historyRestoreExpiresAt;
  const historyRestoreExpired = historyClearedAt > 0 && !canRestoreHistory;
  const historyRestoreRemaining = canRestoreHistory
    ? formatRemaining(historyRestoreExpiresAt - now)
    : '';
  const visibleMessages = historyClearedAt > 0
    ? messages.filter((message) => message.timestamp > historyClearedAt)
    : messages;

  useEffect(() => {
    setNow(Date.now());
  }, [conversation?.id, conversation?.historyClearedAt]);

  useEffect(() => {
    if (!canRestoreHistory) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [canRestoreHistory, historyRestoreExpiresAt]);

  useEffect(() => {
    const counting = callState === 'active' || callState === 'reconnecting';
    if (counting && callTimer.current === null) {
      callTimer.current = window.setInterval(() => setDuration((value) => value + 1), 1000);
    }
    if (!counting && callTimer.current !== null) {
      window.clearInterval(callTimer.current);
      callTimer.current = null;
    }
    if (callState === 'idle' || callState === 'outgoing' || callState === 'incoming') setDuration(0);
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
      : callState === 'incoming'
        ? 'Incoming'
        : callState === 'active' || callState === 'reconnecting'
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
              : `${conversation.online ? 'Online' : 'Offline'} · ${conversation.detailHint}`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: T.space1, position: 'relative' }}>
          <HeaderIconButton icon={Search} title="Search messages" />
          <HeaderIconButton icon={Phone} title="Start voice call" onClick={() => startCall('audio')} />
          <HeaderIconButton icon={Video} title="Start video call" onClick={() => startCall('video')} />
          <HeaderIconButton icon={MoreHorizontal} title="Conversation actions" active={actionsOpen} onClick={() => setActionsOpen((value) => !value)} />
          {actionsOpen && (
            <CallDiagnosticsMenu
              state={callState}
              media={callMedia}
              reason={callReason}
              onState={setCallState}
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
          background: conversation.background === 'Graphite' ? '#f7f7f8' : T.bg,
        }}
      >
        {!compact && <div style={{ display: 'flex', justifyContent: 'center', padding: `${T.space1}px 0 ${T.space2}px` }}>
          <span style={{ fontSize: T.fontXs, color: T.textTertiary }}>
            Prototype path: list / conversation / details / action surface
          </span>
        </div>}
        {historyClearedAt > 0 && (
          <div
            style={{
              alignSelf: 'center',
              maxWidth: 420,
              border: `1px solid ${T.borderSubtle}`,
              borderRadius: T.radiusLg,
              background: T.bgSubtle,
              padding: `${T.space3}px ${T.space4}px`,
              display: 'flex',
              gap: T.space3,
              color: T.textSecondary,
              fontSize: T.fontSm,
              lineHeight: 1.5,
            }}
          >
            <Clock3 size={18} style={{ flexShrink: 0, color: canRestoreHistory ? T.warning : T.textTertiary }} />
            <div style={{ flex: 1 }}>
              <div style={{ color: T.text, fontWeight: 700, marginBottom: 2 }}>
                History hidden on this device
              </div>
              <div>
                {canRestoreHistory
                  ? `Messages before this point are hidden. Restore is available for ${historyRestoreRemaining}.`
                  : historyRestoreExpired
                    ? 'The 24h restore window has ended. New messages will appear here.'
                    : 'Messages before this point are hidden.'}
              </div>
              {canRestoreHistory && (
                <button
                  onClick={() => onRestoreHistory(conversation.id)}
                  style={{
                    marginTop: T.space2,
                    height: 28,
                    border: `1px solid ${T.border}`,
                    borderRadius: T.radiusMd,
                    background: T.bg,
                    color: T.text,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: T.space1,
                    padding: `0 ${T.space2}px`,
                    cursor: 'pointer',
                    fontSize: T.fontXs,
                    fontWeight: 800,
                  }}
                >
                  <RotateCcw size={13} />
                  Restore history
                </button>
              )}
            </div>
          </div>
        )}
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
            {historyClearedAt > 0 ? 'No visible messages after clearing history.' : 'No messages yet.'}
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
      {callState === 'incoming' && (
        <IncomingCallModal
          conversation={conversation}
          media={callMedia}
          onAccept={() => setCallState('active')}
          onReject={() => {
            setCallReason('rejected');
            setCallState('ended');
          }}
        />
      )}
      {(callState === 'outgoing' || callState === 'active' || callState === 'reconnecting') && (
        <CallHud
          conversation={conversation}
          state={callState}
          media={callMedia}
          duration={duration}
          micOn={micOn}
          camOn={camOn}
          onToggleMic={() => setMicOn((value) => !value)}
          onToggleCam={() => setCamOn((value) => !value)}
          onHangup={() => {
            setCallReason(callState === 'outgoing' ? 'canceled' : 'hangup');
            setCallState('ended');
          }}
          onPeerAccept={() => setCallState('active')}
          onSimWeak={() => setCallState(callState === 'reconnecting' ? 'active' : 'reconnecting')}
        />
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
