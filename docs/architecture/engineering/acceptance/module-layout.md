# Acceptance Framework — 模块目录结构

> **Status**: active
> **Version**: v2.3
> **Created**: 2026-08-15 | **Updated**: 2026-09-29


> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 目标目录树

> Runtime Provisioning 相关的 `core/provisioning.py`、`environments/`、
> `provisioners/` 和 Actor Fixture 由已接受的 D-07 ~ D-10 约束。

```
tooling/acceptance/
├── core/                           # [NEW] 通用核心抽象（domain-neutral）
│   ├── __init__.py
│   ├── gate.py                     # AcceptanceGate 基类
│   ├── evidence.py                 # Evidence Schema + 报告工具
│   ├── evidence_store.py           # [D-11] 唯一root/run/ref/manifest/latest/cleanup owner
│   ├── errors.py                   # GateError 统一异常
│   ├── redaction.py                # 结构化报告和文本证据统一脱敏
│   ├── harness.py                  # 通用 JS harness 桥接 helper
│   ├── provisioning.py             # Environment contract、runtime manifest 与生命周期接口
│   ├── provisioner.py              # EnvironmentProvisioner 生命周期与 fail-closed 公共逻辑
│   ├── launch_context.py           # [D-18] ephemeral capability channel与child launch binding
│   ├── bounded_http.py             # monotonic deadline与byte-bound HTTP response reader
│   ├── result_contracts.py          # shared pure canonical result tuple/cell/matrix algebra
│   ├── finalization_contracts.py   # [D-19 ACCEPTED TARGET] pure wire types、closed unions与digest functions
│   ├── evidence_finalization.py    # [D-19 ACCEPTED TARGET] supervisor/worker lifecycle coordinator
│   ├── authority_cli_bootstrap.py  # [D-19 ACCEPTED TARGET] isolated authority command verifier/loader
│   ├── power_controller.py         # [D-19 ACCEPTED TARGET] external controller runtime, durable journal, key custody and actuator owner
│   ├── trust_admission.py           # [D-19 ACCEPTED TARGET] shared-lock ACTIVE trust dispatch mediator
│   ├── proof_admission.py           # [D-19 ACCEPTED TARGET] claim envelope、job registry、epoch/quiescence owner
│   ├── finalizer_worker.py         # [D-19 ACCEPTED TARGET] isolated Python worker bootstrap
│   ├── finalization_supervisor.c   # [D-19 ACCEPTED TARGET] POSIX hard-deadline worker supervisor
│   ├── runtime_cell.py              # [D-13] Cell contract/manifest/matrix/lease schema
│   ├── suite_runtime.py             # [D-21] Suite lifecycle/reuse ledger and report validation
│   ├── attestation.py              # Station deployment/runtime attestation producer
│   ├── drivers/
│   │   ├── __init__.py
│   │   ├── base.py                 # BaseDriver 生命周期 + DomDriver DOM 能力
│   │   └── launcher.py             # App launcher metadata 与资源生命周期契约
│   └── fixtures/
│       ├── __init__.py
│       └── base.py                 # BaseFixture 抽象基类
├── drivers/                        # 具体 Driver 实现
│   ├── __init__.py
│   ├── tauri.py                    # launcher-neutral embedded WebDriver client
│   ├── native/
│   │   ├── __init__.py
│   │   ├── base.py                 # NativeDesktopAdapter contract
│   │   ├── macos.py                # AppKit/CoreGraphics/Accessibility
│   │   ├── linux_x11.py            # X11 XTest/EWMH
│   │   └── windows.py              # Win32 SendInput/UI Automation
│   ├── chrome.py                   # [NEW] Selenium Chrome driver + CDP command bridge
│   └── mobile.py                   # [Phase 4] Mobile Tauri driver
├── transports/
│   ├── __init__.py
│   └── ssh.py                      # verified host、bounded command、tunnel、cancel
├── fixtures/                       # 具体 Fixture 实现
│   ├── chat_native_reset.py        # Chat 环境重置
│   └── chat_native_actors.py       # Chat account/PTID actor manifest producer
├── environments/                   # 非 local Gate 的机器可读 provisioning contracts
│   ├── native-tauri-embedded-webdriver.yaml
│   └── home-station.yaml
├── runtime-cells/                  # Desktop platform capability contracts
│   ├── desktop-macos-native.yaml
│   ├── desktop-linux-native.yaml
│   └── desktop-windows-native.yaml
├── images/
│   └── desktop-linux/
│       ├── Containerfile           # Supported WebKitGTK 4.1 userland
│       ├── entrypoint.sh           # Xorg/WM/DBus/keyring/app supervisor
│       ├── remote_control.py       # run lease, TTL reaper and forced cleanup
│       └── xorg-dummy.conf         # fixed connected 1920x1080 output
├── provisioners/                   # 环境生命周期实现，不承载产品断言
│   ├── __init__.py
│   ├── home_station.py
│   ├── native_desktop_macos.py
│   ├── local_tunnel_supervisor.py # bounded local SSH-forward ownership
│   ├── remote_source_identity.py  # SSH-backed deployment source identity adapter
│   ├── native_desktop_linux.py
│   └── native_desktop_windows.py
├── contracts/                      # [D-19 PROPOSED] 业务Evidence contract唯一真源
│   └── mobile/
│       ├── finalizers.yaml           # D-19 generated concrete registration
│       ├── native_oauth.schema.json # Mobile proof payload schema
│       ├── native_oauth.py         # Mobile role/discriminator/relation validation
│       ├── native_oauth_test.py    # contract与adversarial mutation tests
│       └── native_oauth.protected.json # D-19 reviewed requirement/source baseline
├── finalizers/                     # [D-19 PROPOSED] detached domain finalizer进程入口
│   ├── registry.py                 # domain-neutral registration schema/resolver
│   └── mobile_native.py            # sealed Mobile snapshot validator CLI
├── behavior-rules/
│   └── chat-receipts.yaml          # receiver-visible receipt/badge Gate 选择
├── gates/                          # 各域 Gate 实现（重构为继承 AcceptanceGate）
│   ├── chat/
│   │   ├── desktop_dom_message_visible.py
│   │   ├── native_two_client_runner.py
│   │   ├── native_visible_e2e.py
│   │   ├── group_pressure_security.py
│   │   ├── private_pressure_security.py
│   │   ├── group_admin_e2e.py
│   │   └── ...
│   ├── desktop/
│   │   └── primary_navigation_e2e.py           # Native Tauri navigation Gate
│   └── applet/                       # [NEW Phase 3] Applet MJS wrapper gates
│       ├── __init__.py
│       ├── lifecycle_smoothness.py
│       └── ...
├── capabilities/                   # 保持不变：能力定义 YAML
│   ├── core.yaml
│   ├── chat.yaml
│   ├── federation.yaml
│   ├── station-dashboard.yaml
│   └── applet.yaml
├── domains/                        # 保持不变：域 profile YAML
│   ├── index.yaml
│   ├── chat.yaml
│   ├── federation.yaml
│   ├── station-dashboard.yaml
│   └── applet.yaml
├── features/                       # 保持不变：feature contract YAML
│   └── *.yaml
├── templates/                      # 保持不变：onboarding 模板
│   ├── domain.yaml
│   ├── capability.yaml
│   └── feature.yaml
├── plans/                          # 保持不变：plan JSON
├── playbooks/                      # 保持不变：操作手册
├── evidence/                       # 保持不变：历史证据存档
├── tests/
│   └── fixtures/                   # reviewed deterministic fixtures only
├── gates.yaml                      # 保持不变：Gate catalog
├── registry.yaml                   # 保持不变：路径影响映射
├── desktop-performance-cohort.json # 保持不变：性能测试 cohort
└── README.md                       # 更新文档
```

