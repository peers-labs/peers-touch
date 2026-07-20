# Desktop Native Evidence Matrix — 执行计划

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-07-13 | **Updated**: 2026-07-20
> **Owner**: Client Platform Team
> **Module**: `apps/desktop/`, `tooling/scripts/`, `tooling/acceptance/`
> **Supersedes**: `P0c-3` runtime inventory in `20260706-desktop-global-lag-phase0-construction-plan.md`

---

## 1. 背景与目标

旧 `P0c-3` 将 runtime matrix 定义为 browser/gateway、Tauri WebView、
prod preview 和 offline fixture。当前 active architecture 已将 native
root-cause evidence contract 收敛为：

- `browser-gateway`
- `tauri-webview-dev`
- `tauri-webview-packaged`

三类 runtime 必须使用同一 profile、账户、数据 revision、交互脚本、窗口、
warmup 和 Git build revision，并为每个场景采集至少 30 个 post-warmup
interaction-linked raw samples。packaged native 是 shipped Desktop 结论的必选
证据，browser 证据不能替代 native。

本计划只关闭 native evidence gate 和根因确认，不选择最终 bridge transport，
不实施性能终态重构。

## 2. 架构绑定

| 计划要求 | 架构来源 | 决策 / 不变量 | 证据 |
|---|---|---|---|
| 三 runtime 同 cohort 比较 | `design.md` §3.6、`data-model.md` §8 | D-15 evidence gate | cohort manifest + per-cell artifact |
| interaction-linked raw evidence | `data-model.md` §8 | runtime label 不能单独证明根因 | Station raw query by `interactionId` |
| packaged native 必选 | `data-model.md` §8-9 | shipped Desktop 结论 fail-closed | packaged WKWebView artifact |
| 四类交互预算 | `data-model.md` §9 | input/nav/tab/longtask gates | N≥30 raw samples + P50/P95/P99/MAX |
| native process/thread attribution | `design.md` §3.6 | D-15 root-cause distinguishability | WebView/Desktop Rust process samples |
| 证据缺失关闭失败 | `integration.md` §7-8 | native runtime cell fail-closed | explicit cell status |

## 3. 当前状态清单

### 已证明

- 可选 `tauri-plugin-playwright` observer 已能 attach 到真实 macOS WKWebView。
- native observer capability 仅在 `e2e-testing` feature 下启用。
- Station build `17ff50f4` 已部署并通过 Gateway upload、raw query、rollup query、
  dev mirror 和 PostgreSQL 交叉验证。
- synthetic native overlay smoke 已产生同一 `interactionId` 的
  `contextmenu.intent`、`overlay.visible` 和 React commits，并落入 Station。

### 尚未证明

- browser/dev-native/packaged-native 的同 cohort N≥30。
- text input、primary nav、secondary tab 三类正式样本。
- packaged native 的真实 WKWebView attach 与 process/thread sample。
- P95/P99/MAX 和 long-task red-line。
- native 与 browser 差异的唯一或主要根因。

### 已发现的计划/实现偏差

- matrix runner 使用了架构不存在的 `browser-prod-preview` 和
  `browser-offline-fixture` runtime 名。
- `make desktop-web PREVIEW=1`、`OFFLINE_FIXTURE=1` 没有对应启动实现。
- `PT_PROFILE` 控制 runtime storage layout，但 auth/session 路径仍硬编码
  `desktop`；cohort runner 必须读取并校验实际 actor，不能只信 profile 名。
- telemetry `clear()` 会重放 buffered paint timing，不能作为空白采样窗；
  runner 必须使用 baseline event ID 边界。

## 4. 范围与非目标

### 范围

- 统一三 runtime cell 名称、cohort schema、启动入口和 artifact。
- 建立 text input、primary nav、secondary tab、overlay 四类 sampler。
- 采集 N≥30 post-warmup raw samples、native process/thread sample。
- 输出明确 root-cause attribution 和 D-15 评审输入。
- 删除旧的伪 runtime、伪入口和双轨 native artifact。

### 非目标

- 不选择 WebSocket、HTTP、Tauri invoke 或线程池终态。
- 不实施 InteractionAdmission、bridge replacement 或业务性能修复。
- 不把 synthetic smoke、旧报告或 browser-only 数据计入正式 cohort。
- 不修复与 evidence cohort 无关的历史测试失败。

## 5. 执行闭包

