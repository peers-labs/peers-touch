# Friend Chat Architecture Design

> Historical proposal. This document preserves an earlier Friend Chat architecture draft with phase planning and older path conventions. It is not the current Station, Client, or architecture source of truth.
> Current sources should be located from `docs/README.md`.
 
> **Status**: Draft  
> **Version**: 4.0 (Refactored)  
> **Date**: 2026-01-22  
> **Author**: Architecture Team  
> **Dependencies**: `ice-capability-design.md` (✅ Implemented)

---

## 📋 Executive Summary

This document defines the **Friend Chat** capability as a **decentralized, privacy-first messaging system** built on top of the Peers-Touch ICE infrastructure.

### Key Principles

1. **Privacy-First**: End-to-end encryption, no server-side message reading
2. **Decentralized**: P2P direct connection when possible, Station relay as fallback
3. **Persistent**: All messages stored in database for history retrieval
4. **Resilient**: Offline message queue for disconnected users
5. **Layered**: Clean separation of concerns (Handler → Service → Repository)

---

## 🏗️ Station Architecture

### Directory Structure (Reference: OSS SubServer)

```
station/app/subserver/friend_chat/
├── db/
│   ├── model/
│   │   ├── session.go          # FriendChatSession
│   │   ├── message.go          # FriendChatMessage
│   │   ├── attachment.go       # FriendMessageAttachment
│   │   └── offline.go          # OfflineMessage
│   └── repo/
│       ├── session_repo.go     # SessionRepository interface
│       ├── message_repo.go     # MessageRepository interface
│       └── offline_repo.go     # OfflineRepository interface
├── service/
│   ├── session_service.go      # Session business logic
│   ├── message_service.go      # Message business logic
│   └── relay_service.go        # Offline relay logic
├── handler.go                  # HTTP handlers
├── friend_chat.go              # SubServer entry point
└── options.go                  # Configuration options
```

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP Handlers                             │
│  handler.go                                                  │
│  - handleSendMessage()                                       │
│  - handleSyncMessages()                                      │
│  - handleGetMessages()                                       │
│  - handleGetSessions()                                       │
│  - handleOnline() / handleOffline()                         │
└─────────────────────────────────────────────────────────────┘
                         ↓ calls
┌─────────────────────────────────────────────────────────────┐
│                    Service Layer                             │
│  service/message_service.go                                  │
│  service/session_service.go                                  │
│  service/relay_service.go                                    │
│  - Business logic                                            │
│  - Transaction management                                    │
│  - Cross-entity operations                                   │
└─────────────────────────────────────────────────────────────┘
                         ↓ calls
┌─────────────────────────────────────────────────────────────┐
│                   Repository Layer                           │
│  db/repo/message_repo.go                                     │
│  db/repo/session_repo.go                                     │
│  db/repo/offline_repo.go                                     │
│  - CRUD operations                                           │
│  - Database abstraction                                      │
└─────────────────────────────────────────────────────────────┘
                         ↓ uses
