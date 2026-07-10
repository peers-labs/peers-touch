import { describe, expect, it } from 'vitest';
import { stateFromAtelierEventStreamError } from './controllerTransitions';

const expectedResetFields = {
  resolvingDecisionId: '',
  creatingProject: false,
  sendingMessage: false,
  taskActionId: '',
  taskActionKind: '',
  purgeConfirmTaskId: '',
  providerCapabilitiesLoading: false,
  feedbackSubmittingId: '',
  memoryConfirming: false,
  rerunConfirming: false,
  workspaceOpenSubmittingId: '',
  artifactBodyFetchId: '',
  artifactPreviewOpenId: '',
} as const;

describe('stateFromAtelierEventStreamError', () => {
  it('clears every transient workbench action field for snapshot recovery failures', () => {
    for (const [label, error, expectedKind] of [
      ['auth-denied', new Error('atelier.error.authDenied'), 'auth-denied'],
      ['disconnected', new Error('atelier.error.disconnected'), 'disconnected'],
      ['generic', new Error('stream exploded'), 'error'],
    ] as const) {
      const transition = stateFromAtelierEventStreamError(error, true);

      expect(transition).toMatchObject({
        loading: false,
        eventStreamState: 'degraded',
        eventStreamErrorKind: expectedKind,
        ...expectedResetFields,
      });
      expect(Object.keys(expectedResetFields).every((field) => field in transition)).toBe(true);
      expect(JSON.stringify(transition), label).not.toMatch(
        /provider\.invoke|gate\.run|artifact\.write|trace\.write|checkpoint\.write|resume\.execute|memory\.write|input_snapshot|shell|file\.write|run\.execute/,
      );
    }
  });

  it('clears every transient workbench action field for no-snapshot load failures', () => {
    for (const [label, error, expectedKind] of [
      ['auth-denied', new Error('atelier.error.authDenied'), 'auth-denied'],
      ['disconnected', new Error('atelier.error.disconnected'), 'disconnected'],
      ['generic', new Error('stream exploded'), 'error'],
    ] as const) {
      const transition = stateFromAtelierEventStreamError(error, false);

      expect(transition).toMatchObject({
        loading: false,
        errorKind: expectedKind,
        ...expectedResetFields,
      });
      expect(Object.keys(expectedResetFields).every((field) => field in transition)).toBe(true);
      expect(JSON.stringify(transition), label).not.toMatch(
        /provider\.invoke|gate\.run|artifact\.write|trace\.write|checkpoint\.write|resume\.execute|memory\.write|input_snapshot|shell|file\.write|run\.execute/,
      );
    }
  });
});
