import 'dart:convert';

import 'package:peers_touch_base/chat/models/models.dart';
import 'package:peers_touch_base/chat/services/storage_service.dart';
import 'package:peers_touch_base/storage/local_storage.dart';

/// 聊天存储服务实现
/// 使用本地存储进行数据持久化
class ChatStorageServiceImpl implements ChatStorageService {
  
  ChatStorageServiceImpl(this._localStorage);
  static const String _storagePrefix = 'chat_storage_';
  static const String _friendsKey = '${_storagePrefix}friends';
  static const String _friendRequestsKey = '${_storagePrefix}friend_requests';
  static const String _sessionsKey = '${_storagePrefix}sessions';
  static const String _messagesKey = '${_storagePrefix}messages';
  static const String _unreadCountKey = '${_storagePrefix}unread_count';
  
  final LocalStorage _localStorage;

  @override
  Future<List<Friend>> getFriends() async {
    try {
      final friendsData = await _localStorage.get<List<dynamic>>(_friendsKey);
      if (friendsData == null) return [];
      
      return friendsData.map((data) {
        if (data is String) {
          // JSON字符串格式
          return Friend.fromJson(json.decode(data));
        } else if (data is Map<String, dynamic>) {
          // Map格式
          return Friend.fromJson(data);
        }
        throw const FormatException('Invalid friend data format');
      }).toList();
    } catch (e) {
      print('Error loading friends: $e');
      return [];
    }
  }

  @override
  Future<Friend?> getFriend(String friendId) async {
    final friends = await getFriends();
    try {
      return friends.firstWhere((friend) => friend.id == friendId);
    } catch (e) {
      return null;
    }
  }

  @override
  Future<void> saveFriend(Friend friend) async {
    try {
      final friends = await getFriends();
      
      // 更新或添加好友
      final index = friends.indexWhere((f) => f.id == friend.id);
      if (index >= 0) {
        friends[index] = friend;
      } else {
        friends.add(friend);
      }
      
      // 保存到本地存储
      final friendsData = friends.map((f) => json.encode(f.toJson())).toList();
      await _localStorage.set(_friendsKey, friendsData);
      
    } catch (e) {
      throw StorageException('Failed to save friend: $e');
    }
  }

  @override
  Future<void> deleteFriend(String friendId) async {
    try {
      final friends = await getFriends();
      friends.removeWhere((friend) => friend.id == friendId);
      
      final friendsData = friends.map((f) => json.encode(f.toJson())).toList();
      await _localStorage.set(_friendsKey, friendsData);
      
    } catch (e) {
      throw StorageException('Failed to delete friend: $e');
    }
  }

  @override
  Future<List<Friend>> getFriendsByStatus(FriendshipStatus status) async {
    final friends = await getFriends();
    return friends.where((friend) => friend.status == status).toList();
  }

  @override
  Future<List<FriendRequest>> getFriendRequests() async {
    try {
      final requestsData = await _localStorage.get<List<dynamic>>(_friendRequestsKey);
      if (requestsData == null) return [];
      
      return requestsData.map((data) {
        if (data is String) {
          return FriendRequest.fromJson(json.decode(data));
        } else if (data is Map<String, dynamic>) {
          return FriendRequest.fromJson(data);
        }
        throw const FormatException('Invalid friend request data format');
      }).toList();
    } catch (e) {
      print('Error loading friend requests: $e');
      return [];
    }
  }

  @override
  Future<FriendRequest?> getFriendRequest(String requestId) async {
    final requests = await getFriendRequests();
    try {
      return requests.firstWhere((request) => request.id == requestId);
    } catch (e) {
      return null;
    }
  }

  @override
  Future<List<FriendRequest>> getFriendRequestsByUser(String userId) async {
    final requests = await getFriendRequests();
    return requests.where((request) => 
      request.senderId == userId || request.receiverId == userId
    ).toList();
  }

  @override
  Future<void> saveFriendRequest(FriendRequest request) async {
    try {
      final requests = await getFriendRequests();
      
      // 更新或添加好友请求
      final index = requests.indexWhere((r) => r.id == request.id);
      if (index >= 0) {
        requests[index] = request;
      } else {
        requests.add(request);
      }
      
      // 保存到本地存储
      final requestsData = requests.map((r) => json.encode(r.toJson())).toList();
      await _localStorage.set(_friendRequestsKey, requestsData);
      
    } catch (e) {
      throw StorageException('Failed to save friend request: $e');
    }
  }

