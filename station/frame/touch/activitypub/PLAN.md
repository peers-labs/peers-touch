# ActivityPub Outbox 实现计划

本文档描述了 ActivityPub Outbox 接口的完整实现计划，旨在支持标准规范中定义的核心活动类型。

## 1. 核心架构设计

### 1.1 请求处理流程
1.  **接收请求**: `POST /:username/outbox`
2.  **身份验证**: 验证请求发起者是否为当前用户（本地发布）或经过授权的客户端。
3.  **解析与验证**: 解析 JSON-LD Body 为 `Activity` 对象，验证必填字段（Type, Object, etc.）。
4.  **ID 生成**: 为 Activity 和内部 Object 生成唯一的 URI（如果未提供）。
5.  **类型分发**: 根据 `Activity.Type` 将请求分发到对应的处理器。
6.  **持久化**: 将 Activity 和 Object 存储到数据库。
7.  **副作用处理**: 执行业务逻辑（如更新计数、修改状态）。
8.  **联邦分发 (Future)**: 将 Activity 投递到接收者的 Inbox（本计划暂聚焦于本地处理与持久化）。

### 1.2 目录结构建议
```
station/frame/touch/activitypub/
├── outbox.go           # Outbox 入口处理函数
├── dispatcher.go       # Activity 类型分发逻辑
├── handlers/           # 具体 Activity 处理器
│   ├── create.go       # Handle Create (Note, Article)
│   ├── update.go       # Handle Update
│   ├── delete.go       # Handle Delete
│   ├── follow.go       # Handle Follow
│   ├── like.go         # Handle Like
│   └── undo.go         # Handle Undo
└── validation.go       # 请求验证逻辑
```

---

## 2. 详细实现步骤

### 2.1 基础 Activity 处理器 (`Create`)
**目标**: 支持发布内容（话题、博客）。
- **支持对象**: `Note` (短文), `Article` (长文), `Image` (图片)。
- **逻辑**:
    1. 提取 `object` 字段。
    2. 补全 `id`, `published`, `attributedTo` 字段。
    3. 将 `Object` 存入 `Objects` 表。
    4. 将 `Activity` 存入 `Activities` 表。
    5. 更新用户的 `outbox` 集合计数。

### 2.2 社交互动处理器
#### `Follow`
- **逻辑**:
    1. 验证 `object` 是一个有效的 Actor URI。
    2. 创建 `Follow` 记录（状态可能为 `pending`）。
    3. 如果目标是本地用户，触发通知；如果是远程用户，准备投递。

#### `Like`
- **逻辑**:
    1. 验证 `object` 是否存在。
    2. 创建 `Like` 记录。
    3. 增加对象的点赞计数。

#### `Announce` (Repost/Boost)
- **逻辑**:
    1. 验证 `object` 是否存在。
    2. 创建 `Announce` Activity。
    3. 增加对象的转发计数。

### 2.3 维护与撤销处理器
#### `Update`
- **逻辑**:
    1. 验证操作者权限（只能修改自己的对象）。
    2. 更新数据库中的对象内容。
    3. 更新 `updated` 时间戳。

#### `Delete`
- **逻辑**:
    1. 验证权限。
    2. 将对象标记为 `Tombstone` (墓碑) 或物理删除。
    3. 保留 ID 以防止重用。

#### `Undo`
- **逻辑**:
    1. 找到对应的原始 Activity (如之前的 Like 或 Follow)。
    2. 执行逆向操作（如移除 Like 记录，取消关注）。

---

## 3. 数据库模型需求 (GORM)
需要确保以下模型支持存储 ActivityPub 数据：
- **Activity**: 存储 Activity 的 JSON 结构、类型、Actor、Object ID。
- **Object**: 存储具体的 Note/Article 内容。
- **Follow**: 存储关注关系。
- **Like**: 存储点赞关系。

## 4. 接口规范示例
### 发布博客 (Create Article)
```json
POST /alice/outbox
Content-Type: application/activity+json

{
  "type": "Create",
  "object": {
    "type": "Article",
    "content": "内容...",
    "name": "标题",
    "attributedTo": "https://instance.com/alice"
  }
}
```
