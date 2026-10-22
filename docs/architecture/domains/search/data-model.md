# Search 内容接入与数据合同

> **Status**: active
> **Created**: 2026-10-22
> **Owner**: Search / Client / Station
> 协议源已在 `model/domain/search/search.proto` 定义，Desktop TS 类型由其生成；本期只消费端侧切片，后续 contributor/Station 合同未实施。

当前端侧执行候选和 IPC 适配必须投影自上述 proto；它们不构成并行业务线合同。下文完整资源/来源/分页设计属于目标模型，实际字段以 proto 为准，尚未实施的字段、来源和生命周期保持显式未证明。

## 1. 对象与身份

稳定资源标识建议为：

```text
ResourceKey = authorityNamespace + resourceKind + resourceId
SourceKey   = owningModule + sourceInstanceId + executionBoundary
QueryKey    = intentId + identityEpoch + scopeFingerprint
```

authorityNamespace 表示资源的真实权威空间，例如原 Station、Federation 对端站或 Applet instance；不能把来源展示名称当权威 ID。设备/账号存储 namespace 与 authorityNamespace 是不同维度，缓存 key 必须同时约束当前身份。

ResourceRef 包含 key、parent/container reference、可选 message/thread/block anchor 与 content revision。封闭域内不存在外部 URL 资源 variant；消息正文中的 URL 只是文本，不产生可搜索网页资源。

域内附件 variant 包含 device/profile 或 Station object reference、所属父对象（消息/知识/任务/帖子）、附件稳定引用与可选页/段落 anchor；只在父对象当前可读时解析。与 Agent 知识关联时优先引用已有 `KnowledgeClientResourceRef` 的 opaque resource/device/capability identity，Search 仅补 anchor，不复制知识对象 authority。功能 variant 包含受信任 module/capability/action ID 与定位参数；不是任意脚本、shell command、URL 或文件路径。

同一对象从多个查询来源出现可以合并 provenance；不同对象同标题不能合并。删除 parent 是否删除 child 由原域规则声明；例如 private comment 的读取依赖 parent post 的当前 visibility。

## 2. SearchContributorDescriptor

每个内置域或受信 Applet 声明下列内容。descriptor kind 只允许域内类型（person、conversation、message、post/comment、agent-session、knowledge/note、domain-attachment、applet-object、function）；公网、OS 文件与外部 connector 类型在 schema 层被拒绝：

- **身份**：source ID、owning module、instance binding、display/i18n key、受信任 provider build/revision。
- **对象**：resource kinds、canonical namespace、parent/anchor、可搜字段（title/body/author/tags/attachment-name 等）和 language/analyzer profile。
- **作用域**：actor/Station/Federation/Applet scope、允许边界 `device-private | station-authorized | remote-authorized | public`（public 仅指 Peers 域内声明可被目录发现，不指公网）。
- **模式**：`query-adapter | derived-index`，以及 snapshot/changes/query/resolve 的绑定；无 renderer 自定义代码或任意远端 endpoint。
- **查询能力**：支持的 filters/operators/sort/cursor/highlight/count 语义；不支持条件时明确拒绝，不能静默忽略。
- **检索策略**：keyword、semantic、rerank 的实际支持与处理边界，按 D/S/F 信任区分别声明；不能因 AI 可用扩大来源或读取范围。
- **权限**：read-policy binding、权限 revision、visibility/discoverability 字段、deny behavior、policy expiry/offline policy。
- **处理策略**：可否持久化索引、可否语义提取/embedding、可否 AI 使用、S 区内容是否允许 Station 配置的外部模型 provider；内容 Owner 与用户策略取交集。处理位置授权不改变检索宇宙封闭性。
- **生命周期**：upsert/edit/delete/revoke、checkpoint/rebuild、pause/remove/purge、coverage reporting。
- **打开合同**：Resource Resolver binding、平台 fallback、read-only preview、允许 action IDs；写操作仍由领域 command 执行。
- **预算**：最大批量/正文/附件大小、query time/candidate budget、concurrency、worker resource limits。
- **证明引用**：字段/权限否定、删除/撤权、分页、打开原对象与生命周期的 Acceptance contract IDs。

