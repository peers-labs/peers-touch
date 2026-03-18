# Friend Chat API 接口格式状态

## 接口列表（共10个）

| 序号 | 接口路径 | 方法 | 客户端格式 | Station格式 | 状态 |
|------|----------|------|------------|-------------|------|
| 1 | `/friend-chat/session/create` | POST | **JSON** | **JSON** | ⚠️ 待改造 |
| 2 | `/friend-chat/sessions` | GET | **JSON** | **JSON** | ⚠️ 待改造 |
| 3 | `/friend-chat/message/send` | POST | **Proto** ✅ | **Proto/JSON** ✅ | ✅ 已完成 |
| 4 | `/friend-chat/message/sync` | POST | **Proto** ✅ | **Proto** ✅ | ✅ 已完成 |
| 5 | `/friend-chat/messages` | GET | **JSON** | **JSON** | ⚠️ 待改造 |
| 6 | `/friend-chat/message/ack` | POST | **JSON** | **JSON** | ⚠️ 待改造 |
| 7 | `/friend-chat/online` | POST | **JSON** | **JSON** | ⚠️ 待改造 |
| 8 | `/friend-chat/offline` | POST | **JSON** | **JSON** | ⚠️ 待改造 |
| 9 | `/friend-chat/pending` | GET | **JSON** | **JSON** | ⚠️ 待改造 |
| 10 | `/friend-chat/stats` | GET | N/A | **JSON** | ⚠️ 待改造 |

## 详细说明

### ✅ 已使用 Proto 的接口（2个）

#### 1. `/friend-chat/message/send` - 发送消息
- **客户端**: 使用 `fc.SendMessageRequest` Proto
- **Station**: 支持双格式（Proto/JSON）
  - `Content-Type: application/protobuf` → Proto handler
  - `Content-Type: application/json` → JSON handler
- **代码位置**:
  - Client: `friend_chat_api_service.dart:189-211`
  - Station: `handler.go:159-169` (unified), `169-258` (proto), `259-329` (json)

#### 2. `/friend-chat/message/sync` - 同步消息
- **客户端**: 使用 `fc.SyncMessagesRequest` Proto
- **Station**: 仅 Proto 格式
- **代码位置**:
  - Client: `friend_chat_api_service.dart:213-224`
  - Station: `handler.go:330-384`

### ⚠️ 仍使用 JSON 的接口（8个）

#### 3. `/friend-chat/session/create` - 创建会话
- **客户端**: JSON (`{'participant_did': ...}`)
- **Station**: JSON
- **代码**: `friend_chat_api_service.dart:173-179`, `handler.go:50-111`

#### 4. `/friend-chat/sessions` - 获取会话列表
- **客户端**: JSON (GET query params)
- **Station**: JSON 响应
- **代码**: `friend_chat_api_service.dart:181-187`, `handler.go:113-157`

#### 5. `/friend-chat/messages` - 获取消息列表
- **客户端**: JSON (GET query params)
- **Station**: JSON 响应
- **代码**: `friend_chat_api_service.dart:226-240`, `handler.go:401-442`
- **注意**: 这是之前报 500 错误的接口

#### 6. `/friend-chat/message/ack` - 确认消息
- **客户端**: JSON (`{'ulids': [...], 'status': 2}`)
- **Station**: JSON
- **代码**: `friend_chat_api_service.dart:242-250`, `handler.go:444-464`

#### 7. `/friend-chat/online` - 标记在线
- **客户端**: JSON (`{'did': ...}`)
- **Station**: JSON
- **代码**: `friend_chat_api_service.dart:252-257`, `handler.go:466-479`

#### 8. `/friend-chat/offline` - 标记离线
- **客户端**: JSON (`{'did': ...}`)
- **Station**: JSON
- **代码**: `friend_chat_api_service.dart:259-264`, `handler.go:481-505`

#### 9. `/friend-chat/pending` - 获取待发消息
- **客户端**: JSON (GET query params)
- **Station**: JSON 响应
- **代码**: `friend_chat_api_service.dart:266-276`, `handler.go:507-533`

#### 10. `/friend-chat/stats` - 统计信息
- **客户端**: 未使用
- **Station**: JSON 响应
- **代码**: `handler.go:535-545`

## 改造优先级建议

根据项目规范"域内接口默认必须是 Proto"，建议按以下优先级改造：

### 🔥 高优先级（核心功能）
1. **`/friend-chat/messages`** - 获取消息列表（当前有 500 错误问题）
2. **`/friend-chat/session/create`** - 创建会话
3. **`/friend-chat/sessions`** - 获取会话列表

### 📝 中优先级（辅助功能）
4. **`/friend-chat/message/ack`** - 确认消息
5. **`/friend-chat/pending`** - 获取待发消息

### 🔽 低优先级（状态管理）
6. **`/friend-chat/online`** - 标记在线
7. **`/friend-chat/offline`** - 标记离线
8. **`/friend-chat/stats`** - 统计信息

## Proto 定义检查

需要在 `friend_chat.proto` 中定义以下消息类型（如果尚未定义）：

- [x] `SendMessageRequest` / `SendMessageResponse`
- [x] `SyncMessagesRequest` / `SyncMessagesResponse`
- [ ] `CreateSessionRequest` / `CreateSessionResponse`
- [ ] `GetSessionsRequest` / `GetSessionsResponse`
- [ ] `GetMessagesRequest` / `GetMessagesResponse`
- [ ] `AckMessagesRequest` / `AckMessagesResponse`
- [ ] `MarkOnlineRequest` / `MarkOnlineResponse`
- [ ] `MarkOfflineRequest` / `MarkOfflineResponse`
- [ ] `GetPendingRequest` / `GetPendingResponse`

## 总结

- ✅ **已完成 Proto**: 2/10 (20%)
- ⚠️ **待改造**: 8/10 (80%)
- 🎯 **符合规范**: `/message/send` 和 `/message/sync` 两个核心消息接口已使用 Proto
