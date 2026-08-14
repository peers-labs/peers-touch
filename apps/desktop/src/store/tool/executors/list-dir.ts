import type { ToolExecutor, ToolExecutionRequest, ToolExecutionResult } from '../types';
import { api } from '../../../services/desktop_api';

export const listDirExecutor: ToolExecutor = {
  name: 'list_dir',
  async execute(args: Record<string, unknown>, meta: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const path = String(args.path || '.');
    const limit = typeof args.limit === 'number' ? args.limit : 100;

    try {
      await api.resolveAgentLocalToolRequest({
        source: 'builtin',
        tool_name: 'list_dir',
        arguments: { path, limit },
        call_id: meta.callId,
        turn_id: meta.turnId,
      });
      return { turnId: meta.turnId, callId: meta.callId, content: 'Submitted to Rust BFF', isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list directory';
      return { turnId: meta.turnId, callId: meta.callId, content: message, isError: true };
    }
  },
};
