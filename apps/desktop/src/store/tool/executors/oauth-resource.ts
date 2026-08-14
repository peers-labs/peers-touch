import type { ToolExecutor, ToolExecutionRequest, ToolExecutionResult } from '../types';
import { api } from '../../../services/desktop_api';

export const oauthResourceExecutor: ToolExecutor = {
  name: 'oauth_resource',
  async execute(args: Record<string, unknown>, meta: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const providerId = String(args.provider_id || '');
    const resource = String(args.resource || '');
    if (!providerId || !resource) {
      return { turnId: meta.turnId, callId: meta.callId, content: 'Missing required arguments: provider_id, resource', isError: true };
    }

    try {
      await api.resolveAgentLocalToolRequest({
        source: 'builtin',
        tool_name: 'oauth_resource',
        arguments: { provider_id: providerId, resource, params: args.params || {} },
        call_id: meta.callId,
        turn_id: meta.turnId,
      });
      return { turnId: meta.turnId, callId: meta.callId, content: 'Submitted to Rust BFF', isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to access OAuth resource';
      return { turnId: meta.turnId, callId: meta.callId, content: message, isError: true };
    }
  },
};
