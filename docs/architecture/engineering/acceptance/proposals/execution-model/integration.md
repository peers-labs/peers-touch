# 与现有 Acceptance 的集成

> **Status**: draft
> **Authority**: non-normative
> **Created**: 2026-10-22 | **Updated**: 2026-10-22
> **Owner**: Acceptance

## 已有真源与落地关系

- Acceptance D-20 保留显式范围与 impact mapping 的分离：
  业务选择不由路径命中或编译器自动扩张成完整发布。
- D-21 保留 Suite lifecycle、预算、attach-only、receiver-visible
  与原子结果 generation；执行图补齐其外层组合。
- Operation-language-design 保留唯一 authored Step。
  UI 操作、预期可见结果、执行机制与 fallback policy 不复制到 Gate。
- Evidence Store、ArtifactRef、RuntimeBinding、Profile、Provisioner、
  launch context、已有 finalizer 保持各自 owner。
- Workflow 保留聚焦功能、正式闭环、可选 Plan 和真实授权边界。
  不恢复 Session-backed Admission 或已删除的重型流程。

## 实现影响与替换目标

`acceptance-plan.py` 保留路径影响与 Gate 选择。
Runner 解析实际显式选择后，使用共享纯编译器建立 producer/判断依赖图，
不让 Planner 和 Runner 各维护一套拓扑逻辑。

`acceptance-run.py` 由该图驱动 Suite/单节点执行和消费者判定；
不再让同一资源组的每个 producer 重复 provision/cleanup。
不为每个 Gate 留旧的并行“独立完整 Journey”执行分支。
独立单 Gate 请求也展开其必要 producer/prerequisite 闭包。

`core/suite_runtime.py` 保留已有事件与报告检查；资源 owner 在真实边界计量。
新的图、dispatch/引用关系通过既有校验入口验证，不创建另一 Evidence Store。

Chat interactions 两个完整入口收敛为共享场景生产者和两个判定集合。
Direct 收发、未读/历史和背景图等独立要求分开引用；
背景图缺证明不掩盖已完成收发，但完整旧合同也不能被报告为 PASS。

Access 同 Actor/device/restart 正向断言由一份共同场景生成；
认证前绑定、logout、scope、OAuth、takeover 等仍有自己的 case。
Mobile 普通 setup 等待所需 Runtime 的真实 readiness；
restart/恢复移入独立产品 case，Social readiness 不再拖住纯 Chat setup。

Social CSS-09 与 RAL 已有消费者保留原始 producer refs，
统一接入图而不再次执行生产者。
release aggregate 是终端只读消费者，不能反向触发隐式全产品运行。

R001-05/06 的相同 functional/proof 大命令属于旧执行模型的待替换输入。
修改已冻结/关闭的 Plan 必须按其现有合同处理，不能悄悄改写历史执行事实，
也不能生成高于 V1 的 Plan schema 字段。

## 业务注入与 Infra 的分界

Infra 负责图、唯一 producer 校验、调度、资源计量、引用、失效与报告。
Chat/Social/Access 负责 case、操作、断言、设备/账号拓扑、fault 和 oracle。
缺少业务 sender/receiver/fault producer 时报告 BUSINESS_INJECTION_REQUIRED，
不让 Core 内置一段临时发消息代码补齐。

本提案本身不创建新业务回归代码；下面定义的是落地必须满足的真实合同。

## Chat/Social P1 的闭环要求

此前要求的 P1 修复保留在工作范围内，Gate 重构不能把这些问题当噪声删掉。

**私密评论编辑重发**：
在原生 Mobile 失败后保持内容不变重试，验证稳定命令/draft 身份；
修改文本或 reply target 后重发，验证新 revision/intent，
对方只观察一次正确评论。覆盖响应丢失、回到页面、重复点击。
UI 不能通过无限新建 draft 掩盖未知提交结果；Native immutable-intent 合同保留。

**Inbox 消费后 UI 更新**：
在会话 B 已加载时，令会话 A 的 send/draft 准备触发 convergence drain，
同时投递 B 的消息/编辑/撤回；验证 B 无手动刷新即可更新，
且 ACK/cursor 不丢失、投影事件受当前 generation 约束。
所有消费路径通过 lifecycle-owned observed boundary，不能只修普通 worker。