## 文件职责

| 路径 | 职责 |
|------|------|
| `core/gate.py` | AcceptanceGate 抽象基类，统一 execute() 入口、异常捕获、自动证据保存、报告输出 |
| `core/evidence.py` | Evidence Schema 定义、证据文件路径管理、JSON 报告写入 |
| `core/evidence_store.py` | 解析artifact root、独占atomic run allocation、验证ArtifactRef、atomic write、artifact seal、manifest finalize/latest、closed authoritative-resolution envelope、active lock与cleanup |
| `core/errors.py` | GateError 统一异常，其他通用异常类型 |
| `core/redaction.py` | 敏感字段、Bearer token、private key 和文本证据统一脱敏 |
| `core/harness.py` | async_harness 通用 JS 桥接，支持命名空间调用 |
| `core/provisioning.py` | 定义 EnvironmentProvisioner 生命周期、typed service topology、client-to-service bindings、Runtime Resource Manifest、blocked artifact 和 cleanup result |
| `core/provisioner.py` | 解析并验证worktree Profile、管理Provisioner状态和reverse-order cleanup；D-19后不持有或执行business finalizer |
| `core/launch_context.py` | 定义不可持久化launch context、capability registry、anonymous channel backend、child binding、framing与cleanup |
| `core/bounded_http.py` | 以mandatory byte limit和monotonic deadline读取urllib response；无法控制底层socket deadline时fail closed |
| `core/result_contracts.py` | 定义无I/O、无Evidence Store依赖的`CanonicalResultTuple`、`PlatformCellResult`、`PlatformMatrixResult`及唯一fold；供Runtime Cell与D-19共同使用 |
| `core/execution_plan.py` | 解析正式Execution Plan的worktree绑定、current closure与Acceptance Execution合同；不持久化第二套计划状态 |
| `core/finalization_contracts.py` | **D-19 accepted target / pure**：定义requirement/config、worker wire schemas、closed unions、canonical digest functions与merge truth table；不得import Evidence Store或执行I/O |
| `core/evidence_finalization.py` | **D-19 accepted target**：协调preflight source capture、supervisor/worker lifecycle、one-shot invocation与abort maintenance；只通过Evidence Store public API请求allocation/seal/finalize，不拥有run allocation或merge/publish |
| `core/authority_cli_bootstrap.py` | **D-19 accepted target**：以`-I -S -E -B`启动；仅用stdlib验证自身、clean HEAD、canonical approval与`ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES` import/process closure，再以source-only loader加载tracked authority modules；同时提供独立的two-phase public power-controller trust enrollment authority commands |
| `core/power_controller.py` | **D-19 accepted target**：repo-owned external power-controller runtime；唯一拥有controller key custody、independently qualified local journal store、runtime epoch/lease、command state machine与in-process actuator dispatch；不得运行在被中断target上 |
| `core/trust_admission.py` | **D-19 accepted target**：Acceptance Infra-owned read-only mediator；以shared Gate publish lock解析ACTIVE trust current并向同进程controller调用签发不可序列化`TrustDispatchLease`，不拥有key、journal或actuator |
| `core/proof_admission.py` | **D-19 accepted target**：唯一claim-admission coordinator；拥有shared/exclusive lock、job identity registry、execution-environment epoch、quiescence record与authoritative envelope emission |
| `core/finalizer_worker.py` | **D-19 accepted target**：`-I -S -E -B` isolated worker bootstrap，验证request/runtime/bundle/FD identity后分派fixed worker kind，包括authority-runtime persistence；不得持有Evidence Store API |
| `core/finalization_supervisor.c` | **D-19 accepted target**：在spawn Python worker前解除signal mask、安装default-action real-time timer，并在runner EOF/timeout时kill/reap worker group |
| `core/runtime_cell.py` | Runtime Cell manifest、lease state与typed validation；只消费并验证从`core/result_contracts.py`导入的canonical matrix contract，不定义或拥有第二份matrix result |
| `core/suite_runtime.py` | **D-21** domain-neutral `runtimeReuse` contract、Suite lifecycle ledger、reuse metrics、report digest与fail-closed validation；不启动资源、不包含业务Scenario或断言 |
| `core/attestation.py` | 从 live Station 和 deployment worktree 生产 commit/workspace/proto attestation |
| `core/drivers/base.py` | BaseDriver 定义生命周期；DomDriver 定义 DOM/JS/截图能力 |
| `core/drivers/launcher.py` | 定义 launcher metadata、start/stop/alive 资源所有权契约 |
| `core/fixtures/base.py` | BaseFixture 抽象基类，定义 setup/teardown/reset 接口 |
| `drivers/tauri.py` | 纯 W3C client、local/provisioned launcher 与 TauriSession 组合；只连接 local 或 forwarded loopback endpoint |
| `drivers/native/base.py` | Native input、focus、window stack、point ownership 与 screenshot primitive contract |
| `drivers/native/macos.py` | AppKit/CoreGraphics/Accessibility adapter |
| `drivers/native/linux_x11.py` | X11 XTest/EWMH adapter |
| `drivers/native/windows.py` | Win32 SendInput/UI Automation adapter |
| `transports/ssh.py` | SSH host-key verification、bounded command、run-scoped port forward、cancel 与 teardown |
| `provisioners/remote_source_identity.py` | 通过 strict-known-host SSH 读取 remote Git commit/workspace/proto identity，并作为显式 provider 注入 Core attestation |
| `tooling/scripts/deploy/source-sync.sh` | Station/Relay/Desktop 共用的 role-neutral incremental Git source sync |
| `drivers/chrome.py` | Selenium Chrome/Chromium headless 驱动，支持 CDP command bridge；Dashboard 消费迁移由 WS5 完成 |
| `drivers/mobile.py` | Android/iOS Tauri Mobile 驱动（Phase 4 实现） |
| `environments/*.yaml` | 把 Gate environment id 映射为 Profile、service、Fixture、credential reference、attestation 和 cleanup contract |
| `runtime-cells/*.yaml` | 声明 Desktop OS、display、WebView、native adapter、source identity 与 cleanup capability |
| `images/desktop-linux/` | Linux cell 的 digest-pinned userland 与独立 Xorg desktop lifecycle |
| `provisioners/*.py` | 执行环境contract、生成runtime manifest并完成cleanup；不得持有或调用business finalizer |
| `contracts/mobile/native_oauth.schema.json` | **D-19 proposed**：Mobile proof payload schema唯一真源 |
| `contracts/mobile/native_oauth.py` | **D-19 proposed**：Mobile Artifact Role、discriminator/path/payload identity、relation与cardinality validation唯一代码真源 |
| `contracts/mobile/native_oauth_test.py` | **D-19 proposed**：schema、role-instance与relation adversarial tests |
| `contracts/mobile/finalizers.yaml` | **D-19 proposed / generated Mobile business projection**：由canonical contract确定性生成具体ID、fixed entrypoint/source paths与role-name projection |
| `contracts/mobile/native_oauth.protected.json` | **D-19 proposed / Mobile business**：冻结Capability-owned required mapping、generated registration、contract/schema与entrypoint digests；不是第二个mapping真源 |
| `finalizers/registry.py` | **D-19 accepted target / Acceptance Infra**：提供domain-neutral registration schema/resolver，验证fixed entrypoint并构造canonical argv；不持有具体业务entry |
| `finalizers/mobile_native.py` | **D-19 proposed**：只从stdin消费typed context、sealed refs/hash与snapshot-bound bounded JSON payload，调用Mobile canonical validator并输出typed outcome |
| `capabilities/mobile.yaml` | **D-19 proposed / Mobile business**：按Gate ID声明required finalizer |
| `fixtures/chat_native_actors.py` | 发现/准备测试账号并产出 role、account reference、canonical PTID，不写入凭据值 |
| `gates/<domain>/*.py` | 各域验收场景实现，继承 AcceptanceGate，只包含业务编排逻辑 |
| `tooling/scripts/acceptance-run.py` | **D-19/D-21 owner**：调用时序owner；验证required declaration、seal artifact、bounded启动detached finalizer并把typed outcome提交给Evidence Store；以显式policy区分non-publishing Development与formal Acceptance，并支持single-Gate preallocated run ID |
| `tooling/scripts/execution-plan.py` | 校验当前worktree唯一active plan及merge前closure完成状态 |

