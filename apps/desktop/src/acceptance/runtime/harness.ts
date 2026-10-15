import { invoke } from '@tauri-apps/api/core';
import { registerAcceptanceHarness } from '../registry';
import { rendererArtifactSha256, resetRendererArtifactDigest } from './rendererArtifact';

declare const __PT_SOURCE_COMMIT__: string;

interface NativeSourceIdentity {
  sourceCommit: string;
  processId: number;
  executableSha256: string;
}

export function installAcceptanceHarness(): void {
  resetRendererArtifactDigest();
  registerAcceptanceHarness('runtime', {
    async sourceIdentity() {
      const result = await invoke<{
        ok: boolean;
        data?: NativeSourceIdentity;
        error?: { message?: string };
      }>('acceptance_runtime_source_identity');
      const identity = result.data;
      if (!result.ok || !identity) {
        throw new Error(result.error?.message || 'runtime.acceptance.sourceIdentityMissing');
      }
      if (
        identity.sourceCommit !== __PT_SOURCE_COMMIT__
        || !Number.isSafeInteger(identity.processId)
        || identity.processId < 1
        || !/^[0-9a-f]{64}$/.test(identity.executableSha256)
      ) {
        throw new Error('runtime.acceptance.sourceIdentityMismatch');
      }
      return {
        ...identity,
        rendererArtifactSha256: await rendererArtifactSha256(),
      };
    },
  });
}
