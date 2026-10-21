# Peers Touch 0.0.1 Mobile iOS + Desktop Release Acceptance

> **Plan ID**: `release-0.0.1-mobile-ios-desktop-acceptance-20261017`
> **Version ID**: `20261017-v15`
> **Created**: 2026-10-17T11:45:11.000Z
> **Owner**: Release Acceptance / Client Platform

## Plan Version

```json
{"kind":"peers-touch-plan-version","planId":"release-0.0.1-mobile-ios-desktop-acceptance-20261017","versionId":"20261017-v15","createdAt":"2026-10-17T11:45:11.000Z","workClass":"product-behavior","architecture":{"sources":["docs/architecture/engineering/acceptance/README.md","docs/architecture/engineering/acceptance/design.md","docs/architecture/engineering/acceptance/decisions.md","docs/architecture/platform/client/mobile/product-definition.md","docs/architecture/platform/client/mobile/experience-contract.md","docs/architecture/platform/client/mobile/acceptance-matrix.md","docs/architecture/platform/client/mobile/decisions.md","docs/architecture/platform/client/mobile/execution-plans/20261008-mobile-whole-product-usability/plan.md","docs/architecture/platform/station/access/product-definition.md","docs/architecture/platform/station/access/experience-contract.md","docs/architecture/platform/station/access/acceptance-matrix.md","docs/architecture/platform/runtime/node-connectivity/README.md","docs/architecture/domains/federation/README.md","docs/architecture/domains/federation/design.md","docs/architecture/domains/federation/decisions.md","docs/architecture/domains/chat/lifecycle/product-definition.md","docs/architecture/domains/chat/lifecycle/experience-contract.md","docs/architecture/domains/chat/lifecycle/acceptance-matrix.md","docs/architecture/domains/social/core/product-definition.md","docs/architecture/domains/social/core/experience-contract.md","docs/architecture/domains/social/cross-station/design.md","docs/client/common/ux-design-methodology.md","docs/client/desktop/runtime-projections.md","docs/client/mobile/acceptance-setup.md"],"decisions":["D-17","D-18","D-20","D-21","D-22","SAL-D01","SAL-D02","SAL-D03","SAL-D04","SAL-D06","SAL-D07","SAL-D08","SAL-D12","SAL-D14","SAL-D15","NCP-D01","NCP-D02","NCP-D03","NCP-D04","NCP-D05","NCP-D06","NCP-D07","NCP-D08","NCP-D09","NCP-D10","NCP-D11","NCP-D12","NCP-D13","NCP-D14","NCP-D15","NCP-D16","NCP-D17","NCP-D18","CSS-D01","CSS-D02","CSS-D03","CSS-D04","CSS-D05","CSS-D06","CSS-D07","CSS-D08","CSS-D09","CSS-D10","CSS-D11","MS-D03","MS-D04","MS-D14","MS-D26","MS-D27","MS-D28","D-01","D-03","D-04","D-08","D-10"]},"scope":{"sourceClaims":[{"pathPrefix":"docs/architecture/engineering/acceptance/execution-plans/20261017-release-0.0.1-mobile-ios-desktop","mode":"exclusive-write"},{"pathPrefix":"tooling/skills/pt-github-review/FRESHNESS.md","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/engineering/api-governance/station-api-capabilities.yaml","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/engineering/acceptance/reports/0.0.1-mobile-ios-desktop.md","mode":"exclusive-write"},{"pathPrefix":"reports/release-0.0.1","mode":"exclusive-write"},{"pathPrefix":"pnpm-lock.yaml","mode":"exclusive-write"},{"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},{"pathPrefix":"apps/desktop","mode":"exclusive-write"},{"pathPrefix":"apps/mobile","mode":"exclusive-write"},{"pathPrefix":"apps/station","mode":"exclusive-write"},{"pathPrefix":"model/domain","mode":"exclusive-write"},{"pathPrefix":"packages/messaging-core","mode":"exclusive-write"},{"pathPrefix":"packages/secure-content-core","mode":"exclusive-write"},{"pathPrefix":"packages/client-chat-core","mode":"exclusive-write"},{"pathPrefix":"packages/locales","mode":"exclusive-write"},{"pathPrefix":"docs/knowledge","mode":"exclusive-write"},{"pathPrefix":"docs/architecture/platform","mode":"shared-read"},{"pathPrefix":"docs/architecture/domains","mode":"shared-read"},{"pathPrefix":"docs/client","mode":"shared-read"}],"nonGoals":["Agent, Bot, provider, MCP, Skill, Atelier, or any other AI journey","Android, Windows, Linux, physical iOS, store publication, signing, notarization, or installer distribution","Applet product readiness unless a shipped core journey depends on it","Changing product behavior only because a non-blocking UX observation prefers another design","Using API, Harness, static, browser, or screenshot-only evidence as a substitute for required Native UI and receiver proof","Preserving test data, stale packages, compatibility shims, or alternate runtime truth after the run","Push, pull request, merge, release publication, or history rewrite"]},"tasks":[{"id":"R001-01-BASELINE","workstreamId":"R001-RELEASE","path":"tasks/R001-01-BASELINE.md","dependsOn":[]},{"id":"R001-02-RELAY","workstreamId":"R001-RELEASE","path":"tasks/R001-02-RELAY.md","dependsOn":["R001-01-BASELINE"]},{"id":"R001-03-FEDERATION","workstreamId":"R001-RELEASE","path":"tasks/R001-03-FEDERATION.md","dependsOn":["R001-02-RELAY"]},{"id":"R001-04-ACCESS","workstreamId":"R001-RELEASE","path":"tasks/R001-04-ACCESS.md","dependsOn":["R001-02-RELAY"]},{"id":"R001-05-CHAT","workstreamId":"R001-RELEASE","path":"tasks/R001-05-CHAT.md","dependsOn":["R001-03-FEDERATION","R001-04-ACCESS"]},{"id":"R001-06-MOMENTS","workstreamId":"R001-RELEASE","path":"tasks/R001-06-MOMENTS.md","dependsOn":["R001-03-FEDERATION","R001-04-ACCESS"]},{"id":"R001-07-UX","workstreamId":"R001-RELEASE","path":"tasks/R001-07-UX.md","dependsOn":["R001-05-CHAT","R001-06-MOMENTS"]},{"id":"R001-08-RELEASE","workstreamId":"R001-RELEASE","path":"tasks/R001-08-RELEASE.md","dependsOn":["R001-07-UX"]}],"authorization":{"checkpoint":{"localCommit":"allowed","amend":"allowed"},"delivery":{"push":"denied","pullRequest":"denied"},"runtime":{"deployProfiles":["one","four","fiveArm"],"destructiveResetScopes":["station-four-social-private","station-five-arm-social-private","chat-mixed-native-actors","station-access-reset-actors","mobile-station-lifecycle-alice","mobile-social-simulator-actors","release-0.0.1-federation-fixtures","release-0.0.1-mobile-fixtures"]},"history":{"rewrite":"denied"}}}
```