## 依赖关系

```
core/gate.py → core/evidence.py → core/errors.py
core/evidence.py → core/evidence_store.py → core/errors.py + core/redaction.py
core/provisioning.py → core/errors.py + core/redaction.py
core/provisioner.py → core/provisioning.py + core/launch_context.py
core/launch_context.py → core/errors.py
provisioners/mobile_native.py + gates/mobile/simulator_e2e.py → core/bounded_http.py
core/result_contracts.py → core/errors.py
core/finalization_contracts.py → core/result_contracts.py
core/evidence_store.py → core/result_contracts.py + core/finalization_contracts.py
core/evidence_finalization.py → core/result_contracts.py + core/finalization_contracts.py + core/evidence_store.py + core/errors.py
core/authority_cli_bootstrap.py → verified stdlib only, then allowlisted tracked authority modules
core/trust_admission.py → core/evidence_store.py + core/finalization_contracts.py + core/errors.py
core/power_controller.py → core/trust_admission.py + core/finalization_contracts.py + core/errors.py + reviewed OS cryptography/filesystem/process APIs
core/proof_admission.py → core/evidence_store.py + core/finalization_contracts.py
core/finalizer_worker.py → core/result_contracts.py + core/finalization_contracts.py
core/runtime_cell.py → core/result_contracts.py + core/errors.py + core/redaction.py
core/suite_runtime.py → core/errors.py + core/redaction.py
core/attestation.py → core/provisioning.py + injected RemoteSourceIdentityProvider
core/harness.py → core/drivers/base.py
core/drivers/base.py → core/errors.py
core/fixtures/base.py → core/errors.py
drivers/tauri.py → core/drivers/base.py
drivers/native/*.py → drivers/native/base.py + platform APIs
transports/ssh.py → core/errors.py
drivers/chrome.py → core/drivers/base.py
provisioners/*.py → core/provisioning.py + core/runtime_cell.py + transports/* + drivers/* + fixtures/*
provisioners/remote_source_identity.py → core/errors.py + core/provisioner.py + transports/ssh.py
provisioners/mobile_native.py → contracts/mobile/native_oauth.py
gates/mobile/*.py → contracts/mobile/native_oauth.py
finalizers/mobile_native.py → core/finalization_contracts.py + contracts/mobile/native_oauth.py
finalizers/registry.py → core/finalization_contracts.py
tooling/scripts/acceptance-run.py → core/launch_context.py + core/provisioning.py + core/provisioner.py + core/evidence_finalization.py + finalizers/registry.py
gates/**/*.py → core/gate.py + 具体 Driver + core/harness.py
fixtures/*.py → core/fixtures/base.py
```

