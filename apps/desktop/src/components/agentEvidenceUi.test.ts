import { readFileSync } from 'node:fs';
import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import { selectAgentCapabilityWarning } from './composer/agentCapabilityWarning';
import { agentAttachmentDraftsBlockSend } from './composer/useAgentAttachmentDrafts';
import { collectSourceAttributions } from './messages/SourceAttributionBadges';
import {
  acceptTurnDiagnostics,
  turnDiagnosticsExportFilename,
} from './portal/views/TurnDetailsView';
import {
  BUDGET_ERROR_TYPE,
  projectAgentTypedError,
  projectBudgetNotice,
  reduceStreamEvent,
} from '../store/streaming/handler';
import {
  AGENT_ATTACHMENT_REJECTED_ERROR_TYPE,
  AGENT_CONTEXT_LIMIT_ERROR_TYPE,
} from '../services/desktop_api';
import type { ChatMessage } from '../store/chat';
import {
  RuntimeCapabilitySnapshotSchema,
  type ExportTurnDiagnosticsResponse,
} from '../gen/proto/domain/agent/agent_pb';
import { CapabilityReadinessSnapshotSchema } from '../gen/proto/domain/agent/capability_pb';

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
      retryable: false,
      terminal: true,
      details: {
        turn_id: 'turn-1',
        budget_kind: 'tool_calls',
        limit: '4',
      },
    };

    expect(projectBudgetNotice(data)).toEqual({
      kind: 'tool_calls',
      turnId: 'turn-1',
      limit: '4',
      localeKey: 'agent.errors.toolLoopBudgetExhausted',
    });
    expect(reduceStreamEvent(assistantMessage, { event: 'error', data }))
      .toMatchObject({
        budgetNotice: {
          kind: 'tool_calls',
          turnId: 'turn-1',
          limit: '4',
        },
        resolution: {
          type: 'inspectBudget',
          turnId: 'turn-1',
        },
      });
  });

  it('does not infer budget recovery from a legacy terminal reason', () => {
    expect(projectBudgetNotice({
      error: 'agent.errors.toolLoopBudgetExhausted',
      error_type: BUDGET_ERROR_TYPE,
      locale_key: 'agent.errors.toolLoopBudgetExhausted',
      retryable: false,
      terminal: true,
      details: {
        reason: 'max_tool_calls_exhausted',
        limit: '4',
        consumed: '4',
      },
    })).toBeUndefined();
  });

  it('preserves typed attachment rejection details on the receiver message', () => {
    const data = {
      error: 'agent.errors.attachmentRejected',
      error_type: AGENT_ATTACHMENT_REJECTED_ERROR_TYPE,
      locale_key: 'agent.errors.attachmentRejected',
      retryable: false,
      terminal: true,
      details: {
        attachment_id: 'attachment-1',
        reason_code: 'attachment_content_does_not_match_mime',
      },
    };

    expect(projectAgentTypedError(data)).toEqual(data);
    expect(reduceStreamEvent(assistantMessage, { event: 'error', data }))
      .toMatchObject({
        error: 'agent.errors.attachmentRejected',
        typedError: data,
        terminalStatus: 'failed',
        loading: false,
      });
  });

  it('projects typed context overflow details onto the receiver message', () => {
    const data = {
      error: 'agent.errors.contextOverflow',
      error_type: AGENT_CONTEXT_LIMIT_ERROR_TYPE,
      locale_key: 'agent.errors.contextOverflow',
      retryable: false,
      terminal: true,
      details: {
        limit_tokens: '128',
        actual_tokens: '129',
      },
    };

    expect(projectAgentTypedError(data)).toEqual(data);
    expect(reduceStreamEvent(assistantMessage, { event: 'error', data }))
      .toMatchObject({
        error: 'agent.errors.contextOverflow',
        typedError: data,
        terminalStatus: 'failed',
        loading: false,
      });
  });

  it('keeps a Station-rejected attachment blocked until removal', () => {
    expect(agentAttachmentDraftsBlockSend([{ status: 'rejected' }])).toBe(true);
    expect(agentAttachmentDraftsBlockSend([{ status: 'ready' }])).toBe(false);
  });

  it('blocks image submission only when Station readiness lacks vision', () => {
    const attachment = {
      cid: 'attachment-1',
      filename: 'proof.png',
      mime_type: 'image/png',
      size: 10,
    };
    const withoutVision = create(CapabilityReadinessSnapshotSchema, {
      modelCapabilities: create(RuntimeCapabilitySnapshotSchema, {
        input: { image: false },
      }),
    });
    const withVision = create(CapabilityReadinessSnapshotSchema, {
      modelCapabilities: create(RuntimeCapabilitySnapshotSchema, {
        input: { image: true },
      }),
    });

    expect(selectAgentCapabilityWarning(withoutVision, [attachment])).toMatchObject({
      kind: 'image_input_unsupported',
      blocking: true,
    });
    expect(selectAgentCapabilityWarning(withVision, [attachment])).toBeNull();
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
    const desktopApi = readFileSync(new URL('../services/desktop_api.ts', import.meta.url), 'utf8');
    const sources = readFileSync(new URL('./messages/SourceAttributionBadges.tsx', import.meta.url), 'utf8');
    const composer = readFileSync(new URL('./ChatInput.tsx', import.meta.url), 'utf8');
    const attachments = readFileSync(new URL('./composer/AttachmentStage.tsx', import.meta.url), 'utf8');
    const details = readFileSync(new URL('./portal/views/TurnDetailsView.tsx', import.meta.url), 'utf8');

    expect(assistant).toContain('data-budget-notice');
    expect(assistant).toContain('data-pt-agent-message-error-text');
    expect(assistant).toContain(
      '<div data-pt-agent-message-error-text={message.error}>{presentedError}</div>',
    );
    expect(assistant).toContain('data-pt-agent-terminal-status');
    expect(assistant).toContain('data-pt-agent-error-resource-kind');
    expect(assistant).toContain('data-pt-agent-error-resource-id');
    expect(assistant).toContain('data-pt-agent-error-capability-id');
    expect(assistant).toContain('data-pt-agent-error-turn-id');
    expect(assistant).toContain('data-pt-agent-error-reason-code');
    expect(assistant).toContain('data-pt-agent-message-error-recovery');
    expect(assistant).toContain('data-pt-agent-message-error-recovery="reduce-context"');
    expect(assistant).toContain("'choose-compatible-model'");
    expect(assistant).toContain("'switch-account'");
    expect(assistant).toContain("'open-original'");
    expect(assistant).toContain("'recover'");
    expect(assistant).toContain('handleOpenOriginal');
    expect(assistant).toContain('handleChooseCompatibleModel');
    expect(assistant).toContain("message.resolution!.type === 'recover'");
    expect(assistant).toContain('await handleRetry()');
    expect(assistant).toContain("setAgentSurface(activeAgent.name, 'profile')");
    expect(assistant).toContain("resource: 'sessions'");
    expect(assistant).toContain('<LogOut size={14} />');
    expect(assistant).toContain('await identityRuntime.logout()');
    expect(composer).toContain('data-pt-agent-runtime-snapshot');
    expect(composer).toContain('data-pt-agent-readiness-snapshot');
    expect(composer).toContain('data-pt-agent-readiness-state');
    expect(composer).toContain('data-pt-agent-model-compatibility');
    expect(composer).toContain('data-pt-agent-selected-provider');
    expect(composer).toContain('data-pt-agent-selected-model');
    expect(composer).toContain('!latestReadiness.canSend');
    expect(desktopApi).toContain("label: 'agent.recovery.chooseCompatibleModel'");
    expect(desktopApi).toContain("label: 'agent.recovery.switchAccount'");
    expect(desktopApi).toContain("label: 'agent.recovery.recover'");
    expect(assistant).toContain('agent.recovery.reduceContext');
    expect(assistant).toContain("ns: 'agent'");
    expect(sources).toContain('data-source-badges');
    expect(sources).toContain('data-source-badge');
    expect(composer).toContain('data-agent-capability-warning');
    expect(composer).toContain('data-pt-agent-attachment-input');
    expect(composer).toContain('composerFocusNonce');
    expect(attachments).toContain('data-pt-agent-composer-attachment-status');
    expect(attachments).toContain('data-pt-agent-composer-attachment-remove');
    expect(details).toContain('data-turn-details');
    expect(details).toContain('data-turn-diagnostics-export');
    expect(details).toContain('requestId !== loadRequestRef.current');
  });

  it('mounts the Connector projection on the Agent capability surface', () => {
    const profile = readFileSync(
      new URL('../pages/AgentProfilePage.tsx', import.meta.url),
      'utf8',
    );

    expect(profile).toContain(
      "import { AgentConnectorsPanel } from '../components/agent/AgentConnectorsPanel';",
    );
    expect(profile).toContain('<AgentConnectorsPanel agentId={agent.id} />');
  });
});
