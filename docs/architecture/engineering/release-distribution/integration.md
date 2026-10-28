# Release Distribution — 集成与映射

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-21 | **Updated**: 2026-10-21
> **Owner**: Architecture Team

---

## 1. 与现有系统的映射

| 现有部件 | 现状 | 目标态关系 |
|----------|------|------------|
| [tooling/docker/station.Dockerfile](../../../../tooling/docker/station.Dockerfile) | `CGO_ENABLED=0` 静态构建；已有 OCI labels | 已参数化 `APT_MIRROR`、`GO_TARBALL_MIRROR`、`GOPROXY`、`GOSUMDB`，默认官方源并允许受限网络显式覆盖；仍是唯一 Station/Relay Dockerfile |
| [tooling/docker/builder-base.Dockerfile](../../../../tooling/docker/builder-base.Dockerfile) | warm-builder-cache.sh 消费的共享 builder | 与 Station Dockerfile 使用同一镜像源和校验参数契约 |
| [tooling/docker/entrypoint.sh](../../../../tooling/docker/entrypoint.sh) | env → hierarchy-merge overlays；角色与密钥全部来自环境 | 保持单一配置通道；新增 Station-only `dashboard.docker.yml`，完整覆盖用户安装的 Dashboard operator 凭据，Relay 不消费 |
| [tooling/docker/compose.yml](../../../../tooling/docker/compose.yml) | 测试机编排：build 段仅转发 BUILD_*、强制密钥、relay/livekit/webhook profiles | **受控改造**：build.args 增加镜像源参数的环境变量转发（RD-D13 消费方 3）；profile 与测试机语义不变；用户面不复用此文件 |
| [.github/workflows/deploy-station.yml](../../../../.github/workflows/deploy-station.yml) | PR cache-only 构建 + tag/workflow_dispatch SSH 部署 4 测试机（tag 触发见 L58-60） | **受控改造**：摘除 `push.tags v*.*.*` 触发器，测试机仅 workflow_dispatch（RD-D09）；env 合成段补镜像源覆盖参数（RD-D13）；权限保持 `contents: read`，不获得 packages write、不推送 GHCR |
| tooling/devctl（`make station` 路径） | runCompose 不传镜像源 build args | **受控改造（RD-D13 消费方 4a）**：将 profile 中的镜像源覆盖透传到 compose build.args |
| tooling/acceptance/runtime 两个 compose | station.Dockerfile 消费方；`BUILDER_IMAGE=hub.byted.org/...` 内网路径 | **验证 + 必要时最小改造（消费方 4b）**：保留内网 base image 能力，确认镜像源 ARG 在内网显式降级后可构建 |
| [.github/workflows/release.yml](../../../../.github/workflows/release.yml) | tag 触发的唯一公开发布 owner | 已实现构建、manifest 单 writer、Station candidate/public Suite、finalize 和 promotion；native updater 证据缺失时两个信任边界均显式失败 |
| [apps/desktop/src-tauri/tauri.conf.json](../../../../apps/desktop/src-tauri/tauri.conf.json) | identifier `com.peers.touch.desktop`、updater endpoint、更新包生成 | 稳定清单入口用 `/releases/latest/download/latest.json`；公钥为空时发布 fail closed |
| [apps/desktop/src-tauri/src/main.rs](../../../../apps/desktop/src-tauri/src/main.rs) | updater Builder 已注册 | acceptance-webdriver command 调用实际插件 check/download/install；运行证明待补 |
| apps/desktop/src-tauri/Cargo.toml + 前端 | tauri 2.0.1，无 updater 插件 | 增加 `tauri-plugin-updater` 与 `@tauri-apps/plugin-updater`（与 2.0.x 对齐版本）；版本号纳入一致性校验；前端更新触发 UI 属 desktop 平台契约，本期只保证通道与构建侧 |
| tooling/docker/station_dockerfile_test.py | Dockerfile 结构测试 | 扩展用例覆盖镜像源参数化（默认官方源、覆盖参数被接受、GOSUMDB 默认开启） |
| docs/development/environment.md | `make station` 开发路径 | 不改开发路径；新增交叉引用指向用户安装文档（执行阶段落地） |

## 2. 影响面分析