禁止的依赖方向：
- core/ 下的任何模块不得导入 gates/、drivers/（具体实现）或 fixtures/
- `core/attestation.py` 不得导入 `transports/` 或 `provisioners/`；remote
  deployment source identity 必须由 concrete Provisioner 注入
- `core/launch_context.py`不得导入具体Provisioner、业务capability、Gate或Fixture
- `core/finalization_contracts.py`不得import `core/evidence_store.py`或执行I/O；
  `finalizers/*.py`不得transitively获得Evidence Store mutation APIs
- `core/result_contracts.py`不得import `core/finalization_contracts.py`、
  `core/evidence_store.py`或执行I/O；canonical result algebra不得在其它模块复制
- `core/suite_runtime.py`不得import Gate、Provisioner、Driver、Fixture、产品
  Domain或Development runner；业务只通过closed contract和lifecycle event注入
- `core/power_controller.py`不得import `core/evidence_store.py`、
  `core/evidence_finalization.py`、Gate、Provisioner或domain finalizer；Evidence Store
  可持久化和resolve typed controller artifacts，但不得拥有controller key、journal
  transition或actuator dispatch，双方不得调用对方private mutation API；
  `core/trust_admission.py`只能调用Evidence Store public read/lock API并返回
  process-local lease，不得暴露mutation API、serialized bearer token或raw store handle
