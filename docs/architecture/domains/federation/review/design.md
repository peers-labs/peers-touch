# 联邦组网与日常通信闭环 — 评审设计

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-10-28 | **Updated**: 2026-10-28
> **Owner**: Federation / Conversation / Client Runtime

本稿回答三件事：连接分别指什么；源码已有、需要改造和缺失什么；如何把组网和聊天做成简单、可恢复的产品流程。它是现有 Federation 文档集的评审材料，不是新建的 active 模块，也不替代已接受的架构。

源码基线为 `0aa6572ec`。以下“已有”表示在该源码中找到实现，不表示本轮已运行或验证。所有目标行为、类型、端点与数值预算均为提案。候选实施路径见[实施细则](../execution-plans/20261028-product-closure/candidate.md)；全部新增产品结果目前为 `UNPROVEN`。

## 1. 三种连接及其关系

**客户端接入**：Client ↔ Home Station。决定登录谁、访问哪个账户空间、设备凭据和路由如何恢复。普通用户首次选择服务站点，此后自动恢复。同一个 Station 的直连/Relay 切换不切换账户身份。

**联邦组网**：Station ↔ Station。包含两个独立条件：Node Connectivity 提供可认证的传输；Federation 提供成员关系、治理、发现范围和业务授权。网络可达不能证明加入了联邦，成员 active 也不能证明当前能通信。

**Chat 业务通信**：两个 Actor 的设备通过各自 Home Station 完成建会话、密钥准备、加密投递、解密展示和回执。同站无需跨站运输；跨站调用复用 Node Connectivity，权限仍由 Federation 和 Conversation 裁决。Chat 不是另一套组网协议。

以下仅为调用顺序的辅助说明，不是新的主架构图：

```text
接入：    Client -> Home Station
同站聊天：Client A -> 同一个 Station -> Client B
跨站聊天：Client A -> Station A -> authenticated transport -> Station B -> Client B
治理：    Station operator -> Federation authority -> Ledger -> member replicas
```

不要求每个 Station 与所有成员永久建立连接，不建立 Federation 专属 Relay mesh。单个可用的目标业务路由足以执行相应操作；全局 DHT peers 数量不能作为所有本地聊天和所有跨站操作的统一开关。

约束继续来自 [Station Access](../../../platform/station/access/README.md)、[Node Connectivity](../../../platform/runtime/node-connectivity/README.md)、[Federation](../design.md)、[Messaging Platform](../../chat/messaging/README.md) 和 [Chat Lifecycle](../../chat/lifecycle/README.md)。

## 2. 源码对账：已有、改造、缺失

### 2.1 已有且应复用

- **E01 接入与身份底座**：签名 Station identity、逻辑 Station 与 Node 身份隔离、route-aware binding 和设备 Session。继续由 Station Access / Node Connectivity 管理。
- **E02 传输与可靠投递**：[shared peer client](../../../../../apps/station/frame/core/federation/peer_client.go)、[Federation runtime](../../../../../apps/station/frame/core/federation/runtime.go) 与 [durable delivery](../../../../../apps/station/frame/core/federation/delivery/) 已存在。复用认证调用、outbox、receiver 去重；不另造 socket、消息队列或投递框架。
- **E03 治理账本与基础生命周期**：[Federation application](../../../../../apps/station/app/subserver/federation/application/) 已有创建、签名/hash 校验、批准加入、bootstrap replica、退出与归档；[handler](../../../../../apps/station/app/subserver/federation/handler.go) 对本地治理要求 Station owner 或委派角色。
- **E04 多联邦及投影**：[membership/role/cursor repositories](../../../../../apps/station/app/subserver/federation/domain/repository.go) 和 `/sub-federation/contexts` 已存在；同一 Station 可以持有多个 Federation。
- **E05 目录与准确身份解析**：[catalog handler](../../../../../apps/station/app/subserver/federation/handler_catalog.go) 有 scoped 查询、成员筛选、可见性和远端缓存到期过滤；handle resolver、签名 profile 和 locator 有实现。
- **E06 Chat 生命周期底座**：[Conversation](../../../../../apps/station/app/subserver/conversation/)、[shared messaging-core](../../../../../packages/messaging-core/)、[client-chat-core](../../../../../packages/client-chat-core/) 与 [Native adapter](../../../../../apps/desktop/src-tauri/src/messaging/) 已有会话 authority、设备注册/密钥、Direct/MLS、投递与恢复。通用 codec、存储和 inbox 行为沿现有共享 owner 修改，双端 Host 只接入；Station 可达只是前置条件之一。
- **E07 部分原生证明工具**：[现有 Federation feature](../../../../../tooling/acceptance/features/federation-full-lifecycle.yaml) 注册了 unit、access boundary 和 [two-Station lifecycle Gate](../../../../../tooling/acceptance/gates/federation/two_station_lifecycle_e2e.py)。测试包含基础加入等流程；名称中的 invite 不代表定向邀请、人工审批已经实现。

