import { describe, expect, it } from 'vitest';

import type { ChannelBindingInfo } from '../../../services/desktop_api';
import type { ChannelDetailProjection } from '../../../store/channel';
import { boundTopicAgentIds, formatTopicDate } from './channelTopics';

const binding = (agentId?: string) =>
  ({ agentId: agentId ?? '' }) as ChannelBindingInfo;

const detail = (
  routes: Array<{ agentId: string }>,
  automations: Array<{ agentId: string }>,
) =>
  ({
    routes: routes as ChannelDetailProjection['routes'],
    automations: automations as ChannelDetailProjection['automations'],
  }) as ChannelDetailProjection;

describe('lark-channels topics projection', () => {
  it('unions responder, routes and automations without duplicates in order', () => {
    const ids = boundTopicAgentIds(
      binding('agent-default'),
      detail(
        [{ agentId: 'agent-route-1' }, { agentId: 'agent-default' }, { agentId: '' }],
        [{ agentId: 'agent-auto' }, { agentId: 'agent-route-1' }],
      ),
    );
    expect(ids).toEqual([
      'agent-default',
      'agent-route-1',
      'agent-auto',
    ]);
  });

  it('stays empty when no Agent is bound anywhere', () => {
    expect(boundTopicAgentIds(binding(), detail([], []))).toEqual([]);
    expect(boundTopicAgentIds(binding(), null)).toEqual([]);
  });

  it('keeps routes and automations when the binding has no default responder', () => {
    expect(
      boundTopicAgentIds(
        binding(),
        detail([{ agentId: 'agent-route' }], [{ agentId: 'agent-auto' }]),
      ),
    ).toEqual(['agent-route', 'agent-auto']);
  });

  it('formats parseable Station timestamps and hides invalid ones', () => {
    expect(formatTopicDate('not-a-date')).toBe('');
    const formatted = formatTopicDate('2026-10-26T10:00:00Z');
    expect(Number.isNaN(Date.parse(formatted))).toBe(false);
    expect(formatted.length).toBeGreaterThan(0);
  });
});