- drivers/ 不得导入 gates/ 或 fixtures/
- `drivers/native/base.py` 不得导入任一平台实现
- platform native adapter 不得导入业务 Gate、Fixture 或 selector
- SSH transport 不得解释 Gate result、产品状态或 credential value
- gates/ 之间不得互相导入（场景独立）
- gates/ 不得导入 `.local` Profile 或 deployment 实现
- fixtures/ 不得调用 Gate 或修改 Gate 成功条件
- provisioners/ 不得复制产品断言、包含DOM selector、判断消息内容或提供D-19 bound
  finalizer
- `core/provisioner.py`和`tooling/scripts/acceptance-run.py`不得导入Mobile Artifact
  Role、relation或业务validator
- `contracts/mobile/native_oauth.py`不得导入Provisioner、Gate process入口、Driver、
  Fixture、product client或可写Evidence Store API
- 旧`gates/mobile/proof_contracts.py`、`proof_contracts_test.py`与
  `proof-contract.schema.json`必须在同一迁移中删除；禁止compatibility re-export
- `finalizers/mobile_native.py`不得导入`provisioners/mobile_native.py`，也不得接收
  Provisioner实例、credential、raw handle、launch context、artifact root、绝对路径
  或产品endpoint
- finalizer v1为trusted/no-child contract，不得调用subprocess、fork、setsid、
  network或product client；该边界不提供hostile-code sandbox