### 2.2 有实现，但必须改造

- **M01 “连接健康”语义**：[health handler](../../../../../apps/station/frame/touch/federation_health_handler.go) 返回 bootstrap/DHT 计数，没有填充 proto 中的 governance sync 字段。需拆分路由、成员/同步和消息状态，不能把 peers 或 membership active 显示为“聊天正常”。
- **M02 同站聊天依赖联邦**：[CreateDirect handler](../../../../../apps/station/app/subserver/conversation/production_http.go) 无条件构造 `FederationID`；[Native engine](../../../../../apps/desktop/src-tauri/src/messaging/engine.rs) 也拒绝空值。command、aggregate 和 wire 同样有 scope 约束，改 UI 参数不足以解决。
- **M03 远端 join 的授权过程**：[proposal handler](../../../../../apps/station/app/subserver/federation/handler_governance.go) 收到 `STATION_JOIN_APPROVED` 提案后直接调用批准服务；传输身份校验存在，但没有完整的邀请/待审批产品状态。需将“请求者希望加入”与“有权者批准加入”分离。
- **M04 同步状态与恢复**：[sync manager](../../../../../apps/station/app/subserver/federation/sync_manager.go) 定时拉 sequencer；缺 fetcher、成员或 endpoint 时可直接返回，网络错误主要进入日志。cursor 实存 head、applied seq 和 status，没有 proto 的同步时间/error 字段。需落地失败状态、分页追赶和有界恢复。
- **M05 目录搜索范围**：现有 catalog 查本库本地 Actor 与未过期 remote cache；指定非本地 Station 返回空，没有向远端目录发起查询。不能把它解释为“搜索全联邦”。
- **M06 bootstrap 更新**：[seed parser](../../../../../apps/station/frame/core/plugin/native/federation/seeds.go) 和 [bootstrap](../../../../../apps/station/frame/core/plugin/native/subserver/bootstrap/bootstrap.go) 有静态 seeds 与连接尝试。需要可更新、经过信任验证的候选源和失效淘汰，单纯增加重试次数无法替换退役 seed。
- **M07 客户端上下文**：现有 [Federation runtime](../../../../../apps/desktop/src/runtimes/federationRuntime.ts)、store 和 [StationPicker](../../../../../apps/desktop/src/components/common/StationPicker.tsx) 应改为消费统一投影与自动选择结果。日常找人、建群不应要求用户理解 FederationID 或 route/cache 状态。
- **M08 站内找人边界**：现有 Social `/api/v1/social/users/search` 调用 [SearchActors](../../../../../apps/station/frame/touch/actor/service.go) 搜索本库，查询本身没有限定 local origin、discoverability 或 cache expiry。可复用入口与 Actor owner，但不能直接把本库结果当作合规的站内目录。

### 2.3 缺失的完整能力

- **N01 管理员组网工作台**：现有 [Dashboard router](../../../../../apps/station/app/subserver/dashboard/web/src/components/PageRouter.tsx) 有 Transport / Relay Attachments 等页面，没有完整的 Federation 邀请、审批、加入进度、恢复和退出工作台。
- **N02 可恢复的组网操作**：需要持久 operation intent、定向邀请、真实 approver 授权、批准后 bootstrap、结果查询与取消语义。proto 已有 `StationInvitedPayload`、`StationJoinRequestedPayload` 等形状，不等于处理链已落地。
- **N03 无预缓存的远端发现**：需要 Federation-owned 的远端目录服务和 Home Station 聚合，返回覆盖范围与部分失败；不能靠 fixture 预填 remote cache。
- **N04 组网控制面的故障闭环**：需要失联降级、同步新鲜度、计划性交接和 sequencer 丢失说明。[single_admin policy](../../../../../apps/station/app/subserver/federation/domain/policy/single_admin.go) 已有方法，但不能据此声称生产 handover/election 可用。
- **N05 分层诊断与用户说明**：接入、成员/同步、具体 Chat 失败需要可区分、可操作、经过权限裁剪的解释，附管理员手册与普通用户说明。

