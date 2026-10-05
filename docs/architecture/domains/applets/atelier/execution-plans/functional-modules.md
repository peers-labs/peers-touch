# Atelier 功能模块

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-20 | **Updated**: 2026-07-05
> **Owner**: Peers-Touch Agent Team

---

> **Boundary update (2026-07-02)**: 本文是早期功能拆解，仍使用“多 Agent 协商引擎 / Atelier 新建”等说法。当前落地纪律是：Atelier applet 不自建协作引擎；M1-M10 中涉及编排、共识、Provider、Gate、Artifact 生产、Trace、Checkpoint、Resume 的能力归 Station / Agent orchestration，Atelier 负责 applet 视图、projection runtime、human-in-loop 交互和 capability 回写。

## 0. 这份文档回答什么

> 「Atelier 这个个人 Agent 工作台，用户拿到的是什么样子？有哪些功能模块、每个怎么做？」

### 0.1 一条主轴：多 Agent 协商引擎

Atelier 的灵魂**不是**「又一个任务调度客户端」，而是把 **Station / Agent orchestration 的多 Agent 协商协作过程** 变成个人可理解、可干预、可验收的工作台投影。一群分工明确的 Agent（六引擎 + 九角色 + 共识收敛）如何拆解、并行推进、带证据验收、安全升级，属于后端 orchestration 真源；Atelier applet 负责把这些状态投影到对话流、任务列表、决策卡、Artifact/Gate 视图里。

### 0.2 三类能力，划清边界

| 类别 | 含义 | 处理方式 |
|------|------|---------|
| **A. 框架既有，复用** | 三端联动、跨端同步、定时任务调度——peers-touch 框架天然具备 | **复用，不为 Atelier 重建基础能力** |
| **B. Station / Agent orchestration 新建，Atelier 投影** | 多 Agent 协商引擎、协作共识、可判定验收、安全硬闸、长项目持续推进、记忆自进化 | **后端真源 + Atelier 工作台投影**，本文档从用户功能视角描述 |
| **C. 不做** | 云端智能体（Cloud Agent） | **明确不做**；执行走本地/沙箱 |

### 0.3 Atelier 本身是一个 Applet（落地前提）

**Atelier 不是独立宿主程序，它本身就是一个 applet**，运行在框架的 [applet-runtime](../../../../platform/applet-runtime/README.md) 上。这是「复用框架、不自建基础设施」原则的直接延伸：

- **UI 用 ReactLynx / Lynx 元素**（不用 React DOM / iframe）：Desktop 走 Lynx for Web `<lynx-view>`，Mobile 走原生 `LynxView`，**一套源码三端运行**——当前落地形态是 controlled single-column projection surface，而不是在 applet 内另建浏览器或三栏宿主。
- **生命周期由 Host 管**：Atelier 不自建浏览器上下文、不自持敏感能力。
- **能力全走 Host Capability Gateway**：Storage / Network / Config / Notification 等统一经 Gateway，**Atelier 的多端同步(M11)、定时(M12)、输入(M13)、产物预览(M14) 都是经 Gateway / SDK 调框架能力，不是直连**。
- **权限 Manifest 声明、默认拒绝**：Atelier 要在 Manifest 里声明它用到的能力（含调 Agent/协作引擎/Provider 的能力），Host 按 applet id + session + method 强校验。
- **遵循 applet-contract**：Atelier 作为一个复杂 applet 打包分发，符合 [complex-applet-acceptance](../../../../platform/applet-runtime/complex-applet-acceptance.md)（skills / agent-AI / streaming / tasks / service-binding / audit）的门槛。

> 含义：本文档里 M1–M10 涉及的编排 / 共识 / Gate / Artifact / Resume 能力是 **Station / Agent orchestration 后端真源 + Atelier applet 投影与交互**；M11–M14 是 **通过 SDK/Gateway 调宿主能力**。Atelier 不在 applet 内另建平行编排引擎，也不在 applet 边界外另开后门。

---

## 1. 产品形态：用户拿到的是一个什么东西

