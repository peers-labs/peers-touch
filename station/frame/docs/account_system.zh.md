# peers-touch 账户与身份系统（PT Identity）设计 V1

**设计宗旨**
- 以“主身份”为中心：一个可读、可验证、可扩展的身份核，统一绑定各类网络的外部 ID。
- 面向未来：适配器架构支持 ActivityPub、libp2p 以及自研网络等多 provider 并存与演进。
- 去耦实现：规范优先于代码，所有细节以协议与约定定义，避免对具体实现的依赖。

**一、术语与原则**
- 主身份（Identity Core）：账户在系统内的权威标识与密钥来源。
- 绑定（Binding）：主身份与某 provider 的 ID 的双向映射与验证关系。
- 适配器（Adapter）：面向 provider 的 ID 生成/校验/解析能力实现。
- 解析器（Resolver）：从任意入口解析到主身份，并可反向生成目标 ID。
- 命名空间（Namespace）：网络内部的隔离维度；对外发现以域（Domain）为主。
- 规范用语：
  - “必须（MUST）”表示强制要求；“应（SHOULD）”表示推荐但可例外；“可（MAY）”表示可选。

**二、PTID 规格**
- 规范形（Canonical）：`ptid:v1:actor:<namespace>:<type>:<username>:<fingerprint>`
- 字段说明：
  - `version`：当前为 `v1`，用于规范演化（MUST）。
  - `namespace`：内部隔离域，如 `pst` 或分层路径 `pt1/global`（MUST，字符集 `[a-z0-9._-/]`）。
  - `type`：账户类型代码（MUST），取值集合：
    - `p=person`，`g=group`，`o=organization`，`s=service`，`a=application`。
  - `username`：域内唯一的可读名（MUST），字符集 `[a-z0-9._-]`，长度 ≤32，统一小写。
  - `fingerprint`：主公钥指纹（MUST），采用 multihash + multibase 编码；算法建议 Ed25519 公钥摘要。
- 可读别名（Human Alias）：`pt:<namespace>/<username>@<domain>`（SHOULD）。
  - `domain` 来源规则（MUST）：
    - 首选从已激活的 `activitypub` 绑定的 Actor IRI 中提取域名（例如 `https://example.org/activitypub/<username>/actor` → `example.org`）。
    - 如存在多域绑定，维护多条别名，并以 `preferred=true` 标记默认展示域（SHOULD）。
    - 如无 Web 绑定，仅维护不含 `@<domain>` 的别名形式 `pt:<namespace>/<username>`（MAY）。
  - 别名不参与安全校验，仅用于人类可读展示与快速引用（SHOULD）。
- URI 形（程序化）：`pt://<namespace>/<type>/<username>?pid=<peerId>&v=1`（MAY）。
- 约束：`namespace + username` 必须唯一（MUST）。

**三、适配器接口（Provider-Agnostic）**
- 方法集合：
  - `issue(identity) -> providerId`：由主身份生成该 provider 的 ID（MUST）。
  - `verify(identity, providerId) -> bool`：验证绑定一致性（签名/指纹/声明）（MUST）。
  - `to(identity) -> providerId` / `from(providerId) -> identityRef`：双向转换（MUST）。
  - `capabilities() -> {algo, codec, version}`：公开算法与编解码能力（SHOULD）。
- 注册表：以 `provider_name` 索引适配器；支持版本与依赖声明（SHOULD）。

**四、解析器（Resolution）**
- 输入类型：`acct`、`Actor IRI`、`PeerID`、`PTID`、`Alias`（MUST）。
- 流程：规范化 → 类型识别 → 调用适配器 `from` → 获得主身份引用 → 校验 → 结果缓存（SHOULD）。
- 缓存策略：成功结果带 TTL；失败可回退为不可验证状态的可读别名（MAY）。

**五、转换与兼容**
- PTID → ActivityPub（MUST）：
  - `id = https://<domain>/activitypub/<username>/actor`
  - `preferredUsername = <username>`，`type = map(<code>)`
  - `icon/image.url = profile_photo`
  - `inbox/outbox` 按域下的标准路径约定。
- PTID → WebFinger（MUST）：
  - `acct:<username>@<domain>`；JRD 中 `links.self.href` 指向 Actor IRI。
- PTID ↔ libp2p PeerID（SHOULD）：
  - 同主密钥算法与编码则等价；否则通过 multihash+multibase 适配转换。
- 未来网络（MAY）：
  - 新增 provider 以适配器形式接入，无需变更 PTID。

