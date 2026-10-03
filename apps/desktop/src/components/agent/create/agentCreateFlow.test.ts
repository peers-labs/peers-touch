import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  closeAgentCreateFlow,
  getAgentCreateRequest,
  openAgentCreateFlow,
  subscribeAgentCreateFlow,
} from './agentCreateFlow';

describe('agentCreateFlow', () => {
  afterEach(() => {
    const request = getAgentCreateRequest();
    if (request) closeAgentCreateFlow(request.id);
  });

  it('opens without creating or selecting an Agent', () => {
    const openProfile = vi.fn();
    const listener = vi.fn();
    const unsubscribe = subscribeAgentCreateFlow(listener);

    openAgentCreateFlow(openProfile);

    expect(getAgentCreateRequest()).toMatchObject({ openProfile });
    expect(openProfile).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('ignores duplicate opens and closes only the active request', () => {
    const first = vi.fn();
    const second = vi.fn();

    openAgentCreateFlow(first);
    const request = getAgentCreateRequest();
    openAgentCreateFlow(second);
    closeAgentCreateFlow((request?.id ?? 0) + 1);

    expect(getAgentCreateRequest()).toBe(request);
    closeAgentCreateFlow(request?.id ?? 0);
    expect(getAgentCreateRequest()).toBeNull();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });
});
