import {
  ATELIER_RECOVERY_RETRYABLE_KINDS,
  ATELIER_RECOVERY_TONE_BY_KIND,
} from '../domain/projection.contract.generated';
import type { AtelierRecoveryTone } from '../domain/projection.contract.generated';
import type { AtelierErrorKind } from '../infrastructure/capability/atelierClient';

export interface OfficialRecoveryView {
  tone: AtelierRecoveryTone;
  retryVisible: boolean;
  titleKey: string;
  detailKey?: string;
}

const recoveryLabelKeyByKind = {
  'auth-denied': {
    titleKey: 'atelier.error.authDeniedTitle',
    detailKey: 'atelier.error.authDeniedDetail',
  },
  disconnected: {
    titleKey: 'atelier.error.disconnectedTitle',
    detailKey: 'atelier.error.disconnectedDetail',
  },
  'invalid-projection': {
    titleKey: 'atelier.status.error',
  },
  'agent-ids-required': {
    titleKey: 'atelier.status.error',
  },
  error: {
    titleKey: 'atelier.status.error',
  },
} satisfies Record<AtelierErrorKind, { titleKey: string; detailKey?: string }>;

const recoveryToneByKind = ATELIER_RECOVERY_TONE_BY_KIND satisfies Record<AtelierErrorKind, AtelierRecoveryTone>;

export function deriveOfficialRecoveryView(kind: AtelierErrorKind | ''): OfficialRecoveryView {
  const retryableKinds = ATELIER_RECOVERY_RETRYABLE_KINDS as readonly string[];
  const retryVisible = retryableKinds.includes(kind);
  if (kind === '') {
    return {
      tone: recoveryToneByKind.error,
      retryVisible,
      titleKey: 'atelier.status.error',
    };
  }
  return {
    tone: recoveryToneByKind[kind],
    retryVisible,
    ...recoveryLabelKeyByKind[kind],
  };
}
