import 'dart:async';

import 'package:peers_touch_base/chat/services/chat_core_service.dart';
import 'package:peers_touch_base/chat/services/encryption_service.dart';
import 'package:peers_touch_base/chat/services/p2p_chat_protocol.dart';
import 'package:peers_touch_base/chat/services/storage_service.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_base/network/libp2p/core/host/host.dart';
import 'package:peers_touch_base/network/libp2p/core/peer/peer_id.dart';
import 'package:peers_touch_base/network/libp2p/p2p/protocol/stomp/stomp_service.dart';

/// 聊天核心服务实现
/// 处理好友管理、会话管理、消息同步等核心业务逻辑
class ChatCoreServiceImpl implements ChatCoreService {

  ChatCoreServiceImpl({
    required Host host,
    required StompService stompService,
    required EncryptionService encryptionService,
    required ChatStorageService storageService,
    required P2PChatProtocol p2pProtocol,
  }) : _host = host,
       _stompService = stompService,
       _encryptionService = encryptionService,
       _storageService = storageService,
       _p2pProtocol = p2pProtocol;
  final Host _host;
  final StompService _stompService;
  final EncryptionService _encryptionService;
  final ChatStorageService _storageService;
  final P2PChatProtocol _p2pProtocol;

  bool _isInitialized = false;
  final _messageControllers = <String, StreamController<ChatMessage>>{};
  final _friendRequestController = StreamController<FriendRequest>.broadcast();
  final _friendStatusController = StreamController<Friend>.broadcast();

  @override
  Future<void> initialize() async {
    if (_isInitialized) return;

    // 注册P2P协议处理器
    _p2pProtocol.registerMessageHandler(_handleP2PMessage);

    // 启动消息同步
    await _startMessageSync();

    _isInitialized = true;
  }

  @override
  Future<void> dispose() async {
    // 清理资源
    for (final controller in _messageControllers.values) {
      await controller.close();
    }
    _messageControllers.clear();

    await _friendRequestController.close();
    await _friendStatusController.close();

    _isInitialized = false;
  }

  // ==================== 好友管理 ====================

  @override
  Future<List<Friend>> getFriends() async {
    return await _storageService.getFriends();
  }

  @override
  Future<Friend?> getFriend(String friendId) async {
    return await _storageService.getFriend(friendId);
  }

  @override
  Future<void> addFriend(String peerId, {String? message}) async {
    // 创建好友请求
    final friendRequest = FriendRequest(
      id: _generateId(),
      senderId: _host.id.toString(),
      receiverId: peerId,
      message: message ?? '',
      status: FriendRequestStatus.pending,
      createdAt: DateTime.now(),
      respondedAt: null,
    );

    // 保存到本地存储
    await _storageService.saveFriendRequest(friendRequest);

    // 通过P2P网络发送好友请求
    await _sendFriendRequestOverP2P(peerId, friendRequest);
  }

  @override
  Future<void> removeFriend(String friendId) async {
    final friend = await _storageService.getFriend(friendId);
    if (friend != null) {
      // 更新好友状态为已删除
      final updatedFriend = friend.copyWith(status: FriendshipStatus.removed);
      await _storageService.saveFriend(updatedFriend);

      // 通知好友关系变更
      _friendStatusController.add(updatedFriend);
    }
  }

  @override
  Future<void> blockFriend(String friendId) async {
    final friend = await _storageService.getFriend(friendId);
    if (friend != null) {
      final updatedFriend = friend.copyWith(status: FriendshipStatus.blocked);
      await _storageService.saveFriend(updatedFriend);
      _friendStatusController.add(updatedFriend);
    }
  }

  @override
  Future<void> unblockFriend(String friendId) async {
    final friend = await _storageService.getFriend(friendId);
    if (friend != null && friend.status == FriendshipStatus.blocked) {
      final updatedFriend = friend.copyWith(status: FriendshipStatus.accepted);
      await _storageService.saveFriend(updatedFriend);
      _friendStatusController.add(updatedFriend);
    }
  }

  // ==================== 好友请求管理 ====================

  @override
  Future<List<FriendRequest>> getFriendRequests() async {
    return await _storageService.getFriendRequests();
  }