## 3. 用户流程与信息边界

### 3.1 普通用户

首次：选择/接受一个可信服务站点 → 登录 → 找人或打开已有聊天。接入地址只在首次配置、换站点或高级排障时出现。

找人：输入名称 → 显示本地及有权限搜索到的远端结果 → 必要时用人名、头像、站点名称区分同名人 → 加好友/发消息。查询默认覆盖当前账户可用范围，客户端不要求先选 Federation。准确 handle 或联系人分享链接保留作消歧入口。

聊天：选联系人 → 服务端准备/复用会话 → 输入消息。界面显示“发送中”“已送达”“等待恢复”“无法发送”等业务状态；其中“已送达”遵守现有 Chat 回执合同，不能由 peer HTTP 成功或 Station 入队直接推导。

建群：选人 → 服务端提前验证全体成员的共同 scope → 创建群。无法容纳的人在创建前指出原因，不在提交后给出 FederationID 不一致的技术错误。

普通用户没有加入/退出 Station 联邦、挂载 Relay、修改 bootstrap 或管理 Ledger 的按钮。全局 Settings 的“连接”只读显示服务站点、当前受影响的能力及可执行的用户恢复动作；高级诊断按权限展开。

### 3.2 Station 管理员

入口为 Dashboard 的“网络 / 联邦”；创建、审批等按钮依服务端 capability 投影，而不是前端猜测权限。

创建：输入网络名称与说明 → 选择默认受邀加入策略 → 创建 → 显示可邀请成员。`single_admin` 在高级策略中解释为单一治理写入者，不让管理员配置共识术语。

邀请加入：邀请方通过可信站点资料或地址解析目标 Station 身份 → 生成绑定目标的邀请链接 → 接收方打开链接，看见网络、邀请者站点、共享范围与到期时间 → 本地管理员确认 → 自动验证、加入、同步 → 显示“已加入，通信能力可用”或准确的降级状态。

申请加入作为独立入口：接收方输入网络邀请/入口资料 → 提交申请 → “等待管理员批准” → 批准后自动同步。默认邀请已代表一次明确的 Federation 管理员授权，无需再点击批准；没有有效邀请的申请才进入审批队列。

退出：展示受影响的远端联系人/群数量 → 确认 → 停止发起新的相关跨站写入 → 提交退出 → 显示已退出或“正在等待网络确认”。sequencer 退出前必须完成交接或显式归档，不能假装退出成功。

### 3.3 简化的边界

对普通用户隐藏 PeerID、multiaddr、sequencer、Ledger seq、Relay reservation 和密钥编号。站点名称、人物身份消歧、审批者、权限影响与失败恢复仍需保留。

隐藏技术参数不等于跨越信任边界。没有共同授权范围时，联系人分享链接只能提供准确身份线索，不能自动让两个 Station 互信或自动加入 Federation。

## 4. 治理细则：信任、状态和持久化

### 4.1 邀请与授权

邀请至少绑定 `invitation_id`、FederationID/genesis hash、issuer Station identity、目标 Station identity、审批者 Actor、角色上限、expiry 和 nonce；使用已有 Station/Actor 签名机制。完整新增 wire 字段在实现前由 Federation proto owner 定义，不手写并行 TS/Go 模型。

入口 URL 是 locator，不是真正身份。首次信任通过管理员从可信渠道取得的邀请材料确认，随后固定 issuer identity/genesis；“签名自洽”本身不证明陌生邀请者可信。远端跳转不得更换已固定的身份。邀请内容校验失败不触发持久 membership。

本地 Station 管理权限与 Federation 审批权限分别检查。审批事件携带真实 approver 或已定义的委派证明；禁止借用 Federation creator 的私钥把其他人的操作伪装成 creator 批准。

邀请消费采用 CAS/唯一约束：相同 invitation + 相同目标 + 相同请求内容重试返回既有结果；目标或 payload 冲突返回 typed conflict。已批准 invite 撤销不能抹去已生效 membership，需走 removal/leave。

