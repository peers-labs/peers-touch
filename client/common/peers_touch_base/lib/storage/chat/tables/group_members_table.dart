import 'package:drift/drift.dart';

/// 群成员缓存表
class GroupMembers extends Table {
  /// 群组ID
  TextColumn get groupId => text()();

  /// 成员ID (actor DID)
  TextColumn get actorId => text()();

  /// 角色: 1=member, 2=admin, 3=owner
  IntColumn get role => integer()();

  /// 群内昵称
  TextColumn get nickname => text().nullable()();

  /// 是否被禁言
  BoolColumn get isMuted => boolean().withDefault(const Constant(false))();

  /// 禁言截止时间 (Unix timestamp ms)
  IntColumn get mutedUntil => integer().nullable()();

  /// 加入时间
  IntColumn get joinedAt => integer().nullable()();

  /// 头像URL (缓存)
  TextColumn get avatarUrl => text().nullable()();

  /// 显示名称 (缓存)
  TextColumn get displayName => text().nullable()();

  @override
  Set<Column> get primaryKey => {groupId, actorId};
}
