# 多引擎编排可落地性论证（Multi-Engine Feasibility）

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-22 | **Updated**: 2026-06-22
> **Owner**: Peers-Touch Agent Team
> **关联原型**: `packages/prototypes/atelier`（`src/engine.ts` / `src/engineTrace.tsx`）、`packages/prototypes/desktop`（`src/AgentAdmin.tsx` 引擎编排页）
> **上游设计**: [design.md](../design.md) §3-4、[data-model.md](../data-model.md) §1.4 / §2.5、[functional-modules.md](./functional-modules.md) §7

---

## 0. 这份文档要回答什么

用户的核心质疑：**「这些引擎我不确认你是否能够落地并完成。agent 本身是非常难做的事，不是能聊天就完了——思考链、技能工具、执行链、记忆、思考，都非常有挑战。」**

这份文档不靠好看的 mock 假装回答，而是**把每个引擎机制锚定到 Station 里已经存在的真实 Go 代码**，逐条标清三件事：

1. **复用**：这个机制现在已经有哪段真实代码可以撑（不是规划，是已跑的 Go）。
2. **缺口**：还差哪段代码（全仓 grep 已确认零命中，必须新写）。
3. **范围**：第一批做哪三个引擎、为什么是这三个。

并且诚实区分**原型能证明的**和**原型证明不了的**（见 §6）。

---

## 1. 核心判断：六引擎不是六套实现

最容易把这件事做塌的方式，是把「Expert Hierarchy / Roundtable / Debate Judge / Expert Mesh / Swarm / Hierarchy」当成六个独立编排器各写一遍。那样既不可维护，也无法证明「切换」是廉价的。

正确抽象：**同一套协作底座 + 一层可插拔 `EnginePolicy`**。`EnginePolicy` 只回答三个问题：

| 问题 | 字段 | 说明 |
|------|------|------|
| 每轮谁发言 | `schedule(input) → Round[]` | 把同一组「立场池」排成不同的轮次结构（串行链 / 并行发散 / 对抗多轮） |
| 如何收敛 | `convergenceMechanism` | 终裁签字 / 主持人归并 / 裁判裁决 |
| 谁有终裁权 | `input.authority` + 终裁轮 | 哪个角色签字、签字是否升级给人 |

切换引擎 = **换 policy + 重跑同一个 `runSession` 状态机**。状态机本身、共识闸、`ConvergenceResult` 契约都不变。

> 原型已落地这一抽象：`packages/prototypes/atelier/src/engine.ts` 里 `runSession` 是共享状态机，三个 policy（`expertHierarchy` / `roundtable` / `debateJudge`）只提供 `schedule`。同一个 `COLLAB_INPUTS['t-data']` 立场池喂给不同 policy，产出可见不同的轮次结构——这证明了「切换是廉价的、底座是共享的」这一架构判断成立。

---

## 2. 落地锚点：每个机制对应的真实 Go 代码

下表是这份文档的核心。左列是引擎需要的能力，中列是**已经存在的真实 Go 代码**，右列是缺口。

| 引擎所需能力 | 已有真实代码（复用） | 缺口（需新写） |
|--------------|---------------------|----------------|
| **单 Agent 一个回合**（prompt 组装 → provider 调用 → model→tool→model 执行循环 → 记忆抽取 → trace 落库） | [`turn_service.go`](../../../../apps/station/app/subserver/agent/service/turn_service.go) 的 `ExecuteTurn`（11 步）+ `processToolCalls`（model→tool→model 循环，硬上限 `maxToolIterations=25`）+ `providerCallWithRetry`（凭证轮换 + 错误分类恢复） | 无——这是 EnginePolicy 里「每个 turn」直接映射的执行单元，已可用 |
| **一轮里多个角色并行发言**（Roundtable 全员提案、Debate 正反同时立论、Swarm/Mesh 并行） | [`delegation_service.go`](../../../../apps/station/app/subserver/agent/service/delegation_service.go) 的 `Execute`（信号量 `MaxConcurrentChildren=3` 有界并发 + 每任务超时 5min + panic 恢复 + 结果归集；`executor` 回调注入解耦） | 无——这是「一轮扇出 N 个发言」的执行骨架，已可用 |
| **子任务工具裁剪 / 递归深度**（防止子 Agent 越权、防止无限递归） | [`delegation.go`](../../../../apps/station/app/subserver/agent/domain/delegation.go) 的 `MaxDelegationDepth=2`、`DelegateBlockedTools`、`ComputeChildToolset` | 无——已可用 |
| **EnginePolicy 抽象本身**（schedule / convergenceMechanism / authority） | — | **缺**：`EngineType` 枚举、`EnginePolicy` 接口、`schedule` 实现 |
| **CollaborationSession 状态机**（gathering → converging → reached / awaiting_human） | — | **缺**：`CollaborationSession` / `CollaborationTask` 实体 + 状态流转 |
| **共识收敛闸**（authority_signoff ∧ 带证据未决反对=0） | — | **缺**：`Consensus` / `Objection` / `signoff` 判定逻辑 |
| **九角色权力结构**（GoalOwner 终裁、Risk 硬否决、Verifier 验收否决须带证据） | — | **缺**：`AgentRole` 枚举 + 权力约束校验 |

### 2.1 缺口已用全仓 grep 核实

以下标识符在 Station 的 Go 代码里**一行都没有**（除 `skill_service.go` 一处与 `authority` 无关的命中）：

```
EngineType / CollaborationSession / CollaborationTask / AgentRole /
EnginePolicy / Consensus / Objection / signoff / Verifier / authority
```

