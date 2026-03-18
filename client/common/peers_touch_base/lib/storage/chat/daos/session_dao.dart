import 'package:drift/drift.dart';
import 'package:peers_touch_base/storage/chat/chat_database.dart';
import 'package:peers_touch_base/storage/chat/tables/sessions_table.dart';

part 'session_dao.g.dart';

/// 会话类型常量
class SessionTypeValue {
  static const int friend = 1;
  static const int group = 2;
}

@DriftAccessor(tables: [Sessions])
class SessionDao extends DatabaseAccessor<ChatDatabase> with _$SessionDaoMixin {
  SessionDao(super.db);

  /// 获取所有会话，按置顶和最后消息时间排序
  Future<List<Session>> getAllSessions() {
    return (select(sessions)
          ..orderBy([
            (t) => OrderingTerm.desc(t.isPinned),
            (t) => OrderingTerm.desc(t.lastMessageAt),
          ]))
        .get();
  }

  /// 按类型获取会话
  Future<List<Session>> getSessionsByType(int type) {
    return (select(sessions)
          ..where((t) => t.type.equals(type))
          ..orderBy([
            (t) => OrderingTerm.desc(t.isPinned),
            (t) => OrderingTerm.desc(t.lastMessageAt),
          ]))
        .get();
  }

  /// 获取单个会话
  Future<Session?> getSession(String id) {
    return (select(sessions)..where((t) => t.id.equals(id))).getSingleOrNull();
  }

  /// 通过目标ID获取会话
  Future<Session?> getSessionByTarget(int type, String targetId) {
    return (select(sessions)
          ..where((t) => t.type.equals(type) & t.targetId.equals(targetId)))
        .getSingleOrNull();
  }

  /// 插入或更新会话
  Future<void> upsertSession(SessionsCompanion session) {
    return into(sessions).insertOnConflictUpdate(session);
  }

  /// 更新会话最后消息
  Future<void> updateLastMessage({
    required String sessionId,
    required String messageId,
    required int messageAt,
    required String snippet,
    required int messageType,
  }) {
    return (update(sessions)..where((t) => t.id.equals(sessionId))).write(
      SessionsCompanion(
        lastMessageId: Value(messageId),
        lastMessageAt: Value(messageAt),
        lastMessageSnippet: Value(snippet),
        lastMessageType: Value(messageType),
        updatedAt: Value(DateTime.now().millisecondsSinceEpoch),
      ),
    );
  }

  /// 更新未读数
  Future<void> updateUnreadCount(String sessionId, int count) {
    return (update(sessions)..where((t) => t.id.equals(sessionId))).write(
      SessionsCompanion(
        unreadCount: Value(count),
      ),
    );
  }

  /// 增加未读数
  Future<void> incrementUnreadCount(String sessionId) async {
    final session = await getSession(sessionId);
    if (session != null) {
      await updateUnreadCount(sessionId, session.unreadCount + 1);
    }
  }

  /// 清除未读数
  Future<void> clearUnreadCount(String sessionId) {
    return updateUnreadCount(sessionId, 0);
  }

  /// 设置置顶状态
  Future<void> setPinned(String sessionId, bool pinned) {
    return (update(sessions)..where((t) => t.id.equals(sessionId))).write(
      SessionsCompanion(
        isPinned: Value(pinned),
        updatedAt: Value(DateTime.now().millisecondsSinceEpoch),
      ),
    );
  }

  /// 设置静音状态
  Future<void> setMuted(String sessionId, bool muted) {
    return (update(sessions)..where((t) => t.id.equals(sessionId))).write(
      SessionsCompanion(
        isMuted: Value(muted),
        updatedAt: Value(DateTime.now().millisecondsSinceEpoch),
      ),
    );
  }

  /// 删除会话
  Future<void> deleteSession(String id) {
    return (delete(sessions)..where((t) => t.id.equals(id))).go();
  }

  /// 获取未读会话总数
  Future<int> getTotalUnreadCount() async {
    final result = await customSelect(
      'SELECT SUM(unread_count) as total FROM sessions',
    ).getSingle();
    return (result.data['total'] as int?) ?? 0;
  }

  /// 监听会话列表变化
  Stream<List<Session>> watchAllSessions() {
    return (select(sessions)
          ..orderBy([
            (t) => OrderingTerm.desc(t.isPinned),
            (t) => OrderingTerm.desc(t.lastMessageAt),
          ]))
        .watch();
  }
}
