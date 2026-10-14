# macOS Tray Formal Acceptance

> **Plan ID**: desktop-macos-tray-acceptance-20261014
> **Created**: 2026-10-14T11:25:00.000Z

## Plan

```json
{"kind":"peers-touch-plan","planId":"desktop-macos-tray-acceptance-20261014","createdAt":"2026-10-14T11:25:00.000Z","northStar":{"objective":"Prove that the exact-source packaged macOS Desktop exposes the accepted compact Peers wordmark status item and remains recoverable through the native tray lifecycle.","successCriteria":[{"id":"DSTR-NS-01","statement":"The packaged macOS process exposes one Template-rendered full Peers wordmark status item with the accepted asset and native Accessibility geometry, and its Show action restores the hidden main window.","sourceRefs":["DSTR-C01","DSTR-J01","DSTR-A01..DSTR-A05"]},{"id":"DSTR-NS-02","statement":"Formal proof binds source, package, binary, process, status item, and cleanup identities while Desktop shell paths select no unrelated Chat Gate.","sourceRefs":["DSTR-A02","DSTR-A06","D-11","D-12","D-13","D-18","D-20"]}]},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/platform/client/desktop/runtime.md","docs/architecture/engineering/acceptance/design.md","docs/architecture/engineering/acceptance/decisions.md","docs/architecture/engineering/development-workflow/design.md","docs/client/desktop/tray-residency.md"],"decisions":["D-07","D-11","D-12","D-13","D-18","D-20","DWF-D03","DWF-D09","DWF-D14","DWF-D42"]},"scope":{"sourceClaims":[{"pathPrefix":"apps/desktop","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/platform/client/desktop","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/engineering/acceptance","mode":"shared-read"},{"pathPrefix":"docs/architecture/engineering/development-workflow","mode":"shared-read"},{"pathPrefix":"docs/client/desktop","mode":"exclusive-write"},{"pathPrefix":"docs/knowledge","mode":"shared-read"},{"pathPrefix":"tooling/acceptance/capabilities/desktop-shell.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/domains/desktop-shell.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/domains/index.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/drivers/native","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/environments/desktop-shell-native.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/features/desktop-shell-tray.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/gates/desktop","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/__init__.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/provisioners/desktop_shell_native.py","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance/registry.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts/acceptance-plan-test.py","mode":"exclusive-write"}],"nonGoals":["Change Linux or Windows tray appearance","Claim installer signing or notarization","Use screenshots as the sole product oracle","Provision or mutate Station, Relay, account, or Chat state","Retain the broad Chat path matcher for Desktop shell ownership","Push, open a pull request, merge, release, or rewrite history"]},"tasks":[{"id":"DSTR-01-SOURCE","workstreamId":"DSTR-TRAY","path":"tasks/DSTR-01-SOURCE.md","dependsOn":[]},{"id":"DSTR-02-FUNCTIONAL","workstreamId":"DSTR-TRAY","path":"tasks/DSTR-02-FUNCTIONAL.md","dependsOn":["DSTR-01-SOURCE"]},{"id":"DSTR-03-FORMAL","workstreamId":"DSTR-TRAY","path":"tasks/DSTR-03-FORMAL.md","dependsOn":["DSTR-02-FUNCTIONAL"]}],"authorization":{"checkpoint":{"localCommit":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["desktop-shell-native"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}},"amendments":[{"id":"amendment-20261014121417778-1b298e933d548a54dd7aef25d2ce4a44","createdAt":"2026-10-14T12:14:17.778Z","actor":"acceptance@test.invalid","reason":"Replace overbroad Chat impact expectations","changes":["Add the canonical planner test to DSTR-01 write scope"],"impact":{"taskIds":["DSTR-01-SOURCE","DSTR-02-FUNCTIONAL","DSTR-03-FORMAL"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"c8d531b39008c93a9e9dfa5c0035f945f25ebc12bacdf8b72885de365b8302dc","toContentDigest":"a23cd49d099c460383dd525c71c7db44e44ff3963939d9c89e66171f9b6815c9"},{"id":"amendment-20261014130603284-20c9a1020e1e90fafb7560740e845219","createdAt":"2026-10-14T13:06:03.284Z","actor":"acceptance@test.invalid","reason":"Bind approved native runtime","changes":["Authorize desktop-shell-native local runtime"],"impact":{"taskIds":[],"gateIds":[]},"approval":{"kind":"owner","decisionRef":"user-message:2026-10-14:formal-macos-tray-acceptance-approved"},"fromContentDigest":"a23cd49d099c460383dd525c71c7db44e44ff3963939d9c89e66171f9b6815c9","toContentDigest":"755c427de8fe0d2d8a89b5acabcc31348d1af4c6a98f435e9e11493834e21b74"}],"northStarApproval":{"northStarDigest":"8edc1b31d8d5e69aab1413f5183b5b5f2c2545e2cdcff291b1b60022549d2e8e","approvedBy":"acceptance@test.invalid","approvedAt":"2026-10-14T12:01:58.296Z","decisionRef":"user-message:2026-10-14:formal-macos-tray-acceptance-approved"},"criterionCoverage":[{"criterionId":"DSTR-NS-01","taskIds":["DSTR-01-SOURCE","DSTR-02-FUNCTIONAL","DSTR-03-FORMAL"],"closureIds":["desktop-shell-tray-source","desktop-shell-tray-functional","desktop-shell-tray-formal"],"gateIds":["acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","desktop-shell-domain-validation","desktop-shell-tray-e2e"]},{"criterionId":"DSTR-NS-02","taskIds":["DSTR-01-SOURCE","DSTR-02-FUNCTIONAL","DSTR-03-FORMAL"],"closureIds":["desktop-shell-tray-source","desktop-shell-tray-functional","desktop-shell-tray-formal"],"gateIds":["acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","desktop-shell-domain-validation","desktop-shell-tray-e2e"]}]}
```