### 4.2 operation 与 membership 分开

新建 Federation-owned 持久 operation，保存 operation ID、kind、目标身份、request digest、幂等键、申请/授权证明引用、阶段、已确认 event/head、重试时间与错误码。敏感邀请凭据不进入普通日志或 Ledger。

组网操作阶段为 `validating -> awaiting_approval | submitting -> replicating -> completed`；还可进入 `retry_wait`、`rejected`、`cancelled`、`expired`。这些是提案中的操作状态，不是 Ledger 已有 membership enum。

membership 继续仅由已验证 Ledger replay 派生。接收方收到批准响应后，还必须校验 bootstrap 并 materialize 自己的 active membership；批准成功而复制失败显示“已批准，正在恢复”，不误报正常或重新申请。

operation worker 使用现有进程生命周期/存储设施，以租约或事务锁确保同一 intent 只有一个执行者。重启后从已确认阶段恢复；取消 context 和停机释放执行权，不能清空 intent。

取消审批前可终止申请；提交后先查询权威结果。若已批准，不把 UI 取消映射为不存在 membership，而是提示退出动作。邀请、申请、批准、复制和退出都必须支持响应丢失后的同幂等键恢复。

### 4.3 sequencer、同步与撤销

同期只有一个治理写入者；其他成员只可复制已验证日志和提交提案。断连不自动删 membership，也不依据超时选举新 sequencer。

sync cursor 扩展 last attempt/success、remote head、applied head、typed error、next retry；这些是持久观测事实，业务角色仍由 Ledger 派生。只有已追平已验证 head 才显示 healthy；一次分页成功但仍落后应为 lagging；同 seq 不同 hash 为 fork，不归一成网络错误。

sequencer 暂时不可达时，继续读已有历史；禁止新的加入、角色变更和其他治理写入。同步新鲜度到期后，相关新跨站业务写入等待恢复。同站 LocalStation Chat 不受影响。具体新鲜度方案见 §7，不能声称在网络分区下同时保证无限可用与即时撤销。

计划性交接为独立操作：旧 sequencer 冻结普通治理写入并固定交接前 head/epoch → 新 sequencer 验证追平并证明身份/签名键 → 旧 authority 仅允许提交该 operation 的 `SEQUENCER_CHANGED`，形成旧 writer 的最终 head → 新旧节点固定切换边界并复制确认 → 新 writer 接管。接收证明绑定前置 head、新 epoch 和目标身份；提交采用 head CAS。每一步持久且幂等；旧 writer 在已签署交接后保持写入 fence，重启也不得越过最终 head。

旧 sequencer 永久丢失而没有有效交接证明，进入只读/需管理员恢复的明确状态。可从其他成员读取验证过的 Ledger，但不能据此恢复写 authority。灾难接管/共识选举不在本轮暗中实现。

### 4.4 bootstrap 与路由

Node Connectivity owner 维护 seed candidate 的签名来源、generation、expiry、健康与淘汰；复用已有受信配置/候选发布机制，增加运行中刷新与失效恢复。

允许来源为已验证的配置快照、管理员固定的入口和已验证的 Station route 资料。新候选仍须通过 Node 身份与 route audience 校验。Fed membership URL 是联系线索，不是绕过 transport trust 的拨号白名单。

已有 direct/Relay 自动选择、连接退役与 route lease 保持单一 owner。所有旧 seed 退役时重新获取受信候选，不循环拨同一批旧地址；没有任何受信可用入口时准确报告给管理员，不伪称能够凭空发现网络。

## 5. 远端找人与多联邦聚合

由 Home Station 的 Federation discovery service 聚合“本地人员 + 当前用户有权查询的 Federation”，客户端只消费结果。底层每次 peer query 仍带明确 FederationID；本地范围有独立的站内发现授权，不伪造本地 Federation。

本地人员从 Social/Actor-owned 站内查询端口取得，仅返回 local origin 且对 requester 可发现的 Actor，保留 moderation；没有 Federation 时独立返回。本地查询合同在站内 Chat 闭环先落地，远端聚合随后复用，不能令站内找人等待联邦组网。

每个成员 Station 提供只查其本地 Actor 的 scoped catalog peer capability；拒绝递归 fan-out。接收方检查调用 Station 身份、双方 active membership、新鲜度、Actor discoverability 与限流。默认只搜索允许被索引的 Actor；受限 profile 继续由原隐私 owner 裁决。