> 先回答「用户收到的是什么样子」，再讲模块。否则模块清单会显得散——其实它们都落在下面**一个界面的几块固定区域**里。

### 1.1 一句话

用户拿到的是 **peers-touch 里的一个 applet——「Atelier 项目工作台」**：从宿主里打开它，看到的是 SOLO 式**对话优先**的 controlled single-column projection surface。任务 organizer、projection stream、Project Health / TaskGraph / Context / Artifacts / Gates 等只读投影 section 在同一纵向工作台里堆叠；多 Agent 协商内联折叠在对话流里，Artifact / Gate / Project Health 等只展示 Station 投影或 Host-owned intent，不在 Applet 内执行 provider/run/shell。

### 1.2 主界面线框（ReactLynx 视图，一套源码 Desktop/Mobile 同构，当前为单栏投影面）

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Atelier   [预算 ▓▓▓░░ $2.1/$5]   [🔔 1 条待你决策]        [+ 新目标]      │ ← 全局条
├──────────────────────────────────────────────────────────────────────────┤
│ Task organizer：项目/任务 folders + flat list + lifecycle sections        │
├──────────────────────────────────────────────────────────────────────────┤
│ Projection stream：用户输入、Agent 回复、协商折叠行、Decision、Artifact 卡 │
├──────────────────────────────────────────────────────────────────────────┤
│ Project Health：completion / blockers / risks / milestones / policies    │
├──────────────────────────────────────────────────────────────────────────┤
│ TaskGraph：root ids / edges / nodes / evidence refs / integrator policy   │
├──────────────────────────────────────────────────────────────────────────┤
│ Context / Artifacts / Gates：只读 Station projection + Host-owned intents │
└──────────────────────────────────────────────────────────────────────────┘
```

> **形态校准（见 [prototype/](../prototype/)）**：当前 official applet 与 browser prototype 的实现口径均是 SOLO 式**对话优先**形态：task organizer + projection stream + Project Health / TaskGraph / Context / Artifacts / Gates 等 read-only projection sections 以 controlled single-column 堆叠；多 Agent 协商**内联折叠进对话流**而非独立右侧栏。Browser prototype 的历史 left rail / centre stream / right panel 探索壳已被 P4-278 收敛，不再作为当前产品形态。

### 1.2bis 左栏任务管理 = 可插拔 plugin

「怎么组织我的任务」不写死，而是做成**可插拔 plugin**：同一份任务数据，不同用户选不同 plugin 换组织 / 展示方式（传统看板 / DAG / Kanban 简化版 / 简单平铺）。

- **壳子持有数据，plugin 只渲染 + 委派**：Atelier 壳定义 `TaskHost`（`select / setStatus / purge / newTask`），plugin 实现 `TaskPlugin.render(host)`。新增看板 / DAG 只实现一个 plugin，数据模型、对话流、生命周期状态机都不动。这是 §0.3「Atelier 是 applet、能力走 Gateway」原则的延伸——管理方式作为 applet 内的可换视图层。
- **默认 plugin = 项目文件夹分组（对齐 SOLO）**：任务按所属项目 / 仓库文件夹（`Task.project`）分组，每组可折叠、各带「+」新建，对齐 SOLO 的 "Your Task List"。简单平铺降为可选 plugin。
- **任务完整生命周期**：`active → archived → deleted`。进行中可归档 / 删除；归档可恢复 / 删除；删除进回收站可还原或彻底删除（purge）。归档 / 回收站作为分组下方的可折叠段。
- 简单平铺、看板 / DAG 等作为可选 plugin（看板 / DAG 计划中）。

接口与 plugin 已在原型落地：`src/types.ts`（`TaskHost`/`TaskPlugin`）、`src/plugins.tsx`（默认 folders 项目分组 + 简单平铺 + 看板/DAG 占位）。

### 1.2ter Browser prototype SOLO 外壳收敛（synced with official single-column product shape）

可运行 browser prototype 仍以 SOLO 作为外壳人体工学基准线（Atelier 在其上叠协商 / 决策 / 预算的灵魂），但 P4-278 已把默认产品形态收敛为和 official Lynx applet 一致的 controlled single-column projection shell：

- **Header / action rail**：任务标题、project/status metadata、预算条、New task、Open in IDE Host intent、Work / Code / Design intent preset 与 Host-intent-only disclosure 处于 content rail 顶部。
- **Task organizer section**：原左栏任务组织能力保留为单列 section，包含 plugin 切换器、项目文件夹分组与 lifecycle sections。
- **Provider capability section**：Skills / provider capabilities 是只读 Station descriptors，点击只插入 slash command，不执行 provider。
- **Projection stream**：轻 markdown（`code` / **粗体** / 列表）、完成回复带 Completed 标记 + 反馈条（赞/踩/复制/重新生成）、"N files changed +X -Y" diff 卡（可展开文件列表）、图片附件 chip、Artifact 卡；composer 上方 **Artifacts 托盘**（markdown / web / image / diff 卡片）。
- **Workspace projection / Artifact preview sections**：只读 Station Project Health projection（completion / blockers / residual risks / milestones / policy / defects）+ TaskGraph projection（无 project projection 时回退 legacy Todo）+ Context 纵向堆叠；打开产物时在 content rail 内展示 metadata-only artifact preview + Host safe text fetch / Host sandbox preview intent。Applet 不验收、不豁免、不修改 project state，也不调度、不执行、不 replan 节点。
- **富输入框**：斜杠命令 / 图片附件 / run target selector / 发送；语音输入暂不展示。
- **已知差异 / 待补**：Work/Code/Design 已作为 `intentPreset` 声明式默认策略提交并由 Station 投影 `provider_strategy_preset / gate_plan_preset` metadata，但仍不切真实 IDE 模式；Terminal disclosure 仍是 prototype-only placeholder，明确未接 shell/execute capability；Console Logs 为 mock 日志流，真实 Host runtime stream 与完整 Host+Station+applet E2E 未做。

### 1.3 Projection stream 状态片段（用户真正「看到的样子」）

| 阶段 | 用户看到的面孔 | 关键交互 | 背后模块 |
|------|--------------|---------|---------|
| **① 提目标后** | **目标确认卡**：它复述的目标 / 非目标 / 验收清单（每条标 🟢自动可判 或 🟡需你签） | 「确认」或「改一改」按钮 | M5 规划、M6 验收分级、M13 输入 |
| **② 确认后** | **计划图**：里程碑→任务的 DAG，节点显状态色；点节点看「为什么这么拆」 | 看 / 微调 / 「开始」 | M5 规划、M1 引擎、M3 共识 |
| **③ 执行中** | **活动流**：任务卡像消息流一条条往下，每张卡显 调用了谁/日志/产出文件/Gate 红绿 | 基本只看；可展开某卡 | M8 执行、M9 Provider、M6 Gate |
| **④ 完成前** | **验收面**：🟢L0/L1 已自动通过的折叠；🟡L2 待你签的高亮置顶，附证据 | 逐条签字 / 打回 | M6 验收、M7 升级、M10 记忆 |

### 1.4 协商与产物：内联折叠 + section 投影（Atelier 的独有体验）

这是 Atelier 区别于「单 Agent 黑箱」的关键 UI——**协作过程不是黑箱，是一条可读的时间线**。Official applet 与 browser prototype 都把协商折叠进 projection stream，把产物/TaskGraph/Project Health/Gates 放在纵向 sections：

- **协作过程 tab**：谁（角色）提了什么提案、谁带证据反对、谁签了字、为什么收敛/为什么升级。用户能「看懂这群 Agent 是怎么商量的」。（M1/M2/M3）
- **产物 tab**：所有 Artifact（diff/报告/数据）集中预览、下载，每条产物可回链到「是哪步、哪个 Agent 产的」。（M8/M9）

### 1.5 全局条：安全与打扰边界

- **预算条**：实时显示已花/上限，触顶熔断。（M7）
- **待你决策铃 🔔**：平时静默，只有「危险动作/超预算/L2 验收/目标冲突」才亮，点开是一张**结构化决策卡**（问题/各方证据/已花成本/选项/推荐/回滚影响）。（M7）

> 用户的体感闭环：**新目标 → 确认卡 → 计划图 →（关掉去睡觉）→ 回来看活动流和验收面 → 铃响才介入 → 收尾签经验。** 14 个模块都落在上面这几块固定 UI 里，不散。

---

## 2. 主轴模块：多 Agent 协商协作引擎（新建）

### M1 ｜协作引擎矩阵（六引擎）★核心

- **能力**：按问题性质选协作形态（发散/并行专精/冲突裁决/海量同构/强秩序），同一项目不同阶段可切换。
- **怎么做**：六引擎 + 默认 Expert Hierarchy；引擎写入 `CollaborationTask.engine`。Roundtable / Expert Mesh / Debate Judge / Swarm / Hierarchy / **Expert Hierarchy（默认：终裁签字 + 无未决反对）**。（`F-CL-01/03`）
- **复用框架**：复用框架 `multiagent` 子 Agent 注册/路由作运行底座；新增「协作引擎 + 共识」语义。
- **UI 落点**：右栏协作过程 tab；计划图节点的「为什么这么拆」。

### M2 ｜九角色权力结构★核心

- **能力**：每个 Agent 有明确职权与否决/上报关系，让协作不退化成群聊。
- **怎么做**：Goal Owner（唯一终裁签字）/ Architect / Planner / Risk&Policy（危险动作硬否决+强制升级，安全优先于目标）/ Supervisor（推进控制，无内容否决）/ Executor（零判断）/ Verifier（验收否决须带证据）+ Integrator + Historian。（`F-CL-02/09`、`F-MM-01`）
- **UI 落点**：右栏协作时间线里每条带角色标识。

### M3 ｜共识收敛机制★核心

- **能力**：判定「是否达成共识可推进」，且不被多 LLM 附和污染。
- **怎么做**：进入 `reached` 充要条件 = `authority_signoff == true` AND 无「带证据的未决反对」。赞成/反对都须带 `evidence_ref`，无证据反对降级为「疑虑」；Verifier 与 Executor 不同源；收敛失败带分歧快照升级。（`F-CL-04/05`、`F-CO-08`）
- **UI 落点**：协作 tab 的「反对(证据)/签字」标记；收敛失败 → 升级铃。

### M4 ｜长项目持续推进★核心

- **能力**：大项目长期自主推进——巡查停滞、跑偏重规划、断点恢复。
- **怎么做**：Supervisor Loop（停滞/偏离/死锁检测+推进入队）+ Replan（重规划子图，已 accepted 不丢）+ Resume（从最近 accepted 锚点恢复）。（`F-CL-07/08`、`F-CO-12/13`）
- **依赖框架**：由框架 EventBus/调度驱动。
- **UI 落点**：左栏项目持续推进、活动流自动更新（用户关掉再回来有进展）。

---

## 3. 支撑模块：让协作可工程化（新建）

### M5 ｜规划工作流（契约 / 里程碑 / 任务图）

- **能力**：复杂任务先经多角色**协商**产出规范文档组（契约/里程碑树/任务图/验收清单），确认后执行，状态随进度更新。
- **怎么做**：协商会话 → Project Contract + Milestone Tree + Task Graph + AcceptancePredicate；可编辑、版本化、留痕。（`F-PJ-01/02/03`、`F-CO-10/11`、`F-CL-06`）
- **借鉴 TRAE Work（仅表层）**：spec/tasks/checklist「先确认后执行」体验。本质不同：多角色共识产出 + checklist 是可判定谓词 + 可被重规划。
- **UI 落点**：中栏面孔①目标确认卡、②计划图。

### M6 ｜可判定验收闭环

- **能力**：完成不靠「人看着像完成」，靠可机器判定的分级验收。
- **怎么做**：VerifiabilityLevel(L0 二值/L1 规则/L2 主观) 作自动化总开关 + Gate 可阻断（block 失败触发 Fix Loop）+ 完成谓词。L0/L1 自动，L2 才人工汇聚签字。（`F-CO-10/11`、`F-GT-01~05`）
- **UI 落点**：中栏面孔④验收面（🟢自动折叠 / 🟡待签置顶）。

### M7 ｜安全与升级硬闸

- **能力**：危险/不可逆动作硬拦、成本/时间触顶熔断、该问才问且问得有信息量。
- **怎么做**：Policy 硬否决（不可被 Goal Owner 覆盖）+ Budget 熔断 + Escalation Guard（结构化升级载荷）。高危走 ActionProvider 绑 Risk 闸。（`F-FD-02/03`、`F-CL-10`、`F-HL-01/02`、`F-PR-04`）
- **UI 落点**：全局条预算条 + 待你决策铃 🔔 + 结构化决策卡。

### M8 ｜执行引擎（本地 / 沙箱，**不含云端**）

- **能力**：在隔离环境真实执行任务。**不做云端智能体。**
- **怎么做**：Executor 调 Provider 在本地 Workspace/Sandbox 发起 Run，回收 Artifact metadata / evidence index，确定性可重放，零判断权；rich preview runtime 仍由 Host sandbox capability 承担。（`F-CO-02/05/06`、`F-PR-05`、`F-CO-07a/07b`）
- **UI 落点**：中栏面孔③活动流任务卡 + 右栏产物 tab。

### M9 ｜Provider 接入（分领域）

- **能力**：多种外部工具/能力统一接入供 Executor 调用，按领域差异化。
- **怎么做**：顶层最小共性接口 + 子类型（CodingProvider/DataProvider/ActionProvider 高危单列），不预设通用接口。统一收口 MCP/Skill/集成。（`F-PR-01/06`、`F-FD-03`）
- **复用框架**：MCP/Skill/集成走框架既有接入层。
- **UI 落点**：活动流任务卡显「调用了谁」。

### M10 ｜记忆与自进化

- **能力**：沉淀成功范式/失败原因/规则，确认后入长期记忆，反哺规划与风控。
- **怎么做**：Historian 产 Memory Candidate → 两阶段确认（默认不自动写防污染）→ 失败记忆反哺 Planner/Risk。（`F-MM-01~03`）
- **复用框架**：底层记忆存储复用框架 Memory；新增两阶段确认+失败反哺。
- **UI 落点**：中栏面孔④收尾时的「经验候选，勾选确认」。

---

## 4. 复用框架既有能力（不为 Atelier 重建）

### M11 ｜多端调度与跨端同步（复用框架）

- **框架现状**：三端架构（`client/desktop` / `client/mobile` / `station`）+ 跨端同步已是基线能力。
- **Atelier 怎么用**：协作任务台账/状态/事件**走框架多端同步通道**，任意端下发/观察验收。**不自建三端联动**，只保证 Project/Task/CollaborationSession 状态可被同步。（`F-FD-04/05`、`F-UI-02`）
- **UI 落点**：Task organizer section 的项目列表多端一致。

### M12 ｜自动化定时任务（复用框架）

- **框架现状**：框架 `domain/cron` Scheduler（cron/间隔/一次性）。
- **Atelier 怎么用**：复用 cron **触发一个完整协作项目**；不自建调度器，只注册「定时触发 → 起协作会话」模板。（`F-CO-01`、`F-FD-01`）
- **UI 落点**：Task organizer / Automation projection section。

### M13 ｜多元输入与意图入口（复用框架 + 薄增量）

- **框架现状**：客户端已有多元输入（文字/语音/附件/Skill）。
- **Atelier 怎么用**：复用输入层，薄增量是输入后**强制走「意图→契约」**而非直接开干。（`F-UI-01`、`F-CL-01`、`F-PJ-01`）
- **UI 落点**：全局条「+ 新目标」入口。

### M14 ｜产物预览与验收 UI（复用框架 + 验收双路）

- **能力**：对话内实时看进度、预览成果、验收，不切工具。
- **怎么做**：复用框架产物/对话 UI；增量是验收分自动(L0/L1，见 M6)与人工(L2)双路；official 先落 metadata-only projection parity，rich renderer / Console Logs / attachment runtime 等 Host runtime/E2E 后补。（`F-CO-07a/07b`、`F-UI-02`）
- **UI 落点**：单列 content rail 内的 Artifacts tray / inline artifact preview section + stream 内验收面。
- **原型落地（见 [prototype/](../prototype/)）**：composer 上方 Artifacts 托盘 + 单列 content rail 内联产物预览 section，browser prototype 与 official 当前都不再从 projection 读取或渲染 `markdown/content/diff/url/src` raw artifact body/ref 字段；browser preview 统一展示 `ArtifactMetadataPreview`、Host safe text fetch 与 Host sandbox preview intent，并与 TaskGraph projection / legacy Todo + Context 同属 Workspace projection / Artifact preview 纵向 sections。official Lynx 单列 projection sections 优先展示只读 Station TaskGraph projection，紧凑列表最多展开前 5 个节点并显式显示剩余 projected node 数量，无 project projection 时才回退 Todo。源码 `src/preview.tsx`、数据契约 `src/types.ts` 的 `Artifact`/`ConsoleLog`。P2-04a / F-CO-07a 已收口为 metadata-only projection parity：Production official applet 只展示 `previewHint / bodyRef / bodyHash / bodySize / bodyKind / previewTarget` metadata；Artifacts 托盘和 Artifacts panel/section 在紧凑列表折叠 metadata projection 时会显示剩余 artifact 数量，Gates 面板在紧凑列表折叠 gate、check 或 artifact evidence ref 时也会显示剩余数量，避免静默隐藏投影证据；正文只经 `atelier.artifact.body.fetch` 的 safe text capability 获取，sandbox preview 只经 `atelier.artifact.preview.open` Host intent，且 `previewTarget` 仅接受 `mode=sandbox_manifest`、`sandboxRef=atelier-sandbox://...`、`bodyRef=artifact://...`；Desktop Host 已返回 `desktop_host/host_sandbox_manifest/rendered` opaque surface descriptor，并携带 `host_visual_renderer_surface` capability。P2-04b / F-CO-07b artifact body fetch controlled service gate 已补 + focused product-window safe body fetch 已补，Station `FetchArtifactBody` 只对 actor-owned task + canonical `artifact://.../body` + active safe text kind + matching hash 返回截断 safe text，product-window evidence 仅记录 metadata 且不含 raw `text`；artifact renderer controlled surface matrix，可为 `markdown/web/image/diff` 生成 Host-owned `host_sandbox_visual_surface` descriptor，并已扩展为 controlled surface/runtime evidence，四类 runtime 只返回 metadata-only evidence并禁用 scripts/network/external navigation/file access/patch apply，artifactRendererSurface contract `controlledEvidence.liveWebviewProven=false`，但不证明 live Desktop webview 真渲染；Host sandbox console capture controlled gate，可规范化 `host_sandbox_cdp` log/warn/error evidence，runtimeLogStream contract `controlledEvidence` 已补，但不证明真实 Run runtime stream；Host Storage attachment staging controlled gate 已补，可生成 `host-storage://...` opaque ref + mime/size/sha256 metadata，browser File API intake controlled gate 已补，可证明 controlled browser attachment metadata 转 Host-owned opaque ref 且不暴露 raw path/url/base64/body/bytes/write intent，hostStorageAttachment contract `controlledEvidence` 已补并校验 readback、拒绝 raw path/url/base64/body/bytes/write intent，但不证明真实 Desktop Host Storage runtime、真实 native file picker 或真实 upload flow；已补 Station DirectRun input_snapshot attachment shape guard，只接受 Host-owned opaque ref + metadata 并拒绝 raw path/url/base64/body/write intent；仍 pending Host runtime/E2E：web iframe/image/html/diff renderer、Console Logs 真实 Run runtime stream 与 attachment upload / Host Storage runtime，具体 live webview 渲染仍未证明；Applet 不接 renderer、不读 raw body、不上传附件、不执行 provider/run/shell，official 与 browser prototype 都不 iframe、不加载图片、不渲染 html。

