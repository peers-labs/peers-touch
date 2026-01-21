# Friend Chat Architecture Design

> **Status**: Draft  
> **Version**: 3.0 (ICE Integrated)  
> **Date**: 2026-01-21  
> **Author**: Architecture Team  
> **Dependencies**: `ice-capability-design.md` (✅ Implemented)

---

## 📋 Executive Summary

This document defines the **Friend Chat** capability as a **decentralized, privacy-first messaging system** built on top of the Peers-Touch ICE infrastructure. It represents the first major application of the Peers-Touch network's P2P communication capabilities.

### Key Principles

1. **Privacy-First**: End-to-end encryption, no server-side message reading
2. **Decentralized**: P2P direct connection when possible, Station relay as fallback
3. **Resilient**: Offline message queue, multi-device sync, automatic reconnection
4. **Integrated**: Seamlessly integrated with Discovery (Radar View) for friend management
5. **Simple**: Direct HTTP/WebSocket communication between Stations

### ICE Integration Status

| Component | Status | Location |
|-----------|--------|----------|
| ICE API | ✅ Implemented | `GET /api/v1/turn/ice-servers` |
| TURN SubServer | ✅ Implemented | `station/frame/core/plugin/native/subserver/turn/` |
| IceService (Client) | ✅ Implemented | `peers_touch_base/lib/network/ice/` |
| RTCClient Integration | ✅ Implemented | `peers_touch_base/lib/network/rtc/rtc_client.dart` |

---

## 🎯 Vision: Decentralized Messaging Network

### Design Philosophy

```
┌─────────────────────────────────────────────────────────────┐
│         Peers-Touch Friend Chat Network                     │
│                                                             │
│   Traditional IM:                                           │
│   Client → Central Server → Client                          │
│   ❌ Server reads all messages                              │
│   ❌ Single point of failure                                │
│   ❌ Vendor lock-in                                         │
│                                                             │
│   Peers-Touch:                                              │
│   Client ←─ P2P Direct ─→ Client (80% of connections)      │
│   Client ←─ Station Relay ─→ Client (20% of connections)   │
│   ✅ End-to-end encryption                                  │
│   ✅ Self-sovereign infrastructure                          │
│   ✅ Network effect (more Stations = better service)        │
└─────────────────────────────────────────────────────────────┘
```

---

## 🏗️ System Architecture

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Presentation Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Friend List  │  │  Chat Window │  │ Message Input│     │
│  │  (Middle)    │  │   (Right)    │  │   (Bottom)   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                         ↓ uses
┌─────────────────────────────────────────────────────────────┐
│                  Application Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Chat         │  │  Message     │  │  Session     │     │
│  │ Controller   │  │  Manager     │  │  Manager     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                         ↓ uses
┌─────────────────────────────────────────────────────────────┐
│               Communication Layer                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Connection   │  │  Message     │  │   Offline    │     │
│  │ Manager      │  │  Transport   │  │   Queue      │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                         ↓ uses
┌─────────────────────────────────────────────────────────────┐
│            ICE Capability Layer (✅ IMPLEMENTED)            │
│  (See ice-capability-design.md for details)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ IceService   │  │ RTCClient    │  │ TURN Server  │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                         ↓ runs on
┌─────────────────────────────────────────────────────────────┐
│              Station Infrastructure                         │
│  (HTTP/WebSocket API, Database, Object Storage)             │
└─────────────────────────────────────────────────────────────┘
```

---

## 📐 Core Components

### 1. Connection Manager (Client-Side)

**Responsibility**: Manage P2P and Station relay connections

```dart
// client/common/peers_touch_base/lib/network/chat/connection_manager.dart

class ConnectionManager {
  final IceService _iceService;
  final Map<String, ChatConnection> _activeConnections = {};
  final ConnectionStrategy _strategy;
  
  ConnectionManager({required IceService iceService})
      : _iceService = iceService,
        _strategy = ConnectionStrategy(iceService);
  
