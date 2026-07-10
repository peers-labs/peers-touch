import { ATELIER_PROJECTION_DISPLAY_LIMITS } from './projection.contract.generated';
import type { NegoBlock, NegoVoice } from './types';

export interface PrototypeNegotiationVoiceView {
  voice: NegoVoice;
  noEvidenceObjection: boolean;
}

export interface PrototypeNegotiationProjectionView {
  statusLabel: '已收敛' | '未收敛';
  statusTone: 'success' | 'warning';
  visibleVoiceViews: PrototypeNegotiationVoiceView[];
  hiddenVoiceCount: number;
  hasConsensus: boolean;
}

export function derivePrototypeNegotiationProjectionView(
  block: NegoBlock,
): PrototypeNegotiationProjectionView {
  const visibleVoices = block.voices.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.negotiationVoices);
  return {
    statusLabel: block.converged ? '已收敛' : '未收敛',
    statusTone: block.converged ? 'success' : 'warning',
    visibleVoiceViews: visibleVoices.map((voice) => ({
      voice,
      noEvidenceObjection: voice.stance === 'objection' && !voice.evidenceRef,
    })),
    hiddenVoiceCount: Math.max(0, block.voices.length - visibleVoices.length),
    hasConsensus: block.consensus.trim().length > 0,
  };
}
