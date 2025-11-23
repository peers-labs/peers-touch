/// 聊天模块核心服务接口
/// 提供好友管理、会话管理、消息处理等核心功能
abstract class ChatCoreService {
  /// 好友管理
  Future<List<Friend>> getFriends();
  Future<Friend?> getFriend(String friendId);
  Future<void> addFriend(String peerId, {String? message});
  Future<void> removeFriend(String friendId);
  Future<void> blockFriend(String friendId);
  Future<void> unblockFriend(String friendId);
  
  /// 好友请求管理
  Future<List<FriendRequest>> getFriendRequests();
  Future<void> sendFriendRequest(String peerId, {String? message});
  Future<void> acceptFriendRequest(String requestId);
  Future<void> rejectFriendRequest(String requestId);
  
  /// 会话管理
  Future<List<ChatSession>> getSessions();
  Future<ChatSession?> getSession(String sessionId);
  Future<ChatSession> createSession(String friendId);
  Future<void> deleteSession(String sessionId);
  Future<void> markSessionAsRead(String sessionId);
  Future<void> pinSession(String sessionId, bool pinned);
  
  /// 消息管理
  Future<List<ChatMessage>> getMessages(String sessionId, {int? limit, int? offset});
  Future<ChatMessage?> getMessage(String messageId);
  Future<ChatMessage> sendMessage(String sessionId, String content, {MessageType? type});
  Future<void> deleteMessage(String messageId);
  Future<void> updateMessageStatus(String messageId, MessageStatus status);
  
  /// 实时消息监听
  Stream<ChatMessage> messageStream(String sessionId);
  Stream<FriendRequest> friendRequestStream();
  Stream<Friend> friendStatusStream();
  
  /// 初始化与清理
  Future<void> initialize();
  Future<void> dispose();
}
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
