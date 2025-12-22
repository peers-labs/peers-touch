# ActivityPub User Actor 字段定义方案

## 一期方案（核心 ActivityPub Actor）

本文档描述了 Peers-Touch 网络中 User 类型的 Actor 在 ActivityPub 协议下的字段定义，以及在 Profile 页面的展示与修改策略。

### 1. 字段总览

结合 ActivityPub 标准与 Peers-Touch 网络特性，Actor 对象包含以下字段：

| 字段名 (JSON-LD) | 类型 | 说明 | 来源/标准 | 是否必填 | 可变性 (Mutability) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | URI | Actor 的全局唯一标识符 (IRI) ，Snowflake 格式 | ActivityPub | 是 | **不可变** (Immutable) |
| `type` | String | Actor 类型，固定为 `Person` | ActivityPub | 是 | **不可变** |
| `preferredUsername` | String | 用户名/短名 (用于 @提及) | ActivityPub | 是 | **不可变** (通常) |
| `name` | String | 显示名称 (Display Name) | ActivityPub | 否 | **可修改** (Editable) |
| `summary` | String | 个人简介/Bio | ActivityPub | 否 | **可修改** |
| `icon` | Image/Link | 头像 (Avatar) | ActivityPub | 否 | **可修改** |
| `image` | Image/Link | 背景图 (Header) | ActivityPub | 否 | **可修改** |
| `url` | Link | 主页/profile 页 URL（如 `https://domain/@user`） | ActivityPub | 否 | **不可变** |
| `inbox` | URI | 收件箱地址 | ActivityPub | 是 | **不可变** |
| `outbox` | URI | 发件箱地址 | ActivityPub | 是 | **不可变** |
| `followers` | URI | 粉丝列表地址 | ActivityPub | 否 | **不可变** |
| `following` | URI | 关注列表地址 | ActivityPub | 否 | **不可变** |
| `liked` | URI | 喜欢列表地址 | ActivityPub | 否 | **不可变** |
| `publicKey` | Object | 用于 HTTP 签名的公钥信息 | ActivityPub | 是 | **系统管理** (System Managed) |
| `endpoints` | Object | 其他端点 (如 `sharedInbox`) | ActivityPub | 否 | **不可变** |
| `ptid` | String | Peers-Touch ID (P2P 网络身份 ID) | **Peers-Touch 扩展** | 是 | **不可变** |
| `namespace` | String | 命名空间 (默认为 'peers') | **Peers-Touch 扩展** | 是 | **不可变** |
| `libp2pPublicKeys` | Array | Libp2p 协议使用的公钥列表 | **Peers-Touch 扩展** | 否 | **系统管理** |
 

---

## 2. Profile 编辑/展示 策略

### 2.1 用户可修改字段 (Editable)

用户在 Profile 编辑页面可以修改以下字段：

*   **`name` (显示名称)**:
    *   **说明**: 用户的昵称，可包含 UTF-8 字符。
    *   **限制**: 建议长度限制 100 字符。
*   **`summary` (个人简介)**:
    *   **说明**: 用户的自我介绍，支持纯文本。
    *   **限制**: 建议长度限制 500 字符。
*   **`icon` (头像)**:
    *   **说明**: 用户上传的头像图片。
    *   **操作**: 上传新图片后生成 URL 更新此字段。
*   **`image` (背景图)**:
    *   **说明**: 用户个人主页的背景/Banner 图片。
    *   **操作**: 上传新图片后生成 URL 更新此字段。

### 2.2 只读展示字段 (Read-Only Display)

以下字段在 Profile 页面主要用于展示或系统内部使用，用户不可直接编辑：

*   **`preferredUsername` (用户名)**:
    *   **说明**: 注册时确定的唯一标识符。
    *   **策略**: 通常注册后不可更改，或需要特殊流程更改。
*   **`id` (Actor IRI)**:
    *   **说明**: 系统生成的唯一 URI (如 `https://domain/users/alice`)。
    *   **策略**: 绝对不可更改。
*   **`ptid` (Peers-Touch ID)**:
    *   **说明**: 底层 P2P 网络的节点/身份 ID。
    *   **策略**: 系统生成，绑定身份，不可更改。
*   **`publicKey`**:
    *   **说明**: 系统管理的加密密钥。
    *   **策略**: 用户不可见/不可改，由系统自动管理。

### 2.3 扩展字段说明 (Peers-Touch Specific)

*   **`ptid`**:
    *   用于在 Peers-Touch 的 P2P 网络层（基于 libp2p）中寻址和验证身份。ActivityPub 的 HTTP 交互可以使用此 ID 进行跨协议的身份关联。
    *   在 JSON-LD 中建议定义 Context 扩展，例如 `https://peers.touch/ns#ptid`。
*   **`namespace`**:
    *   用于支持多租户或不同的网络分区。默认用户在 `peers` 命名空间下。

---

