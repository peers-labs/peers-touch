# Review Prompt: OAuth Final Review Remediation

Review
`docs/architecture/oauth-login-broker/execution-plans/20260930-oauth-final-review-remediation/plan.md`
against the accepted OAuth architecture and the final code-review findings.

Verify:

- configuration honors documented overrides and rejects insecure production
  endpoints;
- GitHub response and tree handling remains bounded without silent truncation;
- concurrent refresh duplicates converge after a winner commits;
- cross-instance HTTP proof uses distinct adapters over durable shared state;
- G05B, architecture, domain validation, race, and actor contracts are directly
  exercised;
- Acceptance-tooling changes select their self-validation Gates;
- all writes stay inside the Plan source claims and no target worktree changes.

Return findings first. Pass only when no P1/P2 defect remains.
