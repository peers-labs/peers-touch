import { describe, expect, it } from 'vitest';

import { buildAgentCreateInput } from './agentCreateModel';

const models = [{
  id: 'model-1',
  display_name: 'Model 1',
  provider_id: 'provider-1',
  provider_name: 'Provider 1',
  type: 'chat',
  context_window: 32_768,
  enabled: true,
}];

describe('buildAgentCreateInput', () => {
  it('normalizes transient form values into one create command', () => {
    expect(buildAgentCreateInput({
      avatar: '🤖',
      description: '  Description  ',
      effort: 'medium',
      model: 'model-1',
      name: '  research-agent  ',
      openingQuestions: ' First question \n\nSecond question ',
      pinned: true,
      systemPrompt: '  Be precise  ',
      title: '  Research Agent  ',
      visibility: 'private',
    }, models)).toMatchObject({
      name: 'research-agent',
      title: 'Research Agent',
      description: 'Description',
      systemPrompt: 'Be precise',
      provider: 'provider-1',
      model: 'model-1',
      pinned: true,
      openingQuestions: '["First question","Second question"]',
      workspaceMode: 'agent',
    });
  });
});
