# 联邦组网与日常通信闭环 — 候选实施细则

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-10-28 | **Updated**: 2026-10-28
> **Owner**: Federation / Conversation / Client Runtime

本文件是[评审设计](../../review/design.md)的实施依赖说明，尚未冻结为 `plan.md`，不授予代码实施、部署、提交或发布权限。产品/架构决策确认后，将其渲染为符合现行 Plan contract 的垂直 Task Slices 与 Outcome Comparison；不得用本候选文件冒充 accepted/frozen Plan。

源码对账基线 `0aa6572ec`。实际实施前必须核对届时用户选定 worktree 的源码及 accepted contracts；不能把其他 worktree 或旧 Gate 的状态带入本次实现。以下结果全部 `UNPROVEN`。

## 1. 交付顺序

依赖为：C00 → C01；C01 → C02、C03；C03 → C04、C05、C06；C02 + C04 + C06 → C07；全部所选闭环 → C08。

C02 的合同清查与 C03 的邀请链可在设计确认后独立准备，但共享 proto 生成、authority 签名和运行环境必须由 owner 串行裁决冲突。C05 不阻止首次无故障加入，却是控制面可用/退出完成声明的必要部分。

不按“后端完成、再前端完成”分期。每个闭环同时交付 wire/存储、owner 行为、用户界面、错误/恢复、说明和验证；其中较大的 C02/C04/C05 在正式规划时按具体可验证操作拆小，不把整章算作一次执行。

## 2. C00 — 确认合同与原型

**位置与收益**：实现之前的产品/架构输入；确定管理员和普通用户各自承担的动作，避免在客户端掩盖后端权限缺口。

交付：确认 D01–D05；核对目标源码；复用现有 `packages/prototypes/dashboard/station-dashboard/` 与 Desktop/Mobile 原型库，表达邀请/审批/恢复、普通找人、连接状态、群扩展与 Direct 历史连续性。纯协议细节通过设计评审，不另造展示工程。

原型覆盖：正常、未批准、过期邀请、部分搜索、远端不可达、scope 冲突及恢复；沿统一 prototype ledger 登记并完成确认。proto、authority 和历史 codec 评审必须先于 C02 的数据写入。

完成条件：用户流程可点、状态/按钮与 capability 可逐一对应，合同决策明确，现有原型与目标差异有记录。原型不得充当 AC01–AC08 的产品 PASS。

## 3. C01 — 三层就绪与错误反馈

**位置与收益**：接入、Federation 与 Messaging 的投影边界；让用户和管理员知道受影响的具体能力，后续闭环才有可信的恢复反馈。

改造现有 health/readiness 和 sync cursor；增加 Federation scoped readiness；聚合现有 StationRuntime / Messaging 状态。公开 health 不暴露成员、请求或 Session。

落点：`model/domain/federation/federation_health.proto`、`federation_sync.proto`；Federation `sync_manager.go`、repository/migration、readiness handler；`apps/station/frame/touch/federation_health_handler.go`；Desktop/Mobile 对应 runtime/store；Dashboard 只读状态入口。

验证：路由可用但不在成员范围、成员 active 但设备未准备、同步超时、DHT 未就绪而本地服务正常分别显示正确状态；客户端切换账户后旧响应不回写。对应 AC01 和 AC04/AC08 的状态切片。

## 4. C02 — 站内 Chat 独立与完整 scope 切换

**位置与收益**：Conversation 业务授权层；让同站用户在没有联邦或外网故障时继续安全聊天，消除当前不必要依赖。

先完成设计 §6.3 全量 impact inventory，再定义 proto scope、Direct prepare、scope-aware ID 与唯一活跃索引；同时迁移 Station command/aggregate/HTTP、Native engine/recovery 和 Desktop/Mobile 消费者。群 prepare/command 同批采用 typed scope。

站内找人同时复用并收紧 Social/Actor 查询，限定 local origin、requester discoverability 与 moderation，不调用要求 FederationID 的 catalog。C06 后续聚合消费此端口，C02 不依赖远端发现完成。

落点：`model/domain/chat/`；`apps/station/app/subserver/conversation/{application,domain,infrastructure,interface}/`、`production_http.go`；Social/Actor 搜索入口及隐私 port；`packages/messaging-core/` 的 codec/store/inbox、`packages/client-chat-core/` 及必要的既有 filesystem adapter；Desktop/Mobile Native Host 的实际消费点；相关客户端投影、fixture、Gates 与脚手架。共用行为由已有共享 owner 修改，不在两端重复实现。正式 inventory 必须来自届时源码，不能认为只改以上目录就已完成。