  Future<ChatConnection> connect(String friendDID) async {
    if (_activeConnections.containsKey(friendDID)) {
      return _activeConnections[friendDID]!;
    }
    
    final iceServers = await _iceService.getICEServers();
    
    final connection = await _strategy.establishConnection(
      remoteDID: friendDID,
      iceServers: iceServers,
    );
    
    _activeConnections[friendDID] = connection;
    return connection;
  }
  
  void monitorConnections() {
    for (final entry in _activeConnections.entries) {
      final quality = entry.value.getQuality();
      
      if (quality.shouldUpgrade) {
        _upgradeConnection(entry.key, entry.value);
      } else if (quality.shouldDowngrade) {
        _downgradeConnection(entry.key, entry.value);
      }
    }
  }
}
```

**Connection Strategy**:
```dart
enum ConnectionType {
  localDirect,    // mDNS local network
  p2pDirect,      // P2P via STUN (using IceService)
  stationRelay,   // Station WebSocket/HTTP relay
}

class ConnectionStrategy {
  final IceService _iceService;
  
  ConnectionStrategy(this._iceService);
  
  Future<ChatConnection> establishConnection({
    required String remoteDID,
    required List<IceServer> iceServers,
  }) async {
    // 1. Try local direct (if same network)
    try {
      return await _tryLocalDirect(remoteDID);
    } catch (e) {
      LoggingService.debug('Local direct failed: $e');
    }
    
    // 2. Try P2P direct (via STUN/TURN from IceService)
    try {
      return await _tryP2PDirect(remoteDID, iceServers);
    } catch (e) {
      LoggingService.debug('P2P direct failed: $e');
    }
    
    // 3. Fallback to Station relay
    return await _useStationRelay(remoteDID);
  }
  
  Future<ChatConnection> _tryP2PDirect(
    String remoteDID,
    List<IceServer> iceServers,
  ) async {
    final rtcClient = RTCClient(
      signaling,
      role: 'caller',
      peerId: currentUserDID,
      iceService: _iceService,
    );
    
    await rtcClient.call(remoteDID);
    return P2PChatConnection(rtcClient);
  }
}
```

---

### 2. Message Transport Layer

**Responsibility**: Handle message encoding, encryption, and transmission

```dart
// client/common/peers_touch_base/lib/network/chat/message_transport.dart

class MessageTransport {
  final EncryptionService _encryption;
  final ConnectionManager _connectionManager;
  
  Future<SendResult> sendMessage({
    required String receiverDID,
    required FriendChatMessage message,
  }) async {
    final connection = await _connectionManager.connect(receiverDID);
    
    final encrypted = await _encryption.encrypt(
      data: message.writeToBuffer(),
      recipientDID: receiverDID,
    );
    
    final envelope = MessageEnvelope(
      messageUlid: message.ulid,
      senderDid: currentUserDID,
      receiverDid: receiverDID,
      sessionUlid: message.sessionUlid,
      encryptedPayload: encrypted,
      timestamp: DateTime.now().millisecondsSinceEpoch,
    );
    
    final result = await connection.send(envelope);
    await _updateMessageStatus(message.ulid, result.status);
    
    return result;
  }
  
  Future<FriendChatMessage> receiveMessage(MessageEnvelope envelope) async {
    final decrypted = await _encryption.decrypt(
      data: envelope.encryptedPayload,
      senderDID: envelope.senderDid,
    );
    
    final message = FriendChatMessage.fromBuffer(decrypted);
    await _storeMessage(message);
    await _sendAcknowledgment(envelope.messageUlid, envelope.senderDid);
    
    return message;
  }
}
```

---

### 3. Station Message Relay Service

**Responsibility**: Relay messages when P2P connection fails

```go
// station/frame/touch/message/relay/relay_service.go

type MessageRelayService struct {
    db              *gorm.DB
    wsManager       *WebSocketManager
    offlineQueue    *OfflineMessageQueue
    metrics         *RelayMetrics
}

func (mrs *MessageRelayService) RelayMessage(ctx context.Context, envelope *MessageEnvelope) (*RelayResult, error) {
    if err := mrs.validateSender(ctx, envelope.SenderDid); err != nil {
        return nil, err
    }
    
    isLocal, err := mrs.isLocalUser(ctx, envelope.ReceiverDid)
    if err != nil {
        return nil, err
    }
    
    if isLocal {
        return mrs.relayToLocalUser(ctx, envelope)
    }
    return mrs.relayToRemoteStation(ctx, envelope)
}

