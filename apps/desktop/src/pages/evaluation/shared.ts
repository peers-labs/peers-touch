import {
  EvaluationAttemptStatus,
  EvaluationRunStatus,
  type EvaluationRun,
} from '../../gen/proto/domain/agent/evaluation_pb';

export function mutationPending(
  pendingMutations: Record<string, true>,
  prefix: string,
): boolean {
  return Object.keys(pendingMutations).some((key) => key.startsWith(prefix));
}

export function statusColor(status: EvaluationRunStatus): string {
  switch (status) {
    case EvaluationRunStatus.COMPLETED:
      return 'success';
    case EvaluationRunStatus.RUNNING:
      return 'processing';
    case EvaluationRunStatus.CANCEL_INTENT_COMMITTED:
    case EvaluationRunStatus.CANCELLING:
    case EvaluationRunStatus.PARTIAL:
    case EvaluationRunStatus.CANCELLED:
      return 'warning';
    case EvaluationRunStatus.FAILED:
      return 'error';
    default:
      return 'default';
  }
}

export function canCancelRun(run: EvaluationRun): boolean {
  return (
    run.status === EvaluationRunStatus.PENDING
    || run.status === EvaluationRunStatus.RUNNING
  );
}

export function canDeleteRun(run: EvaluationRun): boolean {
  return [
    EvaluationRunStatus.COMPLETED,
    EvaluationRunStatus.PARTIAL,
    EvaluationRunStatus.FAILED,
    EvaluationRunStatus.CANCELLED,
  ].includes(run.status);
}

export function retryableCaseIds(
  attempts: readonly { caseId: string; status: EvaluationAttemptStatus }[],
): string[] {
  return Array.from(new Set(
    attempts
      .filter((attempt) => (
        attempt.status === EvaluationAttemptStatus.FAILED
        || attempt.status === EvaluationAttemptStatus.INTERRUPTED
        || attempt.status === EvaluationAttemptStatus.CANCELLED
      ))
      .map((attempt) => attempt.caseId),
  ));
}

export function isFormValidationFailure(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'errorFields' in error
  );
}