## Acceptance Execution

```json
{
  "closures": {
    "desktop-shell-tray-source": [],
    "desktop-shell-tray-functional": [
      "desktop-shell-tray-e2e"
    ],
    "desktop-shell-tray-formal": [
      "acceptance-plan-self",
      "acceptance-infra-validation",
      "acceptance-workflow-contract",
      "acceptance-runtime-provisioning-self",
      "desktop-shell-tray-e2e",
      "desktop-shell-domain-validation"
    ]
  },
  "completion": [
    "acceptance-plan-self",
    "acceptance-infra-validation",
    "acceptance-workflow-contract",
    "acceptance-runtime-provisioning-self",
    "desktop-shell-tray-e2e",
    "desktop-shell-domain-validation"
  ],
  "full": [
    "acceptance-plan-self",
    "acceptance-infra-validation",
    "acceptance-workflow-contract",
    "acceptance-runtime-provisioning-self",
    "desktop-shell-tray-e2e",
    "desktop-shell-domain-validation"
  ]
}
```

## Goal

Replace the current screenshot-only confidence with one source-bound macOS
Native Acceptance path that proves the packaged status item, hidden-window
residency, restore action, and cleanup without inheriting Chat ownership.

## Dependency DAG

```text
DSTR-01-SOURCE
  -> DSTR-02-FUNCTIONAL
  -> DSTR-03-FORMAL
```

## Atomic Cutover

- `desktop-shell` becomes the sole Acceptance owner for Desktop tray paths.
- The broad Chat matcher stops owning `apps/desktop/src-tauri/src/**`.
- The concrete Desktop shell Provisioner owns package build, process launch,
  parent-only native authority, and cleanup.
- The business Gate consumes a bounded ephemeral capability and never imports
  AppKit/Quartz or launches the application.
- Formal proof is emitted only after the same Journey passes the tracked
  Development functional fence.

## Completion

All three Tasks are done, the exact-source formal Gate and
`desktop-shell-domain-validation --require-proven` pass, the Gap Detector finds
no required unproven Gate, and no process, status item, port, storage, or
workflow resource remains live.
