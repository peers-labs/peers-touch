# Release Distribution — 候选执行计划

> **Plan ID**: RD-20261021
> **Version ID**: RD-20261021-review-20261021
> **Created**: 2026-10-21T00:00:00.000Z

待用户决定实施；本轮仅修订文档。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "RD-20261021",
  "versionId": "RD-20261021-review-20261021",
  "createdAt": "2026-10-21T00:00:00.000Z",
  "workClass": "infrastructure",
  "architecture": {
    "sources": [
      "docs/architecture/engineering/release-distribution/README.md",
      "docs/architecture/engineering/release-distribution/design.md",
      "docs/architecture/engineering/release-distribution/decisions.md",
      "docs/architecture/engineering/release-distribution/data-model.md",
      "docs/architecture/engineering/release-distribution/integration.md",
      "docs/architecture/engineering/release-distribution/module-layout.md"
    ],
    "decisions": ["RD-D01", "RD-D02", "RD-D03", "RD-D04", "RD-D05", "RD-D06", "RD-D07", "RD-D08", "RD-D09", "RD-D10", "RD-D11", "RD-D12", "RD-D13", "RD-D14"]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": ".github/workflows/release.yml", "mode": "exclusive-write"},
      {"pathPrefix": ".github/workflows/deploy-station.yml", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/distribution", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/docker", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/devctl", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance/runtime/node-connectivity-cluster.compose.yml", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance/runtime/station-access-dual-relay.compose.yml", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/package.json", "mode": "exclusive-write"},
      {"pathPrefix": "pnpm-lock.yaml", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/src-tauri/Cargo.toml", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/src-tauri/Cargo.lock", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/src-tauri/tauri.conf.json", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/src-tauri/capabilities", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/src-tauri/src/main.rs", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/src-tauri/src/application", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/release-distribution", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/architecture-governance/architecture-modules.json", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/README.md", "mode": "exclusive-write"},
      {"pathPrefix": "docs/README.md", "mode": "exclusive-write"},
      {"pathPrefix": "docs/global/local-dev-environment.md", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/architecture", "mode": "shared-read"},
      {"pathPrefix": "tooling/acceptance/core/suite_runtime.py", "mode": "shared-read"}
    ],
    "nonGoals": [
      "Implement or publish anything under the current document-revision request",
      "Create, move, delete or push tags; publish releases or images without a later explicit release request",
      "Apple or Windows code-signing certificate procurement",
      "Mobile, Relay, LiveKit, Stores, Helm or bare-binary distribution",
      "Automatic rollback or in-place rollback without schema compatibility evidence",
      "New update UI; this package defines runtime registration and executable update verification",
      "Claim formal Acceptance proof from workflow success or from empty Gate lists",
      "Create, switch, remove or prune a worktree"
    ]
  },
  "tasks": [
    {"id": "RD-T01", "workstreamId": "RD", "path": "tasks/RD-T01.md", "dependsOn": []},
    {"id": "RD-T02", "workstreamId": "RD", "path": "tasks/RD-T02.md", "dependsOn": ["RD-T01"]},
    {"id": "RD-T03", "workstreamId": "RD", "path": "tasks/RD-T03.md", "dependsOn": ["RD-T02"]},
    {"id": "RD-T04", "workstreamId": "RD", "path": "tasks/RD-T04.md", "dependsOn": ["RD-T03"]},
    {"id": "RD-T05", "workstreamId": "RD", "path": "tasks/RD-T05.md", "dependsOn": ["RD-T04"]},
    {"id": "RD-T06", "workstreamId": "RD", "path": "tasks/RD-T06.md", "dependsOn": ["RD-T05"]}
  ],
  "authorization": {
    "checkpoint": {"localCommit": "allowed", "amend": "denied"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {"deployProfiles": [], "destructiveResetScopes": []},
    "history": {"rewrite": "denied"}
  }
}
```

## Acceptance Execution

这些列表只界定当前开发候选范围，不豁免交付期正式 Acceptance。计划和契约校验通过不代表运行通过；尚无实现、tag、运行报告或产品 proof。

```json
{
  "closures": {
    "rd-mirror-parameterization": [],
    "rd-tag-trigger-separation": [],
    "rd-station-ghcr-release": [],
    "rd-station-installer": [],
    "rd-desktop-release": [],
    "rd-module-activation": []
  },
  "completion": [],
  "full": []
}
```

## Goal

Station 可安装、升级和安全恢复；Desktop 首版具备注册完成的签名更新通道。真实产物在公开前完成候选验收，公开后通过匿名验收才晋级稳定入口；开发部署与公开发布分开。

## Dependency DAG

```text
RD-T01 -> RD-T02 -> RD-T03 -> RD-T04 -> RD-T05 -> RD-T06
```

T01 在一个原子变更内完成镜像源参数化及所有消费者的覆盖转发，包含 deploy env 合成；T02 只摘除 tag 触发。工作流、installer、updater 的公共写集依赖串行集成，不能产生引用不存在 job 的中间提交。

## 发布与验收边界

- 前置单测和 dry-run 可以在没有公开 Release 的情况下完成；发布演练必须后续明确授权。
- candidate 资产通过 GitHub 认证 API 下载，Suite 在私有 HTTPS 文件服务原样提供；installer/client 不接触 token，不用 mock 产品 API。
- 候选通过后才允许公开完整资产，初始 `make_latest=false`。新 Suite 以匿名 GitHub URL 安装并读回；失败不晋级 latest。
- 完整正式 Release 公开验收通过后才成为 latest；更新包 URL 固定 tag，稳定清单入口可以推进。rc、Station-only 中间产物不成为 latest。
- 两个版本的更新/升级实验使用真实不同的完整包内 SemVer，版本对由显式 env 传入，不固定 rc 编号、不自动 bump。对应源码和 lockfiles 随实际发布准备一致更新。

## 检查与证据契约

未来 T03 创建的 `release-evidence-check.mjs` 是明确的待实现 CLI，不能假装现已存在。它接受 repository、run ID、attempt、完整 tag、source 和任务 ID，查询 `gh run view <id> --attempt <n> --json ...` 的完整 JSON，核对 job/step、Suite 报告、required Scenario 和产物 digest/清理。缺 env、缺 run、错误 attempt/tag/HEAD、运行中、失败、跳过和裸字符串一律非零退出。

整个 run success 仅作入口筛选，不是功能证据。`gh --jq` 的裸字符串不再接 JSON parser；如使用 shell 则 `set -euo pipefail`，完整 JSON 原样交给解析器。报告验证器的单测包括成功、失败、缺失、错身份和缺场景。

T03/T04/T05 各自声明 `runtimeReuse`；每个 Suite 一次准备资源，各 Scenario 只附着。候选与匿名公开验收是两个不同信任边界，分别有 source-bound Suite 报告；实际版本变更/恢复/卸载是产品动作，由 Suite owner执行而非重复配置隔离环境。

## 备份与恢复边界

升级前停写并备份 PostgreSQL、身份、附件、配置和旧镜像；失败不启动升级。原位回滚须有 schema/版本对/digest 的真实兼容证据，否则拒绝。显式恢复备份先写新卷并验证，再切换实例；备份后的写入损失需确认，原现场不提前删除。

## 后续授权与完成边界

当前只授权文档修订，不触发 Actions、生成签名秘密、改 GitHub 设置或部署测试机。后续实现、版本准备、tag/push、公开发版、恢复生产数据各自按显式授权执行。

本 package 完成开发闭环不等于 delivery-ready。交付前由 `pt-acceptance-engineering` 定义并产出命名交付范围所需正式 proof，缺失保持 UNPROVEN，不能靠清空 Gate、修改报告或工作流 success 补齐。现有受保护 Profile 和 exact-target 资源规则继续约束 Agent 的任何运行操作。