## Acceptance Execution

```json
{"closures":{"release-baseline":["acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","proto-build","station-api-ownership","station-access-capability-contract","desktop-check","desktop-release-build","mobile-contract-static","mobile-identity-contract","mobile-hard-cut-static","mobile-native-build"],"release-relay-topology":["relay-role-security-contract","NCP-G01","NCP-G02","NCP-G07","NCP-G08","station-access-desktop-relay-native-e2e","station-access-mobile-relay-native-e2e"],"release-federation":["station-federation-unit","station-access-federation-boundary-e2e","federation-two-station-lifecycle-e2e"],"release-access-shell":["station-access-auth-e2e","station-access-desktop-oauth-native-e2e","station-access-scope-isolation-e2e","station-access-session-class-suite-e2e","desktop-shell-tray-e2e","mobile-simulator-access-e2e","mobile-simulator-runtime-lifecycle-e2e","mobile-simulator-station-lifecycle-e2e","mobile-simulator-settings-e2e"],"release-chat":["chat-lifecycle-onboarding-e2e","chat-lifecycle-direct-e2e","chat-native-interactions-e2e","chat-native-typing-e2e","chat-lifecycle-interactions-group-e2e","chat-native-group-mls-e2e","chat-presence-layout-e2e","chat-lifecycle-rich-voice-e2e","chat-lifecycle-live-voice-e2e","chat-lifecycle-group-live-e2e","chat-lifecycle-mixed-client-same-station-e2e","chat-lifecycle-mixed-client-cross-station-e2e","chat-lifecycle-mixed-client-multi-device-e2e","chat-lifecycle-call-resolution-e2e","chat-lifecycle-mixed-client-group-mls-e2e","mobile-simulator-social-convergence-e2e","mobile-simulator-chat-contacts-e2e","mobile-simulator-recovery-e2e","mobile-simulator-recovery-ui-e2e"],"release-moments":["social-private-desktop-e2e","social-cross-station-native-e2e","mobile-social-ios-native","mobile-simulator-moments-e2e","social-cross-station-mobile-desktop-e2e"],"release-ux-analysis":["mobile-simulator-whole-product-usability-e2e","mobile-ios-simulator-layout-accessibility-e2e","mobile-simulator-platform-e2e","release-0.0.1-operation-analysis"],"release-final":["station-access-domain-validation","federation-domain-validation","chat-domain-validation","social-domain-validation","mobile-domain-validation","desktop-shell-domain-validation","release-0.0.1-mobile-ios-desktop-aggregate"]},"completion":["acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","proto-build","station-api-ownership","station-access-capability-contract","desktop-check","desktop-release-build","mobile-contract-static","mobile-identity-contract","mobile-hard-cut-static","mobile-native-build","relay-role-security-contract","NCP-G01","NCP-G02","NCP-G07","NCP-G08","station-access-desktop-relay-native-e2e","station-access-mobile-relay-native-e2e","station-federation-unit","station-access-federation-boundary-e2e","federation-two-station-lifecycle-e2e","station-access-auth-e2e","station-access-desktop-oauth-native-e2e","station-access-scope-isolation-e2e","station-access-session-class-suite-e2e","desktop-shell-tray-e2e","mobile-simulator-access-e2e","mobile-simulator-runtime-lifecycle-e2e","mobile-simulator-station-lifecycle-e2e","mobile-simulator-settings-e2e","chat-lifecycle-onboarding-e2e","chat-lifecycle-direct-e2e","chat-native-interactions-e2e","chat-native-typing-e2e","chat-lifecycle-interactions-group-e2e","chat-native-group-mls-e2e","chat-presence-layout-e2e","chat-lifecycle-rich-voice-e2e","chat-lifecycle-live-voice-e2e","chat-lifecycle-group-live-e2e","chat-lifecycle-mixed-client-same-station-e2e","chat-lifecycle-mixed-client-cross-station-e2e","chat-lifecycle-mixed-client-multi-device-e2e","chat-lifecycle-call-resolution-e2e","chat-lifecycle-mixed-client-group-mls-e2e","mobile-simulator-social-convergence-e2e","mobile-simulator-chat-contacts-e2e","mobile-simulator-recovery-e2e","mobile-simulator-recovery-ui-e2e","social-private-desktop-e2e","social-cross-station-native-e2e","mobile-social-ios-native","mobile-simulator-moments-e2e","social-cross-station-mobile-desktop-e2e","mobile-simulator-whole-product-usability-e2e","mobile-ios-simulator-layout-accessibility-e2e","mobile-simulator-platform-e2e","release-0.0.1-operation-analysis","station-access-domain-validation","federation-domain-validation","chat-domain-validation","social-domain-validation","mobile-domain-validation","desktop-shell-domain-validation","release-0.0.1-mobile-ios-desktop-aggregate"],"full":["acceptance-plan-self","acceptance-infra-validation","acceptance-runtime-provisioning-self","acceptance-workflow-contract","proto-build","station-api-ownership","station-access-capability-contract","desktop-check","desktop-release-build","mobile-contract-static","mobile-identity-contract","mobile-hard-cut-static","mobile-native-build","relay-role-security-contract","NCP-G01","NCP-G02","NCP-G07","NCP-G08","station-access-desktop-relay-native-e2e","station-access-mobile-relay-native-e2e","station-federation-unit","station-access-federation-boundary-e2e","federation-two-station-lifecycle-e2e","station-access-auth-e2e","station-access-desktop-oauth-native-e2e","station-access-scope-isolation-e2e","station-access-session-class-suite-e2e","desktop-shell-tray-e2e","mobile-simulator-access-e2e","mobile-simulator-runtime-lifecycle-e2e","mobile-simulator-station-lifecycle-e2e","mobile-simulator-settings-e2e","chat-lifecycle-onboarding-e2e","chat-lifecycle-direct-e2e","chat-native-interactions-e2e","chat-native-typing-e2e","chat-lifecycle-interactions-group-e2e","chat-native-group-mls-e2e","chat-presence-layout-e2e","chat-lifecycle-rich-voice-e2e","chat-lifecycle-live-voice-e2e","chat-lifecycle-group-live-e2e","chat-lifecycle-mixed-client-same-station-e2e","chat-lifecycle-mixed-client-cross-station-e2e","chat-lifecycle-mixed-client-multi-device-e2e","chat-lifecycle-call-resolution-e2e","chat-lifecycle-mixed-client-group-mls-e2e","mobile-simulator-social-convergence-e2e","mobile-simulator-chat-contacts-e2e","mobile-simulator-recovery-e2e","mobile-simulator-recovery-ui-e2e","social-private-desktop-e2e","social-cross-station-native-e2e","mobile-social-ios-native","mobile-simulator-moments-e2e","social-cross-station-mobile-desktop-e2e","mobile-simulator-whole-product-usability-e2e","mobile-ios-simulator-layout-accessibility-e2e","mobile-simulator-platform-e2e","release-0.0.1-operation-analysis","station-access-domain-validation","federation-domain-validation","chat-domain-validation","social-domain-validation","mobile-domain-validation","desktop-shell-domain-validation","release-0.0.1-mobile-ios-desktop-aggregate"]}
```

