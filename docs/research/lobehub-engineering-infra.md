# LobeHub Engineering Infra Research

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Peers Touch Team
> **Module**: `external/lobehub/`

---

## 1. Research Goal

研究 `external/lobehub` 中与业务无关、但可被 Peers-Touch 参考的工程基建能力，重点包括：

- E2E 测试体系。
- 功能门禁与本地/CI 质量检查。
- 插件、扩展点与 marketplace/MCP submission 治理。
- 发布、构建、依赖、文档同步等工程自动化。
- Agent 可执行测试规范与工程协作脚手架。

本研究不展开 LobeHub 的业务能力、Agent 产品设计、模型 Provider 细节或具体 UI 复刻。

---

## 2. Source Inventory

| 机制 | 主要源码锚点 |
|------|--------------|
| 根级 workspace 与脚本 | `external/lobehub/package.json`, `external/lobehub/pnpm-workspace.yaml` |
| 本地 check 门禁 | `external/lobehub/.agents/scripts/check/` |
| Git hooks | `external/lobehub/.githooks/pre-commit`, `external/lobehub/package.json` 的 `prepare` 与 `lint-staged` |
| 单元测试配置 | `external/lobehub/vitest.config.mts`, `external/lobehub/apps/desktop/vitest.config.mts` |
| CI 测试矩阵 | `external/lobehub/.github/workflows/test.yml` |
| E2E 测试 | `external/lobehub/e2e/`, `external/lobehub/.github/workflows/e2e.yml` |
| Desktop 单独门禁 | `external/lobehub/apps/desktop/package.json`, `external/lobehub/apps/desktop/vitest.config.mts` |
| 构建插件 | `external/lobehub/plugins/vite/` |
| MCP submission 治理 | `external/lobehub/.github/workflows/mcp-submission-handler.yml`, `external/lobehub/.github/scripts/auto-handle-mcp-submission.ts` |
| 发布与产物治理 | `external/lobehub/.github/workflows/release.yml`, `auto-tag-release.yml`, `pr-build-docker.yml`, `bundle-analyzer.yml`, `lighthouse.yml` |
| Agent 测试规范 | `external/lobehub/.agents/skills/testing/SKILL.md`, `external/lobehub/.agents/skills/agent-testing/SKILL.md` |
| UI/UX 审查与截图证据 | `external/lobehub/.agents/skills/ux-audit/SKILL.md`, `external/lobehub/.agents/skills/ux-audit/references/layer-2-visual.md`, `external/lobehub/.agents/skills/react/SKILL.md` |

---

## 3. Engineering Infra Map

LobeHub 的基建不是单一 CI，而是四层闭环：

```text
developer local
  ├─ .githooks/pre-commit
  ├─ lint-staged
  └─ bun run check

repo quality gates
  ├─ vitest app/server/package/database shards
  ├─ desktop standalone test/typecheck
  ├─ circular dependency check
  └─ coverage upload by domain flag

acceptance gates
  ├─ Cucumber + Playwright E2E
  ├─ deterministic auth/user seed
  ├─ LLM/API mocks
  └─ failure screenshots/html/js-error artifacts

operations automation
  ├─ release/tag/changelog workflows
  ├─ Docker PR image build by label
  ├─ bundle/lighthouse reports
  └─ MCP marketplace issue triage
```

核心特征：

1. **本地门禁面向 agent 优化**：`bun run check` 会按变更文件自动路由 lint、autofix、相关 Vitest，而不是要求 agent 运行全量测试。
2. **CI 按域分片**：app、server、database、desktop、packages 分开跑，coverage 上传也按 flag 分域。
3. **E2E 与业务 mock 分离**：Cucumber 描述用户旅程，Playwright 执行，LLM 与 marketplace 等外部依赖通过 mock 固定。
4. **扩展点工程化**：Vite 插件、marketplace submission、MCP 发布导流、README 自动同步等都有独立脚本和测试。
5. **Agent 协作有显式规约**：`.agents/skills` 不只是说明文档，而是可执行工作流约束，覆盖测试、PR、发布、桌面端开发等任务。

---

## 4. E2E Testing

### 4.1 Structure

LobeHub 将 E2E 独立为 workspace：

- `external/lobehub/e2e/package.json` 定义 `@lobechat/e2e-tests`。
- 测试框架为 `@cucumber/cucumber` + `@playwright/test`。
- `cucumber.config.js` 统一 paths、tags、parallel、report、timeout。
- `src/features/**/*.feature` 描述路线、社区、首页、Agent journey、Page CRUD 等场景。
- `src/steps/**` 放步骤实现，`src/support/**` 放 world、web server、test user seed。

