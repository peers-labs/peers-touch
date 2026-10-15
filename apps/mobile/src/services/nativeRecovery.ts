import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';
import type { MobileAuthSession } from '../features/auth/authSession';
import {
  MobileRecoveryAction, MobileRecoveryRequestSchema, MobileRecoveryResultSchema,
} from '../gen/proto/domain/mobile/security_pb';
import { AgentSettingsError } from './gateways/agentSettingsRpc';

export { MobileRecoveryAction };

export async function executeNativeRecovery(session: MobileAuthSession, action: MobileRecoveryAction) {
  const requestBytes = Array.from(toBinary(MobileRecoveryRequestSchema, create(MobileRecoveryRequestSchema, {
    stationPeerId: session.stationPeerId,
    actorPtid: session.actorRef.ptid,
    sessionId: session.sessionId,
    lifecycleGeneration: BigInt(session.lifecycleGeneration),
    action,
  })));
  try {
    const response = await invoke<number[]>('mobile_recovery_execute', { requestBytes });
    return fromBinary(MobileRecoveryResultSchema, Uint8Array.from(response));
  } catch (failure) {
    const code = failure && typeof failure === 'object' && 'code' in failure ? String(failure.code) : '';
    throw new AgentSettingsError(0, code === 'MOBILE_SECURE_INPUT_CANCELLED'
      ? 'mobile.settings.security.recoveryCancelled' : 'mobile.settings.security.recoveryFailed');
  }
}