迁移分为可独立验证的历史读取、typed 单一写合同、Direct successor/索引与存量恢复闭环。每个落地边界都保证只有一个写 owner；不得靠可长期启用的 feature flag、假 Federation 或空字符串旁路拆阶段。

验证：AC02 与 AC07；固定旧消息/签名/附件数据证明仍可解密；迁移在每个持久阶段崩溃后恢复；未提交 outbox 不丢失/重复；两个 Native 客户端和本地群在无 Federation 环境正常工作。

数据边界：首次写新 scope 前可回退未启用的 schema；写入后仅允许前向修复，或经停写、备份与恢复验证的数据回退。不自动删除历史会话。

## 5. C03 — 管理员邀请、申请与真实加入

**位置与收益**：Federation admission；将 ID + endpoint 的技术调用变为可理解、授权正确、重启可恢复的组网入口。

复用 Ledger/签名/角色和 bootstrap service；新增邀请、operation intent、查询/审批/取消；改造 join/proposal，移除远端自请求 APPROVED 的捷径。Dashboard 提供创建、接收邀请、审批队列与进度；CLI 消费相同业务合同。

落点：`model/domain/federation/`；Federation handler、application、repository/migration；Dashboard `web/src/{api,pages,components}/`；Federation capability/feature/Gate 描述。

验证：AC03；目标错误、过期、撤销、无权限审批、相同幂等键响应丢失、bootstrap 拒绝及 Station/页面重启。至少一个证据必须为真实 Dashboard 发起与接收完成流程；手工 API join 不替代。

完成条件：操作已批准与本地复制完成可分别观察；正常邀请无需用户手填 FederationID；不具备 Federation authority 的本地管理员无法替别人批准。

## 6. C04 — 路由候选更新与治理同步恢复

**位置与收益**：Node Connectivity transport 与 Federation replication 的相邻边界；退役入口和批准后故障不再迫使管理员重新建网。

Node owner 接入受信候选刷新/失效淘汰并保持现有 direct/Circuit/route lease；Federation owner 完成分页追赶、cursor failures、operation 恢复和 grant freshness。两者通过既有窄 port 协作，不将 membership 写入 Relay。

落点：bootstrap、Node Connectivity/配置候选 owner；Federation `remote_fetcher.go`、`sync_manager.go` 与 operation worker；对应 wire、migration 与状态投影。受信候选发布源需在正式设计落地时精确登记，不新建未授权公网服务。

验证：AC04、AC08；替换全部旧 seed，冷启动与运行中恢复各一次；同一 Station route 更换保持 membership/Actor；落后超过一页不能误报 healthy；partition 到期后停止新跨站写；恢复后按当前授权处理旧 intent。

完成条件：有可信新入口时自动恢复；没有可信入口时明确降级；follower 不产生自己的正式 governance head。

## 7. C05 — 退出、撤销、计划性交接与归档

**位置与收益**：组网控制面的末端生命周期；确保“加入后能维护和离开”，同时防止 sequencer 故障产生双写。

退出/removal/归档全部复用 operation 和 Ledger；增加计划性交接的最终 head/epoch、写 fence、接收证明与重启恢复。展示受影响范围，更新 active contexts，阻止越权 outbox 补发。

落点：Federation policy/application/projection、repository/migration、Dashboard、当前 event payload / signing / verifier；调用者认证与签名 owner 同批核对。

验证：AC04 与 AC08；普通成员退出、邀请后撤销、停机中退出、旧/new sequencer 在交接各边界重启、重复交接、旧 writer 重启不能追加。旧 sequencer 永久失联保持只读且明确提示，不能以模拟故障选举代替。

完成条件：新写 authority 唯一；Ledger 不被覆盖；归档/退出客户端状态与接收端授权一致；移除成员不删除用户已有已解密历史。

## 8. C06 — 无预缓存的远端发现

**位置与收益**：Federation discovery；用户输入名字就能找到远端成员，解决目前只搜索本库/缓存的问题。

新增 local-only peer catalog capability；将现有 Home catalog 改为有界多范围聚合；绑定分页、取消、来源/expiry 与权限。Desktop/Mobile 普通入口默认自动范围，消歧显示站点名。

