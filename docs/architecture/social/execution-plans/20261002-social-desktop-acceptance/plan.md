# Social Private Moments Desktop Acceptance

> **Status**: completed
> **Branch**: feat/social-desktop-acceptance
> **Workspace ID**: 43155c43ec0308de
> **Initial HEAD**: 0f02f075278b5e845c1c730a737a0ccdd051f2b5

## Plan Package

```json
{"kind":"peers-touch-plan-package","planId":"SOCIAL-DESKTOP-ACCEPTANCE-20261002","status":"completed","binding":{"branch":"feat/social-desktop-acceptance","workspaceId":"43155c43ec0308de","initialHead":"0f02f075278b5e845c1c730a737a0ccdd051f2b5"},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/social/product-definition.md","docs/architecture/social/experience-contract.md","docs/architecture/social/product-state-model.md","docs/architecture/social/acceptance-matrix.md","docs/architecture/secure-content/design.md","docs/architecture/secure-content/decisions.md","docs/architecture/secure-content/integration.md","docs/architecture/acceptance-framework/design.md","docs/architecture/acceptance-framework/decisions.md"],"decisions":["SC-D21","SC-D22","SC-D23","SC-D24","SC-D25","SC-D28","D-21"]},"scope":{"sourceClaims":[{"pathPrefix":"docs/architecture/social","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"shared-read"},{"pathPrefix":"tooling/acceptance/capabilities","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/domains","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/environments","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/features","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/social","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/registry.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/development/secure_content","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts","mode":"shared-read"},{"pathPrefix":"tooling/scripts/acceptance-run.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-run-test.py","mode":"exclusive-write"},{"pathPrefix":"tooling/skills/pt-github-review/FRESHNESS.md","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/acceptance/moments/harness.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src/acceptance/moments/harness.test.ts","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/social/mod.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/social/private_moment.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop/src-tauri/src/interface/tauri_commands/messaging_recovery.rs","mode":"exclusive-write"},{"pathPrefix":"apps/desktop","mode":"shared-read"},{"pathPrefix":"apps/station/app/subserver/social","mode":"shared-read"},{"pathPrefix":"docs/architecture/acceptance-framework","mode":"shared-read"},{"pathPrefix":"docs/architecture/secure-content","mode":"shared-read"},{"pathPrefix":"packages/secure-content-core","mode":"shared-read"},{"pathPrefix":"tooling/acceptance/core","mode":"shared-read"}],"nonGoals":["Mobile Native private Social proof","Browser private publish or read proof","positive cross-Station private delivery","Chat or Conversation product proof","product behavior changes unless a formal Gate exposes a source defect","new test-account registration","per-Scenario build, deployment, service provisioning, client launch, or login","production release, FINAL_CUT, push, pull request, or history rewrite"]},"tasks":[{"id":"SDA-01-contracts","workstreamId":"SDA-W01","path":"tasks/SDA-01-contracts.md","dependsOn":[],"status":"done","blocker":null},{"id":"SDA-02-desktop-proof","workstreamId":"SDA-W01","path":"tasks/SDA-02-desktop-proof.md","dependsOn":["SDA-01-contracts"],"status":"done","blocker":null},{"id":"SDA-03-formal-proof","workstreamId":"SDA-W02","path":"tasks/SDA-03-formal-proof.md","dependsOn":["SDA-02-desktop-proof"],"status":"done","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["four","fiveArm"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{
  "closures": {
    "social-desktop-contracts": [],
    "social-desktop-proof": [],
    "social-desktop-final-proof": [
      "acceptance-plan-self",
      "acceptance-infra-validation",
      "acceptance-runtime-provisioning-self",
      "acceptance-workflow-contract",
      "social-private-desktop-e2e",
      "social-domain-validation"
    ]
  },
  "completion": [
    "acceptance-plan-self",
    "acceptance-infra-validation",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "social-private-desktop-e2e",
    "social-domain-validation"
  ],
  "full": [
    "acceptance-plan-self",
    "acceptance-infra-validation",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "chat-lifecycle-tree-zero-reference-e2e",
    "social-private-desktop-e2e",
    "social-domain-validation"
  ]
}
```

The functional closure uses the Task-owned Native Suite `FUNCTIONAL_CHECK`. The
successor aggregate owns formal completion and publishes the Native result
before Social validation. The Chat Gate remains full-only and out of scope.

## Goal

Produce current, exact-source formal Acceptance proof for Social Private
Moments on Native Desktop while reusing the existing `four` and `fiveArm`
services, compiled Desktop artifacts, seeded accounts, and one Suite Runtime.

## Claim Boundary

The completion claim covers Desktop-applicable scenarios
`SOC-SEC-AS01..AS10`, `SOC-SEC-AS12..AS13`, and `SOC-SEC-AS15..AS16`.
`SOC-SEC-AS11` remains Browser `UNPROVEN`; `SOC-SEC-AS14` remains Mobile
`UNPROVEN`. `SOC-SEC-RC06` proves only the fail-closed remote-recipient
boundary, never positive cross-Station private delivery.

Alice is the publisher, Bob is the mutual friend and authorized reader, and
Eve transitions through non-follower, follower-only/non-friend, and blocked
states. Anonymous is an unauthenticated HTTP actor. Bob2 is Bob's replacement
device/session, not a fourth account. These three accounts are sufficient for
friend and non-friend relationship coverage.

## Execution DAG

```text
SDA-01-contracts
  -> SDA-02-desktop-proof
  -> SDA-03-formal-proof
  -> SOCIAL_DESKTOP_PROVEN
```

## Resource Policy

- Provision, attest, launch, and login once before the first Scenario.
- Keep at most three Native Desktop clients active concurrently.
- Every Scenario after Suite start is attach-only and may reset only its
  namespaced business data after receiver-visible evidence is captured.
- Provision exactly three isolated relationship actors once for the Suite and
  reuse an existing `fiveArm` Actor identity for the remote-boundary negative.
- Bob device recovery is the only declared client replacement.
- Do not rebuild or redeploy when live exact-source attestations already match.
  A mismatch blocks proof until the minimum source-consistent remedy is known.

## Vertical Closures

| Task | Closure | Result |
|---|---|---|
| `SDA-01-contracts` | Register Social Domain, capabilities, features, formal Gate, environment, and proof mapping | Structurally valid Social Acceptance graph |
| `SDA-02-desktop-proof` | Execute one three-account Native Desktop Suite under the development policy | 14 Desktop scenarios functionally pass; formal proof remains unproven |
| `SDA-03-formal-proof` | Run the six completion Gates and validate the Social proof graph | 14 Desktop scenarios proven; Browser and Mobile explicitly unproven |

## Completion

Completion requires all three Tasks `done`, Social `--require-proven`
validation, formal Suite cleanup, released resources, and a clean worktree.
Mobile, Browser, Chat, release, and positive cross-Station delivery stay out.
