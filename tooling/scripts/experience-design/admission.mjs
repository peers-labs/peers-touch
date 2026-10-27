import { validateSourceFence } from './source-fence.mjs';
import { digestReviewResult, validateIndependentReviewDecision } from './validator.mjs';

export function evaluatePrototypeAdmission(result, decision, sourceInputs) {
  validateIndependentReviewDecision(result, decision);
  const sourceFence = validateSourceFence(result, sourceInputs);
  const blockedByUnproven = result.unproven.some((entry) =>
    entry.requiredFor.some((stage) => ['review', 'high-fidelity'].includes(stage)));
  return {
    admitted: result.verdict === 'NO_BLOCKING_FINDING'
      && decision.decision === 'accepted' && !blockedByUnproven,
    resultDigest: digestReviewResult(result),
    sourceFence,
  };
}