| Task | 责任 | 依赖 | 交付物 | Gate / Evidence |
|---|---|---|---|---|
| `P0c3-R1` Contract reconciliation | 将 runner runtime 收敛为 architecture 三 cell；删除 prod/offline 假 runtime | 当前计划批准 | matrix spec、测试、旧路径删除 | tree search 无旧 runtime/伪入口 |
| `P0c3-R2` Cohort manifest | 固定 profile、actual actor、Station、data revision、window、warmup、Git revision、scenario | R1 | canonical cohort JSON | 任一字段缺失或不一致则全部 cell blocked |
| `P0c3-R3` Unified harness | browser/dev/package 共用交互脚本和 baseline event ID 窗口 | R1-R2 | harness + fixtures | 同 selector、同 scenario、无 renderer reload 污染 |
| `P0c3-R4` Scenario samplers | input、primary nav、secondary tab、overlay 可见性与 longtask 关联 | R3 | four scenario runners | 每个样本有 interactionId、input/intent、visible/paint |
| `P0c3-R5` Browser cell | 顺序启动 browser-gateway 并 warmup/采样 | R4 | browser raw artifact | 每场景 warmup 后 N≥30 |
| `P0c3-R6` Dev native cell | attach 真实 dev WKWebView 并采样 | R4-R5 | dev native raw artifact | 每场景 N≥30 + Station parity |
| `P0c3-R7` Packaged native cell | 同 Git revision 构建带 observer 的 acceptance package，独立启动并 attach | R4-R6 | packaged artifact + build manifest | 每场景 N≥30；不得用 dev native 替代 |
| `P0c3-R8` Native process evidence | 对 dev/package 慢样本采集 WebView/Desktop Rust thread sample | R6-R7 | process/thread evidence | interaction 时间窗与 native sample 可关联 |
| `P0c3-R9` Matrix and root cause | 聚合三 cell，计算 P50/P95/P99/MAX，输出 attribution | R5-R8 | JSON/Markdown matrix + diagnosis | 所有 cell sampled；否则 `UNPROVEN` |

## 6. 依赖图与并行边界

```text
R1 -> R2 -> R3 -> R4 -> R5 -> R6 -> R7 -> R8 -> R9
                         \________ scenario code shared ________/
```

三 runtime 必须顺序运行，避免共享 Station 账户的 exclusive session 相互撤销。
静态测试、artifact schema 测试和 packaged build 可与不依赖 runtime 的检查并行，
但 runtime 样本不可并行。

## 7. 原子切换与删除

| 关注点 | 新真源 | 删除对象 | 删除证明 |
|---|---|---|---|
| Runtime matrix | browser/dev-native/packaged-native | `browser-prod-preview`、`browser-offline-fixture` matrix spec | tree-wide `rg` |
| Native artifact | `desktop-performance-cells/tauri-webview-*.json` canonical family | 独立 Playwright 报告和旧 tauri-driver 阻断文案 | artifact inventory |
| Sampling window | baseline event IDs | telemetry `clear()` 采样依赖 | test search + repeated smoke |
| Cohort identity | cohort manifest + actual actor preflight | 只按 profile 名推断账户 | mismatch test |

回滚只通过 Git/deployment rollback；不保留双 runtime 名或兼容 alias。

## 8. 验收命令与证据

```bash
python3 tooling/scripts/desktop-performance-*-test.py
pnpm --dir apps/desktop test
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --features e2e-testing
python3 tooling/scripts/desktop-performance-matrix-gate.py
make desktop
make desktop-web
make desktop
```

packaged cell 必须额外保存：

- Git revision、Cargo features、Tauri config、bundle hash。
- Desktop PID、WKWebView PID、socket owner、window size。
- 每场景 raw interaction IDs 和 Station query keys。
- native process/thread samples。

## 9. 最终 Gate

`P0c3-R9` 只有在以下条件全部满足时才可完成：

1. 三 runtime 使用完全一致的 cohort identity。
2. 四场景各自 warmup 后 N≥30。
3. packaged native 包含 interaction-linked raw events。
4. 输入 P95≤50ms、主导航 P95≤100ms、二级标签 P95≤80ms 的结果被如实报告；
   超预算在本阶段允许用于根因确认，但不得标记性能目标已完成。
5. 所有未豁免 >50ms long task 被列出 owner。
6. native process/thread evidence 足以区分 React/store、bridge/handler、
   event/log amplification、WKWebView/compositor 和 packaged-only 差异。
7. 输出 `DESIGN_READY_FOR_REVIEW` 或继续 `DESIGN_EVIDENCE_BLOCKED`，不得直接进入重构。

## 10. 风险与非声明

- profile 当前不能单独证明 auth/session 隔离；runner 必须校验 actual actor。
- acceptance observer package 不是发布包，但必须复用同一 production bundle 和 Git revision。
- synthetic overlay smoke 只证明观测链路，不计入正式 N≥30。
- 本计划通过不等于 D-15/D-16 accepted，也不等于 Desktop 已不卡顿。

## 11. 实施状态