func (mrs *MessageRelayService) relayToLocalUser(ctx context.Context, envelope *MessageEnvelope) (*RelayResult, error) {
    if mrs.wsManager.IsOnline(envelope.ReceiverDid) {
        if err := mrs.wsManager.SendToUser(envelope.ReceiverDid, "message.new", envelope); err != nil {
            return nil, err
        }
        
        return &RelayResult{
            Status:      "delivered",
            DeliveredAt: time.Now(),
        }, nil
    }
    
    if err := mrs.offlineQueue.Enqueue(ctx, envelope); err != nil {
        return nil, err
    }
    
    return &RelayResult{Status: "queued"}, nil
}

func (mrs *MessageRelayService) relayToRemoteStation(ctx context.Context, envelope *MessageEnvelope) (*RelayResult, error) {
    recipientStation, err := mrs.resolveStationFromDID(ctx, envelope.ReceiverDid)
    if err != nil {
        return nil, err
    }
    
    url := fmt.Sprintf("%s/api/v1/message/receive", recipientStation.BaseURL)
    
    payload, err := proto.Marshal(envelope)
    if err != nil {
        return nil, err
    }
    
    req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
    if err != nil {
        return nil, err
    }
    
    req.Header.Set("Content-Type", "application/x-protobuf")
    req.Header.Set("X-Sender-Station", mrs.localStationURL)
    
    resp, err := mrs.httpClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("remote station returned %d", resp.StatusCode)
    }
    
    return &RelayResult{
        Status:      "forwarded",
        ForwardedTo: recipientStation.BaseURL,
    }, nil
}
```

---

### 4. Offline Message Queue

**Responsibility**: Store and deliver offline messages

```go
// station/frame/touch/message/offline/queue.go

type OfflineMessageQueue struct {
    db  *gorm.DB
    ttl time.Duration  // 7 days
}

func (omq *OfflineMessageQueue) Enqueue(ctx context.Context, envelope *MessageEnvelope) error {
    offlineMsg := &model.OfflineMessage{
        ULID:             envelope.MessageUlid,
        ReceiverDID:      envelope.ReceiverDid,
        SenderDID:        envelope.SenderDid,
        SessionULID:      envelope.SessionUlid,
        EncryptedPayload: envelope.EncryptedPayload,
        Status:           "pending",
        ExpireAt:         time.Now().Add(omq.ttl),
        CreatedAt:        time.Now(),
    }
    
    return omq.db.Create(offlineMsg).Error
}

func (omq *OfflineMessageQueue) DeliverToUser(ctx context.Context, userDID string, wsConn *WebSocketConnection) error {
    var messages []*model.OfflineMessage
    if err := omq.db.Where("receiver_did = ? AND status = ?", userDID, "pending").
        Order("created_at ASC").
        Find(&messages).Error; err != nil {
        return err
    }
    
    logger.Info(ctx, "delivering offline messages", "user", userDID, "count", len(messages))
    
    var deliveredULIDs []string
    for _, msg := range messages {
        envelope := &MessageEnvelope{
            MessageUlid:      msg.ULID,
            SenderDid:        msg.SenderDID,
            ReceiverDid:      msg.ReceiverDID,
            SessionULID:      msg.SessionULID,
            EncryptedPayload: msg.EncryptedPayload,
        }
        
        if err := wsConn.Send("message.offline", envelope); err != nil {
            logger.Warn(ctx, "failed to deliver offline message", "ulid", msg.ULID, "error", err)
            continue
        }
        
        deliveredULIDs = append(deliveredULIDs, msg.ULID)
    }
    
    if len(deliveredULIDs) > 0 {
        if err := omq.db.Model(&model.OfflineMessage{}).
            Where("ulid IN ?", deliveredULIDs).
            Updates(map[string]interface{}{
                "status":       "delivered",
                "delivered_at": time.Now(),
            }).Error; err != nil {
            return err
        }
    }
    
    return nil
}

