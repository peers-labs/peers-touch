/**
 * Call surfaces (increments 14 + 19).
 *
 * Parity with the desktop CallSurface/IncomingCallModal:
 *  - 1:1 outgoing/active calls render as a bottom-right HUD tray that does
 *    not block the conversation (compact / video layout), with a ringing →
 *    joining → active timer lifecycle, reconnecting state, mic/camera
 *    toggles and device selects.
 *  - Incoming calls are centered: accept / decline, plus a multi-device
 *    "answered on another device" path.
 *  - A prototype-only simulator surfaces non-happy-path states
 *    (reconnecting, the six end reasons) that real signalling would drive.
 *  - Group calls keep the full participant grid (the desktop prototype had
 *    no group surface; this is the increment-14 extension).
 * No WebRTC: media streams, devices and reasons are local simulations.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Bug, Mic, MicOff, PhoneOff, ShieldCheck, Smartphone, Video, VideoOff,
  WifiOff,
} from 'lucide-react';
import type { Conversation } from './chat-data';

export type CallKind = 'audio' | 'video';
export type CallDirection = 'out' | 'in';
type Phase =
  | 'incoming'
  | 'ringing'
  | 'connecting'
  | 'active'
  | 'reconnecting'
  | 'handled-elsewhere'
  | 'ended';
type EndReason = 'hangup' | 'canceled' | 'rejected' | 'missed' | 'denied' | 'network';

export const CALL_END_REASONS: { id: EndReason; zh: string; tone: 'neutral' | 'bad' }[] = [
  { id: 'hangup', zh: '通话已结束', tone: 'neutral' },
  { id: 'canceled', zh: '通话已取消', tone: 'neutral' },
  { id: 'rejected', zh: '对方已拒绝', tone: 'neutral' },
  { id: 'missed', zh: '无人接听', tone: 'bad' },
  { id: 'denied', zh: '麦克风 / 摄像头权限被拒绝', tone: 'bad' },
  { id: 'network', zh: '连接失败，请重试', tone: 'bad' },
];

const RING_MS = 1600;
const CONNECT_MS = 900;
const ENDED_HOLD_MS = 2600;
const ELSEWHERE_MS = 1800;

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

type Participant = {
  name: string;
  tone: string;
  local: boolean;
  joined: boolean;
  micOn: boolean;
  camOn: boolean;
  speaking: boolean;
};

const AUDIO_DEVICES = ['MacBook 麦克风', 'Studio Display 麦克风'];
const VIDEO_DEVICES = ['FaceTime HD 摄像头', '外接摄像头'];

export function CallOverlay({ conversation, kind, direction, multi = false, onEnd }: {
  conversation: Conversation;
  kind: CallKind;
  direction: CallDirection;
  multi?: boolean;
  onEnd: () => void;
}) {
  const isGroup = conversation.kind === 'group';
  const [phase, setPhase] = useState<Phase>(direction === 'in' ? 'incoming' : 'ringing');
  const [endReason, setEndReason] = useState<EndReason>('hangup');
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState(kind === 'video');
  const [seconds, setSeconds] = useState(0);
  const [simOpen, setSimOpen] = useState(false);
  const [audioDevice, setAudioDevice] = useState(AUDIO_DEVICES[0]);
  const [videoDevice, setVideoDevice] = useState(VIDEO_DEVICES[0]);

  const [participants, setParticipants] = useState<Participant[]>(() => [
    { name: '我', tone: conversation.tone, local: true, joined: true, micOn: true, camOn: kind === 'video', speaking: false },
    ...(conversation.members ?? []).map((member, index) => ({
      name: member.name, tone: member.tone, local: false,
      joined: !isGroup ? true : index === 0,
      micOn: true, camOn: false, speaking: false,
    })),
  ]);

  // Ringing only applies to outgoing calls; connecting -> active runs for
  // both directions so an accepted incoming call reaches the active surface.
  useEffect(() => {
    if (phase === 'ringing' && direction === 'out') {
      const t = window.setTimeout(() => setPhase('connecting'), RING_MS);
      return () => window.clearTimeout(t);
    }
    if (phase === 'connecting') {
      const t = window.setTimeout(() => setPhase('active'), CONNECT_MS);
      return () => window.clearTimeout(t);
    }
  }, [phase, direction]);

  // Active timer.
  useEffect(() => {
    if (phase !== 'active' && phase !== 'reconnecting') return;
    const t = window.setInterval(() => setSeconds(s => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  // Group remote joins with a deterministic stagger once active.
  useEffect(() => {
    if (phase !== 'active' || !isGroup) return;
    const timers: number[] = [];
    participants.forEach((p, index) => {
      if (!p.local && !p.joined) {
        timers.push(window.setTimeout(() => {
          setParticipants(list => list.map((item, i) => (i === index ? { ...item, joined: true } : item)));
        }, 400 + index * 480));
      }
    });
    return () => timers.forEach(window.clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isGroup]);

  // Deterministic speaking ring across joined remote participants.
  useEffect(() => {
    if (phase !== 'active' || !isGroup) return;
    let speaker = 0;
    const t = window.setInterval(() => {
      setParticipants(list => {
        const remoteJoined = list
          .map((item, index) => ({ item, index }))
          .filter(x => !x.item.local && x.item.joined);
        if (remoteJoined.length === 0) return list;
        speaker = (speaker + 1) % remoteJoined.length;
        const target = remoteJoined[speaker].index;
        return list.map((item, i) => ({ ...item, speaking: i === target }));
      });
    }, 2200);
    return () => window.clearInterval(t);
  }, [phase, isGroup]);

  // Auto-dismiss terminal surfaces.
  useEffect(() => {
    if (phase === 'handled-elsewhere') {
      const t = window.setTimeout(onEnd, ELSEWHERE_MS);
      return () => window.clearTimeout(t);
    }
    if (phase === 'ended') {
      const t = window.setTimeout(onEnd, ENDED_HOLD_MS);
      return () => window.clearTimeout(t);
    }
  }, [phase, onEnd]);

  const endWith = (reason: EndReason) => {
    setSimOpen(false);
    setEndReason(reason);
    setPhase('ended');
  };

  const accept = () => setPhase('connecting');
  const decline = () => endWith('rejected');
  const answeredElsewhere = () => setPhase('handled-elsewhere');
  const toggleMute = () => {
    setMuted(value => {
      setParticipants(list => list.map(item => item.local ? { ...item, micOn: value } : item));
      return !value;
    });
  };
  const toggleCamera = () => setCamera(value => !value);

  const isVideo = kind === 'video';
  const statusText = useMemo(() => {
    switch (phase) {
      case 'incoming': return isVideo ? '邀请你视频通话…' : '邀请你语音通话…';
      case 'ringing': return '正在呼叫…';
      case 'connecting': return isGroup ? '正在加入群通话…' : '正在接通…';
      case 'reconnecting': return '正在重连…';
      case 'handled-elsewhere': return '已在其他设备接听';
      case 'ended': return CALL_END_REASONS.find(r => r.id === endReason)?.zh ?? '通话已结束';
      default: return formatSeconds(seconds);
    }
  }, [phase, isVideo, isGroup, endReason, seconds]);

  /* ── Incoming centered modal ────────────────────────── */
  if (phase === 'incoming') {
    return (
      <div className="sk-call-overlay" data-call-phase={phase} data-call-kind={kind}
        data-call-scope={isGroup ? 'group' : 'one'} data-call-direction="in">
        <div className="sk-call-incoming" data-call-incoming={multi ? 'multi' : 'single'}>
          <div className="sk-call-incoming-avatar">
            {isGroup ? (
              <span className="sk-call-incoming-group">
                {(conversation.members ?? []).slice(0, 3).map(m => (
                  <span key={m.name} style={{ background: m.tone }}>{m.name.slice(0, 1)}</span>
                ))}
              </span>
            ) : (
              <Avatar88 name={conversation.name} tone={conversation.tone} />
            )}
          </div>
          <h2>{conversation.name}</h2>
          <p data-call-incoming-text>
            {multi
              ? `这台 Mac 和你的手机同时收到${isVideo ? '视频' : '语音'}来电`
              : `${isVideo ? '视频' : '语音'}来电`}
          </p>
          <div className="sk-call-incoming-actions">
            <div className="sk-call-ctl-wrap">
              <button type="button" className="sk-call-ctl is-decline" data-call-decline
                aria-label="拒绝" onClick={decline}><PhoneOff size={18} /></button>
              <span>拒绝</span>
            </div>
            {multi && (
              <div className="sk-call-ctl-wrap">
                <button type="button" className="sk-call-ctl is-elsewhere" data-call-elsewhere
                  aria-label="在手机上接听" onClick={answeredElsewhere}><Smartphone size={17} /></button>
                <span>手机已接</span>
              </div>
            )}
            <div className="sk-call-ctl-wrap">
              <button type="button" className="sk-call-ctl is-accept" data-call-accept
                aria-label="接听" onClick={accept}>
                {isVideo ? <Video size={18} /> : <PhoneIncomingIcon />}
              </button>
              <span>接听</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Ended / handled-elsewhere compact notice ───────── */
  if (phase === 'ended' || phase === 'handled-elsewhere') {
    const bad = CALL_END_REASONS.find(r => r.id === endReason)?.tone === 'bad';
    return (
      <div className="sk-call-overlay is-notice" data-call-phase={phase} data-call-kind={kind}
        data-call-scope={isGroup ? 'group' : 'one'}>
        <div className={`sk-call-notice${bad ? ' is-bad' : ''}`} data-call-notice>
          {phase === 'handled-elsewhere' ? <Smartphone size={16} /> : <PhoneOff size={15} />}
          <span>{statusText}</span>
        </div>
      </div>
    );
  }

  const joinedCount = participants.filter(p => p.joined).length;
  const activeLike = phase === 'active' || phase === 'reconnecting';

  /* ── Group: participant grid (increment-14 surface) ─── */
  if (isGroup) {
    return (
      <div className="sk-call-overlay" data-call-phase={phase} data-call-kind={kind}
        data-call-scope="group" data-call-direction={direction}>
        <div className="sk-call-card sk-call-group-card">
          <span className="sk-call-group-badge"><Smartphone size={12} /> 群通话 · {conversation.name}</span>
          <h2>{conversation.name}</h2>
          <span className="sk-call-phase">
            {phase === 'reconnecting' && <WifiOff size={12} />} {statusText}
            {activeLike && ` · ${joinedCount} 人在通话`}
          </span>
          <div className="sk-call-grid" data-participant-count={joinedCount}>
            {participants.filter(p => p.joined).map(item => (
              <div key={item.name} className={`sk-call-tile${item.speaking ? ' is-speaking' : ''}`}
                data-participant={item.name} data-participant-local={item.local ? 'true' : 'false'}
                data-mic={item.micOn ? 'on' : 'off'}>
                <Avatar88 name={item.name} tone={item.tone} size={52} />
                <span className="sk-call-tile-name">{item.local ? '我' : item.name}</span>
                {!item.micOn && <MicOff size={11} className="sk-call-tile-muted" />}
              </div>
            ))}
          </div>
          <CallControls
            active={activeLike} isVideo={false} muted={muted} camera={false}
            phase={phase} onMute={toggleMute} onCamera={toggleCamera} onHangup={() => endWith('hangup')}
            onSim={() => setSimOpen(v => !v)} simOpen={simOpen}
            onReconnect={() => setPhase(p => (p === 'reconnecting' ? 'active' : 'reconnecting'))}
            onReason={endWith}
          />
        </div>
      </div>
    );
  }

  /* ── 1:1: bottom-right HUD tray (does not block chat) ─ */
  return (
    <div className="sk-call-hud-layer" data-call-phase={phase} data-call-kind={kind}
      data-call-scope="one" data-call-direction={direction}>
      <div className={`sk-call-hud${isVideo ? ' is-video' : ''}`} data-call-hud>
        {isVideo && activeLike ? (
          <div className="sk-call-video-pane">
            <div className={`sk-call-video-remote${phase === 'reconnecting' ? ' is-reconnecting' : ''}`}>
              {phase === 'reconnecting' ? <WifiOff size={26} /> : conversation.name}
            </div>
            <div className={`sk-call-video-self${camera ? ' is-on' : ''}`} data-camera={camera ? 'on' : 'off'}>
              {camera ? <span>你</span> : <VideoOff size={18} />}
            </div>
            <span className="sk-call-e2e"><ShieldCheck size={11} /> 端到端加密</span>
          </div>
        ) : (
          <div className="sk-call-audio-pane">
            <Avatar88 name={conversation.name} tone={conversation.tone} size={44} />
            <div className="sk-call-audio-id">
              <strong>{conversation.name}</strong>
              <span className={phase === 'reconnecting' ? 'is-warn' : ''} data-call-hud-status>
                {phase === 'reconnecting' && <><WifiOff size={12} /> </>}
                {statusText}
              </span>
            </div>
          </div>
        )}

        {activeLike && (
          <div className="sk-call-devices" data-call-devices>
            <label className="sk-call-device">
              <Mic size={11} />
              <select aria-label="麦克风设备" value={audioDevice}
                onChange={e => setAudioDevice(e.target.value)}>
                {AUDIO_DEVICES.map(d => <option key={d}>{d}</option>)}
              </select>
            </label>
            {isVideo && (
              <label className="sk-call-device">
                <Video size={11} />
                <select aria-label="摄像头设备" value={videoDevice}
                  onChange={e => setVideoDevice(e.target.value)}>
                  {VIDEO_DEVICES.map(d => <option key={d}>{d}</option>)}
                  </select>
              </label>
            )}
          </div>
        )}

        <CallControls
          active={activeLike} isVideo={isVideo} muted={muted} camera={camera}
          phase={phase} onMute={toggleMute} onCamera={toggleCamera} onHangup={() => endWith('hangup')}
          onSim={() => setSimOpen(v => !v)} simOpen={simOpen}
          onReconnect={() => setPhase(p => (p === 'reconnecting' ? 'active' : 'reconnecting'))}
          onReason={endWith}
        />
      </div>
    </div>
  );
}

/* ── Shared controls + prototype simulator ───────────── */

function CallControls({ active, isVideo, muted, camera, phase, onMute, onCamera, onHangup, onSim, simOpen, onReconnect, onReason }: {
  active: boolean;
  isVideo: boolean;
  muted: boolean;
  camera: boolean;
  phase: Phase;
  onMute: () => void;
  onCamera: () => void;
  onHangup: () => void;
  onSim: () => void;
  simOpen: boolean;
  onReconnect: () => void;
  onReason: (reason: EndReason) => void;
}) {
  return (
    <div className="sk-call-controls-row">
      {active && (
        <button type="button" className="sk-call-ctl" data-call-mute
          aria-label={muted ? '取消静音' : '静音'} aria-pressed={muted} onClick={onMute}>
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
      )}
      {active && isVideo && (
        <button type="button" className="sk-call-ctl" data-call-camera
          aria-label={camera ? '关闭摄像头' : '打开摄像头'} aria-pressed={!camera} onClick={onCamera}>
          {camera ? <Video size={18} /> : <VideoOff size={18} />}
        </button>
      )}
      <button type="button" className="sk-call-ctl is-hangup" data-call-hangup
        aria-label={active ? '挂断' : '取消'} onClick={onHangup}><PhoneOff size={18} /></button>
      <button type="button" className="sk-call-sim-toggle" data-call-simulator
        aria-label="通话状态模拟器（原型）" title="非快乐路径模拟" onClick={onSim}><Bug size={13} /></button>
      {simOpen && (
        <div className="sk-call-sim" data-call-sim-panel>
          <span className="sk-call-sim-title">状态模拟（仅原型）</span>
          <button type="button" data-sim-reconnect onClick={onReconnect}>
            {phase === 'reconnecting' ? '恢复连接' : '模拟弱网重连'}
          </button>
          <span className="sk-call-sim-title">结束原因</span>
          {CALL_END_REASONS.map(r => (
            <button key={r.id} type="button" data-sim-reason={r.id} onClick={() => onReason(r.id)}>{r.zh}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Avatar88({ name, tone, size = 80 }: { name: string; tone: string; size?: number }) {
  return (
    <span className="sk-call-avatar" style={{ width: size, height: size, background: tone, fontSize: size * 0.36 }}>
      {name.slice(0, 1)}
    </span>
  );
}

function PhoneIncomingIcon() {
  // lucide phone-incoming would add an import surface; reuse PhoneOff rotate
  // is misleading, so render the canonical glyph via a small inline svg.
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="16 2 16 8 22 8" />
      <line x1="22" y1="2" x2="16" y2="8" />
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