聚合器按 `(ActorRef, home_station_peer_id)` 去重，保留其可用 scope 集合作为内部上下文；人名相同不合并不同身份。联系人已缓存的单个 FederationID 不作为新的唯一通信凭据。

返回 `complete/partial/unavailable`、查询计划覆盖范围、可继续的分页游标和权限裁剪后的失败原因。“partial 下未找到”不能宣称此人不存在；隐藏/无权结果不得通过错误细节泄漏。

分页 token 绑定 requester、query digest、context set、member-head generation、游标与 expiry，由 Home Station 认证。成员或权限变化使旧 token 失效并要求重新查询，不用未经绑定的 offset 混合多站结果。

预算提案：输入稳定 300 ms 后查询；每轮聚合最多并发 4 个远端调用，单个调用上限 3 s，总响应窗口 6 s，每页默认 20 条、上限 100 条。更大成员集必须标注未覆盖部分并提供继续查询，不把前几站结果称为全量。预算未通过现场测量。

profile/cache 必须保存来源身份、适用 scope、签名/expiry 和验证状态；缓存不能扩大权限。到期只可用于已有联系人身份展示，新的发现/授权要重验。原始搜索词和完整目录不进入无必要的运维日志。

不新增全局公开人员库，不让 Relay 承载业务目录，不借用本机 Search 模块作为 Federation discovery authority。

## 6. Chat scope 与存量迁移

### 6.1 新建会话

**D01 提案**：Conversation 采用明确的 `CommunicationScope`，语义为 `LocalStation(station_peer_id)` 或 `Federation(federation_id)`。不是允许空 FederationID，也不是创建一个假的本地 Federation。

**D02 提案**：客户端请求“与此人聊天”，Home Station 从可信 Actor identity/endpoint manifest 判定双方归属。相同 Home Station 优先 LocalStation；不同 Station 必须有共同、有效、允许 Chat 的 Federation。

跨站多范围选择顺序：复用已存在会话的固定 scope → 明确的 Station 管理员业务偏好 → 共同候选稳定排序。排序与依据由服务端给出，不能从联系人存储的 FederationID 盲选。普通用户不选网络；无候选时解释权限缺口。

prepare 返回 Actor/设备集合、选定 scope、membership/policy generation、expiry 和不可篡改的 plan ref。create/submit 再校验 plan 和 live authorization，关闭“预检通过后成员已退出”的竞态。具体 wire 复用现有 Conversation prepare 机制；Direct 缺少的 prepare 在相同 owner 下补齐。

同站仍必须验证设备/Session、Actor 归属、Social gate、endpoint keys、Conversation 权限和加密上下文。仅解除联邦依赖，不降低 Chat 安全性或使 Station 获取消息明文。

scope discriminator 与唯一对应 identity 必须进入 canonical command、签名输入、plan digest 和加密 associated data，采用明确的 domain separation。LocalStation 模式仅允许 authority 本站拥有的 Actor/endpoint；远端 peer caller 不能声明 LocalStation 规避成员校验。实际 hash/编码定义在 proto 与密码学 owner 的单一合同中。

### 6.2 群与 scope 变化

**D03 提案**：新群全体 Home Stations 必须有同一个有效 scope；仅两两有共同联邦不足以组成一个群。scope 固定为会话身份/授权/密码学上下文的一部分，成员加入预检不得静默换 scope。

站内群扩大为跨站群，或跨站群更换 Federation，需要显式创建关联的新群，原群历史保留。界面先说明影响再确认；不在原 MLS epoch 中替换 FederationID。普通添加同范围成员继续走现有群变更合同。

### 6.3 ID、签名与加密迁移

当前 [Direct handler](../../../../../apps/station/app/subserver/conversation/production_http.go) 通过 Actor pair 推导 Direct ID，再检查 Federation 一致性。因此增加 scope 后，必须同时处理 ID 和 pair lookup，不能只给请求增加一个字段。

迁移清查必须覆盖 Conversation API、ChatCommand、snapshot/event、aggregate/valueobject、authority/follower 投影、DB、Direct ID、MLS AAD/签名输入、endpoint manifests、共享 messaging-core 的 codec/store/inbox、device outbox、Native recovery、client-chat-core 及客户端索引、fixture 与 Gates。共享语义只改一处，不在 Desktop/Mobile 各复制一套。