## Goal

在一个干净、精确源码绑定的候选版本上，使用 `four`、`fiveArm`、一个真实 Relay、macOS Native Desktop 与 iOS Simulator，完成 Peers Touch 0.0.1 非 AI 主产品面的发布验收；发现的发布阻塞缺陷在所属真源就地修复并回归，非阻塞 UX 问题只进入报告，不借验收之名顺手改版。

## Release Scope

- 连接：直连、Relay、显式换路、重启恢复、同一 Station 身份与 Session 连续性。
- 双 Station / Federation：创建、加入、成员投影、跨站搜索与解析、退出、创建者删除和清理。
- 基础能力：Station 选择、登录、Session 恢复/撤销、导航、Profile、Settings、语言、通知、隐私与存储入口。
- Chat：联系人、好友、Direct、Group、消息、回执、互动、附件、语音消息、离线/重启/恢复；当前 UI 暴露的非 AI 通话能力也纳入。
- Moments：同站与跨站、公开/私密受众、文本/媒体、评论、回复、Reaction、撤销、重启与恢复。
- 跨端：Desktop↔iOS 同站与跨站收发、身份、投影、Session 和 MLS 收敛。

## Defect And UX Boundary

- 崩溃、数据错误、权限/隐私问题、跨 scope 泄漏、死路、关键操作不可完成、主要按钮被遮挡或无可恢复状态，属于发布缺陷：在当前 Task 内按 `pt-defect-closure` 修复并重跑失效证据。
- 步骤偏多、层级弱、文案不够自然、视觉不统一、可发现性一般但存在清晰可行路径，属于后续 UX 优化：只记录证据、原因和建议，不修改当前产品。
- UX 判断使用“简单、好用、丝滑、易理解、符合互联网应用标准与审美”五个维度，并同时记录任务完成率、步骤数、等待/反馈、恢复路径、平台适配、可访问性和视觉稳定性。