建议 Applet manifest 只引用能力 ID 与 provider binding，具体字段由统一 schema 校验；不平行维护手写 TypeScript、Rust、Go 三种来源模型。是否需要显式 wire version 必须遵循当前 Model 版本政策，当前草案不增添 workflow schemaVersion。

处理策略分别声明 storage boundary 与 inference boundary：device-only、Station-allowed、external-provider-allowed（仅 S 区、按来源显式授权）；还需约束 query、content/chunk、embedding 和 answer cache 可处理的字段。D 区内容不自动许可任何远端处理；没有当前可用端侧 inference 时，device-only 来源不调用 Station 模型。实际 authority 由原域和用户政策共同决定，不以 descriptor 的名称替代许可。

注册状态：

```text
declared → validated → authorized → eligible
                            ↘ denied
```

运行状态与注册状态独立：

```text
initializing / ready / catching-up / partial / stale
locked / paused / unavailable / rebuild-required / removed
```

eligible 只允许参与当前 query，不表示索引完整或来源永不失败。

### 2.1 域内附件引用与 FunctionDescriptor

DomainAttachmentRef 记录附件所属父对象 ResourceKey（消息/知识/任务/帖子）、存储位置（device-protected / station-object）、content revision、extraction revision 与 extraction state。附件没有独立授权：可读性始终由父对象当前 read-policy 裁决，父对象 deny 时附件名称/正文/缩略图/count 同时不可见。不存在 OS directory grant、root path、recursive scope 或文件系统 watcher 字段。

附件 provider 通过父对象引用查询，不接受调用方提供的任意路径；Search 索引与附件二进制分别拥有独立生命周期，附件删除/撤权写 deny/tombstone。

FunctionDescriptor 复用已登记模块/capability/action identity，并提供名称/i18n key、别名、用途、平台 availability、账号 eligibility、navigation binding 与 effect class。默认 result 仅打开入口；副作用由原域 command 执行，搜索描述不授予写权限。

## 3. SearchDocumentProjection

逻辑字段：

```text
resourceRef
sourceKey
revision / sourceSequence / indexGeneration
title / boundedSearchableText / typedMetadata
authorRefs / containerRefs / createdAt / updatedAt
languageProfile / extractionState
visibilityPolicyRef / policyRevision / discoverability
processingPolicy / provenance
deletedAt / tombstoneRevision
```

metadata 使用有类型、受 allowlist 控制的字段；未知任意 map 不能成为权限或路由依据。字段级处理策略可以把 title 允许服务器索引、body 仅本地、embedding 禁止外发分开表达。

SearchDocumentProjection 是可重建派生状态。业务正文、附件二进制、凭据不成为 Search 系统的另一份真源。Index 内容最小化但不得以原对象不存在时的 orphan projection 继续展示。

## 4. 增量与可靠消费

ChangeEvent 包含 event ID、source key、resource key、resource revision、source sequence、operation、policy revision、可选允许的 projection 或 opaque read reference。

operation 建议：

```text
UPSERT | DELETE | POLICY_CHANGED | EXTRACTION_READY
SOURCE_PAUSED | SOURCE_REMOVED
```

同源 monotonic revision/sequence 可比较；跨源 wall clock 不作为最后写入优先规则。幂等 key 是 source + event ID/resource revision。

DELETE/POLICY_CHANGED 写 deny/tombstone 后才推进 checkpoint；旧 UPSERT revision 不得恢复被删资源。权限扩大允许异步变得可搜；权限缩小先拒绝读取，正文索引清理后再结束 purge。

SnapshotReply 包含 snapshot ID、watermark、page cursor、documents、coverage；ChangesReply 包含 checkpoint、gap indicator、events。cursor 过期或 sequence gap 进入 reconcile/rebuild-required。无完整变更机制的 adapter 必须声明 known-only coverage。

索引提交与 checkpoint 同事务（同存储）或使用可重放 commit receipt；禁止 checkpoint 先于索引落盘导致永远丢事件。

