import { t } from '../infrastructure/i18n/messages';
import type { AtelierErrorKind } from '../infrastructure/capability/atelierClient';
import type { AtelierEventStreamState } from './viewStatus';

export interface MalformedAtelierProjectionEventState {
  loading: false;
  eventStreamState: AtelierEventStreamState;
  eventStreamError: string;
  eventStreamErrorKind: AtelierErrorKind;
  resolvingDecisionId: '';
  creatingProject: false;
  sendingMessage: false;
}

export function stateFromMalformedAtelierProjectionEvent(): MalformedAtelierProjectionEventState {
  return {
    loading: false,
    eventStreamState: 'degraded',
    eventStreamError: t('atelier.error.invalidProjection'),
    eventStreamErrorKind: 'invalid-projection',
    resolvingDecisionId: '',
    creatingProject: false,
    sendingMessage: false,
  };
}
