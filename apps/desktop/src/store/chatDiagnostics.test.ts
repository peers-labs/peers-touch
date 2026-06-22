import { describe, expect, it } from 'vitest';
import { buildAgentTurnDiagnosticsExport } from '../diagnostics/agentTurnDiagnostics';
import { type ChatMessage } from './chat';

describe('Agent turn diagnostics export', () => {
  it('builds replay input and redacts secret-like tool payloads', () => {
    const messages: ChatMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Summarize repository status',
        timestamp: 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Done',
        timestamp: 2,
        toolCalls: [
          {
            id: 'call-1',
            name: 'plugin.github.fetch',
            args: JSON.stringify({ query: 'status', access_token: 'raw-token' }),
            result: JSON.stringify({ ok: true, client_secret: 'raw-secret' }),
            pending: false,
            status: 'success',
          },
        ],
      },
    ];

    const diagnostic = buildAgentTurnDiagnosticsExport({
      sessionKey: 'session-1',
      messages,
      selectedModel: 'gpt-test',
      agent: {
        id: 'agent-1',
        name: 'dev-agent',
        model: 'gpt-test',
        provider: 'openai',
        chatConfig: JSON.stringify({
          tools: ['plugin.github.fetch'],
          skills: ['review'],
          mcpServers: ['local'],
        }),
        knowledgeResources: JSON.stringify([]),
      } as any,
    });

    expect(diagnostic.replay.userInput).toBe('Summarize repository status');
    expect(diagnostic.agent.tools).toEqual(['plugin.github.fetch']);
    expect(diagnostic.latestAssistant?.toolCalls[0].args).toContain('[redacted]');
    expect(diagnostic.latestAssistant?.toolCalls[0].args).not.toContain('raw-token');
    expect(diagnostic.latestAssistant?.toolCalls[0].result).toContain('[redacted]');
    expect(diagnostic.latestAssistant?.toolCalls[0].result).not.toContain('raw-secret');
  });
});
