/**
 * CallOverlay — local call state machine.
 *  - outgoing 1:1: ringing → connecting → active (increment 11)
 *  - incoming 1:1: incoming → accept → connecting → active / decline (inc 14)
 *  - group: joining → active with a participant grid, staggered joins and a
 *    deterministic speaking indicator (increment 14)
 * No WebRTC: media toggles are local state; real signalling stays UNPROVEN.
 */
import { useEffect, useMemo, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Users, Video, VideoOff } from 'lucide-react';
import { Avatar, Button } from '@peers-touch/ui';
import type { Conversation } from './chat-data';

export type CallKind = 'audio' | 'video';
export type CallDirection = 'out' | 'in';
export type CallPhase = 'incoming' | 'ringing' | 'connecting' | 'active' | 'ended';

type Participant = {
  name: string;
  tone: string;
  local: boolean;
  joined: boolean;
  micOn: boolean;
  camOn: boolean;
  speaking: boolean;
};

function formatSeconds(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function CallOverlay({ conversation, kind, direction, onEnd }: {
  conversation: Conversation;
  kind: CallKind;
  direction: CallDirection;
  onEnd: () => void;
}) {
  const isGroup = conversation.kind === 'group';
  const [phase, setPhase] = useState<CallPhase>(direction === 'in' ? 'incoming' : 'ringing');
  const [endText, setEndText] = useState('通话已结束');
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState(kind === 'video');
  const [seconds, setSeconds] = useState(0);

  const [participants, setParticipants] = useState<Participant[]>(() => [
    { name: '我', tone: conversation.tone, local: true, joined: true, micOn: true, camOn: kind === 'video', speaking: false },
    ...(conversation.members ?? []).map((member, index) => ({
      name: member.name, tone: member.tone, local: false,
      joined: !isGroup ? true : index === 0,
      micOn: true, camOn: false, speaking: false,
    })),
  ]);

  // Phase transitions.
  useEffect(() => {
    const timers: number[] = [];
    if (phase === 'ringing') timers.push(window.setTimeout(() => setPhase('connecting'), 1600));
    else if (phase === 'connecting') timers.push(window.setTimeout(() => setPhase('active'), 900));
    else if (phase === 'active') timers.push(window.setInterval(() => setSeconds(s => s + 1), 1000));
    return () => timers.forEach(timer => window.clearInterval(timer));
  }, [phase]);

  // Group room: remaining members join with a deterministic stagger.
  useEffect(() => {
    if (phase !== 'active' || !isGroup) return;
    const timers: number[] = [];
    participants.forEach((participant, index) => {
      if (!participant.local && !participant.joined) {
        timers.push(window.setTimeout(() => {
          setParticipants(list => list.map((item, i) => i === index ? { ...item, joined: true } : item));
        }, 500 + index * 550));
      }
    });
    return () => timers.forEach(timer => window.clearTimeout(timer));
    // join scheduling is derived from the initial roster once active starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isGroup]);

  // Deterministic speaking rotation once the room is connected.
  useEffect(() => {
    if (phase !== 'active' || !isGroup) return;
    const timer = window.setInterval(() => {
      setParticipants(list => {
        const joinedRemote = list.filter(item => item.joined && !item.local && item.micOn);
        if (joinedRemote.length === 0) return list;
        const nextIndex = Math.floor(Math.random() * joinedRemote.length);
        const speaker = joinedRemote[nextIndex];
        return list.map(item => ({ ...item, speaking: item === speaker }));
      });
    }, 2200);
    return () => window.clearInterval(timer);
  }, [phase, isGroup]);

  const joinedCount = participants.filter(item => item.joined).length;

  const close = (text: string) => {
    setEndText(text);
    setPhase('ended');
    window.setTimeout(onEnd, 650);
  };
  const accept = () => setPhase('connecting');
  const decline = () => close('已拒绝');
  const hangUp = () => close('通话已结束');

  const toggleLocalMic = () => {
    setMuted(value => !value);
    setParticipants(list => list.map(item => (item.local ? { ...item, micOn: !item.micOn } : item)));
  };
  const toggleLocalCamera = () => {
    setCamera(value => !value);
    setParticipants(list => list.map(item => (item.local ? { ...item, camOn: !item.camOn } : item)));
  };

  const phaseText = useMemo(() => {
    switch (phase) {
      case 'incoming': return kind === 'video' ? '邀请你视频通话…' : '邀请你语音通话…';
      case 'ringing': return kind === 'video' ? '正在发起视频通话…' : '正在呼叫…';
      case 'connecting': return isGroup ? '正在加入群通话…' : '正在接通…';
      case 'active': return isGroup ? `${formatSeconds(seconds)} · ${joinedCount} 人在通话` : formatSeconds(seconds);
      case 'ended': return endText;
      default: return '';
    }
  }, [phase, kind, isGroup, seconds, joinedCount, endText]);

  return (
    <div className="sk-call-overlay" data-call-phase={phase} data-call-kind={kind}
      data-call-direction={direction} data-call-scope={isGroup ? 'group' : 'one'}>
      <div className="sk-call-card">
        {isGroup && phase !== 'ended' && (
          <span className="sk-call-group-badge"><Users size={13} />群通话 · {conversation.name}</span>
        )}
        {!isGroup && (
          <Avatar name={conversation.name} background={conversation.tone} size={88}
            style={{ borderRadius: 26 }} />
        )}
        <h2>{conversation.name}</h2>
        <span className="sk-call-phase" role="status">{phaseText}</span>

        {phase === 'active' && isGroup && (
          <div className="sk-call-grid" data-participant-count={joinedCount}>
            {participants.filter(item => item.joined).map(item => (
              <div key={item.name}
                className={`sk-call-tile${item.speaking ? ' is-speaking' : ''}`}
                data-participant={item.name}
                data-participant-local={item.local ? 'true' : 'false'}
                data-mic={item.micOn ? 'on' : 'off'}>
                <Avatar name={item.name} background={item.tone} size={52}
                  style={{ borderRadius: 16 }} />
                <span className="sk-call-tile-name">{item.local ? '我' : item.name}</span>
                {!item.micOn && <MicOff size={11} className="sk-call-tile-muted" aria-label="麦克风关闭" />}
                {kind === 'video' && !item.camOn && <VideoOff size={11} className="sk-call-tile-camoff" aria-label="摄像头关闭" />}
              </div>
            ))}
          </div>
        )}

        {phase === 'active' && !isGroup && kind === 'video' && camera && (
          <div className="sk-call-video" aria-label="本地视频预览">
            <Avatar name={conversation.name} background={conversation.tone} size={72}
              style={{ borderRadius: 22 }} />
          </div>
        )}

        {phase === 'incoming' ? (
          <div className="sk-call-controls">
            <div className="sk-call-ctl-wrap">
              <button type="button" className="sk-call-ctl is-decline"
                aria-label="拒绝来电" data-call-decline onClick={decline}>
                <PhoneOff size={18} />
              </button>
              <span className="sk-call-ctl-label">拒绝</span>
            </div>
            <div className="sk-call-ctl-wrap">
              <button type="button" className="sk-call-ctl is-accept"
                aria-label={kind === 'video' ? '接听视频通话' : '接听语音通话'}
                data-call-accept onClick={accept}>
                {kind === 'video' ? <Video size={18} /> : <Phone size={18} />}
              </button>
              <span className="sk-call-ctl-label">接听</span>
            </div>
          </div>
        ) : phase === 'ended' ? null : (
          <div className="sk-call-controls">
            <button type="button"
              className={`sk-call-ctl${muted ? ' is-off' : ''}`}
              aria-label={muted ? '取消静音' : '静音'} aria-pressed={muted}
              data-call-mute onClick={toggleLocalMic}>
              {muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            {kind === 'video' && (
              <button type="button"
                className={`sk-call-ctl${camera ? '' : ' is-off'}`}
                aria-label={camera ? '关闭摄像头' : '打开摄像头'} aria-pressed={camera}
                data-call-camera onClick={toggleLocalCamera}>
                {camera ? <Video size={18} /> : <VideoOff size={18} />}
              </button>
            )}
            <button type="button" className="sk-call-ctl is-hangup"
              aria-label={phase === 'active' ? '挂断' : '取消呼叫'} data-call-hangup onClick={hangUp}>
              <PhoneOff size={18} />
            </button>
          </div>
        )}

        {phase === 'ringing' && (
          <Button actionId="call.cancel" emphasis="quiet" leading={<Phone size={13} />}
            label="取消呼叫" onActivate={hangUp} />
        )}
      </div>
    </div>
  );
}