func (omq *OfflineMessageQueue) CleanExpired(ctx context.Context) error {
    result := omq.db.Where("expire_at < ?", time.Now()).
        Delete(&model.OfflineMessage{})
    
    if result.Error != nil {
        return result.Error
    }
    
    logger.Info(ctx, "cleaned expired offline messages", "count", result.RowsAffected)
    return nil
}
```

---

## 🔄 Complete Message Flow

### Scenario 1: P2P Direct Connection (Using ICE)

```
Alice (Client)                    Station A                    Station B                    Bob (Client)
     │                                │                            │                            │
     │──(1) GET /api/v1/turn/ice-servers──>│                       │                            │
     │<─(2) Return ICE config─────────│                            │                            │
     │    {stun, turn, credentials}   │                            │                            │
     │                                │                            │                            │
     │──(3) Gather candidates────────>│                            │                            │
     │    (host, srflx, relay)        │                            │                            │
     │                                │                            │                            │
     │──(4) Send offer (via WebSocket/HTTP)──────────────────────>│                            │
     │                                │                            │──(5) Notify Bob──────────>│
     │                                │                            │                            │
     │                                │                            │<─(6) Bob gathers candidates│
     │                                │                            │                            │
     │<─(7) Receive answer (via WebSocket/HTTP)───────────────────│                            │
     │                                │                            │                            │
     │──(8) ICE connectivity check───────────────────────────────────────────────────────────>│
     │    Try: host→host, srflx→srflx                             │                            │
     │<─(9) P2P connection established (srflx→srflx)─────────────────────────────────────────>│
     │                                │                            │                            │
     │══(10) Send encrypted message directly══════════════════════════════════════════════════>│
     │                                │                            │                            │
     │<─(11) ACK received═══════════════════════════════════════════════════════════════════════│
     │                                │                            │                            │

Result: Direct P2P connection, ~50ms latency, no Station relay needed
```

### Scenario 2: Station Relay (P2P Failed)

```
Alice (Client)                    Station A                    Station B                    Bob (Client)
     │                                │                            │                            │
     │──(1) Try P2P connection───────>│                            │                            │
     │<─(2) P2P failed (Symmetric NAT)│                            │                            │
     │                                │                            │                            │
     │──(3) Fallback to Station relay─│                            │                            │
     │    POST /api/v1/message/send   │                            │                            │
     │                                │                            │                            │
     │                                │──(4) Resolve Bob's Station─│                            │
     │                                │                            │                            │
     │                                │──(5) Forward to Station B──────────────────────────────>│
     │                                │    POST /api/v1/message/receive                         │
     │                                │                            │                            │
     │                                │                            │──(6) Check Bob online─────>│
     │                                │                            │    WebSocket connected     │
     │                                │                            │                            │
     │                                │                            │──(7) Push via WebSocket───>│
     │                                │                            │                            │
     │                                │                            │<─(8) ACK received──────────│
     │                                │                            │                            │
     │                                │<─(9) Confirm delivered─────│                            │
     │                                │                            │                            │
     │<─(10) Return success───────────│                            │                            │
     │                                │                            │                            │

Result: Station relay, ~100ms latency, federated delivery
```

### Scenario 3: Offline Message Queue

```
Alice (Client)                    Station A                    Station B                    Bob (Offline)
     │                                │                            │                            │
     │──(1) Send message─────────────>│                            │                            │
     │    POST /api/v1/message/send   │                            │                            │
     │                                │                            │                            │
     │                                │──(2) Forward to Station B──────────────────────────────>│
     │                                │                            │                            │
     │                                │                            │──(3) Check Bob online─────>│
     │                                │                            │    WebSocket: NOT CONNECTED│
     │                                │                            │                            │
     │                                │                            │──(4) Enqueue offline msg──>│
     │                                │                            │    expire_at: +7 days      │
     │                                │                            │                            │
     │                                │<─(5) Confirm queued────────│                            │
     │                                │                            │                            │
     │<─(6) Return queued status──────│                            │                            │
     │                                │                            │                            │
     │                                │                            │    (Bob comes online)      │
     │                                │                            │<─(7) WebSocket connect─────│
     │                                │                            │                            │
     │                                │                            │──(8) Deliver offline msgs─>│
     │                                │                            │                            │
     │                                │                            │<─(9) ACK received──────────│
     │                                │                            │                            │

