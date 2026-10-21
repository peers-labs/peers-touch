# 统一客户端架构：执行前后效果对比

> **Plan**: `UCA-20261017`
> **Version**: `20261020-simulator-smoke-environment-closure`
> **用途**: 实施前确认预期效果，实施后按当前源码核对架构与冒烟结果
> **当前阶段**: 已完成主线集成、批准范围内的架构实施、五个源码 Gate、
> 三端冒烟、增量治理 Gate 与资源清理

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "UCA-20261017",
  "plannedSectionDigest": "sha256:0f7e406daee8fe5f757bd99cd19871f23904c5c4ad3aa9f8fa12a998bd1f2fba",
  "criteria": [
    {
      "id": "UCA-O01",
      "dimension": "user-experience",
      "title": "Mobile Host 行为遵循同一产品语义",
      "taskIds": ["UCA-01", "UCA-02", "UCA-03"],
      "gateIds": []
    },
    {
      "id": "UCA-O02",
      "dimension": "user-experience",
      "title": "Desktop 与 Mobile 消息语义一致",
      "taskIds": ["UCA-04A", "UCA-04"],
      "gateIds": [
        "unified-client-messaging-core-contract",
        "messaging-owner-hard-cut-zero"
      ]
    },
    {
      "id": "UCA-O03",
      "dimension": "user-experience",
      "title": "Desktop 与 Mobile 私密内容机制一致",
      "taskIds": ["UCA-05A", "UCA-05"],
      "gateIds": [
        "secure-content-portable-core",
        "secure-content-owner-hard-cut-zero"
      ]
    },
    {
      "id": "UCA-O04",
      "dimension": "product-capability",
      "title": "Android 与 iOS 共用一个 Mobile 产品",
      "taskIds": ["UCA-01", "UCA-02", "UCA-03", "UCA-08"],
      "gateIds": []
    },
    {
      "id": "UCA-O05",
      "dimension": "architecture",
      "title": "Client Form、Presentation Policy 与 Host 分层清晰",
      "taskIds": ["UCA-01", "UCA-02", "UCA-03", "UCA-08"],
      "gateIds": []
    },
    {
      "id": "UCA-O06",
      "dimension": "architecture",
      "title": "Messaging 只有一个 host-neutral Owner",
      "taskIds": ["UCA-04A", "UCA-04", "UCA-08"],
      "gateIds": [
        "unified-client-messaging-core-contract",
        "messaging-owner-hard-cut-zero"
      ]
    },
    {
      "id": "UCA-O07",
      "dimension": "architecture",
      "title": "Secure Content 只有一个 host-neutral Owner",
      "taskIds": ["UCA-05A", "UCA-05", "UCA-08"],
      "gateIds": [
        "secure-content-portable-core",
        "secure-content-owner-hard-cut-zero"
      ]
    },
    {
      "id": "UCA-O08",
      "dimension": "technology",
      "title": "共享 TypeScript 语义不制造万能 UI",
      "taskIds": ["UCA-06", "UCA-08"],
      "gateIds": ["unified-client-shared-semantics"]
    },
    {
      "id": "UCA-O09",
      "dimension": "technology",
      "title": "Runtime Port 与 Adapter 绑定真实目标",
      "taskIds": ["UCA-01", "UCA-02", "UCA-03", "UCA-08"],
      "gateIds": []
    },
    {
      "id": "UCA-O10",
      "dimension": "quality-operations",
      "title": "当前源码通过聚焦 Gate 与三端冒烟",
      "taskIds": [
        "UCA-01",
        "UCA-02",
        "UCA-03",
        "UCA-04A",
        "UCA-04",
        "UCA-05A",
        "UCA-05",
        "UCA-06",
        "UCA-08"
      ],
      "gateIds": [
        "unified-client-messaging-core-contract",
        "messaging-owner-hard-cut-zero",
        "secure-content-portable-core",
        "secure-content-owner-hard-cut-zero",
        "unified-client-shared-semantics"
      ]
    }
  ]
}
```

## Planned Outcome Comparison

### UCA-O01: Mobile Host 行为遵循同一产品语义

- Before: Android 与 iOS 曾读取不同的平台身份和能力入口。
- Target: 两端只通过同一 Rust/TypeScript port contract 提供 back、lifecycle、
  media permission、picker 和 system action。
- Expected effect: Mobile 页面不包含 Android/iOS 业务分叉；模拟器可验证 build、
  launch、permission、terminate/force-stop 与 relaunch。
- Non-claim: 本次不验收 APNs、FCM、物理传感器或 OEM 调度器。

### UCA-O02: Desktop 与 Mobile 消息语义一致

- Before: Desktop 与 Mobile 各自保留 engine、store、recovery 和 receipt 语义。
- Target: `messaging-core` 独占 host-neutral engine、store policy、reconciliation、
  recovery、receipt 与 attachment contract；两端只保留 typed Host adapter。
- Expected effect: 同一语义只修一个 Owner，平台 UI 与 I/O 差异不再复制业务状态机。
- Non-claim: 冒烟不替代完整跨 Station、多设备或接收端产品 Journey。

### UCA-O03: Desktop 与 Mobile 私密内容机制一致

- Before: 两端存在平行 operation state、PreKey planning、retry 和 recovery 机制。
- Target: `secure-content-core` 独占 host-neutral operation、readback、recovery 和
  object-transfer mechanism；Social/Station 继续拥有业务 authorization 与 truth。
- Expected effect: adapter 不再解释 command identity、PreKey wire 或 retry order。
- Non-claim: 冒烟不证明真实私密内容发布、撤销或物理设备恢复。

### UCA-O04: Android 与 iOS 共用一个 Mobile 产品

- Before: iOS-first source 与不对称项目入口容易把 Mobile 误解为单平台实现。
- Target: Android/iOS 共用一套 Mobile React/TypeScript、Rust runtime、navigation
  和 product state，只在 Kotlin/Swift Host adapter 分叉。
- Expected effect: 两端构建与启动使用同一 Mobile 代码树，平台差异成为 capability。

### UCA-O05: Client Form、Presentation Policy 与 Host 分层清晰

- Before: Desktop、Android、iOS 容易被当作三个独立客户端架构。
- Target: Client Form 只有 Desktop 与 Mobile；Presentation Policy 按 Form 分叉；
  Platform Host 按 Desktop/Android/iOS 分叉。
- Expected effect: 可复用语义向 core 收敛，交互与系统能力在正确边界特化。

### UCA-O06: Messaging 只有一个 host-neutral Owner

- Before: shared crate 与 Desktop/Mobile 本地 owner 同时存在。
- Target: consumer 原子切换后删除旧 engine/store/recovery owner，不保留 facade、
  双写、永久 feature flag 或隐藏 fallback。
- Expected effect: owner-zero inventory 能从当前源码机械证明单一真源。

### UCA-O07: Secure Content 只有一个 host-neutral Owner

- Before: shared core 与客户端本地 worker/store/reconciliation 同时存在。
- Target: operation mechanism 归 `secure-content-core`，业务 authority 不下沉。
- Expected effect: owner-zero inventory 证明旧机制与调用者引用归零。

### UCA-O08: 共享 TypeScript 语义不制造万能 UI

- Before: Desktop/Mobile 存在重复 DTO、selector、codec、projection 和 storage 语义。
- Target: renderer-neutral 语义进入现有 `client-*` 包；只有 anatomy 与 interaction
  都 policy-neutral 时才共享 UI primitive。
- Expected effect: 共享逻辑保持无 Form/Host import，Desktop/Mobile shell 继续独立。

### UCA-O09: Runtime Port 与 Adapter 绑定真实目标

- Before: Rust/TypeScript 曾存在 iOS-first 静态身份和不完整 Android 入口。
- Target: 编译目标和 native observation 产生真实 release target；Host adapter
  实现 typed capability fact、admission 与 system action。
- Expected effect: Desktop native、Android Emulator、iOS Simulator 均从当前源码
  build、launch 并完成进程生命周期冒烟。

### UCA-O10: 当前源码通过聚焦 Gate 与三端冒烟

- Before: 历史 Gate、其他 commit 或单平台结果可能被扩大解释。
- Target: 当前 checkpoint 运行五个聚焦 source/owner Gate，并完成 Desktop native、
  Android Emulator、iOS Simulator 冒烟与本次资源清理。
- Expected effect: 架构完成结论可复现，但不扩大为 Full Acceptance 或发布就绪。

### 明确不变与非目标

- Desktop 与 Mobile 不追求像素或交互一致。
- Station 和 Model authority 不迁移到客户端 core。
- 不创建 daemon、sidecar、本地网络服务或第二业务真源。
- 不验收 APNs、FCM、物理设备签名、OEM 调度器和真实硬件传感器。
- 不运行 Completion、Full、release 或与 UCA 改动面无关的 Acceptance。

### 风险与回滚影响

- Messaging 与 Secure Content hard cut 通过 VCS revert 回滚，不保留运行时 fallback。
- 模拟器 smoke 能发现构建、启动、adapter 和生命周期回归，不能代表物理设备发布。
- 缺失当前源码 Gate 或任一三端 smoke 时，本 Plan 保持 `UNPROVEN`。

## Actual Outcome Results

```json outcome-comparison-results
{
  "kind": "peers-touch-outcome-comparison-results",
  "schemaVersion": 1,
  "planId": "UCA-20261017",
  "sourceIdentity": "d5c8e83e30c46a04500bc365882bc684182c581f; workspaceDigest=clean; worktree=peers-android; branch=analysis/android-platform-alignment",
  "items": [
    {
      "id": "UCA-O01",
      "status": "PASS",
      "actualEffect": "Android/iOS 共用 Mobile port、capability fact 与 admission 合同；Rust Optional 字段统一省略而非输出 null，TypeScript 边界测试和两端模拟器构建、安装、授权、重启冒烟通过。",
      "evidenceRefs": [
        "file:///tmp/uca-merge-smoke-d5c8e83e3/all.json"
      ],
      "deviation": "PASS 限于批准的架构和模拟器冒烟。授权由平台测试工具设置；未声明真实授权弹窗、物理媒体采集、OEM 调度或推送已验收。"
    },
    {
      "id": "UCA-O02",
      "status": "PASS",
      "actualEffect": "Messaging Core 合同、生命周期和 reconciliation 测试通过；Desktop member-authority trait adapter 保留完整 authority commit，Mobile Accepted readback 原子收敛 attempt 与 logical intent，HOME_PENDING 进入 Core 定义的 bounded retry 而不再自旋。",
      "evidenceRefs": [
        "file:///tmp/uca-merge-evidence-d5c8e83e3/8b99621815d8a125/unified-client-messaging-core-contract/20261020T045512233210Z-6c421cff7bd3841e2606a885b10b176b/reports/unified-client-messaging-core-contract.json",
        "file:///tmp/uca-merge-evidence-d5c8e83e3/8b99621815d8a125/messaging-owner-hard-cut-zero/20261020T045538644968Z-a38ee34ae753975259005733d206064e/reports/messaging-owner-hard-cut-zero.json"
      ],
      "deviation": "源码与 portable contract 已证明；完整跨 Station、多设备收发、接收端 UI 与消息恢复 Journey 未运行。"
    },
    {
      "id": "UCA-O03",
      "status": "PASS",
      "actualEffect": "Mobile Private Comment submit 已进入 secure-content-core 的 generation/lease operation、unknown-outcome readback-before-retry 与 committed readback；两端共用 operation 与 object-transfer 机制，Social authorization 和业务 truth 保留原 owner。",
      "evidenceRefs": [
        "file:///tmp/uca-merge-evidence-d5c8e83e3/8b99621815d8a125/secure-content-portable-core/20261020T045539276486Z-4fe2ae653fb95dbbfe4fc45903474a9c/reports/secure-content-portable-core.json",
        "file:///tmp/uca-merge-evidence-d5c8e83e3/8b99621815d8a125/secure-content-owner-hard-cut-zero/20261020T045547011689Z-ac96306e5f1782e07b3210c9f114accb/reports/secure-content-owner-hard-cut-zero.json"
      ],
      "deviation": "源码与 portable operation 合同已证明；真实私密内容发布、撤销、跨设备传输和业务恢复 Journey 未运行。"
    },
    {
      "id": "UCA-O04",
      "status": "PASS",
      "actualEffect": "Android APK 与 iOS Simulator app 从同一 Mobile React/TypeScript 和 Rust 代码树构建并启动；共享语义 Gate 检出 forkedMobileComponents=0。",
      "evidenceRefs": [
        "file:///tmp/uca-merge-smoke-d5c8e83e3/all.json",
        "file:///tmp/uca-merge-evidence-d5c8e83e3/8b99621815d8a125/unified-client-shared-semantics/20261020T045547503343Z-1851bc9a5cd0dc7605126c61f171ffd9/reports/unified-client-shared-semantics.json"
      ],
      "deviation": "证明同源构建、启动及共享代码边界，不扩大为所有产品页面和交互的双端对称验收。"
    },
    {
      "id": "UCA-O05",
      "status": "PASS",
      "actualEffect": "当前源码保持 accepted ownership：portable cores 决定 host-neutral transition，Desktop/Mobile stores 与 transports 只做 typed adapter；主线集成增量的 8 个 authored source 文件结构审查为 PASS。",
      "evidenceRefs": [
        "file:///tmp/uca-merge-review-d5c8e83e3/8b99621815d8a125/code-structure-review/20261020T050350122492Z-d08be8da13712beecd31e92b716861ec/reports/code-structure-decision.json"
      ],
      "deviation": "结构审查覆盖 f0f4e5791..d5c8e83e3 的 8 个 authored source 文件；不声明全仓代码审查或发布安全审计已完成。"
    },
    {
      "id": "UCA-O06",
      "status": "PASS",
      "actualEffect": "Messaging owner-zero Gate 通过：12 个旧 Desktop owner 文件已删除，parallelApplicationConsumers=0、forbiddenApplicationSymbols=0、portableCoreOsOwners=0；Gate 现在同时约束 member-authority adapter、non-message transition 与 Mobile reconciliation pacing consumer。",
      "evidenceRefs": [
        "file:///tmp/uca-merge-evidence-d5c8e83e3/8b99621815d8a125/messaging-owner-hard-cut-zero/20261020T045538644968Z-a38ee34ae753975259005733d206064e/reports/messaging-owner-hard-cut-zero.json"
      ],
      "deviation": "按冻结 owner inventory 与已登记符号证明单一语义真源；保留的客户端 transport、SQLCipher 和 Presentation adapter 是接受的职责。"
    },
    {
      "id": "UCA-O07",
      "status": "PASS",
      "actualEffect": "Secure Content owner-zero Gate 通过：2 个旧 worker owner 已删除，forbiddenLegacySymbols=0、manualMobileUploadOwners=0、portableCoreHostImports=0；8 个 production consumer 使用共享机制，Mobile Private Comment bypass 已纳入 fail-closed 检查。",
      "evidenceRefs": [
        "file:///tmp/uca-merge-evidence-d5c8e83e3/8b99621815d8a125/secure-content-owner-hard-cut-zero/20261020T045547011689Z-ac96306e5f1782e07b3210c9f114accb/reports/secure-content-owner-hard-cut-zero.json"
      ],
      "deviation": "按冻结 operation inventory 证明；Social/Conversation 的 authorization、outer transaction、grant、revocation、audit 和 GC 仍由业务 owner 负责。"
    },
    {
      "id": "UCA-O08",
      "status": "PASS",
      "actualEffect": "共享语义 Gate 通过：7 个 canonical declaration、12 个 consumer 文件、5 个 registered capability；duplicateLocalOwners=0、sharedHostImports=0、sharedPresentationLeaks=0，Desktop/Mobile composer 与 layout policy 保留在各自 shell。",
      "evidenceRefs": [
        "file:///tmp/uca-merge-evidence-d5c8e83e3/8b99621815d8a125/unified-client-shared-semantics/20261020T045547503343Z-1851bc9a5cd0dc7605126c61f171ffd9/reports/unified-client-shared-semantics.json"
      ],
      "deviation": "共享范围为登记的 renderer-neutral 语义；不要求 Desktop/Mobile 像素或交互一致，也不声明全产品视觉验收。"
    },
    {
      "id": "UCA-O09",
      "status": "PASS",
      "actualEffect": "Desktop native DOM、system_health 与 Tauri bridge 通过；Android APK 完成 Emulator 安装、启动、camera grant、force-stop/relaunch；iOS app 完成 Simulator 构建、安装、启动、photos grant、terminate/relaunch。",
      "evidenceRefs": [
        "file:///tmp/uca-merge-smoke-d5c8e83e3/all.json"
      ],
      "deviation": "Android/iOS smoke 未执行 secure-storage 或 WebView inspector 业务桥接断言；它们保持 UNPROVEN，构建与启动不能替代完整 Host adapter Journey。"
    },
    {
      "id": "UCA-O10",
      "status": "PASS",
      "actualEffect": "同一 clean checkpoint d5c8e83e3 的五个选定源码 Gate 均为 DONE/PROVEN，三端 bounded smoke 通过；主线集成增量的四个治理 Gate 与 Gap Detector 同时通过，本次 Desktop driver/storage、Android Emulator 与 iOS Simulator 已释放。",
      "evidenceRefs": [
        "file:///tmp/uca-merge-evidence-d5c8e83e3/8b99621815d8a125/acceptance-run/20261020T045512064601Z-7e89ca0f049b1bf71589992e7f89f429/reports/run.json",
        "file:///tmp/uca-merge-smoke-d5c8e83e3/all.json",
        "file:///tmp/uca-merge-review-d5c8e83e3/8b99621815d8a125/code-structure-review/20261020T050350122492Z-d08be8da13712beecd31e92b716861ec/reports/code-structure-decision.json",
        "file:///tmp/uca-merge-delta-evidence-d5c8e83e3/8b99621815d8a125/acceptance-run/20261020T050524193278Z-da7a2319ffac7b421fabd0e77297a858/reports/run.json",
        "file:///tmp/uca-merge-delta-gap-d5c8e83e3/8b99621815d8a125/acceptance-gap-detect/20261020T051142152826Z-4f7012fa5dfce8831adecbc6a6c3a459/reports/gap-report.json"
      ],
      "deviation": "完成结论只覆盖批准的 UCA 架构、主线集成增量与 bounded smoke；全量 Acceptance、完整产品 Journey、APNs/FCM、物理设备和发布就绪均未验证。"
    }
  ]
}
```

### 完成判断与证据边界

`UCA-01`、`UCA-02`、`UCA-03`、`UCA-04A`、`UCA-04`、`UCA-05A`、
`UCA-05`、`UCA-06`、`UCA-08` 已按用户批准的架构实施与模拟器冒烟口径收口。
十项 `PASS` 对应本报告的具体 actual effect，不代表完整业务或发布验收。

执行快照为 `d5c8e83e30c46a04500bc365882bc684182c581f`，
tree 为 `c5130263aae9f3d3e9cb21710a8d53a48bee8cee`，workspace 为 `clean`。
报告回填后的本地文档 checkpoint 不重标历史运行身份；新增源码变更需要重新证明。
Plan 计划区保持冻结，结果回填不增加 Plan schema/version。

五个 Gate 的 `runtimeCell` 均为 `source-only`。已核对报告、log 与 manifest
及 commit/workspace identity，completion run 为 `DONE/PROVEN`。主线集成增量
由 canonical planner 选择四个治理 Gate，并经 Gap Detector 判定为 `PROVEN`。
两组证据都不把其他产品 Gate 的未运行状态改成通过。

三端 smoke 为 `FUNCTIONAL_CHECK`：Desktop 真实 native DOM/bridge，
Android Emulator 的安装、权限、force-stop/relaunch，
iOS Simulator 的构建、安装、photos grant、terminate/relaunch。
Android/iOS 的 secure-storage 与 inspector bridge 未在本轮执行，保持
`UNPROVEN`。

本轮没有多场景业务 Suite、Station、账户或登录 provisioning；每个目标只有
bounded smoke，不声明 Suite Runtime warm-reuse 或产品 Journey proof。
资源清理核对了指定 Simulator 为 `Shutdown`、adb 无设备、任务进程已退出、
Desktop driver/storage 已释放。
既有模拟器定义、构建缓存及供用户复查的编译产物和证据保留。

### 复查入口

从本 worktree 执行：

```bash
uv run --with PyYAML==6.0.2 -- pnpm --dir apps/mobile run check:native-platforms
uv run --with PyYAML==6.0.2 -- node tooling/scripts/architecture/module-governance.mjs validate
make plan-validate PLAN=docs/architecture/platform/client/cross-client-runtime/execution-plans/20261017-unified-client-architecture/plan.md
uv run --with-requirements tooling/acceptance/requirements.txt -- \
  python3 tooling/scripts/uca_smoke.py --platform all --report /tmp/uca-review-smoke/all.json
