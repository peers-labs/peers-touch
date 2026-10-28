# Release Distribution（发布与分发）

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-21 | **Updated**: 2026-10-21
> **Owner**: Architecture Team
> **Module**: `tooling/distribution/` 发布 lifecycle 文件、`.github/workflows/release.yml`（同目录 `channels.json` 归 x-config，见 module-layout.md）

---

## 1. Document Scope

本文档定义：

- Station 服务端向**自托管用户**分发的目标形态：GHCR 多架构镜像、产品化 compose、一键引导脚本；
- Desktop 客户端在 macOS / Windows / Linux 的打包、发布与应用内更新契约；
- 版本、产物、签名信任链的唯一真源与所有权边界；
- 标签驱动的统一发布流水线、匿名验收、稳定频道与备份恢复边界。

本文档不定义：

- Station 内部业务架构（见 `docs/architecture/platform/station/`）；
- Desktop 应用内页面/运行时投影契约（见 `docs/architecture/platform/client/desktop/`）；
- 开发期 `make station` profile 体系与测试机部署（见 `docs/development/environment.md`、`.github/workflows/deploy-station.yml`）；
- Mobile 分发、Homebrew/Flatpak/Microsoft Store 等二级渠道；
- 代码签名证书采购与企业分发（Phase 2）。

## 2. 当前边界

当前源码已经建立两条分发链路的所有权与 fail-closed 边界：

1. **Station 用户安装面已实现**：固定 digest 的 GHCR 清单、同 tag 校验和、安装时生成凭据、备份、升级、兼容回滚、完整快照恢复和范围化卸载均由 `tooling/distribution/` 拥有。候选 Suite 使用私有 TLS 资产服务并通过真实 Actor、Dashboard 和 OSS API建立持久数据。
2. **Desktop 构建与 updater 注册已实现**：三平台 tauri-action、稳定 identifier、updater Builder、capability 和固定 tag 清单 URL 已接线。真实跨平台安装、签名拒绝、应用更新、重启读回尚无运行证据，因此工作流在 candidate/public 两个阶段显式失败，不能发布或晋级 stable。
3. **运行证据仍为空**：本模块没有公开 tag、GHCR 镜像、GitHub Release、签名密钥或 Docker Journey。源码检查不能替代这些证据，当前交付状态为 `UNPROVEN`。

## 3. 设计目标

1. Station 单节点具备 `curl … | sh` 一键安装能力，密钥在安装时本地生成、永不入库入镜像。
2. Station 镜像多架构（linux/amd64、linux/arm64）发布于 GHCR，以不可变 git tag 为版本真源。
3. Desktop 三平台安装包（dmg / NSIS exe / AppImage+deb）由官方 `tauri-apps/tauri-action` 矩阵构建并随 Release 发布。
4. 自首个公开版本起启用 Tauri updater（minisign 签名，零证书成本），应用内更新链路与代码签名相互独立。
5. 签名证书（Apple Developer ID、Windows OV/EV）不阻塞首发；未签名分发的系统摩擦如实文档化。
6. 开发/测试与用户安装生命周期分离，共享镜像契约的变更必须验证所有消费方。
7. 升级前备份完整实例；缺少 schema 兼容证据时拒绝原位回滚，使用经验证的完整快照恢复。

## 4. 文档导航

| 文档 | 说明 |
|------|------|
| [design.md](./design.md) | 证据账本、原则、系统架构、契约与失败语义、质量门 |
| [decisions.md](./decisions.md) | RD-D01 ~ RD-D14 决策记录（ADR-lite） |
| [integration.md](./integration.md) | 与现有 compose/Dockerfile/release 流水线/Tauri 配置的映射与切换 |
| [module-layout.md](./module-layout.md) | 目标目录布局与文件职责 |
| [data-model.md](./data-model.md) | 发布、安装、更新清单、备份与 Suite 证据状态 |

执行契约见 [RD-20261021 package](./execution-plans/20261021-release-distribution-review/plan.md)；旧 package 保留为历史设计输入，不作为当前运行证据。

## 5. 当前状态

- Architecture：`active`
- Source implementation：Station 安装生命周期与 Desktop 构建/注册契约已落地
- Functional proof：`UNPROVEN`（无 Docker daemon、真实版本对和跨平台 native runtime）
- Release：未授权；未 push、未创建 tag、未发布 Release 或镜像