Result: Message queued for 7 days, delivered when Bob comes online
```

---

## 🎨 UI/UX Design

### Desktop Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Peers-Touch Desktop                                    [_][□][×]│
├─────────────────────────────────────────────────────────────┤
│  [☰] Discovery  AI Chat  Friend Chat  Settings             │
├─────────┬───────────────────────┬───────────────────────────┤
│         │                       │                           │
│  Left   │      Middle           │         Right             │
│  Panel  │      Panel            │         Panel             │
│         │                       │                           │
│ (Nav)   │  (Friend List)        │    (Chat Window)          │
│         │                       │                           │
│  [🔍]   │  ┌─────────────────┐  │  ┌─────────────────────┐ │
│  Radar  │  │ 🔍 Search...    │  │  │  Alice              │ │
│         │  └─────────────────┘  │  │  Online • P2P Direct│ │
│  [💬]   │                       │  └─────────────────────┘ │
│  Chat   │  Friends (12)         │                           │
│         │  ┌─────────────────┐  │  ┌─────────────────────┐ │
│  [⚙️]   │  │ 👤 Alice        │◀─│  │ Alice: Hey!         │ │
│  Settings│  │ 💬 Hey! How...  │  │  │ 10:30 AM         ✓✓│ │
│         │  │ 2 min ago    [2]│  │  ├─────────────────────┤ │
│         │  └─────────────────┘  │  │ You: Good!          │ │
│         │  ┌─────────────────┐  │  │ 10:31 AM         ✓✓│ │
│         │  │ 👤 Bob          │  │  └─────────────────────┘ │
│         │  │ 💬 See you!     │  │                           │
│         │  │ 1 hour ago      │  │  ┌─────────────────────┐ │
│         │  └─────────────────┘  │  │ Type a message...   │ │
│         │  ┌─────────────────┐  │  │ [📎] [😊] [🎤] [Send]│ │
│         │  │ 👤 Carol        │  │  └─────────────────────┘ │
│         │  │ Offline         │  │                           │
│         │  │ Yesterday       │  │  Connection: P2P Direct  │
│         │  └─────────────────┘  │  Latency: 45ms           │
│         │                       │                           │
└─────────┴───────────────────────┴───────────────────────────┘
```

### Key UI Components

#### 1. Friend List (Middle Panel)

```dart
// client/desktop/lib/features/friend_chat/view/widgets/friend_list.dart

class FriendList extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return GetBuilder<FriendChatController>(
      builder: (controller) => Column(
        children: [
          Padding(
            padding: EdgeInsets.all(16),
            child: SearchBar(
              hintText: 'Search friends or messages...',
              onChanged: controller.onSearchChanged,
            ),
          ),
          
          Expanded(
            child: Obx(() {
              if (controller.isSearching.value) {
                return SearchResults(results: controller.searchResults);
              }
              
              return ListView.builder(
                itemCount: controller.friends.length,
                itemBuilder: (context, index) {
                  final friend = controller.friends[index];
                  return FriendListItem(
                    friend: friend,
                    onTap: () => controller.selectFriend(friend.did),
                  );
                },
              );
            }),
          ),
        ],
      ),
    );
  }
}
```

#### 2. Chat Window (Right Panel)

```dart
// client/desktop/lib/features/friend_chat/view/widgets/chat_window.dart

class ChatWindow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return GetBuilder<FriendChatController>(
      builder: (controller) => Column(
        children: [
          ChatHeader(
            friend: controller.selectedFriend,
            connectionStatus: controller.connectionStatus,
          ),
          
          Expanded(
            child: Obx(() => ListView.builder(
              reverse: true,
              itemCount: controller.messages.length,
              itemBuilder: (context, index) {
                final message = controller.messages[index];
                return MessageBubble(
                  message: message,
                  isMine: message.senderDid == currentUserDID,
                );
              },
            )),
          ),
          
          ChatInput(
            onSend: controller.sendMessage,
            onAttachment: controller.attachFile,
          ),
          
          ConnectionStatusBar(
            type: controller.connectionType,
            latency: controller.latency,
          ),
        ],
      ),
    );
  }
}
```