存量 Federation 会话映射为 typed Federation scope，保留原 ID、原 signed bytes、日志 hash、ciphertext、message ID 与密钥/epoch。不改写历史记录为 LocalStation；历史密码学解码保留原始格式的明确 codec，不保留旧的写 API 或空值兜底。

**D04 提案**：新 Direct ID 基于 canonical Actor pair 和 typed scope；维持“每对 Actor 默认一个活跃 Direct”的服务端索引。既有跨站 Direct 优先复用，避免因多 Federation 产生多个日常聊天入口。

旧同站 Federation Direct 若需获得真正的站内独立性，走可恢复 rollover：冻结旧段的新写入并确定待发送消息 disposition → 创建 LocalStation successor → 签署 old/new 关联 → 原会话转为历史段 → 更新唯一活跃索引。步骤事务化/幂等；未提交的旧发送意图不能丢失或自动重发为第二条消息。

客户端显示一个联系人线程，历史段保留原 ConversationID 和原加密/回执语义；新消息写 successor。更换绑定站点不是 Actor 迁移，不能借此触发 rollover。完整账户迁站不属于本轮。

协议切换采用一个写合同：所有受控 Station 和 Desktop/Mobile consumer、scaffold、fixture、Gates 同批升级；旧字段号 reserved，canonical event 读取支持真实历史。未升级客户端报告 capability 不支持，不增加第二套写入口。

一旦写入新 scope 的数据，不能直接回退旧二进制；需前向修复或在停止写入并验证数据恢复后回退。测试数据可按受控 Profile 重建，生产历史不可删除。

## 7. 分层状态与诊断

接入投影由 StationRuntime 提供 Session/identity/binding/route facts；Federation 投影由其 owner 提供 membership、同步和 policy；message projection 由 Messaging 提供设备/密钥、建会话及具体投递/回执。聚合层只裁剪展示，不成为第四个业务 authority。

普通显示优先级：需要重新登录/确认服务站点 → 等待消息恢复 → 此远端范围暂不可用 → 正常。站内聊天可用时，仅标注受影响的远端能力；不能一个“连接失败”禁用所有 Chat。

错误至少区分：身份不匹配、Session 到期、未被批准、未共同授权、审批/同步中、目标不可达、同步过旧、目录覆盖不全、设备/密钥未就绪、业务拒绝。失败包含 operation/request ID、是否可重试与建议动作；底层堆栈只在管理员诊断。

**D05 新鲜度提案**：跨站 admission 使用 Federation authority 签名且有到期时间的 head/policy grant，成员本地副本与 grant 对齐后才发起新跨站写入。建议 grant 有效期上限 60 s；撤销已传播到接收方即刻生效，分区节点最迟到 grant 到期停止接受新写入。该窗口需要产品/安全评审，不能表述为全网即时撤销。

grant 不是第二套 membership 存储，只引用 Ledger head/policy generation，由同一 Federation authority 签发。新鲜度过期时已入队 intent 保留并重验，退出/撤销导致的永久拒绝转业务失败，不无限重试或重新包装为其他 scope。读取已解密历史不依赖刷新 grant。

grant 至少绑定 FederationID、sequencer epoch、head hash/seq、source/target Station、允许的 capability/actions、issued/expiry 与签名 key identity；接收方校验 audience、当前已知撤销和单调 epoch/head，不能接受较旧 grant 回滚已知 policy。刷新可复用 authority 的批量只读签名投影，不要求每条消息同步调用 sequencer。

操作预算提案：身份解析/单次治理 peer 调用最多 10 s，单批 bootstrap/sync 最多 30 s；超时转可恢复阶段。自动重试指数退避、抖动、上限 60 s，过期/永久拒绝停止。人工审批有独立 expiry，HTTP 请求不等待人处理；每次执行同时预留取消与清理时间。

Desktop 使用既有 Global Context、RuntimeDescriptor 和投影存储，页面不启动独立重连/轮询。Mobile 共享业务语义，通过其原生运行时恢复；账户切换取消旧 generation 的搜索和组网观察，旧响应不能污染新账户。

管理员文档分别解释“连接到服务站点”“加入联邦”“网络可达但消息不能发送”、邀请/审批、恢复与退出。普通说明只保留登录、找人、聊天和可执行的恢复动作。

