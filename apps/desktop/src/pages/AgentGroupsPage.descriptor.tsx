// PageDescriptor for the agent groups page.
//
// Agent Groups is a management UI for creating and configuring groups of
// collaborating agents. Loaded on-visit since it is not a primary landing.
// keepAlive: { lru: 1 } preserves state when switching tabs briefly.

import { registerPage } from '../kernel/page';
import { AgentGroupsPageContainer } from './AgentGroupsPageContainer';

export function registerAgentGroupsPage(): void {
  registerPage({
    id: 'agent-groups',
    title: 'Agent Groups',
    factory: () => <AgentGroupsPageContainer />,
    preload: 'on-visit',
    keepAlive: { lru: 1 },
    runtimes: [],
  });
}