## 3. JSON-LD 示例（默认不返回 Mastodon 扩展）

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1",
    {
      "ptid": "https://peers.touch/ns#ptid",
      "namespace": "https://peers.touch/ns#namespace"
    }
  ],
  "id": "https://social.example.com/users/alice",
  "type": "Person",
  "preferredUsername": "alice",
  "name": "Alice Wonderland",
  "summary": "Just a decentralized dreamer.",
  "icon": {
    "type": "Image",
    "mediaType": "image/jpeg",
    "url": "https://social.example.com/uploads/avatar/alice.jpg"
  },
  "image": {
    "type": "Image",
    "mediaType": "image/png",
    "url": "https://social.example.com/uploads/header/alice.png"
  },
  "ptid": "QmXOy...",
  "namespace": "peers",
  "inbox": "https://social.example.com/users/alice/inbox",
  "outbox": "https://social.example.com/users/alice/outbox",
  "publicKey": {
    "id": "https://social.example.com/users/alice#main-key",
    "owner": "https://social.example.com/users/alice",
    "publicKeyPem": "-----BEGIN PUBLIC KEY...END PUBLIC KEY-----"
  }
}
```

## 二期方案（Mastodon 兼容实现）

### 4.1 扩展字段列表（JSON-LD 投影）

| 扩展字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `manuallyApprovesFollowers` | Boolean | 是否需手动批准关注（对应 Mastodon `locked`） |
| `alsoKnownAs` | Array<URI> | 其他别名/别号链接（迁移/别名） |
| `movedTo` | URI | 迁移到的新 Actor IRI |
| `published` | Datetime | 账户创建时间 |
| `updated` | Datetime | 账户更新时间 |
| `discoverable` | Boolean | 是否允许被目录/索引发现 |
| `followersCount` | Integer | 粉丝计数 |
| `followingCount` | Integer | 关注计数 |
| `statusesCount` | Integer | 嘟文计数 |

> 以上扩展字段默认不在“一期”示例中返回；在需要兼容 Mastodon 客户端时再按策略投影。

### 4.2 Mastodon 扩展字段的存储拆分建议（单独表）

为避免将所有扩展字段耦合进通用 Actor 表，建议将 Mastodon 相关的扩展与派生计数字段拆分至独立表，便于演进与最小化通用层耦合。

#### 表结构（建议）

- 表名：`touch_actor_mastodon_meta`
- 关联：`actor_id` 外键指向 `touch_actor.id`，一对一
- 字段：
  - `actor_id (uint64, pk/unique)`：关联本地 Actor
  - `discoverable (boolean)`：是否允许被目录/索引发现
  - `manually_approves_followers (boolean)`：是否需要手动批准关注（Mastodon `locked`）
  - `followers_count (int)`：粉丝计数
  - `following_count (int)`：关注计数
  - `statuses_count (int)`：嘟文计数
  - `url (text)`：主页 URL（通常 `https://domain/@user`）
  - `moved_to_actor_uri (text)`：迁移目标 Actor IRI（如 `https://domain/users/newname`）
  - `also_known_as (jsonb)`：别名/别号 URI 列表（数组）
  - `last_webfingered_at (timestamp)`：最近 WebFinger 解析时间
  - `last_activity_at (timestamp)`：最近活动时间（展示用途）
  - `created_at (timestamp)`、`updated_at (timestamp)`

- 索引建议：
  - `unique (actor_id)` 保证一对一
  - `index (discoverable)` 便于目录过滤
  - `index (last_activity_at)` 便于按活跃度排序

#### JSON-LD 投影与生成策略

- 当生成 Actor 文档时：
  - 将 `manuallyApprovesFollowers`、`alsoKnownAs`、`movedTo`、`url`、`discoverable`、计数字段从 `touch_actor_mastodon_meta` 投影到输出 JSON-LD 中；
  - 计数字段（`followersCount`/`followingCount`/`statusesCount`）为展示/统计用途，属于扩展（非规范字段），置于自定义命名空间或作为兼容扩展键；
  - `endpoints.sharedInbox`、`inbox/outbox/followers/following/liked` 等仍由通用 Actor 层生成，避免与扩展表重复定义。

#### 读写路径与演进

- 写入：
  - Profile/设置页修改 `discoverable`、`manually_approves_followers`、别名/迁移等，落库 `touch_actor_mastodon_meta`；
  - 计数由后端事件（Follow/Unfollow、Create/Announce、Delete 等）驱动异步更新，或在查询时派生计算并按需缓存。

- 读取：
  - Actor JSON-LD 输出时合并通用 Actor 与 `mastodon_meta` 字段；
  - Mastodon 客户端 API（如 `GET /api/v1/accounts/...`）可直接读取并映射这些扩展字段。

- 兼容性：
  - 拆分不影响 ActivityPub 语义字段（`id/type/inbox/outbox/publicKey/...`）；
  - 扩展表可按 Mastodon 生态演进新增字段而不破坏通用层（例如新增索引属性、目录策略）。
