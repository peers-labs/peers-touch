import type {
  ExportTurnDiagnosticsResponse,
  ListTurnFeedbackResponse,
  RecordFeedbackResponse,
} from '../gen/proto/domain/agent/agent_pb';
import { api, submitAgentFeedback } from '../services/desktop_api';

export function loadAgentTurnDiagnostics(
  turnId: string,
): Promise<ExportTurnDiagnosticsResponse> {
  return api.exportAgentTurnDiagnostics(turnId);
}

export function loadAgentTurnFeedback(
  turnId: string,
): Promise<ListTurnFeedbackResponse> {
  return api.listAgentTurnFeedback(turnId);
}

export function recordAgentTurnFeedback(input: {
  agentId: string;
  turnId: string;
  conversationId: string;
  assistantMessageId: string;
  signal: 'positive' | 'negative';
  categories?: string[];
  comment?: string;
  idempotencyKey?: string;
}): Promise<RecordFeedbackResponse> {
  return submitAgentFeedback(
    input.agentId,
    input.turnId,
    input.conversationId,
    input.signal,
    input.comment,
    {
      assistantMessageId: input.assistantMessageId,
      categories: input.categories,
      idempotencyKey: input.idempotencyKey,
      source: 'message_action',
    },
  );
}
