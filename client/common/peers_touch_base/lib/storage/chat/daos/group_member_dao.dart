import 'package:drift/drift.dart';
import 'package:peers_touch_base/storage/chat/chat_database.dart';
import 'package:peers_touch_base/storage/chat/tables/group_members_table.dart';

part 'group_member_dao.g.dart';

/// 群角色常量
class GroupRoleValue {
  static const int member = 1;
  static const int admin = 2;
  static const int owner = 3;
}

@DriftAccessor(tables: [GroupMembers])
class GroupMemberDao extends DatabaseAccessor<ChatDatabase> with _$GroupMemberDaoMixin {
  GroupMemberDao(super.db);

  /// 获取群组所有成员
  Future<List<GroupMember>> getGroupMembers(String groupId) {
    return (select(groupMembers)
          ..where((t) => t.groupId.equals(groupId))
          ..orderBy([
            // 按角色排序：群主 > 管理员 > 成员
            (t) => OrderingTerm.desc(t.role),
            (t) => OrderingTerm.asc(t.joinedAt),
          ]))
        .get();
  }

  /// 获取群组成员数量
  Future<int> getMemberCount(String groupId) async {
    final countExp = groupMembers.actorId.count();
    final query = selectOnly(groupMembers)
      ..addColumns([countExp])
      ..where(groupMembers.groupId.equals(groupId));
    final result = await query.getSingle();
    return result.read(countExp) ?? 0;
  }

  /// 获取单个成员
  Future<GroupMember?> getMember(String groupId, String actorId) {
    return (select(groupMembers)
          ..where((t) => t.groupId.equals(groupId) & t.actorId.equals(actorId)))
        .getSingleOrNull();
  }

  /// 获取群管理员列表
  Future<List<GroupMember>> getAdmins(String groupId) {
    return (select(groupMembers)
          ..where((t) =>
              t.groupId.equals(groupId) &
              t.role.isBiggerOrEqualValue(GroupRoleValue.admin)))
        .get();
  }

  /// 获取群主
  Future<GroupMember?> getOwner(String groupId) {
    return (select(groupMembers)
          ..where((t) =>
              t.groupId.equals(groupId) &
              t.role.equals(GroupRoleValue.owner)))
        .getSingleOrNull();
  }

  /// 插入或更新成员
  Future<void> upsertMember(GroupMembersCompanion member) {
    return into(groupMembers).insertOnConflictUpdate(member);
  }

  /// 批量插入成员
  Future<void> upsertMembers(List<GroupMembersCompanion> members) {
    return batch((batch) {
      batch.insertAllOnConflictUpdate(groupMembers, members);
    });
  }

  /// 更新成员昵称
  Future<void> updateNickname(String groupId, String actorId, String nickname) {
    return (update(groupMembers)
          ..where((t) => t.groupId.equals(groupId) & t.actorId.equals(actorId)))
        .write(GroupMembersCompanion(nickname: Value(nickname)));
  }

  /// 更新成员角色
  Future<void> updateRole(String groupId, String actorId, int role) {
    return (update(groupMembers)
          ..where((t) => t.groupId.equals(groupId) & t.actorId.equals(actorId)))
        .write(GroupMembersCompanion(role: Value(role)));
  }

  /// 设置禁言
  Future<void> setMuted(String groupId, String actorId, bool muted, {DateTime? until}) {
    return (update(groupMembers)
          ..where((t) => t.groupId.equals(groupId) & t.actorId.equals(actorId)))
        .write(GroupMembersCompanion(
          isMuted: Value(muted),
          mutedUntil: Value(until?.millisecondsSinceEpoch),
        ));
  }

  /// 删除成员
  Future<void> deleteMember(String groupId, String actorId) {
    return (delete(groupMembers)
          ..where((t) => t.groupId.equals(groupId) & t.actorId.equals(actorId)))
        .go();
  }

  /// 删除群组所有成员
  Future<void> deleteGroupMembers(String groupId) {
    return (delete(groupMembers)..where((t) => t.groupId.equals(groupId))).go();
  }

  /// 搜索群成员
  Future<List<GroupMember>> searchMembers(String groupId, String query) {
    final searchPattern = '%$query%';
    return (select(groupMembers)
          ..where((t) =>
              t.groupId.equals(groupId) &
              (t.nickname.like(searchPattern) | t.displayName.like(searchPattern))))
        .get();
  }

  /// 监听群成员变化
  Stream<List<GroupMember>> watchGroupMembers(String groupId) {
    return (select(groupMembers)
          ..where((t) => t.groupId.equals(groupId))
          ..orderBy([
            (t) => OrderingTerm.desc(t.role),
            (t) => OrderingTerm.asc(t.joinedAt),
          ]))
        .watch();
  }
}