落点：`federation_discovery.proto`、Federation `handler_catalog.go`、discovery application/peer routes；Actor/profile privacy owner；Desktop/Mobile search/contact 的实际 runtime 与投影；StationPicker 仅保留必要高级用途。

验证：AC05；两个真实 Station，初始没有远端缓存；同名 Actor、跨多个 Federation、hidden Actor、失联 member、到期 token、查询取消及账户切换；未覆盖成员显示 partial。不得用预注册 Actor cache 或 Relay 目录证明发现。

完成条件：可见人员真实来自远端响应；搜索失败不归一成“用户不存在”；没有新增全局公开目录。

## 9. C07 — 自动 scope 的跨站 Direct 与群闭环

**位置与收益**：Discovery → Conversation → device delivery 的用户 Journey；把组网结果转成实际找人和聊天能力，而不是只证明 Station 连得上。

串联发现、现有好友/Social gate、可信 endpoint manifest、prepare、自动 scope、authority commit、加密与接收方展示/回执。新 Direct 复用已有活跃索引；新群提前验证全体共同 scope，scope 变化显式新群。

落点：C02/C06 已建立的合同与消费者；Conversation endpoint route / prepare owner、Native messaging；Dashboard 只用于权限和故障诊断，不拥有 Chat 结果。

验证：AC06/AC07；直连与 opaque Relay 分别运行；接收方离线后恢复、会话创建响应丢失、重复消息、scope 在 prepare 后撤销、MLS 成员变更、群跨 scope 的说明与确认。用接收端渲染与真实回执证明，不能用 outbox count 或 curl 成功替代。

完成条件：普通用户全程无需选择联邦/路由；不同层失败有准确恢复动作；失败不引发重复 Direct、重复消息或静默转投其他范围。

## 10. C08 — 当前源码整体证明与说明交付

**位置与收益**：所选产品范围的完成验证；确保接入、组网、发现、通信和退出能串成真实生命周期，并明确平台边界。

统一 Suite 复用 Station、账号、Native clients、设备和证据目录；scenario 只持有自身数据和动作。先 Desktop 双 Native，随后 Desktop↔Mobile 及所选 iOS/Android 切片；未运行平台分别 `UNPROVEN`，不外推。

交付普通用户使用说明、管理员组网/维护手册和独立开发设计。更新当前 Federation、Messaging、Access、Node Connectivity 真源及受影响 knowledge；将本评审稿的接受内容合入唯一 owner 文档，移除重复的目标合同。

完成条件：AC01–AC08 全部所选 required checks 绑定同一候选源码/运行时身份；旧 PASS 不继承。产品用户实际看到/能完成的结果、权限/隐私、维护成本分别评估；缺证明仍保留 `UNPROVEN`。

## 11. 执行预算、验证命令与交付边界

正式 Task Slice 必须声明源码集合、具体风险、单次执行 timeout、诊断与清理 reserve、失败 owner 和恢复点。预算根据受控环境测量确定，不提供未经验证的“几天完成”估计；不得超时后自动扩大预算继续宣称成功。

开发先启动受控 Profile 和日志/监控，再走一个 focused Native Journey；随后运行针对签名、迁移、幂等和权限边界的必要检查。不会在原型/文档阶段执行全量产品 Gate。

已知工具入口：

```bash
# 文档结构；不证明任何产品功能
node tooling/scripts/architecture/module-governance.mjs validate
node tooling/scripts/architecture/document-index.mjs --check

# 实现授权后，沿既有 Make / Profile 入口运行
make run-prototype
make desktop

# 仅当 accepted model 已渲染为正式 package 后
make plan-validate PLAN=<explicit-package-plan-path>
```

proto 生成、Mobile 启动、部署和每个 Acceptance Gate 的真实命令必须从届时 Make / Profile / catalog 解析。现有 `federation-two-station-lifecycle-e2e` 作为回归基础，新增邀请、scope、发现、handover 等业务 injection；不编造 Gate ID，不为本业务改造 domain-neutral Acceptance Core。

设计/原型确认授权与代码实施授权分开；提交、推送、PR、部署共享环境和发布各按用户指令执行。日志、凭据和大证据放到仓库外，所有资源只清理本任务明确持有的范围。

本候选说明只有静态设计对账，没有执行进度或 PASS；`no_growth_needed`：设计未接受，暂不沉淀新 invariant。