#### 3. Message Status Indicators

```dart
enum MessageStatus {
  sending,    // ⏳ (clock)
  sent,       // ✓  (single check)
  delivered,  // ✓✓ (double check)
  read,       // ✓✓ (blue double check)
  failed,     // ❌ (red X)
}

class MessageStatusIcon extends StatelessWidget {
  final MessageStatus status;
  
  const MessageStatusIcon({required this.status});
  
  @override
  Widget build(BuildContext context) {
    switch (status) {
      case MessageStatus.sending:
        return Icon(Icons.access_time, size: 14, color: Colors.grey);
      case MessageStatus.sent:
        return Icon(Icons.check, size: 14, color: Colors.grey);
      case MessageStatus.delivered:
        return Icon(Icons.done_all, size: 14, color: Colors.grey);
      case MessageStatus.read:
        return Icon(Icons.done_all, size: 14, color: Colors.blue);
      case MessageStatus.failed:
        return Icon(Icons.error_outline, size: 14, color: Colors.red);
    }
  }
}
```

---

## 🔐 Security & Privacy

### 1. End-to-End Encryption

**Protocol**: Signal Protocol (Double Ratchet Algorithm)

```dart
// client/common/peers_touch_base/lib/security/e2ee/signal_protocol.dart

class SignalProtocolService {
  final IdentityKeyStore _identityStore;
  final PreKeyStore _preKeyStore;
  final SignedPreKeyStore _signedPreKeyStore;
  final SessionStore _sessionStore;
  
  Future<void> initializeSession(String friendDID) async {
    final preKeyBundle = await _fetchPreKeyBundle(friendDID);
    
    final sessionBuilder = SessionBuilder(
      sessionStore: _sessionStore,
      preKeyStore: _preKeyStore,
      signedPreKeyStore: _signedPreKeyStore,
      identityKeyStore: _identityStore,
      remoteAddress: SignalProtocolAddress(friendDID, 1),
    );
    
    await sessionBuilder.processPreKeyBundle(preKeyBundle);
  }
  
  Future<Uint8List> encryptMessage(String friendDID, Uint8List plaintext) async {
    final cipher = SessionCipher(
      sessionStore: _sessionStore,
      preKeyStore: _preKeyStore,
      signedPreKeyStore: _signedPreKeyStore,
      identityKeyStore: _identityStore,
      remoteAddress: SignalProtocolAddress(friendDID, 1),
    );
    
    final ciphertext = await cipher.encrypt(plaintext);
    return ciphertext.serialize();
  }
  
  Future<Uint8List> decryptMessage(String friendDID, Uint8List ciphertext) async {
    final cipher = SessionCipher(
      sessionStore: _sessionStore,
      preKeyStore: _preKeyStore,
      signedPreKeyStore: _signedPreKeyStore,
      identityKeyStore: _identityStore,
      remoteAddress: SignalProtocolAddress(friendDID, 1),
    );
    
    return await cipher.decrypt(PreKeySignalMessage(ciphertext));
  }
}
```

### 2. Station Cannot Read Messages

**Key Point**: Station only sees encrypted payloads

```
┌─────────────────────────────────────────────────────────────┐
│  What Station Sees:                                         │
│                                                             │
│  {                                                          │
│    "message_ulid": "01HQXYZ...",                           │
│    "sender_did": "did:peers:alice",                        │
│    "receiver_did": "did:peers:bob",                        │
│    "encrypted_payload": "AQIDBAUGBwgJCgsMDQ4PEBESExQV...", │
│    "timestamp": 1705708800                                 │
│  }                                                          │
│                                                             │
│  Station CANNOT:                                            │
│  ❌ Read message content                                    │
│  ❌ Modify message content                                  │
│  ❌ Impersonate sender                                      │
│                                                             │
│  Station CAN:                                               │
│  ✅ Route messages                                          │
│  ✅ Store offline messages                                  │
│  ✅ Provide delivery confirmation                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Data Models

### Proto Definitions

```protobuf
// model/domain/chat/friend_chat.proto

