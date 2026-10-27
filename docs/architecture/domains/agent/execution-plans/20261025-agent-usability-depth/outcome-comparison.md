# Agent 可用性深度：执行前后效果对比

> **Plan**: `AUD-20261025`
> **Version**: `agent-usability-depth-20261025-v3`
> **用途**: 实施前确认预期效果，实施后按当前源码核对 TD-J01…J05 Journey 与假面清理
> **当前阶段**: 计划冻结，结果仅允许按 current-source evidence 回填。O01–O11 `SOURCE_VERIFIED`；O12 于 2026-10-27（`c1992b380`）`FUNCTIONAL_PASS`。

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "AUD-20261025",
  "plannedSectionDigest": "sha256:3089156d865a89c1bd9364a98d3282921de8e3bab8f75f8ea3c45f804b5e81b9",
  "criteria": [
    { "id": "AUD-O01", "dimension": "user-experience", "title": "长任务不再被预算误杀，过程持续可见", "taskIds": ["AUD-01", "AUD-02", "AUD-03", "AUD-07"], "gateIds": [] },
    { "id": "AUD-O02", "dimension": "user-experience", "title": "运行中可继续表达意图，队列可见可控", "taskIds": ["AUD-06", "AUD-07"], "gateIds": [] },
    { "id": "AUD-O03", "dimension": "user-experience", "title": "提问、审批与恢复是同一任务中的显式动作", "taskIds": ["AUD-03", "AUD-07"], "gateIds": [] },
    { "id": "AUD-O04", "dimension": "product-capability", "title": "开箱具备读、写、受控命令、联网取证与任务清单能力", "taskIds": ["AUD-02", "AUD-03"], "gateIds": [] },
    { "id": "AUD-O05", "dimension": "product-capability", "title": "真实文件产物可打开、迭代并跨设备获取", "taskIds": ["AUD-04", "AUD-16"], "gateIds": [] },
    { "id": "AUD-O06", "dimension": "product-capability", "title": "Skill 是带版本资源、可按说明完成工作的能力包", "taskIds": ["AUD-05"], "gateIds": [] },
    { "id": "AUD-O07", "dimension": "product-capability", "title": "能力供给面（知识/记忆/MCP/默认模型）配置即真实生效", "taskIds": ["AUD-08", "AUD-12", "AUD-13", "AUD-14"], "gateIds": [] },
    { "id": "AUD-O08", "dimension": "product-capability", "title": "定时任务、Lark 与 Bot 渠道形成真实自动闭环", "taskIds": ["AUD-09", "AUD-10", "AUD-11"], "gateIds": [] },
    { "id": "AUD-O09", "dimension": "architecture", "title": "Station 单一真相：身份、调度、记忆、产物无双 owner", "taskIds": ["AUD-01", "AUD-09", "AUD-12", "AUD-15", "AUD-16"], "gateIds": [] },
    { "id": "AUD-O10", "dimension": "architecture", "title": "执行 owner、围栏与密钥边界不被能力扩展削弱", "taskIds": ["AUD-02", "AUD-03", "AUD-04", "AUD-05", "AUD-13"], "gateIds": [] },
    { "id": "AUD-O11", "dimension": "technology", "title": "新合同 proto-first，迁移与调度复用既有设施", "taskIds": ["AUD-03", "AUD-04", "AUD-05", "AUD-09", "AUD-10"], "gateIds": [] },
    { "id": "AUD-O12", "dimension": "quality-operations", "title": "五个真实任务 Journey 整体 FUNCTIONAL_PASS，假面零遗留", "taskIds": ["AUD-06", "AUD-07", "AUD-11", "AUD-15", "AUD-16"], "gateIds": [] }
  ]
}
```

## Planned Outcome Comparison

### AUD-O01：长任务不再被预算误杀，过程持续可见

- Before: 正常 tool-result 续跑与瞬时失败重试共用 3 次 provider dispatch 预算（runtime_admission_service MaxAttempts=3），需要第 4 次模型请求的依赖链被拒绝；50 步声明与实际链路长度不符。
- Target: AUD-01 分离 continuation/retry/auxiliary 三类预算，长依赖链按步数预算连续执行；AUD-02/03 的 web/todo/写/命令活动与 AUD-07 的统一时间线让过程默认可见、早期活动可折叠展开。
- Expected effect: 用户看到 Agent 持续推进一个多步真实任务，而不是在第 3 次模型往返后莫名终止；进度、命令、文件变化在同一时间线可审计。
- Non-claim: 不承诺首字延迟/完成率数值提升；循环失控仍受步数、工具数、时限与循环检测约束。

### AUD-O02：运行中可继续表达意图，队列可见可控

- Before: composer 在 isStreaming 时禁发；Station DB FIFO 与 queued 事件已存在，但 TurnQueueTray 刻意不挂载，运行中补充要求只能先 Stop。
- Target: AUD-06 运行中发送进入持久 FIFO，STARTED/QUEUED 确认后释放草稿；QueueTray 显示当前会话排队位置并支持取消、取回编辑；AUD-07 把队列纳入重启对账。
- Expected effect: 用户不用打断 Agent 即可补充要求，顺序确定、可撤销，断网/重启后不重不丢。
- Non-claim: Direct Model 不做实时引导（live steering）；external runtime 的会话内注入本期不做；排队消息服务端不可编辑（取消+重发语义）。

### AUD-O03：提问、审批与恢复是同一任务中的显式动作

- Before: AskUser 与 tool approval 机制存在，但写/命令工具不存在，恢复三动作只覆盖既有能力；断网/重启作为“同一用户任务”未串验。
- Target: AUD-03 让写/编辑/命令默认逐次审批并显示 diff、命令、工作目录与风险；AUD-07 串验审批后续跑、断网回放、切页 catchup、Desktop 重启与未知副作用三恢复动作。
- Expected effect: 每次副作用都知情授权，中断后用户知道哪些已发生、哪些可安全继续，无需猜测。
- Non-claim: 不做跨会话“记住自动批准”；Station 重启的全部检查点语义以实际 Journey 证据为准，未证即 UNPROVEN。

### AUD-O04：开箱具备读、写、受控命令、联网取证与任务清单能力

- Before: 默认工具仅文件读/目录列举/剪贴板、shell 仅 pwd/list_dir；无写文件、无真实命令、无 web、无 todo；参考客户端对照下 Agent 无法独立完成修改/构建/取证类任务。
- Target: AUD-02 提供 STATION 侧 web_fetch（SSRF 约束）与 todo（progress 持久化）；AUD-03 提供 workspace 内 write/edit 与 shell allowlist，经审批与围栏执行；首次任务环境段说明能力与阻塞。
- Expected effect: 普通用户无需自行配置 executor，Agent 即可在沙箱工作目录完成“读-改-验证-修正”闭环并引用网页证据。
- Non-claim: 不开放任意外壳、不出根写、不提供进程托管/PDF 解析；allowlist 是受限清单而非通用终端。

### AUD-O05：真实文件产物可打开、迭代并跨设备获取

- Before: 产物只是 assistant 文本的代码块/Markdown 提取（store/chat.ts）；workspace 文件是 DB 行；OSS presign 写好未接线。
- Target: AUD-04 引入 TurnArtifact 元数据与 client_local_ref/station_object_ref 两种定位；原设备打开/定位/再编辑，上传后任意设备下载；代码块提取降级为消息内展示。
- Expected effect: 任务指定“生成文件”时交付可再次打开、可继续修改的真实对象，并可核对由哪个 Turn/工具产生。
- Non-claim: 不做协同编辑/版本 diff 浏览器；仅本机持有的文件在其他设备不可假下载。

### AUD-O06：Skill 是带版本资源、可按说明完成工作的能力包

- Before: skill_view 只返回 manifest content（≤100KB 文本），无 references/scripts/assets；“能读说明”与“能按说明工作”之间断裂。
- Target: AUD-05 让资源在执行位置解析：Station 版本化文本资源可读；CLIENT 包物化到只读受管目录，脚本只能经 AUD-03 命令 allowlist 调用，输出落在 workspace。
- Expected effect: Agent 按需读取完整 Skill 资料、依据其流程连续完成任务，且资源版本与历史归因可回溯。
- Non-claim: 不承诺二进制资产、任意脚本解释器、Git 自动摄取与本地 Git reference；内容扫描不宣称恶意代码检测。

### AUD-O07：能力供给面（知识/记忆/MCP/默认模型）配置即真实生效

- Before: Knowledge 真实端无设置面（descriptor API 无 UI），检索为 64 维 hash 词袋；Memory 配置节假绿灯且条目不可编辑；MCP 编辑不重发现、零工具可绑定风险；默认 provider 无 Station 真相。
- Target: AUD-08/12/13/14 分别让 Knowledge 真实 CRUD+诚实检索标注、Memory 真实状态+编辑删除、MCP revision 重发现+readiness 绑定门槛、默认模型落 Station runtime config 与真实状态灯。
- Expected effect: 用户在 Settings 的每项配置都在同一条 Station 链上影响下一轮对话，没有“保存成功但什么都没发生”的剧场控件。
- Non-claim: Knowledge 持久向量化、Git 摄取、Memory consolidation 本期不做；无权威的数值（百分比/向量数）不显示。

### AUD-O08：定时任务、Lark 与 Bot 渠道形成真实自动闭环

- Before: Cron UI 深但接 Rust 内存假仓（重启丢失、run 伪造）；Lark 投递链真实但 UI 不展示权威数据；Bot 能发言但与 Agent 零绑定，入站不触发 Turn。
- Target: AUD-09 Station 持久调度（专属会话、override、一次性退役、history）并删除假 cron；AUD-11 配置面接真实 automation/event-list/delivery；AUD-10 Bot 绑定 Agent 后入站消息投影为 Turn 并以 bot 身份回复。
- Expected effect: Agent 能按时工作、按渠道事件工作、以机器人身份对外工作，结果都可在 Station 回读。
- Non-claim: 不做 shell/workflow 调度类型；不做云端执行；CLIENT 工具任务在桌面离线时如实失败而非假成功。

### AUD-O09：Station 单一真相：身份、调度、记忆、产物无双 owner

- Before: Rust cron 本地仓、Memory 本地假配置、生产 mock-gateway 死代码、AgentGrowthTab 建成未挂且操控内存 scheduler，存在多份事实或半成品并存。
- Target: AUD-01/09/12/15 把预算、调度、记忆配置、roster 绑定全部收敛到 Station；AUD-16 删除死代码与假入口；GrowthTab 仅在持久调度接通后挂载。
- Expected effect: 任意设置/状态只有一个权威，重启与跨端一致，代码库不存在长期双轨。
- Non-claim: CLIENT-owner 执行能力（本地文件、client MCP）按架构留在桌面，但其清单/绑定/回执真相仍在 Station；这不是双 owner。

### AUD-O10：执行 owner、围栏与密钥边界不被能力扩展削弱

- Before: 围栏体系（租约、PREPARED、fencing、receipt ledger、opaque_ref、MCP SSRF、密钥不回客户端）已完备，但可执行工具面极窄。
- Target: 新工具全部走既有围栏：写/命令 CLIENT owner 逐次审批、workspace 沙箱、变更摘要；web_fetch 复用 SSRF；产物经 opaque_ref；MCP 双 owner 不新增协议；渠道密钥继续只 Station 落账。
- Expected effect: 能力变多而破坏面不扩大：每次副作用 exactly-once、可审计、可拒绝、可恢复。
- Non-claim: 不放宽 64KB fenced 参数上限（大文件协议另立计划）；不把本机绝对路径写入共享业务状态。

### AUD-O11：新合同 proto-first，迁移与调度复用既有设施

- Before: Growth 11+ 端点仍用临时 JSON；调度只在 channel automation 有持久 next_due_at 模式；产物/绑定/Skill 资源缺少线合同。
- Target: AUD-03/04/05/09/10 的新数据先改 model/domain proto 并经 ./model/build.sh 生成；调度复用 channel automation 模式；产物 blob 复用 OSS；AUD-15 对触及的 Growth JSON 补 proto。
- Expected effect: Desktop Rust/React 与 Station 共享生成合同，无手写并行 DTO；新表迁移与 worker 注册方式一致。
- Non-claim: 不重写 provider/turn 内核；不借机版本化整个 Growth 面（只补触面条目）。

### AUD-O12：五个真实任务 Journey 整体 FUNCTIONAL_PASS，假面零遗留

- Before: 单模块门禁可全绿而整体故事断裂（原型阶段已发生：名册分裂、选择器被遮罩层盖住但语义门禁全绿）；生产端仍有假 cron、假 TTS、死 mock-gateway。
- Target: AUD-16 以普通用户路径（make desktop，无 Harness 注入）证明 TD-J01…J05：连续交付文档、修改并验证文件、运行中补充、介入与恢复、长任务与产物迭代；同时完成假面清理与原型/coverage/i18n 同步。
- Expected effect: “整体 Agent 能力达到参考客户端可用性水平”成为有当前源码证据的命题，而不是入口数量或 Gate 数量。
- Non-claim: 不替代正式 Acceptance/Station Suite（保持 UNPROVEN）；无同模型对照的性能数值结论；Owner 亲自验收前不提交 MR。

### 明确不变与非目标

- MCA 已接受的 Station 真相、admission FIFO、capability authority、D29 external runtime、不可变归因全部保留；本轮不做 Evaluation 扩展、市场/Hub、Workflow、Plugins/Hooks、多 Agent、云设备、consolidation、Git 摄取、Your Station 设置节。
- Mobile 仅保持合同兼容；Browser 不增加产品承诺。
- 不授权 push、PR、远程部署、数据重置或历史改写。

### 风险与回滚影响

- 预算放宽增加 provider 消耗：以步数/工具数/时限墙与循环检测约束，Journey 核对成本。
- 写工具扩大破坏面：workspace 根 + 逐次审批 + exactly-once 围栏 + before/after hash；默认目录在应用数据区。
- CLIENT owner 离线：能力广告降级、调度任务显式失败，普通对话不阻断。
- 每个 cutover（假 cron、假 Memory 配置、产物提取、Growth 挂载）为原子替换，回滚走 VCS revert，不留 flag/双写；中间提交必须可编译可运行。

## Actual Outcome Results

> 状态词汇：`SOURCE_VERIFIED` = 当前源码已实现且 Station Go / Desktop vitest 相关门禁在引用 commit 通过；
> `FUNCTIONAL_PASS` = 普通用户 Journey 在 `make desktop` 当前源码通过；
> `UNPROVEN` = 尚无可引用的当前源码 Journey 证据。
> 本轮回填（2026-10-27，HEAD `cd021fcfb`，分支 `feat/paos-active-cancellation`）：
> V01–V14 的构建/单测/集成证据齐备，故 O01–O11 记 `SOURCE_VERIFIED`；
> O12 要求的 TD-J01…J05 与 AUD-10/11/13/14 原生 Journey 未在本机运行
> （缺 webkit2gtk-4.1/libsoup，`make desktop` 无法构建），保持 `UNPROVEN`，不回填。
>
> 追加回填（2026-10-26，HEAD `f84f3478b`）：
> TD-J01…J05 的 tauri-playwright 规格已落地（f84f3478b）；编写中发现真实产物门户在
> 实时会话中缺少普通用户入口（MessageList 未接 onOpenArtifact、portal toggle 无生产调用方），
> 已补 TurnArtifactBar 入口（04ecf6f7e，Station 真相按 turnId 投影）；
> MCP ready 门槛补 failed-probe/zero-tool 回归钉测（87855b08a）。
> Journey 本体仍未在 GTK/WebKit 环境运行，O12 保持 `UNPROVEN`。
>
> 追加回填（2026-10-26，原生 Linux GTK/WebKit 验收单元 `pt-aud-cell`，分支 `feat/paos-active-cancellation`）：
> TD-J01…J05 已在容器内逐旅程实跑。为打通本地写/壳链路，补齐了缺失的 workspace 资源授权生命周期
> （proto `CLIENT_CAPABILITY_COMMAND_DOMAIN_DECLARED_RESOURCE_GRANTS`、Station 授权表/服务/迁移、
> Desktop per-actor workspace 物化与 lease 注册/续期声明，Go 单测通过）；并修复了
> `agent.go` 回填漏注册 web_fetch/todo 工具、todo 跨 turn 主键/排序等真实缺陷。
> 规格侧按 tauri-plugin-playwright 0.4.1 服务端 `eval_js` 30s 硬上限改为 evaluate 轮询，
> 修正 textarea 注入、readiness 门槛与导航真实可点控件。
> 但自 2026-10-26 08:08 UTC 起 Ark 唯一自定义接入点 `ep-20260623145021-n4xdm` 对公网返回
> `403 AccessDenied / Account is not allowed to access endpoint via public network`，
> 直连 curl 与 Station 真实 turn（`turn_2f2813068758335f2e4bbbfd`，http=403 reason=auth）
> 指纹一致；账号禁用 Model ID 直调，无替代模型。最后一次模型成功为 07:54:58 UTC。
> 全部旅程在 provider admission 即失败，O12 保持 `UNPROVEN`（外部账号策略阻塞，非产品/规格缺陷），
> 证据见 `tooling/acceptance/reports/agent-usability/provider-block-ark-403-20261026.json`。
> 解除阻塞（恢复接入点公网访问/换新接入点或可信出口）后可直接复跑，规格无需再改。
>
> 最终回填（2026-10-27，HEAD `c1992b380`，pt-aud-cell，原生 GTK/WebKit）：
> TD-J01…J05 顺序实跑 5/5 一次通过（11.5m，--workers=1，retries=0），O12 转 `FUNCTIONAL_PASS`，
> 证据 `tooling/acceptance/reports/agent-usability/td-j0{1..5}.{json,png}`（commit=c1992b380）。
> 顺序运行暴露并修复了一个真实缺陷：renderer reload 的 session takeover 踢掉旧 auth session 后，
> 旧 capability lease 仍被 Station 判活，reload 后的 turn 会 pin 到孤儿 lease（J04 现场
> turn_6412f2e0 → capability_session_e48cfb，tool_deadline_expired）。修复见 `7d35b8475`
> （active-lease 判定统一要求父 actor_sessions 存活）与 `c1992b380`（Desktop 发送选路取
> Station 会话真相 + 注册空窗 warmup 收敛）。Ark 接入点本轮可达，前序 403 未复现。

```json outcome-comparison-results
{
  "kind": "peers-touch-outcome-comparison-results",
  "schemaVersion": 1,
  "planId": "AUD-20261025",
  "sourceIdentity": {
    "branch": "feat/paos-active-cancellation",
    "head": "87855b08a",
    "recordedAt": "2026-10-26"
  },
  "items": [
    { "id": "AUD-O01", "status": "SOURCE_VERIFIED", "actualEffect": "续跑预算与 provider 重试分离（bb1a38640），统一 Turn 时间线组件与恢复 store 在既有提交中落地；长依赖链由 Station admission 步数预算驱动。", "evidenceRefs": ["bb1a38640", "go test ./app/subserver/agent/...", "pnpm vitest run agent-turn-recovery chat"], "deviation": "TD-J04 原生 Journey 未运行，见 O12。" },
    { "id": "AUD-O02", "status": "SOURCE_VERIFIED", "actualEffect": "运行中发送进入 Station 持久 FIFO，多并发排队（c13ed7bfd）、队列快照绑定（c0bd9a78c）、托盘条目（6e9ac3cff）。", "evidenceRefs": ["c13ed7bfd", "c0bd9a78c", "6e9ac3cff", "pnpm vitest run chat"], "deviation": "排队项重启对账的原生 Journey 未运行。" },
    { "id": "AUD-O03", "status": "SOURCE_VERIFIED", "actualEffect": "写/编辑/allowlist shell 经既有逐次审批与围栏执行（3ec29ee7b），AskUser/decision 续跑链路保留；recovery 单测 263 项通过。", "evidenceRefs": ["3ec29ee7b", "pnpm vitest run agent-turn-recovery chat"], "deviation": "审批后续跑/重启三动作的端到端 Journey UNPROVEN。" },
    { "id": "AUD-O04", "status": "SOURCE_VERIFIED", "actualEffect": "开箱 web_fetch/todo（9caffea66）与 workspace 写/编辑/受控命令（3ec29ee7b）均为 Station 侧真实工具。", "evidenceRefs": ["9caffea66", "3ec29ee7b", "go test ./app/subserver/agent/service"], "deviation": "无；allowlist 边界未放宽。" },
    { "id": "AUD-O05", "status": "SOURCE_VERIFIED", "actualEffect": "TurnArtifact 双定位持久化（b400ee25e），代码块提取降级为消息内展示；补齐实时会话缺失的普通用户入口——AssistantMessage 新增 TurnArtifactBar，按 turnId 从 Station 真相投影真实产物并打开既有 portal 详情（04ecf6f7e）。", "evidenceRefs": ["b400ee25e", "04ecf6f7e", "pnpm vitest run messages chatArtifacts"], "deviation": "TD-J05 产物再打开/跨设备 Journey 未运行（见 O12）。" },
    { "id": "AUD-O06", "status": "SOURCE_VERIFIED", "actualEffect": "Skill 版本化资源 Station 持久（440d22635）、读取（e13bc8590），受管 ZIP 物化与 owner 固定只读读取（39f269bbc）。", "evidenceRefs": ["440d22635", "e13bc8590", "39f269bbc"], "deviation": "无；二进制资产/Git 摄取仍为 nonGoal。" },
    { "id": "AUD-O07", "status": "SOURCE_VERIFIED", "actualEffect": "Knowledge CRUD/正文读取（cc989debb）、Memory 诚实配置+编辑删除（eae9d7354）、MCP revision/重发现/绑定门槛沿用既有 Station 实现并补 failed-probe/zero-tool 不发布 manifest/不注册工具/重启恢复仍不绑定的回归钉测（87855b08a）；默认 provider/model 落 Station runtime_defaults 且状态灯改为三态（cd021fcfb）。", "evidenceRefs": ["cc989debb", "eae9d7354", "cd021fcfb", "87855b08a", "go test ./app/subserver/agent/... -run 'MCP|Provider|RuntimeDefault'"], "deviation": "MCP 双 owner 原生 Journey 未运行。" },
    { "id": "AUD-O08", "status": "SOURCE_VERIFIED", "actualEffect": "持久调度（e0428797f）、Lark Topics 真实投影（a84398e94）、Bot↔Agent 绑定后入站消息经 bot_agent_binding 投影为持久 Turn 并以 bot 身份回复（fa906d459）。", "evidenceRefs": ["e0428797f", "a84398e94", "fa906d459", "go test ./app/subserver/{agent,channel,bot,conversation}/..."], "deviation": "真实/夹具入站到投递回读的 make-desktop Journey 未运行。" },
    { "id": "AUD-O09", "status": "SOURCE_VERIFIED", "actualEffect": "内存 cron 与假 scheduler 控制面拆除（703c92c6e, 26e65da81），Growth Tab 挂持久调度；roster 同源由源码钉测试固定（agentRosterConsistency.test）；假 TTS/mock-gateway 已删（40baf34a1）。", "evidenceRefs": ["703c92c6e", "26e65da81", "40baf34a1", "pnpm vitest run agent-roster"], "deviation": "无。" },
    { "id": "AUD-O10", "status": "SOURCE_VERIFIED", "actualEffect": "新工具/调度/Bot 回复均复用既有租约、fenced receipt、SSRF、密钥只 Station 落账；Bot 密钥不回客户端（0bf1bb65b handler 校验）。", "evidenceRefs": ["3ec29ee7b", "9caffea66", "0bf1bb65b"], "deviation": "无；64KB fenced 上限未放宽。" },
    { "id": "AUD-O11", "status": "SOURCE_VERIFIED", "actualEffect": "ScheduledJob、BotAgentBinding、QuickCompletion、RuntimeDefault 均 proto-first 并经 ./model/build.sh 生成，无并行手写 DTO。", "evidenceRefs": ["e0428797f", "7da4f1030", "c20509d6", "a2187cba0"], "deviation": "Growth 其余未触及端点保持原状，未借机构造。" },
    { "id": "AUD-O12", "status": "FUNCTIONAL_PASS", "actualEffect": "2026-10-27 在原生 Linux GTK/WebKit 验收单元 pt-aud-cell 以普通用户路径（socket-bridge TauriPage，无 mock/harness）顺序执行 TD-J01…J05，5/5 一次通过（11.5m，--workers=1，retries=0）：多步检索报告、目录编辑真实检查失败后修复复验、运行中 FIFO 排队与取消、AskUser 澄清同 turn 续跑且 reload 重启后不重复、长任务产物重开与历史归因均由真实 turn/工件/Station 真相锚定。修复了阻断顺序实跑的真实缺陷：renderer reload 的 session takeover 会踢掉旧 auth session，但旧 capability lease 行在自身 TTL 内仍被判活，导致 reload 后的 turn pin 到孤儿 lease、客户端工具无人 pull 到 deadline 超时（TD-J04 现场：turn_6412f2e0 pin capability_session_e48cfb，父 session 03:56:46 已 kicked，03:59:00 tool_deadline_expired）。Station 侧所有 active-lease 判定统一要求父 actor_sessions 未注销且未过期（7d35b8475），孤儿 lease 立即不可选、不可派发、入队 turn 在 admission 快速失败；Desktop 侧以 Station 会话列表真相在发送时解析 pin（readiness 选中项失效时回落到当前 live lease），并在 worker 重新注册的数秒空窗内做有界 warmup 收敛（c1992b380）。现场复验：reload 后 06:18:30 注册新 lease，06:18:31 turn 启动即 pin 新 lease，local_file_write 06:18:49 succeeded。", "evidenceRefs": ["c1992b380", "7d35b8475", "tooling/acceptance/reports/agent-usability/td-j01.json", "tooling/acceptance/reports/agent-usability/td-j02.json", "tooling/acceptance/reports/agent-usability/td-j03.json", "tooling/acceptance/reports/agent-usability/td-j04.json", "tooling/acceptance/reports/agent-usability/td-j05.json", "tooling/acceptance/reports/agent-usability/td-j01.png", "tooling/acceptance/reports/agent-usability/td-j02.png", "tooling/acceptance/reports/agent-usability/td-j03.png", "tooling/acceptance/reports/agent-usability/td-j04.png", "tooling/acceptance/reports/agent-usability/td-j05.png", "go test ./app/subserver/agent/...", "pnpm exec vitest run src/store src/runtimes", "cargo test --features e2e-testing snapshot_all_orders"], "deviation": "无。前序 Ark 接入点公网 403 在本轮未复现（J01 长检索链真实完成，接入点本轮可达）；FUNCTIONAL_PASS 仅覆盖上述 5 个 Journey 与单 worker 的 GTK/WebKit 单元，不延伸性能数值、多设备并发或正式 Acceptance/Station Suite 结论。" }
  ]
}
```