  @override
  Future<void> sendFriendRequest(String peerId, {String? message}) async {
    return await addFriend(peerId, message: message);
  }

  @override
  Future<void> acceptFriendRequest(String requestId) async {
    final request = await _storageService.getFriendRequest(requestId);
    if (request != null && request.status == FriendRequestStatus.pending) {
      // 更新请求状态
      final updatedRequest = request.copyWith(
        status: FriendRequestStatus.accepted,
        respondedAt: DateTime.now(),
      );
      await _storageService.saveFriendRequest(updatedRequest);

      // 创建好友关系
      final friend = Friend(
        user: Actor(
          id: request.senderId,
          name: '', // 将在后续同步中获取
          displayName: '',
          avatarUrl: '',
          createdAt: DateTime.now(),
          updatedAt: DateTime.now(),
        ),
        status: FriendshipStatus.accepted,
        friendshipCreatedAt: DateTime.now(),
        publicKey: '', // 将在密钥交换后更新
        metadata: {},
      );
      await _storageService.saveFriend(friend);

      // 发送接受响应
      await _sendFriendResponseOverP2P(request.senderId, true);

      _friendStatusController.add(friend);
    }
  }

  @override
  Future<void> rejectFriendRequest(String requestId) async {
    final request = await _storageService.getFriendRequest(requestId);
    if (request != null && request.status == FriendRequestStatus.pending) {
      final updatedRequest = request.copyWith(
        status: FriendRequestStatus.rejected,
        respondedAt: DateTime.now(),
      );
      await _storageService.saveFriendRequest(updatedRequest);

      // 发送拒绝响应
      await _sendFriendResponseOverP2P(request.senderId, false);
    }
  }

  // ==================== 会话管理 ====================

  @override
  Future<List<ChatSession>> getSessions() async {
    return await _storageService.getSessions();
  }

  @override
  Future<ChatSession?> getSession(String sessionId) async {
    return await _storageService.getSession(sessionId);
  }

  @override
  Future<ChatSession> createSession(String friendId) async {
    // 检查好友关系
    final friend = await _storageService.getFriend(friendId);
    if (friend == null || friend.status != FriendshipStatus.accepted) {
      throw Exception('Friend not found or not accepted');
    }

    // 创建会话
    final session = ChatSession(
      id: _generateId(),
      topic: '',
      participantIds: [_host.id.toString(), friendId],
      lastMessageAt: null,
      lastMessageSnippet: '',
      type: SessionType.direct,
      isPinned: false,
      unreadCount: 0,
      metadata: {},
    );

    await _storageService.saveSession(session);
    return session;
  }

  @override
  Future<void> deleteSession(String sessionId) async {
    await _storageService.deleteSession(sessionId);
  }

  @override
  Future<void> markSessionAsRead(String sessionId) async {
    final session = await _storageService.getSession(sessionId);
    if (session != null) {
      final updatedSession = session.copyWith(unreadCount: 0);
      await _storageService.saveSession(updatedSession);
    }
  }

  @override
  Future<void> pinSession(String sessionId, bool pinned) async {
    final session = await _storageService.getSession(sessionId);
    if (session != null) {
      final updatedSession = session.copyWith(isPinned: pinned);
      await _storageService.saveSession(updatedSession);
    }
  }

  // ==================== 消息管理 ====================

  @override
  Future<List<ChatMessage>> getMessages(
    String sessionId, {
    int? limit,
    int? offset,
  }) async {
    return await _storageService.getMessages(
      sessionId,
      limit: limit,
      offset: offset,
    );
  }

  @override
  Future<ChatMessage?> getMessage(String messageId) async {
    return await _storageService.getMessage(messageId);
  }

