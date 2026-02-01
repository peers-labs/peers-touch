import 'dart:convert';
import 'dart:io';

import 'dart:io';

import 'package:drift/drift.dart';
import 'package:path/path.dart' as p;
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart' as pb;
import 'package:peers_touch_base/model/domain/chat/group_chat.pb.dart' as group_pb;
import 'package:peers_touch_base/storage/chat/chat_database.dart';
import 'package:peers_touch_base/storage/chat/daos/session_dao.dart';
import 'package:peers_touch_base/storage/file_storage_manager.dart';

/// 聊天缓存服务
///
/// 提供消息、会话、群成员等数据的本地缓存功能。
/// 自动处理与服务端的数据同步。
class ChatCacheService {
  ChatCacheService._();

  static ChatCacheService? _instance;
  ChatDatabase? _database;
  String? _currentUserId;
  final FileStorageManager _storageManager = FileStorageManager();

  /// 获取单例实例
  static ChatCacheService get instance {
    _instance ??= ChatCacheService._();
    return _instance!;
  }

  /// 初始化服务
  Future<void> initialize(String userId) async {
    if (_currentUserId == userId && _database != null) {
      return; // 已初始化
    }

    _currentUserId = userId;
    _database = ChatDatabase.forUser(userId);
    LoggingService.info('[ChatCacheService] Initialized for user: $userId');
  }

  /// 获取数据库实例
  ChatDatabase get db {
    if (_database == null) {
      throw StateError('ChatCacheService not initialized. Call initialize() first.');
    }
    return _database!;
  }

  /// 关闭数据库连接
  Future<void> close() async {
    await _database?.close();
    _database = null;
    _currentUserId = null;
  }

  // ==================== 会话操作 ====================

  /// 获取所有会话
  Future<List<Session>> getSessions() {
    return db.sessionDao.getAllSessions();
  }

  /// 获取私聊会话
  Future<List<Session>> getFriendSessions() {
    return db.sessionDao.getSessionsByType(SessionTypeValue.friend);
  }

  /// 获取群聊会话
  Future<List<Session>> getGroupSessions() {
    return db.sessionDao.getSessionsByType(SessionTypeValue.group);
  }

  /// 获取单个会话
  Future<Session?> getSession(String id) {
    return db.sessionDao.getSession(id);
  }

  /// 保存会话（从 proto 转换）
  Future<void> saveSession(pb.ChatSession protoSession) async {
    final companion = SessionsCompanion(
      id: Value(protoSession.id),
      type: Value(protoSession.type == pb.SessionType.SESSION_TYPE_GROUP
          ? SessionTypeValue.group
          : SessionTypeValue.friend),
      targetId: Value(protoSession.targetId),
      topic: Value(protoSession.topic),
      avatarUrl: Value(protoSession.avatarUrl),
      lastMessageSnippet: Value(protoSession.lastMessageSnippet),
      lastMessageAt: Value(protoSession.hasLastMessageAt()
          ? protoSession.lastMessageAt.toDateTime().millisecondsSinceEpoch
          : null),
      lastMessageType: Value(protoSession.lastMessageType.value),
      unreadCount: Value(protoSession.unreadCount.toInt()),
      isPinned: Value(protoSession.isPinned),
      isMuted: Value(protoSession.isMuted),
      updatedAt: Value(DateTime.now().millisecondsSinceEpoch),
    );
    await db.sessionDao.upsertSession(companion);
  }

  /// 更新会话最后消息
  Future<void> updateSessionLastMessage(String sessionId, pb.ChatMessage message) async {
    await db.sessionDao.updateLastMessage(
      sessionId: sessionId,
      messageId: message.id,
      messageAt: message.sentAt.toDateTime().millisecondsSinceEpoch,
      snippet: _getMessageSnippet(message),
      messageType: message.type.value,
    );
  }

  /// 设置会话置顶
  Future<void> setSessionPinned(String sessionId, bool pinned) {
    return db.sessionDao.setPinned(sessionId, pinned);
  }

  /// 设置会话静音
  Future<void> setSessionMuted(String sessionId, bool muted) {
    return db.sessionDao.setMuted(sessionId, muted);
  }

  /// 清除会话未读数
  Future<void> clearUnreadCount(String sessionId) {
    return db.sessionDao.clearUnreadCount(sessionId);
  }

  /// 监听会话列表
  Stream<List<Session>> watchSessions() {
    return db.sessionDao.watchAllSessions();
  }

  // ==================== 消息操作 ====================

  /// 获取会话消息
  Future<List<Message>> getMessages(
    String sessionId, {
    int limit = 50,
    String? beforeId,
  }) {
    return db.messageDao.getMessages(sessionId, limit: limit, beforeId: beforeId);
  }

  /// 获取单条消息
  Future<Message?> getMessage(String id) {
    return db.messageDao.getMessage(id);
  }

