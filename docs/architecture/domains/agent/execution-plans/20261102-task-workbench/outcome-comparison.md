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
  "sourceIdentity": "46dae9f96",
  "items": [
    {
      "id": "TW-O01",
      "status": "PARTIAL",
      "actualEffect": "Native Journey（acceptance cell + 当前源码 Station + 本地 Ollama 真实模型）证实：首发送原子建任务、真实模型往返 completed；canonical task_id 由 Station 投影至 Desktop 会话读模型。",
      "evidenceRefs": [
        "tooling/acceptance/reports/task-workbench/tw-d1-journey.json",
        "apps/desktop/e2e/tests/tw-d1-journeys.spec.ts",
        "commit 46dae9f9"
      ],
      "deviation": "跨任务切换连续线与队列介入面属 TW-D2；本结果仅覆盖单任务首 Turn。"
    },
    {
      "id": "TW-O02",
      "status": "PARTIAL",
      "actualEffect": "Native Journey 证实 admission 前双击只挂载 1 条用户消息（在途去重生效）；重复提交在真实 UI+真实 Station 下不产生第二 Turn。Stop 终态仍以 Station turn_id+status=cancelled 回读为唯一来源（源码审计 + TD-J03 覆盖）。",
      "evidenceRefs": [
        "tooling/acceptance/reports/task-workbench/tw-d1-journey.json",
        "apps/desktop/src/store/chat.ts",
        "commit 46dae9f9"
      ],
      "deviation": "started/amended/queued/rejected delivery 回执与安全 amendment 属 TW-D2；Stop 的 D1 独立 Native 断言未单列（由 TD-J03 承担）。"
    },
    {
      "id": "TW-O03",
      "status": "PARTIAL",
      "actualEffect": "Native Journey 证实 renderer reload 后由 Station durable 事件重建，用户/助手消息数 reload 前后一致（1/1→1/1），无重复；业务面 watermark replay→live 与 generation fencing 的源码审计结论得到端到端复核。",
      "evidenceRefs": [
        "tooling/acceptance/reports/task-workbench/tw-d1-journey.json",
        "apps/desktop/src/runtimes/chatRuntime.ts",
        "commit 46dae9f9"
      ],
      "deviation": "刷新后跨会话切换、断线缺口对账的更广场景留待后续切片旅程。"
    },
    {
      "id": "TW-O04",
      "status": "UNPROVEN",
      "actualEffect": "切片尚未实施；逻辑成果版本闭环未建立。",
      "evidenceRefs": [],
      "deviation": "未开始；TurnArtifact 文件定位不充当前期证据。"
    },
    {
      "id": "TW-O05",
      "status": "UNPROVEN",
      "actualEffect": "切片尚未实施；Diff/字节/回执旅程未串验。",
      "evidenceRefs": [],
      "deviation": "未开始。"
    },
    {
      "id": "TW-O06",
      "status": "UNPROVEN",
      "actualEffect": "切片尚未实施；生产 TerminalSession 不存在。",
      "evidenceRefs": [],
      "deviation": "未开始；一次性 shell 不构成证据。"
    },
    {
      "id": "TW-O07",
      "status": "UNPROVEN",
      "actualEffect": "切片尚未实施；生产 BrowserSession 不存在。",
      "evidenceRefs": [],
      "deviation": "未开始；验收用 Playwright 与原型模拟均不构成证据。"
    },
    {
      "id": "TW-O08",
      "status": "UNPROVEN",
      "actualEffect": "切片尚未实施；版本冻结/召回/撤权/ready 旅程未串验。",
      "evidenceRefs": [],
      "deviation": "未开始。"
    },
    {
      "id": "TW-O09",
      "status": "UNPROVEN",
      "actualEffect": "切片尚未在 D1 处理；Desktop 选择面与 provider-runtime-strategy 的对齐留待 TW-D7 核对。",
      "evidenceRefs": [],
      "deviation": "未开始。"
    },
    {
      "id": "TW-O10",
      "status": "PARTIAL",
      "actualEffect": "D1 纵向切片含真实可运行 Native 证据：cell 镜像 acceptance-desktop-linux:ubuntu-24.04 内构建 e2e-testing 当前源码二进制，真实 Station（compose project pt-tw-d1，:18092）+ 真实 Ollama，Journey 32.7s/53.9s 两次通过；无 mock/原型状态进入生产。",
      "evidenceRefs": [
        "commit 46dae9f9",
        "tooling/acceptance/reports/task-workbench/tw-d1-journey.png",
        "go test agent pass",
        "vitest 518 pass"
      ],
      "deviation": "TW-D2–D7 未开始；完整两条业务旅程待 TW-D7。"
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
      "status": "UNPROVEN",
      "actualEffect": "两条完整端到端 Journey 未运行。",
      "evidenceRefs": [],
      "deviation": "D1 仅证明任务/事件主链；研究/文档与代码/服务/Browser 两条完整旅程依赖 TW-D3–D7，未到验收节点。"
    }
  ]
}
```
