# Peers Dev Canonicalization

> **Status**: active
> **Branch**: peers-dev-workflow
> **Workspace ID**: dbd1913c8dd24d52
> **Initial HEAD**: 015c2e22826bcc8292b4c763359034458ed5aef2

## Plan Package

```json
{"kind":"peers-touch-plan-package","planId":"DWF-PEERS-DEV-CANONICAL-20260926","status":"active","binding":{"branch":"peers-dev-workflow","workspaceId":"dbd1913c8dd24d52","initialHead":"015c2e22826bcc8292b4c763359034458ed5aef2"},"workClass":"infrastructure","architecture":{"sources":["docs/architecture/development-workflow/product-definition.md","docs/architecture/development-workflow/experience-contract.md","docs/architecture/development-workflow/product-state-model.md","docs/architecture/development-workflow/acceptance-matrix.md","docs/architecture/development-workflow/completion-review.md","docs/architecture/development-workflow/progress-observability.md","docs/architecture/development-workflow/design.md","docs/architecture/development-workflow/data-model.md","docs/architecture/development-workflow/decisions.md"],"decisions":["DWF-D18","DWF-D20","DWF-D26","DWF-D27","DWF-D28","DWF-D29","DWF-D30","DWF-D31","DWF-D32"]},"scope":{"sourceClaims":[{"pathPrefix":"AGENTS.md","mode":"exclusive-write"},{"pathPrefix":"Makefile","mode":"exclusive-write"},{"pathPrefix":"apps/dev","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/development-workflow","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/local-dev-control-plane","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/architecture-module-governance/architecture-modules.json","mode":"exclusive-write"},{"pathPrefix":"docs/global/workflow.md","mode":"exclusive-write"},{"pathPrefix":"docs/global/code-review-framework.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/prototypes/execution-plans/20260622-prototype-portal.md","mode":"exclusive-write"},{"pathPrefix":"docs/knowledge","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/dev","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/desktop/dev_runtime_multi_instance_static_test.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/registry.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/make/local-dev.mk","mode":"exclusive-write"},{"pathPrefix":"tooling/make/review.mk","mode":"exclusive-write"},{"pathPrefix":"tooling/make/setup.mk","mode":"exclusive-write"},{"pathPrefix":"tooling/plugins","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/agent-integration-audit-test.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/agent-integration-audit.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/agent-integration-control.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/check-frontend-runtime-registry.mjs","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/skill-rollout-audit.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/skill-rollout-audit-test.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/skill-rollout-control.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/install-agent-integration.sh","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/local-dev","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/plan","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/README.md","mode":"exclusive-write"},{"pathPrefix":"tooling/review-fixtures","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/review","mode":"exclusive-write"},{"pathPrefix":"tooling/skills","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/core/execution_plan.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/tests/test_execution_plan.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-plan.py","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-plan-test.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/environments/peers-dev-fixture-browser.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/__init__.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/peers_dev_fixture_browser.py","mode":"exclusive-write"}],"nonGoals":["Change Peers Touch end-user product behavior","Replace canonical active-work, freshness, worktree discovery, or functional evidence owners","Copy machine state or proof receipts from another workspace","Create another worktree to satisfy Plan binding","Push, open a pull request, merge histories, or rewrite history"]},"tasks":[{"id":"DWF-CAN01-PLAN-GENERATION","workstreamId":"DWF-CANONICAL-OWNER","path":"tasks/DWF-CAN01-PLAN-GENERATION.md","dependsOn":[],"status":"done","blocker":null},{"id":"DWF-CAN02-CONTROL-PLANE","workstreamId":"DWF-CONTROL-PLANE","path":"tasks/DWF-CAN02-CONTROL-PLANE.md","dependsOn":[],"status":"done","blocker":null},{"id":"DWF-CAN03-DEV-UI","workstreamId":"DWF-DEV-UI","path":"tasks/DWF-CAN03-DEV-UI.md","dependsOn":[],"status":"in_progress","blocker":null},{"id":"DWF-CAN04-CONTRACTS","workstreamId":"DWF-CONTRACTS","path":"tasks/DWF-CAN04-CONTRACTS.md","dependsOn":[],"status":"done","blocker":null},{"id":"DWF-CAN05-PROOF-CLEANUP","workstreamId":"DWF-DELIVERY","path":"tasks/DWF-CAN05-PROOF-CLEANUP.md","dependsOn":["DWF-CAN01-PLAN-GENERATION","DWF-CAN02-CONTROL-PLANE","DWF-CAN03-DEV-UI","DWF-CAN04-CONTRACTS"],"status":"pending","blocker":null}],"exhaustion":null,"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["dev-ui-local"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{
  "closures": {
    "canonical-plan-generation": [
      "development-workflow-control-plane",
      "workspace-plan-generation-self"
    ],
    "canonical-control-plane": [
      "acceptance-workflow-contract",
      "desktop-dev-runtime-isolation-static"
    ],
    "canonical-dev-ui": [
      "peers-dev-ui-browser-e2e"
    ],
    "canonical-contracts": [],
    "canonical-final-proof": [
      "acceptance-infra-validation",
      "acceptance-plan-self",
      "acceptance-runtime-provisioning-self",
      "dev-ui-browser-e2e",
      "peers-dev-product",
      "machine-dev-registry-self"
    ]
  },
  "completion": [
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "desktop-dev-runtime-isolation-static",
    "dev-ui-browser-e2e",
    "development-workflow-control-plane",
    "machine-dev-registry-self",
    "peers-dev-product",
    "peers-dev-ui-browser-e2e",
    "workspace-plan-generation-self"
  ],
  "full": [
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "desktop-dev-runtime-isolation-static",
    "dev-ui-browser-e2e",
    "development-workflow-control-plane",
    "machine-dev-registry-self",
    "peers-dev-product",
    "peers-dev-ui-browser-e2e",
    "workspace-plan-generation-self"
  ]
}
```

## Goal

Make `peers-dev-workflow` the only canonical owner of the usable Peers Dev
product, preserve its stronger workflow safety contracts, support sequential
Plan generations without Agent-created worktrees, and remove the erroneous
`peers-dev-product` worktree only after canonical proof passes.

## Conflict Policy

- Integrate by behavior and owner contract; never merge, rebase, cherry-pick, or
  replace whole directories from the unrelated source history.
- Preserve canonical functional evidence, active-work, freshness, discovery,
  host quarantine, and conversation binding semantics.
- Treat the prior product Plan and receipts as historical input only.
- Keep `peers-touch-git` read-only.