**未完成互动的清理依赖**：
制造 stale-plan/superseded interaction，再做 clear/retention；
验证目标在逻辑 intent 终结或替换前仍被保护，
随后恢复后 intent 能重准备、worker 后续消息不被阻塞。
Desktop/Mobile 对同一 logical-intent 状态采用同一保护语义。

**重复准备恢复密钥**：
对同一 Actor/已有 epoch 两次准备、重启后再准备，
验证复用现有 material 与合法 inventory，不产生 epoch conflict，
不改变已登记 signing identity。该项是 Suite 热复用的 prerequisite。

既有 Desktop 同设备数据库丢失/PreKey/Inbox baseline、
旧异步请求回填清空会话、identity/search fencing 等 P1 候选仍逐项复核；
当前未全部关闭，不宣称 PR 可正式合并。

## 必须保留的差异维度

Runtime cell、同/跨 Station、Direct/MLS/Social、Actor/Device scope、
未授权方、revocation/epoch、offline/restart、消息与附件类型，
只有合同明确证明等价时才能复用。
本次用户暂缓的 Relay、通话、完整发布等专项保持暂缓，
不能因 dependency closure 再展开成全套专项；核心实际依赖仍必须有效。

## 切换验收合同

图编译检查依赖循环、缺 producer、重复映射、错误证据强度、
非法跨 cell/epoch 复用和入口不明；均在准备环境之前失败。

框架验证同一场景被两个 Gate 消费时只 dispatch 一次；
基础失败只阻断依赖方；取消、cleanup 失败和 retry 不发布半套正式结果。
保留现有 Runner、pipeline、Suite、ArtifactRef/finalizer 的回归检查。

真实原生验证使用当前源码、受控 Profile 和双端接收 UI：
同一资源组 setup 一次、普通 case 不重新登录/启动，
独立 restart/fault 明确计数，Chat/Social P1 场景覆盖其完整生命周期。
不得以模拟 Suite 通过代替产品 proof，也不因框架缺少业务 provider 阻断
已满足 domain-neutral 合同的 Core 自验。

切换时在同一改动更新 accepted 文档、Feature/Step/producer/Gate 注册、
治理投影和校验器，移除已被替代的活动执行路径。
历史 evidence 原样保留；没有新的 current-source proof 就保持 UNPROVEN。
本文定义终态与集成合同，不是已确认的执行计划。

## 时延与自优化集成

`acceptance-run.py` 和同一 graph compiler 维护固定 candidate、request 起点、
总 budget、资源关键路径、首个有效反馈和终态结果，不再只输出各 Gate timeout 之和。
所有 child/RPC 使用剩余 deadline，真实终态错误及时归属到明确节点。

`plan-package.mjs` / `module-governance.mjs` 的解析边界需要受控工具链和预算。
不能靠延长 timeout、忽略 YAML registry 或删除架构验证来“提速”。
确定性 registry/Plan 的解析和 hash 由完整内容、目录依赖与工具链身份复用；
禁止 Planner、Runner 和 auditor 各自无条件重复做相同全量解析。

`suite_runtime.py` 继续做资源/场景事件一致性；
新的 spans/counters 补齐 build、deploy、准备、wait、操作、取证、清理和发布。
复用现有 Driver/RuntimeBinding 的调用边界，按 OTel 模型输出，
不另建业务遥测 SDK 或新的常驻服务作为验收前置。

各业务 Gate 声明产品效果阈值、mandatory wait floor、required evidence
和合法观察接口。whole-product surface 矩阵由 full-UX 选择；
单能力修改仅选择其受影响组合，不能把精简运行宣称为完整旧合同通过。

拟议框架效率能力由现有 Infra validation/pipeline auditor 承载，
只消费图和已有计量一次。失败不反向执行所有业务 Gate。
性能结果、产品 proof、缺口和历史统计分别报告。

自优化控制器保存按类 cost profile 和合法执行策略，
自动选复用/缓存/顺序/有限并发/有界条件观察；
需要源或合同变更时形成有依据的改进候选，交给现有 owner/workflow。
先用同一固定候选、相同 workload 和证据要求测量瓶颈 Suite，
不为了效率自验再次展开全 release。

时延、返工、失败定位和自身开销的具体目标与验证方式见
[performance-design.md](performance-design.md)。
产品 P1 修复不能被框架性能优化掩盖，回归范围仍按上文保留。