- post-cleanup finalizer不得写artifact、重新获取resource、执行cleanup、调用产品系统、
  publish Evidence Store run或把failed/blocked结果升级为passed
- artifact writer、role registration、seal与manifest finalize
  必须服从同一个Store-owned跨进程lock和durable sealed marker
- cleanup、discard和普通retention/delete必须拒绝active run与sealed incomplete run；
  sealed incomplete run只允许由`abort-sealed`在获取active lock、等待Core watchdog
  ceiling加5秒grace、持久化append-only authorization event并原子rename到
  `aborted-runs/` tombstone后删除，且不得被reader/repair发布
- finalizer timeout、异常、identity mismatch和required artifact缺失不得覆盖已有
  primary failure；原成功必须降级为`failed/PARTIAL/UNPROVEN`
- launch context、handler、descriptor、secret或raw handle不得进入Runtime Manifest、
  Evidence Store、argv、日志或环境变量值；环境只允许传递非敏感descriptor locator
- 携带launch context的Gate不得通过`shell=True`启动，也不得把descriptor继承给
  任意grandchild
- unsupported launch transport不得fallback到file、environment secret、localhost
  service或Gate-side resource reacquisition
- attestation 不得由消费它的 Gate 或 validator 生产
- Runtime Manifest 只允许 `services[service-id]` 表达服务拓扑；禁止 singular
  `station`、dual-write 和按 map 顺序推断 primary service
- client-to-service 关系只允许由 Environment Contract 声明并由
  `ClientRuntime.service_bindings` 发布；禁止 Gate 常量、裸 URL、Profile 默认值、
  client/service 顺序或 endpoint 副本成为第二真源
- 通用 binding resolver / validator 必须位于 `core/provisioning.py`；Mobile、
  Federation、Chat 或平台 Provisioner 不得各自实现同语义 parser
- Platform Runtime Binding owns `create_bound_session`; business Gate code may
  pass only client ID and fields accepted by that binding's closed typed
  non-topology launch-options contract. Unknown fields, arbitrary environment
  maps, and topology-bearing values are rejected. Runtime Binding owns monotonic
  generation allocation and proof-ref collection. It must read each required
  role's observed identity from live client connection state, bind it to the
  existing D-13 runtime-instance identity, and return no session until Core
  persists a verified proof for every required role.
- Run-scoped fault routing uses Runtime Binding-owned
  `TransportOverrideHandle`; Gate code may request apply/clear operations but
  must not receive a routable endpoint or call `configure_station` with proxy
  URLs. Fault proxy implementation and product assertions remain Domain-owned.


