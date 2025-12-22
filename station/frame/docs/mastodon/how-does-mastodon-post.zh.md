# Mastodon 发帖、跟帖、转发的技术分析（请求参数、示例与数据库）

本文聚焦 Mastodon 在「发帖（Toot）」「跟贴（回复）」「转发（Boost/转嘟）」三个动作上的端到端路径：客户端请求 → REST API 参数结构 → 服务端持久化字段 → 联邦（ActivityPub）对象。结合实际请求示例与数据库字段示例，便于工程落地和对接。

## 总览
- 发帖：`POST /api/v1/statuses`
- 回复：同上接口，携带 `in_reply_to_id`
- 转发：`POST /api/v1/statuses/:id/reblog`（取消：`POST /api/v1/statuses/:id/unreblog`）
- 可选：引用转发（引用嘟）在 4.2+ 版本可用，参数为 `quote_id`
- 联邦层：发帖对应 ActivityPub `Create{ Note }`；转发对应 `Announce{ object=Note }`；回复在 `Note.inReplyTo` 字段中指向原贴对象 URI。

---

## 发帖（Create Status）

### REST API
- 路径：`POST /api/v1/statuses`
- 鉴权：Bearer 令牌（用户访问令牌），`Authorization: Bearer <token>`
- 参数（`application/x-www-form-urlencoded` 或 `multipart/form-data`）：
  - `status`: 文本内容（可选，若仅含媒体或投票亦可为空，但通常提供）
  - `media_ids[]`: 媒体附件 ID 数组（来自 `/api/v2/media` 或 `/api/v1/media` 的上传结果）
  - `poll[options][]`: 投票选项数组
  - `poll[expires_in]`: 投票持续秒数
  - `poll[multiple]`: 是否多选（布尔）
  - `poll[hide_totals]`: 是否隐藏票数（布尔）
  - `in_reply_to_id`: 回复目标状态 ID（用于跟贴，详见下文）
  - `visibility`: 可见性，取值：`public` | `unlisted` | `private` | `direct`
  - `sensitive`: 是否敏感内容（布尔）
  - `spoiler_text`: 内容警告（CW）说明文本
  - `language`: ISO 语言代码（如 `en`, `zh`, `ja`）
  - `scheduled_at`: 计划发送时间（ISO8601，未来时刻）
  - `quoted_status_id`: 引用的状态 ID（4.4+ 实验性特性或分支特性，注意 Mastodon 主线对引用的支持尚在演进中，部分客户端使用 `quote_id` 但 API 层面多对应 `quoted_status_id`）
  - `allowed_mentions[]`: 仅允许提及的账号 ID 列表（用于受限回复）

### 请求示例
```
curl -X POST https://example.social/api/v1/statuses \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "status=这是一条示例嘟文" \
  --data-urlencode "visibility=unlisted" \
  --data-urlencode "sensitive=false" \
  --data-urlencode "spoiler_text=内含技术细节" \
  --data-urlencode "language=zh"
```

### 返回（简化）
返回 `Status` JSON，对象含 `id`, `uri`, `created_at`, `visibility`, `sensitive`, `spoiler_text`, `language`, `account`, `media_attachments`, `poll`, `replies_count`, `reblogs_count`, `favourites_count` 等。

### 数据库字段（典型）
`statuses` 表（PostgreSQL）常见列：
- `id`: bigint 主键
- `account_id`: 所属账号 ID
- `text`: 文本内容（可能为空，若纯媒体/投票）
- `uri`: ActivityPub 对象 URI（联邦唯一标识）
- `url`: 本地或远端可浏览 URL
- `language`: 语言代码
- `sensitive`: boolean
- `spoiler_text`: CW 文本
- `visibility`: int 枚举（通常 0:public, 1:unlisted, 2:private, 3:direct）
- `in_reply_to_id`: 若为回复，指向原状态 ID
- `in_reply_to_account_id`: 原状态作者账号 ID
- `reblog_of_id`: 若为转发，指向被转发状态 ID
- `poll_id`: 关联投票记录
- `quote_approval_policy`: 引用批准策略
- `favourites_count`, `reblogs_count`, `replies_count`: 计数器（通常通过 `status_stats` 关联表或缓存列维护）
- `created_at`, `updated_at`, `edited_at`

> **注意**：Mastodon 的引用（Quote）通常不直接在 `statuses` 表中存储 `quote_id`，而是通过独立的 `quotes` 表关联（`quotes.status_id` 指向当前贴，`quotes.quoted_status_id` 指向原贴）。

### 数据实例（示意）
```
id               : 123456789012345678
account_id       : 1001
text             : "这是一条示例嘟文"
uri              : "https://example.social/users/alice/statuses/123456789012345678"
url              : "https://example.social/@alice/123456789012345678"
language         : "zh"
sensitive        : false
spoiler_text     : "内含技术细节"
visibility       : 1   -- unlisted
in_reply_to_id   : NULL
in_reply_to_account_id : NULL
reblog_of_id     : NULL
poll_id          : NULL
favourites_count : 0
reblogs_count    : 0
replies_count    : 0
created_at       : 2025-01-01T10:00:00Z
```

### 联邦对象（ActivityPub 简化）
发帖对应：
```
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "actor": "https://example.social/users/alice",
  "object": {
    "type": "Note",
    "id": "https://example.social/users/alice/statuses/123456789012345678",
    "attributedTo": "https://example.social/users/alice",
    "content": "这是一条示例嘟文",
    "sensitive": false,
    "summary": "内含技术细节",  // 对应 spoiler_text
    "to": ["https://www.w3.org/ns/activitystreams#Public"],
    "cc": ["..."],
    "language": "zh"
  }
}
```

