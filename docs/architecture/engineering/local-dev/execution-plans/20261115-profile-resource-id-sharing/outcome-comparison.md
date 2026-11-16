# Profile 资源 ID 分配与共享效果对比

> **Owner**: Platform Team
> **Plan**: LDCP-RES-20261114

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "LDCP-RES-20261114",
  "plannedSectionDigest": "sha256:72c7e9720f0512311ef31839444596d9deedbe58f0f63e3975a69e52402c752a",
  "criteria": [
    {"id": "RES-ID-O1", "dimension": "user-experience", "title": "用户分配和具体覆盖通知", "taskIds": ["RES-01", "RES-02", "RES-03"], "gateIds": ["profile-resource-overwrite-native-e2e"]},
    {"id": "RES-ID-O2", "dimension": "product-capability", "title": "Profile 内自由安排和 ID 共享", "taskIds": ["RES-01", "RES-03", "RES-04"], "gateIds": ["profile-resource-id-sharing-native-e2e"]},
    {"id": "RES-ID-O3", "dimension": "architecture", "title": "唯一 ID/assignment/content owner", "taskIds": ["RES-01", "RES-04"], "gateIds": ["machine-dev-registry-self", "profile-resource-id-sharing-native-e2e"]},
    {"id": "RES-ID-O4", "dimension": "technology", "title": "物理锁、具体 force、竞态和恢复", "taskIds": ["RES-02", "RES-04"], "gateIds": ["profile-resource-overwrite-native-e2e"]},
    {"id": "RES-ID-O5", "dimension": "quality-operations", "title": "共享资源保留和 current-source proof", "taskIds": ["RES-03", "RES-04", "RES-05"], "gateIds": ["machine-dev-registry-self", "profile-resource-id-sharing-native-e2e", "profile-resource-overwrite-native-e2e"]}
  ]
}
```

## Planned Outcome Comparison

### RES-ID-O1 用户分配和具体覆盖通知

基线（verified_fact）：启动器只持 slot lease，原设计候选以数量/角色组织设备；
用户明确指定每个 Profile 的分配及具体覆盖决定。
目标：用户说数量/用途或选择设备名称；Agent 查询 inventory，显示可读名称、
型号/系统、状态/共享方，内部解析 ID。普通读取不提示覆盖；
冲突说明设备名称、共享方、内容/影响，用户选择 force/decline；拒绝不改动。
效果：用户掌握分配和覆盖，共享不变成默许替换。RES-01/02/03，overwrite Gate。
风险：同名、改名、列表刷新不能改变内部身份；锁前后影响变化需新通知。
无业务 UI 重设计，发现/通知由开发入口/原 owner 承载。

### RES-ID-O2 Profile 内自由安排和 ID 共享

基线（verified_fact）：`mobile_simulator.py` 原 iOS 客户端各建独立设备；
launcher/Provisioner 缺统一 Profile-to-ID 引用关系。
目标：A 有 `[ios-a, ios-b]`、B 有 `[ios-b]` 时都看见 `ios-b` 的共享方与实际状态。
数量是输入/集合 cardinality，场景自由安排；不作为身份。
效果：Profile 独立安排且明确共用，无默认上限/固定角色。RES-01/03/04，sharing Gate。
共享实际内容可被已确认操作改变，不假定隔离副本；Android 不在初始证明范围。

### RES-ID-O3 唯一 ID/assignment/content owner

基线（verified_fact）：LDCP-D03 分开 env 和 machine allocation；machine-dev
当前仅 slot/Station 操作，resource assignments/content 未实现。
目标：machine assignment 是 reference set 真源，reverse view 派生；instance
唯一拥有 provider/content，全部 consumer 消费同一投影。
效果：去掉 consumer allocator/数量择机，共享 env 不存本机 UUID。
RES-01/04，owner self/sharing Gate。无新增服务、端口、task ledger/PlanMount；
序列化/API 是待实现交付项，概念模型不冒充已有 schema。

### RES-ID-O4 物理锁、具体 force、竞态和恢复

基线（verified_fact）：slot 不保护 UUID；fresh-device 策略回避 Keychain 残留，
缺共享 ID 的覆盖决定/锁后重验；memory cleanup 不足以恢复 create crash。
目标：冻结 exact effects，具体决定后物理锁下重验；变化重新通知；canonical
content/last writer 对所有 Profile 可见，preparation/failed state 可恢复。
效果：force 不绕锁、不默认，拒绝不写，Keychain/data effect 准确读回。
RES-02/04，overwrite Gate。风险：被动共享不保证隔离；partial failure 必须可见；
活跃进程停止须具体许可，不能从设计修订推导。

### RES-ID-O5 共享资源保留和 current-source proof

基线（verified_fact）：原 cleanup 关机/删除 per-run devices；Mobile Make 的
connect 检查后调用 Station deploy；新 resource Gate 不存在。
目标：detach/lease release 保留别人的引用/内容，physical delete 单独授权及
provider absence proof；native connect-only，全部 cut 后 current-source Gate 验证。
效果：一个 Profile/Suite 结束不破坏共享资源，引用/锁/进程/设备/目录结果分开。
RES-03/04/05，三个 Gate。历史设备不接管，four 手动验收维持；
不承诺释放磁盘空间，不新增真实 Profile 配置。

## Actual Outcome Results

资源 owner、可读发现/分配、共享引用、具体覆盖决定、物理锁及恢复已经实现。
两个普通 Mobile 入口与全部 iOS Provisioner 已切到 canonical Machine Dev；
普通 Suite cleanup 只释放会话与 lease，物理删除单独消费具体决定。

2026-11-15 的原生 development run
`20261115T111710998561Z-6f4e8233b472e88ad537f3b30dd8a04e` 实际观察到
16 项通过，包括 preparation/create 进程中断恢复、等数量不同 ID、同名/改名/
过期选择、部分物理锁竞争与释放、lease owner 退出、同实例共享及 owned delete。
原 iOS Provisioner 已构建并安装当前 native 包，返回 `FIXTURE_READY`；
随后新 Journey 错误读取不存在的 `ProvisioningState.READY`，因此整轮仍为
`FAIL/UNPROVEN`。该枚举引用已修正，后续 native identity、Keychain、具体覆盖、
安装中断恢复及 reset 尚需新一轮实际证明。

普通 Mobile 入口实际返回 `RESOURCE_ENDPOINT_CONFLICT`：four 的既有应用仍使用
当前 workspace 的 7573 端口。原应用和服务保留，不能将该项记作启动通过。
本轮最终删除两台新建 fixture，provider/目录删除读回通过，19 台既有设备
状态保持原样；这只证明本轮 cleanup，不证明未执行的 native Journey。

两个正式 native Gate 已实际执行 source fence，并因未提交源码
`BLOCKED/UNPROVEN`，没有创建 fixture。本次未获 commit/push 授权。
原 owner self Gate 的上一轮受 600 秒超时和执行中 source drift 影响，仍需稳定
源码回归。Mobile consumer 的上一轮 85 项中有一项在原生操作期间等待
canonical registry 超时；清理后完整重验 85 项全部通过（23.595 秒）。
Journey 的全部 provisioning enum 与 session API 引用已按原 owner 校验。
review freshness 已按当前治理文档同步，完整 `skill-check.sh` 通过；
冻结 Plan Version 与 planned outcome digest 校验通过。

补充 native build/input owner 回归执行了 77 项，产生 10 条失败和 3 条错误，
均在既有 Android synthetic Cargo fixture 上遇到 Tauri 2.10.3/2.12.5
版本不一致；HEAD 已包含该不一致，本次未修改该 Android 路径。
Mobile Domain 的 11 项 capability 结构校验通过；结构、mock 和构建结果均不
替代正式原生证明。后续源码或文档变化必须刷新对应 source-bound 检查。

RES-05 明确是 `source-only` 的 `acceptance-aggregate`，由原 Gate/Provisioner
分别持有独立 fixture，自己不持 product runtime。显式把该 Task 传给
pipeline auditor 会得到缺 `runtimeReuse` 的合同失败；该 runtime Task 检查
不适用于此 source aggregate，不能据此修改冻结的 Plan Version，也不据此
声称 runtime reuse 或产品通过。

### 2026-11-16 当前事实

上面的 2026-11-15 记录保留为历史证据，不代表当前源码或运行状态。
用户已授权 checkpoint 和 rebase；原 checkpoint
`e73856a0d01fda12c1442445a9386802a5dd2c2e` 保留在安全分支，当前分支已 rebase
到 master `8cf3dc474309cc9ab7f938d81ad4a035a7fbec4d`，形成
`09526dbe36105bf5cd422f75794f278be3559393`。完整双边清单为 322 个路径；
316 个单边路径与改动来源的 blob/mode 一致，6 个重叠路径按双方意图整合。
review freshness 保留两边新增规则，并按合并后的 governing docs 重新计算摘要。
没有强制覆盖或推送。

rebase 后发现 selected iOS session 工厂默认使用 60 秒 HTTP deadline，而原
parent session owner 使用 180 秒。已让该入口消费原 owner 的同一 deadline，
保留原设备身份；新增对应原 consumer 回归。112 项 consumer/session 回归、
43 项 Machine Dev 回归及 `skill-check.sh` 通过。合码 owner 原始 24 项
topology 回归通过。检查日志位于
`~/.peers-touch/acceptance-artifacts/integration-review/pr170-rebase-20261116/`；
这些是 source checks，不是完整 integration admission 或 native proof。
独立 review 仍须绑定实际 final source 和完整原始输出。

本轮 development Gate
`20261116T121327886535Z-ad46804da676e2822d0ebc6c54602797`
在 `ProfileIOSFixture.__init__ -> inventory` 的 `xcrun simctl list --json`
30 秒 timeout 处失败，assertions 为零，尚未创建 fixture 或执行 WDA/Keychain。
Xcode simctl wrapper 要求 CoreSimulator `1174.21`，当前系统为 `1174.9.2`，
因此查询触发 `xcodebuild -runFirstLaunch` 并等待管理员授权；
`xcodebuild -checkFirstLaunchStatus` 返回 69，非交互 sudo 返回
`a password is required`。必须完成系统工具链初始化后再运行同一 Journey。
不能把当前错误归为产品失败，不能把 timeout 修正当作 native 通过。

four Station 当前健康。原 `mobile-simulator-chat-e2e` 已在 development policy
下完成 `REUSE_IMPLEMENTATION` 准备；原双端 Suite 覆盖 Direct/Group、交互、
附件、搜索、typing、回执、重启，以及真实相册选择/取消、录音和接收端解码/
播放。尚未执行这些当前源码断言；four 原 Profile 也尚无 iOS compatibility
声明和资源分配。后续应完成具体资源资格，再运行原 Suite，不另造 Chat driver。
继续增强了原 Chat Suite：Direct/Group 各有正反两次真实 composer send，要求
接收端 DOM 的同一 message ID/正文、发送端可见 delivered/read 回执以及接收端
未发送草稿保留；双端截图和 DOM 随原 Suite 采集。67 项原 Gate 回归通过，
并新增缺反向、缺 receiver DOM、草稿丢失、仅 sent 回执或 Harness send 的拒绝
用例。仅扩展原 Feature/Gate 的动作与断言，不创建新 Gate 或 client。
这些当前源码 native 文本断言仍未执行，不能记为产品通过。
两个正式 resource Gate 未在此次 rebase 后重跑，仍为 `UNPROVEN`。
本次 deadline 修正和报告更新尚未提交；planned section、Plan Version 和冻结
Gate denominator 保持原样。

### 2026-11-17 真机试装与 PR 范围

Xcode 首次初始化已完成。基于上述源码构建的 iOS arm64 应用通过 Xcode
build 和严格 codesign 校验；内置 Rust runtime 中的前端入口与本次 Vite
产物一致。通过直接 USB 安装服务完成真机更新，返回 `InstallComplete`，
并按 bundle ID 读回确认应用已安装；安装未执行卸载或数据重置。

CoreDevice 的开发镜像服务启用仍超时，自动启动应用也超时。因此本次只证明
当前源码的真机构建、签名和安装，不证明应用启动、Chat Journey、资源共享、
Keychain 或任何正式 Gate。此前工具链初始化阻塞已经解除，但 native/formal
proof 仍为 `UNPROVEN`。

用户随后调整顺序：先提交 PR，后续在同一个 Agent 下继续测试。本轮以
Draft PR 记录上述证据缺口，保留原资源 owner 和双端 Chat Suite，不额外
拆分测试入口；PR 不声明
完整 Mobile、Chat 或资源共享验收通过。

## Outcome Comparison Results

```json
{
  "kind": "peers-touch-outcome-comparison-results",
  "schemaVersion": 1,
  "planId": "LDCP-RES-20261114",
  "sourceIdentity": "pr170-combined@09526dbe36105bf5cd422f75794f278be3559393; development run 20261116T121327886535Z-ad46804da676e2822d0ebc6c54602797 bound workspace sha256:6e746cd4a99f71ee81406527a73835fb4a0d61e0a25c0e474a55e1b5d39b0d46; actual report updated afterward; current native/formal proof UNPROVEN",
  "items": [
    {"id": "RES-ID-O1", "status": "UNPROVEN", "actualEffect": "可读分配和覆盖决定已实现；原生观察到同名、改名和过期选择拒绝，具体 native 覆盖步骤未执行。", "evidenceRefs": ["~/.peers-touch/dev/workspaces/9c2993be5961ea8b/workflow/RES-05/artifacts/9c2993be5961ea8b/profile-resource-native-functional/20261115T111710998561Z-6f4e8233b472e88ad537f3b30dd8a04e/reports/profile-resource-native-functional.json"], "deviation": "整轮失败；修正枚举后需新原生 run，正式 Gate 仍被 dirty-source fence 阻塞。"},
    {"id": "RES-ID-O2", "status": "UNPROVEN", "actualEffect": "assignment 与共享引用已实现；真实 provider 观察到等数量不同 ID、同 ID 共享和双方可读投影。", "evidenceRefs": ["~/.peers-touch/dev/workspaces/9c2993be5961ea8b/workflow/RES-05/artifacts/9c2993be5961ea8b/profile-resource-native-functional/20261115T111710998561Z-6f4e8233b472e88ad537f3b30dd8a04e/evidence/profile-resource-native-functional-resource-provider-native-journey.json"], "deviation": "共享方 native identity 与内容变化步骤尚未执行；不将部分 provider 观察升级为正式证明。"},
    {"id": "RES-ID-O3", "status": "UNPROVEN", "actualEffect": "唯一 resource owner 和全部 iOS consumer cut 已实现，旧 direct create/delete 路径移除；原 Provisioner 已返回 FIXTURE_READY。", "evidenceRefs": ["tooling/scripts/local-dev/machine-dev-resource-store.mjs", "tooling/acceptance/provisioners/mobile_ios_resources.py", "~/.peers-touch/dev/workspaces/9c2993be5961ea8b/workflow/RES-05/artifacts/9c2993be5961ea8b/profile-resource-native-functional/20261115T111710998561Z-6f4e8233b472e88ad537f3b30dd8a04e/reports/profile-resource-native-functional.json"], "deviation": "原 owner self Gate 尚需稳定 source 回归；native/source Harness 读回在枚举异常后未执行。"},
    {"id": "RES-ID-O4", "status": "UNPROVEN", "actualEffect": "锁、具体决定、竞态与恢复机制已实现；真实 provider 证明 preparation/create 及 lease owner 进程退出恢复、部分锁竞争和释放。", "evidenceRefs": ["~/.peers-touch/dev/workspaces/9c2993be5961ea8b/workflow/RES-05/artifacts/9c2993be5961ea8b/profile-resource-native-functional/20261115T111710998561Z-6f4e8233b472e88ad537f3b30dd8a04e/evidence/profile-resource-native-functional-resource-provider-native-journey.json"], "deviation": "native force/decline、reference/content race、安装中断和 Keychain/reset 仍需实际完整 run。"},
    {"id": "RES-ID-O5", "status": "UNPROVEN", "actualEffect": "release 与 detach 保留资源，fixture delete 单独确认；实际删除两台本轮 fixture 并保留 19 台既有设备。", "evidenceRefs": ["~/.peers-touch/dev/workspaces/9c2993be5961ea8b/workflow/RES-05/artifacts/9c2993be5961ea8b/profile-resource-native-functional/20261115T111710998561Z-6f4e8233b472e88ad537f3b30dd8a04e/reports/profile-resource-native-functional.json"], "deviation": "普通入口被既有 four 端口占用阻塞；完整 current-source native/formal proof 未完成，文档和修正会刷新 source snapshot。"}
  ]
}
```
