import 'package:drift/drift.dart';
import 'package:peers_touch_base/storage/chat/chat_database.dart';
import 'package:peers_touch_base/storage/chat/tables/sticker_packs_table.dart';

part 'sticker_dao.g.dart';

@DriftAccessor(tables: [StickerPacks, Stickers])
class StickerDao extends DatabaseAccessor<ChatDatabase> with _$StickerDaoMixin {
  StickerDao(super.db);

  // ==================== 贴纸包操作 ====================

  /// 获取已收藏的贴纸包
  Future<List<StickerPack>> getCollectedPacks() {
    return (select(stickerPacks)
          ..where((t) => t.isCollected.equals(true))
          ..orderBy([(t) => OrderingTerm.asc(t.sortOrder)]))
        .get();
  }

  /// 获取官方贴纸包
  Future<List<StickerPack>> getOfficialPacks({int limit = 50}) {
    return (select(stickerPacks)
          ..where((t) => t.isOfficial.equals(true))
          ..orderBy([(t) => OrderingTerm.desc(t.createdAt)])
          ..limit(limit))
        .get();
  }

  /// 获取单个贴纸包
  Future<StickerPack?> getPack(String ulid) {
    return (select(stickerPacks)..where((t) => t.ulid.equals(ulid)))
        .getSingleOrNull();
  }

  /// 插入或更新贴纸包
  Future<void> upsertPack(StickerPacksCompanion pack) {
    return into(stickerPacks).insertOnConflictUpdate(pack);
  }

  /// 批量插入贴纸包
  Future<void> upsertPacks(List<StickerPacksCompanion> packs) {
    return batch((batch) {
      batch.insertAllOnConflictUpdate(stickerPacks, packs);
    });
  }

  /// 收藏贴纸包
  Future<void> collectPack(String ulid) {
    return (update(stickerPacks)..where((t) => t.ulid.equals(ulid))).write(
      const StickerPacksCompanion(isCollected: Value(true)),
    );
  }

  /// 取消收藏贴纸包
  Future<void> uncollectPack(String ulid) {
    return (update(stickerPacks)..where((t) => t.ulid.equals(ulid))).write(
      const StickerPacksCompanion(isCollected: Value(false)),
    );
  }

  /// 更新贴纸包排序
  Future<void> updatePackOrder(String ulid, int order) {
    return (update(stickerPacks)..where((t) => t.ulid.equals(ulid))).write(
      StickerPacksCompanion(sortOrder: Value(order)),
    );
  }

  // ==================== 贴纸操作 ====================

  /// 获取贴纸包的所有贴纸
  Future<List<Sticker>> getPackStickers(String packUlid) {
    return (select(stickers)..where((t) => t.packUlid.equals(packUlid))).get();
  }

  /// 获取单个贴纸
  Future<Sticker?> getSticker(String ulid) {
    return (select(stickers)..where((t) => t.ulid.equals(ulid))).getSingleOrNull();
  }

  /// 获取最近使用的贴纸
  Future<List<Sticker>> getRecentStickers({int limit = 20}) {
    return (select(stickers)
          ..where((t) => t.lastUsedAt.isNotNull())
          ..orderBy([(t) => OrderingTerm.desc(t.lastUsedAt)])
          ..limit(limit))
        .get();
  }

  /// 获取常用贴纸
  Future<List<Sticker>> getFrequentStickers({int limit = 20}) {
    return (select(stickers)
          ..where((t) => t.useCount.isBiggerThanValue(0))
          ..orderBy([(t) => OrderingTerm.desc(t.useCount)])
          ..limit(limit))
        .get();
  }

  /// 插入或更新贴纸
  Future<void> upsertSticker(StickersCompanion sticker) {
    return into(stickers).insertOnConflictUpdate(sticker);
  }

  /// 批量插入贴纸
  Future<void> upsertStickers(List<StickersCompanion> stickerList) {
    return batch((batch) {
      batch.insertAllOnConflictUpdate(stickers, stickerList);
    });
  }

  /// 记录贴纸使用
  Future<void> recordStickerUsage(String ulid) async {
    final sticker = await getSticker(ulid);
    if (sticker != null) {
      await (update(stickers)..where((t) => t.ulid.equals(ulid))).write(
        StickersCompanion(
          lastUsedAt: Value(DateTime.now().millisecondsSinceEpoch),
          useCount: Value(sticker.useCount + 1),
        ),
      );
    }
  }

  /// 更新贴纸本地缓存路径
  Future<void> updateLocalPath(String ulid, String localPath) {
    return (update(stickers)..where((t) => t.ulid.equals(ulid))).write(
      StickersCompanion(localPath: Value(localPath)),
    );
  }

  /// 搜索贴纸（通过 emoji）
  Future<List<Sticker>> searchByEmoji(String emoji, {int limit = 20}) {
    return (select(stickers)
          ..where((t) => t.emoji.equals(emoji))
          ..limit(limit))
        .get();
  }

  /// 删除贴纸包及其贴纸
  Future<void> deletePack(String ulid) async {
    await (delete(stickers)..where((t) => t.packUlid.equals(ulid))).go();
    await (delete(stickerPacks)..where((t) => t.ulid.equals(ulid))).go();
  }

  /// 监听已收藏的贴纸包
  Stream<List<StickerPack>> watchCollectedPacks() {
    return (select(stickerPacks)
          ..where((t) => t.isCollected.equals(true))
          ..orderBy([(t) => OrderingTerm.asc(t.sortOrder)]))
        .watch();
  }

  /// 监听最近使用的贴纸
  Stream<List<Sticker>> watchRecentStickers({int limit = 20}) {
    return (select(stickers)
          ..where((t) => t.lastUsedAt.isNotNull())
          ..orderBy([(t) => OrderingTerm.desc(t.lastUsedAt)])
          ..limit(limit))
        .watch();
  }
}
