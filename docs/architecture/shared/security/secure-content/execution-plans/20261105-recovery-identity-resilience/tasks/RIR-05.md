# RIR-05：类型化 prepare 阻断与枚举资格分级

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RIR-20261105",
  "taskId": "RIR-05",
  "workstreamId": "BLOCKING",
  "title": "claim prescan 聚合、KE domain principal、Social 分类器、typed proto 与联邦聚合映射",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "rir-blocking",
  "journeyId": "RG-6",
  "runtimeClass": "service",
  "writeSet": [
    "model/domain/secure_content",
    "model/domain/social",
    "apps/station/app/subserver/key_exchange",
    "apps/station/app/subserver/social",
    "apps/station/app/internal/securecontent",
    "tooling/acceptance"
  ],
  "readSet": [
    "docs/architecture/shared/security/secure-content/recovery-identity-resilience-amendment.md",
    "docs/architecture/shared/security/secure-content/decisions.md"
  ],
  "budgets": {"focusedCheckSeconds": 900, "functionalRunSeconds": 3600, "cleanupSeconds": 300},
  "checks": [
    {"id": "rir05-build", "command": "go -C apps/station build ./frame/... ./app/...", "verificationClass": "SOURCE_CHECK"},
    {"id": "rir05-proto", "command": "./model/build.sh", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "rir05-tests", "command": "go -C apps/station test ./app/subserver/key_exchange/... ./app/subserver/social/... -count=1 -timeout=180s", "verificationClass": "SOURCE_CHECK"},
    {"id": "rir05-differential", "command": "go -C apps/station test ./app/subserver/social/... -run RecoveryBlockingDifferential -count=1", "verificationClass": "FUNCTIONAL_CHECK"},
    {"id": "rg6-opaque-remote-blocking", "command": "uv run --with-requirements tooling/acceptance/requirements.txt -- python3 tooling/scripts/acceptance-run.py --plan docs/architecture/shared/security/secure-content/execution-plans/20261105-recovery-identity-resilience/plan.md --gate rg6-opaque-remote-blocking", "verificationClass": "ACCEPTANCE_PROOF"}
  ],
  "doneWhen": [
    "claim 事务内对全部 principals 持相同 FOR UPDATE 行锁做非变异 prescan 并聚合耗尽 principal，失败不消费任何 key",
    "Social 仅按签名计划持久化 targets 分类：self 精确 device、显式 CUSTOM 给 actor+kind、服务端展开/联邦仅 kind+count/上界；异常 principal fail-closed",
    "阻断身份走新 typed protobuf 而非 details map；联邦对端仍 code-only",
    "gates.yaml 新增 rg6-opaque-remote-blocking：注册到真实 environment（local 自包含 go test，复用 federation_queries_test httptest 对端先例），含受众成员差分与 30203/30206 不可区分变体，RG-6 通过"
  ],
  "failureBehavior": [
    "禁止泄漏服务端展开受众成员或库存状态；禁止新建公开 inventory 探测面",
    "未富化 30206 仍按现行严格失败闭合；联邦丰富化须新跨站决策，本任务不做"
  ],
  "updatedAt": "2026-11-05T00:00:00.000Z"
}
```