| 区域 | 改动程度 | 风险 |
|------|----------|------|
| 发布流水线 release.yml | 高（生命周期重构） | candidate 验收失败不公开；公开匿名验收失败不晋级 latest；所有实际发版动作仍需后续授权 |
| Station/builder-base Dockerfile + 四个消费方 | 中（构建参数化） | 默认源变更可能影响大陆/内网构建 → RD-D13 要求四条路径全部显式覆盖；各路径构建验证入质量门 6 |
| GHCR 包权限 | 新增运维面 | 包创建后默认 private，必须显式转 public，否则匿名安装失败；已纳入安装 Journey 质量门 |
| deploy-station.yml | 中（受控改造） | 摘除 tag 触发器改变"发版即滚动测试机"习惯，改为显式 dispatch；workflow_dispatch 路径必须实测保留 |
| Desktop 打包配置 | 中 | identifier 变更只影响 dev2 身份（从未公开发布）；本地开发数据目录一次性重建；universal dmg 目标名以 tauri-cli 2.0.1 实测固化 |
| 仓库 Secret/标签保护 | 新增配置 | 需 `TAURI_SIGNING_PRIVATE_KEY` 等 secret；tag 保护规则确保只有受控角色能触发发布（RD-D09 后果） |
| 新模块文档 | 新增 | 仅新增文件 |
| Station 业务代码 | 零改动 | 分发层复用现有 Actor、Dashboard、OSS API 和 entrypoint overlay，不引入业务 mock 或第二配置通道 |

## 3. Dockerfile 镜像源参数化契约

参数化必须覆盖**四个构建消费方**（RD-D13），默认值全部官方源（单一 Dockerfile，无分叉）：

```dockerfile
# 默认值 = 官方源（GitHub runner、海外用户审计构建）
# 空值表示保留当前基础镜像的官方 apt 配置，不能将 Ubuntu 指向 Debian 源。
ARG APT_MIRROR=
ARG GO_TARBALL_MIRROR=https://go.dev/dl
ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org
```

1. GitHub 发布构建（release.yml station-image）：不传覆盖参数 → 官方源。
2. `tooling/docker/compose.yml` 测试机构建：build.args 从 env 转发，`.env.<env>` 传 tuna/aliyun/goproxy.cn。
3. `builder-base.Dockerfile` + `warm-builder-cache.sh`：同一套 ARG 契约。
4. `make station`（devctl）与 acceptance runtime 两个 compose：显式透传覆盖值；内网 `BUILDER_IMAGE=hub.byted.org/...` 路径继续可用，镜像源在该路径显式降级。

`GOSUMDB`/`GONOSUMCHECK` 默认恢复官方校验链；大陆/内网路径显式关闭，禁止静默关闭校验。

## 4. 目标态产物清单（发布一次 tag 后必须存在）

1. GHCR：`ghcr.io/peers-labs/peers-touch-station:vX.Y.Z`（manifest list：amd64+arm64，OCI labels 与 tag 自洽）。
2. GitHub Release `vX.Y.Z`（只有全部 candidate/public 证据落地后才可生成）：
   - `Peers_*_universal.dmg`（单一 universal，含 x86_64+arm64）；
   - `Peers_*_x64-setup.exe`（NSIS currentUser，x86_64）；
   - `Peers_*.AppImage`、`peers_*.deb`（x86_64）；
   - 一个完整 `latest.json`，Windows/Linux 和两个 macOS 架构键；`.app.tar.gz`、AppImage、NSIS 的更新签名；
   - `docker-compose.yml`（由模板和本次 image digest 渲染）、`install.sh`（源文件一致）、`station-release.json` 和 `checksums.txt`（流水线实际资产生成）。
3. 安装文档中固定 tag 的 curl 指令可在干净 ubuntu 环境一次成功。

当前没有任何一项真实发布产物。上述清单是 Release runtime 的完成条件，不是源码实现已产生的文件列表。

## 5. 迁移与切换策略

无历史用户产物需要迁移（当前不存在公开镜像与安装包）。切换顺序约束：

1. RD-D13 镜像源参数化先独立落地，四条消费路径构建验证通过，测试机/PR 路径不回归；
2. deploy-station.yml 摘除 tag 触发并验证 workflow_dispatch 部署仍可用；
3. release.yml 用两个完整包内版本递增的候选演练，候选实际资产通过认证 API 下载；公开后新 Suite 无凭证检查，rc 不晋级 latest；
4. identifier 与 updater 配置在首个正式 tag 前合入（首发后不可变）；
5. 完整正式版公开验收通过后才晋级 latest；失败的公开版保持非 latest，rc 不因测试结果成为正式版。

安装器 schema/备份状态和恢复影响由 data-model.md 定义。复原旧镜像不足以恢复数据，升级先备份数据库、身份、附件和配置；兼容证据缺失时拒绝原位回滚。

## 6. 与治理模块的边界

- 本模块（module id `release-distribution`）治理：release.yml、`tooling/distribution/` 内的发布 lifecycle 文件（安装器、用户 compose、release-* 校验与 Suite）、分发相关 tauri 配置面、本架构目录。同目录的 `channels.json` 按 XCFG-D06 归 `x-config` 模块，打包 identity 文件（`flavors.*`、`build-manifest.mjs`、`package.mjs`）不在本模块所有权内；注册以精确文件路径登记。
- `tooling/docker/` 与 devctl 被多个开发/部署/acceptance 流程共享，注册 governedPaths 时只登记新增目录与 release.yml，避免与现有模块路径重叠；RD-D13 对共享文件的改造以跨模块影响在执行计划中显式列出（质量门 6 承接验证），不主张所有权转移。