## 5. QueryIntent 与请求

QueryIntent：

```text
intentId
text / phraseTerms / typedFilters
contentKinds / sourceSelection / containerScope
sortIntent / locale / timeZone
pageSize / cursor
searchScope / retrievalStrategies
allowFederatedResolution / evidenceUsePolicy
```

actor/session/profile/Station 由认证上下文提供；客户端只能选择已允许的 source/context，服务端再次校验。time range 的用户时区与服务端 UTC 边界明确。空字符串/长词/无效 operator/超限 page size 用 typed error 返回。请求不包含任何 web/OS 文件/外部 connector 选择字段；域外范围请求返回 INVALID_QUERY。

Search request 和 Ask request 是不同意图。查找、短答案与深入研究有明确 mode/预算；自动建议只给模式建议，不扩大权限。Ask 引用 QueryIntent/EvidenceBundle，并带已验证的处理策略；证据集合只包含当前 actor 可读的域内对象。

searchScope 表达综合/功能等用户可见范围以及域内 contentKinds，具体 proto 枚举待冻结。retrievalStrategies 是来源支持与用户处理策略的交集。Federation 结果只在 allowFederatedResolution 且存在有效联邦上下文时按对端授权返回；本机输入建议不触发任何远端或模型外发。

建议通过 `model/domain/search/` 形成 proto-first 远端合同、生成客户端/native 类型。候选操作：ListEligibleSources、Query、ContinueQuery、CancelQuery、ResolvePreview；最终公共路由经 API Governance 确认。这些名称是设计建议，当前没有宣称任何 `/api/v1/search` 已可调用。

## 6. QueryReply 与结果

QueryReply：

```text
intentId / attemptId / identityBinding
queryStatus
results[]
sourceStates[]
coverage
count / facets
nextCursor / snapshotId / expiresAt
```

增量响应可沿已有 native event 与 Station streaming transport 使用 typed SearchEvent：

```text
intentId / attemptId / identityEpoch / eventSequence
PLAN_READY | RESULT_BATCH | SOURCE_STATE_CHANGED
COVERAGE_UPDATED | QUERY_COMPLETED | QUERY_CANCELLED
resourceRevision / sourceSetRevision / policyEpoch
```

eventSequence 只在一个 attempt 内排序；客户端以 query/identity/source/policy tuple 拒绝迟到回写，不能将任意旧 event 强行套入新查询。断线后用原 cursor/reconcile contract 或重查，不能重新生成已发生的业务写操作。CancelQuery 幂等，query session 过期返回明确状态。

来源配置/启停/联邦授权移除/重建使用稳定 command ID、expected revision 与 idempotency key；重复提交回读同一结果，冲突保留用户输入。普通 Query 是读操作，重复请求不会创建 Agent/业务对象。provider 不必自建另一套 mutation ledger。

ResultItem：

```text
resourceRef / sourceKey / provenance[]
kind / title / textSnippet / highlightRanges
author / container / timestamps
extractionState / indexFreshness
availableOpenAction / permittedSecondaryActions[]
matchedFields / matchExplanation
```

排序元数据包含 leaf ranking channel ID、source/resource kind、retrieval strategy、index generation、source rank 与 aggregation owner。raw score 仅用于来源内诊断，跨来源不直接比较。最终聚合持有 issued ResourceKey 集合和各叶子 continuation；精确对象/功能直达不被昂贵 rerank 阻塞。

highlightRanges 基于明文的明确 Unicode 坐标（建议 Unicode code point，平台统一转换），不是来源 HTML。Renderer 负责安全文本渲染。private result 的正文/thumbnail 等只在当前授权 hydrate 后返回。

结果默认允许打开，预览与次动作需显式授权；`availableOpenAction` 不是 JS function 或任意命令行。权限失败后的 response 不保留该对象的 title/snippet 作错误说明。

### 6.1 Count 与覆盖

Count 的 relation：`exact | lower-bound | estimated | unknown`；值仅在非 unknown 时存在。loadedCount 是本次加载条数，不等于 total。

