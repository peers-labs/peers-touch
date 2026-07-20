import {
  ATELIER_EMPTY_CTA_STATUS,
  ATELIER_STATUS_NOTICE_KINDS,
  ATELIER_TYPED_RECOVERY_KINDS,
} from '../domain/projection.contract.generated';
import type { AtelierStatusNoticeKind, AtelierTypedRecoveryKind, AtelierViewStatus as AtelierPageViewStatus } from '../domain/projection.contract.generated';

export interface AtelierPageSurface {
  globalErrorVisible: boolean;
  typedRecoveryKind: AtelierTypedRecoveryKind | '';
  statusNotice: AtelierStatusNoticeKind | '';
  loadingVisible: boolean;
  emptyVisible: boolean;
  mainContentVisible: boolean;
}

export function shouldRenderAtelierEmptyState(input: {
  error: string;
  loading: boolean;
  taskCount: number;
  viewStatus: AtelierPageViewStatus;
}) {
  return !input.error && !input.loading && input.taskCount === 0 && input.viewStatus === ATELIER_EMPTY_CTA_STATUS;
}

export function atelierTypedRecoveryKind(input: {
  error: string;
  loading: boolean;
  viewStatus: AtelierPageViewStatus;
}): AtelierTypedRecoveryKind | '' {
  if (input.error || input.loading) return '';
  return (ATELIER_TYPED_RECOVERY_KINDS as readonly string[]).includes(input.viewStatus) ? (input.viewStatus as AtelierTypedRecoveryKind) : '';
}

export function deriveAtelierPageSurface(input: {
  error: string;
  loading: boolean;
  taskCount: number;
  viewStatus: AtelierPageViewStatus;
}): AtelierPageSurface {
  const globalErrorVisible = Boolean(input.error);
  const typedRecoveryKind = atelierTypedRecoveryKind(input);
  const statusNotice = !globalErrorVisible && !input.loading && (ATELIER_STATUS_NOTICE_KINDS as readonly string[]).includes(input.viewStatus)
    ? (input.viewStatus as AtelierStatusNoticeKind)
    : '';
  return {
    globalErrorVisible,
    typedRecoveryKind,
    statusNotice,
    loadingVisible: !globalErrorVisible && input.loading,
    emptyVisible: shouldRenderAtelierEmptyState(input),
    mainContentVisible: !globalErrorVisible && !input.loading && input.taskCount > 0,
  };
}
