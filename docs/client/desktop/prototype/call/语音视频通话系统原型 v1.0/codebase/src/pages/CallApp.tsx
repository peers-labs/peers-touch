import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  Users,
  Settings,
  Search,
  Send,
  Phone,
  PhoneOff,
  PhoneIncoming,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Minimize2,
  Maximize2,
  Wifi,
  WifiOff,
  Check,
  CheckCheck,
  Volume2,
  AlertCircle,
} from 'lucide-react';
import { cn } from '../lib/utils';

// NOTE: prototype-only mock data. Real product data comes from chat runtime.
const currentUser = { id: 'u1', name: 'Alex', avatar: 'https://picsum.photos/seed/alex/100/100' };
const peer = {
  id: 's1',
  name: 'Sarah Jenkins',
  avatar: 'https://picsum.photos/seed/sarah/200/200',
  online: true,
};

const messages = [
  { id: 'm1', senderId: 's1', text: 'Hey Alex, are we still on for the meeting?', time: '10:30 AM', status: 'read' },
  { id: 'm2', senderId: 'u1', text: 'Yes, absolutely. I have the presentation ready.', time: '10:35 AM', status: 'read' },
  { id: 'm3', senderId: 's1', text: 'Great! Let me call you to walk through it.', time: '10:42 AM', status: 'delivered' },
];

// Call state is driven by URL searchParams so reviewers can walk every state.
type CallState = 'none' | 'outgoing' | 'incoming' | 'active' | 'reconnecting' | 'ended' | 'failed';
type MediaKind = 'audio' | 'video';
type EndReason = 'hangup' | 'canceled' | 'rejected' | 'missed' | 'denied' | 'network';

const endReasonText: Record<EndReason, string> = {
  hangup: 'Call ended',
  canceled: 'Call canceled',
  rejected: 'Call declined',
  missed: 'No answer',
  denied: 'Microphone / camera permission denied',
  network: 'Connection failed',
};

