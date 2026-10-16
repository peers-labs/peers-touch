> **Plan ID**: `desktop-platform-alignment-20261014`
> **Created**: `2026-10-14T08:43:26.000Z`

## Plan

```json
{"kind":"peers-touch-plan","planId":"desktop-platform-alignment-20261014","createdAt":"2026-10-14T08:43:26.000Z","northStar":{"objective":"Close the complete 111-item Desktop prototype-to-platform alignment scope with truthful UI, canonical runtime ownership, no fabricated capabilities, and exact-source product proof.","successCriteria":[{"id":"DUI-NS-01","statement":"Every C1-C25, S1-S31, AI1-AI18, AP1-AP14, AD1-AD11, and N1-N12 item is either live and receiver-proven or removed by an accepted CUT, with prototypes and production exposing the same truthful capability boundary.","sourceRefs":["scope-ledger.md","desktop-shell prototype ledger","accepted Desktop, Chat, Agent, Applet, Federation, Notification, and Access contracts"]}]},"workClass":"product-behavior","architecture":{"sources":["docs/architecture/engineering/prototypes/README.md","docs/client/common/ui-identity/README.md","docs/client/desktop/runtime-projections.md","docs/client/desktop/identity-lifecycle.md","docs/architecture/platform/station/access/README.md","docs/architecture/domains/identity/oauth-login-broker/README.md","docs/architecture/domains/chat/lifecycle/README.md","docs/architecture/domains/chat/messaging/README.md","docs/architecture/domains/chat/storage-governance/README.md","docs/architecture/domains/social/runtime/README.md","docs/architecture/domains/agent/modern-chat-agent/README.md","docs/architecture/platform/applet-runtime/README.md","docs/architecture/domains/federation/README.md","docs/architecture/domains/identity/federation-catalog.md","docs/architecture/domains/notification/notification-architecture.md","docs/architecture/engineering/development-workflow/design.md","docs/architecture/engineering/development-workflow/decisions.md","docs/architecture/engineering/development-workflow/data-model.md","docs/architecture/engineering/development-workflow/integration.md"],"decisions":["SAL-D01","OLB-D01","CSG-D01","MCA-D14","DWF-D42","DWF-D43","DWF-D44"]},"scope":{"sourceClaims":[{"pathPrefix":"apps/desktop","mode":"exclusive-write"},{"pathPrefix":"apps/station/app/subserver","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/core/federation","mode":"exclusive-write"},{"pathPrefix":"apps/station/frame/touch","mode":"exclusive-write"},{"pathPrefix":"docs","mode":"exclusive-write"},{"pathPrefix":"model/domain","mode":"exclusive-write"},{"pathPrefix":"packages/applet-contract","mode":"exclusive-write"},{"pathPrefix":"packages/applet-kernel","mode":"exclusive-write"},{"pathPrefix":"packages/applets","mode":"exclusive-write"},{"pathPrefix":"packages/locales","mode":"exclusive-write"},{"pathPrefix":"packages/prototypes","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"tooling/scripts","mode":"exclusive-write"},{"pathPrefix":"tooling/make","mode":"exclusive-write"},{"pathPrefix":"tooling/skills","mode":"exclusive-write"}],"nonGoals":["Create a second Desktop, Chat, Agent, Applet, Federation, Notification, or Access authority","Keep compatibility adapters, fallback reads, duplicate stores, localStorage product truth, or fabricated operational data","Treat prototype mock behavior as product evidence","Claim Mobile parity beyond shared contracts touched by generated protocol changes","Push, create a pull request, deploy remote production resources, reset durable user data, or rewrite history without separate authorization"]},"tasks":[{"id":"DUI-02-IDENTITY-TRUST","workstreamId":"DUI-SHELL","path":"tasks/DUI-02-IDENTITY-TRUST.md","dependsOn":[]},{"id":"DUI-01-PROFILE-NOTIFICATIONS","workstreamId":"DUI-SHELL","path":"tasks/DUI-01-PROFILE-NOTIFICATIONS.md","dependsOn":[]},{"id":"DUI-03-LOGIN-GENERAL","workstreamId":"DUI-SHELL","path":"tasks/DUI-03-LOGIN-GENERAL.md","dependsOn":[]},{"id":"DUI-04-CHAT-INTERACTIONS","workstreamId":"DUI-SOCIAL","path":"tasks/DUI-04-CHAT-INTERACTIONS.md","dependsOn":[]},{"id":"DUI-05-SOCIAL-RELATIONSHIPS","workstreamId":"DUI-SOCIAL","path":"tasks/DUI-05-SOCIAL-RELATIONSHIPS.md","dependsOn":["DUI-04-CHAT-INTERACTIONS"]},{"id":"DUI-06-GROUP-LIFECYCLE","workstreamId":"DUI-SOCIAL","path":"tasks/DUI-06-GROUP-LIFECYCLE.md","dependsOn":["DUI-04-CHAT-INTERACTIONS","DUI-05-SOCIAL-RELATIONSHIPS"]},{"id":"DUI-07-CHAT-SAFETY-CALLS","workstreamId":"DUI-SOCIAL","path":"tasks/DUI-07-CHAT-SAFETY-CALLS.md","dependsOn":["DUI-04-CHAT-INTERACTIONS","DUI-05-SOCIAL-RELATIONSHIPS","DUI-06-GROUP-LIFECYCLE"]},{"id":"DUI-08-AI-CONFIG","workstreamId":"DUI-AGENT","path":"tasks/DUI-08-AI-CONFIG.md","dependsOn":[]},{"id":"DUI-09-AGENT-PROFILE","workstreamId":"DUI-AGENT","path":"tasks/DUI-09-AGENT-PROFILE.md","dependsOn":["DUI-08-AI-CONFIG"]},{"id":"DUI-10-AGENT-RUNTIME","workstreamId":"DUI-AGENT","path":"tasks/DUI-10-AGENT-RUNTIME.md","dependsOn":["DUI-09-AGENT-PROFILE"]},{"id":"DUI-11-AGENT-SURFACES","workstreamId":"DUI-AGENT","path":"tasks/DUI-11-AGENT-SURFACES.md","dependsOn":["DUI-09-AGENT-PROFILE","DUI-10-AGENT-RUNTIME"]},{"id":"DUI-12-APPLET-CATALOG","workstreamId":"DUI-APPLETS","path":"tasks/DUI-12-APPLET-CATALOG.md","dependsOn":[]},{"id":"DUI-13-APPLET-RUNTIME","workstreamId":"DUI-APPLETS","path":"tasks/DUI-13-APPLET-RUNTIME.md","dependsOn":["DUI-12-APPLET-CATALOG"]},{"id":"DUI-14-APPLET-GOVERNANCE","workstreamId":"DUI-APPLETS","path":"tasks/DUI-14-APPLET-GOVERNANCE.md","dependsOn":["DUI-12-APPLET-CATALOG","DUI-13-APPLET-RUNTIME"]},{"id":"DUI-15-ADVANCED-SETTINGS","workstreamId":"DUI-SETTINGS","path":"tasks/DUI-15-ADVANCED-SETTINGS.md","dependsOn":[]},{"id":"DUI-16-NETWORK-DISCOVERY","workstreamId":"DUI-NETWORK","path":"tasks/DUI-16-NETWORK-DISCOVERY.md","dependsOn":[]},{"id":"DUI-17-NETWORK-MEMBERSHIP","workstreamId":"DUI-NETWORK","path":"tasks/DUI-17-NETWORK-MEMBERSHIP.md","dependsOn":["DUI-16-NETWORK-DISCOVERY"]},{"id":"DUI-18-SHELL-PROTOTYPE","workstreamId":"DUI-PROTOTYPES","path":"tasks/DUI-18-SHELL-PROTOTYPE.md","dependsOn":["DUI-01-PROFILE-NOTIFICATIONS","DUI-02-IDENTITY-TRUST","DUI-03-LOGIN-GENERAL","DUI-15-ADVANCED-SETTINGS","DUI-16-NETWORK-DISCOVERY","DUI-17-NETWORK-MEMBERSHIP"]},{"id":"DUI-19-PRODUCT-PROTOTYPES","workstreamId":"DUI-PROTOTYPES","path":"tasks/DUI-19-PRODUCT-PROTOTYPES.md","dependsOn":["DUI-04-CHAT-INTERACTIONS","DUI-05-SOCIAL-RELATIONSHIPS","DUI-06-GROUP-LIFECYCLE","DUI-07-CHAT-SAFETY-CALLS","DUI-08-AI-CONFIG","DUI-09-AGENT-PROFILE","DUI-10-AGENT-RUNTIME","DUI-11-AGENT-SURFACES","DUI-12-APPLET-CATALOG","DUI-13-APPLET-RUNTIME","DUI-14-APPLET-GOVERNANCE"]},{"id":"DUI-20-NATIVE-AGGREGATE","workstreamId":"DUI-PROOF","path":"tasks/DUI-20-NATIVE-AGGREGATE.md","dependsOn":["DUI-18-SHELL-PROTOTYPE","DUI-19-PRODUCT-PROTOTYPES"]},{"id":"DUI-21-FINAL-ACCEPTANCE","workstreamId":"DUI-PROOF","path":"tasks/DUI-21-FINAL-ACCEPTANCE.md","dependsOn":["DUI-20-NATIVE-AGGREGATE"]}],"authorization":{"checkpoint":{"localCommit":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["chat-native-disposable","chat-native-four","three"],"destructiveResetScopes":[]},"history":{"rewrite":"denied"}},"amendments":[{"id":"amendment-20261014134411693-3ca1783bf51c1e92c6cd074ff3808e01","createdAt":"2026-10-14T13:44:11.693Z","actor":"acceptance@test.invalid","reason":"dui02_writeset_gap","changes":["add_prototype_shell_and_ledger_write_paths"],"impact":{"taskIds":["DUI-02-IDENTITY-TRUST"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"61456fc7cd16f93341294ee7247d9843dbaa81beb03a65fe858d941fa99e2c65","toContentDigest":"284dd536688efc8d7b605c8a0c8f560fe7a5f03ed57ba1bdaf83f2c70a9e85e0"},{"id":"amendment-20261014134744567-4b256c7726b6af746525530675461d68","createdAt":"2026-10-14T13:47:44.567Z","actor":"acceptance@test.invalid","reason":"preserve_active_dui02_slice_after_writeset_amendment","changes":["order_dui02_before_parallel_dui01"],"impact":{"taskIds":[],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"284dd536688efc8d7b605c8a0c8f560fe7a5f03ed57ba1bdaf83f2c70a9e85e0","toContentDigest":"7c450003ff88ff7a8dac747fca7d8a352f8d107de5b20ba6abae4010c26f2eb8"},{"id":"amendment-20261014134900341-db5397e1dc986fc082b10fe7fc43835f","createdAt":"2026-10-14T13:49:00.341Z","actor":"acceptance@test.invalid","reason":"dui02_row_review_inventory_refresh","changes":["record_reviewed_dispositions_for_c10_c18_and_c25"],"impact":{"taskIds":["DUI-02-IDENTITY-TRUST"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"7c450003ff88ff7a8dac747fca7d8a352f8d107de5b20ba6abae4010c26f2eb8","toContentDigest":"ead1b4331fc9a53a310f26c999f4f088a80a2b1505d75ac98143bd623bd74b30"},{"id":"amendment-20261014135020985-bfe8453658a7a99e657c3e84b798476b","createdAt":"2026-10-14T13:50:20.985Z","actor":"acceptance@test.invalid","reason":"dui01_writeset_gap","changes":["add_prototype_shell_and_ledger_write_paths"],"impact":{"taskIds":["DUI-01-PROFILE-NOTIFICATIONS"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"ead1b4331fc9a53a310f26c999f4f088a80a2b1505d75ac98143bd623bd74b30","toContentDigest":"3630d8c6315e90436f7f8eee349b918ee4d52e8ea2e953ec2aed1e10730a12fc"},{"id":"amendment-20261014151027683-f13766609f6bde178e2999505d096384","createdAt":"2026-10-14T15:10:27.683Z","actor":"acceptance@test.invalid","reason":"owner_authorized_local_checkpoint","changes":["allow_local_checkpoint_for_exact_source_native_acceptance"],"impact":{"taskIds":[],"gateIds":[]},"approval":{"kind":"owner","decisionRef":"user-20261014-authorize-local-checkpoint-and-continue"},"fromContentDigest":"3630d8c6315e90436f7f8eee349b918ee4d52e8ea2e953ec2aed1e10730a12fc","toContentDigest":"97e0c96214b0353f5fd4a736eb601e4e0a967044e0417c9c9441fe444c47dd6c"},{"id":"amendment-20261014153059807-302962f1bb9a65412519c601c6373659","createdAt":"2026-10-14T15:30:59.807Z","actor":"acceptance@test.invalid","reason":"dui02_development_runner_plan_projection_gap","changes":["add_local_dev_runner_scope_and_source_check"],"impact":{"taskIds":["DUI-01-PROFILE-NOTIFICATIONS","DUI-02-IDENTITY-TRUST","DUI-03-LOGIN-GENERAL","DUI-04-CHAT-INTERACTIONS","DUI-05-SOCIAL-RELATIONSHIPS","DUI-06-GROUP-LIFECYCLE","DUI-07-CHAT-SAFETY-CALLS","DUI-08-AI-CONFIG","DUI-09-AGENT-PROFILE","DUI-10-AGENT-RUNTIME","DUI-11-AGENT-SURFACES","DUI-12-APPLET-CATALOG","DUI-13-APPLET-RUNTIME","DUI-14-APPLET-GOVERNANCE","DUI-15-ADVANCED-SETTINGS","DUI-16-NETWORK-DISCOVERY","DUI-17-NETWORK-MEMBERSHIP","DUI-18-SHELL-PROTOTYPE","DUI-19-PRODUCT-PROTOTYPES","DUI-20-NATIVE-AGGREGATE","DUI-21-FINAL-ACCEPTANCE"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"97e0c96214b0353f5fd4a736eb601e4e0a967044e0417c9c9441fe444c47dd6c","toContentDigest":"1f6bc383cf7fc33072127105b4bc44c4f6c325e5fb07737df6523982c0a70be0"},{"id":"amendment-20261014153949118-aa7786be1c536c119e1394ed603c06dc","createdAt":"2026-10-14T15:39:49.118Z","actor":"acceptance@test.invalid","reason":"mount","changes":["active"],"impact":{"taskIds":["DUI-01-PROFILE-NOTIFICATIONS","DUI-02-IDENTITY-TRUST","DUI-03-LOGIN-GENERAL","DUI-04-CHAT-INTERACTIONS","DUI-05-SOCIAL-RELATIONSHIPS","DUI-06-GROUP-LIFECYCLE","DUI-07-CHAT-SAFETY-CALLS","DUI-08-AI-CONFIG","DUI-09-AGENT-PROFILE","DUI-10-AGENT-RUNTIME","DUI-11-AGENT-SURFACES","DUI-12-APPLET-CATALOG","DUI-13-APPLET-RUNTIME","DUI-14-APPLET-GOVERNANCE","DUI-15-ADVANCED-SETTINGS","DUI-16-NETWORK-DISCOVERY","DUI-17-NETWORK-MEMBERSHIP","DUI-18-SHELL-PROTOTYPE","DUI-19-PRODUCT-PROTOTYPES","DUI-20-NATIVE-AGGREGATE","DUI-21-FINAL-ACCEPTANCE"],"gateIds":["acceptance-infra-validation","acceptance-plan-self","agent-dogfood-e2e","agent-domain-validation","agent-ecosystem-e2e","agent-memory-e2e","agent-native-turn-e2e","agent-orchestration-e2e","agent-provider-credential-e2e","agent-quick-completion-e2e","agent-skill-e2e","agent-v2-capability-binding-e2e","agent-v2-evaluation-lab-e2e","agent-v2-home-command-center-e2e","agent-v2-mcp-lifecycle-e2e","agent-workspace-e2e","applet-desktop-lifecycle-smoothness","applet-domain-validation","architecture-module-governance","chat-contact-message-resilience-e2e","chat-domain-validation","chat-lifecycle-call-resolution-e2e","chat-lifecycle-group-live-e2e","chat-lifecycle-rich-voice-e2e","chat-lifecycle-safety-e2e","chat-native-current-profile-two-client-e2e","chat-native-group-mls-e2e","chat-native-interactions-e2e","chat-native-multi-device-e2e","chat-native-product-closure-e2e","chat-native-recovery-e2e","chat-storage-batch-clear-aggregate-e2e","chat-storage-governance-aggregate-e2e","desktop-check","desktop-primary-navigation-e2e","desktop-release-build","development-workflow-control-plane","federation-domain-validation","social-domain-validation","station-access-auth-e2e","station-access-desktop-oauth-native-e2e","station-access-federation-boundary-e2e","station-access-lifecycle-aggregate-e2e","station-dashboard-web-check","station-federation-unit"]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"1f6bc383cf7fc33072127105b4bc44c4f6c325e5fb07737df6523982c0a70be0","toContentDigest":"b00d5b866752b54539a0dfbb0c1bf6c60537acd40d80434007481a0c56325a76"},{"id":"amendment-20261014161057417-63478460aa3aa3dc7e9e937ce956993d","createdAt":"2026-10-14T16:10:57.417Z","actor":"acceptance@test.invalid","reason":"development_workflow_capacity_and_handoff_repair","changes":["expand_bounded_plan_capacity_and_stage_blocked_task_handoff"],"impact":{"taskIds":["DUI-01-PROFILE-NOTIFICATIONS","DUI-02-IDENTITY-TRUST","DUI-03-LOGIN-GENERAL","DUI-04-CHAT-INTERACTIONS","DUI-05-SOCIAL-RELATIONSHIPS","DUI-06-GROUP-LIFECYCLE","DUI-07-CHAT-SAFETY-CALLS","DUI-08-AI-CONFIG","DUI-09-AGENT-PROFILE","DUI-10-AGENT-RUNTIME","DUI-11-AGENT-SURFACES","DUI-12-APPLET-CATALOG","DUI-13-APPLET-RUNTIME","DUI-14-APPLET-GOVERNANCE","DUI-15-ADVANCED-SETTINGS","DUI-16-NETWORK-DISCOVERY","DUI-17-NETWORK-MEMBERSHIP","DUI-18-SHELL-PROTOTYPE","DUI-19-PRODUCT-PROTOTYPES","DUI-20-NATIVE-AGGREGATE","DUI-21-FINAL-ACCEPTANCE"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"b00d5b866752b54539a0dfbb0c1bf6c60537acd40d80434007481a0c56325a76","toContentDigest":"5a25d6aed628d985d0959d97ebb173177a2342786679fcbb791ac8556f74e0b8"},{"id":"amendment-20261014161548020-1cf74e561f98bcb828ab44d1240b1add","createdAt":"2026-10-14T16:15:48.020Z","actor":"acceptance@test.invalid","reason":"development_workflow_make_and_skill_scope","changes":["add_make_and_canonical_skill_write_paths"],"impact":{"taskIds":["DUI-01-PROFILE-NOTIFICATIONS","DUI-02-IDENTITY-TRUST","DUI-03-LOGIN-GENERAL","DUI-04-CHAT-INTERACTIONS","DUI-05-SOCIAL-RELATIONSHIPS","DUI-06-GROUP-LIFECYCLE","DUI-07-CHAT-SAFETY-CALLS","DUI-08-AI-CONFIG","DUI-09-AGENT-PROFILE","DUI-10-AGENT-RUNTIME","DUI-11-AGENT-SURFACES","DUI-12-APPLET-CATALOG","DUI-13-APPLET-RUNTIME","DUI-14-APPLET-GOVERNANCE","DUI-15-ADVANCED-SETTINGS","DUI-16-NETWORK-DISCOVERY","DUI-17-NETWORK-MEMBERSHIP","DUI-18-SHELL-PROTOTYPE","DUI-19-PRODUCT-PROTOTYPES","DUI-20-NATIVE-AGGREGATE","DUI-21-FINAL-ACCEPTANCE"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"5a25d6aed628d985d0959d97ebb173177a2342786679fcbb791ac8556f74e0b8","toContentDigest":"7d1712629ae648d71bcd7e670827d30c8fe4e38fb1cbec99ec69fc4ad9214458"},{"id":"amendment-20261014162419671-6c6e8a789d8e55b1981a8daca63a4f8f","createdAt":"2026-10-14T16:24:19.671Z","actor":"acceptance@test.invalid","reason":"record_development_workflow_d44","changes":["bind_capacity_and_staged_handoff_decision"],"impact":{"taskIds":["DUI-01-PROFILE-NOTIFICATIONS","DUI-02-IDENTITY-TRUST","DUI-03-LOGIN-GENERAL","DUI-04-CHAT-INTERACTIONS","DUI-05-SOCIAL-RELATIONSHIPS","DUI-06-GROUP-LIFECYCLE","DUI-07-CHAT-SAFETY-CALLS","DUI-08-AI-CONFIG","DUI-09-AGENT-PROFILE","DUI-10-AGENT-RUNTIME","DUI-11-AGENT-SURFACES","DUI-12-APPLET-CATALOG","DUI-13-APPLET-RUNTIME","DUI-14-APPLET-GOVERNANCE","DUI-15-ADVANCED-SETTINGS","DUI-16-NETWORK-DISCOVERY","DUI-17-NETWORK-MEMBERSHIP","DUI-18-SHELL-PROTOTYPE","DUI-19-PRODUCT-PROTOTYPES","DUI-20-NATIVE-AGGREGATE","DUI-21-FINAL-ACCEPTANCE"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"7d1712629ae648d71bcd7e670827d30c8fe4e38fb1cbec99ec69fc4ad9214458","toContentDigest":"7f026fa03594c66e1571a51e01863d4727740f1fb045589d700e5508cb860f30"},{"id":"amendment-20261014165428633-a1dd826e559ef9c0f5baa4965326526e","createdAt":"2026-10-14T16:54:28.633Z","actor":"acceptance@test.invalid","reason":"normalize-DUI02-runtime-profile-identity","changes":["bind-real-Profile-IDs-and-owner-forwarding"],"impact":{"taskIds":[],"gateIds":[]},"approval":{"kind":"owner","decisionRef":"user-20261014-execute-111-ledger-with-row-review"},"fromContentDigest":"7f026fa03594c66e1571a51e01863d4727740f1fb045589d700e5508cb860f30","toContentDigest":"12f2220cb69f08cbe1d8864847711dd7a440002e6beb94358b4dbbf7e66d4623"},{"id":"amendment-20261014170756802-b8f94c9a80e3dab61a6bb7acfa5b1e15","createdAt":"2026-10-14T17:07:56.802Z","actor":"acceptance@test.invalid","reason":"dui02-review-freshness-scope","changes":["add-GitHub-review-freshness-write-path"],"impact":{"taskIds":["DUI-02-IDENTITY-TRUST"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"12f2220cb69f08cbe1d8864847711dd7a440002e6beb94358b4dbbf7e66d4623","toContentDigest":"b835e5d0a271ebe9216d11c710ee260c2b6bd929113cd9b45a752558671c894c"},{"id":"amendment-20261014182920042-49da9c71a745b5edd2d5cd1bd65ea977","createdAt":"2026-10-14T18:29:20.042Z","actor":"acceptance@test.invalid","reason":"dui02-owner-quoted-json-binding","changes":["add-quoted-json-parser-fix-scope"],"impact":{"taskIds":["DUI-02-IDENTITY-TRUST"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"b835e5d0a271ebe9216d11c710ee260c2b6bd929113cd9b45a752558671c894c","toContentDigest":"b85f5741a094eeb16e7e902748fe4ea6df9891d259ef5e1dad286fb763d53a22"},{"id":"amendment-20261014184154717-06ac36e034e4066d38af6871f33887c2","createdAt":"2026-10-14T18:41:54.717Z","actor":"acceptance@test.invalid","reason":"dui02-shell-action-context","changes":["include-local-dev-shell-context-owner"],"impact":{"taskIds":["DUI-02-IDENTITY-TRUST"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"b85f5741a094eeb16e7e902748fe4ea6df9891d259ef5e1dad286fb763d53a22","toContentDigest":"15d9f4c5577587765ae9cb7fb41caaf62c3901d2a74a04b6f27557da1e5ad0c7"},{"id":"amendment-20261014190629380-a540c94e29a9623a3a099b4cfea2e23f","createdAt":"2026-10-14T19:06:29.380Z","actor":"acceptance@test.invalid","reason":"development-runner-mounted-plan-projection-gap","changes":["add-current-runner-projection-fix-paths"],"impact":{"taskIds":["DUI-02-IDENTITY-TRUST"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"15d9f4c5577587765ae9cb7fb41caaf62c3901d2a74a04b6f27557da1e5ad0c7","toContentDigest":"028d4e1e0e2d4fe4023593c810e60def22fb42869741ed1a8011b5ae0052a0f1"},{"id":"amendment-20261014191053293-0fb0db953796144187b7157909e4fdc7","createdAt":"2026-10-14T19:10:53.293Z","actor":"acceptance@test.invalid","reason":"current-task-registry-dependency-gaps","changes":["declare-impact-dependencies-in-full-only"],"impact":{"taskIds":["DUI-01-PROFILE-NOTIFICATIONS","DUI-02-IDENTITY-TRUST","DUI-03-LOGIN-GENERAL","DUI-04-CHAT-INTERACTIONS","DUI-05-SOCIAL-RELATIONSHIPS","DUI-06-GROUP-LIFECYCLE","DUI-07-CHAT-SAFETY-CALLS","DUI-08-AI-CONFIG","DUI-09-AGENT-PROFILE","DUI-10-AGENT-RUNTIME","DUI-11-AGENT-SURFACES","DUI-12-APPLET-CATALOG","DUI-13-APPLET-RUNTIME","DUI-14-APPLET-GOVERNANCE","DUI-15-ADVANCED-SETTINGS","DUI-16-NETWORK-DISCOVERY","DUI-17-NETWORK-MEMBERSHIP","DUI-18-SHELL-PROTOTYPE","DUI-19-PRODUCT-PROTOTYPES","DUI-20-NATIVE-AGGREGATE","DUI-21-FINAL-ACCEPTANCE"],"gateIds":["acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","agent-dogfood-e2e","agent-domain-validation","agent-ecosystem-e2e","agent-memory-e2e","agent-native-turn-e2e","agent-orchestration-e2e","agent-provider-credential-e2e","agent-quick-completion-e2e","agent-skill-e2e","agent-stream-resilience-e2e","agent-v2-capability-binding-e2e","agent-v2-evaluation-lab-e2e","agent-v2-home-command-center-e2e","agent-v2-mcp-lifecycle-e2e","agent-workspace-e2e","applet-desktop-lifecycle-smoothness","applet-domain-validation","architecture-module-governance","chat-contact-message-resilience-e2e","chat-domain-validation","chat-lifecycle-call-resolution-e2e","chat-lifecycle-direct-e2e","chat-lifecycle-group-live-e2e","chat-lifecycle-onboarding-e2e","chat-lifecycle-rich-voice-e2e","chat-lifecycle-safety-e2e","chat-lifecycle-tree-zero-reference-e2e","chat-native-current-profile-two-client-e2e","chat-native-group-mls-e2e","chat-native-interactions-e2e","chat-native-multi-device-e2e","chat-native-product-closure-e2e","chat-native-recovery-e2e","chat-native-two-client-e2e","chat-native-visible-static","chat-storage-batch-clear-aggregate-e2e","chat-storage-desktop-batch-clear-e2e","chat-storage-governance-aggregate-e2e","chat-storage-mobile-batch-clear-e2e","chat-storage-zero-legacy-e2e","desktop-check","desktop-dev-runtime-isolation-static","desktop-primary-navigation-e2e","desktop-release-build","development-workflow-control-plane","federation-domain-validation","machine-dev-registry-self","mobile-hard-cut-static","mobile-ios-simulator-layout-accessibility-e2e","mobile-simulator-platform-e2e","social-domain-validation","station-access-auth-e2e","station-access-capability-contract","station-access-desktop-oauth-native-e2e","station-access-federation-boundary-e2e","station-access-lifecycle-aggregate-e2e","station-access-scope-isolation-e2e","station-agent-unit","station-api-ownership","station-dashboard-web-check","station-federation-unit"]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"028d4e1e0e2d4fe4023593c810e60def22fb42869741ed1a8011b5ae0052a0f1","toContentDigest":"91fe036b8f99316bb2ced3a1b3213c5b22ca4edc8348becdcd47fb24a00027e1"},{"id":"amendment-20261014195719991-7f2cca60403bd88f7f44132a4e97e696","createdAt":"2026-10-14T19:57:19.991Z","actor":"acceptance@test.invalid","reason":"dui01_source_backed_notification_producer_and_native_proof","changes":["include_social_post_commit_owner_and_focused_projection_checks"],"impact":{"taskIds":["DUI-01-PROFILE-NOTIFICATIONS"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"91fe036b8f99316bb2ced3a1b3213c5b22ca4edc8348becdcd47fb24a00027e1","toContentDigest":"a34968a7feeb24bfe692030157a5ccede851f533d709a2976648decd79d611df"},{"id":"amendment-20261014200528661-d03726379c141f830a0f9e2fee2a3beb","createdAt":"2026-10-14T20:05:28.661Z","actor":"acceptance@test.invalid","reason":"compiler_test_operands_misclassified_as_write_paths","changes":["repair_go_and_cargo_operand_recognition_for_authorized_focused_checks"],"impact":{"taskIds":["DUI-01-PROFILE-NOTIFICATIONS"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"a34968a7feeb24bfe692030157a5ccede851f533d709a2976648decd79d611df","toContentDigest":"a3d3bd12a9cc5632574b22c36a3dac63dfbcf0fdfd065f36230c970a7bec5248"},{"id":"amendment-20261014200629625-e47e8040445bff559e850ddee123d5fd","createdAt":"2026-10-14T20:06:29.625Z","actor":"acceptance@test.invalid","reason":"focused_test_path_locator","changes":["use_existing_workflow_tool_intent_test_module"],"impact":{"taskIds":["DUI-01-PROFILE-NOTIFICATIONS"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"a3d3bd12a9cc5632574b22c36a3dac63dfbcf0fdfd065f36230c970a7bec5248","toContentDigest":"f31b5bb95a25c4ddf430f8f1063751b50a3fff0d6afb7dd6fc8b10c1b9512b4d"},{"id":"amendment-20261015000223162-57161795d2f6e2c167c6d8e36512c644","createdAt":"2026-10-15T00:02:23.162Z","actor":"acceptance@test.invalid","reason":"dui01_reusable_native_profile_notification_proof","changes":["add_dedicated_native_gate_and_suite_reuse_correct_unit_check_classification"],"impact":{"taskIds":["DUI-01-PROFILE-NOTIFICATIONS","DUI-02-IDENTITY-TRUST","DUI-03-LOGIN-GENERAL","DUI-04-CHAT-INTERACTIONS","DUI-05-SOCIAL-RELATIONSHIPS","DUI-06-GROUP-LIFECYCLE","DUI-07-CHAT-SAFETY-CALLS","DUI-08-AI-CONFIG","DUI-09-AGENT-PROFILE","DUI-10-AGENT-RUNTIME","DUI-11-AGENT-SURFACES","DUI-12-APPLET-CATALOG","DUI-13-APPLET-RUNTIME","DUI-14-APPLET-GOVERNANCE","DUI-15-ADVANCED-SETTINGS","DUI-16-NETWORK-DISCOVERY","DUI-17-NETWORK-MEMBERSHIP","DUI-18-SHELL-PROTOTYPE","DUI-19-PRODUCT-PROTOTYPES","DUI-20-NATIVE-AGGREGATE","DUI-21-FINAL-ACCEPTANCE"],"gateIds":["acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","agent-dogfood-e2e","agent-domain-validation","agent-ecosystem-e2e","agent-memory-e2e","agent-native-turn-e2e","agent-orchestration-e2e","agent-provider-credential-e2e","agent-quick-completion-e2e","agent-skill-e2e","agent-stream-resilience-e2e","agent-v2-capability-binding-e2e","agent-v2-evaluation-lab-e2e","agent-v2-home-command-center-e2e","agent-v2-mcp-lifecycle-e2e","agent-workspace-e2e","applet-desktop-lifecycle-smoothness","applet-domain-validation","architecture-module-governance","chat-contact-message-resilience-e2e","chat-domain-validation","chat-lifecycle-call-resolution-e2e","chat-lifecycle-direct-e2e","chat-lifecycle-group-live-e2e","chat-lifecycle-onboarding-e2e","chat-lifecycle-rich-voice-e2e","chat-lifecycle-safety-e2e","chat-lifecycle-tree-zero-reference-e2e","chat-native-current-profile-two-client-e2e","chat-native-group-mls-e2e","chat-native-interactions-e2e","chat-native-multi-device-e2e","chat-native-product-closure-e2e","chat-native-recovery-e2e","chat-native-two-client-e2e","chat-native-visible-static","chat-storage-batch-clear-aggregate-e2e","chat-storage-desktop-batch-clear-e2e","chat-storage-governance-aggregate-e2e","chat-storage-mobile-batch-clear-e2e","chat-storage-zero-legacy-e2e","desktop-check","desktop-dev-runtime-isolation-static","desktop-primary-navigation-e2e","desktop-profile-notifications-e2e","desktop-release-build","development-workflow-control-plane","federation-domain-validation","machine-dev-registry-self","mobile-hard-cut-static","mobile-ios-simulator-layout-accessibility-e2e","mobile-simulator-platform-e2e","social-domain-validation","station-access-auth-e2e","station-access-capability-contract","station-access-desktop-oauth-native-e2e","station-access-federation-boundary-e2e","station-access-lifecycle-aggregate-e2e","station-access-scope-isolation-e2e","station-agent-unit","station-api-ownership","station-dashboard-web-check","station-federation-unit"]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"f31b5bb95a25c4ddf430f8f1063751b50a3fff0d6afb7dd6fc8b10c1b9512b4d","toContentDigest":"fd23303dec5539e08d457ae583451f6c821db350046d43385809bde4ea640dc9"},{"id":"amendment-20261015002041570-3cffd4ff2d226572f3b62acc46f5b02c","createdAt":"2026-10-15T00:20:41.570Z","actor":"acceptance@test.invalid","reason":"dui01_suite_lifecycle_source_regressions","changes":["verify_no_partial_publication_and_cleanup_failure_ordering"],"impact":{"taskIds":["DUI-01-PROFILE-NOTIFICATIONS"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"fd23303dec5539e08d457ae583451f6c821db350046d43385809bde4ea640dc9","toContentDigest":"bfdce5bc070ffefc52a1b85c9ce8daa23333cf4def2cce8f80004873cddc9ae0"},{"id":"amendment-20261015003717742-5e19318758315a3e6e38974972b46ac2","createdAt":"2026-10-15T00:37:17.742Z","actor":"acceptance@test.invalid","reason":"dui01-canonical-plan-audit-and-registry-dependencies","changes":["declare-full-impact-dependencies-and-generic-audit-repair-write-set"],"impact":{"taskIds":["DUI-01-PROFILE-NOTIFICATIONS","DUI-02-IDENTITY-TRUST","DUI-03-LOGIN-GENERAL","DUI-04-CHAT-INTERACTIONS","DUI-05-SOCIAL-RELATIONSHIPS","DUI-06-GROUP-LIFECYCLE","DUI-07-CHAT-SAFETY-CALLS","DUI-08-AI-CONFIG","DUI-09-AGENT-PROFILE","DUI-10-AGENT-RUNTIME","DUI-11-AGENT-SURFACES","DUI-12-APPLET-CATALOG","DUI-13-APPLET-RUNTIME","DUI-14-APPLET-GOVERNANCE","DUI-15-ADVANCED-SETTINGS","DUI-16-NETWORK-DISCOVERY","DUI-17-NETWORK-MEMBERSHIP","DUI-18-SHELL-PROTOTYPE","DUI-19-PRODUCT-PROTOTYPES","DUI-20-NATIVE-AGGREGATE","DUI-21-FINAL-ACCEPTANCE"],"gateIds":["acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","agent-attachment-e2e","agent-cli-provider-primary-native-e2e","agent-core-lifecycle-native-e2e","agent-dogfood-e2e","agent-domain-validation","agent-ecosystem-e2e","agent-marketplace-catalog-e2e","agent-memory-e2e","agent-minimum-usable-chat-native-e2e","agent-native-knowledge-binding-e2e","agent-native-turn-e2e","agent-orchestration-e2e","agent-provider-credential-e2e","agent-quick-completion-e2e","agent-skill-e2e","agent-stream-resilience-e2e","agent-v2-capability-binding-e2e","agent-v2-evaluation-lab-e2e","agent-v2-external-runtime-e2e","agent-v2-home-command-center-e2e","agent-v2-kernel-foundation-e2e","agent-v2-mcp-lifecycle-e2e","agent-workspace-e2e","applet-desktop-lifecycle-smoothness","applet-domain-validation","architecture-module-governance","chat-contact-message-resilience-e2e","chat-domain-validation","chat-lifecycle-call-resolution-e2e","chat-lifecycle-direct-e2e","chat-lifecycle-group-live-e2e","chat-lifecycle-interactions-group-e2e","chat-lifecycle-live-voice-e2e","chat-lifecycle-mixed-client-cross-station-e2e","chat-lifecycle-mixed-client-group-mls-e2e","chat-lifecycle-mixed-client-multi-device-e2e","chat-lifecycle-mixed-client-same-station-e2e","chat-lifecycle-onboarding-e2e","chat-lifecycle-rich-voice-e2e","chat-lifecycle-safety-e2e","chat-lifecycle-tree-zero-reference-e2e","chat-native-current-profile-two-client-e2e","chat-native-group-mls-e2e","chat-native-interactions-e2e","chat-native-multi-device-e2e","chat-native-product-closure-e2e","chat-native-recovery-e2e","chat-native-submitted-command-recovery-e2e","chat-native-two-client-e2e","chat-native-typing-e2e","chat-native-visible-static","chat-presence-layout-e2e","chat-storage-accounting-e2e","chat-storage-batch-clear-aggregate-e2e","chat-storage-cache-clear-e2e","chat-storage-contract","chat-storage-dead-contract-zero-e2e","chat-storage-delete-reclaim-e2e","chat-storage-desktop-batch-clear-e2e","chat-storage-governance-aggregate-e2e","chat-storage-mobile-batch-clear-e2e","chat-storage-redaction-recovery-e2e","chat-storage-retention-e2e","chat-storage-zero-legacy-e2e","desktop-check","desktop-dev-runtime-isolation-static","desktop-dev-runtime-multi-instance","desktop-primary-navigation-e2e","desktop-profile-notifications-e2e","desktop-release-build","desktop-rust-check","development-workflow-control-plane","federation-domain-validation","machine-dev-registry-self","messaging-platform-contract","mobile-contract-static","mobile-hard-cut-static","mobile-identity-contract","mobile-ios-simulator-layout-accessibility-e2e","mobile-native-build","mobile-simulator-access-e2e","mobile-simulator-platform-e2e","mobile-simulator-recovery-e2e","mobile-simulator-recovery-ui-e2e","mobile-simulator-social-convergence-e2e","mobile-simulator-station-lifecycle-e2e","oauth-login-broker-architecture","oauth-login-broker-contract","oauth-login-broker-durable-login","oauth-login-broker-handoff-contract","oauth-login-broker-key-rotation","oauth-login-broker-operator","oauth-login-broker-provider-identity","oauth-login-broker-refresh-idempotency","oauth2-client-live-api-repository","proto-build","social-domain-validation","social-private-desktop-e2e","station-access-auth-e2e","station-access-capability-contract","station-access-desktop-oauth-native-e2e","station-access-domain-validation","station-access-federation-boundary-e2e","station-access-lifecycle-aggregate-e2e","station-access-scope-isolation-e2e","station-access-session-class-e2e","station-agent-unit","station-api-ownership","station-dashboard-web-check","station-federation-unit","station-messaging-unit"]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"bfdce5bc070ffefc52a1b85c9ce8daa23333cf4def2cce8f80004873cddc9ae0","toContentDigest":"952c3c38cb2c766ce05f9a021cb3394323fbafdd233ad7cab13aed9f6e7022b7"},{"id":"amendment-20261015015952049-419b18d70f2961f22a288b31744f8767","createdAt":"2026-10-15T01:59:52.049Z","actor":"acceptance@test.invalid","reason":"dui01-isolated-python-runtime-binding","changes":["bind-pinned-acceptance-venv-in-make-entrypoints"],"impact":{"taskIds":["DUI-01-PROFILE-NOTIFICATIONS"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"952c3c38cb2c766ce05f9a021cb3394323fbafdd233ad7cab13aed9f6e7022b7","toContentDigest":"4c97fc37f9f82dc176143ff7dfcdc5b24fc4192ef9f05c3330c56d649f46cc3b"},{"id":"amendment-20261016000145694-8bfc445457790e50f9e7b7f917214f72","createdAt":"2026-10-16T00:01:45.694Z","actor":"acceptance@test.invalid","reason":"Deterministic Core idle-channel expiry prevents successful Login closure cleanup","changes":["Extend DUI-03 writeSet with generic launch-context lifecycle, synthetic regression, and governing deadline contract","Add focused launch-context source check while preserving the accepted North Star and all product proof requirements"],"impact":{"taskIds":["DUI-03-LOGIN-GENERAL"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"4c97fc37f9f82dc176143ff7dfcdc5b24fc4192ef9f05c3330c56d649f46cc3b","toContentDigest":"a128fe96b6d6a256059ce97a57e43d965eb4ca96f97904420e6c5b5129f0ce19"},{"id":"amendment-20261016002603366-589cd24c4ed5e2359ab4f5e0ba45b9f4","createdAt":"2026-10-16T00:26:03.366Z","actor":"agent","reason":"Add source regression for semantic focus policy before configured window creation","changes":["DUI03 startup check covers generated main window config, default semantic input, unchanged normal/exclusive behavior, and invalid mode rejection"],"impact":{"taskIds":["DUI-03-LOGIN-GENERAL"],"gateIds":[]},"approval":{"kind":"agent","decisionRef":null},"fromContentDigest":"a128fe96b6d6a256059ce97a57e43d965eb4ca96f97904420e6c5b5129f0ce19","toContentDigest":"0b8b4715bfde0b3443112e6739c9887b25bf36ae7602cfa0409b729bbb1c4439"}],"northStarApproval":{"northStarDigest":"cd237ce4cffe285e2f2b68a673fd550ee611bd046532552a19c0bae8d9614868","approvedBy":"user","approvedAt":"2026-10-14T13:36:14.313Z","decisionRef":"user-20261014-execute-111-ledger-with-row-review"},"criterionCoverage":[{"criterionId":"DUI-NS-01","taskIds":["DUI-01-PROFILE-NOTIFICATIONS","DUI-02-IDENTITY-TRUST","DUI-03-LOGIN-GENERAL","DUI-04-CHAT-INTERACTIONS","DUI-05-SOCIAL-RELATIONSHIPS","DUI-06-GROUP-LIFECYCLE","DUI-07-CHAT-SAFETY-CALLS","DUI-08-AI-CONFIG","DUI-09-AGENT-PROFILE","DUI-10-AGENT-RUNTIME","DUI-11-AGENT-SURFACES","DUI-12-APPLET-CATALOG","DUI-13-APPLET-RUNTIME","DUI-14-APPLET-GOVERNANCE","DUI-15-ADVANCED-SETTINGS","DUI-16-NETWORK-DISCOVERY","DUI-17-NETWORK-MEMBERSHIP","DUI-18-SHELL-PROTOTYPE","DUI-19-PRODUCT-PROTOTYPES","DUI-20-NATIVE-AGGREGATE","DUI-21-FINAL-ACCEPTANCE"],"closureIds":["dui-profile-notifications","dui-identity-trust","dui-login-general","dui-chat-interactions","dui-social-relationships","dui-group-lifecycle","dui-chat-safety-calls","dui-ai-config","dui-agent-profile","dui-agent-runtime","dui-agent-surfaces","dui-applet-catalog","dui-applet-runtime","dui-applet-governance","dui-advanced-settings","dui-network-discovery","dui-network-membership","dui-shell-prototype","dui-product-prototypes","dui-native-aggregate","dui-final-acceptance"],"gateIds":["desktop-check","station-access-auth-e2e","chat-native-multi-device-e2e","chat-native-recovery-e2e","development-workflow-control-plane","station-access-desktop-oauth-native-e2e","desktop-primary-navigation-e2e","chat-native-interactions-e2e","chat-contact-message-resilience-e2e","chat-lifecycle-rich-voice-e2e","chat-native-group-mls-e2e","chat-storage-governance-aggregate-e2e","chat-lifecycle-safety-e2e","chat-lifecycle-group-live-e2e","chat-lifecycle-call-resolution-e2e","agent-provider-credential-e2e","agent-memory-e2e","agent-skill-e2e","agent-v2-mcp-lifecycle-e2e","agent-v2-capability-binding-e2e","agent-quick-completion-e2e","agent-workspace-e2e","agent-native-turn-e2e","agent-orchestration-e2e","agent-v2-evaluation-lab-e2e","agent-v2-home-command-center-e2e","agent-ecosystem-e2e","applet-domain-validation","applet-desktop-lifecycle-smoothness","chat-storage-batch-clear-aggregate-e2e","station-federation-unit","federation-domain-validation","station-access-federation-boundary-e2e","station-dashboard-web-check","chat-native-product-closure-e2e","agent-dogfood-e2e","chat-native-current-profile-two-client-e2e","station-access-lifecycle-aggregate-e2e","desktop-release-build","acceptance-plan-self","acceptance-infra-validation","architecture-module-governance","chat-domain-validation","social-domain-validation","agent-domain-validation","desktop-profile-notifications-e2e"]}]}
```

