# 持续任务工作台：执行前后效果对比

> **Plan**: `TW-20261102`
> **用途**: 实施前确认预期效果，实施后只按当前源码证据（聚焦检查 + exact-source Native Journey）回填。
> **当前阶段**: 计划冻结；TW-O01–TW-O12 全部 `UNPROVEN`。原型点击、旧 commit、命令退出码与模型自述均不得回填 PASS。

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "TW-20261102",
  "plannedSectionDigest": "sha256:c5d068e7ef0a5c1cca6a503641e4ca95969cc82458f1fe8b9e15d6f56da4640e",
  "criteria": [
    { "id": "TW-O01", "dimension": "user-experience", "title": "用户在一个任务里持续对话、看过程、处理介入，不管理多个会话", "taskIds": ["TW-D1", "TW-D2"], "gateIds": [] },
    { "id": "TW-O02", "dimension": "product-capability", "title": "输入接收、排队、执行、终态是不同事实；重复发送与断线恢复不重复执行", "taskIds": ["TW-D1", "TW-D2"], "gateIds": [] },
    { "id": "TW-O03", "dimension": "architecture", "title": "TaskRun、canonical Conversation、Turn、TaskEvent 只有一条 Station 业务真源", "taskIds": ["TW-D1"], "gateIds": [] },
    { "id": "TW-O04", "dimension": "user-experience", "title": "资料、成果、反馈、检查和接受围绕同一不可变版本闭环", "taskIds": ["TW-D3"], "gateIds": [] },
    { "id": "TW-O05", "dimension": "product-capability", "title": "文件修改、有界命令和 Diff 有真实字节、退出码与围栏回执", "taskIds": ["TW-D4"], "gateIds": [] },
    { "id": "TW-O06", "dimension": "product-capability", "title": "长进程由设备持有，Terminal 标签只是 viewer", "taskIds": ["TW-D5"], "gateIds": [] },
    { "id": "TW-O07", "dimension": "product-capability", "title": "Browser 真实观察和操作页面，人工接管与归还语义可靠", "taskIds": ["TW-D6"], "gateIds": [] },
    { "id": "TW-O08", "dimension": "product-capability", "title": "Profile/Memory 与插件授权、readiness 真实影响下一轮，不显示假可用", "taskIds": ["TW-D7"], "gateIds": [] },
    { "id": "TW-O09", "dimension": "architecture", "title": "复杂配置留在 Dashboard/Station，Desktop 只做选择与使用，无双 Provider registry", "taskIds": ["TW-D1", "TW-D7"], "gateIds": [] },
    { "id": "TW-O10", "dimension": "quality-operations", "title": "每天都是可运行纵向切片，未完成能力 fail-closed", "taskIds": ["TW-D1", "TW-D2", "TW-D3", "TW-D4", "TW-D5", "TW-D6", "TW-D7"], "gateIds": [] },
    { "id": "TW-O11", "dimension": "technology", "title": "proto-first，复用 TurnAdmission、TurnQueue、TaskEvent、CapabilityOperation 并补齐缺口", "taskIds": ["TW-D1", "TW-D2", "TW-D3", "TW-D4", "TW-D5", "TW-D6", "TW-D7"], "gateIds": [] },
    { "id": "TW-O12", "dimension": "quality-operations", "title": "两条端到端旅程 FUNCTIONAL_PASS：研究/文档、代码/服务/Browser 验证", "taskIds": ["TW-D7"], "gateIds": [] }
  ]
}
```

## Planned Outcome Comparison

### TW-O01：一个任务就是一条连续工作线

- Before：用户主要管理 Conversation/Topic；任务与会话的关系靠 ChatTaskService 隐式唯一约束表达，产品层仍可能把执行器内部 thread/subagent 误解为用户可切换会话。
- Target：TaskRun 是产品任务根；一个任务只有一个 canonical 用户可见 Conversation，Conversation 唯一归属 task，TaskRun 引用 canonical conversation；追问、补资料、改稿、复测都是新 Turn；宿主 thread/subagent 仅内部运行时绑定。
- Expected effect：用户只围绕目标工作，不需判断“开哪个会话”；任务重开能回到目标、资料、草稿、成果与当前介入点。
- Non-claim：内部多 Agent/subagent 不删除，但不成为用户导航层级；不提供“续接新会话”。

### TW-O02：运行中输入和控制有确定语义

- Before：master 已有 FIFO queue、稳定 turn id 与活动轮 admission；但普通 Direct Model 在 provider 请求发出后无安全 live steer，UI 必须避免把队列说成实时补充。
- Target：空闲输入启动 Turn；Station 尚未发出不可逆 provider/tool 请求前可 amendment 到当前 Turn，发出后进入下一轮队列；delivery 回执区分 started/amended/queued/rejected；Stop 暂停后续队列并回读真实终态。
- Expected effect：每次发送都有 receipt，用户知道是当前轮补充还是下一轮执行；Stop、取消、审批过期与断线恢复不混淆。
- Non-claim：不对已发出的普通模型 HTTP 请求做伪注入；external runtime 只有在能力被证明时才广告 steer。

### TW-O03：事件历史可重放，实时片段不污染历史

- Before：turn stream、task event outbox 与 Desktop recovery store 并存，业务 UI 容易依赖瞬时 stream event 或本地 optimistic 状态重建历史。
- Target：TaskEvent / Turn terminal event 是 durable replay 真源；text delta、progress 等只走 live；客户端先以 watermark/cursor replay 再订阅 live，并做身份去重与缺口核对。
- Expected effect：刷新、切任务、Desktop 重启后状态一致；断线期间不丢终态，也不重复消息或回退状态。
- Non-claim：SSE 不保证 exactly-once；精确一次由持久事件身份、幂等 admission 与 replay 对账共同保证。

### TW-O04：成果是不可变资源，不是消息文本提取

- Before：TurnArtifact 已能表达文件定位，但文档/正文成果的逻辑版本、人工编辑、反馈、检查与接受尚未统一；Portal 仍有从消息解析成果的消费者。
- Target：逻辑 Artifact 有不可变版本序列；新字节产生新版本，消息只引用 artifact/version；资料附件、ContextLedger、TurnAttribution 记录实际采用版本；reader、Search、通知、卡片、导出打开同一版本。
- Expected effect：用户看到资料如何变成成果、每次反馈改了什么、检查对应哪一版；旧版可回看但不被覆盖。
- Non-claim：用户接受不替代必需机器检查；机器检查通过也不替代用户接受；不做协同编辑。

### TW-O05：文件与命令是真实授权操作

- Before：已有 fenced client capability、filesystem/shell executor 与 receipt ledger，但持续任务工作区尚未把操作、Diff、检查与成果版本串成用户旅程；一次性命令与持久终端容易被混为一谈。
- Target：read/write/edit/shell 全部经 CapabilityOperation、lease、receipt、resource grant；命令有 cwd、有界输出、exit code、失败原因与幂等恢复；Diff 基于真实 before/after 字节并关联 artifact/version；重试未知副作用前先 inspect。
- Expected effect：Agent 可在授权工作根完成修改、运行检查、按失败复测；用户看到的是真实结果而不是“命令完成”标签。
- Non-claim：exit 0 不等于业务任务完成；不开放无边界 shell、出根写或任意进程托管。

### TW-O06：Terminal 是设备资源，不是聊天标签

- Before：有一次性 shell capability，没有可 attach/stdin/resize/kill 的持久 TerminalSession。
- Target：Rust worker 持有进程与有界输出；Desktop 订阅 session，支持 create/attach/write/resize/kill/remove、pid/status/exit code/output cursor；viewer 关闭只取消订阅；服务 URL 可发送到 Preview/Browser 资源。
- Expected effect：Agent 可启动服务，用户切走再回来看到同一进程；从服务日志跳到 Browser/Preview。
- Non-claim：第一周不承诺跨 app/设备重启 PTY daemon；worker 死亡后未证明存活一律 unknown/dead，不冒充 running。

### TW-O07：Browser Use 是设备浏览器能力，不是粘贴网页正文

- Before：生产 BrowserSession 不存在；Playwright 设施主要用于验收，不构成产品 Browser Use；原型的“人工打开网页回传正文”是交互占位。
- Target：BrowserSession 绑定 task/turn/device/account/control lease 与显式 tab；snapshot ref 绑定 tab+generation，导航后失效；v1 广告 open/list/close tab、navigate、snapshot/observe、click/fill/submit、reload/back/forward、screenshot、接管/归还；页面内容一律 untrusted data。
- Expected effect：Agent 自己看页面、操作页面；用户可临时接管，归还后 Agent 重新观察，不沿用失效 ref；断连后先 inspect 不重复提交。
- Non-claim：HTML artifact 预览不等于外部 Browser；Computer Use 不等于 Browser Use；network profiling、下载管理器、复杂多 frame 未验证不广告。

### TW-O08：Profile/Memory/插件真实影响下一轮

- Before：Memory、Skill、MCP、capability binding/readiness 底座已大量存在，但安装、enabled、readiness、真实调用在产品层容易被混淆；检索失败曾有全量快照兜底。
- Target：每个 Turn 冻结规则、Memory、Skill、capability 版本并在 TurnAttribution 可回看；记忆候选需确认，纠错/删除/撤权影响未来 Turn；插件必须真实调用成功才 ready，撤权即时阻断新 admission；宿主自有 Memory 关闭。
- Expected effect：第二任务能验证记忆召回；撤权后新操作被阻断；无关记忆不注入；配置变化对下一轮真实生效。
- Non-claim：运行中的 Turn 不被新规则静默改写；Memory consolidation 与持久向量化本期不做。

### TW-O09：复杂配置留在 Dashboard/Station

- Before：ACCEPTED provider-runtime-strategy 已规定 Station 拥有 Provider 注册、凭证、CLI、模型目录与 readiness；近期 master 大改 profile/storage/provider 面，Desktop 仍可能滋生本地选择/推断逻辑。
- Target：Desktop 只显示授权配置、全局默认/当前选择（完整 provider_id+model_id）、readiness 与恢复深链；Rust 是类型化传输适配，不执行 Provider CLI、不解析 CLI 输出、不维护第二 registry、不从裸 model id 推断 Provider。
- Expected effect：配置一处管理、Desktop 直接使用；换账号/Station 后选择与缓存按授权隔离。
- Non-claim：本机设备能力（Terminal/Browser worker）与 Provider CLI 执行是两回事；Desktop 不承担复杂安装与连接编排。

### TW-O10：每日可运行、周末有完整旅程

- Before：原型可演示但无生产执行；按前端/后端分阶段会在一周后只剩 UI 或只有 API。
- Target：每天一个纵向切片，含 proto/Station/Rust/UI/失败恢复/测试/旧路径删除；当日构建可运行；能力不足时入口关闭（fail-closed）。
- Expected effect：一周末得到可手工使用的桌面持续任务 Agent，研究/文档闭环与代码/服务/浏览器验证闭环均可走通。
- Non-claim：正式 Acceptance、MR、生产部署、Computer Use、多 Agent、跨设备 PTY、公开发布不在一周虚假完成口径内。

### TW-O11：新合同 proto-first 并复用既有设施

- Before：主链底座已存在（Conversation/AgentTurn/TurnAttempt/TurnAdmission/TurnQueueEntry/ContextLedger、ChatTaskService、TaskEventWriter、EventStreamService、CapabilityOperation、TurnArtifact、TaskArtifact/Blob、desktop executor worker）。
- Target：canonical 归属、任务目标/标签、terminal/live 事件、artifact 版本、Terminal/Browser 资源等新语义先改 model/domain proto 并经 ./model/build.sh 生成；复用既有 admission FIFO、outbox、lease/fencing、OSS blob 与能力授权，不造并行 DTO/注册表。
- Expected effect：Desktop Rust/React 与 Station 共享生成合同；迁移与调度复用既有设施；无双写、无手写并行类型。
- Non-claim：不重写 provider/turn 内核；不借机构造未触及的 Growth/协作面。

### TW-O12：两条端到端旅程 FUNCTIONAL_PASS，假面零遗留

- Before：单模块门禁可全绿而整体故事断裂；原型模拟不证明真实执行器、Browser、Terminal、Memory 质量或正式交付。
- Target：TW-D7 以普通用户路径（make desktop，无 Harness 注入）证明两条旅程——研究/文档：资料上传→模型消费→成果→选区反馈→新版本→检查/接受→刷新重开→第二任务记忆召回；代码/服务/Browser：授权工作根→文件修改→Diff→Terminal 启动服务→Browser 验证→失败反馈→修复复测→成果/检查/接受。
- Expected effect：“桌面持续任务 Agent 达到参考客户端可用性水平”成为有当前源码证据的命题，而非入口或 Gate 数量。
- Non-claim：不替代正式 Acceptance/Station Suite（保持 UNPROVEN）；无同模型对照的性能数值结论；Owner 亲自验收前不提交 MR。

## Actual Outcome Results

所有结果保持 `UNPROVEN`，直到对应切片在实施 worktree 的当前源码上完成 focused source checks 与 exact-source Native Journey。禁止用原型点击、旧 commit、命令退出码或模型自述回填 PASS。

```json outcome-comparison-results
{
  "kind": "peers-touch-outcome-comparison-results",
  "schemaVersion": 1,
  "planId": "TW-20261102",
  "sourceIdentity": "1ffd01f1b",
  "items": [
    {
      "id": "TW-O01",
      "status": "PASS",
      "actualEffect": "Native Journey（acceptance cell + 当前源码 Station + 本地 Ollama 真实模型）证实：首发送原子建任务、真实模型往返 completed；canonical task_id 由 Station 投影至 Desktop 会话读模型。tw-o01-task-continuity headless 闭包在合并 master 后的当前源码（commit 4dfcdc7b7）4/4：两条任务线是两个稳定 canonical conversation（L1）；同线追加输入是同会话的第二个 Turn，历史累计为 4 条消息、2 个不同 turn_id（L2）；切到另一条线再回来，两线历史互不串扰、列表仍保留两线（L3/L4）。队列介入面由 TW-O02 覆盖。",
      "evidenceRefs": [
        "tooling/acceptance/reports/task-workbench/tw-d1-journey.json",
        "tooling/acceptance/reports/task-workbench/tw-o01-task-continuity.json",
        "tooling/acceptance/closures/task-workbench/tw-o01-task-continuity.mjs",
        "apps/desktop/e2e/tests/tw-d1-journeys.spec.ts",
        "commit 46dae9f9, ee6b14087"
      ],
      "deviation": "无。跨任务连续线由 O01 闭包证明；队列介入面由 O02 PASS 覆盖。"
    },
    {
      "id": "TW-O02",
      "status": "PASS",
      "actualEffect": "TW-D2 在当前源码 Station+真实模型+acceptance cell 上证实：运行中输入进入 FIFO 队列（2 条排队、取消队首、对下一条取消并取回编辑，取回文本在 reload 后作为任务草稿恢复）；任务级草稿（文本 + Station OSS 附件引用，同一 object_ref）经切任务与 renderer reload 后完整水合。Station 侧新增 TURN_ADMISSION_STATUS_AMENDED：provider dispatch 栅栏（agent_turns.dispatch_fenced_at）未跨过且 FIFO 为空时，输入原子并入当前 Turn（持久 amendment 行 + payload hash 幂等 + claim 一次性合并；栅栏后/等待本地工具/队列非空一律排队），栅栏/队列/工具等待的并发分支由 Go 测试确定性证明；Desktop 投影 amended 回执、不落新 Turn、文案区分（单测覆盖）。",
      "evidenceRefs": [
        "tooling/acceptance/reports/task-workbench/tw-d2-journey.json",
        "apps/desktop/e2e/tests/tw-d2-journeys.spec.ts",
        "apps/station/app/subserver/agent/service/turn_admission_service.go",
        "apps/station/app/subserver/agent/service/turn_admission_service_test.go",
        "apps/desktop/src/storage/desktopAgentComposerDrafts.ts",
        "commit c920a9b15"
      ],
      "deviation": "amended 的 Native 端到端观测为 UNPROVEN：pre-dispatch 窗口在真实 HTTP/SSE 往返下窄于同帧双击，3 轮竞速均落入 QUEUED；栅栏/合并语义由 Station Go 并发测试（TestTurnAdmissionAmendsBeforeDispatchFence 等）确定性证明，Desktop amended 投影由单测证明，exact-source amended 旅程待 D7 跨夜旅程在受控调度下补跑。审批/AskUser 因验收 agent 无 capability 绑定且 0.5b 模型不稳定发起 tool call，Native 旅程绑定到 D4（真实文件/命令能力），旧 epoch/旧 revision 拒绝由 tool_dispatch/turn_admission Go 测试举证。Stop 独立 Native 断言仍由 TD-J03 承担。"
    },
    {
      "id": "TW-O03",
      "status": "PASS",
      "actualEffect": "Native Journey 证实 renderer reload 后由 Station durable 事件重建，用户/助手消息数 reload 前后一致（1/1→1/1），无重复；业务面 watermark replay→live 与 generation fencing 的源码审计结论得到端到端复核。tw-o03-replay-watermark headless 闭包在合并 master 后的当前源码（commit 4dfcdc7b7）4/4：两轮真实 turn 形成 seq 1–4 连续、身份稳定的持久消息（R1）；after_seq=2 watermark 只回放 seq 3–4 尾部（R2）；watermark 前缀 + 尾部按身份去重合并精确重建全集，无重复、无缺口、集合相等（R3）；全新鉴权会话（等价 app 重启）读到逐字节一致的历史（R4）。",
      "evidenceRefs": [
        "tooling/acceptance/reports/task-workbench/tw-d1-journey.json",
        "tooling/acceptance/reports/task-workbench/tw-o03-replay-watermark.json",
        "tooling/acceptance/closures/task-workbench/tw-o03-replay-watermark.mjs",
        "apps/desktop/src/runtimes/chatRuntime.ts",
        "commit 46dae9f9, ee6b14087"
      ],
      "deviation": "无。watermark 尾部回放、身份去重、断线缺口对账与新会话重读均有 current-source 证据。"
    },
    {
      "id": "TW-O04",
      "status": "PARTIAL",
      "actualEffect": "TW-D3 在当前源码 Station + acceptance cell（ubuntu-24.04 WebKit）+ 真实 Ollama qwen2.5:0.5b 上以 3.6m 一次通过 exact-source Native Journey：真实 text/plain 资料经 OSS 准入后被产出 Turn 实际采用（版本 adopted_attachment_refs 含该 object_ref，v1 声明字节含材料独有短语；反馈修订轮无新材料，v2 采用数为 0）；助手消息字节被认领为不可变 v1（seq=1），正文走独立大对象表、新字节产生 v2（seq=2，parent=v1，origin=feedback_revision 且 feedback.resulting_version_id 回填），两版 sha256 不同且 0 个畸形版本；结构检查/人工检查/接受分别建模并绑定具体版本，v1 被接受后接受行在 v2 产生后保留为 history-kept、current_version 指向 v2、v1 面板显示历史标签；renderer reload 后重开同一 artifact/version/正文/接受状态，导出文件名绑定 v1。Station Go 测试确定性覆盖版本序列不可变、乐观并发、检查/接受随依据变更失效与归属。",
      "evidenceRefs": [
        "tooling/acceptance/reports/task-workbench/tw-d3-journey.json",
        "tooling/acceptance/reports/task-workbench/tw-d3-journey.png",
        "apps/desktop/e2e/tests/tw-d3-journeys.spec.ts",
        "apps/station/app/subserver/agent/service/logical_artifact_service_test.go",
        "apps/desktop/src/store/taskArtifacts.ts",
        "apps/desktop/src/components/agent/workbench/DocumentArtifactPanel.tsx",
        "commit 92f14d79f"
      ],
      "deviation": "PARTIAL：reader/Search/通知/消息卡片/Portal 尚未全部切到同一 artifact/version（本期仅交付工作台 reader、导出与消息认领入口，消息代码块解析保留为展示但已不作为版本真源）；人工编辑乐观并发的拒绝/检查失败的 Native 旅程仍待覆盖（Station 语义由 Go 测试覆盖；Desktop 409 回读 UX 已实现并由 vitest 覆盖）；验收模型无视觉能力，材料为 text/plain 而非 PNG；该 WebKit harness 无法合成真实选区，选区反馈以正文锚定兜底（产品保留实时选区优先）；exact-source 仅证明研究/文档闭环的版本环，完整消费者切换在后续切片收口。不做历史消息回填：IMPORT 定义为前向的显式字节导入原语（请求直供字节、幂等、不可变、禁止引用历史消息，由 Go 测试 TestLogicalArtifactExplicitImportIsForwardOnly 举证），不扫描也不提升历史对话文本。"
    },
    {
      "id": "TW-O05",
      "status": "PASS",
      "actualEffect": "TW-D4 在当前源码 Station（compose pt-tw-d1，:18092）+ acceptance cell（ubuntu-24.04 WebKit）+ 真实 Ollama qwen2.5:0.5b 上以 7.7m 一次通过 exact-source Native Journey：local_file_write 经人工批准在授权工作根创建文件；local_shell_exec 同一 grep 先以 exit 1 失败再以 exit 0 通过；local_file_edit 基于真实 before/after 字节产生 LCS unified diff（Station 事实 modified|before_sha256=64hex|diff=78 字符|diff_truncated=false，UI 呈现 -status=fail/+status=ok）；工具回执含 change_type、before 字节摘要、exit_code、duration_ms、cwd、stdout/stderr 与截断标记，shell 60s 超时杀死、单流 64KiB 有界。最终内容 leg 被认领为不可变 Artifact 版本（source_message_id 指向承载答案的最终 assistant leg，而非空 tool-call leg）；通过的 grep 运行绑定为该版本的 COMMAND 检查，Station 独立校验同会话 local_shell_exec 调用归属、命令回显、exit 0 且 sha256(bounded_result) 与证据一致（tool_call|grep|0|64，outputHashMatches=true）。命令成功、检查通过、用户接受仍是三种独立事实。确定性侧：Station Go 测试覆盖变更事实校验与命令证据验证（含错误退出码不得 PASSED），Rust 单测覆盖出根拒绝、命令策略拒绝、超时与 diff 生成。",
      "evidenceRefs": [
        "tooling/acceptance/reports/task-workbench/tw-d4-journey.json",
        "tooling/acceptance/reports/task-workbench/tw-d4-acceptance-note.md",
        "apps/desktop/e2e/tests/tw-d4-journeys.spec.ts",
        "apps/station/app/subserver/agent/service/logical_artifact_service.go",
        "apps/station/app/subserver/agent/service/tool_dispatch_service.go",
        "apps/desktop/src-tauri/src/application/tools/mod.rs",
        "apps/desktop/src/store/chat.ts",
        "commits 3d603eb8f,453a0ac82,a44d485bb,1bbf7f623,1ffd01f1b"
      ],
      "deviation": "仅覆盖有界一次性命令；可 attach/stdin/resize/kill 的持久 TerminalSession 属 TW-D5。出根写、命令白名单拒绝、60s 超时杀死等围栏负路径由 Rust 单测确定性证明，未在弱模型 Native 旅程中逐一实跑；未知副作用 inspect 语义沿用既有 receipt ledger 未单独编排旅程。0.5b 模型偶发跳过工具调用，旅程以新话题重试收敛，不作为能力证据。"
    },
    {
      "id": "TW-O06",
      "status": "PASS",
      "actualEffect": "TW-D5 在当前源码 Station（compose pt-tw-d1，:18092）+ acceptance cell（ubuntu-24.04 WebKit）上以 9.7s 通过 exact-source Native Journey（合并当日 shared-base 82f02dde6 后复测）：Rust portable-pty worker 在授权 actor 工作区内启动 python3 http.server，Station 行与 worker handle 使用同一 terms-<ULID> 资源 id，pid 319/status=running 实时一致；cell 内 curl 服务返回 200；关闭 viewer 面板只取消订阅，进程继续服务 200；重开面板重连同一 session/pid 且从有界 ring cursor 0 回放历史并重新派生 URL 动作；kill 后 UI 转 killed、回读 exit code、服务下线，Station 行更新为 killed|pid=319|output_bytes=211|cwd 位于 agent-workspaces，并 JOIN 到真实持久 conversation；remove 后 Station 行删除。诚实性：worker/Station 双侧以 live handle 为存活唯一证据，Reconcile 将无法证明的 RUNNING 行降级 UNKNOWN；输出仅存设备侧 256KiB ring（绝对 cursor + resync 边界，Rust 单测覆盖），Station 不存输出与环境。复测中修复三个真实缺陷：worker/Station ID 双脑导致 reconcile 永久误降级与 update/remove 错配（改为 worker id 全局唯一 + Station 幂等创建）、面板会话快照不随话题切换（改为跟随 chat 当前会话）、output_bytes 以字符串上送被 serde 拒绝导致 Station 停留 running（改为 u64 数值）。",
      "evidenceRefs": [
        "tooling/acceptance/reports/task-workbench/tw-d5-journey.json",
        "tooling/acceptance/reports/task-workbench/tw-d5-acceptance-note.md",
        "apps/desktop/e2e/tests/tw-d5-journeys.spec.ts",
        "model/domain/agent/terminal_session.proto",
        "apps/station/app/subserver/agent/service/terminal_session_service.go",
        "apps/desktop/src-tauri/src/application/terminal/mod.rs",
        "apps/desktop/src/store/terminalSessions.ts",
        "commits 847303777,864790ee3,8857b2ae4,d2910e167,912e30932,55c89353a"
      ],
      "deviation": "不实现跨 app/系统重启存活的持久 daemon，worker 换代后无证明会话显示 unknown；draft 话题启动的会话存为未绑定行，绑定持久对话的 rebind 流程不在本切片；stdin 交互与 resize 已在 worker 实现但 Native 旅程只验证 create/重放/kill/remove，未编排交互式 shell 场景。"
    },
    {
      "id": "TW-O07",
      "status": "PASS",
      "actualEffect": "TW-D6 在当前源码 Station（compose pt-tw-d1，:18092）+ acceptance cell（ubuntu-24.04）真实 Google Chrome（CDP）上以 20.8s 通过 exact-source Native Journey：worker 用 chromiumoxide 启动设备侧真实有头 Chrome（非内嵌 webview、非 artifact reader），绑定 brows-<ULID> 全局资源 id；agent observe 本地站点读到真实页面文本，fill 搜索表单并 submit 进入结果页；human takeover 后租约转 human，agent observe 动作被拒（按钮 disabled），xdotool 在真实可见窗口物理勾选+Save，release 后旧 snapshot 引用按 generation 失效，agent 重新 observe 读到 saved:human-<marker>:checked；PNG 截图字节与 sha256 校验；Station 事实 active|agent|engine 非空|tabs_json=131 并 JOIN 真实 conversation；end session 后 Chrome 进程与 Station 行同时归零（count=0）。诚实性：host 二进制不可用即 fail-closed，页面文本一律按不可信数据读取，worker/Station 仅存元数据不存正文/截图。复测中修复三个真实缺陷：Station remove 代理误用 worker camelCase 入参导致 snake_case session_id 被静默丢弃、行永不删除（新增专用 AgentBrowserSessionInput）；journey 证据路径依赖调用 cwd（改为 ESM import.meta.url 锚定仓库根）；dock 开关为全局状态，跨重跑盲目 toggle 反而关闭面板（改为按面板存在幂等打开 + 开清独占 DB 残行）。合并 origin/master（#178/#179，merge c01cf15ba，零冲突：delta 不触及 proto/station/rust/browser 路径）后，desktop pnpm check 与生产 build 全绿，并重嵌 dist 重建二进制，journey 在合并后当前源码以 24.7s 复测通过（证据 commit 绑定 c01cf15ba）。",
      "evidenceRefs": [
        "tooling/acceptance/reports/task-workbench/tw-d6-journey.json",
        "tooling/acceptance/reports/task-workbench/tw-d6-acceptance-note.md",
        "apps/desktop/e2e/tests/tw-d6-journeys.spec.ts",
        "model/domain/agent/browser_session.proto",
        "apps/station/app/subserver/agent/service/browser_session_service.go",
        "apps/desktop/src-tauri/src/application/browser/mod.rs",
        "apps/desktop/src/store/browserSessions.ts",
        "commits b036c2dd8,2398e885c,b926cb2c7,3b8b80a0a,1e6e04127,21d6e9ce1,c01cf15ba"
      ],
      "deviation": "不实现跨 app/系统重启存活的持久浏览器 daemon，worker 换代后无证明会话显示 unknown；多 tab open/close 与 back/forward/reload 已在 worker 实现但本旅程只编排单 tab submit 导航与 observe，未逐条编排负路径；network profiling、下载管理、复杂多 frame 未验证不广告。过期引用拒绝（BROWSER_SNAPSHOT_REF_STALE）与租约拒绝的服务端合同由 Rust 单测保证，journey 内 stale 直测走 UI-only 兜底（eval world 无 window.__TAURI__），不据此声称端到端验证了模型侧引用失效；Station 不保存页面正文与截图字节。"
    },
    {
      "id": "TW-O08",
      "status": "PASS",
      "actualEffect": "TW-D7 在当前源码 Station（compose pt-tw-d1）+ acceptance cell 上以 7.2s 通过 Memory 候选确认门 exact-source Native Journey，并以 8 个 Go 单测确定性证明：proto 新增 MemoryStatus(candidate/confirmed/rejected) 与 ReviewMemory；agent_memories 增 status 列（默认 confirmed，存量记忆不丢）；ExtractFromTurn 启发式提取只落 candidate；Search 的 postgres hybrid 与进程内两条路径及 persona 只消费 confirmed；ReviewMemory 支持 confirm/reject（frozen 拒绝 reject），reject 行保留审计但永不消费、delete 物理删除；BuildRelevantSnapshot 检索失败显式降级为空快照（degraded + 事件），不再回退全量快照注入无关记忆。Per-Turn 冻结：identity/model-facts(agent 规则/配置) 段以 agent:<id>:version=<n> 冻结并新增 TURN_ATTRIBUTION_KIND_PROFILE 在 TurnAttribution 回看 agent 定义版本（Desktop 既有归因面板新增 Profile chip）；memoryProcessor 现在为每个实际采用的 confirmed memory 冻结独立 source_ref（memory:<id>:version=<内容短hash>），经 parseAttributionSourceRef/historicalMemoryName 在 TurnAttribution 生成逐条 MEMORY 采用项（sourceId=记忆id、version=内容版本、name=summary），既有 messages/TurnAttribution.tsx 已按 MEMORY 类别渲染，零新增 UI；Skill 激活体（skill:<id>:version=n）、工具（manifest/schema version）、附件版本此前已逐采用项冻结，由 Go 单测证明。Desktop 新增 TRAE 式记忆复核 dock（角标+确认/拒绝+轮询+fail-closed），经真实 Rust 代理 agent_memory_review 写 Station；journey 证明决策前 confirmed 检索计数为 0、确认后可检索、拒绝后不可检索，且确认记忆 session_id 为空（agent 维度，可用于后续任务）。插件 readiness→admission 撤权门：tool_dispatch 要求 (capabilityId,version,bindingId,bindingRevision) 在不可变、哈希校验、未过期的 CapabilityReadinessSnapshot 中恰为 READY 才放行，否则 invalidToolState；撤权/升级使 binding revision 变化→旧快照失配→阻断新 admission，由 TestCapabilityAuthorityReadinessFailsClosedForStaleBinding、TestCapabilityReadinessSnapshotIsImmutable、TestCapabilityBindingMutationsPublishTypedInvalidationsOnce、TestCommandCapabilitySnapshotPinsBindingManifestAndReadiness 确定性证明（当前源码复跑全 PASS）。",
      "evidenceRefs": [
        "tooling/acceptance/reports/task-workbench/tw-d7-journey.json",
        "tooling/acceptance/reports/task-workbench/tw-d7-acceptance-note.md",
        "apps/desktop/e2e/tests/tw-d7-journeys.spec.ts",
        "apps/station/app/subserver/agent/service/memory_lifecycle_test.go",
        "apps/station/app/subserver/agent/service/memory_attribution_test.go",
        "apps/station/app/subserver/agent/service/prompt_assembly_service.go",
        "apps/station/app/subserver/agent/service/tool_dispatch_service.go",
        "apps/station/app/subserver/agent/service/capability_authority_service_test.go",
        "apps/desktop/src/components/messages/TurnAttribution.tsx",
        "model/domain/agent/memory.proto",
        "apps/desktop/src/components/agent/workbench/memory/MemoryReviewDock.tsx",
        "tooling/acceptance/reports/task-workbench/tw-o08-memory-recall.json",
        "tooling/acceptance/closures/task-workbench/tw-o08-memory-recall.mjs",
        "commits 4d0000d80,6fa903c09,f91e6f662,7b86b3146,512cf92ec,6272f189e,4619188f2,50187990c,aebda5008,165f9ac06,ba5bbdc83,6c638be00,ee6b14087"
      ],
      "deviation": "无（Per-Turn 冻结已收口：Profile/规则、Memory、Skill、capability/工具、附件版本均逐采用项冻结并可在 TurnAttribution 回看；Memory 候选门与插件撤权即阻断新 admission 有 current-source 证据）。tw-o08-memory-recall headless 闭包在合并 master 后当前源码（commit 4dfcdc7b7）7/7：强模型第一任务落 candidate（M1）、确认前 confirmed 检索不含 marker（M2）、人工门确认（M3）、全新任务在自身历史无 marker 的情况下只凭注入的 confirmed agent 维度记忆答出唯一代号（M4/M4b）、运行后 confirmed 残留为 0（M5）。收口期修复一个真实产品缺陷：字符预算（memory 2200/user 1375）把 candidate/rejected 行计入占用，审计残留累积后会在 confirmed 记忆为空时阻断新提取；现按领域合同只计 confirmed（commit 6c638be00，Go 测试 TestMemoryCharBudgetExcludesCandidatesAndRejected）。通用第三方 MCP 插件 install→probe→ready 的 native app journey 仍为显式非门禁可选项：文件/命令/Browser/Terminal 工具已经同一 readiness 门由 D4–D6 与 O12 native journey 证明，不为本计划范围。"
    },
    {
      "id": "TW-O09",
      "status": "PASS",
      "actualEffect": "当前源码审计确认复杂 Provider/runtime 配置归 Station/Dashboard：Desktop Rust provider 层（application/provider/{mod,station_api,remote}.rs）是到 /sub-agent/agent/provider/* 的纯 HTTP 代理，无 std::process::Command、无本地 CLI 执行、无第二 registry；provider create/update/delete、凭据、模型发现（/model/available）均在 Station。Desktop 仅作消费端：runtime_default_get/set 选择默认，且 set 强制校验并发送完整 (provider_id, model_id) 并带 expected_revision 乐观并发；列出可用模型、回读 readiness。未发现客户端凭据回读或在 Desktop 解析 provider CLI 的第二业务 Owner。native headless 旅程在当前源码上补齐两条运行时切换证据：(1) tw-o09-provider-revoke-restore 证实完整 provider_id+model_id 选择→真实回答→Station 禁用→下一轮 RUNTIME_UNAVAILABLE/provider_disabled fail-closed（无回答、无模型调用）→恢复后可用；(2) tw-o09-credential-revoke-restore（ARK Seed2.1-Pro 强模型，唯一 token 两轮真实往返）证实会话绑定完整 provider+model id、删除 Station 持有凭证（乐观版本号）后下一轮在 admission 阶段即以 PROVIDER_CREDENTIAL_MISSING + details.provider_id 终态失败且无回答，该载荷正是 Desktop renderer 映射 resolution={type:'openProviderSettings',providerId,label:'agent.recovery.configureCredential'} 的唯一触发条件；重设凭证后版本世系重建、新轮真实回答恢复。独立 SQL 佐证：attempt 行落 provider call failed after retries: [PROVIDER_CREDENTIAL_MISSING]，凭证池 request_count=2 与两轮成功一致；明文密钥仅经宿主进程环境注入一次，报告中零泄漏（C9）。",
      "evidenceRefs": [
        "apps/desktop/src-tauri/src/application/provider/mod.rs",
        "apps/desktop/src-tauri/src/application/provider/station_api.rs",
        "apps/desktop/src/services/desktop_api.ts",
        "apps/desktop/src/services/api.test.ts",
        "apps/desktop/src/components/messages/AssistantMessage.tsx",
        "apps/station/app/subserver/agent/service/provider_config_service.go",
        "apps/station/app/subserver/agent/service/credential_config_service.go",
        "tooling/acceptance/closures/task-workbench/tw-o09-provider-revoke-restore.mjs",
        "tooling/acceptance/closures/task-workbench/tw-o09-credential-revoke-restore.mjs",
        "tooling/acceptance/reports/task-workbench/tw-o09-provider-revoke-restore.json",
        "tooling/acceptance/reports/task-workbench/tw-o09-credential-revoke-restore.json",
        "tooling/acceptance/reports/task-workbench/tw-o09-credential-revoke-restore-psql.json"
      ],
      "deviation": "恢复深链的完整机制合同已 end-to-end 举证（Station 终态错误载荷 → renderer resolution 映射有 api.test.ts 单测 → AssistantMessage 点击发布 NAVIGATION_REQUESTED settings/providers）；唯一未做的是在 cell webview 内物理点击该深链按钮的 GUI 动作——与 TW-O10 一致，renderer-only 点击不属于 headless native journey 口径，映射单测与处理代码已覆盖。"
    },
    {
      "id": "TW-O10",
      "status": "PASS",
      "evidenceRefs": [
        "commit 46dae9f9",
        "tooling/acceptance/reports/task-workbench/tw-d1-journey.png",
        "tooling/acceptance/reports/task-workbench/tw-d3-journey.json",
        "tooling/acceptance/reports/task-workbench/tw-d4-journey.json",
        "tooling/acceptance/reports/task-workbench/tw-d5-journey.json",
        "tooling/acceptance/reports/task-workbench/tw-d6-journey.json",
        "tooling/acceptance/reports/task-workbench/tw-d6-acceptance-note.md",
        "tooling/acceptance/reports/task-workbench/tw-d7-journey.json",
        "tooling/acceptance/reports/task-workbench/tw-d7-acceptance-note.md",
        "go test agent pass",
        "desktop pnpm run check pass (locales parity + social-wire + runtime-boundaries + tsc)",
        "vitest 1588 pass (merged shared-base tree)",
        "cargo test terminal 22 pass; desktop_executor_worker 39 pass (1 keystore env failure, baseline reproduced)",
        "cargo test browser + acceptance-playwright build pass; tw-d6 native journey 20.8s pass",
        "go test memory lifecycle 6 pass; tw-d7 memory gate native journey 7.2s pass",
        "tooling/acceptance/reports/task-workbench/tw-o12-research-journey.json (strong-model research+memory recall)",
        "tooling/acceptance/reports/task-workbench/tw-o12-ops-journey.json (strong-model fail-fix-retest)",
        "commit 5ac20d162 / f5438739c (two further fail-closed defects found via acceptance and fixed)"
      ],
      "actualEffect": "D1 纵向切片含真实可运行 Native 证据：cell 镜像 acceptance-desktop-linux:ubuntu-24.04 内构建 e2e-testing 当前源码二进制，真实 Station（compose project pt-tw-d1，:18092）+ 真实 Ollama，Journey 32.7s/53.9s 两次通过；无 mock/原型状态进入生产。D3 在同环境再以 3.6m 一次通过（含 renderer reload 重开与反馈修订 v2），并修复验收暴露的 capability warmup IPC 风暴（全量投影轮询改为会话级轮询+退避，52 行/秒降至 2–4 行/秒）与面板 reopen 竞态。D4 以 7.7m 一次通过文件修改→命令失败→diff→复测通过→版本认领→COMMAND 检查的 exact-source 旅程，并修复多 leg Turn 的终态/字节归属投影竞态。D5 合并当日 agent-usability-shared-base（8 个冲突逐一手动解决，检查全绿）后以 9.7s 通过长服务→viewer 关闭存活→重连同 pid/回放→kill/exit code/Station 事实→remove 的设备 TerminalSession 旅程，并修复 ID 双脑、面板会话陈旧、生命周期字节上送三处真实缺陷。D6 以 20.8s 通过真实 Chrome(CDP) observe/fill/submit→人工接管物理输入→归还后重新 observe（旧引用失效）→截图→Station 事实→进程与行同时归零的设备 BrowserSession 纵向切片（proto/Station/Rust/UI/locales 全层），fail-closed host 探测，并修复 Station remove 代理 snake/camel 线序错配、证据 ESM 路径、dock 跨重跑开关三处真实缺陷。D7 闭环 Memory 候选确认门（proto/Station/Rust/Desktop 全纵向 + 6 个 Go 单测 + 7.2s native journey），修复启发式提取自动升级长期记忆、检索失败全量快照回退两处真实缺陷。收口期接入强模型（ARK doubao-seed）后，两条端到端旅程在当前源码 exact-source 下一次通过（研究/文档含跨任务真实记忆召回 2.1m；代码/服务 fail→反馈修复→复测 59.9s，见 TW-O12），并再次由验收暴露两个真实 fail-closed 缺陷——text/plain 被错误按 file-input 门禁、记忆评审误用 agent 名而非 canonical id——均已修复并回归；每个切片保持可运行纵向、未完成能力 fail-closed 的纪律成立。",
      "deviation": "无（O10 纵向可运行 + fail-closed 合同达成）。残留非门禁项：通用第三方 MCP 插件 install→probe→ready 的 native journey 仍为可选项未做；代码/服务旅程的 Terminal 长服务/Browser device 腿沿用 tw-d5/tw-d6 的当前源码独立举证而非并入单 run（Browser 腿含物理人工接管）。"
    },
    {
      "id": "TW-O11",
      "status": "PASS",
      "actualEffect": "新增语义先改 model/domain proto 并经 ./model/build.sh 生成 Go/TS；未引入手写并行 DTO，canonical 身份复用既有唯一索引/admission/outbox，Desktop 复用既有 streamTurn/会话投影。",
      "evidenceRefs": [
        "model/domain/agent/agent.proto",
        "model/domain/agent/orchestration.proto",
        "apps/station/app/subserver/agent/model/*.pb.go",
        "apps/desktop/src/gen/proto/domain/agent/*_pb.ts",
        "./model/build.sh pass @10613862a"
      ],
      "deviation": "无。"
    },
    {
      "id": "TW-O12",
      "status": "PASS",
      "actualEffect": "强模型（Volcengine ARK doubao-seed，ep-20260623145021-n4xdm）接入后两条语义旅程在当前源码 exact-source native journey 下打通。(1) 研究/文档 tw-o12-research（2.1m 一次通过）：text/plain 资料经 OSS 准入被强模型消费→成果认领不可变 v1→选区反馈生成 v2（sha 不同、origin=feedback_revision、head=v2、v1 adoption=1/v2=0）→结构+人工检查接受→刷新重开仍为已接受 v2；随后一个跟进任务真实经启发式抽取产生 CANDIDATE 记忆，人在评审角标确认后，冷启动的第二任务召回——retrieval_count 0→1、retrieval 事件 result_count=1，模型只可能从注入的 confirmed 记忆答出唯一 code（ZEPHYR-<run>）。(2) 代码/服务 tw-o12-ops（59.9s 一次通过）：人工逐条批准下强模型首轮即正确连发 local_file_write→local_shell_exec(grep，exit 1 失败)→local_file_edit(worker unified diff -status=fail/+status=ok，modified|64|80|false)→同一命令复测 exit 0；fail/pass 为不同 tool call，成果认领为 artifact 并通过结构+人工+COMMAND 检查（command check 绑定到持久化 bounded-result，exit 0、sha 长度 64、重算 sha 一致）后接受（acceptance 行存在、current_version=该版本）。验收过程暴露并修复两个真实缺陷：text/plain 被错误地按模型 file-input 能力门禁（OpenAI/Anthropic/Ollama 适配器本就把文本内联为 text part），导致 ARK 附件回合 selected_model_has_no_file_input 秒败，改为按 text 模态门禁（PDF 仍要求 file、image 仍要求 image）并补确定性准入测试；记忆评审角标误用 agent 显示名而非 canonical id，致真实抽取的 candidate 不入队、name 键确认永不被召回，改为 name→id 解析（与其余 runtime 一致）。(3) 同一 ops 腿在 2026-11-05 进一步以无 GUI 的 desktop-native headless mjs 闭包（tw-o12-ops，10/10 一次通过）在当前源码上重证：headless 密码登录后调用与 GUI 同一的 app_auth::activate_messaging_profile 生产函数引导 actor-device 引擎，capability supervisor 注册真实会话（9 项 GRANTED typed capabilities），5 项设备能力 MANUAL 绑定幂等收敛、对 ARK admission 的 readiness 全部 READY；单个强模型 turn 内 4 次迭代（write→grep exit 1→edit→grep exit 0）每次都真实 parked 在 tool_approval_required，harness 提交真人决策（revision 1）后由 Station continuation worker 派发 desktop-rust 执行；真实事实经三通道对齐——设备 fs 字节（write/edit 设备自报 sha 与 node 独立读取一致且不同）、tool_result 信封内真实 exit_code/stdout、Station turn trace（TURN_STATUS_COMPLETED，tool_iterations=4）；成果按 AGENT_OUTPUT 认领（绑定真实 turn_id 与 edit tool_call_id），COMMAND 检查由 Station 以持久化 bounded-result 信封校验（command echo/exit 0/输出 sha 全等），接受为 current。另以直连 Postgres 的独立 SQL 旁证 7/7（4 calls succeeded/approved rev1/client_capability/dispatch 1–4/会话+设备俱全，4 results applied，4 batches ready_for_continuation，版本与 sha 绑定一致）。(4) 研究/文档腿同日以无 GUI 的 desktop-native headless mjs 闭包（tw-o12-research，9/9 一次通过）在当前源码重证：text/plain 材料经 oss_upload_agent_attachment_bytes 走与 GUI 同一的 OSS 准入（checksum/会话 scope），turn 固定 device capability session 后强模型仅从附件文本产出含唯一 token 的报告（无工具调用），认领 v1 AGENT_OUTPUT（adopted_attachment_refs 绑定 object_ref、source_turn_id 真实），提交 SELECTION feedback 后修订 turn 产出 v2（parent 链、origin=feedback_revision，Station 将 feedback.resulting_version_id 服务端回填），结构+人工检查通过并接受 v2，再开第二个 gateway 会话（等价 renderer 重开）重读版本图/正文/接受状态仍为已接受 v2；直连 Postgres 旁证 9/9（v1/v2 seq、parent、origin、仅 v1 adopts material、双版本绑定真实 turn、feedback 链接、head=v2、持久化正文与 sha 一致）。跨任务记忆召回由当前源码 tw-o08-memory-recall headless 6/6 单独举证，不重复冒充为本闭包事实。(5) Browser 物理接管腿同日以无 GUI 的 desktop-native headless mjs 闭包（tw-o12-browser，12/12 一次通过）在当前源码重证，此前"物理接管无法无人值守复现"的口径作废：gateway 新增 browser worker 与 Station 元数据代理 arms（同一 CDP worker/同一 Station 合同，无并行控制路径），闭包在 cell Xorg :99 上驱动真实 Google Chrome 156（CDP）——agent observe/fill/submit 读到真实页面文本后 takeover，持 HUMAN 租约时 snapshot 与 click 均 fail-closed（BROWSER_HUMAN_TAKEOVER_HELD×2）；"人"的操作全部由真实 OS 输入完成（xdotool windowactivate/mousemove/click/type，非 CDP/DOM），release 后旧代引用 BROWSER_SNAPSHOT_REF_STALE、重新 observe 读到 saved:human-<marker>:checked，PNG 截图 16KB 真实窗口；Station 元数据 status=active/lease=agent/engine/tabs(page2 url) 经网关 proto 回读，remove 后 Chrome 进程与 Station 行同时归零，直连 Postgres 旁证 4/4（行删除、会话 active 且属 alice actor）。(6) WORKSPACE_SANDBOX 全链同日以无 GUI headless 闭包（tw-o12-sandbox，8/8 一次通过）打通并在当前源码重证：sandbox compose profile 启动独立 provisioner sidecar（bearer 鉴权、仅挂 docker.sock、镜像以内容 ID sha256:b752… 白名单固定）；闭包先把全局工具绑定收敛为纯 workspace.sandbox.* 家族（Station 禁止 desktop/sandbox 混族 turn），readiness 无需设备会话即 READY；强模型 governed turn（MANUAL 逐次真人决策）write→grep exit 1→edit→grep exit 0/STATE=green，4 个工具全部由 STATION 在 provisioned sibling 容器执行（execution_owner=station、capability=workspace.sandbox.*，直连 SQL 8/8：4 calls succeeded、4 bounded results applied、零设备族调用、allocated/oci_linux、内容 ID 固定镜像）；Station 自有 PTY 在同一沙盒验证非根 uid=10001/Ubuntu 24.04，工作区卷跨独立 PTY 会话持久（PERSIST 标记第二次会话可读），网络隔离实测 provisioner DNS 与 Station 网桥均不可达，外来 sandbox_ref 开 PTY 被 fail-closed 拒绝（422 SANDBOX_EXECUTION_TARGET_FORBIDDEN）。tw-o12-ops 同步改为显式 DESKTOP_DEVICE scope 收敛，设备腿回归仍 10/10。(7) 计划原文的“Terminal 启动服务→Browser 验证→失败反馈→修复复测”同日并入单 run 闭包（tw-o12-service，6/6 一次通过）：设备持有 PTY 起 detached `python3 -m http.server` 长服务（HTTP 200 + PTY running 实证，按唯一端口参数 pkill 停服并由端口关闭证实），真实 Chrome 打开服务页先观察到 BUILD_STATUS:FAIL，强模型 governed turn（设备工具、MANUAL）编辑服务页源文件落盘 PASS，Chrome 同一服务重载观察到 BUILD_STATUS:PASS（代际刷新），psql 旁证 5/5（turn completed、edit 在 client_capability 设备面执行、零 Station 误路由、会话 active、浏览器资源行清理；设备 PTY worker-local 不经 Station 持久化属设计）。(8) 强模型自主 Browser Use 腿于 2026-11-06 以无 GUI desktop-native headless 闭包（tw-o12-browser-tool，10/10，含 C10 双侧资源归零门）在当前源码 exact-source（commit aee0a9925）打通，browser-as-model-tool 不再 deferred，O12 转 PASS：模型工具面新增 6 个 schema-first 浏览器工具（browser_navigate/snapshot/screenshot/click/fill/submit），多对一映射到两个 MANUAL 能力——browser.observe（navigate/snapshot/screenshot）与 browser.interact（click/fill/submit），全部经由既有 capability admission/approval/continuation 合同派发，无并行控制路径；ClientCapabilityRequest 信封新增 conversation_id/tool_name（proto 字段 27/28，./model/build.sh 全量再生成 Go/TS，Rust 由 prost 构建期生成），解决“按 capability id 派发但客户端需知道具体 tool”的多对一问题与 BrowserSession Station 真值要求 conversation 非空的约束；tool_calls 表新增 conversation_id 列（活库迁移已应用，默认 ''）。Desktop 侧新增 AgentBrowserBridge，复用既有 browser worker（create_session/CDP/host engine）与 Station agent_browser_session 真值（按 conversation 解析或惰性创建 brows- ULID 标签页，navigate/interact 均回交动作后观察快照供模型连续决策），持 HUMAN 租约时模型动作以有界工具结果 fail-closed（BROWSER_HUMAN_TAKEOVER_HELD/BROWSER_SNAPSHOT_REF_STALE 进入 tool result 而非执行器错误）。闭包在设备 PTY 以 python3 http.server 供应含唯一标记的 FAIL 页面，单个 governed turn（MANUAL 逐次真人决策）内模型自主 browser_navigate→browser_snapshot 观察到 BUILD_STATUS:FAIL→local_file_edit 落盘→browser_navigate+snapshot 观察到 PASS，浏览器与文件工具在同一 turn 同设备族内交错，磁盘翻转由 node 独立读取核验；接管腿在持 HUMAN 租约的会话上派发浏览器动作得到有界 BROWSER_HUMAN_TAKEOVER_HELD，release 后模型重新观察 PASS；直连 Postgres 旁证 4/4（browser_navigate 行全部 browser.observe/client_capability/succeeded/approved 且新 conversation_id 线字段回填、edit 行 filesystem.edit、模型创建会话在 C7 注册为 Station 真值 active/agent），并在闭包结束时以 C10 门验证两段式删除合同（browser_remove 设备臂 + agent_browser_session_remove Station 真值臂），直连 count(agent_browser_sessions)=0、设备 worker 同步消失。收口期另发现并修复一个闭包缺陷（非产品缺陷）：初版 finally 只调设备 remove 臂，Station 真值行残留为 active（两段式删除合同与物理接管闭包 B11 一致，模型创建会话是 BrowserDock 可见的用户资源），补齐 Station remove 臂并加 C10 门与 cleanup_errors 证据后 10/10 重证。验收同时暴露并修复一个真实产品缺陷：gateway 恢复窗口会话使用 .bind，Station 容器重建作废旧 JWT 后恢复窗口仍能在登录竞争中抢占，改为 .bind_exclusive 使全新 headless 登录为唯一权威。",
      "evidenceRefs": [
        "apps/desktop/e2e/tests/tw-o12-research.spec.ts",
        "tooling/acceptance/reports/task-workbench/tw-o12-research-journey.json",
        "tooling/acceptance/closures/task-workbench/tw-o12-research.mjs",
        "tooling/acceptance/reports/task-workbench/tw-o12-research.json",
        "tooling/acceptance/reports/task-workbench/tw-o12-research-psql.json",
        "apps/desktop/e2e/tests/tw-o12-ops.spec.ts",
        "tooling/acceptance/reports/task-workbench/tw-o12-ops-journey.json",
        "tooling/acceptance/closures/task-workbench/tw-o12-ops.mjs",
        "tooling/acceptance/reports/task-workbench/tw-o12-ops.json",
        "tooling/acceptance/reports/task-workbench/tw-o12-ops-psql.json",
        "tooling/acceptance/closures/task-workbench/tw-o12-browser.mjs",
        "tooling/acceptance/reports/task-workbench/tw-o12-browser.json",
        "tooling/acceptance/reports/task-workbench/tw-o12-browser-psql.json",
        "tooling/acceptance/closures/task-workbench/tw-o12-sandbox.mjs",
        "tooling/acceptance/reports/task-workbench/tw-o12-sandbox.json",
        "tooling/acceptance/reports/task-workbench/tw-o12-sandbox-psql.json",
        "tooling/acceptance/closures/task-workbench/tw-o12-service.mjs",
        "tooling/acceptance/reports/task-workbench/tw-o12-service.json",
        "tooling/acceptance/reports/task-workbench/tw-o12-service-psql.json",
        "tooling/acceptance/closures/task-workbench/tw-o12-browser-tool.mjs",
        "tooling/acceptance/reports/task-workbench/tw-o12-browser-tool.json",
        "tooling/acceptance/reports/task-workbench/tw-o12-browser-tool-psql.json",
        "model/domain/agent/agent.proto (ClientCapabilityRequest conversation_id=27/tool_name=28)",
        "apps/desktop/src-tauri/src/application/browser/agent_tools.rs (AgentBrowserBridge)",
        "commit aee0a9925 (browser-as-model-tool: registry/capability map/dispatch envelope/bridge/exclusive-bind fix)",
        "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs (agent_device_engine_activate + browser worker/Station metadata headless arms)",
        "apps/station/app/subserver/agent/service/attachment_admission_service.go",
        "apps/desktop/src/components/agent/workbench/memory/MemoryReviewDock.tsx",
        "commit 5ac20d162 (station text-inline fix)",
        "commit f5438739c (desktop memory canonical id fix)",
        "commit 4e4ce0df0 / 3ffbb6aaa (research journey + evidence)",
        "commit 93a141662 / 73815ebb7 (ops journey + evidence)"
      ],
      "deviation": "研究/文档旅程全链（含跨任务真实模型记忆召回）完整满足；代码/服务旅程在 desktop-rust 与 Station sandbox 两个执行面均已 headless 重证（文件修改→真实失败→反馈修复/diff→复测→成果检查接受）；Browser 资源腿（真实 Chrome CDP + HUMAN 租约 fail-closed + 真实 OS 物理输入 + 旧引用过期 + 截图 + 生命周期）已 headless 重证；WORKSPACE_SANDBOX 全链（provisioner、惰性分配、容器内执行、Station PTY 持久/非根、网络隔离、外来 ref fail-closed）已 headless 重证；计划原文的 Terminal 长服务→Browser 验证→失败反馈→修复复测已并入同一 run 闭包（tw-o12-service 6/6）；强模型自主 Browser Use 已由 tw-o12-browser-tool 10/10 在当前源码 exact-source 重证：browser.observe/browser.interact 两个 MANUAL 能力 + 6 个 schema-first 模型工具 + conversation_id/tool_name 派发信封 + AgentBrowserBridge 复用既有 CDP worker 与 Station 真值 + HELD 有界 fail-closed，psql 旁证 4/4，C10 两段式删除后门 count(agent_browser_sessions)=0。tw-o12-ops 在同一新能力合同下回归 10/10。计划范围内两条端到端旅程语义全部达成，定 PASS。范围外保留项：C07 Computer Use 整体（系统级桌面/任意应用控制）未立项，当前 browser 能力严格限定于受管浏览器标签页；browser.interact 风险分级为 client-browser/MANUAL，尚无自动批准策略。无同模型对照性能结论；不替代正式 Acceptance/Station Suite（保持 UNPROVEN）；Owner 亲自验收前不提交 MR。"
    }
  ]
}
```