  /// 保存消息（从 proto 转换）
  Future<void> saveMessage(pb.ChatMessage protoMessage) async {
    final companion = _messageToCompanion(protoMessage);
    await db.messageDao.insertMessage(companion);
  }

  /// 批量保存消息
  Future<void> saveMessages(List<pb.ChatMessage> protoMessages) async {
    final companions = protoMessages.map(_messageToCompanion).toList();
    await db.messageDao.insertMessages(companions);
  }

  /// 保存群消息
  Future<void> saveGroupMessage(group_pb.GroupMessage message, String sessionId) async {
    final companion = MessagesCompanion(
      id: Value(message.ulid),
      sessionId: Value(sessionId),
      senderId: Value(message.senderDid),
      type: Value(message.type.value),
      content: Value(message.content),
      attachments: Value(message.attachments.isNotEmpty
          ? jsonEncode(message.attachments.map((a) => {
                'cid': a.cid,
                'filename': a.filename,
                'mimeType': a.mimeType,
                'size': a.size.toInt(),
                'thumbnailCid': a.thumbnailCid,
              }).toList())
          : null),
      replyToId: Value(message.replyToUlid.isEmpty ? null : message.replyToUlid),
      mentionedIds: Value(message.mentionedDids.isNotEmpty
          ? jsonEncode(message.mentionedDids)
          : null),
      mentionAll: Value(message.mentionAll),
      isDeleted: Value(message.deleted),
      sentAt: Value(message.sentAt.toDateTime().millisecondsSinceEpoch),
      createdAt: Value(DateTime.now().millisecondsSinceEpoch),
    );
    await db.messageDao.insertMessage(companion);
  }

  /// 批量保存群消息
  Future<void> saveGroupMessages(List<group_pb.GroupMessage> messages, String sessionId) async {
    final companions = messages.map((m) => MessagesCompanion(
      id: Value(m.ulid),
      sessionId: Value(sessionId),
      senderId: Value(m.senderDid),
      type: Value(m.type.value),
      content: Value(m.content),
      attachments: Value(m.attachments.isNotEmpty
          ? jsonEncode(m.attachments.map((a) => {
                'cid': a.cid,
                'filename': a.filename,
                'mimeType': a.mimeType,
                'size': a.size.toInt(),
                'thumbnailCid': a.thumbnailCid,
              }).toList())
          : null),
      replyToId: Value(m.replyToUlid.isEmpty ? null : m.replyToUlid),
      mentionedIds: Value(m.mentionedDids.isNotEmpty
          ? jsonEncode(m.mentionedDids)
          : null),
      mentionAll: Value(m.mentionAll),
      isDeleted: Value(m.deleted),
      sentAt: Value(m.sentAt.toDateTime().millisecondsSinceEpoch),
      createdAt: Value(DateTime.now().millisecondsSinceEpoch),
    )).toList();
    await db.messageDao.insertMessages(companions);
  }

  /// 更新消息状态
  Future<void> updateMessageStatus(String messageId, int status) {
    return db.messageDao.updateStatus(messageId, status);
  }

  /// 软删除消息
  Future<void> deleteMessage(String messageId) {
    return db.messageDao.softDeleteMessage(messageId);
  }

  /// 搜索消息
  Future<List<Message>> searchMessages(String query, {String? sessionId}) {
    return db.messageDao.searchMessages(query, sessionId: sessionId);
  }

  /// 监听会话消息
  Stream<List<Message>> watchMessages(String sessionId, {int limit = 50}) {
    return db.messageDao.watchMessages(sessionId, limit: limit);
  }

  // ==================== 同步操作 ====================

  /// 获取会话列表同步时间
  Future<DateTime?> getSessionListSyncTime() {
    return db.syncMetaDao.getSessionListSyncTime();
  }

  /// 更新会话列表同步时间
  Future<void> updateSessionListSyncTime(DateTime time) {
    return db.syncMetaDao.updateSessionListSyncTime(time);
  }

  /// 获取消息同步时间
  Future<DateTime?> getMessageSyncTime(String sessionId) {
    return db.syncMetaDao.getMessageSyncTime(sessionId);
  }

  /// 更新消息同步时间
  Future<void> updateMessageSyncTime(String sessionId, DateTime time, {String? cursor}) {
    return db.syncMetaDao.updateMessageSyncTime(sessionId, time, cursor: cursor);
  }

  // ==================== 群成员操作 ====================

  /// 获取群成员列表
  Future<List<GroupMember>> getGroupMembers(String groupId) {
    return db.groupMemberDao.getGroupMembers(groupId);
  }

  /// 保存群成员
  Future<void> saveGroupMember(group_pb.GroupMember member) async {
    final companion = GroupMembersCompanion(
      groupId: Value(member.groupUlid),
      actorId: Value(member.actorDid),
      role: Value(member.role.value),
      nickname: Value(member.nickname.isEmpty ? null : member.nickname),
      isMuted: Value(member.muted),
      mutedUntil: Value(member.hasMutedUntil()
          ? member.mutedUntil.toDateTime().millisecondsSinceEpoch
          : null),
      joinedAt: Value(member.hasJoinedAt()
          ? member.joinedAt.toDateTime().millisecondsSinceEpoch
          : null),
    );
    await db.groupMemberDao.upsertMember(companion);
  }