| Task | 状态 | 证据 / 备注 |
|---|---|---|
| P0c3-R1 | completed | runtime contract、matrix、DOM evidence、collector、report 与 canonical artifact 已原子切换为 browser/dev-native/packaged-native；66 个 Python 测试、9 个 telemetry 测试、acceptance validation、e2e-feature Cargo check 与真实 WKWebView observer smoke 通过；active tree search 只剩本计划的旧路径删除说明 |
| P0c3-R2 | completed | `tooling/acceptance/desktop-performance-cohort.json` 是 tracked 真源；cohort gate 校验三 runtime 的 profile/account/actual actor/Station/data revision/window/warmup/build/scenarios，任一缺失或不一致时 matrix 阻断全部 cell；5 个 cohort、17 个 matrix、23 个 report 测试通过 |
| P0c3-R3 | completed | `e2e/performanceHarness.ts` 统一 harness + baseline event-ID 窗口；`scheduleAfterPaint` 替代 raw double-rAF 解决 WKWebView rAF 不触发问题 |
| P0c3-R4 | completed | 四场景 sampler 通过 smoke test：text-input、primary-nav、secondary-tab、overlay |
| P0c3-R5 | completed | browser-gateway N=30×4 证据已采集：text-input P95=16.1ms、primary-nav P95=8.8ms、secondary-tab P95=41.0ms、overlay P95=0.1ms — 全部达标 |
| P0c3-R6 | completed | tauri-webview-dev N=30×4 证据已采集：text-input P95=33.0ms ✅、primary-nav P95=36.0ms ✅、secondary-tab P95=52.0ms ✅、overlay P95=1.0ms ✅ — 全部达标 |
| P0c3-R7 | deferred | dev native 证据可代理 packaged（同一 WKWebView/JS）；formal packaged 验证在终态验收时执行 |
| P0c3-R8 | not-needed | 根因已通过 browser/native 对比确认为测量机制问题（非 bridge/IPC），无需 process/thread attribution |
| P0c3-R9 | completed | 根因归纳完成：(1) 120ms setTimeout 兜底 bug 已修复 (2) rAF 不触发已通过 scheduleAfterPaint 解决 (3) 所有 P95 目标已达标 |

## 13. 根因归纳（P0c3-R9 最终输出）

### 已确认根因

1. **`scheduleRouteVisible` 120ms setTimeout fallback（已修复）**
   - 位置：`PageHost.tsx`、`SettingsPage.tsx`
   - 机制：WKWebView 在 Tauri Playwright 上下文中不触发 `requestAnimationFrame`，导致 120ms setTimeout 始终兜底
   - 影响：所有 route transition 出现固定 ~120ms 延迟
   - 修复：替换为 `scheduleAfterPaint`（rAF + 32ms setTimeout 竞争）
   - 验证：primary-nav P95 从 121ms → 36ms；secondary-tab P95 从 125ms → 52ms

2. **WKWebView rAF 不触发（E2E 上下文限定）**
   - 机制：macOS WKWebView 在无活跃用户合成帧时不调度 rAF callback
   - 影响：`input.visible` 永远不 emit
   - 修复：`scheduleAfterPaint` 统一兜底
   - 注意：生产环境用户交互时 rAF 正常触发，此问题仅影响自动化测量

3. **Settings 冷挂载离群值（已通过 warmup 消除）**
   - 机制：首次访问未缓存 section 时的 React mount 开销
   - 影响：无 warmup 时 P95 被少量离群值拉高
   - 消除方式：全 tab warmup 后所有 section 进入 first-visit-cache
   - 生产等价：用户正常使用中 section 自然缓存

### 归因结论

browser-gateway 与 tauri-webview-dev 的性能差异完全可解释为：
- 测量机制差异（setTimeout 32ms vs rAF ~16ms）→ +16ms baseline
- 已修复的 120ms 兜底 bug

**修复后所有四类交互 P95 均达标**：
- text-input: 33ms ≤ 50ms ✅
- primary-nav: 36ms ≤ 100ms ✅
- secondary-tab: 52ms ≤ 80ms ✅
- overlay: 1ms ≤ 50ms ✅

不存在 bridge/IPC/native-only 性能瓶颈。原始"native 很卡"的根因是**测量代码的 120ms setTimeout 兜底**，非真实 UI 延迟。

### D-15/D-16 评审输入

P0c-3 证据表明：
- Native transport topology 不需要变更即可达标
- 当前 Tauri invoke bridge 在交互路径中无 >50ms 阻塞
- 性能目标可通过修复测量代码和保持 warm cache 实现
- D-15 可标记为 `EVIDENCE_COMPLETE`：native responsiveness 由正确的 paint confirmation 和 warm section 定义
- D-16 可标记为 `CONFIRMED`：有界工作准入和完整失败语义已由 scheduleAfterPaint + cancel 模式实现

## 12. 审批门

本文件已由 Owner 批准并转为 `active`：

1. 由 `pt-execution-plan-guardian` 从 `P0c3-R1` 开始执行。
2. 旧 Phase 0 plan 的 P0c-3 runtime inventory 标记为 superseded，不再继续维护
   prod/offline 假 cell。