```

交付复查五个源码 Gate 时，以本 Plan 的 `--completion` 选择器执行；不使用
`--full` 或 release aggregate。

### 外部运行证据摘要

运行证据位于仓库外；Git 只保存本报告和引用。主要文件 SHA-256：

- `all.json`: `44e8563934e965a2ce7af7ac4c874b936fab63b25ef16fcc5a1d71d99c4a5cd8`
- `acceptance-run/reports/run.json`: `0efad843cc122471b844a6fd463a6fdfafca084e4cde4139033d5367424acea5`
- `unified-client-messaging-core-contract.json`: `df7121b044f019bac7a4f8fdd1a0b7fda169c0d5abfd093cf45435fd539ecb1f`
- `messaging-owner-hard-cut-zero.json`: `546bb31bb0088030ba4e157336eb8a4ace3eecd0bfd6288327ab43db8128e885`
- `secure-content-portable-core.json`: `eba20c312ef71333776dbab5e8badbe53e707802b1800d93d6831e1fc9e228a7`
- `secure-content-owner-hard-cut-zero.json`: `ceb80926f439516dc624a2e3400c1849184a0b66d9ff0e0ea85fe04e970ba3a3`
- `unified-client-shared-semantics.json`: `8522f218e4e57a0d9e1576fbc5ddb42e1befb8eadf0372be096281d16c1ba2de`
- `code-structure-decision.json`: `0039cce3cca352e7cb5afe3ddd6dc8b0e4629adb44463e2ba6bd75d1ae87b7c3`
- `integration-delta-run.json`: `3355aa27c7ed6ab5df7c3f5af4a4012a050bbc27f67d51d72fbea86904159265`
- `integration-delta-gap-report.json`: `d143367b0a117cbc574bb192eb42e9c7adfa012912447f6e3e319f3ec608c536`

Acceptance run 的 `workspaceId=8b99621815d8a125`，
`runId=20261020T045512064601Z-7e89ca0f049b1bf71589992e7f89f429`。
每个 child Gate 的 source artifact、run ID 与 SHA-256 保存在该原始 `run.json`
和同 run 的 `manifest.json`，不能修改它们来适配新的源码身份。