Coverage 区分：

- 所选、eligible、成功、失败、锁定、处理中来源；
- 内容范围：complete / synced-only / known-only / metadata-only；
- 可公开的 freshness/watermark；
- unsupported filter 与 deferred source；
- partial reason 与 recovery action。

不应把“有权用户是否存在某个私密命中”暴露给无权用户。来源级诊断可以说服务不可用；document-level count/snippet/ID 只从权限过滤后的集合产生。

### 6.2 错误

统一错误建议包括：

```text
INVALID_QUERY / UNSUPPORTED_FILTER / UNAUTHENTICATED
SOURCE_UNAVAILABLE / SOURCE_TIMEOUT / LOCAL_STORE_LOCKED
INDEX_CATCHING_UP / POLICY_UNAVAILABLE / QUERY_CANCELLED
CURSOR_INVALID / CURSOR_EXPIRED / SOURCE_SET_CHANGED
RESOURCE_UNAVAILABLE / EVIDENCE_INSUFFICIENT
ATTACHMENT_EXTRACTION_PENDING / ATTACHMENT_FORMAT_UNSUPPORTED
FEDERATION_UNAVAILABLE / FEDERATION_NOT_AUTHORIZED
FUNCTION_UNAVAILABLE
SCOPE_OUTSIDE_SEARCH_DOMAIN
```

failed、partial、empty 是独立 query status。已失权/删除/隐藏的原对象采用领域统一的 unavailable，避免泄漏身份；详细诊断只在 authorized operator scope。对域外来源（公网、OS 文件、外部 connector）的请求统一返回 SCOPE_OUTSIDE_SEARCH_DOMAIN，不提供配置指引式错误。

## 7. Cursor 与缓存

cursor 为 opaque、认证防篡改的 session continuation，绑定 actor、profile、Station/Federation scope、query/filter/sort fingerprint、source set、ranking/index generation、expiry。

Client cursor 可以指向本机 query session，不能发给 Station 当作私密数据。Station cursor 只包含远端会话 reference，不编码正文或可读权限集合。

Cache key 包含 identityEpoch、policyEpoch、resource revision、source revision。权限/身份变化立即失效；分页旧会话不保留访问权。Result cache 与历史 query/suggestion 各自有受保护存储和留存策略。

## 8. AuthorizedEvidenceBundle

bundle 包含 intent/scope、resource revision、已授权片段、引用 anchor、来源与 freshness、处理策略、evidence budget、expiry。引用 ID 由本轮 bundle 产生，模型不能随意指定未查询对象。

chunk reference 绑定 ResourceKey、content revision、extractor/chunk schema、offset/page/anchor；embedding projection 额外绑定模型/revision/dimension。模型更换或重建使旧 space 的 vector 不参与新召回。只读 chunk 权限与原对象一致，不能让片段比原文拥有更宽访问。

送 Station Agent 或外部模型 provider 前，再验证用户意图、domain processing policy 与实际 provider；只有 S 区、来源策略与用户授权同时允许的内容可离开设备，D 区 bundle 永不上传。只允许最小 evidence 文本；权限扩大/来源新增不能静默加入已批准 bundle。用户撤销后取消未发请求；已经发送给外部 provider 的数据遵循其实际保留政策，不虚构可撤回能力。外部模型只改变处理位置，不扩大可检索对象范围。

## 9. 逻辑持久化集合

建议 Station 保存 sources、document projections、policy references、changes/checkpoints、tombstones/index generations、短期 query sessions。物理数据库表与迁移需经现有 Store Owner 和实施方案冻结。

建议 Client 保存本账号 protected index/reference、域内附件 projection/checkpoint、短期 query session，以及用户选择启用的历史/最近记录。Chat 原索引继续由 Messaging Store 持有；Search 不复制其表。所有派生对象都有 source ownership、expiry/purge 策略与可重建入口。F 区联邦投影只在对端授权允许的期限内缓存；功能 catalog 来自受信任声明，不持久化另一套业务权限。不持久化任何公网结果、OS 文件引用或外部 connector 投影。
