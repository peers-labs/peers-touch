import {
  getPolicy,
  runSession,
  type CollaborationInput,
  type Round,
  type SessionTrace,
  type Turn,
} from './engine';

export const PROTOTYPE_ENGINE_TRACE_DISCLOSURE = 'Prototype-only local trace；真实编排归 Station';

export interface PrototypeEngineTraceProjectionView {
  trace: SessionTrace;
  reached: boolean;
  roundCount: number;
  speakerCount: number;
  disclosure: typeof PROTOTYPE_ENGINE_TRACE_DISCLOSURE;
}

export interface PrototypeEngineTraceTurnView {
  turn: Turn;
  noEvidenceObjection: boolean;
}

export interface PrototypeEngineTraceRoundView {
  round: Round;
  layout: 'parallelGrid' | 'serialChain';
  gridTemplateColumns: string;
}

export function derivePrototypeEngineTraceProjectionView(input: {
  collaboration: CollaborationInput;
  engineId: string;
}): PrototypeEngineTraceProjectionView | null {
  const policy = getPolicy(input.engineId);
  if (!policy) return null;

  const trace = runSession(policy, input.collaboration);
  return {
    trace,
    reached: trace.result.phase === 'reached',
    roundCount: trace.rounds.length,
    speakerCount: trace.rounds.reduce((count, round) => count + round.turns.length, 0),
    disclosure: PROTOTYPE_ENGINE_TRACE_DISCLOSURE,
  };
}

export function derivePrototypeEngineTraceTurnView(turn: Turn): PrototypeEngineTraceTurnView {
  return {
    turn,
    noEvidenceObjection: turn.stance === 'objection' && !turn.evidenceRef,
  };
}

export function derivePrototypeEngineTraceRoundView(round: Round): PrototypeEngineTraceRoundView {
  return {
    round,
    layout: round.mode === 'parallel' ? 'parallelGrid' : 'serialChain',
    gridTemplateColumns: round.mode === 'parallel' && round.turns.length >= 2 ? '1fr 1fr' : '1fr',
  };
}
