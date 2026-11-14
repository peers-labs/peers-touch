# Device Login Approval

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-11-12 | **Updated**: 2026-11-12
> **Owner**: Identity and Access
> **Module**: `apps/station/app/subserver/login_approval/`（规划）

---

## 1. Document Scope

本文档定义：

- 新设备**凭据先行、登录卡等待、已登录设备审批**的登录模型（claimant-first）。
- 无会话侧发起的登录审批事务、审批方资格、状态机、幂等与失效语义。
- 全对称审批关系：任意安装实例可申请，同 Actor 的任意已登录设备可审批。
- 审批在已登录设备上的呈现位置：Shell 全局弹窗与系统通知，不进入 chat、不埋入设置主路径。
- 24 词恢复短语（messaging recovery phrase）的兜底定位与 chat 硬门禁的移除。
- 无可用审批设备时的兜底通道及其能力缺口。

本文档不定义：

- Access Gate、Session、Actor Identity、Node Connectivity 的内部实现（沿用各自上游真源）。
- 二维码/扫码引导的网络材料细节（保留 [Mobile Scan Login](../mobile-scan-login/README.md) 作为私有 Station 引导的备用路径）。
- 历史消息、ratchet、MLS state 的恢复语义（沿用 MSL-D06 与既有 Recovery 合同）。
- 执行阶段划分与任务排序（设计接受后由执行方法学另出 Plan）。

## 2. 背景与问题

当前 Device Link 是**已登录设备发起**模型：桌面端在 Settings 设备面板手动生成二维码，
新设备扫码提交 claim，桌面端在同一设置面板内审批。源码核实暴露出三个产品断裂：

1. 新设备没有“直接输凭据登录、等待审批”的入口，只有扫码入口；审批能力埋在设置面板，
   不在登录链路上。
2. 新设备或重装设备凭据登录后，本地 Actor 身份未通过 Station 连续性校验时，
   `MessagingRecoveryGate` 在 **chat 表面**硬阻断，要求输入 24 词恢复短语，否则只能登出。
   恢复短语（币圈式 backup code 卡）从兜底手段变成了日常业务流上的路障。
3. 多设备会话在存储层已经支持（活跃会话唯一索引为
   `(station_peer_id, user_id, device_id) WHERE revoked=false`），但登录发起方向与 UX
   仍是单设备时代的形态，能力与产品模型错位。

## 3. 设计目标

1. 用户可在任意设备的登录卡直接输凭据登录；凭据通过后登录卡进入“等待已登录设备批准”态。
2. 同 Actor 的任意已登录设备均可审批，审批通过后身份 seed 加密交付，新设备闭合身份连续性。
3. 审批请求以 Shell 全局弹窗（前台）与系统通知（后台）送达，不出现在 chat，不依赖设置面板。
4. 24 词恢复短语与邮箱强校验仅作为“无设备可审批”时的折叠兜底，永不进入主路径。
5. 移除 chat 表面的恢复硬门禁；审批登录的设备不再触发 `recovery_required`。
6. 复用 Device Link 已接受的 HPKE 身份交付、CAS 状态机、Access Gate 与 per-device Session 合同。

## 4. 文档导航

| 文档 | 说明 |
|------|------|
| [design.md](./design.md) | 证据台账、核心原则、系统架构、动态流程、契约与组件关系 |
| [decisions.md](./decisions.md) | DLA-D01 至 DLA-D08 决策、代价与替代方案 |
| [data-model.md](./data-model.md) | 新 proto、状态机、持久化、预算与错误码 |
| [module-layout.md](./module-layout.md) | Station/Desktop/Mobile/Model 目标模块归属 |
| [integration.md](./integration.md) | 与 Mobile Scan Login、Access、Session、Recovery 的映射与迁移 |

## 5. 评审状态

DLA-D01 至 DLA-D08 已于 2026-11-12 评审接受。文档级 Status 保持 draft：
按模块治理规则，registry 只接受 active 且 governedPaths 已存在的模块，
因此 Status 转 active 与 registry 登记在首个实现变更中完成。下一步进入
PLAN 阶段，由执行方法学产出 `execution-plans/` 下的冻结计划。

## 5.1 实现状态（2026-11-12 自检）

已落地并通过本机证据（源码/编译/单元级，非原生产品证明）：

- proto `login_approval.proto` 与 `ACCESS_GATE_TYPE_DEVICE_APPROVAL` 枚举，Go/TS/Rust
  三端生成代码已同步。
- Station `login_approval` subserver：事务状态机、持票哈希、CAS、TTL、预算、审计、
  真实 Access/Session/Actor 端口与六个 HTTP 端点；Go Journey 测试覆盖创建/持票/
  取消/拒绝/无审批人/坏凭据/并发预算/CAS 竞争/过期/审批方撤销/审批投影。
