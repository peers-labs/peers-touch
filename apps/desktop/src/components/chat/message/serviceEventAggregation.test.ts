import { describe, expect, it } from 'vitest';

import type { ChatMessage } from './chatMessageModel';
import {
  aggregateServiceEvents,
  serviceAggregationKey,
} from './serviceEventAggregation';

function taskMessage(
  id: string,
  executionId: string,
  revision: string,
  state: number,
  senderPtid = 'sender-a',
): ChatMessage {
  return {
    ulid: id,
    messageId: id,
    eventId: `event-${id}`,
    senderPtid,
    senderDeviceId: 'station-system',
    content: `state ${state}`,
    plaintext: `state ${state}`,
    attachments: [],
    sentAtMs: Number(id.replace(/\D/g, '')) || 1,
    timestampUnixMs: Number(id.replace(/\D/g, '')) || 1,
    eventSequence: Number(id.replace(/\D/g, '')) || 1,
    deliveryState: 'delivered',
    readByPtids: [],
    serviceMessage: {
      eventId: `event-${id}`,
      eventSequence: Number(id.replace(/\D/g, '')) || 1,
      messageId: id,
      senderPtid,
      fallbackText: `state ${state}`,
      sourceNamespace: 'ci.build',
      content: {
        primary: {
          kind: 'event',
          eventType: 'ci.task.state',
          subject: { kind: 'task', id: 'build', executionId },
          taskState: { revision, state },
          title: `state ${state}`,
        },
        attachments: [],
      },
      timestampUnixMs: 1,
    },
  } as unknown as ChatMessage;
}

function plainMessage(id: string): ChatMessage {
  return {
    ...taskMessage(id, '', '0', 0),
    serviceMessage: undefined,
  };
}

describe('aggregateServiceEvents', () => {
  it('groups matching executions across interleaved messages at the latest position', () => {
    const rows = aggregateServiceEvents([
      taskMessage('m1', 'run-1', '1', 1),
      plainMessage('m2'),
      taskMessage('m3', 'run-1', '2', 2),
    ]);
    expect(rows.map(row => row.message.ulid)).toEqual(['m2', 'm3']);
    expect(rows[1].aggregation?.knownCount).toBe(2);
    expect(rows[1].aggregation?.effective.content?.primary?.taskState?.revision).toBe('2');
  });

  it('keeps equal-revision conflicts visible and prevents terminal reopening', () => {
    const rows = aggregateServiceEvents([
      taskMessage('m1', 'run-1', '3', 4),
      taskMessage('m2', 'run-1', '4', 2),
      taskMessage('m3', 'run-1', '4', 5),
    ]);
    const aggregate = rows[0].aggregation;
    expect(aggregate?.conflicting).toBe(true);
    expect(aggregate?.effective.content?.primary?.taskState?.state).toBe(5);
  });

  it('restores each member in message order when expanded', () => {
    const messages = [
      taskMessage('m1', 'run-1', '1', 1),
      plainMessage('m2'),
      taskMessage('m3', 'run-1', '2', 2),
    ];
    const collapsed = aggregateServiceEvents(messages);
    const key = collapsed[1].aggregation?.key;
    expect(key).toBeTruthy();
    const expanded = aggregateServiceEvents(messages, new Set([key!]));
    expect(expanded.map(row => row.message.ulid)).toEqual(['m1', 'm2', 'm3']);
    expect(expanded[2].aggregation?.expanded).toBe(true);
  });

  it('keeps a late lower revision as history', () => {
    const rows = aggregateServiceEvents([
      taskMessage('m1', 'run-1', '5', 2),
      taskMessage('m2', 'run-1', '3', 4),
    ]);
    expect(rows[0].aggregation?.effective.content?.primary?.taskState).toEqual({
      revision: '5',
      state: 2,
    });
  });

  it('treats a partial history as known history and expands when more pages arrive', () => {
    const newestOnly = [taskMessage('m3', 'run-1', '3', 2)];
    expect(aggregateServiceEvents(newestOnly)).toEqual([{
      message: newestOnly[0],
    }]);

    const completeKnownPage = [
      taskMessage('m1', 'run-1', '1', 1),
      taskMessage('m2', 'run-1', '2', 2),
      ...newestOnly,
    ];
    const rows = aggregateServiceEvents(completeKnownPage);
    expect(rows).toHaveLength(1);
    expect(rows[0].aggregation).toMatchObject({
      knownCount: 3,
      knownHistoryOnly: true,
    });
  });

  it('rebuilds the same aggregate after a process restart', () => {
    const beforeRestart = [
      taskMessage('m1', 'run-1', '1', 1),
      plainMessage('m2'),
      taskMessage('m3', 'run-1', '2', 4),
    ];
    const afterRestart = JSON.parse(JSON.stringify(beforeRestart)) as ChatMessage[];

    expect(aggregateServiceEvents(afterRestart)).toEqual(
      aggregateServiceEvents(beforeRestart),
    );
  });

  it('uses the located historical message identity to expand its aggregate', () => {
    const messages = [
      taskMessage('m1', 'run-1', '1', 1),
      plainMessage('m2'),
      taskMessage('m3', 'run-1', '2', 2),
    ];
    const located = messages.find(message => message.ulid === 'm1');
    expect(located).toBeTruthy();
    const locatedKey = serviceAggregationKey(located!);
    const rows = aggregateServiceEvents(messages, new Set([locatedKey]));

    expect(rows.map(row => row.message.ulid)).toEqual(['m1', 'm2', 'm3']);
    expect(rows.find(row => row.aggregation)?.aggregation).toMatchObject({
      key: locatedKey,
      expanded: true,
      knownCount: 2,
    });
  });
});