export default function CallApp() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const call = (searchParams.get('call') || 'none') as CallState;
  const media = (searchParams.get('media') || 'video') as MediaKind;
  const reason = (searchParams.get('reason') || 'hangup') as EndReason;

  const setCall = (next: Partial<{ call: CallState; media: MediaKind; reason: EndReason }>) => {
    const params = new URLSearchParams(searchParams);
    params.set('session', 's1');
    if (next.call !== undefined) params.set('call', next.call);
    if (next.media !== undefined) params.set('media', next.media);
    if (next.reason !== undefined) params.set('reason', next.reason);
    if (next.call === 'none') {
      params.delete('reason');
    }
    navigate(`?${params.toString()}`);
  };

  return (
    <div className="h-screen w-full flex bg-white font-sans text-slate-900 overflow-hidden">
      {/* Left rail */}
      <nav className="w-16 bg-slate-50 border-r border-slate-200 flex flex-col items-center py-4 shrink-0">
        <img src={currentUser.avatar} alt="me" className="w-9 h-9 rounded-lg object-cover border border-slate-200 mb-6" />
        <div className="flex flex-col gap-2 flex-1">
          <RailItem icon={<Search size={20} />} />
          <RailItem icon={<MessageSquare size={20} />} active />
          <RailItem icon={<Users size={20} />} />
        </div>
        <RailItem icon={<Settings size={20} />} />
      </nav>

      {/* Session list */}
      <aside className="w-72 border-r border-slate-200 flex flex-col shrink-0">
        <div className="h-14 flex items-center px-4 border-b border-slate-200 font-bold text-sm">Messages</div>
        <div className="p-2">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-100">
            <div className="relative">
              <img src={peer.avatar} alt={peer.name} className="w-10 h-10 rounded-full object-cover" />
              {peer.online && <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{peer.name}</div>
              <div className="text-xs text-slate-500 truncate">Great! Let me call you...</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Chat main area — stays interactive during a call */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        <ChatHeader
          callActive={call !== 'none'}
          onVoice={() => setCall({ call: 'outgoing', media: 'audio' })}
          onVideo={() => setCall({ call: 'outgoing', media: 'video' })}
        />

        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4 bg-slate-50">
          {messages.map((m) => (
            <MessageBubble key={m.id} mine={m.senderId === currentUser.id} text={m.text} time={m.time} status={m.status} />
          ))}
        </div>

        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-400 text-sm">
            <span className="flex-1">Type a message...</span>
            <Send size={18} />
          </div>
        </div>

        {/* Prototype state switcher — not part of the product UI */}
        <StateSwitcher call={call} media={media} setCall={setCall} />

        {/* Call overlays */}
        <AnimatePresence>
          {call === 'outgoing' && (
            <OutgoingCallCard
              key="outgoing"
              media={media}
              onCancel={() => setCall({ call: 'ended', reason: 'canceled' })}
              onPeerAccept={() => setCall({ call: 'active' })}
              onNoAnswer={() => setCall({ call: 'failed', reason: 'missed' })}
            />
          )}
          {(call === 'active' || call === 'reconnecting') && (
            <ActiveCallCard
              key="active"
              media={media}
              reconnecting={call === 'reconnecting'}
              onToggleReconnect={() => setCall({ call: call === 'reconnecting' ? 'active' : 'reconnecting' })}
              onHangup={() => setCall({ call: 'ended', reason: 'hangup' })}
            />
          )}
          {(call === 'ended' || call === 'failed') && (
            <CallResultToast key="result" reason={reason} onDismiss={() => setCall({ call: 'none' })} />
          )}
        </AnimatePresence>

        {/* Incoming call modal is global and highest priority */}
        <AnimatePresence>
          {call === 'incoming' && (
            <IncomingCallModal
              media={media}
              onAccept={() => setCall({ call: 'active', media: 'audio' })}
              onReject={() => setCall({ call: 'ended', reason: 'rejected' })}
            />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function RailItem({ icon, active }: { icon: React.ReactNode; active?: boolean }) {
  return (
    <button
      className={cn(
        'w-10 h-10 rounded-xl flex items-center justify-center transition-colors',
        active ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-200',
      )}
    >
      {icon}
    </button>
  );
}

function ChatHeader({ callActive, onVoice, onVideo }: { callActive: boolean; onVoice: () => void; onVideo: () => void }) {
  return (
    <header className="h-14 border-b border-slate-200 flex items-center justify-between px-6 shrink-0 bg-white">
      <div className="flex items-center gap-3">
        <span className="font-semibold text-sm">{peer.name}</span>
        <span className="text-xs text-green-600">Online</span>
      </div>
      <div className="flex items-center gap-1">
        <HeaderAction icon={<Phone size={18} />} disabled={callActive} onClick={onVoice} tooltip="Voice call" />
        <HeaderAction icon={<Video size={18} />} disabled={callActive} onClick={onVideo} tooltip="Video call" />
      </div>
    </header>
  );
}

function HeaderAction({
  icon,
  disabled,
  onClick,
  tooltip,
}: {
  icon: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  tooltip: string;
}) {
  return (
    <button
      title={disabled ? 'Already in a call' : tooltip}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-9 h-9 rounded-lg flex items-center justify-center transition-colors',
        disabled ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 hover:bg-slate-100',
      )}
    >
      {icon}
    </button>
  );
}

function MessageBubble({ mine, text, time, status }: { mine: boolean; text: string; time: string; status: string }) {
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-md px-4 py-2 rounded-2xl text-sm', mine ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200')}>
        <div>{text}</div>
        <div className={cn('flex items-center gap-1 mt-1 text-[10px]', mine ? 'text-slate-300' : 'text-slate-400')}>
          <span>{time}</span>
          {mine && (status === 'read' ? <CheckCheck size={12} /> : <Check size={12} />)}
        </div>
      </div>
    </div>
  );
}

function OutgoingCallCard({
  media,
  onCancel,
  onPeerAccept,
  onNoAnswer,
}: {
  media: MediaKind;
  onCancel: () => void;
  onPeerAccept: () => void;
  onNoAnswer: () => void;
}) {
  return (
    <FloatingCard>
      <div className="flex flex-col items-center text-center text-white px-6 py-6">
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ repeat: Infinity, duration: 1.6 }}
          className="relative mb-4"
        >
          <img src={peer.avatar} alt={peer.name} className="w-20 h-20 rounded-full object-cover ring-4 ring-white/20" />
          <span className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center">
            {media === 'video' ? <Video size={16} /> : <Phone size={16} />}
          </span>
        </motion.div>
        <div className="text-lg font-semibold">{peer.name}</div>
        <div className="text-sm text-white/60 mt-1">{media === 'video' ? 'Video' : 'Voice'} calling...</div>

        <div className="flex items-center gap-3 mt-6">
          <RoundButton tone="danger" icon={<PhoneOff size={22} />} onClick={onCancel} label="Cancel" />
        </div>

        <SimRow>
          <SimButton onClick={onPeerAccept}>Peer accepts</SimButton>
          <SimButton onClick={onNoAnswer}>No answer</SimButton>
        </SimRow>
      </div>
    </FloatingCard>
  );
}