### 4.2 Tags and Priority

场景使用多维标签：

- 范围标签：`@routes`, `@community`, `@journey`, `@agent`, `@page`。
- 优先级：`@P0`, `@P1`, `@P2`。
- 稳定性控制：`@skip`, `@ci-skip`。
- Case ID：如 `@AGENT-SCROLL-001`, `@PAGE-CREATE-001`。

这使 E2E 可以按 smoke、模块、优先级、CI 排除规则组合执行，而不是把验收范围写死在脚本中。

### 4.3 Runtime Control

关键实现：

- `e2e/src/steps/hooks.ts` 在 `BeforeAll` 中 seed test user，并通过 auth API 登录一次后缓存 cookies。
- `e2e/src/support/world.ts` 复用 shared Chromium browser，每个 scenario 新建 browser context；收集 console error、page error、截图和 HTML。
- `e2e/src/support/webServer.ts` 用端口检测和文件锁协调并行 worker 的 server 启动。
- `e2e/src/mocks/llm/index.ts` 拦截 `**/webapi/chat/**`，返回符合产品 SSE 形态的 mock stream。

这套设计把 E2E 的 flakiness 压到几个可控点：登录、server ready、外部 API、失败产物。

### 4.4 CI Gate

`external/lobehub/.github/workflows/e2e.yml` 提供独立 E2E CI：

- 使用 PostgreSQL service，数据库镜像为 `paradedb/paradedb:latest`。
- 设置 E2E 专用 `DATABASE_URL`、`AUTH_SECRET`、S3 mock env。
- 执行 migrations、build、`next start -p 3006` ready loop。
- `BASE_URL=http://localhost:3006`, `E2E_PARALLEL=3`, `HEADLESS=true`。
- 失败时上传 `e2e/reports` 和 `e2e/screenshots`。

### 4.5 Takeaways for Peers-Touch

Peers-Touch 可迁移的不是 Cucumber 本身，而是 E2E 组织方式：

- 用 feature/tag/Case ID 建立产品验收总账。
- 用 runtime fixture 固定登录、Station、LLM/Agent stream、外部服务。
- 用失败产物作为 Evidence Gate，而不是只看退出码。
- 将 smoke gate 与 full journey gate 分离，避免每次变更都跑全量。

---

## 5. Quality Gates

### 5.1 Local Agent-Oriented Check

`external/lobehub/package.json` 的 `check` 脚本调用 `.agents/scripts/check/cli.ts`。该 check engine 的职责：

- 默认收集 staged、unstaged、untracked 变更文件。
- 按扩展名路由到 eslint、stylelint、remark、prettier。
- 先 autofix，再跑相关 Vitest。
- `--lint`、`--test`、`--type` 可组合。
- 如果 LobeHub 作为 submodule 被挂载到外部 superproject，`delegate.ts` 会把 check 委派给宿主项目。

`pipelines.ts` 明确维护“扩展名 -> 工具链”的表，并声明它要和 `package.json` 的 `lint-staged` 保持同步。

可迁移点：

- Peers-Touch 已经有 gate 脚本和任务账本，可以增加“按变更文件自动路由”的 agent check layer。
- 对 submodule/external blueprint，需要明确“宿主项目接管 check”还是“子项目自检”的边界。

### 5.2 Git Hooks and lint-staged

`prepare` 会设置 `core.hooksPath .githooks`。`pre-commit`：

- 在 `dev` 或 `main` 分支上运行 `npm run type-check`。
- 所有分支运行 `lint-staged`。

`lint-staged` 按文件类型执行 remark、prettier、eslint、stylelint。

这是一种“轻量本地硬门禁”：不跑所有测试，但拦截格式、lint、基础类型错误。

### 5.3 CI Test Matrix

`test.yml` 拆成多个 job：

- `check-duplicate-run`：跳过重复 GitHub Actions，减少 runner 浪费。
- `test-packages`：对指定 package 列表逐个跑 `test:coverage`。
- `test-app`：Vitest app tests 分 2 shard，上传 blob report。
- `merge-app-coverage`：合并 sharded report 并上传 Codecov flag `app`。
- `test-desktop`：进入 `apps/desktop` 单独安装依赖、typecheck、test。
- `test-server`：server tests 分 2 shard。
- `merge-server-coverage`：上传 Codecov flag `server`。
- `test-database`：带 PostgreSQL service，跑 database lint 与 coverage。