  @override
  Future<ChatMessage> sendMessage(
    String sessionId,
    String content, {
    MessageType? type,
  }) async {
    // 获取会话
    final session = await _storageService.getSession(sessionId);
    if (session == null) {
      throw Exception('Session not found');
    }

    // 获取接收者ID
    final receiverId = session.participantIds.firstWhere(
      (id) => id != _host.id.toString(),
      orElse: () => '',
    );

    if (receiverId.isEmpty) {
      throw Exception('No receiver found in session');
    }

    // 创建消息
    final message = ChatMessage(
      id: _generateId(),
      sessionId: sessionId,
      senderId: _host.id.toString(),
      content: content,
      sentAt: DateTime.now(),
      type: type ?? MessageType.text,
      status: MessageStatus.sending,
      encryptedContent: '',
      attachments: [],
      metadata: {},
    );

    // 保存到本地存储
    await _storageService.saveMessage(message);

    // 加密消息内容
    final encryptedContent = await _encryptionService.encryptMessage(
      content,
      receiverId,
    );

    // 更新消息为加密状态
    final encryptedMessage = message.copyWith(
      encryptedContent: encryptedContent,
    );
    await _storageService.saveMessage(encryptedMessage);

    // 通过P2P发送消息
    await _sendMessageOverP2P(receiverId, encryptedMessage);

    // 更新会话的最后消息
    await _updateSessionLastMessage(session, encryptedMessage);

    return encryptedMessage;
  }

  @override
  Future<void> deleteMessage(String messageId) async {
    await _storageService.deleteMessage(messageId);
  }

  @override
  Future<void> updateMessageStatus(
    String messageId,
    MessageStatus status,
  ) async {
    final message = await _storageService.getMessage(messageId);
    if (message != null) {
      final updatedMessage = message.copyWith(status: status);
      await _storageService.saveMessage(updatedMessage);
    }
  }

  // ==================== 实时消息流 ====================

  @override
  Stream<ChatMessage> messageStream(String sessionId) {
    final controller = _messageControllers.putIfAbsent(
      sessionId,
      () => StreamController<ChatMessage>.broadcast(),
    );
    return controller.stream;
  }

  @override
  Stream<FriendRequest> friendRequestStream() {
    return _friendRequestController.stream;
  }

  @override
  Stream<Friend> friendStatusStream() {
    return _friendStatusController.stream;
  }

  // ==================== 私有方法 ====================

  Future<void> _handleP2PMessage(
    PeerId sender,
    Map<String, dynamic> data,
  ) async {
    final messageType = data['type'] as String?;

    switch (messageType) {
      case 'chat_message':
        await _handleIncomingChatMessage(sender, data);
        break;
      case 'friend_request':
        await _handleIncomingFriendRequest(sender, data);
        break;
      case 'friend_response':
        await _handleIncomingFriendResponse(sender, data);
        break;
      case 'message_status':
        await _handleMessageStatusUpdate(sender, data);
        break;
    }
  }

  Future<void> _handleIncomingChatMessage(
    PeerId sender,
    Map<String, dynamic> data,
  ) async {
    try {
      // 解密消息内容
      final encryptedContent = data['encryptedContent'] as String;
      final decryptedContent = await _encryptionService.decryptMessage(
        encryptedContent,
        sender.toString(),
      );

      // 创建消息对象
      final message = ChatMessage(
        id: data['messageId'] as String,
        sessionId: data['sessionId'] as String,
        senderId: sender.toString(),
        content: decryptedContent,
        sentAt: DateTime.parse(data['timestamp'] as String),
        type: MessageType.values.firstWhere(
          (type) => type.name == data['messageType'],
          orElse: () => MessageType.text,
        ),
        status: MessageStatus.delivered,
        encryptedContent: encryptedContent,
        attachments: [], // 将在后续处理
        metadata: Map<String, String>.from(data['metadata'] ?? {}),
      );

      // 保存消息
      await _storageService.saveMessage(message);

      // 更新会话
      final session = await _storageService.getSession(message.sessionId);
      if (session != null) {
        await _updateSessionLastMessage(session, message);

        // 增加未读计数
        final updatedSession = session.copyWith(
          unreadCount: session.unreadCount + 1,
        );
        await _storageService.saveSession(updatedSession);
      }

      // 通知消息接收
      final controller = _messageControllers[message.sessionId];
      if (controller != null) {
        controller.add(message);
      }

      // 发送消息已送达确认
      await _sendMessageDeliveryConfirmation(sender, message.id);
    } catch (e) {
      // 记录错误但不影响其他消息处理
      print('Error handling incoming chat message: $e');
    }
  }

