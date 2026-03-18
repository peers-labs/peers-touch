import 'package:drift/drift.dart';
import 'package:peers_touch_base/storage/chat/chat_database.dart';
import 'package:peers_touch_base/storage/chat/tables/messages_table.dart';

part 'message_dao.g.dart';

/// 消息状态常量
class MessageStatusValue {
  static const int unknown = 0;
  static const int sending = 1;
  static const int sent = 2;
  static const int delivered = 3;
  static const int failed = 4;
}

@DriftAccessor(tables: [Messages])
class MessageDao extends DatabaseAccessor<ChatDatabase> with _$MessageDaoMixin {
  MessageDao(super.db);

  /// 获取会话消息，按时间倒序
  Future<List<Message>> getMessages(
    String sessionId, {
    int limit = 50,
    String? beforeId,
  }) async {
    if (beforeId != null) {
      final beforeMessage = await getMessage(beforeId);
      if (beforeMessage != null) {
        return (select(messages)
              ..where((t) =>
                  t.sessionId.equals(sessionId) &
                  t.sentAt.isSmallerThanValue(beforeMessage.sentAt))
              ..orderBy([(t) => OrderingTerm.desc(t.sentAt)])
              ..limit(limit))
            .get();
      }
    }

    return (select(messages)
          ..where((t) => t.sessionId.equals(sessionId))
          ..orderBy([(t) => OrderingTerm.desc(t.sentAt)])
          ..limit(limit))
        .get();
  }

  /// 获取单条消息
  Future<Message?> getMessage(String id) {
    return (select(messages)..where((t) => t.id.equals(id))).getSingleOrNull();
  }

  /// 获取会话的最后一条消息
  Future<Message?> getLastMessage(String sessionId) {
    return (select(messages)
          ..where((t) => t.sessionId.equals(sessionId) & t.isDeleted.equals(false))
          ..orderBy([(t) => OrderingTerm.desc(t.sentAt)])
          ..limit(1))
        .getSingleOrNull();
  }

  /// 获取回复链（获取被回复的消息）
  Future<Message?> getRepliedMessage(String replyToId) {
    return getMessage(replyToId);
  }

  /// 插入消息
  Future<void> insertMessage(MessagesCompanion message) {
    return into(messages).insert(message);
  }

  /// 批量插入消息
  Future<void> insertMessages(List<MessagesCompanion> messageList) {
    return batch((batch) {
      batch.insertAll(messages, messageList, mode: InsertMode.insertOrReplace);
    });
  }

  /// 更新消息状态
  Future<void> updateStatus(String id, int status) {
    return (update(messages)..where((t) => t.id.equals(id))).write(
      MessagesCompanion(status: Value(status)),
    );
  }

  /// 软删除消息
  Future<void> softDeleteMessage(String id) {
    return (update(messages)..where((t) => t.id.equals(id))).write(
      MessagesCompanion(
        isDeleted: const Value(true),
        deletedAt: Value(DateTime.now().millisecondsSinceEpoch),
        content: const Value('消息已撤回'),
      ),
    );
  }

  /// 硬删除消息
  Future<void> deleteMessage(String id) {
    return (delete(messages)..where((t) => t.id.equals(id))).go();
  }

  /// 删除会话的所有消息
  Future<void> deleteSessionMessages(String sessionId) {
    return (delete(messages)..where((t) => t.sessionId.equals(sessionId))).go();
  }

  /// 搜索消息（使用 LIKE，后续可优化为 FTS）
  Future<List<Message>> searchMessages(
    String query, {
    String? sessionId,
    int limit = 50,
  }) {
    final searchPattern = '%$query%';
    if (sessionId != null) {
      return (select(messages)
            ..where((t) =>
                t.sessionId.equals(sessionId) &
                t.content.like(searchPattern) &
                t.isDeleted.equals(false))
            ..orderBy([(t) => OrderingTerm.desc(t.sentAt)])
            ..limit(limit))
          .get();
    }

    return (select(messages)
          ..where(
              (t) => t.content.like(searchPattern) & t.isDeleted.equals(false))
          ..orderBy([(t) => OrderingTerm.desc(t.sentAt)])
          ..limit(limit))
        .get();
  }

  /// 获取会话消息数量
  Future<int> getMessageCount(String sessionId) async {
    final countExp = messages.id.count();
    final query = selectOnly(messages)
      ..addColumns([countExp])
      ..where(messages.sessionId.equals(sessionId));
    final result = await query.getSingle();
    return result.read(countExp) ?? 0;
  }

  /// 获取包含@我的消息
  Future<List<Message>> getMessagesWithMention(
    String sessionId,
    String myId, {
    int limit = 50,
  }) {
    final mentionPattern = '%"$myId"%';
    return (select(messages)
          ..where((t) =>
              t.sessionId.equals(sessionId) &
              (t.mentionedIds.like(mentionPattern) | t.mentionAll.equals(true)) &
              t.isDeleted.equals(false))
          ..orderBy([(t) => OrderingTerm.desc(t.sentAt)])
          ..limit(limit))
        .get();
  }

  /// 监听会话消息变化
  Stream<List<Message>> watchMessages(String sessionId, {int limit = 50}) {
    return (select(messages)
          ..where((t) => t.sessionId.equals(sessionId))
          ..orderBy([(t) => OrderingTerm.desc(t.sentAt)])
          ..limit(limit))
        .watch();
  }
}
