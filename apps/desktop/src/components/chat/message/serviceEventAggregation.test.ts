import { describe, expect, it } from 'vitest';

import type { ChatMessage } from './chatMessageModel';
import { aggregateServiceEvents } from './serviceEventAggregation';

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
});
