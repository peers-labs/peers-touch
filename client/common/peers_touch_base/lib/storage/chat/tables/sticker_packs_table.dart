import 'package:drift/drift.dart';

/// 贴纸包表
class StickerPacks extends Table {
  /// 贴纸包ID (ULID)
  TextColumn get ulid => text()();

  /// 名称
  TextColumn get name => text()();

  /// 作者
  TextColumn get author => text().nullable()();

  /// 描述
  TextColumn get description => text().nullable()();

  /// 封面URL
  TextColumn get coverUrl => text().nullable()();

  /// 是否官方包
  BoolColumn get isOfficial => boolean().withDefault(const Constant(false))();

  /// 是否动态贴纸
  BoolColumn get isAnimated => boolean().withDefault(const Constant(false))();

  /// 是否已收藏
  BoolColumn get isCollected => boolean().withDefault(const Constant(false))();

  /// 排序顺序
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();

  /// 贴纸数量
  IntColumn get stickerCount => integer().withDefault(const Constant(0))();

  /// 创建时间
  IntColumn get createdAt => integer().nullable()();

  @override
  Set<Column> get primaryKey => {ulid};
}

/// 贴纸表
class Stickers extends Table {
  /// 贴纸ID (ULID)
  TextColumn get ulid => text()();

  /// 所属贴纸包ID
  TextColumn get packUlid => text()();

  /// 对应的emoji (用于搜索)
  TextColumn get emoji => text().nullable()();

  /// 贴纸图片URL
  TextColumn get url => text()();

  /// 缩略图URL
  TextColumn get thumbnailUrl => text().nullable()();

  /// 宽度
  IntColumn get width => integer().nullable()();

  /// 高度
  IntColumn get height => integer().nullable()();

  /// 文件类型 (png, gif, webp, lottie)
  TextColumn get fileType => text().nullable()();

  /// 文件大小
  IntColumn get fileSize => integer().nullable()();

  /// 最近使用时间
  IntColumn get lastUsedAt => integer().nullable()();

  /// 使用次数
  IntColumn get useCount => integer().withDefault(const Constant(0))();

  /// 本地缓存路径
  TextColumn get localPath => text().nullable()();

  @override
  Set<Column> get primaryKey => {ulid};
}
