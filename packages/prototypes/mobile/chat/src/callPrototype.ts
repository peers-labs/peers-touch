export type PrototypeCallState =
  | 'outgoing'
  | 'ringing_all_devices'
  | 'incoming'
  | 'active_here'
  | 'reconnecting'
  | 'handled_elsewhere'
  | 'ended';

export type PrototypeCallMediaKind = 'audio' | 'video';

export type PrototypeCallScenario =
  | 'call-outgoing-audio'
  | 'call-incoming-video'
  | 'call-active-audio'
  | 'call-active-video'
  | 'call-reconnecting'
  | 'call-handled-elsewhere'
  | 'call-ended';

export interface PrototypeCallSnapshot {
  state: PrototypeCallState;
  mediaKind: PrototypeCallMediaKind;
  peerName: string;
  peerInitials: string;
  winningDeviceLabel?: string;
  micMuted?: boolean;
  cameraOff?: boolean;
}

export const callEvidenceScenarioOptions: Array<{
  label: string;
  value: PrototypeCallScenario;
}> = [
  { label: 'Call / outgoing audio', value: 'call-outgoing-audio' },
  { label: 'Call / incoming video', value: 'call-incoming-video' },
  { label: 'Call / active audio', value: 'call-active-audio' },
  { label: 'Call / active video', value: 'call-active-video' },
  { label: 'Call / reconnecting', value: 'call-reconnecting' },
  { label: 'Call / handled elsewhere', value: 'call-handled-elsewhere' },
  { label: 'Call / ended', value: 'call-ended' },
];

const CALL_SCENARIOS = new Set<PrototypeCallScenario>(
  callEvidenceScenarioOptions.map(({ value }) => value),
);

export function isPrototypeCallScenario(
  value: string,
): value is PrototypeCallScenario {
  return CALL_SCENARIOS.has(value as PrototypeCallScenario);
}

export function callSnapshotForScenario(
  scenario: PrototypeCallScenario,
  peerName = 'Alice Chen',
  peerInitials = 'AC',
): PrototypeCallSnapshot {
  const base = { peerName, peerInitials };
  switch (scenario) {
    case 'call-outgoing-audio':
      return { ...base, state: 'outgoing', mediaKind: 'audio' };
    case 'call-incoming-video':
      return { ...base, state: 'incoming', mediaKind: 'video' };
    case 'call-active-audio':
      return { ...base, state: 'active_here', mediaKind: 'audio' };
    case 'call-active-video':
      return { ...base, state: 'active_here', mediaKind: 'video' };
    case 'call-reconnecting':
      return { ...base, state: 'reconnecting', mediaKind: 'video' };
    case 'call-handled-elsewhere':
      return {
        ...base,
        state: 'handled_elsewhere',
        mediaKind: 'audio',
        winningDeviceLabel: "Alice's Mac",
      };
    case 'call-ended':
      return { ...base, state: 'ended', mediaKind: 'audio' };
  }
}
