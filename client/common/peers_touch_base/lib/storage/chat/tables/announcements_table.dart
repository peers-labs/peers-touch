import 'package:drift/drift.dart';

/// 群公告缓存表
class Announcements extends Table {
  /// 公告ID (ULID)
  TextColumn get ulid => text()();

  /// 群组ID
  TextColumn get groupUlid => text()();

  /// 作者DID
  TextColumn get authorDid => text()();

  /// 标题
  TextColumn get title => text().nullable()();

  /// 内容
  TextColumn get content => text().nullable()();

  /// 是否置顶
  BoolColumn get isPinned => boolean().withDefault(const Constant(false))();

  /// 已读人数
  IntColumn get readCount => integer().withDefault(const Constant(0))();

  /// 创建时间
  IntColumn get createdAt => integer().nullable()();

  /// 更新时间
  IntColumn get updatedAt => integer().nullable()();

  /// 是否已删除
  BoolColumn get isDeleted => boolean().withDefault(const Constant(false))();

  /// 当前用户是否已读
  BoolColumn get isRead => boolean().withDefault(const Constant(false))();

  @override
  Set<Column> get primaryKey => {ulid};
}
