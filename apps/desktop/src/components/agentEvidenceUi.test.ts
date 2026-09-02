import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { selectAgentCapabilityWarning } from './composer/agentCapabilityWarning';
import { collectSourceAttributions } from './messages/SourceAttributionBadges';
import {
  acceptTurnDiagnostics,
  turnDiagnosticsExportFilename,
} from './portal/views/TurnDetailsView';
import {
  BUDGET_ERROR_TYPE,
  projectBudgetNotice,
  reduceStreamEvent,
} from '../store/streaming/handler';
import type { AvailableModel } from '../services/desktop_api';
import type { ChatMessage } from '../store/chat';
import type { ExportTurnDiagnosticsResponse } from '../gen/proto/domain/agent/agent_pb';

const model: AvailableModel = {
  id: 'text-model',
  display_name: 'Text model',
  provider_id: 'provider',
  provider_name: 'Provider',
  type: 'chat',
  context_window: 8192,
  enabled: true,
  vision: false,
};

const assistantMessage: ChatMessage = {
  id: 'message-1',
  role: 'assistant',
  content: '',
  timestamp: 1,
  turnId: 'turn-1',
};

describe('Agent evidence UI projections', () => {
  it('deduplicates visible source attribution by authoritative source identity', () => {
    expect(collectSourceAttributions({
      knowledgeChunks: [
        {
          chunkId: 'chunk-1',
          resourceId: 'resource-1',
          resourceTitle: 'Architecture',
          source: 'knowledge',
          chunkIndex: 0,
          score: 0.9,
          contentPreview: '',
        },
        {
          chunkId: 'chunk-2',
          resourceId: 'resource-1',
          resourceTitle: 'Architecture',
          source: 'knowledge',
          chunkIndex: 1,
          score: 0.8,
          contentPreview: '',
        },
      ],
      attachments: [],
    })).toEqual([{
      id: 'resource-1',
      type: 'knowledge',
      label: 'Architecture',
    }]);
  });

  it('projects typed budget exhaustion details onto the affected message', () => {
    const data = {
      error: 'agent.errors.toolLoopBudgetExhausted',
      error_type: BUDGET_ERROR_TYPE,
      locale_key: 'agent.errors.toolLoopBudgetExhausted',
      details: {
        reason: 'max_tool_calls_exhausted',
        limit: '4',
        consumed: '4',
      },
    };

    expect(projectBudgetNotice(data)).toMatchObject({
      kind: 'tool_calls',
      limit: '4',
      consumed: '4',
    });
    expect(reduceStreamEvent(assistantMessage, { event: 'error', data }).budgetNotice)
      .toMatchObject({ kind: 'tool_calls' });
  });

  it('blocks image submission only when the selected model explicitly lacks vision', () => {
    const attachment = {
      cid: 'attachment-1',
      filename: 'proof.png',
      mime_type: 'image/png',
      size: 10,
    };

    expect(selectAgentCapabilityWarning(model, [attachment])).toMatchObject({
      kind: 'image_input_unsupported',
      blocking: true,
    });
    expect(selectAgentCapabilityWarning({ ...model, vision: true }, [attachment])).toBeNull();
  });

  it('rejects mismatched diagnostics and exports with the loaded replay identity', () => {
    const diagnostics = {
      replay: { turnId: 'turn-loaded' },
    } as ExportTurnDiagnosticsResponse;

    expect(() => acceptTurnDiagnostics('turn-requested', diagnostics))
      .toThrow('agent.error.turnDiagnosticsIdentityMismatch');
    expect(acceptTurnDiagnostics('turn-loaded', diagnostics)).toBe(diagnostics);
    expect(turnDiagnosticsExportFilename(diagnostics))
      .toBe('turn-turn-loaded-diagnostics.json');
  });

  it('keeps stable proof selectors on all four user-facing surfaces', () => {
    const assistant = readFileSync(new URL('./messages/AssistantMessage.tsx', import.meta.url), 'utf8');
    const sources = readFileSync(new URL('./messages/SourceAttributionBadges.tsx', import.meta.url), 'utf8');
    const composer = readFileSync(new URL('./ChatInput.tsx', import.meta.url), 'utf8');
    const details = readFileSync(new URL('./portal/views/TurnDetailsView.tsx', import.meta.url), 'utf8');

    expect(assistant).toContain('data-budget-notice');
    expect(sources).toContain('data-source-badges');
    expect(sources).toContain('data-source-badge');
    expect(composer).toContain('data-agent-capability-warning');
    expect(details).toContain('data-turn-details');
    expect(details).toContain('data-turn-diagnostics-export');
    expect(details).toContain('requestId !== loadRequestRef.current');
  });
});
