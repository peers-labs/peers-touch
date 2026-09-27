import { invoke } from '@tauri-apps/api/core';

export type ReliabilityAcceptanceFaultMode =
  | 'none'
  | 'hold-before-dispatch'
  | 'lose-dispatch-response-and-readback'
  | 'fail-checkpoint-acknowledgement';

export interface ReliabilityAcceptanceFaultProjection {
  readonly mode: ReliabilityAcceptanceFaultMode;
}

export async function configureReliabilityAcceptanceFault(
  mode: ReliabilityAcceptanceFaultMode,
): Promise<ReliabilityAcceptanceFaultProjection> {
  return invoke<ReliabilityAcceptanceFaultProjection>(
    'reliability_acceptance_configure_fault',
    { input: { mode } },
  );
}