  @override
  Future<void> deleteFriendRequest(String requestId) async {
    try {
      final requests = await getFriendRequests();
      requests.removeWhere((request) => request.id == requestId);
      
      final requestsData = requests.map((r) => json.encode(r.toJson())).toList();
      await _localStorage.set(_friendRequestsKey, requestsData);
      
    } catch (e) {
      throw StorageException('Failed to delete friend request: $e');
    }
  }

  @override
  Future<List<ChatSession>> getSessions() async {
    try {
      final sessionsData = await _localStorage.get<List<dynamic>>(_sessionsKey);
      if (sessionsData == null) return [];
      
      return sessionsData.map((data) {
        if (data is String) {
          return ChatSession.fromJson(json.decode(data));
        } else if (data is Map<String, dynamic>) {
          return ChatSession.fromJson(data);
        }
        throw const FormatException('Invalid session data format');
      }).toList();
    } catch (e) {
      print('Error loading sessions: $e');
      return [];
    }
  }

  @override
  Future<ChatSession?> getSession(String sessionId) async {
    final sessions = await getSessions();
    try {
      return sessions.firstWhere((session) => session.id == sessionId);
    } catch (e) {
      return null;
    }
  }

  @override
  Future<ChatSession?> getSessionByParticipants(List<String> participantIds) async {
    final sessions = await getSessions();
    
    // 对参与者ID排序以便比较
    final sortedParticipantIds = List<String>.from(participantIds)..sort();
    
    for (final session in sessions) {
      final sortedSessionParticipantIds = List<String>.from(session.participantIds)..sort();
      if (sortedSessionParticipantIds.equals(sortedParticipantIds)) {
        return session;
      }
    }
    
    return null;
  }

  @override
  Future<void> saveSession(ChatSession session) async {
    try {
      final sessions = await getSessions();
      
      // 更新或添加会话
      final index = sessions.indexWhere((s) => s.id == session.id);
      if (index >= 0) {
        sessions[index] = session;
      } else {
        sessions.add(session);
      }
      
      // 保存到本地存储
      final sessionsData = sessions.map((s) => json.encode(s.toJson())).toList();
      await _localStorage.set(_sessionsKey, sessionsData);
      
    } catch (e) {
      throw StorageException('Failed to save session: $e');
    }
  }

  @override
  Future<void> deleteSession(String sessionId) async {
    try {
      final sessions = await getSessions();
      sessions.removeWhere((session) => session.id == sessionId);
      
      final sessionsData = sessions.map((s) => json.encode(s.toJson())).toList();
      await _localStorage.set(_sessionsKey, sessionsData);
      
      // 同时删除相关的消息
      await deleteMessagesBySession(sessionId);
      
    } catch (e) {
      throw StorageException('Failed to delete session: $e');
    }
  }

  @override
  Future<void> updateSessionUnreadCount(String sessionId, int unreadCount) async {
    try {
      final session = await getSession(sessionId);
      if (session != null) {
        final updatedSession = ChatSession(
          id: session.id,
          participantIds: session.participantIds,
          type: session.type,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          lastMessage: session.lastMessage,
          unreadCount: unreadCount,
          metadata: session.metadata,
        );
        await saveSession(updatedSession);
      }
    } catch (e) {
      throw StorageException('Failed to update session unread count: $e');
    }
  }

  @override
  Future<List<ChatMessage>> getMessages(String sessionId, {int? limit, int? offset}) async {
    try {
      final allMessages = await _getAllMessages();
      final sessionMessages = allMessages.where((msg) => msg.sessionId == sessionId).toList();
      
      // 按时间排序（最新的在前）
      sessionMessages.sort((a, b) => b.sentAt.compareTo(a.sentAt));
      
      // 应用分页
      if (offset != null || limit != null) {
        final start = offset ?? 0;
        final end = limit != null ? start + limit : sessionMessages.length;
        return sessionMessages.sublist(
          start.clamp(0, sessionMessages.length),
          end.clamp(0, sessionMessages.length),
        );
      }
      
      return sessionMessages;
    } catch (e) {
      print('Error loading messages: $e');
      return [];
    }
  }