- 共享 `schema-core`/`device-link-core` 暴露 prost 类型，无第二套密码学。
- Desktop：Rust 持票保险库与六个 Tauri 命令（`cargo check` 净）；TS service/runtime/
  store、登录等待卡、Shell 审批弹窗，等待视图接入 LoginPage 状态机；chat
  `MessagingRecoveryGate` 硬门禁已删除；Shell 弹窗拆出 props 驱动的 `LoginApprovalDialogContent`
  （对齐 Mobile 可测结构），用 SSR 单测钉死设备身份/比较码投影、空态不渲染、标签兜底与错误展示；
  vitest 全量 src（2001 通过）、tsc、生产构建通过。
- `domain.DeviceApprovalPolicy` 默认关闭策略谓词（含单测），首设备旁路与显式设备上限。
- frame 侧 `deviceApprovalGatekeeper`（`DEVICE_APPROVAL` 门）已实现并注册进 gatekeeper
  registry；刻意不进 `defaultGateOrder`，单测证明默认链零变化（注册可被显式 enabled-gates
  策略引用、默认 SKIPPED、首设备 PASSED、存量设备 ACTION_REQUIRED、计数错误 fail-closed）。
  开关与设备上限经 `resolveConfig` 读取：linked 事务优先取 `linkedPolicyKey` 的 SHARE 锁快照，
  标准凭据路径（裸请求 ctx 无快照）回退到与其他 gatekeeper 同源的 `GetPolicy`（context 优先、
  再读库）；策略无法解析时返回 BLOCKED fail-closed，而非静默关门，已被单测钉住。
- 策略持久化全链已接通：`db.AccessPolicy` 新增 `device_approval_enabled`（默认 false）/
  `device_approval_max_devices` 列，frame `PolicyInput`/`UpdatePolicy`/`ToProtoPolicy` 与
  Dashboard `handleUpdateAccessPolicy` 请求映射、Dashboard `AccessGatesPage` 开关 + 设备上限
  控件及 `accessGates` API 类型全部透传；Go app/frame 双模块构建、Dashboard tsc 通过。
- Desktop 与 Mobile 访问门识别：两端 `KNOWN_GATE_TYPES` 收录 `DEVICE_APPROVAL`（数值 10 与
  protojson 字符串双形态）并新增 `isDeviceApprovalGate` 谓词，避免 ACTION_REQUIRED 被误判为
  unknown gate；遵循 access-gate-wire-contract invariant，单测覆盖双形态与非 unknown 结论。
- app 组合根 `ConfigureFrameGate` 把真实 `CountEnrolledDevices`（排除 revoked/异 Actor，
  含 sqlite 单测）注入 frame 接缝，开关默认 false，接线本身不改变任何授权决策。
- 审批方授权边界已用 sqlite 单测钉死：`ApproverOwner.RequireApprover` 的同 Actor 限定、
  无 subject/空 session 拒绝、会话过期、审批设备已撤销、无 enrolled 设备行（ghost）、
  以及 claimant 不得自审，全部 fail-closed；跨 Actor 设备无法审批本 Actor 事务。
- Mobile web 层：`loginApproval` service/store/runtime（双角色轮询、epoch fence、后台
  暂停），已注册进 mobile runtime registry；等待卡、Shell 审批弹窗（含无 portal 可测内容
  组件）与 host 容器、CSS、18 个 en/zh 文案键；vitest、registry 契约、组件 SSR 测试、
  tsc、生产构建通过。Mobile TS proto 由 `proto-gen-mobile.sh` 同步生成。

未完成（需运行时/真机证据，未冒充完成）：

- 活门触发接线：Station 侧在凭据通过且下一门为 `DEVICE_APPROVAL` 时正确返回
  ACTION_REQUIRED 且不发 session（`actor_handler` 仅 GRANTED 才 `FinalizeGrantedSession`）；
  但 Desktop Rust `access_submit_login` 现对任何非 GRANTED 决策统一 `Forbidden` 失败
  （`application/auth/service.rs`），无法区分“凭据有效、待设备审批”与“登录失败”。需先把该
  命令改为返回类型化 outcome（granted session vs pending gate 决策），再由 TS 经
  `identityRuntime`/状态机进入 claimant 等待态并回调 `requestApproval`（integration.md §5），
  涉及本机 device id / station peer id / decision revision 取值，属安全敏感路径，需
  `make desktop` 双机运行时验证后落地；启用策略后的端到端授权 Journey 同样待运行时证明。
- Mobile Rust Tauri 命令实现（DLA-05 原生层；web 层已定义 invoke 合同与 host 容器，
  Rust 侧待接 OAuth/route 协调器，需模拟器功能验证）与 host 的导航挂载。
- DLA-07 三条原生 E2E Gate 与模块转 active registry 登记（governedPaths 尚不存在，
  治理校验器只接受 active 且路径已存在的模块）。

## 6. 上游约束

- [Mobile Scan Login](../mobile-scan-login/README.md)：MSL-D01 至 MSL-D07 继续约束加密交付、
  Access 终裁与 per-device Session；本模块改变发起方向与 UX 归属，不重写其密码学合同。
- [Station Access Gate](../../../platform/station/access/station-access-gate-architecture.md)、
  [统一 Actor 身份](../unified-actor-system.md)。
- 知识层 invariant：Device Link 提交不替代准入与生命周期、Session 与 Messaging 共享
  device_id、Desktop identity 投影必须经状态机闭合。