  /// 批量保存群成员
  Future<void> saveGroupMembers(List<group_pb.GroupMember> members) async {
    final companions = members.map((m) => GroupMembersCompanion(
      groupId: Value(m.groupUlid),
      actorId: Value(m.actorDid),
      role: Value(m.role.value),
      nickname: Value(m.nickname.isEmpty ? null : m.nickname),
      isMuted: Value(m.muted),
      mutedUntil: Value(m.hasMutedUntil()
          ? m.mutedUntil.toDateTime().millisecondsSinceEpoch
          : null),
      joinedAt: Value(m.hasJoinedAt()
          ? m.joinedAt.toDateTime().millisecondsSinceEpoch
          : null),
    )).toList();
    await db.groupMemberDao.upsertMembers(companions);
  }

  /// 监听群成员
  Stream<List<GroupMember>> watchGroupMembers(String groupId) {
    return db.groupMemberDao.watchGroupMembers(groupId);
  }

  // ==================== 媒体缓存 ====================

  /// 获取媒体缓存目录
  Future<Directory> getMediaDirectory({
    required String targetType, // 'friends' or 'groups'
    required String targetId,
  }) async {
    if (_currentUserId == null) {
      throw StateError('ChatCacheService not initialized');
    }
    return _storageManager.getChatMediaDirectory(
      actorId: _currentUserId!,
      targetType: targetType,
      targetId: targetId,
    );
  }

  /// 缓存媒体文件
  Future<File> cacheMediaFile({
    required String targetType,
    required String targetId,
    required String fileName,
    required List<int> bytes,
  }) async {
    final dir = await getMediaDirectory(targetType: targetType, targetId: targetId);
    final file = File(p.join(dir.path, fileName));
    await file.writeAsBytes(bytes);
    return file;
  }

  /// 获取缓存的媒体文件路径
  Future<String?> getCachedMediaPath({
    required String targetType,
    required String targetId,
    required String fileName,
  }) async {
    final dir = await getMediaDirectory(targetType: targetType, targetId: targetId);
    final file = File(p.join(dir.path, fileName));
    if (await file.exists()) {
      return file.path;
    }
    return null;
  }

  // ==================== 私有方法 ====================

  MessagesCompanion _messageToCompanion(pb.ChatMessage msg) {
    return MessagesCompanion(
      id: Value(msg.id),
      sessionId: Value(msg.sessionId),
      senderId: Value(msg.senderId),
      type: Value(msg.type.value),
      content: Value(msg.content),
      encryptedContent: Value(msg.encryptedContent.isEmpty ? null : msg.encryptedContent),
      attachments: Value(msg.attachments.isNotEmpty
          ? jsonEncode(msg.attachments.map((a) => {
                'id': a.id,
                'name': a.name,
                'size': a.size.toInt(),
                'type': a.type,
                'url': a.url,
                'thumbnailUrl': a.thumbnailUrl,
              }).toList())
          : null),
      metadata: Value(msg.metadata.isNotEmpty ? jsonEncode(msg.metadata) : null),
      replyToId: Value(msg.replyToId.isEmpty ? null : msg.replyToId),
      mentionedIds: Value(msg.mentionedIds.isNotEmpty
          ? jsonEncode(msg.mentionedIds)
          : null),
      mentionAll: Value(msg.mentionAll),
      status: Value(msg.status.value),
      isDeleted: Value(msg.isDeleted),
      deletedAt: Value(msg.hasDeletedAt()
          ? msg.deletedAt.toDateTime().millisecondsSinceEpoch
          : null),
      sentAt: Value(msg.sentAt.toDateTime().millisecondsSinceEpoch),
      createdAt: Value(DateTime.now().millisecondsSinceEpoch),
    );
  }

  String _getMessageSnippet(pb.ChatMessage message) {
    switch (message.type) {
      case pb.MessageType.MESSAGE_TYPE_IMAGE:
        return '[图片]';
      case pb.MessageType.MESSAGE_TYPE_FILE:
        return '[文件]';
      case pb.MessageType.MESSAGE_TYPE_LOCATION:
        return '[位置]';
      case pb.MessageType.MESSAGE_TYPE_STICKER:
        return '[表情]';
      case pb.MessageType.MESSAGE_TYPE_AUDIO:
        return '[语音]';
      case pb.MessageType.MESSAGE_TYPE_VIDEO:
        return '[视频]';
      case pb.MessageType.MESSAGE_TYPE_SYSTEM:
        return '[系统消息]';
      default:
        return message.content.length > 50
            ? '${message.content.substring(0, 50)}...'
            : message.content;
    }
  }
}
