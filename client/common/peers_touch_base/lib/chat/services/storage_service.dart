import 'package:peers_touch_base/chat/models/models.dart';

/// 聊天存储服务接口
/// 提供好友、会话、消息等数据的持久化存储
abstract class ChatStorageService {
  /// ==================== 好友存储 ====================
  
  /// 获取所有好友
  Future<List<Friend>> getFriends();
  
  /// 获取指定好友
  Future<Friend?> getFriend(String friendId);
  
  /// 保存好友
  Future<void> saveFriend(Friend friend);
  
  /// 删除好友
  Future<void> deleteFriend(String friendId);
  
  /// 根据状态筛选好友
  Future<List<Friend>> getFriendsByStatus(FriendshipStatus status);
  
  /// ==================== 好友请求存储 ====================
  
  /// 获取所有好友请求
  Future<List<FriendRequest>> getFriendRequests();
  
  /// 获取指定好友请求
  Future<FriendRequest?> getFriendRequest(String requestId);
  
  /// 获取指定用户的好友请求
  Future<List<FriendRequest>> getFriendRequestsByUser(String userId);
  
  /// 保存好友请求
  Future<void> saveFriendRequest(FriendRequest request);
  
  /// 删除好友请求
  Future<void> deleteFriendRequest(String requestId);
  
  /// ==================== 会话存储 ====================
  
  /// 获取所有会话
  Future<List<ChatSession>> getSessions();
  
  /// 获取指定会话
  Future<ChatSession?> getSession(String sessionId);
  
  /// 获取参与者的会话
  Future<ChatSession?> getSessionByParticipants(List<String> participantIds);
  
  /// 保存会话
  Future<void> saveSession(ChatSession session);
  
  /// 删除会话
  Future<void> deleteSession(String sessionId);
  
  /// 更新会话未读数
  Future<void> updateSessionUnreadCount(String sessionId, int unreadCount);
  
  /// ==================== 消息存储 ====================
  
  /// 获取会话消息
  Future<List<ChatMessage>> getMessages(String sessionId, {int? limit, int? offset});
  
  /// 获取指定消息
  Future<ChatMessage?> getMessage(String messageId);
  
  /// 获取会话中未读消息
  Future<List<ChatMessage>> getUnreadMessages(String sessionId);
  
  /// 保存消息
  Future<void> saveMessage(ChatMessage message);
  
  /// 批量保存消息
  Future<void> saveMessages(List<ChatMessage> messages);
  
  /// 删除消息
  Future<void> deleteMessage(String messageId);
  
  /// 批量删除消息
  Future<void> deleteMessages(List<String> messageIds);
  
  /// 更新消息状态
  Future<void> updateMessageStatus(String messageId, MessageStatus status);
  
  /// 获取会话的最后消息
  Future<ChatMessage?> getLastMessage(String sessionId);
  
  /// ==================== 统计与查询 ====================
  
  /// 获取未读消息总数
  Future<int> getTotalUnreadCount();
  
  /// 获取会话消息数量
  Future<int> getMessageCount(String sessionId);
  
  /// 搜索消息
  Future<List<ChatMessage>> searchMessages(String query, {String? sessionId});
  
  /// 清理过期数据
  Future<void> cleanupOldData(Duration maxAge);
  
  /// 导出聊天数据
  Future<Map<String, dynamic>> exportChatData();
  
  /// 导入聊天数据
  Future<void> importChatData(Map<String, dynamic> data);
}