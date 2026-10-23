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
QueryIdentity = intentId + identityEpoch + scopeFingerprint
```

authorityNamespace 表示资源的真实权威空间，例如原 Station、Federation 对端站或 Applet instance；不能把来源展示名称当权威 ID。设备/账号存储 namespace 与 authorityNamespace 是不同维度，缓存 key 必须同时约束当前身份。

QueryIdentity 标识执行与发布，不是缓存复用键。新 intent 可以复用仍有效的
相同查询数据；缓存键、权限约束与 cursor 绑定见第 7 节。

这里的 instance 指稳定业务数据实例/tenant，不是每设备安装记录、运行
session、服务 URL 或包版本。执行 binding 变化不自动改变原对象的 authority；
来源身份与资源 namespace 由受信平台绑定验证，不接受 provider 越域自报。

ResourceRef 包含 key、parent/container reference、可选 message/thread/block anchor 与 content revision。封闭域内不存在外部 URL 资源 variant；消息正文中的 URL 只是文本，不产生可搜索网页资源。

域内附件 variant 包含 device/profile 或 Station object reference、所属父对象（消息/知识/任务/帖子）、附件稳定引用与可选页/段落 anchor；只在父对象当前可读时解析。与 Agent 知识关联时优先引用已有 `KnowledgeClientResourceRef` 的 opaque resource/device/capability identity，Search 仅补 anchor，不复制知识对象 authority。功能 variant 包含受信任 module/capability/action ID 与定位参数；不是任意脚本、shell command、URL 或文件路径。

同一对象从多个查询来源出现可以合并 provenance；不同对象同标题不能合并。删除 parent 是否删除 child 由原域规则声明；例如 private comment 的读取依赖 parent post 的当前 visibility。

## 2. SearchContributorDescriptor

通用接口的最小声明只有来源 ID、稳定资源 namespace、资源类型、支持能力和
opaque binding 引用。下列完整字段按实际启用的能力提供；直接查询来源不被
要求同时实现派生索引、模型、附件提取或 Applet SDK。读取许可、字段处理策略
与预算始终由受信 binding 和统一执行上下文约束，不能因未声明高级能力放宽。

公共读方法固定为 `query / hydrate / resolve`，逻辑签名见
[extensions.md](./extensions.md#21-最小公共接口)。`SourcePage` 表达来源内有界候选、
rank、cursor 与 coverage；`HydrationRequest/Reply` 封装批量请求及每项读取结果，
`AuthorizedProjection` 表达当前读权下的结果投影；
`ResolvedResource` 表达校验后的 ResourceRef 与受信只读打开绑定。它们复用
本文的资源、投影和查询语义；后续 wire 仍由同一 Model schema 定义和生成。
身份、允许范围、deadline 与 cancellation 来自 `SearchExecutionContext`，
不增加来源侧 Describe/Cancel RPC。可选 IndexFeed 只提供 snapshot/changes，
核对与 gap 恢复由标准 projection worker 复用 snapshot 完成。

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

actor/session/profile/Station 由认证上下文提供；客户端只能选择已允许的 source/context，服务端再次校验。time range 的用户时区与服务端 UTC 边界明确。空字符串/长词/无效 operator/超限 page size 用 typed error 返回。请求不包含任何 web/OS 文件/外部 connector 选择字段；域外范围请求返回 SCOPE_OUTSIDE_SEARCH_DOMAIN。

Search request 和 Ask request 是不同意图。查找、短答案与深入研究有明确 mode/预算；自动建议只给模式建议，不扩大权限。Ask 引用 QueryIntent/EvidenceBundle，并带已验证的处理策略；证据集合只包含当前 actor 可读的域内对象。

searchScope 表达允许检索的执行/授权范围，当前 proto 使用 DEVICE/STATION/FEDERATION。综合/功能等视图由 intent、contentKinds 与 sourceSelection 表达，不与执行 scope 混用。retrievalStrategies 是来源支持与用户处理策略的交集。Federation 结果只在 allowFederatedResolution 且存在有效联邦上下文时按对端授权返回；本机输入建议不触发任何远端或模型外发。

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
CancelQuery 针对调用方 intent/subscriber，不直接撤销其他 subscriber 共用的
排序 session 或 operation；底层取消沿第 7.4 节执行。

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

## 7. Cursor、缓存与复用

cursor 为 opaque、认证防篡改的 session continuation，绑定 actor、profile、Station/Federation scope、query/filter/sort fingerprint、source set、ranking/index generation、expiry。

Client cursor 可以指向本机 query session，不能发给 Station 当作私密数据。Station cursor 只包含远端会话 reference，不编码正文或可读权限集合。

以下是目标数据合同，尚未加入当前 proto 或实现。缓存元数据与条件读取提示
沿同一 Model schema/受信 binding 定义，不增加另一套手写业务模型或权限库。
缓存策略取来源字段策略、原域读策略和 Host 上限的交集。

### 7.1 缓存对象与复用键

缓存角色共用 Search runtime 的有效性、失效和资源策略；物理存储按 D/S/F
隔离。持久派生索引独立于可淘汰的缓存，不因缓存淘汰而重建索引。

- **静态声明与功能目录**：以 module/source identity、descriptor/catalog revision、
  platform、locale 和当前 binding revision 定位。只有无 actor 私密信息的声明
  可 app-scope 复用；当前 eligible/availability 另受身份与 capability revision
  约束。声明不变就不重复获取，immutable 声明不设周期性重查。
- **资源投影与打开绑定**：键包含 ResourceKey、source/binding identity、账号/
  profile/Station/Federation 授权分区、identityEpoch、read-scope/使用目的
  fingerprint、read/processing policy revision，以及所需 projection
  fields/schema/locale/anchor。条目保存
  content validator/revision；候选要求指定 revision 时必须匹配。正文、缩略图、
  snippet 和 resolve target 各按字段策略缓存，正文优先复用原域 read cache。
  snippet/highlight 额外依赖查询条件，不能跨词直接复用。
- **查询页与负结果**：键包含上述授权分区、规范 QueryIntent 条件（text/phrase、
  filters、类型、位置、source selection、sort、locale/timeZone、page size、
  执行与处理范围、检索策略）、capability/source-set/binding revisions、相关来源
  search watermark/index generation 和 ranking/analyzer/model revisions。只纳入
  实际参与的策略版本。相同内容的规范条件才可复用；规范化不得丢弃有意义的
  大小写、短语、时区或筛选。页号/continuation/snapshot 是页定位的必要维度。
- **短期 UI/query session**：保存输入、筛选、已加载页引用、稳定顺序、选中
  ResourceRef、滚动位置与 continuation。它不重复持有全部业务正文，也不等同
  搜索词持久历史；页引用的缓存可读性须在恢复时重新判断。

来源的 search watermark 覆盖可能新增、删除和改变匹配关系的对象，不能只用
已命中对象的 content revisions 判断整页仍新鲜。能给出可靠 scope watermark
时定向失效；没有时按该来源整体 revision 或有界新鲜期保守处理。

intentId、attemptId、requestId 不进入复用键；它们约束订阅者响应发布。
内部 querySessionId/snapshot identity 持有排序、已发对象集合和 continuation；
cursor 绑定该 session、规范查询、认证分区/读范围、来源状态与原到期点，
不绑定某个 UI subscriber 的 lifetime。当前限定 D03 的绑定仍以其已实现合同为准。

相同查询且当前授权匹配的新 subscriber 可 attach 尚有效的 session。
取消旧 intent 只 detach 旧 subscriber；最后 detach 中止在途读，但可保留
有界 session 数据至原到期点。后续 attach 不能复活已取消 operation，需新建
读取；成功页值由当前 subscriber 形成响应，不改写旧 SearchEvent。分页操作
由 session owner 串行推进 continuation/已发集合，各 subscriber 有独立浏览位置。
session 或 cursor 不可复用时保留仍可读的已加载页，继续翻页前明确建立新
分页上下文，不拼接不同快照、不延长旧 cursor。

### 7.2 两项独立有效性与元数据

可发布条目同时满足：

1. **内容有效**：validator、revision 或受保证的新鲜期仍匹配；immutable 仅指
   该 content revision 不变。没有可靠事件/watermark 的可变来源须有有界
   contentFreshUntil；不得只记录“曾成功读取”而永久视为新鲜。
2. **读取有效**：当前认证分区、source eligibility、binding、原域 read-scope/
   policy 仍允许所需字段与用途；原 authority 能直接裁决，或提供仍有效的
   read lease/离线政策。无 lease 不能自行推导允许时长。

条目记录 resource/query dependencies、content validator/revision、
contentFreshUntil、policy/read-scope revision、readLeaseUntil（适用时）、
source/binding revision、storage/processing policy、coverage/snapshot/expiry、
字节数与最近使用时间。contentFreshUntil 和 readLeaseUntil 不能合成一个 TTL。
来源返回的缓存提示不能签发或延长 Host/原域授权。

**no-store** 不保存响应投影/正文；**fresh** 可直接形成响应；
**content-stale** 仅在读取仍有效且策略允许时先返回旧内容、标注 freshness，
再有界后台更新；**access-invalid** 不返回标题、ID、片段、count、预览或
evidence，先阻断读和发布。lease 到期不能以 stale-while-revalidate 延长私密
可读性，content validator 未变化的回复也不代表已续授权。

逐对象条件读取的唯一位置是 `HydrationRequest.items`：每项包含请求项标识、
ResourceRef、所需 projection fields 和可选 knownValidator；请求另带内容刷新
要求。`HydrationReply.outcomes` 恰好关联每个请求项，乱序可按标识关联，缺项/
重复/额外项为协议错误，不能写入对象不存在的负缓存。批量限制沿 descriptor。

每项的读取结论为 allowed、统一 unavailable 或 retryable。allowed 另表达：
changed 携带允许字段的 AuthorizedProjection；unchanged 携带所验证的
content validator、字段集合和独立读取有效性。只有本机已有同 validator/
字段的 payload 才能承接 unchanged；无 payload 须请求 changed 投影。
unavailable 不区分不存在/失权，且不带敏感 title/snippet；retryable 不表示
允许继续读取，只有另有当前有效读权且允许 stale 时才保留旧值。

原 authority/binding 验证的 read-scope、policy 和可选 lease 约束读取结论；
来源 cache hint 不能签发授权，unchanged 不能单独续租。query 的条件提示
置于 QueryIntent 的可选读取选项，结果验证/coverage/有效性置于 SourcePage；
resolve 复用 ResourceRef revision 和响应中的受信绑定有效性，不为缓存另建方法。
validator 由原域定义，opaque 使用；刷新要求不改变语义复用键，而约束本次
读取是否足够新。所有字段由同一 Model 定义，逐项缓存选项不放认证 ctx/binding。

读取有效性持续约束已经展示的值。headless runtime 复用原身份/policy 生命周期
通知并调度依赖项最早 read expiry 的主动失效，不等下一次 query/hydrate。
到期/失效关闭列表行、预览、count/facet 和 evidence；页面隐藏不暂停该职责。
唤醒或恢复可见性先判断读权再投影，时钟回拨/重启不能延长原租约；平台 adapter
按原 authority 的有效期限和本机可信 elapsed-time 处理到期。

依赖策略事件连续性的可撤销读取在 policy stream gap 时为 unknown，需原
authority 重新裁决；只有原 owner 另提供且仍有效的离线政策可承接。内容
索引 gap 只影响 content freshness/coverage，不能被当成读权续期或权限真源。

### 7.3 失效、负缓存与容量

资源 edit/delete/hidden/policy 事件使相关投影、预览、打开绑定、引用与查询
dependencies 失效；新对象或匹配字段变化使受影响查询页、count/facet 和负结果
失效。查询当前显示顺序可保留，更新提示不能保留被删或失权行。不能可靠确认
count 时返回 unknown/lower-bound，而非复用旧 exact。

权限/成员变化、source removal、binding replacement、lock/logout/identity
变化先关闭对应分区的读取、订阅和发布，再按 retention 清理；锁定保留的
受保护磁盘数据不可读取，unlock 须重新取得当前上下文。A→B→A 不恢复旧
identityEpoch。来源变动不清空无关静态目录和仍可读的其他资源正文。

只缓存成功完成且 coverage 明确的空查询结果，并使用相关来源 watermark 与
较短有界新鲜期；partial/failure/timeout 不缓存为 empty。不可用对象的负缓存
仅限相同授权分区和统一 unavailable 语义，恢复/权限变化即失效，不暴露对象
存在性。显式刷新绕过内容新鲜命中，允许条件读取复用未变 payload。

查询页、预览、负结果与 session 默认有界短期内存持有；磁盘持久化仅在原域/
字段策略明确允许时使用已有受保护 storage。各分区、来源、条目类型及总量
同时有数量/字节上限和 LRU 淘汰；session/cursor 有独立 expiry。immutable
内容仍受容量、读取政策和删除约束；no-store 不落盘，正文不进 Renderer
localStorage，不新增持久 query history。

可淘汰 payload 与防迟到提交的失效屏障不是同类缓存条目。失效时标记相关
operation handle/generation，payload/LRU/负缓存淘汰不得清除此标记；
保护持续到失效前的相关读全部结束或超时，再按已确认来源状态回收。无法
精确关联资源时保守标记该来源/范围的在途读。直接查询 adapter 同样适用，
不依赖可选 IndexFeed 的持久 tombstone，也不永久保留所有资源的否定记录。

### 7.4 并发与发布

相同授权分区、使用目的、操作、字段及 validator 的读取合并为一个 in-flight；需强制
刷新的调用不能搭载一个不满足其刷新要求的旧读取。hydrate 批量处理缺失或
须复核的对象，命中对象不重新取正文。

共享读持有独立 operation identity 和原授权快照，完成后产生数据值；
各仍有效的订阅者分别形成自己的响应。它不重写已取消 intent 的原 event，
也不合并不同 actor/read-scope 的调用。

每订阅者有独立 intent、deadline 和 cancellation；一个关闭预览不取消其他
仍使用同一读取的查询；订阅者 deadline 到达使该订阅者退出。最后订阅者退出
或底层来源预算的 deadline 到达才取消共享操作，不以合并延长任一 deadline。
提交缓存前重新检查 source/binding、
identity/read-scope/policy 和 validator 的当前状态；旧响应不能覆盖更新条目、
tombstone 或新授权分区。发布前再检查该订阅者执行身份与当前读权。
失效标记与缓存提交/可见发布在同一 owner 内串行或原子裁决，禁止 check 后
再被失效的响应写回。已取消/标记失效的 operation 不能因新 subscriber attach
获得新的提交资格。每次读取使用新的 operation identity，不改签旧响应。
仅仍登记为 active 的 operation 可提交；handle 回收后到达的回调直接拒绝，
不能因找不到旧条目而创建新有效状态。

## 8. AuthorizedEvidenceBundle

bundle 包含 intent/scope、resource revision、已授权片段、引用 anchor、来源与 freshness、处理策略、evidence budget、expiry。引用 ID 由本轮 bundle 产生，模型不能随意指定未查询对象。

chunk reference 绑定 ResourceKey、content revision、extractor/chunk schema、offset/page/anchor；embedding projection 额外绑定模型/revision/dimension。模型更换或重建使旧 space 的 vector 不参与新召回。只读 chunk 权限与原对象一致，不能让片段比原文拥有更宽访问。

送 Station Agent 或外部模型 provider 前，再验证用户意图、domain processing policy 与实际 provider；只有 S 区、来源策略与用户授权同时允许的内容可离开设备，D 区 bundle 永不上传。只允许最小 evidence 文本；权限扩大/来源新增不能静默加入已批准 bundle。用户撤销后取消未发请求；已经发送给外部 provider 的数据遵循其实际保留政策，不虚构可撤回能力。外部模型只改变处理位置，不扩大可检索对象范围。

## 9. 逻辑持久化集合

建议 Station 保存 sources、document projections、policy references、changes/checkpoints、tombstones/index generations、短期 query sessions。物理数据库表与迁移需经现有 Store Owner 和实施方案冻结。

建议 Client 保存本账号 protected index/reference、域内附件 projection/checkpoint、短期 query session，以及用户选择启用的历史/最近记录。Chat 原索引继续由 Messaging Store 持有；Search 不复制其表。所有派生对象都有 source ownership、expiry/purge 策略与可重建入口。F 区联邦投影只在对端授权允许的期限内缓存；功能 catalog 来自受信任声明，不持久化另一套业务权限。不持久化任何公网结果、OS 文件引用或外部 connector 投影。
