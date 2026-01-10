# Actor Service

Actor 服务层，提供 Actor（参与主体）的查询和管理功能。

## 术语说明

在 Peers-Touch 中，我们使用 **Actor** 而不是 **User**：

- ✅ **Actor**：参与主体，可以是人、机器人、服务等
- ❌ **User**：传统的"用户"概念，过于中心化

这个命名来自 ActivityPub 协议，体现了去中心化的理念。

## 核心功能

### 1. Actor 查询

```go
// 通过 ID 查询
actor, err := actor.GetActorByID(ctx, actorID)

// 通过用户名查询
actor, err := actor.GetActorByUsername(ctx, "alice")

// 通过邮箱查询
actor, err := actor.GetActorByEmail(ctx, "alice@example.com")
```

### 2. Actor 列表

```go
// 列出所有 Actors（排除指定 ID）
actors, err := actor.ListActors(ctx, excludeActorID)

// 搜索 Actors
actors, err := actor.SearchActors(ctx, "alice", excludeActorID)
```

### 3. 所有权验证

```go
// 验证 Actor 是否拥有指定的用户名
err := actor.ValidateActorOwnership(ctx, actorID, username)
```

## Actor 模型

Actor 存储在 `touch_actor` 表中，包含以下关键字段：

```go
type Actor struct {
    ID                uint64    // 内部 ID
    PTID              string    // Peers-Touch ID（全局唯一）
    PreferredUsername string    // 用户名（@alice）
    Name              string    // 显示名称
    Email             string    // 邮箱
    PublicKey         string    // RSA 公钥
    PrivateKey        string    // RSA 私钥
    // ... 更多字段
}
```

## 与其他模块的关系

```
┌─────────────────┐
│  Handler Layer  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Actor Service  │ ← 本模块
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Database      │
└─────────────────┘
```

**调用示例**：

- `activitypub_handler.go` → `actor.GetActorByID()`
- `social/handler/post_handler.go` → `actor.GetActorByID()`

## 设计原则

1. **服务层封装**：Handler 不直接访问数据库
2. **统一命名**：使用 Actor 而不是 User
3. **去中心化**：每个 Actor 独立，拥有自己的密钥对
4. **可扩展**：支持未来的联邦功能

## 相关文档

- [Crypto Module](../crypto/README.md) - Actor 的密钥管理
- [Social API](../social/README.md) - Actor 的社交功能
- [Actor Model](../model/db/actor.go) - Actor 数据模型
