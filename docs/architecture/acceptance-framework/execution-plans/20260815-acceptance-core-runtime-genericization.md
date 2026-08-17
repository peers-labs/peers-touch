# Acceptance Framework Core Runtime — 执行计划

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-15 | **Updated**: 2026-08-16
> **Owner**: Architecture Team
> **Architecture Source**: [design.md](../design.md) v2.0, [decisions.md](../decisions.md) D-08~D-12
> **Module**: `tooling/acceptance/`

---

## 1. Accepted Architecture Sources

| Document | Decisions | Status |
|----------|-----------|--------|
| [design.md](../design.md) v2.0 | Core Runtime 七层模型、BaseDriver/AcceptanceGate/BaseFixture/Evidence Schema 接口、组件关系与依赖规则 | active |
| [decisions.md](../decisions.md) | D-08 (Core 基类), D-09 (多 Driver), D-10 (Harness Registry), D-11 (Evidence Schema), D-12 (Applet wrapper) | accepted |
| [module-layout.md](../module-layout.md) | 目标目录树、文件职责、依赖关系 | active |
| [integration.md](../integration.md) | 迁移路径、影响面、增量迁移策略 | active |

## 2. Scope and Non-Scope

**In scope**:
- 创建 `tooling/acceptance/core/` 通用抽象层
- 重构现有 TauriDriver 继承 DomDriver；StationDriver 只继承生命周期 BaseDriver
- 抽取 ChromeDriver（CDP）和 StationAPIDriver
- 重构 Chat/Dashboard/Desktop Gates 继承 AcceptanceGate
- 实现前端 Harness 注册机制，迁移 Chat Harness
- Applet MJS 脚本 Python wrapper 接入
- 统一 Evidence Schema 和报告输出
- 删除重复样板代码

**Out of scope**:
- MobileTauriDriver 实现（Phase 4，独立立项）
- YAML 契约层变更（capability/domain/feature/registry/gates 保持不变）
- Station Go / Desktop Rust 业务代码变更
- CI/CD pipeline 变更
- 性能验收体系变更
- 新功能域（Agent、Settings、OAuth）的具体验收 Gate 编写（Core 就绪后各域自行接入）

---

## 3. Current-State Inventory

### 3.1 需要重构的现有文件

| 文件 | 当前问题 | 目标状态 |
|------|---------|---------|
| `tooling/acceptance/drivers/tauri_webdriver.py` | 无基类，独立实现 | 移动到 `drivers/tauri.py`，继承 DomDriver，并删除旧入口 |
| `tooling/acceptance/gates/chat/desktop_dom_message_visible.py` | 重复 GateError/async_harness/save_dom/copy_app_log | 继承 AcceptanceGate，删除样板，业务逻辑不变 |
| `tooling/acceptance/gates/chat/native_two_client_runner.py` | 重复 GateError | 继承 AcceptanceGate |
| `tooling/acceptance/gates/chat/native_visible_e2e.py` | 重复 GateError | 继承 AcceptanceGate |
| `tooling/acceptance/gates/chat/group_pressure_security.py` | 重复 GateError | 继承 AcceptanceGate |
| `tooling/acceptance/gates/chat/private_pressure_security.py` | 重复 GateError | 继承 AcceptanceGate |
| `tooling/acceptance/gates/chat/group_admin_e2e.py` | 重复 GateError | 继承 AcceptanceGate |
| `tooling/acceptance/gates/dashboard/federation_visible_surface.py` | 自建 CDPSession (~300行)，无 Driver | 使用 ChromeDriver，删除 CDPSession 内联代码 |
| `tooling/acceptance/gates/desktop/gateway_smoke.py` | 手写 Tauri mock、gateway_command、CDP | 使用 StationDriver + ChromeDriver |
| `apps/desktop/src/acceptance/chatAcceptanceHarness.ts` | 直接挂载到 window，无注册 | 改为通过 registry 注册，移动到 `chat/harness.ts` |
| `apps/desktop/src/main.tsx` (L44-L48) | 硬编码导入 chatAcceptanceHarness | 动态导入 registry，自动发现已注册 Harness |

### 3.2 需要新增的文件

