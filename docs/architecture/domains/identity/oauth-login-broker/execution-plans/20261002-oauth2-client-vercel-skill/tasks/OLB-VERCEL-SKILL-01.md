# OLB-VERCEL-SKILL-01: Deliver The Vercel Publishing Skill

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "OLB-VERCEL-SKILL-20261002",
  "taskId": "OLB-VERCEL-SKILL-01",
  "workstreamId": "OLB-VERCEL-SKILL",
  "title": "Deliver deterministic OAuth2 Client Vercel publishing automation",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "olb-vercel-skill",
  "journeyId": "OLB-OPS-VERCEL-PUBLISH",
  "runtimeClass": "source-only",
  "writeSet": [
    ".gitignore",
    "AGENTS.md",
    "apps/oauth2-client/README.md",
    "apps/oauth2-client/vercel.json",
    "docs/architecture/oauth-login-broker/README.md",
    "docs/architecture/oauth-login-broker/execution-plans/20261002-oauth2-client-vercel-skill",
    "tooling/acceptance/capabilities/oauth-login-broker.yaml",
    "tooling/acceptance/domains/oauth-login-broker.yaml",
    "tooling/acceptance/features/oauth2-client-vercel-publication.yaml",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml",
    "tooling/skills/pt-github-review/FRESHNESS.md",
    "tooling/skills/pt-oauth2-client-2-vercel"
  ],
  "readSet": [
    "apps/oauth2-client/api",
    "apps/oauth2-client/config",
    "apps/oauth2-client/internal/bootstrap",
    "apps/oauth2-client/internal/domain/oauth/valueobject/provider.go",
    "apps/oauth2-client/internal/infrastructure/provider",
    "docs/architecture/oauth-login-broker",
    "docs/knowledge"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 120,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "olb-vercel-go",
      "command": "cd apps/oauth2-client && go test ./...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-vercel-script-tests",
      "command": "python3 -m unittest discover -s tooling/skills/pt-oauth2-client-2-vercel/tests -p 'test_*.py'",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-vercel-script-smoke",
      "command": "python3 tooling/skills/pt-oauth2-client-2-vercel/scripts/preflight.py --repo-root . --env-file ../env/peers-touch-infra/oauth2-client-test/runtime.env --base-url https://oauth.example.test --return-to https://app.example.test/oauth/callback && python3 tooling/skills/pt-oauth2-client-2-vercel/scripts/sync_vercel_env.py --repo-root . --env-file ../env/peers-touch-infra/oauth2-client-test/runtime.env --base-url https://oauth.example.test --return-to https://app.example.test/oauth/callback --environment preview --dry-run",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "olb-vercel-verifier-fixture",
      "command": "python3 tooling/skills/pt-oauth2-client-2-vercel/scripts/verify_deployment.py --self-test",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "olb-vercel-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-plan docs/architecture/oauth-login-broker/execution-plans/20261002-oauth2-client-vercel-skill/plan.md",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "olb-vercel-skill-governance",
      "command": "tooling/scripts/review/skill-check.sh && python3 tooling/skills/pt-oauth2-client-2-vercel/tests/test_scripts.py SkillGovernanceTests",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "olb-vercel-diff",
      "command": "git diff --check",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Repository-root Vercel link metadata is ignored before the first project link",
    "The canonical pt-prefixed Skill is registered and no host-private Skill copy is tracked",
    "Source discovery covers provider constants, adapters, routes, config, bootstrap env prefixes, and tests",
    "Provider catalog drift and omission of any runtime-enabled Provider fail closed, with GitHub, Google, Weixin, and future Apple onboarding documented",
    "Preflight emits only redacted machine-readable readiness and env delta",
    "Vercel Secret and Config values are sent to the CLI through stdin and never argv or logs",
    "Deployment verification covers health, GET-only HTTP behavior, provider start redirects, one run-bound HMAC-signed callback with login-count advancement per required provider, private GitHub repository status, and exact-shape cryptographically authenticated GitHub envelopes under configured keys with at least one active-key record",
    "Preview deployment uses an explicit Preview target and every newly built Production deployment is identified and reverified",
    "The source-only publication Gate proves the deterministic workflow without claiming live Vercel traffic",
    "Vercel configuration bundles config/sites.json without replacing api function entrypoints",
    "Review-skill freshness acknowledges the new AGENTS.md Skill registration",
    "Documentation states Root Directory, stable-domain, Preview protection, redeploy, and separate key-rotation requirements",
    "All declared focused checks pass"
  ],
  "failureBehavior": [
    "Unknown provider or catalog/source mismatch blocks publishing",
    "Missing env keys produce a redacted JSON delta and no Vercel mutation",
    "An absent Vercel login, project link, stable domain, OAuth key, or consent pauses only the affected external action",
    "Preview protection or callback mismatch blocks Production",
    "Memory storage can never pass production preflight",
    "Do not copy runtime.env into this repository"
  ],
  "updatedAt": "2026-10-02T00:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- The broker has GitHub, Google, and Weixin source adapters and independent
  `api/**/index.go` Vercel Function entrypoints.
- The sibling test env has GitHub, Google, and durable GitHub store keys.
- Vercel CLI and project linkage are not currently available in this worktree.

## Closure

One source closure makes future OAuth2 Client publication deterministic and
fail-closed while keeping all live deployment and provider consent evidence as
first-invocation work.

## Concurrency Decision

- Mode: serial.
- Reason: the catalog, scripts, Skill contract, Vercel config, and docs share
  one deployment contract and must be reviewed as one atomic source change.