## Execution DAG

```text
R001-01-BASELINE
  -> R001-02-RELAY
     -> R001-03-FEDERATION
     -> R001-04-ACCESS
R001-03-FEDERATION + R001-04-ACCESS
  -> R001-05-CHAT
  -> R001-06-MOMENTS
R001-05-CHAT + R001-06-MOMENTS
  -> R001-07-UX
  -> R001-08-RELEASE
```

## Runtime Contract

- Dev Workflow 在执行开始时绑定一个明确、干净的 release-candidate worktree 和当前 Git HEAD；Plan 不保存可变 HEAD。
- `four` 对应 `station-four`，`fiveArm` 对应 `station-five-arm`，`one` 提供 reviewed Relay `relay-1`。三者可按声明角色部署、重启；仅 `four` / `fiveArm` 允许按既有 reset scope 清理测试数据，不保留测试账号、Federation、Conversation、Moment 或本地客户端存储。
- Relay closure 分三次运行：local source Gates 不接收 Profile binding；Desktop Gate 使用 `one` 的 active Station/Relay topology 与 `desktop-macos-native`；Mobile Gate 显式绑定 `station-primary=four`、`station-secondary=fiveArm`、`relay=one`，并把隔离 Acceptance Python venv 放在子进程 `PATH` 首位。
- 每个多场景 Task 只允许一次 build/deploy/fixture/login 主流程，后续 Scenario attach-only；任何重建、重登或客户端替换必须是声明过的产品场景。
- Relay 只承担传输；Federation、Session、Chat 与 Social 真源保持在 Station。
- 所有 Native 证据必须绑定源码、Station/Relay attestation、客户端二进制、Actor/Device/Storage identity、运行 cell 和清理结果。

## Human-Readable Deliverables

主报告必须使用中文，首页直接给出 `可发布 / 有条件可发布 / 不可发布`，并包含：

1. Desktop 与 iOS 的能力矩阵和每条关键 Journey 结果；
2. 本轮发现并已修复的发布缺陷及回归证据；
3. 未解决的发布阻塞与最小关闭条件；
4. “保留的好设计”与“下阶段 UX 优化清单”，每项带截图/操作轨迹、为什么好或不好、影响用户、建议优先级；
5. UX 优化按“下一阶段必须做 / 应该做 / 可以做”排序，不把建议伪装成当前缺陷；
6. 技术证据放附录，主文不堆原始日志、Gate ID 或内部路径。

## Completion

只有当所有 completion Gates 对同一候选源码为 `DONE/PROVEN`、Gap Detector 无阻塞缺口、所有发布缺陷已闭环、`four`/`fiveArm`/Relay 与客户端资源清理完成、报告给出可审计的发布结论时，才能宣称 0.0.1 Mobile iOS + Desktop 验收完成。UX 优化建议允许保持未实现，但必须完整记录且不得影响发布结论的诚实性。