| 文件 | 职责 |
|------|------|
| `tooling/acceptance/core/__init__.py` | 包导出 |
| `tooling/acceptance/core/errors.py` | GateError 等统一异常 |
| `tooling/acceptance/core/evidence.py` | Evidence Schema、报告写入、证据文件管理 |
| `tooling/acceptance/core/gate.py` | AcceptanceGate 抽象基类、execute() 入口、自动证据收集 |
| `tooling/acceptance/core/harness.py` | 通用 JS async_harness bridge |
| `tooling/acceptance/core/drivers/__init__.py` | Driver 包导出 |
| `tooling/acceptance/core/drivers/base.py` | BaseDriver 抽象基类 |
| `tooling/acceptance/core/fixtures/__init__.py` | Fixture 包导出 |
| `tooling/acceptance/core/fixtures/base.py` | BaseFixture 抽象基类 |
| `tooling/acceptance/drivers/tauri.py` | TauriDriver（从 tauri_webdriver.py 迁移） |
| `tooling/acceptance/drivers/chrome.py` | Chrome/CDP Driver（从 dashboard gates 抽取） |
| `tooling/acceptance/drivers/station.py` | Station HTTP API Driver |
| `apps/desktop/src/acceptance/registry.ts` | Harness 注册表和自动发现 |
| `apps/desktop/src/acceptance/chat/harness.ts` | Chat Harness（从 chatAcceptanceHarness.ts 迁移） |

### 3.3 保持不变的文件

- 所有 `capabilities/*.yaml`、`domains/*.yaml`、`features/*.yaml`
- `registry.yaml`、`gates.yaml`
- `tooling/scripts/acceptance-*.py`（plan/run/validate/report）
- Station Go 代码（`apps/station/`）
- Desktop Rust 代码（`apps/desktop/src-tauri/`）
- Proto 定义和生成代码（`model/`）
- Make targets 和对外 CLI 接口

---

## 4. Responsibility Workstreams

