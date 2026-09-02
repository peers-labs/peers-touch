import { describe, expect, it } from 'vitest';
import {
  AGENT_CANVAS_SINGLE_AGENT_NOT_READY,
  AGENT_CANVAS_SINGLE_AGENT_NOT_READY_LOCALE_KEY,
  AGENT_CANVAS_SINGLE_AGENT_NOT_READY_REQUIRED_GATE,
  enforce_canvas_single_agent_readiness,
} from './agentCanvasReadinessGuard';

describe('Agent Canvas single-Agent readiness guard', () => {
  it('returns the permanent typed D11 blocker', () => {
    expect(enforce_canvas_single_agent_readiness()).toMatchObject({
      error: AGENT_CANVAS_SINGLE_AGENT_NOT_READY_LOCALE_KEY,
      errorType: AGENT_CANVAS_SINGLE_AGENT_NOT_READY,
      localeKey: AGENT_CANVAS_SINGLE_AGENT_NOT_READY_LOCALE_KEY,
      retryable: false,
      terminal: true,
      details: {
        required_gate: AGENT_CANVAS_SINGLE_AGENT_NOT_READY_REQUIRED_GATE,
      },
    });
  });
});
