import { createDesktopStore } from '../createDesktopStore';
import { toolRegistry } from './registry';
import { shouldAutoApprove, shouldDeny } from './approval';
import { api } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import type { ToolExecutionRequest, PendingToolCall, ToolCallStatus } from './types';
import { fileReadExecutor } from './executors/file-read';
import { listDirExecutor } from './executors/list-dir';
import { clipboardExecutor } from './executors/clipboard';
import { oauthResourceExecutor } from './executors/oauth-resource';

toolRegistry.register(fileReadExecutor);
toolRegistry.register(listDirExecutor);
toolRegistry.register(clipboardExecutor);
toolRegistry.register(oauthResourceExecutor);

const APPROVAL_TIMEOUT_MS = 110_000;

interface ToolState {
  pendingCalls: Record<string, PendingToolCall>;

  handleToolRequest: (request: ToolExecutionRequest) => void;
  approveToolCall: (callId: string) => void;
  denyToolCall: (callId: string) => void;
}

export const useToolStore = createDesktopStore<ToolState>('tool', (set, get) => ({
  pendingCalls: {},

  handleToolRequest: (request: ToolExecutionRequest) => {
    if (shouldDeny(request)) {
      submitDenial(request, 'Tool is disabled by policy');
      return;
    }

    if (shouldAutoApprove(request)) {
      executeViaRegistry(request, set);
      return;
    }

    set((s) => ({
      pendingCalls: {
        ...s.pendingCalls,
        [request.callId]: { request, status: 'pending_approval' as ToolCallStatus, startedAt: Date.now() },
      },
    }));

    setTimeout(() => {
      const pending = get().pendingCalls[request.callId];
      if (pending && pending.status === 'pending_approval') {
        set((s) => ({
          pendingCalls: {
            ...s.pendingCalls,
            [request.callId]: { ...pending, status: 'timed_out' },
          },
        }));
        submitDenial(request, 'Tool approval timed out');
      }
    }, APPROVAL_TIMEOUT_MS);
  },

  approveToolCall: (callId: string) => {
    const pending = get().pendingCalls[callId];
    if (!pending || pending.status !== 'pending_approval') return;
    executeViaRegistry(pending.request, set);
  },

  denyToolCall: (callId: string) => {
    const pending = get().pendingCalls[callId];
    if (!pending || pending.status !== 'pending_approval') return;
    set((s) => ({
      pendingCalls: {
        ...s.pendingCalls,
        [callId]: { ...pending, status: 'denied' },
      },
    }));
    submitDenial(pending.request, 'Tool execution denied by user');
  },
}));

async function executeViaRegistry(
  request: ToolExecutionRequest,
  set: (fn: (s: ToolState) => Partial<ToolState>) => void,
): Promise<void> {
  set((s) => ({
    pendingCalls: {
      ...s.pendingCalls,
      [request.callId]: { request, status: 'executing', startedAt: Date.now() },
    },
  }));

  const result = await toolRegistry.execute(request);

  set((s) => ({
    pendingCalls: {
      ...s.pendingCalls,
      [request.callId]: {
        request,
        status: result.isError ? 'error' : 'completed',
        startedAt: s.pendingCalls[request.callId]?.startedAt ?? Date.now(),
        result,
      },
    },
  }));
}

function submitDenial(request: ToolExecutionRequest, _reason: string): void {
  api.resolveAgentLocalToolRequest({
    source: 'builtin',
    tool_name: request.toolName,
    arguments: {},
    call_id: request.callId,
    turn_id: request.turnId,
  }).catch((err) => {
    log.error('Failed to submit tool denial', err);
  });
}

export { toolRegistry } from './registry';
export type { ToolExecutionRequest, ToolExecutionResult, PendingToolCall, ToolCallStatus, ToolApprovalPolicy, ToolDefinition, ToolExecutor } from './types';