| Workstream | ID | Responsibility | Deliverables | Dependencies | Gates |
|------------|----|----------------|--------------|--------------|-------|
| **WS0: Core Hardening** | WS0 | 修复独立审核发现的 Evidence actors 崩溃、证据脱敏、Driver ISP、路径单一真源和清理诊断 | ActorRuntime 序列化、redaction、BaseDriver/DomDriver 分层、Core tests | None | Core unit tests; Chrome E2E; native driver smoke |
| **WS1: Core Abstractions** | WS1 | 实现 core/ 基类、Evidence Schema 和 redaction | core/errors.py, core/evidence.py, core/redaction.py, core/gate.py, core/harness.py, core/drivers/base.py, core/fixtures/base.py | None | Python unit tests for base classes; import checks |
| **WS2: Tauri Driver Refactor** | WS2 | TauriDriver 继承 DomDriver | drivers/tauri.py；删除 tauri_webdriver.py 旧入口 | WS1 | `make acceptance-driver-smoke` ×3 PASS |
| **WS3: Chrome + Station Drivers** | WS3 | 抽取 CDP 和 Station API 为独立 Driver | drivers/chrome.py, drivers/station.py | WS1 | Chrome smoke test; Station API command test |
| **WS4: Chat Gates Refactor** | WS4 | Chat 域 Gates 继承 AcceptanceGate | 重构 6 个 chat gates | WS1, WS2 | `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-domain-validation` PASS |
| **WS5: Dashboard + Desktop Gates Refactor** | WS5 | Dashboard/Desktop Gates 使用新 Driver | 重构 2 个 gates | WS1, WS3 | `make acceptance-station-dashboard-domain-validation` PASS |
| **WS6: Frontend Harness Registry** | WS6 | Harness 注册机制 + Chat Harness 迁移 | apps/desktop/src/acceptance/registry.ts, chat/harness.ts, main.tsx update | None (parallel with WS1-WS5) | `pnpm run check` PASS; harness auto-discovery test |
| **WS7: Applet Gate Wrappers** | WS7 | Applet MJS wrapper gates 接入核心体系 | gates/applet/*.py wrappers; MJS --json flag | WS1 | Applet lifecycle gate PASS |
| **WS8: Final Validation + Cleanup** | WS8 | 全量验收、旧样板删除、文档更新 | 更新 README；删除剩余重复代码和旧路径引用 | WS1-WS7 | 所有现有 Gates PASS; `pnpm run check`; `gofmt`; secret scan; resource leak audit |

---

## 4.1 实施状态

| Workstream | 状态 | 已证明 | 未完成 / 限制 |
|------------|------|--------|---------------|
| WS0 | done | actors/dataclass+mapping 序列化、结构化/文本脱敏、Driver ISP、cleanup failure、单一路径均有回归测试 | 无 |
| WS1 | done | 30 个 Core tests 与含 actors/redaction 的 Chrome E2E 通过 | 不代表任何业务 Domain receiver proof |
| WS2 | done | TauriDriver 继承 DomDriver；旧入口删除；Acceptance binary 发布到 `.local/acceptance/bin/peers-touch-desktop`，不再与普通 dev build 共用可执行文件；native build 与连续 3 次 smoke 通过；端口/进程释放通过 | 不代表 Chat 登录/消息流程通过 |
| WS3 | partial | ChromeDriver、StationDriver 类已存在 | Dashboard/Desktop 无真实消费者；Chrome CDP 迁移未完成 |
| WS4 | partial | `native_two_client_runner.py` 已切换到 AcceptanceGate + Core TauriDriver；Direct DELIVERED Feature/Registry/Gate trace 与 validator 已补齐；Driver build/smoke PASS | multi-device、recovery、group-MLS 与其它 Chat Gates 尚未迁移 |
| WS5 | pending | 无 | Dashboard/Desktop Gates 未迁移 |
| WS6 | partial | Harness Registry 与 Chat namespace 通过 TypeScript check | 原生 Tauri Harness readiness 未证明 |
| WS7 | pending | 现有 Applet Domain 契约和 MJS Gate 独立存在 | Python AcceptanceGate wrapper 未实现 |
| WS8 | pending | 无 | 全量验证、单一真源 cutover 和清理未完成 |

**冻结条件**：WS4、WS5、WS7 的新增业务迁移必须等待 WS0 完成、连续
`acceptance-driver-smoke` 通过，并由显式授权的 disposable Station Gate
证明至少一个 Native receiver 场景。当前前两项已完成；Chat 产品 Gate 未运行，
因此业务迁移继续冻结并保持 `UNPROVEN`。

---

## 5. Dependency Graph

```
WS0 (Core Hardening) ──► WS1 (Core Abstractions verified)
  ├──► WS2 (Tauri Driver) ──► WS4 (Chat Gates)
  ├──► WS3 (Chrome+Station) ──► WS5 (Dashboard/Desktop Gates)
  └──► WS7 (Applet Wrappers)

WS6 (Frontend Harness) ──► (independent, runs in parallel, must be done before WS8)

WS4 + WS5 + WS7 + WS6 ──► WS8 (Final Validation)
```

**Parallelizable work**:
- WS6 可以与 WS1-WS5 并行执行（前端代码独立）
- WS2 和 WS3 在 WS1 完成后可以并行执行
- WS4 和 WS5 在各自 Driver 完成后可以并行执行

---

## 6. Atomic Cutover Matrix

| Cutover | New Truth | Consumers | Cutover Condition | Old Path Deletion | Rollback |
|---------|-----------|-----------|-------------------|-------------------|----------|
| **C1: TauriDriver** | `drivers/tauri.py` TauriDriver(DomDriver) | all gates using TauriDriver | canonical module smoke ×3 PASS; consumers reference new path | `tauri_webdriver.py` 已删除 | git revert |
| **C2: AcceptanceGate** | `core/gate.py` AcceptanceGate | all gates | WS4 + WS5 + WS7 all gates PASS with base class | 删除各 gate 内联的 GateError/async_harness/save_dom 定义 | git revert |
| **C3: ChromeDriver** | `drivers/chrome.py` ChromeDriver | dashboard gates, desktop gateway_smoke | WS3 smoke; WS5 gates PASS | 删除 federation_visible_surface.py 内联 CDPSession | git revert |
| **C4: Harness Registry** | `acceptance/registry.ts` registerAcceptanceHarness | main.tsx, all harness modules | WS6 build + check PASS; chat harness functional | 不删除旧挂载方式直到 WS4 验证新方式可用 | git revert |

**No permanent dual paths**: All compatibility aliases are temporary (one merge window) and marked for deletion after WS8 validation passes.

---

## 7. Deliverables, Gates, and Evidence per Workstream

### WS1: Core Abstractions
- **Target files**: `tooling/acceptance/core/__init__.py`, `core/errors.py`, `core/evidence.py`, `core/gate.py`, `core/harness.py`, `core/drivers/__init__.py`, `core/drivers/base.py`, `core/fixtures/__init__.py`, `core/fixtures/base.py`
- **Behavior**: BaseDriver/AcceptanceGate/BaseFixture ABCs defined; Evidence Schema implemented; async_harness helper works
- **Failure behavior**: Import errors, ABC instantiation errors, type errors on incorrect implementation
- **Tests**: Python unit tests for Evidence Schema; ABC conformance checks
- **Evidence**: Import check PASS; unit test PASS
- **Done when**: `python3 -c "from tooling.acceptance.core import AcceptanceGate, BaseDriver, BaseFixture; print('OK')"` PASS

### WS2: Tauri Driver Refactor
- **Target files**: `tooling/acceptance/drivers/tauri.py`, `drivers/__init__.py`; old `drivers/tauri_webdriver.py` deleted
- **Behavior**: TauriDriver starts app, connects via embedded WebDriver, provides BaseDriver interface
- **Failure behavior**: App exits early; WebDriver connection timeout; resource leak on failure
- **Runtime scenario**: `make acceptance-driver-smoke` — launch, connect, verify title/root/__TAURI__, close
- **Evidence**: `tooling/acceptance/reports/driver-smoke.json` PASS ×3 consecutive runs
- **Done when**: `make acceptance-driver-smoke` runs 3 consecutive times with no port/storage/process leaks

### WS3: Chrome + Station Drivers
- **Target files**: `tooling/acceptance/drivers/chrome.py`, `drivers/station.py`
- **Behavior**: ChromeDriver launches headless Chrome via CDP; StationDriver wraps HTTP gateway commands
- **Failure behavior**: Chrome launch failure; CDP handshake timeout; Station HTTP error propagation
- **Runtime scenario**: Chrome smoke test (launch, navigate, get text, screenshot, close); Station API smoke (station_list, station_set_active)
- **Evidence**: Driver smoke test reports
- **Done when**: Both drivers can run smoke tests and clean up without leaks

### WS4: Chat Gates Refactor
- **Target files**: `tooling/acceptance/gates/chat/*.py` (6 files)
- **Behavior**: All Chat gates inherit AcceptanceGate, produce Evidence Schema reports
- **Failure behavior**: Gate failures produce automatic screenshot/DOM/log evidence
- **Runtime scenario**: Full Chat domain validation
- **Gates**:
  - `CHAT_ACCEPTANCE_RESET=1 python3 tooling/acceptance/gates/chat/desktop_dom_message_visible.py`
  - `CHAT_ACCEPTANCE_RESET=1 python3 tooling/acceptance/gates/chat/native_two_client_runner.py`
  - `python3 -m unittest tooling.acceptance.gates.chat.native_visible_e2e_test tooling.acceptance.gates.chat.native_visible_static_test`
- **Evidence**: `tooling/acceptance/reports/chat-desktop-dom-message-visible.json`, `chat-native-two-client-run.json`, `chat-validation.json` all PASS
- **Done when**: `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-domain-validation` PASS; evidence conforms to schema

### WS5: Dashboard + Desktop Gates Refactor
- **Target files**: `gates/dashboard/federation_visible_surface.py`, `gates/desktop/gateway_smoke.py`
- **Behavior**: Gates use ChromeDriver/StationDriver, no inline CDP or Tauri mock
- **Failure behavior**: Proper error propagation with automatic diagnostics
- **Runtime scenario**: Dashboard surface smoke, Desktop gateway smoke
- **Evidence**: Gate reports in reports/
- **Done when**: `make acceptance-station-dashboard-domain-validation` PASS; `python3 tooling/acceptance/gates/desktop/gateway_smoke.py` PASS

### WS6: Frontend Harness Registry
- **Target files**: `apps/desktop/src/acceptance/registry.ts`, `apps/desktop/src/acceptance/chat/harness.ts`, `apps/desktop/src/main.tsx`
- **Behavior**: Harness modules self-register; main.tsx auto-discovers; methods accessible via namespace
- **Failure behavior**: Harness not registered; method not found; production build does not include harness
- **Tests**: `pnpm run check` (TypeScript); runtime smoke that `window.__PT_ACCEPTANCE__.chat.loginWithPassword` exists in acceptance build
- **Evidence**: TypeScript check PASS; pnpm build PASS
- **Done when**: `pnpm run check` PASS; `pnpm run build` PASS; acceptance build has `window.__PT_ACCEPTANCE__.chat.*`; production build does not include harness code

### WS7: Applet Gate Wrappers
- **Target files**: `tooling/acceptance/gates/applet/__init__.py`, lifecycle_smoothness.py (wrapper)
- **Behavior**: Python wrappers invoke MJS scripts, parse JSON output, produce Evidence Schema reports
- **Failure behavior**: MJS non-zero exit → Gate FAIL; invalid JSON → Gate ERROR; automatic evidence capture
- **Gates**: Applet lifecycle smoothness gate
- **Evidence**: Applet gate reports conforming to Evidence Schema
- **Done when**: Applet gates run and produce schema-conformant reports

### WS8: Final Validation + Cleanup
- **Behavior**: All gates run; no zombie processes; no port leaks; no duplicate code; documentation updated
- **Gates**:
  - `pnpm install --frozen-lockfile` PASS
  - `cd apps/desktop && pnpm run check && pnpm run test && pnpm run build` PASS
  - `make acceptance-driver-build` PASS
  - `make acceptance-driver-smoke` ×3 PASS
  - `CHAT_ACCEPTANCE_RESET=1 make acceptance-chat-domain-validation` PASS
  - `make acceptance-station-dashboard-domain-validation` PASS
  - `make acceptance-validate DOMAIN=applet` PASS (after WS7)
  - `make acceptance-plan-self` PASS
  - Secret scan: no passwords/tokens in logs/reports
  - Resource audit: no lingering 4445/4446/Chrome processes; no temporary storage left behind
- **Evidence**: All reports in `tooling/acceptance/reports/` PASS
- **Done when**: All gates PASS; `make acceptance-validate` (all active domains) PASS

---

## 8. Risk and Anti-Regression

| Risk | Impact | Mitigation |
|------|--------|------------|
| Base class refactor breaks existing gates | Chat/Dashboard gates fail | Incremental migration (WS2/WS4 before WS3/WS5); run all gates after each WS; keep backward-compat imports |
| Harness namespace change breaks Gate JS calls | Chat gates fail to invoke harness | Phase in namespace: support both root-level and namespaced calls during migration; update gates in WS4 |
| ChromeDriver CDP implementation differs from inline version | Dashboard gates fail | Port CDPSession code verbatim first, then refactor; verify with dashboard gates before marking WS3 done |
| Applet MJS output not machine-parseable | Wrappers fail | Add `--json` flag to MJS scripts incrementally; start with lifecycle-smoothness as pilot |
| Resource leaks (processes/ports/storage) | Flaky tests, CI pollution | BaseDriver stop() uses try/finally; Gate execute() ensures driver.stop() in finally; WS8 includes resource leak audit |
| Evidence schema mismatch breaks acceptance-validate.py | Validation fails | Schema is additive; acceptance-validate.py updated to handle new fields; old field names preserved |

**Regression policy**: No existing gate may be marked as passing due to weakened assertions. Any gate change must preserve the same assertion logic and evidence level.

**Flaky/infra-noise policy**: Network-dependent gates (Station connectivity) must have clear error messages distinguishing infrastructure failure from product failure. Resource cleanup must run in `finally` blocks regardless of pass/fail.

---

## 9. Final Readiness Gate

The plan is complete when **all** of the following are true:

1. `core/` directory exists with all ABCs and Evidence Schema implemented and unit-tested
2. TauriDriver and ChromeDriver implement DomDriver; StationDriver implements lifecycle-only BaseDriver
3. All Chat gates (6 files) use AcceptanceGate; `make acceptance-chat-domain-validation` PASS
4. Dashboard visible-surface and Desktop gateway-smoke gates use ChromeDriver/StationDriver; dashboard validation PASS
5. Frontend Harness Registry implemented; Chat Harness migrated; `pnpm run check && pnpm run build` PASS
6. Applet gates wrapped in Python AcceptanceGate subclasses; produce schema-conformant reports
7. No duplicate GateError/async_harness/CDPSession/gateway_command definitions remain
8. All existing Make targets and CLI interfaces continue to work
9. Resource leak audit: no zombie processes, no lingering ports, no temporary storage after runs
10. Secret scan: no passwords/tokens in evidence or logs
11. `make acceptance-validate` (all active domains: chat, federation, station-dashboard, applet) PASS with `--require-proven`

---

## 10. Estimated Effort

| Workstream | Estimated time |
|------------|---------------|
| WS1: Core Abstractions | 2-3 hours |
| WS2: Tauri Driver Refactor | 1-2 hours |
| WS3: Chrome + Station Drivers | 2-3 hours |
| WS4: Chat Gates Refactor | 1-2 hours |
| WS5: Dashboard + Desktop Gates | 1-2 hours |
| WS6: Frontend Harness Registry | 1-2 hours |
| WS7: Applet Gate Wrappers | 2-3 hours |
| WS8: Final Validation + Cleanup | 1-2 hours |
| **Total** | **11-19 hours** |

---

## 11. Execution Order Recommendation

1. Start with **WS1** (Core Abstractions) — everything depends on it
2. Parallelize **WS2 + WS3** after WS1 complete
3. Parallelize **WS4 + WS5** after their respective drivers complete
4. Run **WS6** in parallel with WS1-WS5 (frontend work is independent)
5. Do **WS7** after WS1 completes
6. Finalize with **WS8** after all workstreams complete
