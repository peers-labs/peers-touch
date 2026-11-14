import { invoke } from '@tauri-apps/api/core';
import type { SystemActionOutcome } from './platformContracts';

/** One native clipboard port for credentials and message-copy controls. */
export const mobileClipboard = {
  async writeText(text: string): Promise<void> {
    const outcome = await invoke<SystemActionOutcome>('system_action_execute', {
      action: { kind: 'copy_text', text },
    });
    if (outcome.state !== 'completed') throw new Error('mobile.settings.credentials.copyFailed');
  },
};