- `core/_paths.py`不得定义runtime report/evidence/manifest目录
- 除`core/evidence_store.py`外不得解析`PT_ACCEPTANCE_ARTIFACT_ROOT`或platform default
- runtime writers不得写repository、`tooling/`、`docs/`或`.git/`
- readers不得通过字符串拼接解析ArtifactRef
- cleanup不得删除active run或latest target
- remote embedded WebDriver 不得监听非 loopback address
- runtime cell contract 不得保存 literal host、username、password、key path 或远端绝对路径
- cell matrix validator 不得用一个平台的 evidence 填补另一个 required cell

## Repository 外 Runtime Layout

该layout不是source module tree，不得在repository中创建：

```text
<artifact-root>/
└── <workspace-id>/
    └── <gate-id>/
        ├── latest.json
        ├── finalizer-enforcement/
        │   ├── publication-interlock.json
        │   ├── activation-pending.json
        │   ├── activated.json
        │   ├── current.json
        │   ├── durability-capabilities/
        │   │   └── <crash-fixture-id>/
        │   │       ├── MANIFEST
        │   │       └── <artifact-name>-<content-sha256>
        │   ├── controller-trust/
        │   │   ├── controller-store-qualifications/
        │   │   │   └── <qualification-id>/
        │   │   │       └── <case-id>-<artifact-name>-<content-sha256>
        │   │   ├── bootstrap-candidates/
        │   │   │   └── <bootstrap-candidate-digest>/
        │   │   │       ├── candidate.json
        │   │   │       ├── witness-authorizations/
        │   │   │       │   └── <authorization-id>.json
        │   │   │       └── consumed.json
        │   │   ├── promotions/
        │   │   │   └── <authorization-id>/
        │   │   │       └── intent.json
        │   │   ├── transition-reservations/
        │   │   │   └── <absent-or-expected-current-digest>.json
        │   │   ├── generations/
        │   │   │   └── <trust-generation>-<generation-digest>.json
        │   │   ├── revocation-intents/
        │   │   │   └── <authorization-id>/
        │   │   │       └── intent.json
        │   │   ├── revocations/
        │   │   │   └── <trust-generation>-<revocation-digest>.json
        │   │   ├── current.json
        │   │   └── <trust-anchor-digest>.json
        │   ├── latest/
        │   │   └── <generation>.json
        │   ├── runtime/
        │   │   └── <authorization-id>/
        │   │       ├── identity.json
        │   │       └── <content-sha256>.blob
        │   └── generations/
        │       └── <generation>.json
        ├── claim-admission/
        │   ├── current-epoch.json
        │   ├── boot-boundaries/
        │   │   └── <observation-id>.json
        │   ├── epochs/
        │   │   └── <coordinator-epoch-id>.json
        │   ├── pauses/
        │   │   └── <coordinator-epoch-id>.json
        │   ├── jobs/
        │   │   └── <coordinator-epoch-id>/
        │   │       ├── <job-sequence>-<job-id>.json
        │   │       └── <job-sequence>-<job-id>.lock
        │   ├── completions/
        │   │   └── <coordinator-epoch-id>/
        │   │       └── <job-sequence>-<job-id>.json
        │   ├── emissions/
        │   │   └── <coordinator-epoch-id>/
        │   │       └── <job-sequence>-<job-id>/
        │   │           ├── intent.json
        │   │           └── acknowledged.json
        │   └── quiescence/
        │       └── <coordinator-epoch-id>.json
        ├── .claim-admission.lock
        ├── .claim-sequence.lock
        ├── .publish.lock
        ├── .cleanup.lock
        ├── .abort.lock
        ├── .durability-sync-anchor
        ├── aborts/
        │   └── <run-id>/
        │       ├── authorized.json
        │       ├── deletion-plan.json
        │       ├── tombstoned.json
        │       ├── delete-started-<attempt-id>.json
        │       ├── deleted.json
        │       └── failed-<attempt-id>.json
        ├── aborted-runs/
        │   └── <run-id>/
        └── <run-id>/
            ├── .active.lock
            ├── .finalization.lock
            ├── finalization-requirement.json
            ├── sealed.json
            ├── manifest.json
            ├── reports/
            ├── evidence/
            │   └── finalization/
            │       └── executable.bundle
            ├── logs/
            └── runtime/
```
