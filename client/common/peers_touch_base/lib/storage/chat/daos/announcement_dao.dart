import 'package:drift/drift.dart';
import 'package:peers_touch_base/storage/chat/chat_database.dart';
import 'package:peers_touch_base/storage/chat/tables/announcements_table.dart';

part 'announcement_dao.g.dart';

@DriftAccessor(tables: [Announcements])
class AnnouncementDao extends DatabaseAccessor<ChatDatabase>
    with _$AnnouncementDaoMixin {
  AnnouncementDao(super.db);

  /// 获取群公告列表
  Future<List<Announcement>> getAnnouncements(
    String groupUlid, {
    bool pinnedOnly = false,
    int limit = 50,
  }) {
    var query = select(announcements)
      ..where((t) => t.groupUlid.equals(groupUlid) & t.isDeleted.equals(false));

    if (pinnedOnly) {
      query = query..where((t) => t.isPinned.equals(true));
    }

    return (query
          ..orderBy([
            (t) => OrderingTerm.desc(t.isPinned),
            (t) => OrderingTerm.desc(t.createdAt),
          ])
          ..limit(limit))
        .get();
  }

  /// 获取置顶公告
  Future<List<Announcement>> getPinnedAnnouncements(String groupUlid) {
    return getAnnouncements(groupUlid, pinnedOnly: true);
  }

  /// 获取单个公告
  Future<Announcement?> getAnnouncement(String ulid) {
    return (select(announcements)..where((t) => t.ulid.equals(ulid)))
        .getSingleOrNull();
  }

  /// 获取最新公告
  Future<Announcement?> getLatestAnnouncement(String groupUlid) {
    return (select(announcements)
          ..where((t) => t.groupUlid.equals(groupUlid) & t.isDeleted.equals(false))
          ..orderBy([(t) => OrderingTerm.desc(t.createdAt)])
          ..limit(1))
        .getSingleOrNull();
  }

  /// 插入或更新公告
  Future<void> upsertAnnouncement(AnnouncementsCompanion announcement) {
    return into(announcements).insertOnConflictUpdate(announcement);
  }

  /// 批量插入公告
  Future<void> upsertAnnouncements(List<AnnouncementsCompanion> list) {
    return batch((batch) {
      batch.insertAllOnConflictUpdate(announcements, list);
    });
  }

  /// 标记公告已读
  Future<void> markAsRead(String ulid) {
    return (update(announcements)..where((t) => t.ulid.equals(ulid))).write(
      const AnnouncementsCompanion(isRead: Value(true)),
    );
  }

  /// 获取未读公告数量
  Future<int> getUnreadCount(String groupUlid) async {
    final countExp = announcements.ulid.count();
    final query = selectOnly(announcements)
      ..addColumns([countExp])
      ..where(announcements.groupUlid.equals(groupUlid) &
          announcements.isRead.equals(false) &
          announcements.isDeleted.equals(false));
    final result = await query.getSingle();
    return result.read(countExp) ?? 0;
  }

  /// 软删除公告
  Future<void> softDeleteAnnouncement(String ulid) {
    return (update(announcements)..where((t) => t.ulid.equals(ulid))).write(
      AnnouncementsCompanion(
        isDeleted: const Value(true),
        updatedAt: Value(DateTime.now().millisecondsSinceEpoch),
      ),
    );
  }

  /// 删除群组所有公告
  Future<void> deleteGroupAnnouncements(String groupUlid) {
    return (delete(announcements)..where((t) => t.groupUlid.equals(groupUlid)))
        .go();
  }

  /// 监听群公告变化
  Stream<List<Announcement>> watchAnnouncements(String groupUlid) {
    return (select(announcements)
          ..where((t) => t.groupUlid.equals(groupUlid) & t.isDeleted.equals(false))
          ..orderBy([
            (t) => OrderingTerm.desc(t.isPinned),
            (t) => OrderingTerm.desc(t.createdAt),
          ]))
        .watch();
  }
}
