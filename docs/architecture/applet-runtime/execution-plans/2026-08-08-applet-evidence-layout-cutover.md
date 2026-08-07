# Applet Evidence Layout Cutover — 执行计划

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-08 | **Updated**: 2026-08-08
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/evidence/applets/`, `tooling/fixtures/applets/`, `tooling/scripts/`

---

## 1. 背景与目标

历史 `applet-readiness-evidence/` 混合了 reviewed evidence、源码 fixture 和运行产物，导致机器绝对路径、生成 bundle、SQLite 数据库、原始日志和 harness 被提交到 Git。

本计划执行 D-10 的一次性切换：建立三个互斥根目录，迁移全部生产者和消费者，删除旧根，并用 fail-closed gate 证明不存在双路径真源。

## 2. 范围与非目标

范围：

- 分类并迁移历史 Applet readiness 文件。
- 更新 Applet/Atelier scripts、contracts、controlled fixtures、commands 和文档。
- 让源码 fixture 在 `.artifacts/applet-readiness/packages/` 中构建和校验。
- 将 raw logs、bundles、databases、screenshots 和 harnesses 限定到 `.artifacts/applet-readiness/`。
- 增加 layout gate、脱敏规则和 release audit 分层读取。

非目标：

- 改变 Applet runtime、Gateway、SDK 或产品能力语义。
- 恢复历史缺失的运行证据。
- 以迁移后的旧证据声明当前产品 readiness。
- 在本计划内修复 Desktop runtime gate 的 lifecycle 行为缺口。

## 3. 上游架构

- `docs/architecture/applet-runtime/decisions.md` D-10
- `docs/architecture/applet-runtime/module-layout.md`
- `docs/architecture/applet-runtime/integration.md`
- `docs/architecture/applet-runtime/development-runtime-readiness-report.md`

目标目录：

```text
tooling/acceptance/evidence/applets/  # reviewed, redacted JSON/Markdown
tooling/fixtures/applets/             # deterministic source fixtures
.artifacts/applet-readiness/          # ignored, regenerable/raw artifacts
```

## 4. 实施任务

| ID | 任务 | 依赖 | 状态 |
|----|------|------|------|
| ELC-1 | 建立 D-10、目录 README 和 `.gitignore` contract | 无 | done |
| ELC-2 | 分类迁移 reviewed evidence 与 source fixtures，删除 raw/generated tracked files | ELC-1 | done |
| ELC-3 | 迁移 scripts、contracts、commands、controlled fixtures 和 docs 的全部路径消费者 | ELC-2 | done |
| ELC-4 | 分离 release audit 的 reviewed/raw 输入与输出 | ELC-3 | done |
| ELC-5 | 将 Note live smoke harness 放入 artifacts，并只提交脱敏摘要 | ELC-3 | done |
| ELC-6 | 执行 tree-wide cutover gate、package gates 和 contract gates | ELC-4, ELC-5 | done |
| ELC-7 | 完成 debt audit、提交并创建非 draft PR | ELC-6 | in progress |

## 5. 验收标准

### ELC-A1: 单一目录真源

- `applet-readiness-evidence/` 不存在。
- 除架构 tombstone/迁移说明外，tree-wide search 不存在旧根引用。
- 不存在 alias、symlink 或兼容读取逻辑。

### ELC-A2: Reviewed evidence 纯净

- `tooling/acceptance/evidence/applets/` 只含 JSON/Markdown。
- 不含 `/Users/`、`/private/tmp/` 或 Windows user-profile 绝对路径。
- 不含 raw stderr/stdout、bundle、database、screenshot 或 harness。

### ELC-A3: Fixture 可重建

- `tooling/fixtures/applets/` 不含 `dist/`、`node_modules/`、bundle 或 database。
- Gate 将 fixture 复制到 artifact package root 后构建。
- 构建后 manifest integrity 与 artifact bundle 一致。

### ELC-A4: Audit fail-closed

- Release audit 从 reviewed evidence root 读取长期 attestations。
- Release audit 从 artifact root 读取 raw gate outputs。
- Release audit 自身输出写入 artifact root。
- 缺失 raw artifacts 时 candidate/release audit 明确失败。

### ELC-A5: 验证

必须执行：

```bash
pnpm install --frozen-lockfile
pnpm applet:evidence-layout-gate
pnpm applet:developer-flow-gate
pnpm applet:contract-test
pnpm applet:sdk-adapter-test
pnpm applet:forbidden-producer-scan
pnpm atelier:projection-codegen-check
pnpm applet:official-contract-gate apps/applets/note
pnpm applet:l3-candidate-audit
```

`applet:l3-candidate-audit` 在没有本次运行生成的 raw artifacts 时应 fail-closed。Desktop runtime gate 在 cleanup 边界未经证明前不运行；该限制必须在 PR 中明确记录。

## 6. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 机械替换遗漏动态路径 | Tree-wide layout gate 扫描旧根和目录内容 |
| Reviewed evidence 再次写入 raw output | 公共路径 helper + extension/path hygiene gate |
| Fixture 依赖原 workspace 相邻解析 | 显式 `PT_REPO_ROOT` 和 SDK dist alias |
| Rebuild 后 integrity 漂移 | 只在 disposable artifact copy 中重算 manifest integrity |
| Runtime gate 删除工作树或越界清理 | 未证明 cleanup boundary 前禁止运行该 gate |
| 历史 evidence 被误当作当前 readiness | Release audit 继续校验 freshness 和 raw artifact presence |

## 7. Cutover 与回滚

Cutover 是单提交原子操作：新路径、全部消费者、删除旧根和文档必须同时进入 PR。

回滚只能回滚整个提交。禁止通过恢复旧根、增加 symlink 或双读路径做局部回滚。