---

## 5. 明确不做

| 不做项 | 原因 |
|--------|------|
| **云端智能体（Cloud Agent）** | 无此诉求。执行统一走本地/沙箱（M8）。 |
| **自建三端联动 / 跨端同步基础设施** | 框架天然具备，复用即可（M11）。 |
| **自建定时调度器** | 框架 `cron` 已提供，复用即可（M12）。 |
| **自建 UI 宿主 / 浏览器上下文 / iframe runtime** | Atelier 是 applet，跑在框架 applet-runtime 上，UI 用 ReactLynx，能力走 Host Gateway（§0.3）。 |

---

## 6. 借鉴 TRAE Work 的部分（仅表层体验，非主轴）

| TRAE Work 体验 | Atelier 借鉴到哪 | 但本质不同在 |
|---------------|-----------------|-------------|
| Spec & Plan「先确认后执行、状态随进度更新」 | M5 + 中栏面孔①② | 多角色共识产出 + checklist 是可判定谓词 |
| 产物对话内预览验收 | M14 + 右栏产物 tab | L0/L1 自动 + L2 人工双路 |
| Worktree 并行隔离体验 | M8/M9 沙箱 | Integrator 角色保证多 Agent 产物全局一致 |

> 不借鉴：TRAE Work 的「单/双智能体执行」范式（Atelier 用多 Agent 协商引擎替代）与云端智能体。

