// This is a generated file - do not edit.
//
// Generated from domain/chat/announcement.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart'
    as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

/// 群公告
class GroupAnnouncement extends $pb.GeneratedMessage {
  factory GroupAnnouncement({
    $core.String? ulid,
    $core.String? groupUlid,
    $core.String? authorDid,
    $core.String? title,
    $core.String? content,
    $core.bool? isPinned,
    $core.int? readCount,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
    $0.Timestamp? deletedAt,
  }) {
    final result = create();
    if (ulid != null) result.ulid = ulid;
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (authorDid != null) result.authorDid = authorDid;
    if (title != null) result.title = title;
    if (content != null) result.content = content;
    if (isPinned != null) result.isPinned = isPinned;
    if (readCount != null) result.readCount = readCount;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    if (deletedAt != null) result.deletedAt = deletedAt;
    return result;
  }

  GroupAnnouncement._();

  factory GroupAnnouncement.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GroupAnnouncement.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GroupAnnouncement',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'ulid')
    ..aOS(2, _omitFieldNames ? '' : 'groupUlid')
    ..aOS(3, _omitFieldNames ? '' : 'authorDid')
    ..aOS(4, _omitFieldNames ? '' : 'title')
    ..aOS(5, _omitFieldNames ? '' : 'content')
    ..aOB(6, _omitFieldNames ? '' : 'isPinned')
    ..aI(7, _omitFieldNames ? '' : 'readCount')
    ..aOM<$0.Timestamp>(8, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(9, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(10, _omitFieldNames ? '' : 'deletedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GroupAnnouncement clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GroupAnnouncement copyWith(void Function(GroupAnnouncement) updates) =>
      super.copyWith((message) => updates(message as GroupAnnouncement))
          as GroupAnnouncement;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GroupAnnouncement create() => GroupAnnouncement._();
  @$core.override
  GroupAnnouncement createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GroupAnnouncement getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GroupAnnouncement>(create);
  static GroupAnnouncement? _defaultInstance;

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
  $core.String get authorDid => $_getSZ(2);
  @$pb.TagNumber(3)
  set authorDid($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasAuthorDid() => $_has(2);
  @$pb.TagNumber(3)
  void clearAuthorDid() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get title => $_getSZ(3);
  @$pb.TagNumber(4)
  set title($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasTitle() => $_has(3);
  @$pb.TagNumber(4)
  void clearTitle() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get content => $_getSZ(4);
  @$pb.TagNumber(5)
  set content($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasContent() => $_has(4);
  @$pb.TagNumber(5)
  void clearContent() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.bool get isPinned => $_getBF(5);
  @$pb.TagNumber(6)
  set isPinned($core.bool value) => $_setBool(5, value);
  @$pb.TagNumber(6)
  $core.bool hasIsPinned() => $_has(5);
  @$pb.TagNumber(6)
  void clearIsPinned() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.int get readCount => $_getIZ(6);
  @$pb.TagNumber(7)
  set readCount($core.int value) => $_setSignedInt32(6, value);
  @$pb.TagNumber(7)
  $core.bool hasReadCount() => $_has(6);
  @$pb.TagNumber(7)
  void clearReadCount() => $_clearField(7);

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

  @$pb.TagNumber(9)
  $0.Timestamp get updatedAt => $_getN(8);
  @$pb.TagNumber(9)
  set updatedAt($0.Timestamp value) => $_setField(9, value);
  @$pb.TagNumber(9)
  $core.bool hasUpdatedAt() => $_has(8);
  @$pb.TagNumber(9)
  void clearUpdatedAt() => $_clearField(9);
  @$pb.TagNumber(9)
  $0.Timestamp ensureUpdatedAt() => $_ensure(8);

  @$pb.TagNumber(10)
  $0.Timestamp get deletedAt => $_getN(9);
  @$pb.TagNumber(10)
  set deletedAt($0.Timestamp value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasDeletedAt() => $_has(9);
  @$pb.TagNumber(10)
  void clearDeletedAt() => $_clearField(10);
  @$pb.TagNumber(10)
  $0.Timestamp ensureDeletedAt() => $_ensure(9);
}

/// 公告已读记录
class AnnouncementReadRecord extends $pb.GeneratedMessage {
  factory AnnouncementReadRecord({
    $core.String? announcementUlid,
    $core.String? readerDid,
    $0.Timestamp? readAt,
  }) {
    final result = create();
    if (announcementUlid != null) result.announcementUlid = announcementUlid;
    if (readerDid != null) result.readerDid = readerDid;
    if (readAt != null) result.readAt = readAt;
    return result;
  }

  AnnouncementReadRecord._();

  factory AnnouncementReadRecord.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory AnnouncementReadRecord.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AnnouncementReadRecord',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'announcementUlid')
    ..aOS(2, _omitFieldNames ? '' : 'readerDid')
    ..aOM<$0.Timestamp>(3, _omitFieldNames ? '' : 'readAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AnnouncementReadRecord clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AnnouncementReadRecord copyWith(
          void Function(AnnouncementReadRecord) updates) =>
      super.copyWith((message) => updates(message as AnnouncementReadRecord))
          as AnnouncementReadRecord;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AnnouncementReadRecord create() => AnnouncementReadRecord._();
  @$core.override
  AnnouncementReadRecord createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static AnnouncementReadRecord getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AnnouncementReadRecord>(create);
  static AnnouncementReadRecord? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get announcementUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set announcementUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAnnouncementUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearAnnouncementUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get readerDid => $_getSZ(1);
  @$pb.TagNumber(2)
  set readerDid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasReaderDid() => $_has(1);
  @$pb.TagNumber(2)
  void clearReaderDid() => $_clearField(2);

  @$pb.TagNumber(3)
  $0.Timestamp get readAt => $_getN(2);
  @$pb.TagNumber(3)
  set readAt($0.Timestamp value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasReadAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearReadAt() => $_clearField(3);
  @$pb.TagNumber(3)
  $0.Timestamp ensureReadAt() => $_ensure(2);
}

/// 发布公告
class CreateAnnouncementRequest extends $pb.GeneratedMessage {
  factory CreateAnnouncementRequest({
    $core.String? groupUlid,
    $core.String? title,
    $core.String? content,
    $core.bool? isPinned,
  }) {
    final result = create();
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (title != null) result.title = title;
    if (content != null) result.content = content;
    if (isPinned != null) result.isPinned = isPinned;
    return result;
  }

  CreateAnnouncementRequest._();

  factory CreateAnnouncementRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateAnnouncementRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateAnnouncementRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupUlid')
    ..aOS(2, _omitFieldNames ? '' : 'title')
    ..aOS(3, _omitFieldNames ? '' : 'content')
    ..aOB(4, _omitFieldNames ? '' : 'isPinned')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateAnnouncementRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateAnnouncementRequest copyWith(
          void Function(CreateAnnouncementRequest) updates) =>
      super.copyWith((message) => updates(message as CreateAnnouncementRequest))
          as CreateAnnouncementRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateAnnouncementRequest create() => CreateAnnouncementRequest._();
  @$core.override
  CreateAnnouncementRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateAnnouncementRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateAnnouncementRequest>(create);
  static CreateAnnouncementRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get groupUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set groupUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGroupUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroupUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get title => $_getSZ(1);
  @$pb.TagNumber(2)
  set title($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTitle() => $_has(1);
  @$pb.TagNumber(2)
  void clearTitle() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get content => $_getSZ(2);
  @$pb.TagNumber(3)
  set content($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasContent() => $_has(2);
  @$pb.TagNumber(3)
  void clearContent() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.bool get isPinned => $_getBF(3);
  @$pb.TagNumber(4)
  set isPinned($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasIsPinned() => $_has(3);
  @$pb.TagNumber(4)
  void clearIsPinned() => $_clearField(4);
}

class CreateAnnouncementResponse extends $pb.GeneratedMessage {
  factory CreateAnnouncementResponse({
    GroupAnnouncement? announcement,
  }) {
    final result = create();
    if (announcement != null) result.announcement = announcement;
    return result;
  }

  CreateAnnouncementResponse._();

  factory CreateAnnouncementResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateAnnouncementResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateAnnouncementResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOM<GroupAnnouncement>(1, _omitFieldNames ? '' : 'announcement',
        subBuilder: GroupAnnouncement.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateAnnouncementResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateAnnouncementResponse copyWith(
          void Function(CreateAnnouncementResponse) updates) =>
      super.copyWith(
              (message) => updates(message as CreateAnnouncementResponse))
          as CreateAnnouncementResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateAnnouncementResponse create() => CreateAnnouncementResponse._();
  @$core.override
  CreateAnnouncementResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateAnnouncementResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateAnnouncementResponse>(create);
  static CreateAnnouncementResponse? _defaultInstance;

  @$pb.TagNumber(1)
  GroupAnnouncement get announcement => $_getN(0);
  @$pb.TagNumber(1)
  set announcement(GroupAnnouncement value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasAnnouncement() => $_has(0);
  @$pb.TagNumber(1)
  void clearAnnouncement() => $_clearField(1);
  @$pb.TagNumber(1)
  GroupAnnouncement ensureAnnouncement() => $_ensure(0);
}

/// 获取公告列表
class ListAnnouncementsRequest extends $pb.GeneratedMessage {
  factory ListAnnouncementsRequest({
    $core.String? groupUlid,
    $core.int? limit,
    $core.int? offset,
    $core.bool? pinnedOnly,
  }) {
    final result = create();
    if (groupUlid != null) result.groupUlid = groupUlid;
    if (limit != null) result.limit = limit;
    if (offset != null) result.offset = offset;
    if (pinnedOnly != null) result.pinnedOnly = pinnedOnly;
    return result;
  }

  ListAnnouncementsRequest._();

  factory ListAnnouncementsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListAnnouncementsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListAnnouncementsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupUlid')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aI(3, _omitFieldNames ? '' : 'offset')
    ..aOB(4, _omitFieldNames ? '' : 'pinnedOnly')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListAnnouncementsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListAnnouncementsRequest copyWith(
          void Function(ListAnnouncementsRequest) updates) =>
      super.copyWith((message) => updates(message as ListAnnouncementsRequest))
          as ListAnnouncementsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListAnnouncementsRequest create() => ListAnnouncementsRequest._();
  @$core.override
  ListAnnouncementsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListAnnouncementsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListAnnouncementsRequest>(create);
  static ListAnnouncementsRequest? _defaultInstance;

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

  @$pb.TagNumber(4)
  $core.bool get pinnedOnly => $_getBF(3);
  @$pb.TagNumber(4)
  set pinnedOnly($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasPinnedOnly() => $_has(3);
  @$pb.TagNumber(4)
  void clearPinnedOnly() => $_clearField(4);
}

class ListAnnouncementsResponse extends $pb.GeneratedMessage {
  factory ListAnnouncementsResponse({
    $core.Iterable<GroupAnnouncement>? announcements,
    $core.int? total,
  }) {
    final result = create();
    if (announcements != null) result.announcements.addAll(announcements);
    if (total != null) result.total = total;
    return result;
  }

  ListAnnouncementsResponse._();

  factory ListAnnouncementsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListAnnouncementsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListAnnouncementsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..pPM<GroupAnnouncement>(1, _omitFieldNames ? '' : 'announcements',
        subBuilder: GroupAnnouncement.create)
    ..aI(2, _omitFieldNames ? '' : 'total')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListAnnouncementsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListAnnouncementsResponse copyWith(
          void Function(ListAnnouncementsResponse) updates) =>
      super.copyWith((message) => updates(message as ListAnnouncementsResponse))
          as ListAnnouncementsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListAnnouncementsResponse create() => ListAnnouncementsResponse._();
  @$core.override
  ListAnnouncementsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListAnnouncementsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListAnnouncementsResponse>(create);
  static ListAnnouncementsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<GroupAnnouncement> get announcements => $_getList(0);

  @$pb.TagNumber(2)
  $core.int get total => $_getIZ(1);
  @$pb.TagNumber(2)
  set total($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTotal() => $_has(1);
  @$pb.TagNumber(2)
  void clearTotal() => $_clearField(2);
}

/// 获取单个公告
class GetAnnouncementRequest extends $pb.GeneratedMessage {
  factory GetAnnouncementRequest({
    $core.String? announcementUlid,
  }) {
    final result = create();
    if (announcementUlid != null) result.announcementUlid = announcementUlid;
    return result;
  }

  GetAnnouncementRequest._();

  factory GetAnnouncementRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetAnnouncementRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetAnnouncementRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'announcementUlid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAnnouncementRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAnnouncementRequest copyWith(
          void Function(GetAnnouncementRequest) updates) =>
      super.copyWith((message) => updates(message as GetAnnouncementRequest))
          as GetAnnouncementRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetAnnouncementRequest create() => GetAnnouncementRequest._();
  @$core.override
  GetAnnouncementRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetAnnouncementRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetAnnouncementRequest>(create);
  static GetAnnouncementRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get announcementUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set announcementUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAnnouncementUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearAnnouncementUlid() => $_clearField(1);
}

class GetAnnouncementResponse extends $pb.GeneratedMessage {
  factory GetAnnouncementResponse({
    GroupAnnouncement? announcement,
    $core.bool? isRead,
  }) {
    final result = create();
    if (announcement != null) result.announcement = announcement;
    if (isRead != null) result.isRead = isRead;
    return result;
  }

  GetAnnouncementResponse._();

  factory GetAnnouncementResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetAnnouncementResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetAnnouncementResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOM<GroupAnnouncement>(1, _omitFieldNames ? '' : 'announcement',
        subBuilder: GroupAnnouncement.create)
    ..aOB(2, _omitFieldNames ? '' : 'isRead')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAnnouncementResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAnnouncementResponse copyWith(
          void Function(GetAnnouncementResponse) updates) =>
      super.copyWith((message) => updates(message as GetAnnouncementResponse))
          as GetAnnouncementResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetAnnouncementResponse create() => GetAnnouncementResponse._();
  @$core.override
  GetAnnouncementResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetAnnouncementResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetAnnouncementResponse>(create);
  static GetAnnouncementResponse? _defaultInstance;

  @$pb.TagNumber(1)
  GroupAnnouncement get announcement => $_getN(0);
  @$pb.TagNumber(1)
  set announcement(GroupAnnouncement value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasAnnouncement() => $_has(0);
  @$pb.TagNumber(1)
  void clearAnnouncement() => $_clearField(1);
  @$pb.TagNumber(1)
  GroupAnnouncement ensureAnnouncement() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.bool get isRead => $_getBF(1);
  @$pb.TagNumber(2)
  set isRead($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasIsRead() => $_has(1);
  @$pb.TagNumber(2)
  void clearIsRead() => $_clearField(2);
}

/// 更新公告
class UpdateAnnouncementRequest extends $pb.GeneratedMessage {
  factory UpdateAnnouncementRequest({
    $core.String? announcementUlid,
    $core.String? title,
    $core.String? content,
    $core.bool? isPinned,
  }) {
    final result = create();
    if (announcementUlid != null) result.announcementUlid = announcementUlid;
    if (title != null) result.title = title;
    if (content != null) result.content = content;
    if (isPinned != null) result.isPinned = isPinned;
    return result;
  }

  UpdateAnnouncementRequest._();

  factory UpdateAnnouncementRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateAnnouncementRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateAnnouncementRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'announcementUlid')
    ..aOS(2, _omitFieldNames ? '' : 'title')
    ..aOS(3, _omitFieldNames ? '' : 'content')
    ..aOB(4, _omitFieldNames ? '' : 'isPinned')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateAnnouncementRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateAnnouncementRequest copyWith(
          void Function(UpdateAnnouncementRequest) updates) =>
      super.copyWith((message) => updates(message as UpdateAnnouncementRequest))
          as UpdateAnnouncementRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateAnnouncementRequest create() => UpdateAnnouncementRequest._();
  @$core.override
  UpdateAnnouncementRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateAnnouncementRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateAnnouncementRequest>(create);
  static UpdateAnnouncementRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get announcementUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set announcementUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAnnouncementUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearAnnouncementUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get title => $_getSZ(1);
  @$pb.TagNumber(2)
  set title($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTitle() => $_has(1);
  @$pb.TagNumber(2)
  void clearTitle() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get content => $_getSZ(2);
  @$pb.TagNumber(3)
  set content($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasContent() => $_has(2);
  @$pb.TagNumber(3)
  void clearContent() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.bool get isPinned => $_getBF(3);
  @$pb.TagNumber(4)
  set isPinned($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasIsPinned() => $_has(3);
  @$pb.TagNumber(4)
  void clearIsPinned() => $_clearField(4);
}

class UpdateAnnouncementResponse extends $pb.GeneratedMessage {
  factory UpdateAnnouncementResponse({
    GroupAnnouncement? announcement,
  }) {
    final result = create();
    if (announcement != null) result.announcement = announcement;
    return result;
  }

  UpdateAnnouncementResponse._();

  factory UpdateAnnouncementResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateAnnouncementResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateAnnouncementResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOM<GroupAnnouncement>(1, _omitFieldNames ? '' : 'announcement',
        subBuilder: GroupAnnouncement.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateAnnouncementResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateAnnouncementResponse copyWith(
          void Function(UpdateAnnouncementResponse) updates) =>
      super.copyWith(
              (message) => updates(message as UpdateAnnouncementResponse))
          as UpdateAnnouncementResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateAnnouncementResponse create() => UpdateAnnouncementResponse._();
  @$core.override
  UpdateAnnouncementResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateAnnouncementResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateAnnouncementResponse>(create);
  static UpdateAnnouncementResponse? _defaultInstance;

  @$pb.TagNumber(1)
  GroupAnnouncement get announcement => $_getN(0);
  @$pb.TagNumber(1)
  set announcement(GroupAnnouncement value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasAnnouncement() => $_has(0);
  @$pb.TagNumber(1)
  void clearAnnouncement() => $_clearField(1);
  @$pb.TagNumber(1)
  GroupAnnouncement ensureAnnouncement() => $_ensure(0);
}

/// 删除公告
class DeleteAnnouncementRequest extends $pb.GeneratedMessage {
  factory DeleteAnnouncementRequest({
    $core.String? announcementUlid,
  }) {
    final result = create();
    if (announcementUlid != null) result.announcementUlid = announcementUlid;
    return result;
  }

  DeleteAnnouncementRequest._();

  factory DeleteAnnouncementRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory DeleteAnnouncementRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeleteAnnouncementRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'announcementUlid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteAnnouncementRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteAnnouncementRequest copyWith(
          void Function(DeleteAnnouncementRequest) updates) =>
      super.copyWith((message) => updates(message as DeleteAnnouncementRequest))
          as DeleteAnnouncementRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static DeleteAnnouncementRequest create() => DeleteAnnouncementRequest._();
  @$core.override
  DeleteAnnouncementRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static DeleteAnnouncementRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeleteAnnouncementRequest>(create);
  static DeleteAnnouncementRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get announcementUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set announcementUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAnnouncementUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearAnnouncementUlid() => $_clearField(1);
}

class DeleteAnnouncementResponse extends $pb.GeneratedMessage {
  factory DeleteAnnouncementResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  DeleteAnnouncementResponse._();

  factory DeleteAnnouncementResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory DeleteAnnouncementResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeleteAnnouncementResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteAnnouncementResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteAnnouncementResponse copyWith(
          void Function(DeleteAnnouncementResponse) updates) =>
      super.copyWith(
              (message) => updates(message as DeleteAnnouncementResponse))
          as DeleteAnnouncementResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static DeleteAnnouncementResponse create() => DeleteAnnouncementResponse._();
  @$core.override
  DeleteAnnouncementResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static DeleteAnnouncementResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeleteAnnouncementResponse>(create);
  static DeleteAnnouncementResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

/// 标记公告已读
class MarkAnnouncementReadRequest extends $pb.GeneratedMessage {
  factory MarkAnnouncementReadRequest({
    $core.String? announcementUlid,
  }) {
    final result = create();
    if (announcementUlid != null) result.announcementUlid = announcementUlid;
    return result;
  }

  MarkAnnouncementReadRequest._();

  factory MarkAnnouncementReadRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MarkAnnouncementReadRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkAnnouncementReadRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'announcementUlid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAnnouncementReadRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAnnouncementReadRequest copyWith(
          void Function(MarkAnnouncementReadRequest) updates) =>
      super.copyWith(
              (message) => updates(message as MarkAnnouncementReadRequest))
          as MarkAnnouncementReadRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MarkAnnouncementReadRequest create() =>
      MarkAnnouncementReadRequest._();
  @$core.override
  MarkAnnouncementReadRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MarkAnnouncementReadRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkAnnouncementReadRequest>(create);
  static MarkAnnouncementReadRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get announcementUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set announcementUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAnnouncementUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearAnnouncementUlid() => $_clearField(1);
}

class MarkAnnouncementReadResponse extends $pb.GeneratedMessage {
  factory MarkAnnouncementReadResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  MarkAnnouncementReadResponse._();

  factory MarkAnnouncementReadResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MarkAnnouncementReadResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkAnnouncementReadResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAnnouncementReadResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAnnouncementReadResponse copyWith(
          void Function(MarkAnnouncementReadResponse) updates) =>
      super.copyWith(
              (message) => updates(message as MarkAnnouncementReadResponse))
          as MarkAnnouncementReadResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MarkAnnouncementReadResponse create() =>
      MarkAnnouncementReadResponse._();
  @$core.override
  MarkAnnouncementReadResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MarkAnnouncementReadResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkAnnouncementReadResponse>(create);
  static MarkAnnouncementReadResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

/// 获取公告已读列表
class GetAnnouncementReadersRequest extends $pb.GeneratedMessage {
  factory GetAnnouncementReadersRequest({
    $core.String? announcementUlid,
    $core.int? limit,
    $core.int? offset,
  }) {
    final result = create();
    if (announcementUlid != null) result.announcementUlid = announcementUlid;
    if (limit != null) result.limit = limit;
    if (offset != null) result.offset = offset;
    return result;
  }

  GetAnnouncementReadersRequest._();

  factory GetAnnouncementReadersRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetAnnouncementReadersRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetAnnouncementReadersRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'announcementUlid')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aI(3, _omitFieldNames ? '' : 'offset')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAnnouncementReadersRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAnnouncementReadersRequest copyWith(
          void Function(GetAnnouncementReadersRequest) updates) =>
      super.copyWith(
              (message) => updates(message as GetAnnouncementReadersRequest))
          as GetAnnouncementReadersRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetAnnouncementReadersRequest create() =>
      GetAnnouncementReadersRequest._();
  @$core.override
  GetAnnouncementReadersRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetAnnouncementReadersRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetAnnouncementReadersRequest>(create);
  static GetAnnouncementReadersRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get announcementUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set announcementUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAnnouncementUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearAnnouncementUlid() => $_clearField(1);

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

class GetAnnouncementReadersResponse extends $pb.GeneratedMessage {
  factory GetAnnouncementReadersResponse({
    $core.Iterable<AnnouncementReadRecord>? readers,
    $core.int? total,
  }) {
    final result = create();
    if (readers != null) result.readers.addAll(readers);
    if (total != null) result.total = total;
    return result;
  }

  GetAnnouncementReadersResponse._();

  factory GetAnnouncementReadersResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetAnnouncementReadersResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetAnnouncementReadersResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..pPM<AnnouncementReadRecord>(1, _omitFieldNames ? '' : 'readers',
        subBuilder: AnnouncementReadRecord.create)
    ..aI(2, _omitFieldNames ? '' : 'total')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAnnouncementReadersResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAnnouncementReadersResponse copyWith(
          void Function(GetAnnouncementReadersResponse) updates) =>
      super.copyWith(
              (message) => updates(message as GetAnnouncementReadersResponse))
          as GetAnnouncementReadersResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetAnnouncementReadersResponse create() =>
      GetAnnouncementReadersResponse._();
  @$core.override
  GetAnnouncementReadersResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetAnnouncementReadersResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetAnnouncementReadersResponse>(create);
  static GetAnnouncementReadersResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<AnnouncementReadRecord> get readers => $_getList(0);

  @$pb.TagNumber(2)
  $core.int get total => $_getIZ(1);
  @$pb.TagNumber(2)
  set total($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTotal() => $_has(1);
  @$pb.TagNumber(2)
  void clearTotal() => $_clearField(2);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
