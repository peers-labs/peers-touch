import { create } from '@bufbuild/protobuf';
import { ErrorPayloadSchema } from '../gen/proto/domain/agent/turn_stream_pb';

export const AGENT_CANVAS_SINGLE_AGENT_NOT_READY =
  'AGENT_CANVAS_SINGLE_AGENT_NOT_READY';
export const AGENT_CANVAS_SINGLE_AGENT_NOT_READY_LOCALE_KEY =
  'agent.errors.canvasSingleAgentNotReady';
export const AGENT_CANVAS_SINGLE_AGENT_NOT_READY_REQUIRED_GATE =
  'agent-v2-kernel-foundation-e2e';

// The snake_case name is the cross-runtime D11 audit marker.
export function enforce_canvas_single_agent_readiness() {
  return create(ErrorPayloadSchema, {
    error: AGENT_CANVAS_SINGLE_AGENT_NOT_READY_LOCALE_KEY,
    errorType: AGENT_CANVAS_SINGLE_AGENT_NOT_READY,
    localeKey: AGENT_CANVAS_SINGLE_AGENT_NOT_READY_LOCALE_KEY,
    retryable: false,
    terminal: true,
    details: {
      required_gate: AGENT_CANVAS_SINGLE_AGENT_NOT_READY_REQUIRED_GATE,
    },
  });
}