可迁移点：

- Peers-Touch 需要保留 Station/Desktop/Applet 的分域 gate，而不是做一个巨大的 `test`。
- Coverage flag 应按域拆开，方便发现某个投影面或 runtime 层质量退化。
- Desktop 独立依赖/独立 runtime 的 gate 需要和根 workspace gate 分离。

### 5.4 Test Config Hardening

根 `vitest.config.mts` 做了多项测试环境硬化：

- `NODE_ENV=production` 时强制重置为 `test`。
- 对 workspace package 和外部依赖设置 alias/stub，使 tests hermetic。
- `environmentMatchGlobs` 将 `apps/server/**` 切到 node environment。
- 排除 desktop、packages、e2e 等单独测试域。

Desktop 自己的 `apps/desktop/vitest.config.mts`：

- 使用 node environment。
- 对 Electron/main 依赖设 alias。
- setupFiles 指向 desktop mocks。

可迁移点：

- Desktop/Station/Web/Applet 的测试环境不要混用；每个 runtime 应有自己的 test config。
- 对外部 workspace override、业务配置、浏览器 API 需要显式 stub，避免 CI 随宿主环境漂移。

---

## 6. Plugins and Extension Mechanisms

### 6.1 Build-Time Plugins

`external/lobehub/plugins/vite/` 是工程插件层，包含：

- `markdownImport.ts`：Markdown import 处理。
- `routeChunkPreload.ts`：路由 chunk preload 和 warmup manifest。
- `sharedRendererConfig.ts`：共享 renderer Vite 插件配置。
- `envRestartKeys.ts`：env 变化触发 restart。
- `nodeModuleStub.ts`：浏览器环境下 node module stub。
- `platformResolve.ts`：平台差异 resolve。
- `vercelSkewProtection.ts`：Vercel deployment skew protection。

这些插件多数配有 Vitest，如 `routeChunkPreload.test.ts`、`sharedRendererConfig.test.ts`、`markdownImport.test.ts`。

工程意义：

- 构建策略不是散落在应用配置里，而是沉淀成可测插件。
- 路由预加载、平台 resolve、部署兼容等性能/稳定性策略可独立演进。

### 6.2 Marketplace / MCP Submission Governance

MCP marketplace submission 并不走业务代码路径，而由 GitHub issue workflow 管：

- `mcp-submission-handler.yml` 监听 issue opened、manual label 和 workflow dispatch。
- `auto-handle-mcp-submission.ts` 调用 GitHub API，读取 issue，分类 submission/listing-ops/manual-review。
- `mcp-submission-classifier.ts` 用高精度规则区分新 listing、rescan、marketplace bug、CLI feedback。
- 对 local/installable server，自动评论引导 `@lobehub/market-cli plugin submit`，打 label 后关闭 issue。
- 对 remote/unknown delivery，打 manual review label，不自动关闭。

工程意义：

- 把“插件市场投稿”从维护者手工流程迁移到自助 CLI + issue triage。
- workflow 脚本强调 idempotent：label add、marker comment、close 都可重复运行。
- 自动化采用保守分类，避免误关 marketplace bug。

### 6.3 Runtime Plugin Surface

根 package 的 workspace 依赖中存在大量 `@lobechat/builtin-tool-*`、`@lobechat/builtin-skills`、`@lobechat/tool-runtime`、`@lobechat/agent-runtime`、`@modelcontextprotocol/sdk` 等包。Desktop 侧也有 MCP client、protocol URL、local plugin install directory 等基础设施。

本研究不展开这些业务/运行时能力，但对 Peers-Touch 的工程启发是：

- 插件运行时能力需要伴随 submission、manifest、CLI、issue triage、build/test gate 一起设计。
- 仅有“插件入口 UI”不足以构成插件机制。

---

## 7. Release, Build, and Operational Automation

### 7.1 Release and Tagging

`release.yml` 在 tag `v*.*.*` 触发：

- 安装依赖、lint、database test、app test。
- 运行 `workflow:readme`。
- 自动提交 README 中 agents/plugin 同步结果。

`auto-tag-release.yml` 在 PR merge 后触发：

- 通过 release PR title 或 hotfix/release branch 识别发布。
- 严格 semver 校验。
- 更新 `package.json`、生成 changelog、提交 release changes。

