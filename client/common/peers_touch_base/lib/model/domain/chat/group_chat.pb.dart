// This is a generated file - do not edit.
//
// Generated from domain/chat/group_chat.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart'
    as $0;

import 'group_chat.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'group_chat.pbenum.dart';

/// 群组
class Group extends $pb.GeneratedMessage {
  factory Group({
    $core.String? ulid,
    $core.String? name,
    $core.String? description,
    $core.String? avatarCid,
    $core.String? ownerDid,
    GroupType? type,
    GroupVisibility? visibility,
    $core.int? memberCount,
    $core.int? maxMembers,
    $core.bool? muted,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? settings,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (ulid != null) result.ulid = ulid;
    if (name != null) result.name = name;
    if (description != null) result.description = description;
    if (avatarCid != null) result.avatarCid = avatarCid;
    if (ownerDid != null) result.ownerDid = ownerDid;
    if (type != null) result.type = type;
    if (visibility != null) result.visibility = visibility;
    if (memberCount != null) result.memberCount = memberCount;
    if (maxMembers != null) result.maxMembers = maxMembers;
    if (muted != null) result.muted = muted;
    if (settings != null) result.settings.addEntries(settings);
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  Group._();

  factory Group.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Group.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Group',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'ulid')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'description')
    ..aOS(4, _omitFieldNames ? '' : 'avatarCid')
    ..aOS(5, _omitFieldNames ? '' : 'ownerDid')
    ..aE<GroupType>(6, _omitFieldNames ? '' : 'type',
        enumValues: GroupType.values)
    ..aE<GroupVisibility>(7, _omitFieldNames ? '' : 'visibility',
        enumValues: GroupVisibility.values)
    ..aI(8, _omitFieldNames ? '' : 'memberCount')
    ..aI(9, _omitFieldNames ? '' : 'maxMembers')
    ..aOB(10, _omitFieldNames ? '' : 'muted')
    ..m<$core.String, $core.String>(11, _omitFieldNames ? '' : 'settings',
        entryClassName: 'Group.SettingsEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.model.chat.v1'))
    ..aOM<$0.Timestamp>(12, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(13, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Group clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Group copyWith(void Function(Group) updates) =>
      super.copyWith((message) => updates(message as Group)) as Group;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Group create() => Group._();
  @$core.override
  Group createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Group getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Group>(create);
  static Group? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get ulid => $_getSZ(0);
  @$pb.TagNumber(1)
  set ulid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get description => $_getSZ(2);
  @$pb.TagNumber(3)
  set description($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDescription() => $_has(2);
  @$pb.TagNumber(3)
  void clearDescription() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get avatarCid => $_getSZ(3);
  @$pb.TagNumber(4)
  set avatarCid($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasAvatarCid() => $_has(3);
  @$pb.TagNumber(4)
  void clearAvatarCid() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get ownerDid => $_getSZ(4);
  @$pb.TagNumber(5)
  set ownerDid($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasOwnerDid() => $_has(4);
  @$pb.TagNumber(5)
  void clearOwnerDid() => $_clearField(5);

  @$pb.TagNumber(6)
  GroupType get type => $_getN(5);
  @$pb.TagNumber(6)
  set type(GroupType value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasType() => $_has(5);
  @$pb.TagNumber(6)
  void clearType() => $_clearField(6);

  @$pb.TagNumber(7)
  GroupVisibility get visibility => $_getN(6);
  @$pb.TagNumber(7)
  set visibility(GroupVisibility value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasVisibility() => $_has(6);
  @$pb.TagNumber(7)
  void clearVisibility() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.int get memberCount => $_getIZ(7);
  @$pb.TagNumber(8)
  set memberCount($core.int value) => $_setSignedInt32(7, value);
  @$pb.TagNumber(8)
  $core.bool hasMemberCount() => $_has(7);
  @$pb.TagNumber(8)
  void clearMemberCount() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.int get maxMembers => $_getIZ(8);
  @$pb.TagNumber(9)
  set maxMembers($core.int value) => $_setSignedInt32(8, value);
  @$pb.TagNumber(9)
  $core.bool hasMaxMembers() => $_has(8);
  @$pb.TagNumber(9)
  void clearMaxMembers() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.bool get muted => $_getBF(9);
  @$pb.TagNumber(10)
  set muted($core.bool value) => $_setBool(9, value);
  @$pb.TagNumber(10)
  $core.bool hasMuted() => $_has(9);
  @$pb.TagNumber(10)
  void clearMuted() => $_clearField(10);

  @$pb.TagNumber(11)
  $pb.PbMap<$core.String, $core.String> get settings => $_getMap(10);

  @$pb.TagNumber(12)
  $0.Timestamp get createdAt => $_getN(11);
  @$pb.TagNumber(12)
  set createdAt($0.Timestamp value) => $_setField(12, value);
  @$pb.TagNumber(12)
  $core.bool hasCreatedAt() => $_has(11);
  @$pb.TagNumber(12)
  void clearCreatedAt() => $_clearField(12);
  @$pb.TagNumber(12)
  $0.Timestamp ensureCreatedAt() => $_ensure(11);

  @$pb.TagNumber(13)
  $0.Timestamp get updatedAt => $_getN(12);
  @$pb.TagNumber(13)
  set updatedAt($0.Timestamp value) => $_setField(13, value);
  @$pb.TagNumber(13)
  $core.bool hasUpdatedAt() => $_has(12);
  @$pb.TagNumber(13)
  void clearUpdatedAt() => $_clearField(13);
  @$pb.TagNumber(13)
  $0.Timestamp ensureUpdatedAt() => $_ensure(12);
}

/// 群成员
class GroupMember extends $pb.GeneratedMessage {
  factory GroupMember({
    $core.String? groupUlid,
    $core.String? actorDid,
    GroupRole? role,
    $core.String? nickname,
    $core.bool? muted,
    $0.Timestamp? mutedUntil,
    $0.Timestamp? joinedAt,
    $core.String? invitedBy,
  }) {
    final result = create();
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (actorDid != null) result.actorDid = actorDid;
    if (role != null) result.role = role;
    if (nickname != null) result.nickname = nickname;
    if (muted != null) result.muted = muted;
    if (mutedUntil != null) result.mutedUntil = mutedUntil;
    if (joinedAt != null) result.joinedAt = joinedAt;
    if (invitedBy != null) result.invitedBy = invitedBy;
    return result;
  }

  GroupMember._();

  factory GroupMember.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GroupMember.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GroupMember',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupUlid')
    ..aOS(2, _omitFieldNames ? '' : 'actorDid')
    ..aE<GroupRole>(3, _omitFieldNames ? '' : 'role',
        enumValues: GroupRole.values)
    ..aOS(4, _omitFieldNames ? '' : 'nickname')
    ..aOB(5, _omitFieldNames ? '' : 'muted')
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'mutedUntil',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(7, _omitFieldNames ? '' : 'joinedAt',
        subBuilder: $0.Timestamp.create)
    ..aOS(8, _omitFieldNames ? '' : 'invitedBy')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GroupMember clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GroupMember copyWith(void Function(GroupMember) updates) =>
      super.copyWith((message) => updates(message as GroupMember))
          as GroupMember;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GroupMember create() => GroupMember._();
  @$core.override
  GroupMember createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GroupMember getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GroupMember>(create);
  static GroupMember? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get groupUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set groupUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGroupUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroupUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get actorDid => $_getSZ(1);
  @$pb.TagNumber(2)
  set actorDid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasActorDid() => $_has(1);
  @$pb.TagNumber(2)
  void clearActorDid() => $_clearField(2);

  @$pb.TagNumber(3)
  GroupRole get role => $_getN(2);
  @$pb.TagNumber(3)
  set role(GroupRole value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasRole() => $_has(2);
  @$pb.TagNumber(3)
  void clearRole() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get nickname => $_getSZ(3);
  @$pb.TagNumber(4)
  set nickname($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasNickname() => $_has(3);
  @$pb.TagNumber(4)
  void clearNickname() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.bool get muted => $_getBF(4);
  @$pb.TagNumber(5)
  set muted($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasMuted() => $_has(4);
  @$pb.TagNumber(5)
  void clearMuted() => $_clearField(5);

  @$pb.TagNumber(6)
  $0.Timestamp get mutedUntil => $_getN(5);
  @$pb.TagNumber(6)
  set mutedUntil($0.Timestamp value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasMutedUntil() => $_has(5);
  @$pb.TagNumber(6)
  void clearMutedUntil() => $_clearField(6);
  @$pb.TagNumber(6)
  $0.Timestamp ensureMutedUntil() => $_ensure(5);

  @$pb.TagNumber(7)
  $0.Timestamp get joinedAt => $_getN(6);
  @$pb.TagNumber(7)
  set joinedAt($0.Timestamp value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasJoinedAt() => $_has(6);
  @$pb.TagNumber(7)
  void clearJoinedAt() => $_clearField(7);
  @$pb.TagNumber(7)
  $0.Timestamp ensureJoinedAt() => $_ensure(6);

  @$pb.TagNumber(8)
  $core.String get invitedBy => $_getSZ(7);
  @$pb.TagNumber(8)
  set invitedBy($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasInvitedBy() => $_has(7);
  @$pb.TagNumber(8)
  void clearInvitedBy() => $_clearField(8);
}

/// 群消息
class GroupMessage extends $pb.GeneratedMessage {
  factory GroupMessage({
    $core.String? ulid,
    $core.String? groupUlid,
    $core.String? senderDid,
    GroupMessageType? type,
    $core.String? content,
    $core.Iterable<GroupMessageAttachment>? attachments,
    $core.String? replyToUlid,
    $core.Iterable<$core.String>? mentionedDids,
    $core.bool? mentionAll,
    $0.Timestamp? sentAt,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
    $core.bool? deleted,
  }) {
    final result = create();
    if (ulid != null) result.ulid = ulid;
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (senderDid != null) result.senderDid = senderDid;
    if (type != null) result.type = type;
    if (content != null) result.content = content;
    if (attachments != null) result.attachments.addAll(attachments);
    if (replyToUlid != null) result.replyToUlid = replyToUlid;
    if (mentionedDids != null) result.mentionedDids.addAll(mentionedDids);
    if (mentionAll != null) result.mentionAll = mentionAll;
    if (sentAt != null) result.sentAt = sentAt;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    if (deleted != null) result.deleted = deleted;
    return result;
  }

  GroupMessage._();

  factory GroupMessage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GroupMessage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GroupMessage',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'ulid')
    ..aOS(2, _omitFieldNames ? '' : 'groupUlid')
    ..aOS(3, _omitFieldNames ? '' : 'senderDid')
    ..aE<GroupMessageType>(4, _omitFieldNames ? '' : 'type',
        enumValues: GroupMessageType.values)
    ..aOS(5, _omitFieldNames ? '' : 'content')
    ..pPM<GroupMessageAttachment>(6, _omitFieldNames ? '' : 'attachments',
        subBuilder: GroupMessageAttachment.create)
    ..aOS(7, _omitFieldNames ? '' : 'replyToUlid')
    ..pPS(8, _omitFieldNames ? '' : 'mentionedDids')
    ..aOB(9, _omitFieldNames ? '' : 'mentionAll')
    ..aOM<$0.Timestamp>(10, _omitFieldNames ? '' : 'sentAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(11, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(12, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..aOB(13, _omitFieldNames ? '' : 'deleted')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GroupMessage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GroupMessage copyWith(void Function(GroupMessage) updates) =>
      super.copyWith((message) => updates(message as GroupMessage))
          as GroupMessage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GroupMessage create() => GroupMessage._();
  @$core.override
  GroupMessage createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GroupMessage getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GroupMessage>(create);
  static GroupMessage? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get ulid => $_getSZ(0);
  @$pb.TagNumber(1)
  set ulid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get groupUlid => $_getSZ(1);
  @$pb.TagNumber(2)
  set groupUlid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasGroupUlid() => $_has(1);
  @$pb.TagNumber(2)
  void clearGroupUlid() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get senderDid => $_getSZ(2);
  @$pb.TagNumber(3)
  set senderDid($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSenderDid() => $_has(2);
  @$pb.TagNumber(3)
  void clearSenderDid() => $_clearField(3);

  @$pb.TagNumber(4)
  GroupMessageType get type => $_getN(3);
  @$pb.TagNumber(4)
  set type(GroupMessageType value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasType() => $_has(3);
  @$pb.TagNumber(4)
  void clearType() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get content => $_getSZ(4);
  @$pb.TagNumber(5)
  set content($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasContent() => $_has(4);
  @$pb.TagNumber(5)
  void clearContent() => $_clearField(5);

  @$pb.TagNumber(6)
  $pb.PbList<GroupMessageAttachment> get attachments => $_getList(5);

  @$pb.TagNumber(7)
  $core.String get replyToUlid => $_getSZ(6);
  @$pb.TagNumber(7)
  set replyToUlid($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasReplyToUlid() => $_has(6);
  @$pb.TagNumber(7)
  void clearReplyToUlid() => $_clearField(7);

  @$pb.TagNumber(8)
  $pb.PbList<$core.String> get mentionedDids => $_getList(7);

  @$pb.TagNumber(9)
  $core.bool get mentionAll => $_getBF(8);
  @$pb.TagNumber(9)
  set mentionAll($core.bool value) => $_setBool(8, value);
  @$pb.TagNumber(9)
  $core.bool hasMentionAll() => $_has(8);
  @$pb.TagNumber(9)
  void clearMentionAll() => $_clearField(9);

  @$pb.TagNumber(10)
  $0.Timestamp get sentAt => $_getN(9);
  @$pb.TagNumber(10)
  set sentAt($0.Timestamp value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasSentAt() => $_has(9);
  @$pb.TagNumber(10)
  void clearSentAt() => $_clearField(10);
  @$pb.TagNumber(10)
  $0.Timestamp ensureSentAt() => $_ensure(9);

  @$pb.TagNumber(11)
  $0.Timestamp get createdAt => $_getN(10);
  @$pb.TagNumber(11)
  set createdAt($0.Timestamp value) => $_setField(11, value);
  @$pb.TagNumber(11)
  $core.bool hasCreatedAt() => $_has(10);
  @$pb.TagNumber(11)
  void clearCreatedAt() => $_clearField(11);
  @$pb.TagNumber(11)
  $0.Timestamp ensureCreatedAt() => $_ensure(10);

  @$pb.TagNumber(12)
  $0.Timestamp get updatedAt => $_getN(11);
  @$pb.TagNumber(12)
  set updatedAt($0.Timestamp value) => $_setField(12, value);
  @$pb.TagNumber(12)
  $core.bool hasUpdatedAt() => $_has(11);
  @$pb.TagNumber(12)
  void clearUpdatedAt() => $_clearField(12);
  @$pb.TagNumber(12)
  $0.Timestamp ensureUpdatedAt() => $_ensure(11);

  @$pb.TagNumber(13)
  $core.bool get deleted => $_getBF(12);
  @$pb.TagNumber(13)
  set deleted($core.bool value) => $_setBool(12, value);
  @$pb.TagNumber(13)
  $core.bool hasDeleted() => $_has(12);
  @$pb.TagNumber(13)
  void clearDeleted() => $_clearField(13);
}

class GroupMessageAttachment extends $pb.GeneratedMessage {
  factory GroupMessageAttachment({
    $core.String? cid,
    $core.String? filename,
    $core.String? mimeType,
    $fixnum.Int64? size,
    $core.String? thumbnailCid,
  }) {
    final result = create();
    if (cid != null) result.cid = cid;
    if (filename != null) result.filename = filename;
    if (mimeType != null) result.mimeType = mimeType;
    if (size != null) result.size = size;
    if (thumbnailCid != null) result.thumbnailCid = thumbnailCid;
    return result;
  }

  GroupMessageAttachment._();

  factory GroupMessageAttachment.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GroupMessageAttachment.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GroupMessageAttachment',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'cid')
    ..aOS(2, _omitFieldNames ? '' : 'filename')
    ..aOS(3, _omitFieldNames ? '' : 'mimeType')
    ..aInt64(4, _omitFieldNames ? '' : 'size')
    ..aOS(5, _omitFieldNames ? '' : 'thumbnailCid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GroupMessageAttachment clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GroupMessageAttachment copyWith(
          void Function(GroupMessageAttachment) updates) =>
      super.copyWith((message) => updates(message as GroupMessageAttachment))
          as GroupMessageAttachment;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GroupMessageAttachment create() => GroupMessageAttachment._();
  @$core.override
  GroupMessageAttachment createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GroupMessageAttachment getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GroupMessageAttachment>(create);
  static GroupMessageAttachment? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get cid => $_getSZ(0);
  @$pb.TagNumber(1)
  set cid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasCid() => $_has(0);
  @$pb.TagNumber(1)
  void clearCid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get filename => $_getSZ(1);
  @$pb.TagNumber(2)
  set filename($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasFilename() => $_has(1);
  @$pb.TagNumber(2)
  void clearFilename() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get mimeType => $_getSZ(2);
  @$pb.TagNumber(3)
  set mimeType($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasMimeType() => $_has(2);
  @$pb.TagNumber(3)
  void clearMimeType() => $_clearField(3);

  @$pb.TagNumber(4)
  $fixnum.Int64 get size => $_getI64(3);
  @$pb.TagNumber(4)
  set size($fixnum.Int64 value) => $_setInt64(3, value);
  @$pb.TagNumber(4)
  $core.bool hasSize() => $_has(3);
  @$pb.TagNumber(4)
  void clearSize() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get thumbnailCid => $_getSZ(4);
  @$pb.TagNumber(5)
  set thumbnailCid($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasThumbnailCid() => $_has(4);
  @$pb.TagNumber(5)
  void clearThumbnailCid() => $_clearField(5);
}

/// 群邀请
class GroupInvitation extends $pb.GeneratedMessage {
  factory GroupInvitation({
    $core.String? ulid,
    $core.String? groupUlid,
    $core.String? inviterDid,
    $core.String? inviteeDid,
    GroupInvitationStatus? status,
    $0.Timestamp? expireAt,
    $0.Timestamp? createdAt,
  }) {
    final result = create();
    if (ulid != null) result.ulid = ulid;
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (inviterDid != null) result.inviterDid = inviterDid;
    if (inviteeDid != null) result.inviteeDid = inviteeDid;
    if (status != null) result.status = status;
    if (expireAt != null) result.expireAt = expireAt;
    if (createdAt != null) result.createdAt = createdAt;
    return result;
  }

  GroupInvitation._();

  factory GroupInvitation.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GroupInvitation.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GroupInvitation',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'ulid')
    ..aOS(2, _omitFieldNames ? '' : 'groupUlid')
    ..aOS(3, _omitFieldNames ? '' : 'inviterDid')
    ..aOS(4, _omitFieldNames ? '' : 'inviteeDid')
    ..aE<GroupInvitationStatus>(5, _omitFieldNames ? '' : 'status',
        enumValues: GroupInvitationStatus.values)
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'expireAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(7, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GroupInvitation clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GroupInvitation copyWith(void Function(GroupInvitation) updates) =>
      super.copyWith((message) => updates(message as GroupInvitation))
          as GroupInvitation;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GroupInvitation create() => GroupInvitation._();
  @$core.override
  GroupInvitation createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GroupInvitation getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GroupInvitation>(create);
  static GroupInvitation? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get ulid => $_getSZ(0);
  @$pb.TagNumber(1)
  set ulid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get groupUlid => $_getSZ(1);
  @$pb.TagNumber(2)
  set groupUlid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasGroupUlid() => $_has(1);
  @$pb.TagNumber(2)
  void clearGroupUlid() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get inviterDid => $_getSZ(2);
  @$pb.TagNumber(3)
  set inviterDid($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasInviterDid() => $_has(2);
  @$pb.TagNumber(3)
  void clearInviterDid() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get inviteeDid => $_getSZ(3);
  @$pb.TagNumber(4)
  set inviteeDid($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasInviteeDid() => $_has(3);
  @$pb.TagNumber(4)
  void clearInviteeDid() => $_clearField(4);

  @$pb.TagNumber(5)
  GroupInvitationStatus get status => $_getN(4);
  @$pb.TagNumber(5)
  set status(GroupInvitationStatus value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasStatus() => $_has(4);
  @$pb.TagNumber(5)
  void clearStatus() => $_clearField(5);

  @$pb.TagNumber(6)
  $0.Timestamp get expireAt => $_getN(5);
  @$pb.TagNumber(6)
  set expireAt($0.Timestamp value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasExpireAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearExpireAt() => $_clearField(6);
  @$pb.TagNumber(6)
  $0.Timestamp ensureExpireAt() => $_ensure(5);

  @$pb.TagNumber(7)
  $0.Timestamp get createdAt => $_getN(6);
  @$pb.TagNumber(7)
  set createdAt($0.Timestamp value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasCreatedAt() => $_has(6);
  @$pb.TagNumber(7)
  void clearCreatedAt() => $_clearField(7);
  @$pb.TagNumber(7)
  $0.Timestamp ensureCreatedAt() => $_ensure(6);
}

/// 创建群组
class CreateGroupRequest extends $pb.GeneratedMessage {
  factory CreateGroupRequest({
    $core.String? name,
    $core.String? description,
    GroupType? type,
    GroupVisibility? visibility,
    $core.Iterable<$core.String>? initialMemberDids,
  }) {
    final result = create();
    if (name != null) result.name = name;
    if (description != null) result.description = description;
    if (type != null) result.type = type;
    if (visibility != null) result.visibility = visibility;
    if (initialMemberDids != null)
      result.initialMemberDids.addAll(initialMemberDids);
    return result;
  }

  CreateGroupRequest._();

  factory CreateGroupRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateGroupRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateGroupRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'name')
    ..aOS(2, _omitFieldNames ? '' : 'description')
    ..aE<GroupType>(3, _omitFieldNames ? '' : 'type',
        enumValues: GroupType.values)
    ..aE<GroupVisibility>(4, _omitFieldNames ? '' : 'visibility',
        enumValues: GroupVisibility.values)
    ..pPS(5, _omitFieldNames ? '' : 'initialMemberDids')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateGroupRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateGroupRequest copyWith(void Function(CreateGroupRequest) updates) =>
      super.copyWith((message) => updates(message as CreateGroupRequest))
          as CreateGroupRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateGroupRequest create() => CreateGroupRequest._();
  @$core.override
  CreateGroupRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateGroupRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateGroupRequest>(create);
  static CreateGroupRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get name => $_getSZ(0);
  @$pb.TagNumber(1)
  set name($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasName() => $_has(0);
  @$pb.TagNumber(1)
  void clearName() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get description => $_getSZ(1);
  @$pb.TagNumber(2)
  set description($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasDescription() => $_has(1);
  @$pb.TagNumber(2)
  void clearDescription() => $_clearField(2);

  @$pb.TagNumber(3)
  GroupType get type => $_getN(2);
  @$pb.TagNumber(3)
  set type(GroupType value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasType() => $_has(2);
  @$pb.TagNumber(3)
  void clearType() => $_clearField(3);

  @$pb.TagNumber(4)
  GroupVisibility get visibility => $_getN(3);
  @$pb.TagNumber(4)
  set visibility(GroupVisibility value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasVisibility() => $_has(3);
  @$pb.TagNumber(4)
  void clearVisibility() => $_clearField(4);

  @$pb.TagNumber(5)
  $pb.PbList<$core.String> get initialMemberDids => $_getList(4);
}

class CreateGroupResponse extends $pb.GeneratedMessage {
  factory CreateGroupResponse({
    Group? group,
  }) {
    final result = create();
    if (group != null) result.group = group;
    return result;
  }

  CreateGroupResponse._();

  factory CreateGroupResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateGroupResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateGroupResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOM<Group>(1, _omitFieldNames ? '' : 'group', subBuilder: Group.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateGroupResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateGroupResponse copyWith(void Function(CreateGroupResponse) updates) =>
      super.copyWith((message) => updates(message as CreateGroupResponse))
          as CreateGroupResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateGroupResponse create() => CreateGroupResponse._();
  @$core.override
  CreateGroupResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateGroupResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateGroupResponse>(create);
  static CreateGroupResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Group get group => $_getN(0);
  @$pb.TagNumber(1)
  set group(Group value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasGroup() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroup() => $_clearField(1);
  @$pb.TagNumber(1)
  Group ensureGroup() => $_ensure(0);
}

/// 获取群组列表
class ListGroupsRequest extends $pb.GeneratedMessage {
  factory ListGroupsRequest({
    $core.int? limit,
    $core.int? offset,
  }) {
    final result = create();
    if (limit != null) result.limit = limit;
    if (offset != null) result.offset = offset;
    return result;
  }

  ListGroupsRequest._();

  factory ListGroupsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListGroupsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListGroupsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'limit')
    ..aI(2, _omitFieldNames ? '' : 'offset')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListGroupsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListGroupsRequest copyWith(void Function(ListGroupsRequest) updates) =>
      super.copyWith((message) => updates(message as ListGroupsRequest))
          as ListGroupsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListGroupsRequest create() => ListGroupsRequest._();
  @$core.override
  ListGroupsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListGroupsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListGroupsRequest>(create);
  static ListGroupsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get limit => $_getIZ(0);
  @$pb.TagNumber(1)
  set limit($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasLimit() => $_has(0);
  @$pb.TagNumber(1)
  void clearLimit() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get offset => $_getIZ(1);
  @$pb.TagNumber(2)
  set offset($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasOffset() => $_has(1);
  @$pb.TagNumber(2)
  void clearOffset() => $_clearField(2);
}

class ListGroupsResponse extends $pb.GeneratedMessage {
  factory ListGroupsResponse({
    $core.Iterable<Group>? groups,
    $core.int? total,
  }) {
    final result = create();
    if (groups != null) result.groups.addAll(groups);
    if (total != null) result.total = total;
    return result;
  }

  ListGroupsResponse._();

  factory ListGroupsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListGroupsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListGroupsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..pPM<Group>(1, _omitFieldNames ? '' : 'groups', subBuilder: Group.create)
    ..aI(2, _omitFieldNames ? '' : 'total')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListGroupsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListGroupsResponse copyWith(void Function(ListGroupsResponse) updates) =>
      super.copyWith((message) => updates(message as ListGroupsResponse))
          as ListGroupsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListGroupsResponse create() => ListGroupsResponse._();
  @$core.override
  ListGroupsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListGroupsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListGroupsResponse>(create);
  static ListGroupsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Group> get groups => $_getList(0);

  @$pb.TagNumber(2)
  $core.int get total => $_getIZ(1);
  @$pb.TagNumber(2)
  set total($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTotal() => $_has(1);
  @$pb.TagNumber(2)
  void clearTotal() => $_clearField(2);
}

/// 获取群组信息
class GetGroupRequest extends $pb.GeneratedMessage {
  factory GetGroupRequest({
    $core.String? groupUlid,
  }) {
    final result = create();
    if (groupUlid != null) result.groupUlid = groupUlid;
    return result;
  }

  GetGroupRequest._();

  factory GetGroupRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetGroupRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetGroupRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupUlid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetGroupRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetGroupRequest copyWith(void Function(GetGroupRequest) updates) =>
      super.copyWith((message) => updates(message as GetGroupRequest))
          as GetGroupRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetGroupRequest create() => GetGroupRequest._();
  @$core.override
  GetGroupRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetGroupRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetGroupRequest>(create);
  static GetGroupRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get groupUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set groupUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGroupUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroupUlid() => $_clearField(1);
}

class GetGroupResponse extends $pb.GeneratedMessage {
  factory GetGroupResponse({
    Group? group,
    GroupMember? myMembership,
  }) {
    final result = create();
    if (group != null) result.group = group;
    if (myMembership != null) result.myMembership = myMembership;
    return result;
  }

  GetGroupResponse._();

  factory GetGroupResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetGroupResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetGroupResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOM<Group>(1, _omitFieldNames ? '' : 'group', subBuilder: Group.create)
    ..aOM<GroupMember>(2, _omitFieldNames ? '' : 'myMembership',
        subBuilder: GroupMember.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetGroupResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetGroupResponse copyWith(void Function(GetGroupResponse) updates) =>
      super.copyWith((message) => updates(message as GetGroupResponse))
          as GetGroupResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetGroupResponse create() => GetGroupResponse._();
  @$core.override
  GetGroupResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetGroupResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetGroupResponse>(create);
  static GetGroupResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Group get group => $_getN(0);
  @$pb.TagNumber(1)
  set group(Group value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasGroup() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroup() => $_clearField(1);
  @$pb.TagNumber(1)
  Group ensureGroup() => $_ensure(0);

  @$pb.TagNumber(2)
  GroupMember get myMembership => $_getN(1);
  @$pb.TagNumber(2)
  set myMembership(GroupMember value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasMyMembership() => $_has(1);
  @$pb.TagNumber(2)
  void clearMyMembership() => $_clearField(2);
  @$pb.TagNumber(2)
  GroupMember ensureMyMembership() => $_ensure(1);
}

/// 更新群组信息
class UpdateGroupRequest extends $pb.GeneratedMessage {
  factory UpdateGroupRequest({
    $core.String? groupUlid,
    $core.String? name,
    $core.String? description,
    $core.String? avatarCid,
    GroupType? type,
    GroupVisibility? visibility,
    $core.bool? muted,
  }) {
    final result = create();
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (name != null) result.name = name;
    if (description != null) result.description = description;
    if (avatarCid != null) result.avatarCid = avatarCid;
    if (type != null) result.type = type;
    if (visibility != null) result.visibility = visibility;
    if (muted != null) result.muted = muted;
    return result;
  }

  UpdateGroupRequest._();

  factory UpdateGroupRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateGroupRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateGroupRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupUlid')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'description')
    ..aOS(4, _omitFieldNames ? '' : 'avatarCid')
    ..aE<GroupType>(5, _omitFieldNames ? '' : 'type',
        enumValues: GroupType.values)
    ..aE<GroupVisibility>(6, _omitFieldNames ? '' : 'visibility',
        enumValues: GroupVisibility.values)
    ..aOB(7, _omitFieldNames ? '' : 'muted')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateGroupRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateGroupRequest copyWith(void Function(UpdateGroupRequest) updates) =>
      super.copyWith((message) => updates(message as UpdateGroupRequest))
          as UpdateGroupRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateGroupRequest create() => UpdateGroupRequest._();
  @$core.override
  UpdateGroupRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateGroupRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateGroupRequest>(create);
  static UpdateGroupRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get groupUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set groupUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGroupUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroupUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get description => $_getSZ(2);
  @$pb.TagNumber(3)
  set description($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDescription() => $_has(2);
  @$pb.TagNumber(3)
  void clearDescription() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get avatarCid => $_getSZ(3);
  @$pb.TagNumber(4)
  set avatarCid($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasAvatarCid() => $_has(3);
  @$pb.TagNumber(4)
  void clearAvatarCid() => $_clearField(4);

  @$pb.TagNumber(5)
  GroupType get type => $_getN(4);
  @$pb.TagNumber(5)
  set type(GroupType value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasType() => $_has(4);
  @$pb.TagNumber(5)
  void clearType() => $_clearField(5);

  @$pb.TagNumber(6)
  GroupVisibility get visibility => $_getN(5);
  @$pb.TagNumber(6)
  set visibility(GroupVisibility value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasVisibility() => $_has(5);
  @$pb.TagNumber(6)
  void clearVisibility() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.bool get muted => $_getBF(6);
  @$pb.TagNumber(7)
  set muted($core.bool value) => $_setBool(6, value);
  @$pb.TagNumber(7)
  $core.bool hasMuted() => $_has(6);
  @$pb.TagNumber(7)
  void clearMuted() => $_clearField(7);
}

class UpdateGroupResponse extends $pb.GeneratedMessage {
  factory UpdateGroupResponse({
    Group? group,
  }) {
    final result = create();
    if (group != null) result.group = group;
    return result;
  }

  UpdateGroupResponse._();

  factory UpdateGroupResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateGroupResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateGroupResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOM<Group>(1, _omitFieldNames ? '' : 'group', subBuilder: Group.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateGroupResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateGroupResponse copyWith(void Function(UpdateGroupResponse) updates) =>
      super.copyWith((message) => updates(message as UpdateGroupResponse))
          as UpdateGroupResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateGroupResponse create() => UpdateGroupResponse._();
  @$core.override
  UpdateGroupResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateGroupResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateGroupResponse>(create);
  static UpdateGroupResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Group get group => $_getN(0);
  @$pb.TagNumber(1)
  set group(Group value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasGroup() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroup() => $_clearField(1);
  @$pb.TagNumber(1)
  Group ensureGroup() => $_ensure(0);
}

/// 邀请加入群组
class InviteToGroupRequest extends $pb.GeneratedMessage {
  factory InviteToGroupRequest({
    $core.String? groupUlid,
    $core.Iterable<$core.String>? inviteeDids,
  }) {
    final result = create();
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (inviteeDids != null) result.inviteeDids.addAll(inviteeDids);
    return result;
  }

  InviteToGroupRequest._();

  factory InviteToGroupRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory InviteToGroupRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'InviteToGroupRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupUlid')
    ..pPS(2, _omitFieldNames ? '' : 'inviteeDids')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  InviteToGroupRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  InviteToGroupRequest copyWith(void Function(InviteToGroupRequest) updates) =>
      super.copyWith((message) => updates(message as InviteToGroupRequest))
          as InviteToGroupRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static InviteToGroupRequest create() => InviteToGroupRequest._();
  @$core.override
  InviteToGroupRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static InviteToGroupRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<InviteToGroupRequest>(create);
  static InviteToGroupRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get groupUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set groupUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGroupUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroupUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get inviteeDids => $_getList(1);
}

class InviteToGroupResponse extends $pb.GeneratedMessage {
  factory InviteToGroupResponse({
    $core.Iterable<GroupInvitation>? invitations,
  }) {
    final result = create();
    if (invitations != null) result.invitations.addAll(invitations);
    return result;
  }

  InviteToGroupResponse._();

  factory InviteToGroupResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory InviteToGroupResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'InviteToGroupResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..pPM<GroupInvitation>(1, _omitFieldNames ? '' : 'invitations',
        subBuilder: GroupInvitation.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  InviteToGroupResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  InviteToGroupResponse copyWith(
          void Function(InviteToGroupResponse) updates) =>
      super.copyWith((message) => updates(message as InviteToGroupResponse))
          as InviteToGroupResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static InviteToGroupResponse create() => InviteToGroupResponse._();
  @$core.override
  InviteToGroupResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static InviteToGroupResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<InviteToGroupResponse>(create);
  static InviteToGroupResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<GroupInvitation> get invitations => $_getList(0);
}

/// 加入群组
class JoinGroupRequest extends $pb.GeneratedMessage {
  factory JoinGroupRequest({
    $core.String? groupUlid,
    $core.String? invitationUlid,
  }) {
    final result = create();
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (invitationUlid != null) result.invitationUlid = invitationUlid;
    return result;
  }

  JoinGroupRequest._();

  factory JoinGroupRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory JoinGroupRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'JoinGroupRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupUlid')
    ..aOS(2, _omitFieldNames ? '' : 'invitationUlid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  JoinGroupRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  JoinGroupRequest copyWith(void Function(JoinGroupRequest) updates) =>
      super.copyWith((message) => updates(message as JoinGroupRequest))
          as JoinGroupRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static JoinGroupRequest create() => JoinGroupRequest._();
  @$core.override
  JoinGroupRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static JoinGroupRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<JoinGroupRequest>(create);
  static JoinGroupRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get groupUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set groupUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGroupUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroupUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get invitationUlid => $_getSZ(1);
  @$pb.TagNumber(2)
  set invitationUlid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasInvitationUlid() => $_has(1);
  @$pb.TagNumber(2)
  void clearInvitationUlid() => $_clearField(2);
}

class JoinGroupResponse extends $pb.GeneratedMessage {
  factory JoinGroupResponse({
    GroupMember? membership,
  }) {
    final result = create();
    if (membership != null) result.membership = membership;
    return result;
  }

  JoinGroupResponse._();

  factory JoinGroupResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory JoinGroupResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'JoinGroupResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOM<GroupMember>(1, _omitFieldNames ? '' : 'membership',
        subBuilder: GroupMember.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  JoinGroupResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  JoinGroupResponse copyWith(void Function(JoinGroupResponse) updates) =>
      super.copyWith((message) => updates(message as JoinGroupResponse))
          as JoinGroupResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static JoinGroupResponse create() => JoinGroupResponse._();
  @$core.override
  JoinGroupResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static JoinGroupResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<JoinGroupResponse>(create);
  static JoinGroupResponse? _defaultInstance;

  @$pb.TagNumber(1)
  GroupMember get membership => $_getN(0);
  @$pb.TagNumber(1)
  set membership(GroupMember value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasMembership() => $_has(0);
  @$pb.TagNumber(1)
  void clearMembership() => $_clearField(1);
  @$pb.TagNumber(1)
  GroupMember ensureMembership() => $_ensure(0);
}

/// 离开群组
class LeaveGroupRequest extends $pb.GeneratedMessage {
  factory LeaveGroupRequest({
    $core.String? groupUlid,
  }) {
    final result = create();
    if (groupUlid != null) result.groupUlid = groupUlid;
    return result;
  }

  LeaveGroupRequest._();

  factory LeaveGroupRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory LeaveGroupRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LeaveGroupRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupUlid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LeaveGroupRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LeaveGroupRequest copyWith(void Function(LeaveGroupRequest) updates) =>
      super.copyWith((message) => updates(message as LeaveGroupRequest))
          as LeaveGroupRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static LeaveGroupRequest create() => LeaveGroupRequest._();
  @$core.override
  LeaveGroupRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static LeaveGroupRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<LeaveGroupRequest>(create);
  static LeaveGroupRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get groupUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set groupUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGroupUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroupUlid() => $_clearField(1);
}

class LeaveGroupResponse extends $pb.GeneratedMessage {
  factory LeaveGroupResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  LeaveGroupResponse._();

  factory LeaveGroupResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory LeaveGroupResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LeaveGroupResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LeaveGroupResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LeaveGroupResponse copyWith(void Function(LeaveGroupResponse) updates) =>
      super.copyWith((message) => updates(message as LeaveGroupResponse))
          as LeaveGroupResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static LeaveGroupResponse create() => LeaveGroupResponse._();
  @$core.override
  LeaveGroupResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static LeaveGroupResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<LeaveGroupResponse>(create);
  static LeaveGroupResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

/// 获取群成员列表
class GetGroupMembersRequest extends $pb.GeneratedMessage {
  factory GetGroupMembersRequest({
    $core.String? groupUlid,
    $core.int? limit,
    $core.int? offset,
  }) {
    final result = create();
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (limit != null) result.limit = limit;
    if (offset != null) result.offset = offset;
    return result;
  }

  GetGroupMembersRequest._();

  factory GetGroupMembersRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetGroupMembersRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetGroupMembersRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupUlid')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aI(3, _omitFieldNames ? '' : 'offset')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetGroupMembersRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetGroupMembersRequest copyWith(
          void Function(GetGroupMembersRequest) updates) =>
      super.copyWith((message) => updates(message as GetGroupMembersRequest))
          as GetGroupMembersRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetGroupMembersRequest create() => GetGroupMembersRequest._();
  @$core.override
  GetGroupMembersRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetGroupMembersRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetGroupMembersRequest>(create);
  static GetGroupMembersRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get groupUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set groupUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGroupUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroupUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get offset => $_getIZ(2);
  @$pb.TagNumber(3)
  set offset($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasOffset() => $_has(2);
  @$pb.TagNumber(3)
  void clearOffset() => $_clearField(3);
}

class GetGroupMembersResponse extends $pb.GeneratedMessage {
  factory GetGroupMembersResponse({
    $core.Iterable<GroupMember>? members,
    $core.int? total,
  }) {
    final result = create();
    if (members != null) result.members.addAll(members);
    if (total != null) result.total = total;
    return result;
  }

  GetGroupMembersResponse._();

  factory GetGroupMembersResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetGroupMembersResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetGroupMembersResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..pPM<GroupMember>(1, _omitFieldNames ? '' : 'members',
        subBuilder: GroupMember.create)
    ..aI(2, _omitFieldNames ? '' : 'total')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetGroupMembersResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetGroupMembersResponse copyWith(
          void Function(GetGroupMembersResponse) updates) =>
      super.copyWith((message) => updates(message as GetGroupMembersResponse))
          as GetGroupMembersResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetGroupMembersResponse create() => GetGroupMembersResponse._();
  @$core.override
  GetGroupMembersResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetGroupMembersResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetGroupMembersResponse>(create);
  static GetGroupMembersResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<GroupMember> get members => $_getList(0);

  @$pb.TagNumber(2)
  $core.int get total => $_getIZ(1);
  @$pb.TagNumber(2)
  set total($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTotal() => $_has(1);
  @$pb.TagNumber(2)
  void clearTotal() => $_clearField(2);
}

/// 更新成员信息（管理员操作）
class UpdateMemberRequest extends $pb.GeneratedMessage {
  factory UpdateMemberRequest({
    $core.String? groupUlid,
    $core.String? actorDid,
    GroupRole? role,
    $core.bool? muted,
    $0.Timestamp? mutedUntil,
  }) {
    final result = create();
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (actorDid != null) result.actorDid = actorDid;
    if (role != null) result.role = role;
    if (muted != null) result.muted = muted;
    if (mutedUntil != null) result.mutedUntil = mutedUntil;
    return result;
  }

  UpdateMemberRequest._();

  factory UpdateMemberRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateMemberRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateMemberRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupUlid')
    ..aOS(2, _omitFieldNames ? '' : 'actorDid')
    ..aE<GroupRole>(3, _omitFieldNames ? '' : 'role',
        enumValues: GroupRole.values)
    ..aOB(4, _omitFieldNames ? '' : 'muted')
    ..aOM<$0.Timestamp>(5, _omitFieldNames ? '' : 'mutedUntil',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateMemberRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateMemberRequest copyWith(void Function(UpdateMemberRequest) updates) =>
      super.copyWith((message) => updates(message as UpdateMemberRequest))
          as UpdateMemberRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateMemberRequest create() => UpdateMemberRequest._();
  @$core.override
  UpdateMemberRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateMemberRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateMemberRequest>(create);
  static UpdateMemberRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get groupUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set groupUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGroupUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroupUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get actorDid => $_getSZ(1);
  @$pb.TagNumber(2)
  set actorDid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasActorDid() => $_has(1);
  @$pb.TagNumber(2)
  void clearActorDid() => $_clearField(2);

  @$pb.TagNumber(3)
  GroupRole get role => $_getN(2);
  @$pb.TagNumber(3)
  set role(GroupRole value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasRole() => $_has(2);
  @$pb.TagNumber(3)
  void clearRole() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.bool get muted => $_getBF(3);
  @$pb.TagNumber(4)
  set muted($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasMuted() => $_has(3);
  @$pb.TagNumber(4)
  void clearMuted() => $_clearField(4);

  @$pb.TagNumber(5)
  $0.Timestamp get mutedUntil => $_getN(4);
  @$pb.TagNumber(5)
  set mutedUntil($0.Timestamp value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasMutedUntil() => $_has(4);
  @$pb.TagNumber(5)
  void clearMutedUntil() => $_clearField(5);
  @$pb.TagNumber(5)
  $0.Timestamp ensureMutedUntil() => $_ensure(4);
}

class UpdateMemberResponse extends $pb.GeneratedMessage {
  factory UpdateMemberResponse({
    GroupMember? member,
  }) {
    final result = create();
    if (member != null) result.member = member;
    return result;
  }

  UpdateMemberResponse._();

  factory UpdateMemberResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateMemberResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateMemberResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOM<GroupMember>(1, _omitFieldNames ? '' : 'member',
        subBuilder: GroupMember.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateMemberResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateMemberResponse copyWith(void Function(UpdateMemberResponse) updates) =>
      super.copyWith((message) => updates(message as UpdateMemberResponse))
          as UpdateMemberResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateMemberResponse create() => UpdateMemberResponse._();
  @$core.override
  UpdateMemberResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateMemberResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateMemberResponse>(create);
  static UpdateMemberResponse? _defaultInstance;

  @$pb.TagNumber(1)
  GroupMember get member => $_getN(0);
  @$pb.TagNumber(1)
  set member(GroupMember value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasMember() => $_has(0);
  @$pb.TagNumber(1)
  void clearMember() => $_clearField(1);
  @$pb.TagNumber(1)
  GroupMember ensureMember() => $_ensure(0);
}

/// 移除成员
class RemoveMemberRequest extends $pb.GeneratedMessage {
  factory RemoveMemberRequest({
    $core.String? groupUlid,
    $core.String? actorDid,
  }) {
    final result = create();
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (actorDid != null) result.actorDid = actorDid;
    return result;
  }

  RemoveMemberRequest._();

  factory RemoveMemberRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RemoveMemberRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RemoveMemberRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupUlid')
    ..aOS(2, _omitFieldNames ? '' : 'actorDid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RemoveMemberRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RemoveMemberRequest copyWith(void Function(RemoveMemberRequest) updates) =>
      super.copyWith((message) => updates(message as RemoveMemberRequest))
          as RemoveMemberRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RemoveMemberRequest create() => RemoveMemberRequest._();
  @$core.override
  RemoveMemberRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RemoveMemberRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RemoveMemberRequest>(create);
  static RemoveMemberRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get groupUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set groupUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGroupUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroupUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get actorDid => $_getSZ(1);
  @$pb.TagNumber(2)
  set actorDid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasActorDid() => $_has(1);
  @$pb.TagNumber(2)
  void clearActorDid() => $_clearField(2);
}

class RemoveMemberResponse extends $pb.GeneratedMessage {
  factory RemoveMemberResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  RemoveMemberResponse._();

  factory RemoveMemberResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RemoveMemberResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RemoveMemberResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RemoveMemberResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RemoveMemberResponse copyWith(void Function(RemoveMemberResponse) updates) =>
      super.copyWith((message) => updates(message as RemoveMemberResponse))
          as RemoveMemberResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RemoveMemberResponse create() => RemoveMemberResponse._();
  @$core.override
  RemoveMemberResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RemoveMemberResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RemoveMemberResponse>(create);
  static RemoveMemberResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

/// 发送群消息
class SendGroupMessageRequest extends $pb.GeneratedMessage {
  factory SendGroupMessageRequest({
    $core.String? groupUlid,
    GroupMessageType? type,
    $core.String? content,
    $core.Iterable<GroupMessageAttachment>? attachments,
    $core.String? replyToUlid,
    $core.Iterable<$core.String>? mentionedDids,
    $core.bool? mentionAll,
  }) {
    final result = create();
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (type != null) result.type = type;
    if (content != null) result.content = content;
    if (attachments != null) result.attachments.addAll(attachments);
    if (replyToUlid != null) result.replyToUlid = replyToUlid;
    if (mentionedDids != null) result.mentionedDids.addAll(mentionedDids);
    if (mentionAll != null) result.mentionAll = mentionAll;
    return result;
  }

  SendGroupMessageRequest._();

  factory SendGroupMessageRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SendGroupMessageRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SendGroupMessageRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupUlid')
    ..aE<GroupMessageType>(2, _omitFieldNames ? '' : 'type',
        enumValues: GroupMessageType.values)
    ..aOS(3, _omitFieldNames ? '' : 'content')
    ..pPM<GroupMessageAttachment>(4, _omitFieldNames ? '' : 'attachments',
        subBuilder: GroupMessageAttachment.create)
    ..aOS(5, _omitFieldNames ? '' : 'replyToUlid')
    ..pPS(6, _omitFieldNames ? '' : 'mentionedDids')
    ..aOB(7, _omitFieldNames ? '' : 'mentionAll')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SendGroupMessageRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SendGroupMessageRequest copyWith(
          void Function(SendGroupMessageRequest) updates) =>
      super.copyWith((message) => updates(message as SendGroupMessageRequest))
          as SendGroupMessageRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SendGroupMessageRequest create() => SendGroupMessageRequest._();
  @$core.override
  SendGroupMessageRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SendGroupMessageRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SendGroupMessageRequest>(create);
  static SendGroupMessageRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get groupUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set groupUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGroupUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroupUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  GroupMessageType get type => $_getN(1);
  @$pb.TagNumber(2)
  set type(GroupMessageType value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasType() => $_has(1);
  @$pb.TagNumber(2)
  void clearType() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get content => $_getSZ(2);
  @$pb.TagNumber(3)
  set content($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasContent() => $_has(2);
  @$pb.TagNumber(3)
  void clearContent() => $_clearField(3);

  @$pb.TagNumber(4)
  $pb.PbList<GroupMessageAttachment> get attachments => $_getList(3);

  @$pb.TagNumber(5)
  $core.String get replyToUlid => $_getSZ(4);
  @$pb.TagNumber(5)
  set replyToUlid($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasReplyToUlid() => $_has(4);
  @$pb.TagNumber(5)
  void clearReplyToUlid() => $_clearField(5);

  @$pb.TagNumber(6)
  $pb.PbList<$core.String> get mentionedDids => $_getList(5);

  @$pb.TagNumber(7)
  $core.bool get mentionAll => $_getBF(6);
  @$pb.TagNumber(7)
  set mentionAll($core.bool value) => $_setBool(6, value);
  @$pb.TagNumber(7)
  $core.bool hasMentionAll() => $_has(6);
  @$pb.TagNumber(7)
  void clearMentionAll() => $_clearField(7);
}

class SendGroupMessageResponse extends $pb.GeneratedMessage {
  factory SendGroupMessageResponse({
    GroupMessage? message,
  }) {
    final result = create();
    if (message != null) result.message = message;
    return result;
  }

  SendGroupMessageResponse._();

  factory SendGroupMessageResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SendGroupMessageResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SendGroupMessageResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOM<GroupMessage>(1, _omitFieldNames ? '' : 'message',
        subBuilder: GroupMessage.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SendGroupMessageResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SendGroupMessageResponse copyWith(
          void Function(SendGroupMessageResponse) updates) =>
      super.copyWith((message) => updates(message as SendGroupMessageResponse))
          as SendGroupMessageResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SendGroupMessageResponse create() => SendGroupMessageResponse._();
  @$core.override
  SendGroupMessageResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SendGroupMessageResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SendGroupMessageResponse>(create);
  static SendGroupMessageResponse? _defaultInstance;

  @$pb.TagNumber(1)
  GroupMessage get message => $_getN(0);
  @$pb.TagNumber(1)
  set message(GroupMessage value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasMessage() => $_has(0);
  @$pb.TagNumber(1)
  void clearMessage() => $_clearField(1);
  @$pb.TagNumber(1)
  GroupMessage ensureMessage() => $_ensure(0);
}

/// 获取群消息
class GetGroupMessagesRequest extends $pb.GeneratedMessage {
  factory GetGroupMessagesRequest({
    $core.String? groupUlid,
    $core.String? beforeUlid,
    $core.int? limit,
  }) {
    final result = create();
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (beforeUlid != null) result.beforeUlid = beforeUlid;
    if (limit != null) result.limit = limit;
    return result;
  }

  GetGroupMessagesRequest._();

  factory GetGroupMessagesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetGroupMessagesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetGroupMessagesRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupUlid')
    ..aOS(2, _omitFieldNames ? '' : 'beforeUlid')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetGroupMessagesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetGroupMessagesRequest copyWith(
          void Function(GetGroupMessagesRequest) updates) =>
      super.copyWith((message) => updates(message as GetGroupMessagesRequest))
          as GetGroupMessagesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetGroupMessagesRequest create() => GetGroupMessagesRequest._();
  @$core.override
  GetGroupMessagesRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetGroupMessagesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetGroupMessagesRequest>(create);
  static GetGroupMessagesRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get groupUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set groupUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGroupUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroupUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get beforeUlid => $_getSZ(1);
  @$pb.TagNumber(2)
  set beforeUlid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasBeforeUlid() => $_has(1);
  @$pb.TagNumber(2)
  void clearBeforeUlid() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);
}

class GetGroupMessagesResponse extends $pb.GeneratedMessage {
  factory GetGroupMessagesResponse({
    $core.Iterable<GroupMessage>? messages,
    $core.bool? hasMore,
  }) {
    final result = create();
    if (messages != null) result.messages.addAll(messages);
    if (hasMore != null) result.hasMore = hasMore;
    return result;
  }

  GetGroupMessagesResponse._();

  factory GetGroupMessagesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetGroupMessagesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetGroupMessagesResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..pPM<GroupMessage>(1, _omitFieldNames ? '' : 'messages',
        subBuilder: GroupMessage.create)
    ..aOB(2, _omitFieldNames ? '' : 'hasMore')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetGroupMessagesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetGroupMessagesResponse copyWith(
          void Function(GetGroupMessagesResponse) updates) =>
      super.copyWith((message) => updates(message as GetGroupMessagesResponse))
          as GetGroupMessagesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetGroupMessagesResponse create() => GetGroupMessagesResponse._();
  @$core.override
  GetGroupMessagesResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetGroupMessagesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetGroupMessagesResponse>(create);
  static GetGroupMessagesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<GroupMessage> get messages => $_getList(0);

  @$pb.TagNumber(2)
  $core.bool get hasMore => $_getBF(1);
  @$pb.TagNumber(2)
  set hasMore($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasHasMore() => $_has(1);
  @$pb.TagNumber(2)
  void clearHasMore() => $_clearField(2);
}

/// 撤回消息
class RecallGroupMessageRequest extends $pb.GeneratedMessage {
  factory RecallGroupMessageRequest({
    $core.String? groupUlid,
    $core.String? messageUlid,
  }) {
    final result = create();
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (messageUlid != null) result.messageUlid = messageUlid;
    return result;
  }

  RecallGroupMessageRequest._();

  factory RecallGroupMessageRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RecallGroupMessageRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RecallGroupMessageRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupUlid')
    ..aOS(2, _omitFieldNames ? '' : 'messageUlid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecallGroupMessageRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecallGroupMessageRequest copyWith(
          void Function(RecallGroupMessageRequest) updates) =>
      super.copyWith((message) => updates(message as RecallGroupMessageRequest))
          as RecallGroupMessageRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RecallGroupMessageRequest create() => RecallGroupMessageRequest._();
  @$core.override
  RecallGroupMessageRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RecallGroupMessageRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RecallGroupMessageRequest>(create);
  static RecallGroupMessageRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get groupUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set groupUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGroupUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroupUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get messageUlid => $_getSZ(1);
  @$pb.TagNumber(2)
  set messageUlid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasMessageUlid() => $_has(1);
  @$pb.TagNumber(2)
  void clearMessageUlid() => $_clearField(2);
}

class RecallGroupMessageResponse extends $pb.GeneratedMessage {
  factory RecallGroupMessageResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  RecallGroupMessageResponse._();

  factory RecallGroupMessageResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RecallGroupMessageResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RecallGroupMessageResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecallGroupMessageResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecallGroupMessageResponse copyWith(
          void Function(RecallGroupMessageResponse) updates) =>
      super.copyWith(
              (message) => updates(message as RecallGroupMessageResponse))
          as RecallGroupMessageResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RecallGroupMessageResponse create() => RecallGroupMessageResponse._();
  @$core.override
  RecallGroupMessageResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RecallGroupMessageResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RecallGroupMessageResponse>(create);
  static RecallGroupMessageResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

/// 离线消息
class GroupOfflineMessage extends $pb.GeneratedMessage {
  factory GroupOfflineMessage({
    $core.String? ulid,
    $core.String? groupUlid,
    $core.String? receiverDid,
    $core.String? messageUlid,
    GroupOfflineMessageStatus? status,
    $0.Timestamp? expireAt,
    $0.Timestamp? deliveredAt,
    $0.Timestamp? createdAt,
  }) {
    final result = create();
    if (ulid != null) result.ulid = ulid;
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (receiverDid != null) result.receiverDid = receiverDid;
    if (messageUlid != null) result.messageUlid = messageUlid;
    if (status != null) result.status = status;
    if (expireAt != null) result.expireAt = expireAt;
    if (deliveredAt != null) result.deliveredAt = deliveredAt;
    if (createdAt != null) result.createdAt = createdAt;
    return result;
  }

  GroupOfflineMessage._();

  factory GroupOfflineMessage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GroupOfflineMessage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GroupOfflineMessage',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'ulid')
    ..aOS(2, _omitFieldNames ? '' : 'groupUlid')
    ..aOS(3, _omitFieldNames ? '' : 'receiverDid')
    ..aOS(4, _omitFieldNames ? '' : 'messageUlid')
    ..aE<GroupOfflineMessageStatus>(5, _omitFieldNames ? '' : 'status',
        enumValues: GroupOfflineMessageStatus.values)
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'expireAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(7, _omitFieldNames ? '' : 'deliveredAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(8, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GroupOfflineMessage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GroupOfflineMessage copyWith(void Function(GroupOfflineMessage) updates) =>
      super.copyWith((message) => updates(message as GroupOfflineMessage))
          as GroupOfflineMessage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GroupOfflineMessage create() => GroupOfflineMessage._();
  @$core.override
  GroupOfflineMessage createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GroupOfflineMessage getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GroupOfflineMessage>(create);
  static GroupOfflineMessage? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get ulid => $_getSZ(0);
  @$pb.TagNumber(1)
  set ulid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get groupUlid => $_getSZ(1);
  @$pb.TagNumber(2)
  set groupUlid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasGroupUlid() => $_has(1);
  @$pb.TagNumber(2)
  void clearGroupUlid() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get receiverDid => $_getSZ(2);
  @$pb.TagNumber(3)
  set receiverDid($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasReceiverDid() => $_has(2);
  @$pb.TagNumber(3)
  void clearReceiverDid() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get messageUlid => $_getSZ(3);
  @$pb.TagNumber(4)
  set messageUlid($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasMessageUlid() => $_has(3);
  @$pb.TagNumber(4)
  void clearMessageUlid() => $_clearField(4);

  @$pb.TagNumber(5)
  GroupOfflineMessageStatus get status => $_getN(4);
  @$pb.TagNumber(5)
  set status(GroupOfflineMessageStatus value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasStatus() => $_has(4);
  @$pb.TagNumber(5)
  void clearStatus() => $_clearField(5);

  @$pb.TagNumber(6)
  $0.Timestamp get expireAt => $_getN(5);
  @$pb.TagNumber(6)
  set expireAt($0.Timestamp value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasExpireAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearExpireAt() => $_clearField(6);
  @$pb.TagNumber(6)
  $0.Timestamp ensureExpireAt() => $_ensure(5);

  @$pb.TagNumber(7)
  $0.Timestamp get deliveredAt => $_getN(6);
  @$pb.TagNumber(7)
  set deliveredAt($0.Timestamp value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasDeliveredAt() => $_has(6);
  @$pb.TagNumber(7)
  void clearDeliveredAt() => $_clearField(7);
  @$pb.TagNumber(7)
  $0.Timestamp ensureDeliveredAt() => $_ensure(6);

  @$pb.TagNumber(8)
  $0.Timestamp get createdAt => $_getN(7);
  @$pb.TagNumber(8)
  set createdAt($0.Timestamp value) => $_setField(8, value);
  @$pb.TagNumber(8)
  $core.bool hasCreatedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearCreatedAt() => $_clearField(8);
  @$pb.TagNumber(8)
  $0.Timestamp ensureCreatedAt() => $_ensure(7);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
