import 'package:drift/drift.dart';
import 'package:peers_touch_base/storage/chat/chat_database.dart';
import 'package:peers_touch_base/storage/chat/tables/sync_meta_table.dart';

part 'sync_meta_dao.g.dart';

/// 同步资源类型常量
class SyncResourceType {
  static const String session = 'session';
  static const String message = 'message';
  static const String member = 'member';
  static const String announcement = 'announcement';
  static const String sticker = 'sticker';
}

@DriftAccessor(tables: [SyncMeta])
class SyncMetaDao extends DatabaseAccessor<ChatDatabase> with _$SyncMetaDaoMixin {
  SyncMetaDao(super.db);

  /// 全局资源ID（用于全量同步）
  static const String globalResourceId = '*';

  /// 获取同步元数据
  Future<SyncMetaData?> getSyncMeta(String resourceType, String resourceId) {
    return (select(syncMeta)
          ..where((t) =>
              t.resourceType.equals(resourceType) &
              t.resourceId.equals(resourceId)))
        .getSingleOrNull();
  }

  /// 获取最后同步时间
  Future<DateTime?> getLastSyncTime(String resourceType, String resourceId) async {
    final meta = await getSyncMeta(resourceType, resourceId);
    if (meta == null) return null;
    return DateTime.fromMillisecondsSinceEpoch(meta.lastSyncAt);
  }

  /// 更新同步元数据
  Future<void> upsertSyncMeta(SyncMetaCompanion meta) {
    return into(syncMeta).insertOnConflictUpdate(meta);
  }

  /// 更新最后同步时间
  Future<void> updateLastSyncTime(
    String resourceType,
    String resourceId,
    DateTime time, {
    String? cursor,
  }) {
    return upsertSyncMeta(SyncMetaCompanion(
      resourceType: Value(resourceType),
      resourceId: Value(resourceId),
      lastSyncAt: Value(time.millisecondsSinceEpoch),
      syncCursor: Value(cursor),
    ));
  }

  // ==================== 会话同步 ====================

  /// 获取会话列表同步时间
  Future<DateTime?> getSessionListSyncTime() {
    return getLastSyncTime(SyncResourceType.session, globalResourceId);
  }

  /// 更新会话列表同步时间
  Future<void> updateSessionListSyncTime(DateTime time) {
    return updateLastSyncTime(SyncResourceType.session, globalResourceId, time);
  }

  // ==================== 消息同步 ====================

  /// 获取会话消息同步时间
  Future<DateTime?> getMessageSyncTime(String sessionId) {
    return getLastSyncTime(SyncResourceType.message, sessionId);
  }

  /// 更新会话消息同步时间
  Future<void> updateMessageSyncTime(String sessionId, DateTime time, {String? cursor}) {
    return updateLastSyncTime(SyncResourceType.message, sessionId, time, cursor: cursor);
  }

  // ==================== 群成员同步 ====================

  /// 获取群成员同步时间
  Future<DateTime?> getMemberSyncTime(String groupId) {
    return getLastSyncTime(SyncResourceType.member, groupId);
  }

  /// 更新群成员同步时间
  Future<void> updateMemberSyncTime(String groupId, DateTime time) {
    return updateLastSyncTime(SyncResourceType.member, groupId, time);
  }

  // ==================== 公告同步 ====================

  /// 获取公告同步时间
  Future<DateTime?> getAnnouncementSyncTime(String groupId) {
    return getLastSyncTime(SyncResourceType.announcement, groupId);
  }

  /// 更新公告同步时间
  Future<void> updateAnnouncementSyncTime(String groupId, DateTime time) {
    return updateLastSyncTime(SyncResourceType.announcement, groupId, time);
  }

  // ==================== 贴纸同步 ====================

  /// 获取贴纸同步时间
  Future<DateTime?> getStickerSyncTime() {
    return getLastSyncTime(SyncResourceType.sticker, globalResourceId);
  }

  /// 更新贴纸同步时间
  Future<void> updateStickerSyncTime(DateTime time) {
    return updateLastSyncTime(SyncResourceType.sticker, globalResourceId, time);
  }

  /// 删除同步记录
  Future<void> deleteSyncMeta(String resourceType, String resourceId) {
    return (delete(syncMeta)
          ..where((t) =>
              t.resourceType.equals(resourceType) &
              t.resourceId.equals(resourceId)))
        .go();
  }

  /// 清空所有同步记录
  Future<void> clearAllSyncMeta() {
    return delete(syncMeta).go();
  }
}