## Acceptance Execution

```json
{
  "closures": {
    "dui-profile-notifications": [
      "desktop-check",
      "desktop-profile-notifications-e2e"
    ],
    "dui-identity-trust": [
      "station-access-auth-e2e",
      "chat-native-multi-device-e2e",
      "chat-native-recovery-e2e",
      "development-workflow-control-plane"
    ],
    "dui-login-general": [
      "station-access-desktop-oauth-native-e2e",
      "desktop-primary-navigation-e2e"
    ],
    "dui-chat-interactions": [
      "chat-native-interactions-e2e"
    ],
    "dui-social-relationships": [
      "chat-contact-message-resilience-e2e",
      "chat-lifecycle-rich-voice-e2e"
    ],
    "dui-group-lifecycle": [
      "chat-native-group-mls-e2e",
      "chat-storage-governance-aggregate-e2e"
    ],
    "dui-chat-safety-calls": [
      "chat-lifecycle-safety-e2e",
      "chat-lifecycle-group-live-e2e",
      "chat-lifecycle-call-resolution-e2e"
    ],
    "dui-ai-config": [
      "agent-provider-credential-e2e",
      "agent-memory-e2e",
      "agent-skill-e2e",
      "agent-v2-mcp-lifecycle-e2e"
    ],
    "dui-agent-profile": [
      "agent-v2-capability-binding-e2e",
      "agent-quick-completion-e2e",
      "agent-workspace-e2e"
    ],
    "dui-agent-runtime": [
      "agent-native-turn-e2e",
      "agent-orchestration-e2e"
    ],
    "dui-agent-surfaces": [
      "agent-v2-evaluation-lab-e2e",
      "agent-v2-home-command-center-e2e",
      "agent-ecosystem-e2e"
    ],
    "dui-applet-catalog": [
      "applet-domain-validation",
      "applet-desktop-lifecycle-smoothness"
    ],
    "dui-applet-runtime": [
      "applet-desktop-lifecycle-smoothness"
    ],
    "dui-applet-governance": [
      "applet-desktop-lifecycle-smoothness",
      "applet-domain-validation"
    ],
    "dui-advanced-settings": [
      "desktop-check",
      "chat-storage-batch-clear-aggregate-e2e"
    ],
    "dui-network-discovery": [
      "station-federation-unit",
      "federation-domain-validation"
    ],
    "dui-network-membership": [
      "station-access-federation-boundary-e2e",
      "station-dashboard-web-check",
      "federation-domain-validation"
    ],
    "dui-shell-prototype": [
      "desktop-primary-navigation-e2e",
      "desktop-check"
    ],
    "dui-product-prototypes": [
      "chat-native-product-closure-e2e",
      "agent-dogfood-e2e",
      "applet-desktop-lifecycle-smoothness"
    ],
    "dui-native-aggregate": [
      "chat-native-current-profile-two-client-e2e",
      "station-access-lifecycle-aggregate-e2e",
      "desktop-release-build"
    ],
    "dui-final-acceptance": [
      "acceptance-plan-self",
      "acceptance-infra-validation",
      "architecture-module-governance",
      "chat-domain-validation",
      "social-domain-validation",
      "agent-domain-validation",
      "applet-domain-validation",
      "federation-domain-validation",
      "desktop-release-build"
    ]
  },
  "completion": [
    "desktop-check",
    "station-access-auth-e2e",
    "chat-native-multi-device-e2e",
    "chat-native-recovery-e2e",
    "station-access-desktop-oauth-native-e2e",
    "desktop-primary-navigation-e2e",
    "chat-native-interactions-e2e",
    "chat-contact-message-resilience-e2e",
    "chat-lifecycle-rich-voice-e2e",
    "chat-native-group-mls-e2e",
    "chat-storage-governance-aggregate-e2e",
    "chat-lifecycle-safety-e2e",
    "chat-lifecycle-group-live-e2e",
    "chat-lifecycle-call-resolution-e2e",
    "agent-provider-credential-e2e",
    "agent-memory-e2e",
    "agent-skill-e2e",
    "agent-v2-mcp-lifecycle-e2e",
    "agent-v2-capability-binding-e2e",
    "agent-quick-completion-e2e",
    "agent-workspace-e2e",
    "agent-native-turn-e2e",
    "agent-orchestration-e2e",
    "agent-v2-evaluation-lab-e2e",
    "agent-v2-home-command-center-e2e",
    "agent-ecosystem-e2e",
    "applet-domain-validation",
    "applet-desktop-lifecycle-smoothness",
    "chat-storage-batch-clear-aggregate-e2e",
    "station-federation-unit",
    "federation-domain-validation",
    "station-access-federation-boundary-e2e",
    "station-dashboard-web-check",
    "chat-native-product-closure-e2e",
    "agent-dogfood-e2e",
    "chat-native-current-profile-two-client-e2e",
    "station-access-lifecycle-aggregate-e2e",
    "desktop-release-build",
    "acceptance-plan-self",
    "acceptance-infra-validation",
    "architecture-module-governance",
    "chat-domain-validation",
    "social-domain-validation",
    "agent-domain-validation",
    "desktop-profile-notifications-e2e"
  ],
  "full": [
    "desktop-check",
    "station-access-auth-e2e",
    "chat-native-multi-device-e2e",
    "chat-native-recovery-e2e",
    "station-access-desktop-oauth-native-e2e",
    "desktop-primary-navigation-e2e",
    "chat-native-interactions-e2e",
    "chat-contact-message-resilience-e2e",
    "chat-lifecycle-rich-voice-e2e",
    "chat-native-group-mls-e2e",
    "chat-storage-governance-aggregate-e2e",
    "chat-lifecycle-safety-e2e",
    "chat-lifecycle-group-live-e2e",
    "chat-lifecycle-call-resolution-e2e",
    "agent-provider-credential-e2e",
    "agent-memory-e2e",
    "agent-skill-e2e",
    "agent-v2-mcp-lifecycle-e2e",
    "agent-v2-capability-binding-e2e",
    "agent-quick-completion-e2e",
    "agent-workspace-e2e",
    "agent-native-turn-e2e",
    "agent-orchestration-e2e",
    "agent-v2-evaluation-lab-e2e",
    "agent-v2-home-command-center-e2e",
    "agent-ecosystem-e2e",
    "applet-domain-validation",
    "applet-desktop-lifecycle-smoothness",
    "chat-storage-batch-clear-aggregate-e2e",
    "station-federation-unit",
    "federation-domain-validation",
    "station-access-federation-boundary-e2e",
    "station-dashboard-web-check",
    "chat-native-product-closure-e2e",
    "agent-dogfood-e2e",
    "chat-native-current-profile-two-client-e2e",
    "station-access-lifecycle-aggregate-e2e",
    "desktop-release-build",
    "acceptance-plan-self",
    "acceptance-infra-validation",
    "architecture-module-governance",
    "chat-domain-validation",
    "social-domain-validation",
    "agent-domain-validation",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "agent-stream-resilience-e2e",
    "chat-lifecycle-direct-e2e",
    "chat-lifecycle-onboarding-e2e",
    "chat-lifecycle-tree-zero-reference-e2e",
    "chat-native-two-client-e2e",
    "chat-native-visible-static",
    "chat-storage-desktop-batch-clear-e2e",
    "chat-storage-mobile-batch-clear-e2e",
    "chat-storage-zero-legacy-e2e",
    "desktop-dev-runtime-isolation-static",
    "machine-dev-registry-self",
    "mobile-hard-cut-static",
    "mobile-ios-simulator-layout-accessibility-e2e",
    "mobile-simulator-platform-e2e",
    "station-access-capability-contract",
    "station-access-scope-isolation-e2e",
    "station-agent-unit",
    "station-api-ownership",
    "desktop-profile-notifications-e2e",
    "agent-attachment-e2e",
    "agent-cli-provider-primary-native-e2e",
    "agent-core-lifecycle-native-e2e",
    "agent-marketplace-catalog-e2e",
    "agent-minimum-usable-chat-native-e2e",
    "agent-native-knowledge-binding-e2e",
    "agent-v2-external-runtime-e2e",
    "agent-v2-kernel-foundation-e2e",
    "chat-lifecycle-interactions-group-e2e",
    "chat-lifecycle-live-voice-e2e",
    "chat-lifecycle-mixed-client-cross-station-e2e",
    "chat-lifecycle-mixed-client-group-mls-e2e",
    "chat-lifecycle-mixed-client-multi-device-e2e",
    "chat-lifecycle-mixed-client-same-station-e2e",
    "chat-native-submitted-command-recovery-e2e",
    "chat-native-typing-e2e",
    "chat-presence-layout-e2e",
    "chat-storage-accounting-e2e",
    "chat-storage-cache-clear-e2e",
    "chat-storage-contract",
    "chat-storage-dead-contract-zero-e2e",
    "chat-storage-delete-reclaim-e2e",
    "chat-storage-redaction-recovery-e2e",
    "chat-storage-retention-e2e",
    "desktop-dev-runtime-multi-instance",
    "desktop-rust-check",
    "messaging-platform-contract",
    "mobile-contract-static",
    "mobile-identity-contract",
    "mobile-native-build",
    "mobile-simulator-access-e2e",
    "mobile-simulator-recovery-e2e",
    "mobile-simulator-recovery-ui-e2e",
    "mobile-simulator-social-convergence-e2e",
    "mobile-simulator-station-lifecycle-e2e",
    "oauth-login-broker-architecture",
    "oauth-login-broker-contract",
    "oauth-login-broker-durable-login",
    "oauth-login-broker-handoff-contract",
    "oauth-login-broker-key-rotation",
    "oauth-login-broker-operator",
    "oauth-login-broker-provider-identity",
    "oauth-login-broker-refresh-idempotency",
    "oauth2-client-live-api-repository",
    "proto-build",
    "social-private-desktop-e2e",
    "station-access-domain-validation",
    "station-access-session-class-e2e",
    "station-messaging-unit"
  ]
}
```