  @override
  Future<ChatMessage?> getMessage(String messageId) async {
    final messages = await _getAllMessages();
    try {
      return messages.firstWhere((message) => message.id == messageId);
    } catch (e) {
      return null;
    }
  }

  @override
  Future<List<ChatMessage>> getUnreadMessages(String sessionId) async {
    final messages = await getMessages(sessionId);
    return messages.where((message) => message.status == MessageStatus.UNREAD).toList();
  }

  @override
  Future<void> saveMessage(ChatMessage message) async {
    try {
      final messages = await _getAllMessages();
      
      // 更新或添加消息
      final index = messages.indexWhere((m) => m.id == message.id);
      if (index >= 0) {
        messages[index] = message;
      } else {
        messages.add(message);
      }
      
      // 保存到本地存储
      await _saveAllMessages(messages);
      
      // 更新会话的最后消息
      await _updateSessionLastMessage(message);
      
    } catch (e) {
      throw StorageException('Failed to save message: $e');
    }
  }

  @override
  Future<void> saveMessages(List<ChatMessage> messages) async {
    try {
      final allMessages = await _getAllMessages();
      
      for (final message in messages) {
        final index = allMessages.indexWhere((m) => m.id == message.id);
        if (index >= 0) {
          allMessages[index] = message;
        } else {
          allMessages.add(message);
        }
      }
      
      await _saveAllMessages(allMessages);
      
      // 更新相关会话的最后消息
      for (final message in messages) {
        await _updateSessionLastMessage(message);
      }
      
    } catch (e) {
      throw StorageException('Failed to save messages: $e');
    }
  }

  @override
  Future<void> deleteMessage(String messageId) async {
    try {
      final messages = await _getAllMessages();
      messages.removeWhere((message) => message.id == messageId);
      await _saveAllMessages(messages);
      
    } catch (e) {
      throw StorageException('Failed to delete message: $e');
    }
  }

  @override
  Future<void> deleteMessages(List<String> messageIds) async {
    try {
      final messages = await _getAllMessages();
      messages.removeWhere((message) => messageIds.contains(message.id));
      await _saveAllMessages(messages);
      
    } catch (e) {
      throw StorageException('Failed to delete messages: $e');
    }
  }

  @override
  Future<void> updateMessageStatus(String messageId, MessageStatus status) async {
    try {
      final message = await getMessage(messageId);
      if (message != null) {
        final updatedMessage = ChatMessage(
          id: message.id,
          sessionId: message.sessionId,
          senderId: message.senderId,
          content: message.content,
          sentAt: message.sentAt,
          type: message.type,
          status: status,
          encryptedContent: message.encryptedContent,
          attachments: message.attachments,
          metadata: message.metadata,
        );
        await saveMessage(updatedMessage);
      }
    } catch (e) {
      throw StorageException('Failed to update message status: $e');
    }
  }

  @override
  Future<ChatMessage?> getLastMessage(String sessionId) async {
    final messages = await getMessages(sessionId, limit: 1);
    return messages.isNotEmpty ? messages.first : null;
  }

  @override
  Future<int> getTotalUnreadCount() async {
    try {
      final unreadCount = await _localStorage.get<int>(_unreadCountKey);
      return unreadCount ?? 0;
    } catch (e) {
      return 0;
    }
  }

  @override
  Future<int> getMessageCount(String sessionId) async {
    final messages = await getMessages(sessionId);
    return messages.length;
  }

  @override
  Future<List<ChatMessage>> searchMessages(String query, {String? sessionId}) async {
    final messages = sessionId != null 
        ? await getMessages(sessionId)
        : await _getAllMessages();
    
    return messages.where((message) {
      return message.content.toLowerCase().contains(query.toLowerCase());
    }).toList();
  }

