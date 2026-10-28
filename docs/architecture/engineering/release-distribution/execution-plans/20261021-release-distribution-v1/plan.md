# Release Distribution V1 — Frozen Plan Version

> **Plan ID**: RD-20261021
> **Version ID**: RD-20261021-v3
> **Created**: 2026-10-21T00:00:00.000Z
> **Architecture**: [release-distribution](../../README.md)
> **Supersedes**: v2（FUNCTIONAL_CHECK jq 恒绿，加 -e 断言）；v1（gate/命令不可执行、rc 语义冲突、DAG 漏边）

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "RD-20261021",
  "versionId": "RD-20261021-v3",
  "createdAt": "2026-10-21T00:00:00.000Z",
  "workClass": "infrastructure",
  "architecture": {
    "sources": [
      "docs/architecture/engineering/release-distribution/README.md",
      "docs/architecture/engineering/release-distribution/design.md",
      "docs/architecture/engineering/release-distribution/decisions.md",
      "docs/architecture/engineering/release-distribution/integration.md",
      "docs/architecture/engineering/release-distribution/module-layout.md"
    ],
    "decisions": ["RD-D01","RD-D02","RD-D03","RD-D04","RD-D05","RD-D06","RD-D07","RD-D08","RD-D09","RD-D10","RD-D11","RD-D12","RD-D13","RD-D14"]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": ".github/workflows/release.yml", "mode": "exclusive-write"},
      {"pathPrefix": ".github/workflows/deploy-station.yml", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/distribution", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/docker/station.Dockerfile", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/docker/builder-base.Dockerfile", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/docker/compose.yml", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/docker/station_dockerfile_test.py", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/docker/warm-builder-cache.sh", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/devctl", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance/runtime/node-connectivity-cluster.compose.yml", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance/runtime/station-access-dual-relay.compose.yml", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/package.json", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/src-tauri/Cargo.toml", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/src-tauri/Cargo.lock", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/src-tauri/tauri.conf.json", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/src-tauri/capabilities", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/release-distribution", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/architecture-governance/architecture-modules.json", "mode": "exclusive-write"},
      {"pathPrefix": "docs/README.md", "mode": "exclusive-write"},
      {"pathPrefix": "docs/global/local-dev-environment.md", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/docker/entrypoint.sh", "mode": "shared-read"},
      {"pathPrefix": "tooling/scripts/architecture/module-governance.mjs", "mode": "shared-read"}
    ],
    "nonGoals": [
      "Apple Developer ID/notarization and Windows OV/EV code signing",
      "Relay, LiveKit, or webhook user-facing one-click install",
      "Homebrew, Flatpak/Snap, Microsoft Store, or Mac App Store distribution",
      "Self-hosted update server, delta updates, forced/graded rollout",
      "Mobile distribution and app stores",
      "Station bare binary, systemd units, or Helm chart",
      "Automatic rollback of a failed Station upgrade",
      "Production deployment of the four internal test benches (operator workflow_dispatch only)",
      "Registering new entries in tooling/acceptance/gates.yaml: phase-one evidence is FUNCTIONAL_PASS from CI release Journeys, not formal Acceptance Gates"
    ]
  },
  "tasks": [
    {"id": "RD-T01", "workstreamId": "RD", "path": "tasks/RD-T01.md", "dependsOn": []},
    {"id": "RD-T02", "workstreamId": "RD", "path": "tasks/RD-T02.md", "dependsOn": []},
    {"id": "RD-T03", "workstreamId": "RD", "path": "tasks/RD-T03.md", "dependsOn": ["RD-T01","RD-T02"]},
    {"id": "RD-T04", "workstreamId": "RD", "path": "tasks/RD-T04.md", "dependsOn": ["RD-T03"]},
    {"id": "RD-T05", "workstreamId": "RD", "path": "tasks/RD-T05.md", "dependsOn": ["RD-T04"]},
    {"id": "RD-T06", "workstreamId": "RD", "path": "tasks/RD-T06.md", "dependsOn": ["RD-T02","RD-T04","RD-T05"]}
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

一期证据全部为**功能性 CI Journey 证据**（FUNCTIONAL_PASS），不在 `tooling/acceptance/gates.yaml` 注册形式化 Gate；正式 Acceptance Gate 注册是交付期的独立决策。故本 Plan 的 closure 均无 Gate，质量门映射写在各 Task 的 doneWhen/checks。

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

交付设计 [RD-D01..D14] 的一期分发能力：Station 经 GHCR 双架构镜像 + `curl|sh` 一键安装，Desktop 经 tauri-action 三平台未签名产物 + 签名 updater 通道发布；公开发布 tag 与内部测试机部署触发器分离。

## Dependency DAG

```text
RD-T01 ─┐
        ├─> RD-T03 ─> RD-T04 ─> RD-T05 ─┐
RD-T02 ─┘                              ├─> RD-T06
   └───────────────────────────────────┘
```

- T03 依赖 T01+T02：默认镜像源翻转前，四条覆盖路径与 deploy-station env 合成必须先接通，杜绝悬空默认翻转。
- T05 依赖 T04：finalize `needs` 将引用 T04 创建的 verify-install job，禁止并行改 release.yml 产生无效工作流。

## Atomic Cutovers

- RD-T01/T02：默认镜像源翻转为官方源的同一批次内，四个消费方的大陆/内网覆盖与 deploy-station env 合成同时接通（compose 变量替换必须用 `:-<官方默认>` 形式，缺省不得传空串覆盖 ARG 默认值）；回滚 = VCS revert。
- RD-T02：deploy-station.yml 删除 `push.tags` 触发器为单一切换点；workflow_dispatch 路径必须先验证。
- RD-T03：Station 镜像唯一分发出口切为 GHCR tag；用户 compose 永远不出现 `build:`。
- RD-T04：用户编排只存在于 `tooling/distribution/`，不复用测试机 compose。
- RD-T05：identifier 在首个公开 tag 前一次性切换；之后不可变。updater 私钥只进 GitHub Secret。

## Release Tag 演练序列（rc 版本语义按 RD-D08 修订）

- 三处版本号保持 `0.1.0`；rc tag 形如 `v0.1.0-rcN`，校验只比 X.Y.Z 核心，prerelease 后缀合法。
- `rc1`：T03 后。仅 GHCR 镜像 + draft/prerelease Release，无分发资产（无 install 链）。
- `rc2`：T04 后。分发面首次存在；verify-install Journey：干净安装 + 幂等 + checksum 负例。
- `rc3`：T04 同一批次第二个 tag（同代码或修复提交）。Journey：rc2→rc3 升级、state 前进、rollback 回 rc2、uninstall/--purge。
- `rc4`：T05 后。完整矩阵：station + installer + 三平台桌面产物 + updater 产物；finalize needs 三项齐全。

## External Prerequisites（非代码，需操作者显式动作）

- GitHub org/repo 设置：release.yml 自身声明 `packages: write` permissions（代码内，T03）；GHCR 包首次发布后由操作者设为 public。
- 标签保护规则：`v*.*.*` 仅受控角色可创建。
- **rc tag 的创建与推送由操作者显式完成**：Plan 授权 `delivery.push = denied`，Agent 不自行打 tag/推送；tag 运行结果以 FUNCTIONAL 证据回收。
- 生成 Tauri updater minisign 密钥对：私钥入 GitHub Secret（无口令），公钥烘焙配置。
- T02 的 workflow_dispatch 测试机部署由操作者授权执行；此前该项为 UNPROVEN。
- 正式 Apple/Windows 签名不在本期。

## Non-Claims

- 不宣称签名分发、Relay 一键安装、Mobile 分发。
- rc 演练不构成正式发布证明；正式 tag 的 FUNCTIONAL_PASS 才是完成证据。
- E20（deb updater 支持）是实测项而非 Gate：2.0.1 不支持则落"deb 手动升级"文档结论，不阻塞一期。
- 不新增 acceptance Gates.yaml 条目；正式 COMPLETION proof 是交付期独立决策。