## 8. 接口变更落点

当前真实注册路由见 [subserver](../../../../../apps/station/app/subserver/federation/subserver.go)。保留 Federation、membership、proposal 和 ledger resource owner；以下是候选端点名，未注册，不构成公开 API 承诺。

- `GET /sub-federation/readiness`：登录态下按 context 返回 membership/sync/policy 与能力状态。公开 `/actor/federation/health` 仍仅提供裁剪后的 transport health，不泄漏成员与操作。
- `POST /sub-federation/federations/:id/invitations`、撤销与结果查询：本地 operator 动作，由 Federation approver proof 约束，返回带目标和 expiry 的邀请资料。
- 既有 `POST /sub-federation/federations/join`：改为消费邀请或发起申请并返回 operation ref。去掉自提交 APPROVED 的捷径。
- `GET /sub-federation/operations/:id`、审批与取消动作：角色/目标受限查询，不公开所有 Station 的操作详情。
- `/fed/v1/governance/submit-proposal`：只传请求者实际授权的 proposal。sequencer 验证 invitation/approval 和幂等后追加正式事件。
- 既有 `/sub-federation/catalog/search`：成为 Home Station 聚合入口；新增 `POST /fed/v1/catalog/search` 为单 Station local-only peer 查询，强制 scope 与权限。
- `POST /conversation/direct/prepare`：补 Direct 准备流程；`/conversation/direct` 及相关 Chat proto 改用 scope/plan ref。复用群 prepare、authority submit 和现有 message delivery/recovery owner。
- leave、remove、archive、handover：使用同一 durable operation 和 Ledger 体系；角色、状态与 affected-scope 必须检查，不能另建 Dashboard 私有治理状态。

所有 wire schema 先在 `model/domain/` 定义，通过既有生成链更新消费者；数据 migration 由各业务 repository owner 提供。实现确认后同批更新当前 Federation、Conversation、Access 和相关 knowledge 的真源，不让本稿永久成为第二套合同。

## 9. 验证合同与评审决策

必须证明的产品结果：

1. **AC01 接入隔离**：同一 Station 路由切换维持身份；切换账户/站点不串 Session、查询结果或消息。
2. **AC02 站内独立**：没有 active Federation、远端 seeds 全不可用时，两个同站 Native 客户端仍能找人、建立 Direct、加密发送/展示、恢复；本地群同样可用。
3. **AC03 真实加入**：可信定向邀请、错误目标、过期、撤销、真实审批、响应丢失及双方重启恢复。必须通过 Dashboard 操作证明管理员流程，API 只是补充。
4. **AC04 控制面恢复**：seed 退役、新候选生效、批准后复制失败、分页追赶、同 seq fork、计划性交接中的崩溃和旧 writer fence。sequencer 永久丢失明确只读。
5. **AC05 真正远端发现**：初始无 remote cache，从另一成员 Station 发现真实 Actor；隐藏/过期/退出成员不泄漏；多个 Federation、同名消歧、partial 与取消正确。
6. **AC06 跨站 Chat**：找人 → 好友/既有 Social gate → prepare → 建会话 → 双端密钥/加密 → 接收方展示及回执 → 断连恢复/重复去重。direct 与 opaque Relay 路由分别证明。
7. **AC07 群与存量**：共同 scope 预检、成员变化竞态、同站历史 rollover、旧密文仍解密、待发送消息无丢失/重复、单线程索引、显式新群 scope 切换。
8. **AC08 撤销边界**：到期 grant 停止写、即时本地撤销拒绝、旧 outbox 不越权补发；管理员退出显示真实确认阶段；日志和诊断不泄漏凭据。

关键待确认决策为 D01/D02 站内通信独立与后台选 scope、D03 scope 固定及新群扩展语义、D04 存量 Direct rollover、D05 分区下撤销窗口。推荐这些提案，但不能把它们写成用户已接受的契约。

评审需检查事实分类、权限 owner、签名迁移、故障可恢复性和上述用户结果。原型验证只能证明交互表达；runtime proof 必须绑定届时选定的当前源码和受控环境，不能继承本基线或旧 Gate 的 PASS。

本轮仅形成评审设计；没有产品代码变更、runtime 测试或能力完成声明。`no_growth_needed`：新契约尚未接受，本轮不新增长期 knowledge invariant。