function ActiveCallCard({
  media,
  reconnecting,
  onToggleReconnect,
  onHangup,
}: {
  media: MediaKind;
  reconnecting: boolean;
  onToggleReconnect: () => void;
  onHangup: () => void;
}) {
  const [seconds, setSeconds] = useState(0);
  const [micOff, setMicOff] = useState(false);
  const [camOff, setCamOff] = useState(media === 'audio');
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    if (reconnecting) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [reconnecting]);

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  if (minimized) {
    return (
      <FloatingCard compact>
        <div className="flex items-center gap-3 px-3 py-2 text-white">
          <img src={peer.avatar} alt={peer.name} className="w-8 h-8 rounded-full object-cover" />
          <div className="text-xs">
            <div className="font-medium">{peer.name}</div>
            <div className="text-white/60">{reconnecting ? 'Reconnecting...' : mmss}</div>
          </div>
          <button onClick={() => setMinimized(false)} className="text-white/70 hover:text-white ml-2">
            <Maximize2 size={16} />
          </button>
          <button onClick={onHangup} className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center">
            <PhoneOff size={16} />
          </button>
        </div>
      </FloatingCard>
    );
  }

  return (
    <FloatingCard wide={media === 'video'}>
      {reconnecting && (
        <div className="flex items-center justify-center gap-2 py-1.5 bg-amber-500/90 text-white text-xs font-medium">
          <WifiOff size={14} /> Reconnecting...
        </div>
      )}

      {media === 'video' && !camOff ? (
        <div className="relative h-64 bg-slate-800 flex items-center justify-center">
          <img src="https://picsum.photos/seed/remotevideo/640/360" alt="remote" className="w-full h-full object-cover" />
          <div className="absolute bottom-3 right-3 w-24 h-16 rounded-lg overflow-hidden border border-white/30 shadow-lg">
            <img src="https://picsum.photos/seed/localvideo/240/160" alt="me" className="w-full h-full object-cover" />
          </div>
          <div className="absolute top-3 left-3 flex items-center gap-2 px-2 py-1 rounded-full bg-black/40 text-white text-xs">
            {reconnecting ? <WifiOff size={12} /> : <Wifi size={12} />}
            <span>{reconnecting ? 'Reconnecting' : 'Connected · direct'}</span>
          </div>
        </div>
      ) : (
        <div className="h-48 flex flex-col items-center justify-center text-white">
          <div className="relative mb-3">
            <img src={peer.avatar} alt={peer.name} className="w-20 h-20 rounded-full object-cover" />
            {!micOff && (
              <motion.span
                animate={{ scale: [1, 1.25, 1], opacity: [0.7, 0.2, 0.7] }}
                transition={{ repeat: Infinity, duration: 1.4 }}
                className="absolute inset-0 rounded-full ring-4 ring-emerald-400/50"
              />
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-white/60">
            <Volume2 size={12} /> {media === 'video' ? 'Camera off' : 'Voice call'}
          </div>
        </div>
      )}

      <div className="px-4 py-3 text-white">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold">{peer.name}</span>
          <span className="text-xs text-white/60">{reconnecting ? 'Reconnecting...' : mmss}</span>
        </div>
        <div className="flex items-center justify-center gap-3">
          <CtrlButton active={!micOff} icon={micOff ? <MicOff size={18} /> : <Mic size={18} />} onClick={() => setMicOff((v) => !v)} />
          <CtrlButton active={!camOff} icon={camOff ? <VideoOff size={18} /> : <Video size={18} />} onClick={() => setCamOff((v) => !v)} />
          <CtrlButton active icon={<Minimize2 size={18} />} onClick={() => setMinimized(true)} />
          <button onClick={onHangup} className="w-12 h-12 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white">
            <PhoneOff size={20} />
          </button>
        </div>

        <SimRow>
          <SimButton onClick={onToggleReconnect}>{reconnecting ? 'Recover network' : 'Simulate weak network'}</SimButton>
        </SimRow>
      </div>
    </FloatingCard>
  );
}

function IncomingCallModal({ media, onAccept, onReject }: { media: MediaKind; onAccept: () => void; onReject: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <motion.div
        initial={{ scale: 0.92, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 12 }}
        className="w-80 rounded-3xl bg-slate-900 text-white p-8 flex flex-col items-center text-center shadow-2xl"
      >
        <motion.img
          src={peer.avatar}
          alt={peer.name}
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ repeat: Infinity, duration: 1.4 }}
          className="w-24 h-24 rounded-full object-cover ring-4 ring-emerald-400/40 mb-4"
        />
        <div className="text-xl font-semibold">{peer.name}</div>
        <div className="flex items-center gap-1.5 text-sm text-white/60 mt-1">
          <PhoneIncoming size={14} /> Incoming {media === 'video' ? 'video' : 'voice'} call
        </div>

        <div className="flex items-center gap-10 mt-8">
          <RoundButton tone="danger" icon={<PhoneOff size={24} />} onClick={onReject} label="Decline" />
          <RoundButton tone="accept" icon={media === 'video' ? <Video size={24} /> : <Phone size={24} />} onClick={onAccept} label="Accept" />
        </div>
      </motion.div>
    </motion.div>
  );
}

