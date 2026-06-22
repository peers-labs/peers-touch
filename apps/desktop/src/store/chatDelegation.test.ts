import { describe, expect, it } from 'vitest';
import { applyStreamEvent, parseDelegationResults, type ChatMessage } from './chat';

function assistantMessage(): ChatMessage {
  return {
    id: 'msg-delegation-test',
    role: 'assistant',
    content: '',
    timestamp: 1781680000000,
    toolCalls: [{
      id: 'tool-delegate-1',
      name: 'delegate_task',
      args: '{"TaskID":"research"}',
      pending: true,
      status: 'pending',
    }],
  };
}

describe('chat delegation diagnostics', () => {
  it('parses Station delegation results from Go JSON fields', () => {
    const results = parseDelegationResults(JSON.stringify([{
      TaskID: 'research',
      ParentTurnID: 'turn-parent',
      TaskDescription: 'Research provider fallback',
      ChildToolset: ['skill_view', 'local_file_read'],
      Status: 'completed',
      ResultSummary: 'Fallback path is covered.',
      ToolIterations: 2,
      StartedAt: '2026-06-17T00:00:00Z',
      EndedAt: '2026-06-17T00:00:03Z',
    }]));

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      taskId: 'research',
      parentTurnId: 'turn-parent',
      taskDescription: 'Research provider fallback',
      childToolset: ['skill_view', 'local_file_read'],
      status: 'completed',
      resultSummary: 'Fallback path is covered.',
      toolIterations: 2,
    });
  });

  it('projects delegate_task tool results onto the parent assistant message', () => {
    const message = applyStreamEvent(assistantMessage(), {
      event: 'tool_result',
      data: {
        id: 'tool-delegate-1',
        name: 'delegate_task',
        content: JSON.stringify([{
          TaskID: 'research',
          TaskDescription: 'Research provider fallback',
          ChildToolset: ['skill_view'],
          Status: 'failed',
          ResultSummary: 'Provider fallback returned an error.',
          ToolIterations: 1,
        }]),
      },
    });

    expect(message.toolCalls?.[0]).toMatchObject({
      pending: false,
      status: 'success',
      delegationResults: [{
        taskId: 'research',
        taskDescription: 'Research provider fallback',
        status: 'failed',
        resultSummary: 'Provider fallback returned an error.',
      }],
    });
    expect(message.delegationResults?.[0].status).toBe('failed');
  });
});