  Future<void> _handleIncomingFriendRequest(
    PeerId sender,
    Map<String, dynamic> data,
  ) async {
    final friendRequest = FriendRequest(
      id: data['requestId'] as String,
      senderId: sender.toString(),
      receiverId: _host.id.toString(),
      message: data['message'] as String? ?? '',
      status: FriendRequestStatus.pending,
      createdAt: DateTime.parse(data['timestamp'] as String),
      respondedAt: null,
    );

    await _storageService.saveFriendRequest(friendRequest);
    _friendRequestController.add(friendRequest);
  }

  Future<void> _handleIncomingFriendResponse(
    PeerId sender,
    Map<String, dynamic> data,
  ) async {
    final requestId = data['requestId'] as String;
    final accepted = data['accepted'] as bool;

    final request = await _storageService.getFriendRequest(requestId);
    if (request != null) {
      final updatedRequest = request.copyWith(
        status: accepted
            ? FriendRequestStatus.accepted
            : FriendRequestStatus.rejected,
        respondedAt: DateTime.now(),
      );
      await _storageService.saveFriendRequest(updatedRequest);

      if (accepted) {
        // 创建好友关系
        final friend = Friend(
          user: Actor(
            id: sender.toString(),
            name: '',
            displayName: '',
            avatarUrl: '',
            createdAt: DateTime.now(),
            updatedAt: DateTime.now(),
          ),
          status: FriendshipStatus.accepted,
          friendshipCreatedAt: DateTime.now(),
          publicKey: data['publicKey'] as String? ?? '',
          metadata: {},
        );
        await _storageService.saveFriend(friend);
        _friendStatusController.add(friend);
      }
    }
  }

  Future<void> _handleMessageStatusUpdate(
    PeerId sender,
    Map<String, dynamic> data,
  ) async {
    final messageId = data['messageId'] as String;
    final status = MessageStatus.values.firstWhere(
      (s) => s.name == data['status'],
      orElse: () => MessageStatus.sent,
    );

    await updateMessageStatus(messageId, status);
  }

  // P2P消息发送方法
  Future<void> _sendMessageOverP2P(
    String receiverId,
    ChatMessage message,
  ) async {
    final data = {
      'type': 'chat_message',
      'messageId': message.id,
      'sessionId': message.sessionId,
      'encryptedContent': message.encryptedContent,
      'messageType': message.type.name,
      'timestamp': message.sentAt.toIso8601String(),
      'metadata': message.metadata,
    };

    await _p2pProtocol.sendMessage(receiverId, data);
  }

  Future<void> _sendFriendRequestOverP2P(
    String receiverId,
    FriendRequest request,
  ) async {
    final data = {
      'type': 'friend_request',
      'requestId': request.id,
      'message': request.message,
      'timestamp': request.createdAt.toIso8601String(),
    };

    await _p2pProtocol.sendMessage(receiverId, data);
  }

  Future<void> _sendFriendResponseOverP2P(
    String receiverId,
    bool accepted,
  ) async {
    final data = {
      'type': 'friend_response',
      'requestId': '', // 将在调用时传入
      'accepted': accepted,
      'publicKey': accepted ? await _encryptionService.getPublicKey() : '',
    };

    await _p2pProtocol.sendMessage(receiverId, data);
  }

  Future<void> _sendMessageDeliveryConfirmation(
    PeerId receiver,
    String messageId,
  ) async {
    final data = {
      'type': 'message_status',
      'messageId': messageId,
      'status': 'delivered',
    };

    await _p2pProtocol.sendMessage(receiver.toString(), data);
  }

  Future<void> _updateSessionLastMessage(
    ChatSession session,
    ChatMessage message,
  ) async {
    final updatedSession = session.copyWith(
      lastMessageAt: message.sentAt,
      lastMessageSnippet: message.content.length > 50
          ? '${message.content.substring(0, 50)}...'
          : message.content,
    );
    await _storageService.saveSession(updatedSession);
  }

  Future<void> _startMessageSync() async {
    // 启动消息同步机制
    // 这里可以实现消息的定期同步、重试机制等
  }

  String _generateId() {
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final random = DateTime.now().microsecond;
    return 'msg_$timestamp$random';
  }

  void _notifyMessageReceived(ChatMessage message) {
    // 通知UI或其他组件消息已接收
    final controller = _messageControllers[message.sessionId];
    if (controller != null) {
      controller.add(message);
    }
  }
}