---

## 跟贴（Reply）

### REST API
- 同发帖接口 `POST /api/v1/statuses`
- 关键参数：`in_reply_to_id` 指向被回复的状态 ID

### 请求示例
```
curl -X POST https://example.social/api/v1/statuses \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "status=收到，补充如下…" \
  --data-urlencode "in_reply_to_id=123456789012345678" \
  --data-urlencode "visibility=public" 
```

### 数据库字段（典型变化）
- `in_reply_to_id`: 设为 目标状态 ID
- `in_reply_to_account_id`: 设为 目标状态作者账号 ID（便于通知/权限判断）
- 其他字段与发帖一致

### 数据实例（示意）
```
id                     : 123456789012345679
account_id             : 1002
text                   : "收到，补充如下…"
in_reply_to_id         : 123456789012345678
in_reply_to_account_id : 1001
visibility             : 0  -- public
```

### 联邦对象（ActivityPub 简化）
回复的 `Note` 在对象中携带 `inReplyTo`：
```
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "actor": "https://example.social/users/bob",
  "object": {
    "type": "Note",
    "id": "https://example.social/users/bob/statuses/123456789012345679",
    "content": "收到，补充如下…",
    "inReplyTo": "https://example.social/users/alice/statuses/123456789012345678",
    "to": ["https://www.w3.org/ns/activitystreams#Public"]
  }
}
```

---

## 转发（Boost / Announce）

### REST API
- 路径：`POST /api/v1/statuses/:id/reblog`
- 可选参数：部分版本支持 `visibility` 指定转发的可见性（不指定时通常继承或按站点策略处理）
- 取消转发：`POST /api/v1/statuses/:id/unreblog`

### 请求示例
```
curl -X POST https://example.social/api/v1/statuses/123456789012345678/reblog \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "visibility=unlisted"
```

### 返回（简化）
返回目标 `Status`，其中 `reblogged: true`；同时本地会生成一条「转发状态」用于时间线展示与权限控制。

### 数据库字段（典型）
- 转发在 `statuses` 中作为一条记录，其：
  - `reblog_of_id`: 指向被转发的原状态 ID
  - `account_id`: 执行转发的账号 ID
  - `text`: 通常为空（不附加文本）；若实现“带评论的转发/引用”，则用 `quote_id`（见下）或在文本中附言
  - `visibility`, `sensitive`, `spoiler_text`: 按请求或站点策略设定

### 数据实例（示意）
```
id           : 223456789012345678
account_id   : 1002
text         : NULL
reblog_of_id : 123456789012345678
visibility   : 1  -- unlisted
```

### 联邦对象（ActivityPub 简化）
转发对应 `Announce`：
```
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Announce",
  "actor": "https://example.social/users/bob",
  "object": "https://example.social/users/alice/statuses/123456789012345678",
  "to": ["https://www.w3.org/ns/activitystreams#Public"]
}
```

---

## 引用（Quote）（可选特性，部分版本/分支支持）
 
### REST API
- 路径：`POST /api/v1/statuses`
- 参数：在常规发帖参数基础上增加 `quoted_status_id=<被引用状态ID>`（注意参数名可能依版本不同，标准主线多为 `quoted_status_id`），并在 `status` 中写入附言文本。
- 策略：可选 `quote_approval_policy` (public/followers/nobody)

### 数据库字段（典型）
- **不直接存储在 `statuses` 表**：通常有一张 `quotes` 表关联。
- `quotes` 表结构：
  - `status_id`: 引用贴（新帖）ID
  - `quoted_status_id`: 被引用贴（原贴）ID
  - `account_id`: 引用者 ID
  - `quoted_account_id`: 原作者 ID
- `statuses` 表中可能有 `quote_approval_policy` 字段。

### 数据实例（示意）
**statuses 表**
```
id         : 323456789012345678
account_id : 1002
text       : "对此我有几点看法……"
visibility : 0  -- public
```

**quotes 表**
```
id               : 1
status_id        : 323456789012345678
quoted_status_id : 123456789012345678
account_id       : 1002
quoted_account_id: 1001
```

---

## 关联表与计数
- `media_attachments`: 媒体资料，`status_id`, `description`, `blurhash`, `file_meta(jsonb)` 等
- `polls` / `poll_votes`: 投票及投票记录；`polls.status_id` 与 `statuses.poll_id` 关联
- `favourites`: 点赞关系，`account_id`, `status_id`
- `bookmarks`: 收藏关系，`account_id`, `status_id`
- `mentions`: @提及关系，指向被提及的 `account_id`
- `tags` / `statuses_tags`: 话题标签与状态的多对多关系

---

## 工程注意事项
- 参数一致性：客户端与服务端需对 `visibility/sensitive/spoiler_text/language` 做一致校验
- 计数一致性：转发/点赞/回复计数通过异步作业与联邦事件同步更新，避免强一致锁
- 权限边界：`private/direct` 可见性下的转发/引用可能受限，应遵循站点策略
- 联邦兼容：`Announce` 与 `Create{Note}` 的对象 URI 与签名校验需严格遵守 ActivityPub 与 HTTP 签名规范

---

## 快速自检清单
- 发帖参数是否正确解析并落库（含 CW、语言、可见性）
- 回复是否正确写入 `in_reply_to_id` 与 `in_reply_to_account_id`
- 转发是否生成一条 `statuses` 记录并设置 `reblog_of_id`
- 引用（若启用）是否正确写入 `quotes` 关联表，并在前端呈现原文卡片
- 联邦对象的 `Create/Announce` 是否能被友站正确消费