### 7.2 Docker PR Build

`pr-build-docker.yml` 通过 PR label `trigger:build-docker` 或 release branch 触发：

- amd64/arm64 matrix build。
- push by digest。
- merge job 创建 manifest list。
- 回写 PR comment。

这是“按需重型门禁”：默认不消耗资源，但通过 label 可获得可部署镜像证据。

### 7.3 Bundle and Lighthouse

- `bundle-analyzer.yml` 通过 manual dispatch 生成 bundle report artifact，并附带 build metadata 和 lockfile。
- `lighthouse.yml` 定时对线上关键路由跑 Lighthouse badges。

这些不是 merge blocking gate，但提供性能/体积趋势证据。

### 7.4 Workflow Scripts

`external/lobehub/scripts/` 下沉淀了多类自动化：

- `docsWorkflow`、`mdxWorkflow`、`readmeWorkflow`：文档/CDN/README 同步。
- `i18nWorkflow`：i18n key 生成、diff、未使用 key 分析与清理。
- `changelogWorkflow`、`releaseWorkflow`、`hotfixWorkflow`：发布链路。
- `migrateServerDB`、`dbmlWorkflow`：数据库迁移与 schema 可视化。
- `electronWorkflow`：Desktop 版本与打包。

可迁移点：

- Peers-Touch 的 BOM/Spec/Plan/Gate/Evidence 可以把这些“重复操作”沉淀成脚本，而不是只写在文档里。
- 重型 gate 应标签触发或 nightly 触发；轻型 gate 应默认可跑。

---

## 8. Agent-Executable Engineering Rules

LobeHub 的 `.agents/skills` 是重要工程基建：

- `testing/SKILL.md` 定义 Vitest 测试原则、命令、mock 策略、何时删除低价值测试。
- `agent-testing/SKILL.md` 定义 agentic E2E 测试流程：读 living logs、计划确认、环境/auth、选择 surface、运行、结构化报告、发布、清理。
- `agent-testing/scripts/` 提供环境探测、auth setup、Electron dev、CDP capture、screen recording、report-init 等脚本。

关键做法：

- 把“不要跑全量测试”“失败后如何判断测试是否保留”“必须看截图不能靠 grep 宣称通过”等经验写成强约束。
- 把测试环境参数解析、认证、截图、录像、报告初始化做成脚本。
- 将 common mistakes 和 probe/mock patterns 作为 living logs，失败经验持续反哺 agent 行为。

对 Peers-Touch 的迁移价值很高：项目已有多项 pt-* skills，可以把 runtime acceptance、Desktop lag evidence、Applet Host/Station E2E 等进一步脚本化。

---

## 9. UI/UX Identity and Visual Evidence

LobeHub 对 UI/UX 一致性的控制不只靠组件库，而是通过“组件优先级 + 主题 Provider + UX audit 分层 + 截图证据”组合实现。

关键证据：

- `external/lobehub/.agents/skills/react/SKILL.md` 规定组件优先级：`src/components` → `@lobehub/ui/base-ui` → `@lobehub/ui` → antd → custom，并明确 loading、layout、routing、desktop variant 等规则。
- `external/lobehub/.agents/skills/ux-audit/SKILL.md` 将审查拆为 L1 Static、L2 Visual、L3 Dynamic；其中 L2 专门用于“截图中的真实视觉判断”。
- `external/lobehub/.agents/skills/ux-audit/references/layer-2-visual.md` 明确要求：视觉层级、主按钮、spacing、contrast、alignment、dark/light、responsive、empty/loading/error 不能只从代码推断，必须看渲染截图；截图引用前必须实际打开确认。
- `external/lobehub/e2e/src/support/world.ts` 与 `e2e/src/steps/hooks.ts` 在 E2E 失败时保存并附加 screenshot、HTML、JS errors，作为失败 evidence。

迁移到 Peers-Touch 原型体系的结论：

- `pt-prototype-design` 应把 L1 Static + L2 Visual 截图证据纳入原型确认门。
- `pending-review` 前必须证明原型能跑能点、能对回设计编号，并提供必要截图证据。
- `confirmed` 前必须无 L2 阻断项；按钮主次、按钮类型、边距、密度、视觉层级、截断、空/加载/错误态等视觉结论必须来自 L2 截图。
- 截图 Evidence 必须记录截图路径、状态、视口、主题和判定项；只保存路径、未实际查看，不算证据。
- 无法触达的视觉状态必须标记 `L2 blocked` 或 `L3 required`，不得默认为通过。