  @override
  Future<void> cleanupOldData(Duration maxAge) async {
    try {
      final cutoffTime = DateTime.now().subtract(maxAge);
      
      // 清理过期消息
      final messages = await _getAllMessages();
      messages.removeWhere((message) => message.sentAt.isBefore(cutoffTime));
      await _saveAllMessages(messages);
      
      // 清理过期好友请求
      final requests = await getFriendRequests();
      requests.removeWhere((request) => request.createdAt.isBefore(cutoffTime));
      final requestsData = requests.map((r) => json.encode(r.toJson())).toList();
      await _localStorage.set(_friendRequestsKey, requestsData);
      
    } catch (e) {
      throw StorageException('Failed to cleanup old data: $e');
    }
  }

  @override
  Future<Map<String, dynamic>> exportChatData() async {
    try {
      final friends = await getFriends();
      final requests = await getFriendRequests();
      final sessions = await getSessions();
      final messages = await _getAllMessages();
      
      return {
        'friends': friends.map((f) => f.toJson()).toList(),
        'friendRequests': requests.map((r) => r.toJson()).toList(),
        'sessions': sessions.map((s) => s.toJson()).toList(),
        'messages': messages.map((m) => m.toJson()).toList(),
        'exportTime': DateTime.now().toIso8601String(),
      };
    } catch (e) {
      throw StorageException('Failed to export chat data: $e');
    }
  }

  @override
  Future<void> importChatData(Map<String, dynamic> data) async {
    try {
      // 导入好友
      if (data.containsKey('friends')) {
        final friendsData = data['friends'] as List<dynamic>;
        for (final friendData in friendsData) {
          final friend = Friend.fromJson(friendData);
          await saveFriend(friend);
        }
      }
      
      // 导入好友请求
      if (data.containsKey('friendRequests')) {
        final requestsData = data['friendRequests'] as List<dynamic>;
        for (final requestData in requestsData) {
          final request = FriendRequest.fromJson(requestData);
          await saveFriendRequest(request);
        }
      }
      
      // 导入会话
      if (data.containsKey('sessions')) {
        final sessionsData = data['sessions'] as List<dynamic>;
        for (final sessionData in sessionsData) {
          final session = ChatSession.fromJson(sessionData);
          await saveSession(session);
        }
      }
      
      // 导入消息
      if (data.containsKey('messages')) {
        final messagesData = data['messages'] as List<dynamic>;
        final messages = messagesData.map((m) => ChatMessage.fromJson(m)).toList();
        await saveMessages(messages);
      }
      
    } catch (e) {
      throw StorageException('Failed to import chat data: $e');
    }
  }

  // ==================== 私有方法 ====================
  
  Future<List<ChatMessage>> _getAllMessages() async {
    try {
      final messagesData = await _localStorage.get<List<dynamic>>(_messagesKey);
      if (messagesData == null) return [];
      
      return messagesData.map((data) {
        if (data is String) {
          return ChatMessage.fromJson(json.decode(data));
        } else if (data is Map<String, dynamic>) {
          return ChatMessage.fromJson(data);
        }
        throw const FormatException('Invalid message data format');
      }).toList();
    } catch (e) {
      print('Error loading all messages: $e');
      return [];
    }
  }
  
  Future<void> _saveAllMessages(List<ChatMessage> messages) async {
    final messagesData = messages.map((m) => json.encode(m.toJson())).toList();
    await _localStorage.set(_messagesKey, messagesData);
  }
  
  Future<void> _updateSessionLastMessage(ChatMessage message) async {
    try {
      final session = await getSession(message.sessionId);
      if (session != null) {
        final updatedSession = ChatSession(
          id: session.id,
          participantIds: session.participantIds,
          type: session.type,
          createdAt: session.createdAt,
          updatedAt: DateTime.now(),
          lastMessage: message,
          unreadCount: session.unreadCount + 1,
          metadata: session.metadata,
        );
        await saveSession(updatedSession);
      }
    } catch (e) {
      print('Error updating session last message: $e');
    }
  }
  
  Future<void> deleteMessagesBySession(String sessionId) async {
    try {
      final messages = await _getAllMessages();
      messages.removeWhere((message) => message.sessionId == sessionId);
      await _saveAllMessages(messages);
    } catch (e) {
      print('Error deleting messages by session: $e');
    }
  }
}

class StorageException implements Exception {
  
  StorageException(this.message);
  final String message;
  
  @override
  String toString() => 'StorageException: $message';
}