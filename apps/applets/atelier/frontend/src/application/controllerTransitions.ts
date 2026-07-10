import { classifyAtelierError, type AtelierErrorKind } from '../infrastructure/capability/atelierClient';
import { t } from '../infrastructure/i18n/messages';
import type { AtelierEventStreamState } from './viewStatus';

export interface AtelierLocalizedErrorState {
  error: string;
  errorKind: AtelierErrorKind;
}

interface AtelierControllerPendingActionReset {
  resolvingDecisionId: '';
  creatingProject: false;
  sendingMessage: false;
  taskActionId: '';
  taskActionKind: '';
  purgeConfirmTaskId: '';
}

export interface AtelierEventStreamDegradedState extends AtelierControllerPendingActionReset {
  loading: false;
  eventStreamState: AtelierEventStreamState;
  eventStreamError: string;
  eventStreamErrorKind: AtelierErrorKind;
}

export interface AtelierEventStreamConnectingState {
  loading: false;
  eventStreamState: AtelierEventStreamState;
  eventStreamError: '';
  eventStreamErrorKind: '';
}

export interface AtelierLoadFailureState extends AtelierControllerPendingActionReset, AtelierLocalizedErrorState {
  loading: false;
}

export type AtelierEventStreamFailureState = AtelierEventStreamDegradedState | AtelierLoadFailureState;

function pendingActionReset(): AtelierControllerPendingActionReset {
  return {
    resolvingDecisionId: '',
    creatingProject: false,
    sendingMessage: false,
    taskActionId: '',
    taskActionKind: '',
    purgeConfirmTaskId: '',
  };
}

export function stateFromAtelierError(error: unknown): AtelierLocalizedErrorState {
  const normalized = classifyAtelierError(error);
  return {
    error: t(normalized.key),
    errorKind: normalized.kind,
  };
}

export function stateFromAtelierEventStreamConnecting(): AtelierEventStreamConnectingState {
  return {
    loading: false,
    eventStreamState: 'subscribing',
    eventStreamError: '',
    eventStreamErrorKind: '',
  };
}

export function stateFromAtelierEventStreamError(error: unknown, hasSnapshot: boolean): AtelierEventStreamFailureState {
  const normalized = stateFromAtelierError(error);
  if (hasSnapshot) {
    return {
      loading: false,
      eventStreamState: 'degraded',
      eventStreamError: normalized.error,
      eventStreamErrorKind: normalized.errorKind,
      ...pendingActionReset(),
    };
  }

  return {
    loading: false,
    ...normalized,
    ...pendingActionReset(),
  };
}
