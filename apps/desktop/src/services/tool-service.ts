import {
  api,
  type ToolInfo,
} from './desktop_api';

export type { ToolInfo };

export interface ToolCallRequest {
  name: string;
  args: Record<string, unknown>;
  source?: 'mcp' | 'builtin' | 'plugin';
  serverName?: string;
  callId?: string;
}

export interface ToolCallResult {
  success: boolean;
  output?: string;
  error?: string;
  duration_ms?: number;
}

export class ToolService {
  async list(): Promise<ToolInfo[]> {
    return api.listTools();
  }

  async execute(request: ToolCallRequest): Promise<ToolCallResult> {
    if (request.source === 'plugin') {
      if (!request.serverName) {
        return {
          success: false,
          error: 'tool.error.pluginIdRequired',
        };
      }
      const result = await api.resolveAgentLocalToolRequest({
        source: 'plugin',
        server_name: request.serverName,
        tool_name: request.name,
        arguments: request.args,
        call_id: request.callId,
      });
      return {
        success: result.status === 'success',
        output: result.data === undefined ? undefined : JSON.stringify(result.data),
        error: result.status === 'error' ? JSON.stringify(result.data) : undefined,
      };
    }
    if (request.source === 'mcp' || request.serverName) {
      if (!request.serverName) {
        return {
          success: false,
          error: 'tool.error.mcpServerRequired',
        };
      }
      const result = await api.executeMCPTool(
        request.serverName,
        request.name,
        request.args,
        request.callId,
      );
      return {
        success: result.ok,
        output: result.output === undefined ? undefined : JSON.stringify(result.output),
        error: result.error,
        duration_ms: result.durationMs,
      };
    }
    return {
      success: false,
      error: 'tool.error.builtinExecutionUnsupported',
    };
  }
}

export const toolService = new ToolService();
