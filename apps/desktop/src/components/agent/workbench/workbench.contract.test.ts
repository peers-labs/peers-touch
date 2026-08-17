import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(
  new URL('../../../pages/AgentChatPage.tsx', import.meta.url),
  'utf8',
);
const sidebarSource = readFileSync(new URL('../../AgentSidebar.tsx', import.meta.url), 'utf8');
const topicRuntimeSource = readFileSync(
  new URL('../../../runtimes/agentTopicRuntime.ts', import.meta.url),
  'utf8',
);

describe('Agent workbench ownership contract', () => {
  it('keeps AgentChatPage as a pure workbench renderer', () => {
    expect(pageSource).toContain('<AgentWorkbench');
    expect(pageSource).not.toContain('useEffect');
    expect(pageSource).not.toContain('useAgentStore');
    expect(pageSource).not.toContain('useChatStore');
  });

  it('does not bootstrap Agent or Topic business data from AgentSidebar mount', () => {
    expect(sidebarSource).not.toMatch(/useEffect\(\(\) => \{\s*loadAgents\(\)/);
    expect(sidebarSource).not.toMatch(/useEffect\(\(\) => \{\s*loadAgentTopics\(\)/);
  });

  it('assigns selected-Agent topic bootstrap and reconcile to a session runtime', () => {
    expect(topicRuntimeSource).toContain("scope: 'session'");
    expect(topicRuntimeSource).toContain("loadTopicsForAgent(agent.id, reason)");
    expect(topicRuntimeSource).toContain("useAgentStore.subscribe");
    expect(topicRuntimeSource).toContain("bootstrapSession()");
  });
});
