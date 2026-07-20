import {
  ATELIER_RECOVERY_RETRYABLE_KINDS,
  ATELIER_RECOVERY_TONE_BY_KIND,
  ATELIER_VIEW_SURFACE,
} from '../domain/projection.contract.generated';
import type { AtelierRecoveryTone, AtelierViewStatus as AtelierPageViewStatus } from '../domain/projection.contract.generated';
import type { AtelierErrorKind } from '../infrastructure/capability/atelierClient';
import { deriveAtelierPageSurface } from './pageComposition';

export interface OfficialRecoveryView {
  tone: AtelierRecoveryTone;
  retryVisible: boolean;
  titleKey: string;
  detailKey?: string;
}

export type OfficialStatusActionKind = 'create-project' | 'retry' | 'none';

export interface OfficialStatusActionPolicy {
  primaryAction: OfficialStatusActionKind;
  createProjectVisible: boolean;
  retryVisible: boolean;
}

export function isOfficialStatusActionPolicyConsistent(policy: OfficialStatusActionPolicy): boolean {
  if (policy.createProjectVisible && policy.retryVisible) return false;
  if (policy.primaryAction === 'create-project') {
    return policy.createProjectVisible && !policy.retryVisible;
  }
  if (policy.primaryAction === 'retry') {
    return !policy.createProjectVisible && policy.retryVisible;
  }
  return !policy.createProjectVisible && !policy.retryVisible;
}

const recoveryLabelKeyByKind = ATELIER_VIEW_SURFACE.recovery.labelKeyByKind satisfies Record<AtelierErrorKind, { titleKey: string; detailKey?: string }>;
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

export function deriveOfficialStatusActionPolicy(input: {
  error: string;
  errorKind: AtelierErrorKind | '';
  loading: boolean;
  taskCount: number;
  viewStatus: AtelierPageViewStatus;
}): OfficialStatusActionPolicy {
  const pageSurface = deriveAtelierPageSurface(input);
  if (pageSurface.emptyVisible) {
    return {
      primaryAction: 'create-project',
      createProjectVisible: true,
      retryVisible: false,
    };
  }
  const recoveryKind = pageSurface.globalErrorVisible ? input.errorKind : pageSurface.typedRecoveryKind;
  if (recoveryKind) {
    const recoveryView = deriveOfficialRecoveryView(recoveryKind);
    return {
      primaryAction: recoveryView.retryVisible ? 'retry' : 'none',
      createProjectVisible: false,
      retryVisible: recoveryView.retryVisible,
    };
  }
  return {
    primaryAction: 'none',
    createProjectVisible: false,
    retryVisible: false,
  };
}