---

## 7. 第一批必须有的功能块

让 Atelier 跑通「多 Agent 协商完成一个真实项目」的最小闭环：

```
主轴（必须先有）：
  M1 协作引擎（先 Expert Hierarchy 单引擎）
  M2 九角色（先核心 5 角色：Goal Owner/Planner/Executor/Verifier/Risk）
  M3 共识收敛（终裁签字 + 带证据反对）
  M5 规划工作流（出契约/任务图给我确认）
  M6 可判定验收（先 L0 闭环）
  M7 安全升级硬闸（危险/超预算才找我）
  M8 执行引擎（本地沙箱真实开干）

复用框架（不另起炉灶）：
  M11 多端同步 / M12 定时触发 / M13 多元输入 / M14 验收 UI

最小 UI（先把 controlled single-column projection sections 做出来）：
  task organizer + projection stream 活动流/验收片段、全局预算条+决策铃、Project Health / TaskGraph / Context / Artifacts / Gates 只读 section
```

对应 [roadmap.md](./roadmap.md) 检查点 A。
**第二批**：M1 扩多引擎、M2 补全九角色、M4 持续推进、M6 补 L1/L2、M10 记忆自进化（UI 补面孔①②计划图）。
**第三批**：M9 扩多领域 Provider、高危 ActionProvider、跨领域上下文。