syntax = "proto3";
package peers.touch.chat;

message FriendChatSession {
  string ulid = 1;
  string participant_a_did = 2;
  string participant_b_did = 3;
  string last_message_ulid = 4;
  int64 last_message_at = 5;
  int32 unread_count_a = 6;
  int32 unread_count_b = 7;
  int64 created_at = 8;
  int64 updated_at = 9;
}

message FriendChatMessage {
  string ulid = 1;
  string session_ulid = 2;
  string sender_did = 3;
  string receiver_did = 4;
  
  MessageType type = 5;
  string content = 6;
  repeated Attachment attachments = 7;
  
  string reply_to_ulid = 8;
  
  MessageStatus status = 9;
  int64 sent_at = 10;
  int64 delivered_at = 11;
  int64 read_at = 12;
  
  int64 created_at = 13;
  int64 updated_at = 14;
}

enum MessageType {
  TEXT = 0;
  IMAGE = 1;
  FILE = 2;
  AUDIO = 3;
  VIDEO = 4;
}

enum MessageStatus {
  SENDING = 0;
  SENT = 1;
  DELIVERED = 2;
  READ = 3;
  FAILED = 4;
}

message Attachment {
  string cid = 1;
  string filename = 2;
  string mime_type = 3;
  int64 size = 4;
  string thumbnail_cid = 5;
}

message MessageEnvelope {
  string message_ulid = 1;
  string sender_did = 2;
  string receiver_did = 3;
  string session_ulid = 4;
  bytes encrypted_payload = 5;
  int64 timestamp = 6;
  string signature = 7;
}
```

### Database Schema

```sql
-- Friend chat sessions
CREATE TABLE friend_chat_session (
    ulid VARCHAR(26) PRIMARY KEY,
    participant_a_did VARCHAR(255) NOT NULL,
    participant_b_did VARCHAR(255) NOT NULL,
    last_message_ulid VARCHAR(26),
    last_message_at TIMESTAMP,
    unread_count_a INT DEFAULT 0,
    unread_count_b INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE INDEX idx_participants (
        LEAST(participant_a_did, participant_b_did),
        GREATEST(participant_a_did, participant_b_did)
    )
);

