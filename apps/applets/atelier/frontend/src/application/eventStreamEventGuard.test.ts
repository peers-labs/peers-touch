import { describe, expect, it } from 'vitest';
import {
  stateFromAtelierProjectionEventApplyOutcome,
  stateFromMalformedAtelierProjectionEvent,
} from './eventStreamEventGuard';

describe('event stream event guard UI state', () => {
  it('maps malformed projection events to degraded invalid-projection state', () => {
    expect(stateFromMalformedAtelierProjectionEvent()).toEqual({
      loading: false,
      eventStreamState: 'degraded',
      eventStreamError: 'Station returned an invalid Atelier projection snapshot.',
      eventStreamErrorKind: 'invalid-projection',
      resolvingDecisionId: '',
      creatingProject: false,
      sendingMessage: false,
    });
  });

  it('degrades stale and unknown-task reducer outcomes without clearing the last valid snapshot', () => {
    for (const outcome of ['stale', 'unknown-task'] as const) {
      expect(stateFromAtelierProjectionEventApplyOutcome(outcome)).toEqual(stateFromMalformedAtelierProjectionEvent());
    }
  });

  it('keeps applied and duplicate reducer outcomes live and non-destructive', () => {
    for (const outcome of ['applied', 'duplicate'] as const) {
      expect(stateFromAtelierProjectionEventApplyOutcome(outcome)).toEqual({
        loading: false,
        eventStreamState: 'live',
        eventStreamError: '',
        eventStreamErrorKind: '',
      });
    }
  });
});
