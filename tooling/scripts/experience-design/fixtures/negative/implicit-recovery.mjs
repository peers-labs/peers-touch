import { completeReviewFixture } from '../positive/complete-review.mjs';

export function implicitRecoveryFixture() {
  const result = completeReviewFixture();
  result.recoveryPaths[0].distance = 'implicit';
  return result;
}
