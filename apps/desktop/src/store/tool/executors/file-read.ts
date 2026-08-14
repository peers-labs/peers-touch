import type { ToolExecutor, ToolExecutionRequest, ToolExecutionResult } from '../types';
import { api } from '../../../services/desktop_api';

export const fileReadExecutor: ToolExecutor = {
  name: 'file_read',
  async execute(args: Record<string, unknown>, meta: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const path = String(args.path || '');
    if (!path) {
      return { turnId: meta.turnId, callId: meta.callId, content: 'Missing required argument: path', isError: true };
    }

    try {
      await api.resolveAgentLocalToolRequest({
        source: 'builtin',
        tool_name: 'file_read',
        arguments: { path, max_bytes: typeof args.max_bytes === 'number' ? args.max_bytes : 100000 },
        call_id: meta.callId,
        turn_id: meta.turnId,
      });
      return { turnId: meta.turnId, callId: meta.callId, content: 'Submitted to Rust BFF', isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read file';
      return { turnId: meta.turnId, callId: meta.callId, content: message, isError: true };
    }
  },
};
