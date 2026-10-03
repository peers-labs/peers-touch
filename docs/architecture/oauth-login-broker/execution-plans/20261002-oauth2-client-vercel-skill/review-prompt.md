# Review Prompt: OAuth2 Client Vercel Publishing Skill

Review
`docs/architecture/oauth-login-broker/execution-plans/20261002-oauth2-client-vercel-skill/plan.md`
against `AGENTS.md`, the OAuth Login Broker architecture, and the current
`apps/oauth2-client` source tree.

Verify:

- the Skill is canonical under `tooling/skills/`, is `pt-` prefixed, and is
  registered without a tracked host-private copy;
- one bounded Task owns the complete source-only closure;
- provider discovery fails closed on catalog drift and does not use chat memory;
- provider context covers GitHub, Google, Weixin, and Apple-specific future
  onboarding without assuming a universal client-secret shape;
- env parsing and CLI invocation cannot expose secret values through argv,
  output, repository files, or generated evidence;
- stable HTTPS domain and callback configuration precede provider registration;
- Preview verification precedes Production and Preview protection is explicit;
- GitHub encrypted persistence and real callback evidence remain required for
  first invocation, not claimed by source tests;
- `vercel.json` preserves independent `api/**/index.go` Functions and includes
  `config/sites.json`;
- no external Vercel, provider, or sibling env mutation occurs in this Plan.

Return findings first. Pass only when no P1/P2 defect remains.
