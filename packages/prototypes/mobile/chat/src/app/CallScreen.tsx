/**
 * CallScreen — product call surface driven by the call state machine in
 * state.ts. In-frame overlay (absolute to .ma-root), full-screen ink, with
 * outgoing → active → ended lifecycle and mute/camera controls.
 */
import { useEffect } from 'react';
import { Avatar, IconButton } from '@peers-touch/ui';
import type { Action } from './state';
import { AVATAR_PINE, type AppState, type CallState } from './model';

function peerOf(state: AppState): { name: string; tone: string } {
  const call = state.call;
  if (call.status === 'idle') return { name: '', tone: AVATAR_PINE };
  const conv = state.conversations.find(c => c.id === call.conversationId);
  if (conv) return { name: conv.name, tone: conv.tone };
  const person = state.people.find(p => p.id === call.conversationId.replace('direct-', ''));
  return { name: person?.name ?? '通话', tone: person?.tone ?? AVATAR_PINE };
}

function statusText(call: CallState): string {
  switch (call.status) {
    case 'outgoing': return call.media === 'video' ? '正在发起视频通话…' : '正在呼叫…';
    case 'active': return formatTime(call.elapsed);
    default: return '';
  }
}
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function CallScreen({ state, dispatch }: { state: AppState; dispatch: (a: Action) => void }) {
  const call = state.call;
  useEffect(() => {
    if (call.status !== 'active') return;
    const timer = window.setInterval(() => dispatch({ type: 'call/tick-elapsed' }), 1000);
    return () => window.clearInterval(timer);
  }, [call.status, dispatch]);

  if (call.status === 'idle') return null;
  const peer = peerOf(state);
  const outgoing = call.status === 'outgoing';
  const active = call.status === 'active';

  return (
    <div className="ma-call" data-call-state={call.status} role="dialog" aria-modal="true" aria-label={`${peer.name} 通话`}>
      <div className="ma-call-trust"><span className="ma-call-trust-dot" />端到端加密通话</div>
      <div className="ma-call-avatar"><Avatar name={peer.name[0] ?? '?'} size={96} background={peer.tone} /><span className="ma-call-ring" /></div>
      <div className="ma-call-copy">
        <strong>{peer.name}</strong>
        <span role="status" aria-live="polite">{statusText(call)}</span>
      </div>
      <div className="ma-call-controls">
        {outgoing && <>
          <CallButton label="接听" accept onActivate={() => dispatch({ type: 'call/accept' })} icon="phone" />
          <CallButton label="挂断" danger onActivate={() => dispatch({ type: 'call/end' })} icon="phone-off" />
        </>}
        {active && <>
          <CallButton label={call.micMuted ? '取消静音' : '静音'} selected={call.micMuted}
            onActivate={() => dispatch({ type: 'call/toggleMic' })} icon={call.micMuted ? 'mic-off' : 'mic'} />
          {call.media === 'video' && (
            <CallButton label={call.cameraOff ? '开启摄像头' : '关闭摄像头'} selected={call.cameraOff}
              onActivate={() => dispatch({ type: 'call/toggleCamera' })} icon={call.cameraOff ? 'camera-off' : 'camera'} />
          )}
          <CallButton label="挂断" danger onActivate={() => dispatch({ type: 'call/end' })} icon="phone-off" />
        </>}
      </div>
    </div>
  );
}

function CallButton({ label, icon, onActivate, danger, accept, selected }: {
  label: string; icon: Parameters<typeof IconButton>[0]['iconId']; onActivate: () => void;
  danger?: boolean; accept?: boolean; selected?: boolean;
}) {
  // The IconButton is the single interactive control; the caption beneath is
  // decorative (aria-hidden, the control is already named) — the app composes
  // the dial tile instead of hand-rolling a native button.
  return (
    <span className={`ma-call-btn${danger ? ' is-danger' : ''}${accept ? ' is-accept' : ''}${selected ? ' is-selected' : ''}`}>
      <IconButton actionId={`ma.call.${icon}`} iconId={icon} iconSize={24} label={label}
        aria-pressed={selected} emphasis="quiet" tone={danger ? 'danger' : undefined}
        className="ma-call-btn-icon" onActivate={onActivate} />
      <span className="ma-call-btn-label" aria-hidden="true">{label}</span>
    </span>
  );
}