结论：**多引擎编排目前 100% 停留在「文档 + 原型下拉框名字」，Station 没有任何实现。** 这不是「快做完了」，是「还没开始写 Go」。这份诚实结论比任何乐观措辞都重要。

---

## 3. 第一批三引擎：为什么是这三个

第一批选 **Expert Hierarchy / Roundtable / Debate Judge**，因为它们覆盖**三种本质不同的收敛机制**——把这三种打通，第二批三个引擎都只是它们的变体。

| 引擎 | 调度结构 | 收敛机制 | 复用的真实代码 | 第一批新增缺口 |
|------|---------|---------|---------------|----------------|
| **Expert Hierarchy（默认）** | 专家串行链（serial） | 终裁签字 + 无未决反对 | `turn_service.go` 串行多回合 | 终裁签字闸 + 共识判定 |
| **Roundtable 圆桌** | 发散并行（parallel，全员同时提案） | 主持人（Supervisor）归并 | `delegation_service.go` 有界并发扇出 | 主持人归并步骤 |
| **Debate Judge 辩论裁决** | 正/反对抗多轮（立论 → 交叉反驳） | 裁判（Verifier）裁决 | `delegation_service.go` 并行发言 + `turn_service.go` 多轮 | Judge 裁决 + 对抗轮编排 |

第二批（设计已就绪、原型未做 policy）：

- **Expert Mesh 专家网** = Roundtable 的「能力互补并行 + 聚合器合并」变体。
- **Swarm 蜂群** = Roundtable 的「海量同构并行 + 结果归约 + 多数」变体（需把 `MaxConcurrentChildren` 提级 + 分批）。
- **Hierarchy 层级（edict）** = Expert Hierarchy 的「强秩序 + 上级签字下令」变体。

---

## 4. 共识收敛闸（design.md §4.1，原型已实现 TS 版）

这是「不是能聊天就完了」里最难、也最容易被角色名堆叠掩盖的一环。判定规则必须显式、二值、可机器执行：

```
reached  ⟺  authority_signoff == true  ∧  带证据的未决反对数 == 0
否则        → awaiting_human（升级给人）
```

反附和（anti-echo）约束：

- objection 必须带 `evidenceRef` 才计入「未决反对」；无证据 objection 降级为「疑虑」，不阻断。
- 一个 counter 解决一个带证据的 objection。
- escalating 的 signoff **不算** authority 批准（防止用「我签了但其实升级了」蒙混）。

> 原型 `engine.ts` 的 `runSession` 已实现这套闸：`evidenceObjections - counters` 得到 `pendingObjections`，`authoritySignoff = signoffTurn 存在且 !escalates`，`reached = authoritySignoff && pendingObjections === 0`。`engineTrace.tsx` 把无证据 objection 显式渲染为「降级为疑虑」。

---

## 5. 落地三层判断（诚实分级）

| 层 | 内容 | 可落地性判断 |
|----|------|-------------|
| **第一层：多 Agent 并发执行** | 一轮扇出 N 个角色发言、子任务并发、工具裁剪、超时/panic 恢复 | **已能落地**——`delegation_service.go` + `turn_service.go` 已是生产级实现，原型直接锚定 |
| **第二层：引擎抽象与切换** | EnginePolicy 接口 + schedule + runSession 状态机 + 三 policy | **纯工程，可控**——原型已用 TS 跑通同构逻辑，翻译成 Go 是确定性工作，无未知风险 |
| **第三层：共识收敛质量** | 收敛闸规则写得出，但「真实 LLM 产出的 objection 是否带得出有效证据、counter 是否真能解决」 | **规则可落地，质量须接真实 LLM 才知**——原型证明不了这一层，必须做垂直切片接真实 provider 验证 |

---

## 6. 原型能证明什么 / 证明不了什么

**原型能证明（已做到）：**

- 产品形态、交互、信息架构（Atelier 对话流 + 折叠协商 + 升级决策卡；Desktop 管理面）。
- 「多引擎抽象是共享底座 + 可插拔 policy」这一架构判断成立——切换引擎确实重跑同一状态机、产出可见不同结构。
- 共识闸的判定逻辑能写成显式、二值、可执行的规则。

**原型证明不了（不假装）：**

- 思考链 / 工具执行 / 真实执行链的端到端正确性——这要接 `turn_service.go` 真实跑。
- 记忆抽取与召回质量。
- 共识收敛在真实 LLM 输出下的**质量**（证据是否有效、反对是否真被解决）。

> 承诺：不拿好看的 mock 假装证明后端可落地性。下一步若要证明第三层，必须做「垂直切片」——用三引擎之一接真实 provider 跑一个真实任务，而不是扩大 mock。

---

## 7. 建议的落地顺序（接真实 Go）

1. 定义 `AgentRole` / `EngineType` 枚举 + `CollaborationSession` / `CollaborationTask` 实体（data-model.md §1.4 已有 schema）。
2. 写 `EnginePolicy` 接口 + `runSession` 状态机（直接翻译原型 `engine.ts`）。
3. 落 `Expert Hierarchy` 一个 policy，`schedule` 复用 `turn_service.go` 串行多回合。
4. 接共识闸（design.md §4.1），跑通 `reached / awaiting_human`。
5. **垂直切片验证**：用真实 provider 跑一个真实任务，验证第三层质量。
6. 加 `Roundtable`（复用 `delegation_service.go` 并发扇出）+ `Debate Judge`。
7. 第二批三引擎作为前三种收敛机制的变体扩展。

每一步都要端到端可用、可验收，而非「先搭框架」。
