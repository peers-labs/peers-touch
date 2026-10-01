# Review Prompt: OAuth Review Hardening

Review
`docs/architecture/oauth-login-broker/execution-plans/20260930-oauth-review-hardening/plan.md`
against the accepted OAuth architecture and the five validated review findings.

Verify:

- scope is limited to `apps/oauth2-client`, OAuth architecture documents, and
  the existing OAuth Acceptance Gate;
- expected-generation fencing prevents stale provider responses from replacing
  newer credentials;
- missing Basic credentials avoid password derivation while wrong credentials
  remain constant-time compared;
- production callbacks require HTTPS and GitHub storage uses a bounded client;
- task/module completion projections match the completed implementation;
- the closure reuses exact-source OAuth Gates without broad unrelated E2E.

Return findings first. Pass only when no P1/P2 defect remains in the closure.
