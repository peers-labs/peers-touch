/**
 * CallOverlay — local call state machine. Increment 11 ships outgoing 1:1
 * audio/video (ringing → connecting → active with mute/camera/hang up).
 * Increment 14 adds incoming calls and group calls.
 */
import { useEffect, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import { Avatar, Button, IconButton } from '@peers-touch/ui';
import type { Conversation } from './chat-data';

export type CallKind = 'audio' | 'video';
export type CallPhase = 'ringing' | 'connecting' | 'active' | 'ended';

export function CallOverlay({ conversation, kind, onEnd }: {
  conversation: Conversation;
  kind: CallKind;
  onEnd: () => void;
}) {
  const [phase, setPhase] = useState<CallPhase>('ringing');
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState(kind === 'video');
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timers: number[] = [];
    if (phase === 'ringing') {
      timers.push(window.setTimeout(() => setPhase('connecting'), 1600));
    } else if (phase === 'connecting') {
      timers.push(window.setTimeout(() => setPhase('active'), 900));
    } else if (phase === 'active') {
      timers.push(window.setInterval(() => setSeconds(s => s + 1), 1000));
    }
    return () => timers.forEach(clearInterval);
  }, [phase]);

  const phaseText = {
    ringing: kind === 'video' ? '正在发起视频通话…' : '正在呼叫…',
    connecting: '正在接通…',
    active: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
    ended: '通话已结束',
  }[phase];

  const hangUp = () => {
    setPhase('ended');
    window.setTimeout(onEnd, 500);
  };

  return (
    <div className="sk-call-overlay" data-call-phase={phase} data-call-kind={kind}>
      <div className="sk-call-card">
        <Avatar name={conversation.name} background={conversation.tone} size={88}
          style={{ borderRadius: 26 }} />
        <h2>{conversation.name}</h2>
        <span className="sk-call-phase" role="status">{phaseText}</span>

        {phase === 'active' && kind === 'video' && camera && (
          <div className="sk-call-video" aria-label="本地视频预览">
            <Avatar name={conversation.name} background={conversation.tone} size={72}
              style={{ borderRadius: 22 }} />
          </div>
        )}

        <div className="sk-call-controls">
          <button type="button"
            className={`sk-call-ctl${muted ? ' is-off' : ''}`}
            aria-label={muted ? '取消静音' : '静音'} aria-pressed={muted}
            onClick={() => setMuted(value => !value)}>
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          {kind === 'video' && (
            <button type="button"
              className={`sk-call-ctl${camera ? '' : ' is-off'}`}
              aria-label={camera ? '关闭摄像头' : '打开摄像头'} aria-pressed={camera}
              onClick={() => setCamera(value => !value)}>
              {camera ? <Video size={18} /> : <VideoOff size={18} />}
            </button>
          )}
          <button type="button" className="sk-call-ctl is-hangup"
            aria-label="挂断" onClick={hangUp}>
            <PhoneOff size={18} />
          </button>
        </div>

        {phase === 'ringing' && (
          <Button actionId="call.cancel" emphasis="quiet" leading={<Phone size={13} />}
            label="取消呼叫" onActivate={hangUp} />
        )}
      </div>
    </div>
  );
}
