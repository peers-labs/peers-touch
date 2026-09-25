// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { MobileDurableCommandState } from '../../gen/proto/domain/mobile/reliability_pb';
import { CommandRecoveryPanel } from './CommandRecoveryPanel';

describe('CommandRecoveryPanel command identity', () => {
  it('renders each Friend Request command with its request, target, and state', () => {
    const markup = renderToStaticMarkup(
      <CommandRecoveryPanel
        state={{
          kind: 'command-recovery',
          commands: [
            command(
              'command-queued',
              'request-queued',
              'ptid:bob',
              'pending',
              MobileDurableCommandState.QUEUED,
            ),
            command(
              'command-unknown',
              'request-unknown',
              'ptid:carol',
              'unknown-outcome',
              MobileDurableCommandState.UNKNOWN_OUTCOME,
            ),
          ],
        }}
        t={(key, params) => `${key}:${JSON.stringify(params ?? {})}`}
        onAction={vi.fn(async () => undefined)}
      />,
    );

    expect(markup).toContain('data-command-id="command-queued"');
    expect(markup).toContain('data-command-state="pending"');
    expect(markup).toContain('request-queued');
    expect(markup).toContain('ptid:bob');
    expect(markup).toContain('data-command-id="command-unknown"');
    expect(markup).toContain('data-command-state="unknown-outcome"');
    expect(markup).toContain('request-unknown');
    expect(markup).toContain('ptid:carol');
  });
});

function command(
  commandId: string,
  requestId: string,
  receiverPtid: string,
  state: string,
  durableState: MobileDurableCommandState,
) {
  return {
    commandId,
    orderingKey: `friend-request:${receiverPtid}`,
    state,
    attemptCount: 1,
    typedLastError: 0,
    createdAtMs: 1,
    updatedAtMs: 2,
    nextAttemptAtMs: null,
    envelope: {
      commandId,
      stationPeerId: 'station-a',
      actorPtid: 'ptid:alice',
      state: durableState,
      payload: {
        case: 'friendRequest',
        value: {
          body: {
            requestId,
            sender: { ptid: 'ptid:alice' },
            receiver: { ptid: receiverPtid },
          },
        },
      },
    },
  };
}