---

## 8. 与其他文档的关系

- 本文档讲「产品形态 + 有哪些功能模块 + 主轴 + 哪些复用框架」；
- **可跑可点的原型**（用自有前端框架 ReactLynx/applet-sdk 把 §1 的 conversation-first projection surface 做出来，替代靠线框/嘴对齐）见 [prototype/README.md](../prototype/README.md)，源码在 `packages/prototypes/desktop/applets/atelier/`；
- **Atelier 作为 applet 的运行时契约**（UI/SDK/Gateway/Manifest/生命周期）见 [applet-runtime](../../../../platform/applet-runtime/README.md)；
- 协作引擎/角色/机制设计原理见 [design.md](../design.md)（§3–§4）；
- 用户端到端体验串联见 [user-view.md](./user-view.md)（U1–U7 流程）；
- 数据契约见 [data-model.md](../data-model.md)；搭建顺序见 [roadmap.md](./roadmap.md)；模块↔底座对齐见 [feature-matrix.md](./feature-matrix.md)。

---

## Sources

- 内部设计（主轴来源）：[design.md](../design.md) §3–§4
- 框架既有能力参考：仓库 `client/desktop` `client/mobile` `station`（三端）、`domain/cron`（定时）、`domain/multiagent`（子 Agent 底座）
- 表层体验借鉴：[TRAE Work 概述](https://docs.trae.cn/solo/what-is-trae-solo)、[Spec & Plan](https://docs.trae.cn/solo/spec-and-plan)
