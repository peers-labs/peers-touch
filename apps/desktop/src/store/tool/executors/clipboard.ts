import type { ToolExecutor, ToolExecutionRequest, ToolExecutionResult } from '../types';
import { api } from '../../../services/desktop_api';

export const clipboardExecutor: ToolExecutor = {
  name: 'clipboard_read',
  async execute(_args: Record<string, unknown>, meta: ToolExecutionRequest): Promise<ToolExecutionResult> {
    try {
      await api.resolveAgentLocalToolRequest({
        source: 'builtin',
        tool_name: 'clipboard_read',
        arguments: {},
        call_id: meta.callId,
        turn_id: meta.turnId,
      });
      return { turnId: meta.turnId, callId: meta.callId, content: 'Submitted to Rust BFF', isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read clipboard';
      return { turnId: meta.turnId, callId: meta.callId, content: message, isError: true };
    }
  },
};
