import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  agentIdFromDraftKey,
  createAgentDraftKey,
  isAgentDraftKey,
} from './agentDraft';

const chatSource = readFileSync(new URL('./chat.ts', import.meta.url), 'utf8');

describe('Agent draft identity', () => {
  it('uses one Agent-id-scoped key format', () => {
    const key = createAgentDraftKey('agent_123', 'nonce');
    expect(key).toBe('draft:agent_123:nonce');
    expect(isAgentDraftKey(key)).toBe(true);
    expect(agentIdFromDraftKey(key)).toBe('agent_123');
  });

  it('round-trips encoded Agent identities', () => {
    const key = createAgentDraftKey('station:agent/123', 'nonce');
    expect(agentIdFromDraftKey(key)).toBe('station:agent/123');
  });

  it('rejects legacy and durable conversation keys', () => {
    expect(isAgentDraftKey('agent:assistant:123')).toBe(false);
    expect(isAgentDraftKey('session-123')).toBe(false);
    expect(isAgentDraftKey('conversation_123')).toBe(false);
  });

  it('runs Agent readiness admission before optimistic message creation', () => {
    const sendStart = chatSource.indexOf('sendMessage: (content');
    const executionCheck = chatSource.indexOf('resolveAgentExecutionID(agentName)', sendStart);
    const optimisticMessage = chatSource.indexOf('const userMsg: ChatMessage', sendStart);
    expect(executionCheck).toBeGreaterThan(sendStart);
    expect(executionCheck).toBeLessThan(optimisticMessage);
  });

  it('records one draft promotion before replacing Topic identity', () => {
    expect(chatSource).toContain('draftPromotions[currentSessionKey]');
    expect(chatSource).toContain('promoteDraftTopic(agentId, currentSessionKey, promotedSession)');
  });
});
