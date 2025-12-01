import 'dart:async';
import 'package:get/get.dart';
import 'package:peers_touch_base/chat/chat.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pbenum.dart';

import '../controllers/mobile_chat_controller.dart';

/// 移动端聊天模块绑定
/// 负责依赖注入和控制器初始化
class MobileChatBinding implements Bindings {
  @override
  void dependencies() {
    // 注册核心服务 (使用 Dummy 实现以通过编译)
    Get.lazyPut<ChatCoreService>(() => DummyChatCoreService());
    
    // 注册移动端控制器
    Get.lazyPut<MobileChatController>(() => MobileChatController(
      Get.find<ChatCoreService>(),
    ));
  }
}

/// Dummy ChatCoreService implementation to satisfy compilation
class DummyChatCoreService implements ChatCoreService {
  @override
  Future<void> acceptFriendRequest(String requestId) async {}

  @override
  Future<void> addFriend(String peerId, {String? message}) async {}

  @override
  Future<void> blockFriend(String friendId) async {}

  @override
  Future<ChatSession> createSession(String friendId) async {
    return ChatSession(id: 'dummy_session', participantIds: [friendId, 'me']);
  }

  @override
  Future<void> deleteMessage(String messageId) async {}

  @override
  Future<void> deleteSession(String sessionId) async {}

  @override
  Future<void> dispose() async {}

  @override
  Stream<FriendRequest> friendRequestStream() {
    return const Stream.empty();
  }

  @override
  Stream<Friend> friendStatusStream() {
    return const Stream.empty();
  }

  @override
  Future<Friend?> getFriend(String friendId) async {
    return null;
  }

  @override
  Future<List<FriendRequest>> getFriendRequests() async {
    return [];
  }

  @override
  Future<List<Friend>> getFriends() async {
    return [];
  }

  @override
  Future<ChatMessage?> getMessage(String messageId) async {
    return null;
  }

  @override
  Future<List<ChatMessage>> getMessages(String sessionId, {int? limit, int? offset}) async {
    return [];
  }

  @override
  Future<ChatSession?> getSession(String sessionId) async {
    return null;
  }

  @override
  Future<List<ChatSession>> getSessions() async {
    return [];
  }

  @override
  Future<void> initialize() async {}

  @override
  Future<void> markSessionAsRead(String sessionId) async {}

  @override
  Stream<ChatMessage> messageStream(String sessionId) {
    return const Stream.empty();
  }

  @override
  Future<void> pinSession(String sessionId, bool pinned) async {}

  @override
  Future<void> rejectFriendRequest(String requestId) async {}

  @override
  Future<void> removeFriend(String friendId) async {}

  @override
  Future<void> sendFriendRequest(String peerId, {String? message}) async {}

  @override
  Future<ChatMessage> sendMessage(String sessionId, String content, {MessageType? type}) async {
    return ChatMessage(
      id: 'dummy_msg',
      sessionId: sessionId,
      content: content,
      sentAt: null, // Timestamp?
    );
  }

  @override
  Future<void> unblockFriend(String friendId) async {}

  @override
  Future<void> updateMessageStatus(String messageId, MessageStatus status) async {}
}