补充：PTID 与域（Domain）的关系（MUST）
- PTID 不包含域名信息，保持可携带与跨域稳定；域由具体 `activitypub`（或其他 Web 类）绑定提供。
- 不同域上的同一账户（迁移或多宿）应共享同一 PTID（同一 `fingerprint`），并维护多条绑定与别名；用 `preferred` 决定默认域展示。
- 若不同域上的账户拥有不同主密钥，`fingerprint` 不同，PTID 不同；通过解析器与别名消解用户层的混淆（SHOULD）。

**六、安全模型**
- 信任锚：主密钥是权威来源（MUST）。
- 绑定校验：必须具备可核验的证据（MUST），例如：
  - Actor JSON/元数据中包含指纹声明并由主密钥签名。
  - DHT/注册表记录包含指纹并由主密钥签名。
- 权限：`Bind/Rotate/Revoke` 等关键操作需主密钥或经授权令牌（MUST）。
- 审计：所有绑定、撤销、轮换事件记录与可回溯（SHOULD）。

**七、生命周期**
- 创建：生成主密钥 → 指纹 → PTID（MUST）。
- 绑定：调用适配器 `issue` → 写入绑定 → `verify` 成功后激活（MUST）。
- 解析：任意入口解析到主身份 → 可选生成目标 ID（MUST）。
- 轮换：新密钥加入并提升为主 → 更新指纹与 PTID 版本策略（SHOULD）。
- 迁移：跨域迁移通过新增别名与声明；旧域记为迁移状态（SHOULD）。
- 撤销：将绑定置 `revoked`，保留审计信息（MUST）。

**八、命名空间与域**
- 对外发现以域为主，减少外部心智负担（SHOULD）。
- 命名空间用于内部隔离与查询过滤（MUST）。
- 命名空间可分层（`/` 作为层级分隔），但对外不混入 `acct`（SHOULD）。

**九、数据模型（实现无关）**
- Identity：`ptid`、`username`、`namespace`、`type`、`fingerprint`、`version`、时间戳。
- Key：`identity_id`、`public_key`、`algo`、创建/撤销时间。
- Binding：`identity_id`、`provider`、`provider_id`、`status(active/revoked)`、`capabilities`、`verified_at`、时间戳。
- Alias：`identity_id`、`alias(pt:<ns>/<username>@<domain>)`、`kind(readable/ui)`、`preferred`。
- 约束：`namespace+username` 唯一；`provider+provider_id` 唯一（MUST）。

**十、API 契约（协议级描述）**
- 身份：
  - `POST /v1/identity` → 创建（入参：`username, namespace, type`；出参：`ptid`）。
  - `GET /v1/identity/{ptid}` → 查询主身份。
- 绑定：
  - `POST /v1/identity/{ptid}/bindings/{provider}` → 生成并绑定；返回 `provider_id` 与 `verified`。
  - `DELETE /v1/identity/{ptid}/bindings/{provider}` → 撤销绑定。
  - `GET /v1/identity/{ptid}/bindings` → 列举绑定。
- 解析：
  - `POST /v1/resolve`（入参：`acct | actorIRI | peerId | ptid | alias`；出参：`ptid` 与可选 `provider_id`）。
- 列表/发现（供产品使用）：
  - `GET /v1/actors/{namespace}/list?type=person|group|...&search=...&page=...`。

**十一、示例**
- PTID：`ptid:v1:actor:pst:p:alice:z6Mkn9...`
- 可读别名：`pt:pst/alice@station.local`
- ActivityPub Actor（关键字段）：
  - `id`: `https://station.local/activitypub/alice/actor`
  - `type`: `Person`；`preferredUsername`: `alice`；`icon.url`: `<profile_photo>`；`inbox/outbox`: 标准路径
- WebFinger（JRD 片段）：
  - `subject`: `acct:alice@station.local`
  - `links.self.href`: `https://station.local/activitypub/alice/actor`

**十二、治理与隐私**
- 隐私最小化：对外仅暴露必要字段；可选择性隐藏指纹（SHOULD）。
- 合规：记录用户授权与操作审计；支持导出与删除请求（SHOULD）。

**十三、迁移路径（概念层）**
- 统一主键：确立 `username` 与 `namespace` 的唯一性，生成 PTID。
- 绑定补录：逐步为各 provider 生成并验证绑定；保持对外域稳定。
- API 渐进：先提供解析与绑定能力，再扩展发现与列表过滤。

**十四、阶段计划**
- P0：PTID 规范落地、适配器接口与解析器最小集、基础 API 契约。
- P1：ActivityPub/WebFinger 完整兼容、libp2p 互映、审计与权限框架。
- P2：密钥轮换/设备分身/多网络并存策略、迁移与治理工具集。

本设计文件为面向未来的规范性描述，独立于当前实现细节。任何实现应严格遵循上述“必须/应/可”的约束，以确保跨网络与跨协议的可持续兼容与演进。