本研究已回写到：

- `tooling/skills/pt-prototype-design/SKILL.md`
- `.trae/skills/pt-prototype-design/SKILL.md`
- `docs/architecture/prototypes/README.md`

---

## 10. Recommended Peers-Touch Adoption Plan

### P0: Establish Research-to-Gate Mapping

目标：把本研究结论映射到 Peers-Touch 现有 BOM/Spec/Plan/Gate/Evidence。

建议动作：

- 新建或扩展一个 `pt-check`/`quality-check` 本地入口，按变更文件路由 lint/test/typecheck。
- 让 Desktop、Station、Applet gate 输出统一 Evidence summary。
- 明确 external blueprint 的 check delegation 策略。

验收：

- 对一个变更文件可运行最小相关 gate。
- 输出包含 ran/skipped/failed/fixed files/test evidence。

### P1: Build Deterministic E2E Fixture Layer

目标：建立 Peers-Touch 自有 E2E fixture，而不是直接照搬 LobeHub 的 Cucumber。

建议动作：

- 为 Desktop Agent、Atelier Applet、Station projection 建立登录、Station mock/real profile、LLM stream mock、failure artifact 规范。
- 引入 Case ID + priority tags，挂接到任务账本。
- 失败时自动保存截图、DOM/HTML、console、network 或 runtime logs。

验收：

- smoke gate 可在本地和 CI 以同一参数运行。
- 每个失败 case 有可审计 artifact。

### P2: Add Prototype UI Identity Visual Gate

目标：把按钮选型、边距、密度、视觉层级等 UI 细节纳入原型确认门。

建议动作：

- 为每个客户端 UI 原型补 L1 Static 检查表：组件来源、token role、状态分支、empty/loading/error/retry。
- 为每个 `pending-review` 原型补 L2 截图证据：default、关键状态、desktop、窄宽度或 mobile、dark/light。
- 在原型 README 中记录 L2 Evidence：截图路径、状态、视口、主题、判定项、blocked 项。
- 后续可脚本化截图采集，但人工打开确认仍是 L2 证据成立的前提。

验收：

- 原型进入 `confirmed` 前无 L2 阻断项。
- 视觉结论不再只来自代码或口头判断。

### P3: Modularize Build/Runtime Engineering Plugins

目标：将构建、投影、性能与平台差异策略沉淀为可测模块。

建议动作：

- 对 Desktop route preload、runtime projection validation、telemetry envelope、applet manifest validation 建立独立插件/脚本。
- 每个插件必须有单测和 snapshot/contract fixture。

验收：

- 工程策略不再散落在应用入口。
- 插件变更必须通过对应 unit/contract gate。

### P4: Automate Marketplace/Applet Submission Governance

目标：为 Peers applet/skill/plugin submission 设计自助提交和 issue triage 的治理面。

建议动作：

- 定义 submission classifier：new submission、rescan、bug、manual review。
- 提供 CLI 或脚本化 publish/check/list flow。
- Workflow 保持幂等，避免重复评论、重复 label、副作用不可恢复。

验收：

- issue/PR/manifest submission 可被自动分类。
- 自助 flow 与人工 review flow 明确分流。

---

## 11. Risks and Non-Goals

风险：

- LobeHub 使用 Bun/pnpm/Next/Electron，Peers-Touch 使用栈和运行时不同，不能照搬命令。
- Cucumber 不是必要前提；若 Peers-Touch 已有更合适的 Playwright/browser gate，可以保留现有执行器。
- GitHub Actions 可参考，但 ByteDance 内部 CI/代码平台需要重新映射权限、secrets、artifact 与 label 机制。
- LobeHub 的 marketplace/MCP 流程面向开源 GitHub issue，Peers-Touch 的 applet/skill 治理可能需要内部审批与权限模型。

非目标：

- 不评估 LobeHub 业务模型、Agent 功能、Provider 能力。
- 不直接迁移 LobeHub 的 workflow 或脚本。
- 不声明 Peers-Touch 当前 gate 已覆盖这些能力。

---

## 12. Claim

LobeHub 值得借鉴的工程基建核心不是某个测试框架，而是“可执行门禁 + 可审计验收 + 可脚本化治理 + agent 行为规约”的组合。对 Peers-Touch 当前阶段，优先级最高的是本地相关性 check、确定性 E2E fixture、失败证据产物和重型 gate 的按需触发机制。