┌─────────────────────────────────────────────────────────────┐
│                    Data Models                               │
│  db/model/*.go                                               │
│  - FriendChatSession                                         │
│  - FriendChatMessage                                         │
│  - OfflineMessage                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 📡 API Endpoints

### Complete API List

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/friend-chat/session/create` | POST | JWT | Create or get existing session |
| `/friend-chat/sessions` | GET | JWT | Get user's session list |
| `/friend-chat/message/send` | POST | JWT | Send message (Relay mode, immediate store) |
| `/friend-chat/message/sync` | POST | JWT | Batch sync messages (P2P mode) |
| `/friend-chat/messages` | GET | JWT | Get message history |
| `/friend-chat/message/ack` | POST | JWT | Mark messages as delivered/read |
| `/friend-chat/online` | POST | JWT | Mark user online |
| `/friend-chat/offline` | POST | JWT | Mark user offline |
| `/friend-chat/pending` | GET | JWT | Get pending offline messages |
| `/friend-chat/stats` | GET | - | Get service statistics |

### API Details

#### 1. Send Message (Relay Mode)

```http
POST /friend-chat/message/send
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "session_ulid": "01HQXYZ...",
  "receiver_did": "did:peers:bob",
  "type": 1,
  "content": "Hello!",
  "reply_to_ulid": ""
}

Response:
{
  "message": {
    "ulid": "01HQABC...",
    "session_ulid": "01HQXYZ...",
    "sender_did": "did:peers:alice",
    "receiver_did": "did:peers:bob",
    "type": 1,
    "content": "Hello!",
    "status": 1,
    "sent_at": 1705708800
  },
  "delivery_status": "delivered" | "queued"
}
```

#### 2. Batch Sync Messages (P2P Mode)

```http
POST /friend-chat/message/sync
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "messages": [
    {
      "ulid": "01HQABC...",
      "session_ulid": "01HQXYZ...",
      "receiver_did": "did:peers:bob",
      "type": 1,
      "content": "Hello!",
      "sent_at": 1705708800
    },
    {
      "ulid": "01HQDEF...",
      "session_ulid": "01HQXYZ...",
      "receiver_did": "did:peers:bob",
      "type": 1,
      "content": "How are you?",
      "sent_at": 1705708805
    }
  ]
}

Response:
{
  "synced": 2,
  "failed": []
}
```

#### 3. Get Messages

```http
GET /friend-chat/messages?session_ulid=01HQXYZ&before_ulid=&limit=50
Authorization: Bearer <jwt>

Response:
{
  "messages": [...],
  "has_more": true
}
```

#### 4. Create/Get Session

```http
POST /friend-chat/session/create
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "participant_did": "did:peers:bob"
}

Response:
{
  "session": {
    "ulid": "01HQXYZ...",
    "participant_a_did": "did:peers:alice",
    "participant_b_did": "did:peers:bob",
    "last_message_at": 0,
    "created_at": 1705708800
  },
  "created": true | false
}
```

---

## 🔄 Message Flow

### Key Principle: All Messages Are Stored

**无论 P2P 还是 Relay，所有消息都存储到 `FriendChatMessage` 表。**

### Connection Modes

| Mode | Description | Latency | When Used |
|------|-------------|---------|-----------|
| **P2P Direct** | WebRTC DataChannel | ~50ms | NAT traversal successful |
| **Station Relay** | HTTP API | ~100ms | P2P failed, fallback |

### Scenario 1: P2P Direct Mode (Real-time + Batch Sync)

**P2P 模式下，消息实时发送，但批量同步到服务器。**

```
Alice (Client)                    Station A                    Bob (Client)
     │                                │                            │
     │══(1) P2P Send (RTCClient)═════════════════════════════════>│
     │    (Real-time, ~50ms)          │                            │
     │                                │                            │
     │<═(2) P2P ACK════════════════════════════════════════════════│
     │                                │                            │
     │    [Message added to local buffer]                          │
     │                                │                            │
     │    ... more P2P messages ...   │                            │
     │                                │                            │
     │    [Trigger: 10 messages OR 10 seconds]                     │
     │                                │                            │
     │──(3) POST /message/sync───────>│                            │
     │    {messages: [...10 msgs]}    │                            │
     │                                │                            │
     │                                │──(4) Batch store to DB────>│
     │                                │    FriendChatMessage x 10  │
     │                                │                            │
     │<─(5) Return {synced: 10}───────│                            │
     │                                │                            │

Result: Real-time P2P delivery + batch persistence
```

**Sync Trigger Rules:**
- **Message count**: Every 10 messages
- **Time interval**: Every 10 seconds
- **Whichever comes first**

### Scenario 2: Station Relay Mode (Immediate Store)

**Relay 模式下，每条消息立即存储。**

```
Alice (Client)                    Station A                    Bob (Client)
     │                                │                            │
     │──(1) POST /message/send───────>│                            │
     │    {receiver: bob, content}    │                            │
     │                                │                            │
     │                                │──(2) Store to DB──────────>│
     │                                │    FriendChatMessage       │
     │                                │    FriendChatSession       │
     │                                │                            │
     │                                │──(3) Check Bob online─────>│
     │                                │    onlinePeers[bob] = true │
     │                                │                            │
     │<─(4) Return {status: delivered}│                            │
     │                                │                            │

Result: Message stored in DB immediately
```

### Scenario 3: Receiver Offline (Store + Queue)

```
Alice (Client)                    Station A                    Bob (Offline)
     │                                │                            │
     │──(1) POST /message/send───────>│                            │
     │    {receiver: bob, content}    │                            │
     │                                │                            │
     │                                │──(2) Store to DB──────────>│
     │                                │    FriendChatMessage       │
     │                                │    FriendChatSession       │
     │                                │                            │
     │                                │──(3) Check Bob online─────>│
     │                                │    onlinePeers[bob] = false│
     │                                │                            │
     │                                │──(4) Queue offline msg────>│
     │                                │    OfflineMessage          │
     │                                │                            │
     │<─(5) Return {status: queued}───│                            │
     │                                │                            │
     │                                │    (Bob comes online)      │
     │                                │<─(6) POST /online──────────│
     │                                │                            │
     │                                │──(7) GET /pending──────────│
     │                                │    Return offline messages │
     │                                │                            │
     │                                │──(8) POST /message/ack─────│
     │                                │    Mark as delivered       │

Result: Message stored in DB + queued for offline delivery
```

---

## 📊 Data Models

### Database Schema

```sql
-- Session table (one per friend pair)
CREATE TABLE touch_friend_chat_session (
    id BIGINT PRIMARY KEY,
    ulid VARCHAR(26) UNIQUE NOT NULL,
    participant_a_did VARCHAR(255) NOT NULL,
    participant_b_did VARCHAR(255) NOT NULL,
    last_message_ulid VARCHAR(26),
    last_message_at TIMESTAMP,
    unread_count_a INT DEFAULT 0,
    unread_count_b INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_participants (participant_a_did, participant_b_did)
);

-- Message table (all messages)
CREATE TABLE touch_friend_chat_message (
    id BIGINT PRIMARY KEY,
    ulid VARCHAR(26) UNIQUE NOT NULL,
    session_ulid VARCHAR(26) NOT NULL,
    sender_did VARCHAR(255) NOT NULL,
    receiver_did VARCHAR(255) NOT NULL,
    type INT DEFAULT 1,
    content TEXT,
    reply_to_ulid VARCHAR(26),
    status INT DEFAULT 1,
    sent_at TIMESTAMP DEFAULT NOW(),
    delivered_at TIMESTAMP,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_session (session_ulid),
    INDEX idx_sender (sender_did),
    INDEX idx_receiver (receiver_did)
);

-- Offline queue (temporary, for disconnected users)
CREATE TABLE touch_offline_message (
    id BIGINT PRIMARY KEY,
    ulid VARCHAR(26) UNIQUE NOT NULL,
    receiver_did VARCHAR(255) NOT NULL,
    sender_did VARCHAR(255) NOT NULL,
    session_ulid VARCHAR(26) NOT NULL,
    message_ulid VARCHAR(26) NOT NULL,           -- Reference to FriendChatMessage
    encrypted_payload BYTEA NOT NULL,             -- Encrypted message content
    status INT DEFAULT 1,
    expire_at TIMESTAMP NOT NULL,
    delivered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_receiver_status (receiver_did, status),
    INDEX idx_expire (expire_at),
    FOREIGN KEY (message_ulid) REFERENCES touch_friend_chat_message(ulid)
);
```

### Go Models

```go
// db/model/session.go
type FriendChatSession struct {
    ID              uint64    `gorm:"primaryKey;autoIncrement:false"`
    ULID            string    `gorm:"uniqueIndex;size:26;not null"`
    ParticipantADID string    `gorm:"size:255;not null;index"`
    ParticipantBDID string    `gorm:"size:255;not null;index"`
    LastMessageULID string    `gorm:"size:26"`
    LastMessageAt   time.Time `gorm:"index"`
    UnreadCountA    int32     `gorm:"default:0"`
    UnreadCountB    int32     `gorm:"default:0"`
    CreatedAt       time.Time
    UpdatedAt       time.Time
}

// db/model/message.go
type FriendChatMessage struct {
    ID          uint64     `gorm:"primaryKey;autoIncrement:false"`
    ULID        string     `gorm:"uniqueIndex;size:26;not null"`
    SessionULID string     `gorm:"size:26;not null;index"`
    SenderDID   string     `gorm:"size:255;not null;index"`
    ReceiverDID string     `gorm:"size:255;not null;index"`
    Type        int32      `gorm:"default:1"`
    Content     string     `gorm:"type:text"`
    ReplyToULID string     `gorm:"size:26"`
    Status      int32      `gorm:"default:1"`
    SentAt      time.Time
    DeliveredAt *time.Time
    ReadAt      *time.Time
    CreatedAt   time.Time
    UpdatedAt   time.Time
}

// db/model/offline.go
type OfflineMessage struct {
    ID          uint64     `gorm:"primaryKey;autoIncrement:false"`
    ULID        string     `gorm:"uniqueIndex;size:26;not null"`
    ReceiverDID string     `gorm:"size:255;not null;index"`
    SenderDID   string     `gorm:"size:255;not null"`
    SessionULID string     `gorm:"size:26;not null"`
    MessageULID string     `gorm:"size:26;not null"`
    Status      int32      `gorm:"default:1"`
    ExpireAt    time.Time  `gorm:"index"`
    DeliveredAt *time.Time
    CreatedAt   time.Time
    UpdatedAt   time.Time
}
```

---

## 🎨 Client Architecture

### Directory Structure

```
client/common/peers_touch_base/lib/network/friend_chat/
├── friend_chat_api_service.dart    # HTTP API client
├── models/
│   ├── session.dart                # Session model
│   └── message.dart                # Message model
└── friend_chat_service.dart        # High-level service

client/desktop/lib/features/friend_chat/
├── controller/
│   └── friend_chat_controller.dart # GetX controller
├── view/
│   └── friend_chat_page.dart       # Main page
└── widgets/
    ├── session_list_item.dart      # Session list item
    ├── chat_message_item.dart      # Message bubble
    ├── chat_input_bar.dart         # Input bar
    └── connection_debug_panel.dart # Debug panel with connection mode
```

### Connection Mode Display

**Debug Panel 显示当前连接模式：**

```dart
enum ConnectionMode {
  p2pDirect,     // P2P 直连 (WebRTC DataChannel)
  stationRelay,  // Station 中继 (HTTP API)
  disconnected,  // 未连接
}

class ConnectionStats {
  final ConnectionMode mode;           // 当前连接模式
  final P2PConnectionState p2pState;   // P2P 连接状态
  final int latencyMs;                 // 延迟 (ms)
  final int messagesSent;              // 已发送消息数
  final int messagesReceived;          // 已接收消息数
  final int pendingSyncCount;          // 待同步消息数
  final DateTime? lastSyncAt;          // 上次同步时间
  // ...
}
```

**UI 显示：**
```
┌─────────────────────────────────┐
│ P2P Debug                    🔄 │
├─────────────────────────────────┤
│ ● Connected                     │
│                                 │
│ 📡 Connection Mode              │
│ Mode          P2P Direct ✅     │
│ Latency       45ms              │
│                                 │
│ 📊 Sync Status                  │
│ Pending       3 messages        │
│ Last Sync     10s ago           │
│                                 │
│ 📈 Message Statistics           │
│ Sent          42                │
│ Received      38                │
└─────────────────────────────────┘
```

### Message Send Flow (Client)

```dart
// FriendChatController - 连接模式感知的消息发送

class FriendChatController extends GetxController {
  final connectionMode = ConnectionMode.disconnected.obs;
  final _pendingMessages = <ChatMessage>[];
  Timer? _syncTimer;
  
  static const _syncMessageThreshold = 10;
  static const _syncTimeInterval = Duration(seconds: 10);

  @override
  void onInit() {
    super.onInit();
    _startSyncTimer();
  }

  void _startSyncTimer() {
    _syncTimer = Timer.periodic(_syncTimeInterval, (_) => _syncPendingMessages());
  }

  Future<void> sendMessage(String content) async {
    final message = ChatMessage(
      ulid: Ulid().toString(),
      sessionUlid: currentSession.ulid,
      senderId: currentUserId,
      content: content,
      status: MessageStatus.sending,
    );
    messages.add(message);

    if (connectionMode.value == ConnectionMode.p2pDirect) {
      // P2P Mode: Real-time send + batch sync
      _rtcClient!.send(content);
      message.status = MessageStatus.sent;
      _pendingMessages.add(message);
      
      // Check if should sync now
      if (_pendingMessages.length >= _syncMessageThreshold) {
        await _syncPendingMessages();
      }
    } else {
      // Relay Mode: Immediate store via API
      final response = await _chatApi.sendMessage(
        sessionUlid: currentSession.ulid,
        receiverDid: remotePeerId,
        content: content,
      );
      message.status = response.deliveryStatus == 'delivered'
          ? MessageStatus.delivered
          : MessageStatus.sent;
    }
  }

  Future<void> _syncPendingMessages() async {
    if (_pendingMessages.isEmpty) return;
    
    final toSync = List<ChatMessage>.from(_pendingMessages);
    _pendingMessages.clear();
    
    try {
      await _chatApi.syncMessages(toSync);
      connectionStats.value = connectionStats.value.copyWith(
        lastSyncAt: DateTime.now(),
        pendingSyncCount: 0,
      );
    } catch (e) {
      // Put back to pending queue on failure
      _pendingMessages.insertAll(0, toSync);
    }
  }
}
```

---

## 🔐 Security

### Message Status

| Status | Value | Description |
|--------|-------|-------------|
| SENDING | 0 | Client sending |
| SENT | 1 | Stored in DB |
| DELIVERED | 2 | Receiver received |
| READ | 3 | Receiver read |
| FAILED | 4 | Send failed |

### Offline Message Lifecycle

```
1. Message sent → Store to FriendChatMessage (status=SENT)
2. Receiver offline → Queue to OfflineMessage (status=pending)
3. Receiver online → Deliver via /pending API
4. Receiver ACK → Update OfflineMessage (status=delivered)
5. 7 days expired → Cleanup OfflineMessage
```

---

## 🔄 Complete End-to-End Flows

### Flow 1: 初始化和会话创建

```
Client A 启动:
  1. 调用 POST /friend-chat/online {did: "alice"}
  2. 调用 GET /friend-chat/sessions?did=alice
     → 获取所有会话列表
  3. 用户选择好友 Bob 开始聊天
  4. 调用 POST /friend-chat/session/create {participant_did: "bob"}
     → 创建或获取会话 (session_ulid: "01HQXYZ...")
  5. 调用 GET /friend-chat/messages?session_ulid=01HQXYZ&limit=50
     → 加载历史消息
  6. 尝试建立 P2P 连接:
     a. 调用 POST /api/v1/ice/peer/register {id: "alice", addrs: [...]}
     b. 调用 POST /api/v1/ice/session/new {a: "alice", b: "bob"}
     c. 调用 GET /api/v1/turn/ice-servers → 获取 STUN/TURN
     d. 创建 RTCPeerConnection，设置 ICE servers
     e. 创建 DataChannel "chat"
     f. 生成 SDP offer → POST /api/v1/ice/session/offer
     g. 轮询 GET /api/v1/ice/session/answer 获取 Bob 的 answer
     h. 交换 ICE candidates
     i. 连接建立 → connectionMode = p2pDirect
```

### Flow 2: 发送消息（P2P 模式）

```
Client A 发送消息:
  1. 用户输入 "Hello!" 并点击发送
  2. 生成 message ULID: "01HQABC..."
  3. 创建本地消息对象:
     {
       ulid: "01HQABC...",
       session_ulid: "01HQXYZ...",
       sender_did: "alice",
       receiver_did: "bob",
       content: "Hello!",
       status: SENDING,
       sent_at: now()
     }
  4. 添加到 UI (optimistic update)
  5. 检查连接模式:
     if (connectionMode == p2pDirect) {
       a. 通过 DataChannel 发送: rtcClient.send("Hello!")
       b. 更新状态: status = SENT
       c. 添加到 _pendingMessages 缓冲区
       d. 检查同步触发条件:
          if (_pendingMessages.length >= 10 || lastSync > 10s) {
            调用 POST /friend-chat/message/sync {messages: [...]}
          }
     } else {
       a. 调用 POST /friend-chat/message/send
       b. 根据 delivery_status 更新状态
     }

Client B 接收消息:
  1. DataChannel.onMessage 触发
  2. 解析消息内容
  3. 创建消息对象并添加到 UI
  4. 调用 POST /friend-chat/message/ack {ulids: ["01HQABC..."], status: 2}
     → 标记为已送达
```

### Flow 3: 发送消息（Relay 模式）

```
Client A 发送消息:
  1. 用户输入 "Hello!" 并点击发送
  2. 创建本地消息对象 (status: SENDING)
  3. 调用 POST /friend-chat/message/send {
       session_ulid: "01HQXYZ...",
       receiver_did: "bob",
       content: "Hello!"
     }
  4. Station 处理:
     a. 存储到 FriendChatMessage 表
     b. 更新 FriendChatSession.last_message_at
     c. 检查 Bob 是否在线 (onlinePeers map)
     d. if (Bob 离线) {
          存储到 OfflineMessage 表
          返回 {delivery_status: "queued"}
        } else {
          返回 {delivery_status: "delivered"}
        }
  5. Client A 更新消息状态

Client B 上线后:
  1. 调用 POST /friend-chat/online {did: "bob"}
  2. 调用 GET /friend-chat/pending?did=bob
     → 获取离线消息列表
  3. 显示离线消息
  4. 调用 POST /friend-chat/message/ack {ulids: [...]}
     → 确认已接收
```

### Flow 4: P2P 连接失败降级

```
Client A 尝试 P2P:
  1. 创建 RTCPeerConnection
  2. 等待 ICE 连接状态:
     - checking → 显示 "Connecting..."
     - connected → connectionMode = p2pDirect
     - failed → 降级到 Relay 模式
  3. if (connectionState == failed) {
       a. 关闭 RTCPeerConnection
       b. connectionMode = stationRelay
       c. 将 _pendingMessages 中的消息通过 API 发送
       d. 后续消息使用 POST /friend-chat/message/send
     }
```

### Flow 5: 消息状态更新

```
消息状态流转:
  SENDING (0) → 客户端正在发送
     ↓
  SENT (1) → 已发送到服务器/P2P
     ↓
  DELIVERED (2) → 接收方已收到
     ↓
  READ (3) → 接收方已读

实现:
  1. 发送方: 发送成功后 status = SENT
  2. 接收方: 收到消息后调用 POST /message/ack {status: 2}
  3. 发送方: 轮询或通过 P2P 通知更新为 DELIVERED
  4. 接收方: 用户查看消息后调用 POST /message/ack {status: 3}
  5. 发送方: 更新为 READ (显示双勾)
```

### Flow 6: 错误处理和重试

```
发送失败处理:
  1. 网络错误:
     - 保留在 _pendingMessages
     - 定时器触发重试 (exponential backoff)
     - 最多重试 3 次
     - 失败后 status = FAILED，显示重发按钮
  
  2. P2P 连接断开:
     - 自动降级到 Relay 模式
     - 将缓冲区消息通过 API 发送
  
  3. 服务器错误 (5xx):
     - 显示错误提示
     - 保留消息在本地
     - 用户可手动重试
```

---

## 🚀 Implementation Checklist

### Phase 1: Station Backend ✅ (Completed)

- [x] Refactor `friend_chat` subserver structure
  - [x] Create `db/model/` directory with models (session, message, attachment, offline)
  - [x] Create `db/repo/` directory with repositories
  - [x] Create `service/` directory with services
  - [x] Update `handler.go` with clean handlers
- [x] Implement APIs
  - [x] `POST /friend-chat/session/create`
  - [x] `GET /friend-chat/sessions`
  - [x] `POST /friend-chat/message/send`
  - [x] `POST /friend-chat/message/sync`
  - [x] `GET /friend-chat/messages`
  - [x] `POST /friend-chat/message/ack`
  - [x] `POST /friend-chat/online`
  - [x] `POST /friend-chat/offline`
  - [x] `GET /friend-chat/pending`

### Phase 2: Client Integration (Current)

#### 2.1 API Service Layer
- [ ] Update `FriendChatApiService` with new APIs
  - [ ] `createSession(participantDid)` → POST /session/create
  - [ ] `getSessions(did)` → GET /sessions
  - [ ] `sendMessage(...)` → POST /message/send
  - [ ] `syncMessages(messages)` → POST /message/sync
  - [ ] `getMessages(sessionUlid, beforeUlid, limit)` → GET /messages
  - [ ] `ackMessages(ulids, status)` → POST /message/ack
  - [ ] `markOnline(did)` → POST /online
  - [ ] `markOffline(did)` → POST /offline
  - [ ] `getPendingMessages(did)` → GET /pending

#### 2.2 Controller Layer
- [ ] Update `FriendChatController`
  - [ ] Add `connectionMode` observable (p2pDirect/stationRelay/disconnected)
  - [ ] Add `_pendingMessages` buffer for P2P mode
  - [ ] Add `_syncTimer` for periodic sync (10 seconds)
  - [ ] Implement `_autoConnect()` - 自动建立 P2P 连接
  - [ ] Implement `_determineConnectionMode()` - 根据 P2P 状态决定模式
  - [ ] Update `sendMessage()` - 根据 connectionMode 选择发送方式
  - [ ] Implement `_syncPendingMessages()` - 批量同步到服务器
  - [ ] Implement `_handleP2PMessage()` - 处理 P2P 接收的消息
  - [ ] Implement `_loadPendingMessages()` - 加载离线消息
  - [ ] Update `onInit()` - 调用 markOnline 和加载 sessions
  - [ ] Update `onClose()` - 调用 markOffline 和清理资源

#### 2.3 UI Layer
- [ ] Update `ConnectionDebugPanel`
  - [ ] Add `connectionMode` display (P2P Direct / Station Relay)
  - [ ] Add `pendingSyncCount` display
  - [ ] Add `lastSyncAt` display
  - [ ] Add latency indicator
- [ ] Update `FriendChatPage`
  - [ ] Show connection mode indicator in header
  - [ ] Show message status icons (sending/sent/delivered/read)
  - [ ] Add retry button for failed messages
- [ ] Update `ChatMessageItem`
  - [ ] Add status icon (single check / double check / read)
  - [ ] Add timestamp display
  - [ ] Add error indicator for failed messages

#### 2.4 Message Flow Implementation
- [ ] **发送消息流程**
  - [ ] Optimistic UI update (立即显示消息)
  - [ ] P2P mode: send via DataChannel + buffer for sync
  - [ ] Relay mode: send via API immediately
  - [ ] Handle send failures and retry logic
- [ ] **接收消息流程**
  - [ ] P2P mode: handle DataChannel.onMessage
  - [ ] Relay mode: poll /pending on app resume
  - [ ] Call /message/ack after receiving
  - [ ] Update UI with new messages
- [ ] **消息状态同步**
  - [ ] Implement status update mechanism (SENT → DELIVERED → READ)
  - [ ] Update message status icons in UI
  - [ ] Handle status updates from server

### Phase 3: P2P Connection Management

- [ ] **P2P 连接建立**
  - [ ] Call `/api/v1/ice/peer/register` on app start
  - [ ] Call `/api/v1/ice/session/new` when selecting chat
  - [ ] Get ICE servers from `/api/v1/turn/ice-servers`
  - [ ] Create RTCPeerConnection with ICE servers
  - [ ] Create DataChannel "chat"
  - [ ] Exchange SDP offer/answer via `/api/v1/ice/session/*`
  - [ ] Exchange ICE candidates
  - [ ] Monitor connection state changes
- [ ] **P2P 连接失败处理**
  - [ ] Detect connection failure (timeout or ICE failed state)
  - [ ] Auto-fallback to Relay mode
  - [ ] Flush pending messages via API
  - [ ] Show connection mode change notification
- [ ] **P2P 重连机制**
  - [ ] Detect connection loss (DataChannel closed)
  - [ ] Attempt reconnection (max 3 retries)
  - [ ] Fallback to Relay if reconnection fails

### Phase 4: Advanced Features (Future)

- [ ] **End-to-End Encryption**
  - [ ] Generate key pairs for each user
  - [ ] Implement message encryption/decryption
  - [ ] Key exchange via Signal Protocol or similar
- [ ] **Message Search**
  - [ ] Add full-text search API
  - [ ] Implement search UI
- [ ] **Message Reactions**
  - [ ] Add reaction API
  - [ ] Implement reaction UI (emoji picker)
- [ ] **File Attachments**
  - [ ] Integrate with OSS subserver
  - [ ] Upload files and attach CID to messages
  - [ ] Display image/video previews
- [ ] **Voice Messages**
  - [ ] Record audio
  - [ ] Upload to OSS
  - [ ] Play audio in chat

---

## 📚 Related Documents

- [ice-capability-design.md](./ice-capability-design.md) - ICE infrastructure
- OSS SubServer - Reference implementation for layered architecture
