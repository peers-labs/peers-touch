// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { MobileDurableCommandState } from '../../gen/proto/domain/mobile/reliability_pb';
import { CommandRecoveryPanel } from './CommandRecoveryPanel';

describe('CommandRecoveryPanel recovery copy', () => {
  it('keeps internal command identity out of visible recovery copy', () => {
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
    expect(markup).toContain('data-command-id="command-unknown"');
    expect(markup).toContain('data-command-state="unknown-outcome"');
    expect(markup).toContain('mobile.recovery.command.friendRequest');
    expect(markup).toContain('mobile.recovery.command.state.pending');
    expect(markup).toContain('mobile.recovery.command.state.unknown-outcome');
    expect(markup).not.toContain('request-queued');
    expect(markup).not.toContain('request-unknown');
    expect(markup).not.toContain('ptid:bob');
    expect(markup).not.toContain('ptid:carol');
    expect(markup).not.toContain('mobile.recovery.command.commandId');
    expect(markup).not.toContain('mobile.recovery.command.requestId');
    expect(markup).not.toContain('mobile.recovery.command.target');
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