function CallResultToast({ reason, onDismiss }: { reason: EndReason; onDismiss: () => void }) {
  const isFailure = reason === 'denied' || reason === 'network' || reason === 'missed';
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="absolute bottom-6 right-6 z-40 w-72 rounded-2xl bg-white border border-slate-200 shadow-xl p-4"
    >
      <div className="flex items-start gap-3">
        <div className={cn('w-9 h-9 rounded-full flex items-center justify-center', isFailure ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-600')}>
          {isFailure ? <AlertCircle size={18} /> : <PhoneOff size={18} />}
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">{endReasonText[reason]}</div>
          <div className="text-xs text-slate-500 mt-0.5">{peer.name}{reason === 'hangup' ? ' · 02:14' : ''}</div>
        </div>
        <button onClick={onDismiss} className="text-xs text-slate-400 hover:text-slate-600">Dismiss</button>
      </div>
    </motion.div>
  );
}

// --- shared primitives ---

function FloatingCard({ children, wide, compact }: { children: React.ReactNode; wide?: boolean; compact?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.96 }}
      className={cn(
        'absolute bottom-6 right-6 z-40 rounded-2xl bg-slate-900 shadow-2xl overflow-hidden',
        compact ? 'w-auto' : wide ? 'w-96' : 'w-72',
      )}
    >
      {children}
    </motion.div>
  );
}

function RoundButton({ tone, icon, onClick, label }: { tone: 'accept' | 'danger'; icon: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={onClick}
        className={cn(
          'w-14 h-14 rounded-full flex items-center justify-center text-white transition-colors',
          tone === 'accept' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600',
        )}
      >
        {icon}
      </button>
      <span className="text-xs text-white/70">{label}</span>
    </div>
  );
}

function CtrlButton({ active, icon, onClick }: { active: boolean; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-12 h-12 rounded-full flex items-center justify-center transition-colors',
        active ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-white text-slate-900',
      )}
    >
      {icon}
    </button>
  );
}

// Prototype-only helpers to simulate peer/network events. Not product UI.
function SimRow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center gap-2 mt-4 pt-3 border-t border-white/10">{children}</div>;
}

function SimButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-1 rounded-md bg-white/10 text-[11px] text-white/70 hover:bg-white/20 transition-colors"
    >
      {children}
    </button>
  );
}

function StateSwitcher({
  call,
  media,
  setCall,
}: {
  call: CallState;
  media: MediaKind;
  setCall: (next: Partial<{ call: CallState; media: MediaKind; reason: EndReason }>) => void;
}) {
  const states: { label: string; call: CallState; media?: MediaKind; reason?: EndReason }[] = [
    { label: 'Idle', call: 'none' },
    { label: 'Outgoing (video)', call: 'outgoing', media: 'video' },
    { label: 'Outgoing (voice)', call: 'outgoing', media: 'audio' },
    { label: 'Incoming', call: 'incoming', media: 'video' },
    { label: 'Active (video)', call: 'active', media: 'video' },
    { label: 'Active (voice)', call: 'active', media: 'audio' },
    { label: 'Reconnecting', call: 'reconnecting', media: 'video' },
    { label: 'Ended', call: 'ended', media, reason: 'hangup' },
    { label: 'Denied', call: 'failed', media: 'video', reason: 'denied' },
  ];
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/90 backdrop-blur border border-slate-200 shadow-sm max-w-[90%]">
      <span className="text-[10px] uppercase tracking-wide text-slate-400 mr-1">Prototype states</span>
      {states.map((s) => {
        const isActive = s.call === call && (s.media === undefined || s.media === media);
        return (
          <button
            key={s.label}
            onClick={() => setCall({ call: s.call, media: s.media ?? media, reason: s.reason })}
            className={cn(
              'px-2 py-0.5 rounded-md text-[11px] transition-colors',
              isActive ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
