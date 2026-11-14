import { describe, expect, it } from 'vitest';

import {
  isClaimantWaitingStage,
  isTerminal,
  LOGIN_APPROVAL_STATE,
} from './loginApproval';
import type { LoginApprovalProjection } from '../services/loginApproval';

const projection = (state: number): LoginApprovalProjection => ({
  approvalId: 'a1',
  state: state as LoginApprovalProjection['state'],
  revision: 1,
  expiresAtUnixMs: 0,
  comparisonCode: '123456',
  reason: 0,
});

describe('loginApproval stage resolver', () => {
  it('treats null and terminal projections as non-waiting', () => {
    expect(isClaimantWaitingStage(null)).toBe(false);
    expect(isTerminal(LOGIN_APPROVAL_STATE.PENDING)).toBe(false);
    for (const terminal of [
      LOGIN_APPROVAL_STATE.COMMITTED,
      LOGIN_APPROVAL_STATE.DENIED,
      LOGIN_APPROVAL_STATE.CANCELLED,
      LOGIN_APPROVAL_STATE.EXPIRED,
    ]) {
      expect(isClaimantWaitingStage(projection(terminal))).toBe(false);
    }
  });

  it('keeps the card on the waiting surface for unresolved states', () => {
    expect(isClaimantWaitingStage(projection(LOGIN_APPROVAL_STATE.PENDING))).toBe(true);
    expect(isClaimantWaitingStage(projection(LOGIN_APPROVAL_STATE.APPROVED))).toBe(true);
  });
});