-- Offline message queue
CREATE TABLE offline_message (
    ulid VARCHAR(26) PRIMARY KEY,
    receiver_did VARCHAR(255) NOT NULL,
    sender_did VARCHAR(255) NOT NULL,
    session_ulid VARCHAR(26) NOT NULL,
    encrypted_payload BYTEA NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    expire_at TIMESTAMP NOT NULL,
    delivered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_offline_msg_receiver_status (receiver_did, status),
    INDEX idx_offline_msg_expire (expire_at)
);
```

---

## 🚀 Implementation Roadmap

### Phase 0: ICE Infrastructure ✅ COMPLETED

| Task | Status | Location |
|------|--------|----------|
| TURN SubServer with ICE API | ✅ Done | `turn/ice_handler.go` |
| IceService (Client) | ✅ Done | `network/ice/ice_service.dart` |
| IceServer Model | ✅ Done | `network/ice/ice_server.dart` |
| RTCClient Integration | ✅ Done | `network/rtc/rtc_client.dart` |
| Configuration | ✅ Done | `sub_turn.yml` |

### Phase 1: MVP - Station Relay (Week 1-2)

**Goal**: Basic friend chat working via Station relay

- [ ] Proto models (FriendChatSession, FriendChatMessage)
- [ ] Database schema
- [ ] Station relay service (HTTP + WebSocket)
- [ ] Offline message queue
- [ ] Client UI (friend list + chat window)
- [ ] Basic message send/receive
- [ ] Message status sync

**Deliverable**: Users can chat via Station relay

### Phase 2: P2P Direct + E2EE (Week 3-4)

**Goal**: Add P2P direct connection and encryption

- [ ] ConnectionManager implementation
- [ ] ConnectionStrategy (local → P2P → relay)
- [ ] Signal Protocol integration
- [ ] Key exchange mechanism
- [ ] P2P message transport

**Deliverable**: E2EE chat with P2P when possible

### Phase 3: Advanced Features (Week 5-6)

**Goal**: Polish and optimize

- [ ] Multi-device sync
- [ ] Message threading (reply_to_ulid)
- [ ] File attachments
- [ ] Voice messages
- [ ] Read receipts
- [ ] Typing indicators
- [ ] Message search

**Deliverable**: Production-ready friend chat

---

## 📈 Success Metrics

### Technical Metrics

- [ ] 95%+ message delivery success rate
- [ ] <100ms average message latency (P2P)
- [ ] <500ms average message latency (Station relay)
- [ ] 80%+ P2P direct connection rate
- [ ] 99.9% uptime

### User Experience Metrics

- [ ] <1s message send time (perceived)
- [ ] Real-time message status updates
- [ ] Offline messages delivered within 5s of coming online
- [ ] Zero message loss

### Privacy Metrics

- [ ] 100% E2EE coverage
- [ ] Zero plaintext messages on Station
- [ ] Forward secrecy guaranteed

---

## 🔗 Integration with Peers-Touch Network

### Friend Management via Discovery (Radar View)

```
User Flow:
1. User opens Discovery (Radar View)
2. Searches for friend by DID/handle
3. Views friend's profile
4. Clicks "Follow" → Establishes friend relationship (stored locally)
5. Friend appears in Friend Chat list
6. User clicks friend → Opens chat window
7. Sends first message → Connection established (P2P or relay)
```

**Friend Relationship Storage**:
- Friend relationships stored in local database
- DID resolution to find friend's Station URL
- ICE servers obtained from own Station via `/api/v1/turn/ice-servers`
- Ready to send messages

---

## 🎯 Competitive Advantages

### vs. WhatsApp/WeChat (Centralized)

| Feature | WhatsApp | Peers-Touch |
|---------|----------|-------------|
| **Infrastructure** | Facebook servers | Self-hosted Stations |
| **Privacy** | E2EE (but metadata visible) | E2EE + metadata hidden |
| **Censorship** | Possible (centralized) | Resistant (federated) |
| **Data ownership** | Facebook | User |

### vs. Matrix/XMPP (Federated)

| Feature | Matrix | Peers-Touch |
|---------|--------|-------------|
| **Protocol** | Matrix Protocol | HTTP/WebSocket + ICE |
| **P2P** | No (server-to-server) | Yes (client-to-client) |
| **Setup** | Complex | Simple (one-click Station) |

### vs. Signal (Privacy-First)

| Feature | Signal | Peers-Touch |
|---------|--------|-------------|
| **Infrastructure** | Signal servers | Self-hosted Stations |
| **Federation** | No | Yes |
| **P2P** | No | Yes |

---

## 📚 Related Documents

- [ice-capability-design.md](./ice-capability-design.md) - ICE infrastructure (✅ Implemented)
- [10-GLOBAL/11-architecture.md](../../10-GLOBAL/11-architecture.md) - Overall architecture
- [10-GLOBAL/12-domain-model.md](../../10-GLOBAL/12-domain-model.md) - Proto models
- [20-CLIENT/21-DESKTOP/21.0-base.md](../../20-CLIENT/21-DESKTOP/21.0-base.md) - Desktop client architecture
- [30-STATION/30-station-base.md](../../30-STATION/30-station-base.md) - Station architecture

---

## 🎓 Key Takeaways

1. **Friend Chat is the first killer app** of the Peers-Touch network
2. **Built on ICE capability** (✅ Implemented) - demonstrates the power of self-hosted infrastructure
3. **Privacy-first by design** - E2EE, P2P direct, no server-side reading
4. **Simple Station relay** - HTTP/WebSocket communication between Stations
5. **Progressive enhancement** - works via relay, optimizes to P2P
6. **Integrated with Discovery** - seamless friend management
7. **DID-based routing** - resolve friend's Station from their DID

---

**Next Steps**: 
1. ✅ ICE capability implemented
2. → Implement Phase 1: Station Relay (Proto models, DB schema, relay service, UI)
