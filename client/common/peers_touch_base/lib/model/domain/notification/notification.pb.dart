// This is a generated file - do not edit.
//
// Generated from domain/notification/notification.proto.

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

import 'notification.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'notification.pbenum.dart';

/// Notification represents a single notification entity.
/// title and body carry server-generated fallback text for push previews.
/// Rich clients render locale-aware display text from the structured
/// references (type + target_type + target_id + actor_id).
class Notification extends $pb.GeneratedMessage {
  factory Notification({
    $core.String? id,
    $core.String? recipientId,
    $core.String? actorId,
    NotificationType? type,
    NotificationCategory? category,
    NotificationStatus? status,
    $core.String? targetType,
    $core.String? targetId,
    $core.String? title,
    $core.String? body,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? metadata,
    $core.String? groupKey,
    $0.Timestamp? createdAt,
    $0.Timestamp? readAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (recipientId != null) result.recipientId = recipientId;
    if (actorId != null) result.actorId = actorId;
    if (type != null) result.type = type;
    if (category != null) result.category = category;
    if (status != null) result.status = status;
    if (targetType != null) result.targetType = targetType;
    if (targetId != null) result.targetId = targetId;
    if (title != null) result.title = title;
    if (body != null) result.body = body;
    if (metadata != null) result.metadata.addEntries(metadata);
    if (groupKey != null) result.groupKey = groupKey;
    if (createdAt != null) result.createdAt = createdAt;
    if (readAt != null) result.readAt = readAt;
    return result;
  }

  Notification._();

  factory Notification.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Notification.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Notification',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'recipientId')
    ..aOS(3, _omitFieldNames ? '' : 'actorId')
    ..aE<NotificationType>(4, _omitFieldNames ? '' : 'type',
        enumValues: NotificationType.values)
    ..aE<NotificationCategory>(5, _omitFieldNames ? '' : 'category',
        enumValues: NotificationCategory.values)
    ..aE<NotificationStatus>(6, _omitFieldNames ? '' : 'status',
        enumValues: NotificationStatus.values)
    ..aOS(7, _omitFieldNames ? '' : 'targetType')
    ..aOS(8, _omitFieldNames ? '' : 'targetId')
    ..aOS(9, _omitFieldNames ? '' : 'title')
    ..aOS(10, _omitFieldNames ? '' : 'body')
    ..m<$core.String, $core.String>(11, _omitFieldNames ? '' : 'metadata',
        entryClassName: 'Notification.MetadataEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.model.notification.v1'))
    ..aOS(12, _omitFieldNames ? '' : 'groupKey')
    ..aOM<$0.Timestamp>(13, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(14, _omitFieldNames ? '' : 'readAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Notification clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Notification copyWith(void Function(Notification) updates) =>
      super.copyWith((message) => updates(message as Notification))
          as Notification;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Notification create() => Notification._();
  @$core.override
  Notification createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Notification getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Notification>(create);
  static Notification? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get recipientId => $_getSZ(1);
  @$pb.TagNumber(2)
  set recipientId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasRecipientId() => $_has(1);
  @$pb.TagNumber(2)
  void clearRecipientId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get actorId => $_getSZ(2);
  @$pb.TagNumber(3)
  set actorId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasActorId() => $_has(2);
  @$pb.TagNumber(3)
  void clearActorId() => $_clearField(3);

  @$pb.TagNumber(4)
  NotificationType get type => $_getN(3);
  @$pb.TagNumber(4)
  set type(NotificationType value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasType() => $_has(3);
  @$pb.TagNumber(4)
  void clearType() => $_clearField(4);

  @$pb.TagNumber(5)
  NotificationCategory get category => $_getN(4);
  @$pb.TagNumber(5)
  set category(NotificationCategory value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasCategory() => $_has(4);
  @$pb.TagNumber(5)
  void clearCategory() => $_clearField(5);

  @$pb.TagNumber(6)
  NotificationStatus get status => $_getN(5);
  @$pb.TagNumber(6)
  set status(NotificationStatus value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasStatus() => $_has(5);
  @$pb.TagNumber(6)
  void clearStatus() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get targetType => $_getSZ(6);
  @$pb.TagNumber(7)
  set targetType($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasTargetType() => $_has(6);
  @$pb.TagNumber(7)
  void clearTargetType() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get targetId => $_getSZ(7);
  @$pb.TagNumber(8)
  set targetId($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasTargetId() => $_has(7);
  @$pb.TagNumber(8)
  void clearTargetId() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.String get title => $_getSZ(8);
  @$pb.TagNumber(9)
  set title($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasTitle() => $_has(8);
  @$pb.TagNumber(9)
  void clearTitle() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.String get body => $_getSZ(9);
  @$pb.TagNumber(10)
  set body($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasBody() => $_has(9);
  @$pb.TagNumber(10)
  void clearBody() => $_clearField(10);

  @$pb.TagNumber(11)
  $pb.PbMap<$core.String, $core.String> get metadata => $_getMap(10);

  @$pb.TagNumber(12)
  $core.String get groupKey => $_getSZ(11);
  @$pb.TagNumber(12)
  set groupKey($core.String value) => $_setString(11, value);
  @$pb.TagNumber(12)
  $core.bool hasGroupKey() => $_has(11);
  @$pb.TagNumber(12)
  void clearGroupKey() => $_clearField(12);

  @$pb.TagNumber(13)
  $0.Timestamp get createdAt => $_getN(12);
  @$pb.TagNumber(13)
  set createdAt($0.Timestamp value) => $_setField(13, value);
  @$pb.TagNumber(13)
  $core.bool hasCreatedAt() => $_has(12);
  @$pb.TagNumber(13)
  void clearCreatedAt() => $_clearField(13);
  @$pb.TagNumber(13)
  $0.Timestamp ensureCreatedAt() => $_ensure(12);

  @$pb.TagNumber(14)
  $0.Timestamp get readAt => $_getN(13);
  @$pb.TagNumber(14)
  set readAt($0.Timestamp value) => $_setField(14, value);
  @$pb.TagNumber(14)
  $core.bool hasReadAt() => $_has(13);
  @$pb.TagNumber(14)
  void clearReadAt() => $_clearField(14);
  @$pb.TagNumber(14)
  $0.Timestamp ensureReadAt() => $_ensure(13);
}

/// NotificationGroup represents an aggregated notification group.
class NotificationGroup extends $pb.GeneratedMessage {
  factory NotificationGroup({
    $core.String? groupKey,
    NotificationType? type,
    NotificationCategory? category,
    $core.String? targetType,
    $core.String? targetId,
    $core.String? title,
    $core.String? body,
    $core.int? count,
    $core.Iterable<$core.String>? actorIds,
    Notification? latest,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (groupKey != null) result.groupKey = groupKey;
    if (type != null) result.type = type;
    if (category != null) result.category = category;
    if (targetType != null) result.targetType = targetType;
    if (targetId != null) result.targetId = targetId;
    if (title != null) result.title = title;
    if (body != null) result.body = body;
    if (count != null) result.count = count;
    if (actorIds != null) result.actorIds.addAll(actorIds);
    if (latest != null) result.latest = latest;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  NotificationGroup._();

  factory NotificationGroup.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory NotificationGroup.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'NotificationGroup',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'groupKey')
    ..aE<NotificationType>(2, _omitFieldNames ? '' : 'type',
        enumValues: NotificationType.values)
    ..aE<NotificationCategory>(3, _omitFieldNames ? '' : 'category',
        enumValues: NotificationCategory.values)
    ..aOS(4, _omitFieldNames ? '' : 'targetType')
    ..aOS(5, _omitFieldNames ? '' : 'targetId')
    ..aOS(6, _omitFieldNames ? '' : 'title')
    ..aOS(7, _omitFieldNames ? '' : 'body')
    ..aI(8, _omitFieldNames ? '' : 'count')
    ..pPS(9, _omitFieldNames ? '' : 'actorIds')
    ..aOM<Notification>(10, _omitFieldNames ? '' : 'latest',
        subBuilder: Notification.create)
    ..aOM<$0.Timestamp>(11, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  NotificationGroup clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  NotificationGroup copyWith(void Function(NotificationGroup) updates) =>
      super.copyWith((message) => updates(message as NotificationGroup))
          as NotificationGroup;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static NotificationGroup create() => NotificationGroup._();
  @$core.override
  NotificationGroup createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static NotificationGroup getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<NotificationGroup>(create);
  static NotificationGroup? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get groupKey => $_getSZ(0);
  @$pb.TagNumber(1)
  set groupKey($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGroupKey() => $_has(0);
  @$pb.TagNumber(1)
  void clearGroupKey() => $_clearField(1);

  @$pb.TagNumber(2)
  NotificationType get type => $_getN(1);
  @$pb.TagNumber(2)
  set type(NotificationType value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasType() => $_has(1);
  @$pb.TagNumber(2)
  void clearType() => $_clearField(2);

  @$pb.TagNumber(3)
  NotificationCategory get category => $_getN(2);
  @$pb.TagNumber(3)
  set category(NotificationCategory value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasCategory() => $_has(2);
  @$pb.TagNumber(3)
  void clearCategory() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get targetType => $_getSZ(3);
  @$pb.TagNumber(4)
  set targetType($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasTargetType() => $_has(3);
  @$pb.TagNumber(4)
  void clearTargetType() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get targetId => $_getSZ(4);
  @$pb.TagNumber(5)
  set targetId($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasTargetId() => $_has(4);
  @$pb.TagNumber(5)
  void clearTargetId() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get title => $_getSZ(5);
  @$pb.TagNumber(6)
  set title($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasTitle() => $_has(5);
  @$pb.TagNumber(6)
  void clearTitle() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get body => $_getSZ(6);
  @$pb.TagNumber(7)
  set body($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasBody() => $_has(6);
  @$pb.TagNumber(7)
  void clearBody() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.int get count => $_getIZ(7);
  @$pb.TagNumber(8)
  set count($core.int value) => $_setSignedInt32(7, value);
  @$pb.TagNumber(8)
  $core.bool hasCount() => $_has(7);
  @$pb.TagNumber(8)
  void clearCount() => $_clearField(8);

  @$pb.TagNumber(9)
  $pb.PbList<$core.String> get actorIds => $_getList(8);

  @$pb.TagNumber(10)
  Notification get latest => $_getN(9);
  @$pb.TagNumber(10)
  set latest(Notification value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasLatest() => $_has(9);
  @$pb.TagNumber(10)
  void clearLatest() => $_clearField(10);
  @$pb.TagNumber(10)
  Notification ensureLatest() => $_ensure(9);

  @$pb.TagNumber(11)
  $0.Timestamp get updatedAt => $_getN(10);
  @$pb.TagNumber(11)
  set updatedAt($0.Timestamp value) => $_setField(11, value);
  @$pb.TagNumber(11)
  $core.bool hasUpdatedAt() => $_has(10);
  @$pb.TagNumber(11)
  void clearUpdatedAt() => $_clearField(11);
  @$pb.TagNumber(11)
  $0.Timestamp ensureUpdatedAt() => $_ensure(10);
}

/// NotificationPreference controls notification behavior per category.
/// The type field is reserved for future per-type control granularity.
class NotificationPreference extends $pb.GeneratedMessage {
  factory NotificationPreference({
    $core.String? actorId,
    NotificationCategory? category,
    $core.bool? enabled,
    $core.bool? pushEnabled,
    $core.bool? soundEnabled,
    $0.Timestamp? updatedAt,
    NotificationType? type,
  }) {
    final result = create();
    if (actorId != null) result.actorId = actorId;
    if (category != null) result.category = category;
    if (enabled != null) result.enabled = enabled;
    if (pushEnabled != null) result.pushEnabled = pushEnabled;
    if (soundEnabled != null) result.soundEnabled = soundEnabled;
    if (updatedAt != null) result.updatedAt = updatedAt;
    if (type != null) result.type = type;
    return result;
  }

  NotificationPreference._();

  factory NotificationPreference.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory NotificationPreference.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'NotificationPreference',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'actorId')
    ..aE<NotificationCategory>(2, _omitFieldNames ? '' : 'category',
        enumValues: NotificationCategory.values)
    ..aOB(3, _omitFieldNames ? '' : 'enabled')
    ..aOB(4, _omitFieldNames ? '' : 'pushEnabled')
    ..aOB(5, _omitFieldNames ? '' : 'soundEnabled')
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..aE<NotificationType>(7, _omitFieldNames ? '' : 'type',
        enumValues: NotificationType.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  NotificationPreference clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  NotificationPreference copyWith(
          void Function(NotificationPreference) updates) =>
      super.copyWith((message) => updates(message as NotificationPreference))
          as NotificationPreference;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static NotificationPreference create() => NotificationPreference._();
  @$core.override
  NotificationPreference createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static NotificationPreference getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<NotificationPreference>(create);
  static NotificationPreference? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get actorId => $_getSZ(0);
  @$pb.TagNumber(1)
  set actorId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasActorId() => $_has(0);
  @$pb.TagNumber(1)
  void clearActorId() => $_clearField(1);

  @$pb.TagNumber(2)
  NotificationCategory get category => $_getN(1);
  @$pb.TagNumber(2)
  set category(NotificationCategory value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasCategory() => $_has(1);
  @$pb.TagNumber(2)
  void clearCategory() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.bool get enabled => $_getBF(2);
  @$pb.TagNumber(3)
  set enabled($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasEnabled() => $_has(2);
  @$pb.TagNumber(3)
  void clearEnabled() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.bool get pushEnabled => $_getBF(3);
  @$pb.TagNumber(4)
  set pushEnabled($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasPushEnabled() => $_has(3);
  @$pb.TagNumber(4)
  void clearPushEnabled() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.bool get soundEnabled => $_getBF(4);
  @$pb.TagNumber(5)
  set soundEnabled($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasSoundEnabled() => $_has(4);
  @$pb.TagNumber(5)
  void clearSoundEnabled() => $_clearField(5);

  @$pb.TagNumber(6)
  $0.Timestamp get updatedAt => $_getN(5);
  @$pb.TagNumber(6)
  set updatedAt($0.Timestamp value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasUpdatedAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearUpdatedAt() => $_clearField(6);
  @$pb.TagNumber(6)
  $0.Timestamp ensureUpdatedAt() => $_ensure(5);

  @$pb.TagNumber(7)
  NotificationType get type => $_getN(6);
  @$pb.TagNumber(7)
  set type(NotificationType value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasType() => $_has(6);
  @$pb.TagNumber(7)
  void clearType() => $_clearField(7);
}

class ListNotificationsRequest extends $pb.GeneratedMessage {
  factory ListNotificationsRequest({
    NotificationCategory? category,
    NotificationStatus? status,
    $core.String? cursor,
    $core.int? limit,
  }) {
    final result = create();
    if (category != null) result.category = category;
    if (status != null) result.status = status;
    if (cursor != null) result.cursor = cursor;
    if (limit != null) result.limit = limit;
    return result;
  }

  ListNotificationsRequest._();

  factory ListNotificationsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListNotificationsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListNotificationsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..aE<NotificationCategory>(1, _omitFieldNames ? '' : 'category',
        enumValues: NotificationCategory.values)
    ..aE<NotificationStatus>(2, _omitFieldNames ? '' : 'status',
        enumValues: NotificationStatus.values)
    ..aOS(3, _omitFieldNames ? '' : 'cursor')
    ..aI(4, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListNotificationsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListNotificationsRequest copyWith(
          void Function(ListNotificationsRequest) updates) =>
      super.copyWith((message) => updates(message as ListNotificationsRequest))
          as ListNotificationsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListNotificationsRequest create() => ListNotificationsRequest._();
  @$core.override
  ListNotificationsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListNotificationsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListNotificationsRequest>(create);
  static ListNotificationsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  NotificationCategory get category => $_getN(0);
  @$pb.TagNumber(1)
  set category(NotificationCategory value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasCategory() => $_has(0);
  @$pb.TagNumber(1)
  void clearCategory() => $_clearField(1);

  @$pb.TagNumber(2)
  NotificationStatus get status => $_getN(1);
  @$pb.TagNumber(2)
  set status(NotificationStatus value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasStatus() => $_has(1);
  @$pb.TagNumber(2)
  void clearStatus() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get cursor => $_getSZ(2);
  @$pb.TagNumber(3)
  set cursor($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCursor() => $_has(2);
  @$pb.TagNumber(3)
  void clearCursor() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get limit => $_getIZ(3);
  @$pb.TagNumber(4)
  set limit($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasLimit() => $_has(3);
  @$pb.TagNumber(4)
  void clearLimit() => $_clearField(4);
}

class ListNotificationsResponse extends $pb.GeneratedMessage {
  factory ListNotificationsResponse({
    $core.Iterable<Notification>? notifications,
    $core.String? nextCursor,
    $core.int? totalCount,
    $core.int? unreadCount,
  }) {
    final result = create();
    if (notifications != null) result.notifications.addAll(notifications);
    if (nextCursor != null) result.nextCursor = nextCursor;
    if (totalCount != null) result.totalCount = totalCount;
    if (unreadCount != null) result.unreadCount = unreadCount;
    return result;
  }

  ListNotificationsResponse._();

  factory ListNotificationsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListNotificationsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListNotificationsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..pPM<Notification>(1, _omitFieldNames ? '' : 'notifications',
        subBuilder: Notification.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..aI(3, _omitFieldNames ? '' : 'totalCount')
    ..aI(4, _omitFieldNames ? '' : 'unreadCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListNotificationsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListNotificationsResponse copyWith(
          void Function(ListNotificationsResponse) updates) =>
      super.copyWith((message) => updates(message as ListNotificationsResponse))
          as ListNotificationsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListNotificationsResponse create() => ListNotificationsResponse._();
  @$core.override
  ListNotificationsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListNotificationsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListNotificationsResponse>(create);
  static ListNotificationsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Notification> get notifications => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextCursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextCursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextCursor() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get totalCount => $_getIZ(2);
  @$pb.TagNumber(3)
  set totalCount($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTotalCount() => $_has(2);
  @$pb.TagNumber(3)
  void clearTotalCount() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get unreadCount => $_getIZ(3);
  @$pb.TagNumber(4)
  set unreadCount($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasUnreadCount() => $_has(3);
  @$pb.TagNumber(4)
  void clearUnreadCount() => $_clearField(4);
}

class ListGroupedNotificationsRequest extends $pb.GeneratedMessage {
  factory ListGroupedNotificationsRequest({
    NotificationCategory? category,
    $core.String? cursor,
    $core.int? limit,
  }) {
    final result = create();
    if (category != null) result.category = category;
    if (cursor != null) result.cursor = cursor;
    if (limit != null) result.limit = limit;
    return result;
  }

  ListGroupedNotificationsRequest._();

  factory ListGroupedNotificationsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListGroupedNotificationsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListGroupedNotificationsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..aE<NotificationCategory>(1, _omitFieldNames ? '' : 'category',
        enumValues: NotificationCategory.values)
    ..aOS(2, _omitFieldNames ? '' : 'cursor')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListGroupedNotificationsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListGroupedNotificationsRequest copyWith(
          void Function(ListGroupedNotificationsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListGroupedNotificationsRequest))
          as ListGroupedNotificationsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListGroupedNotificationsRequest create() =>
      ListGroupedNotificationsRequest._();
  @$core.override
  ListGroupedNotificationsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListGroupedNotificationsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListGroupedNotificationsRequest>(
          create);
  static ListGroupedNotificationsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  NotificationCategory get category => $_getN(0);
  @$pb.TagNumber(1)
  set category(NotificationCategory value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasCategory() => $_has(0);
  @$pb.TagNumber(1)
  void clearCategory() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get cursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set cursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearCursor() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);
}

class ListGroupedNotificationsResponse extends $pb.GeneratedMessage {
  factory ListGroupedNotificationsResponse({
    $core.Iterable<NotificationGroup>? groups,
    $core.String? nextCursor,
  }) {
    final result = create();
    if (groups != null) result.groups.addAll(groups);
    if (nextCursor != null) result.nextCursor = nextCursor;
    return result;
  }

  ListGroupedNotificationsResponse._();

  factory ListGroupedNotificationsResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListGroupedNotificationsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListGroupedNotificationsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..pPM<NotificationGroup>(1, _omitFieldNames ? '' : 'groups',
        subBuilder: NotificationGroup.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListGroupedNotificationsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListGroupedNotificationsResponse copyWith(
          void Function(ListGroupedNotificationsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListGroupedNotificationsResponse))
          as ListGroupedNotificationsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListGroupedNotificationsResponse create() =>
      ListGroupedNotificationsResponse._();
  @$core.override
  ListGroupedNotificationsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListGroupedNotificationsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListGroupedNotificationsResponse>(
          create);
  static ListGroupedNotificationsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<NotificationGroup> get groups => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextCursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextCursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextCursor() => $_clearField(2);
}

class MarkNotificationsReadRequest extends $pb.GeneratedMessage {
  factory MarkNotificationsReadRequest({
    $core.Iterable<$core.String>? notificationIds,
  }) {
    final result = create();
    if (notificationIds != null) result.notificationIds.addAll(notificationIds);
    return result;
  }

  MarkNotificationsReadRequest._();

  factory MarkNotificationsReadRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MarkNotificationsReadRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkNotificationsReadRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..pPS(1, _omitFieldNames ? '' : 'notificationIds')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkNotificationsReadRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkNotificationsReadRequest copyWith(
          void Function(MarkNotificationsReadRequest) updates) =>
      super.copyWith(
              (message) => updates(message as MarkNotificationsReadRequest))
          as MarkNotificationsReadRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MarkNotificationsReadRequest create() =>
      MarkNotificationsReadRequest._();
  @$core.override
  MarkNotificationsReadRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MarkNotificationsReadRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkNotificationsReadRequest>(create);
  static MarkNotificationsReadRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$core.String> get notificationIds => $_getList(0);
}

class MarkNotificationsReadResponse extends $pb.GeneratedMessage {
  factory MarkNotificationsReadResponse({
    $core.int? updatedCount,
  }) {
    final result = create();
    if (updatedCount != null) result.updatedCount = updatedCount;
    return result;
  }

  MarkNotificationsReadResponse._();

  factory MarkNotificationsReadResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MarkNotificationsReadResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkNotificationsReadResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'updatedCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkNotificationsReadResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkNotificationsReadResponse copyWith(
          void Function(MarkNotificationsReadResponse) updates) =>
      super.copyWith(
              (message) => updates(message as MarkNotificationsReadResponse))
          as MarkNotificationsReadResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MarkNotificationsReadResponse create() =>
      MarkNotificationsReadResponse._();
  @$core.override
  MarkNotificationsReadResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MarkNotificationsReadResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkNotificationsReadResponse>(create);
  static MarkNotificationsReadResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get updatedCount => $_getIZ(0);
  @$pb.TagNumber(1)
  set updatedCount($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUpdatedCount() => $_has(0);
  @$pb.TagNumber(1)
  void clearUpdatedCount() => $_clearField(1);
}

class MarkAllNotificationsReadRequest extends $pb.GeneratedMessage {
  factory MarkAllNotificationsReadRequest({
    NotificationCategory? category,
  }) {
    final result = create();
    if (category != null) result.category = category;
    return result;
  }

  MarkAllNotificationsReadRequest._();

  factory MarkAllNotificationsReadRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MarkAllNotificationsReadRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkAllNotificationsReadRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..aE<NotificationCategory>(1, _omitFieldNames ? '' : 'category',
        enumValues: NotificationCategory.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAllNotificationsReadRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAllNotificationsReadRequest copyWith(
          void Function(MarkAllNotificationsReadRequest) updates) =>
      super.copyWith(
              (message) => updates(message as MarkAllNotificationsReadRequest))
          as MarkAllNotificationsReadRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MarkAllNotificationsReadRequest create() =>
      MarkAllNotificationsReadRequest._();
  @$core.override
  MarkAllNotificationsReadRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MarkAllNotificationsReadRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkAllNotificationsReadRequest>(
          create);
  static MarkAllNotificationsReadRequest? _defaultInstance;

  @$pb.TagNumber(1)
  NotificationCategory get category => $_getN(0);
  @$pb.TagNumber(1)
  set category(NotificationCategory value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasCategory() => $_has(0);
  @$pb.TagNumber(1)
  void clearCategory() => $_clearField(1);
}

class MarkAllNotificationsReadResponse extends $pb.GeneratedMessage {
  factory MarkAllNotificationsReadResponse({
    $core.int? updatedCount,
  }) {
    final result = create();
    if (updatedCount != null) result.updatedCount = updatedCount;
    return result;
  }

  MarkAllNotificationsReadResponse._();

  factory MarkAllNotificationsReadResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MarkAllNotificationsReadResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkAllNotificationsReadResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'updatedCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAllNotificationsReadResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAllNotificationsReadResponse copyWith(
          void Function(MarkAllNotificationsReadResponse) updates) =>
      super.copyWith(
              (message) => updates(message as MarkAllNotificationsReadResponse))
          as MarkAllNotificationsReadResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MarkAllNotificationsReadResponse create() =>
      MarkAllNotificationsReadResponse._();
  @$core.override
  MarkAllNotificationsReadResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MarkAllNotificationsReadResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkAllNotificationsReadResponse>(
          create);
  static MarkAllNotificationsReadResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get updatedCount => $_getIZ(0);
  @$pb.TagNumber(1)
  set updatedCount($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUpdatedCount() => $_has(0);
  @$pb.TagNumber(1)
  void clearUpdatedCount() => $_clearField(1);
}

class DeleteNotificationsRequest extends $pb.GeneratedMessage {
  factory DeleteNotificationsRequest({
    $core.Iterable<$core.String>? notificationIds,
  }) {
    final result = create();
    if (notificationIds != null) result.notificationIds.addAll(notificationIds);
    return result;
  }

  DeleteNotificationsRequest._();

  factory DeleteNotificationsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory DeleteNotificationsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeleteNotificationsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..pPS(1, _omitFieldNames ? '' : 'notificationIds')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteNotificationsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteNotificationsRequest copyWith(
          void Function(DeleteNotificationsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as DeleteNotificationsRequest))
          as DeleteNotificationsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static DeleteNotificationsRequest create() => DeleteNotificationsRequest._();
  @$core.override
  DeleteNotificationsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static DeleteNotificationsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeleteNotificationsRequest>(create);
  static DeleteNotificationsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$core.String> get notificationIds => $_getList(0);
}

class DeleteNotificationsResponse extends $pb.GeneratedMessage {
  factory DeleteNotificationsResponse({
    $core.int? deletedCount,
  }) {
    final result = create();
    if (deletedCount != null) result.deletedCount = deletedCount;
    return result;
  }

  DeleteNotificationsResponse._();

  factory DeleteNotificationsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory DeleteNotificationsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeleteNotificationsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'deletedCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteNotificationsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteNotificationsResponse copyWith(
          void Function(DeleteNotificationsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as DeleteNotificationsResponse))
          as DeleteNotificationsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static DeleteNotificationsResponse create() =>
      DeleteNotificationsResponse._();
  @$core.override
  DeleteNotificationsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static DeleteNotificationsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeleteNotificationsResponse>(create);
  static DeleteNotificationsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get deletedCount => $_getIZ(0);
  @$pb.TagNumber(1)
  set deletedCount($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasDeletedCount() => $_has(0);
  @$pb.TagNumber(1)
  void clearDeletedCount() => $_clearField(1);
}

class GetUnreadCountsRequest extends $pb.GeneratedMessage {
  factory GetUnreadCountsRequest() => create();

  GetUnreadCountsRequest._();

  factory GetUnreadCountsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUnreadCountsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUnreadCountsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUnreadCountsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUnreadCountsRequest copyWith(
          void Function(GetUnreadCountsRequest) updates) =>
      super.copyWith((message) => updates(message as GetUnreadCountsRequest))
          as GetUnreadCountsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUnreadCountsRequest create() => GetUnreadCountsRequest._();
  @$core.override
  GetUnreadCountsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUnreadCountsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUnreadCountsRequest>(create);
  static GetUnreadCountsRequest? _defaultInstance;
}

class GetUnreadCountsResponse extends $pb.GeneratedMessage {
  factory GetUnreadCountsResponse({
    $core.int? total,
    $core.Iterable<$core.MapEntry<$core.int, $core.int>>? byCategory,
  }) {
    final result = create();
    if (total != null) result.total = total;
    if (byCategory != null) result.byCategory.addEntries(byCategory);
    return result;
  }

  GetUnreadCountsResponse._();

  factory GetUnreadCountsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUnreadCountsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUnreadCountsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'total')
    ..m<$core.int, $core.int>(2, _omitFieldNames ? '' : 'byCategory',
        entryClassName: 'GetUnreadCountsResponse.ByCategoryEntry',
        keyFieldType: $pb.PbFieldType.O3,
        valueFieldType: $pb.PbFieldType.O3,
        packageName: const $pb.PackageName('peers_touch.model.notification.v1'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUnreadCountsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUnreadCountsResponse copyWith(
          void Function(GetUnreadCountsResponse) updates) =>
      super.copyWith((message) => updates(message as GetUnreadCountsResponse))
          as GetUnreadCountsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUnreadCountsResponse create() => GetUnreadCountsResponse._();
  @$core.override
  GetUnreadCountsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUnreadCountsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUnreadCountsResponse>(create);
  static GetUnreadCountsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get total => $_getIZ(0);
  @$pb.TagNumber(1)
  set total($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTotal() => $_has(0);
  @$pb.TagNumber(1)
  void clearTotal() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbMap<$core.int, $core.int> get byCategory => $_getMap(1);
}

class GetNotificationPreferencesRequest extends $pb.GeneratedMessage {
  factory GetNotificationPreferencesRequest() => create();

  GetNotificationPreferencesRequest._();

  factory GetNotificationPreferencesRequest.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetNotificationPreferencesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetNotificationPreferencesRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetNotificationPreferencesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetNotificationPreferencesRequest copyWith(
          void Function(GetNotificationPreferencesRequest) updates) =>
      super.copyWith((message) =>
              updates(message as GetNotificationPreferencesRequest))
          as GetNotificationPreferencesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetNotificationPreferencesRequest create() =>
      GetNotificationPreferencesRequest._();
  @$core.override
  GetNotificationPreferencesRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetNotificationPreferencesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetNotificationPreferencesRequest>(
          create);
  static GetNotificationPreferencesRequest? _defaultInstance;
}

class GetNotificationPreferencesResponse extends $pb.GeneratedMessage {
  factory GetNotificationPreferencesResponse({
    $core.Iterable<NotificationPreference>? preferences,
  }) {
    final result = create();
    if (preferences != null) result.preferences.addAll(preferences);
    return result;
  }

  GetNotificationPreferencesResponse._();

  factory GetNotificationPreferencesResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetNotificationPreferencesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetNotificationPreferencesResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..pPM<NotificationPreference>(1, _omitFieldNames ? '' : 'preferences',
        subBuilder: NotificationPreference.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetNotificationPreferencesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetNotificationPreferencesResponse copyWith(
          void Function(GetNotificationPreferencesResponse) updates) =>
      super.copyWith((message) =>
              updates(message as GetNotificationPreferencesResponse))
          as GetNotificationPreferencesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetNotificationPreferencesResponse create() =>
      GetNotificationPreferencesResponse._();
  @$core.override
  GetNotificationPreferencesResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetNotificationPreferencesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetNotificationPreferencesResponse>(
          create);
  static GetNotificationPreferencesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<NotificationPreference> get preferences => $_getList(0);
}

class UpdateNotificationPreferenceRequest extends $pb.GeneratedMessage {
  factory UpdateNotificationPreferenceRequest({
    NotificationCategory? category,
    $core.bool? enabled,
    $core.bool? pushEnabled,
    $core.bool? soundEnabled,
  }) {
    final result = create();
    if (category != null) result.category = category;
    if (enabled != null) result.enabled = enabled;
    if (pushEnabled != null) result.pushEnabled = pushEnabled;
    if (soundEnabled != null) result.soundEnabled = soundEnabled;
    return result;
  }

  UpdateNotificationPreferenceRequest._();

  factory UpdateNotificationPreferenceRequest.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateNotificationPreferenceRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateNotificationPreferenceRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..aE<NotificationCategory>(1, _omitFieldNames ? '' : 'category',
        enumValues: NotificationCategory.values)
    ..aOB(2, _omitFieldNames ? '' : 'enabled')
    ..aOB(3, _omitFieldNames ? '' : 'pushEnabled')
    ..aOB(4, _omitFieldNames ? '' : 'soundEnabled')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateNotificationPreferenceRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateNotificationPreferenceRequest copyWith(
          void Function(UpdateNotificationPreferenceRequest) updates) =>
      super.copyWith((message) =>
              updates(message as UpdateNotificationPreferenceRequest))
          as UpdateNotificationPreferenceRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateNotificationPreferenceRequest create() =>
      UpdateNotificationPreferenceRequest._();
  @$core.override
  UpdateNotificationPreferenceRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateNotificationPreferenceRequest getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<
          UpdateNotificationPreferenceRequest>(create);
  static UpdateNotificationPreferenceRequest? _defaultInstance;

  @$pb.TagNumber(1)
  NotificationCategory get category => $_getN(0);
  @$pb.TagNumber(1)
  set category(NotificationCategory value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasCategory() => $_has(0);
  @$pb.TagNumber(1)
  void clearCategory() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.bool get enabled => $_getBF(1);
  @$pb.TagNumber(2)
  set enabled($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEnabled() => $_has(1);
  @$pb.TagNumber(2)
  void clearEnabled() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.bool get pushEnabled => $_getBF(2);
  @$pb.TagNumber(3)
  set pushEnabled($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPushEnabled() => $_has(2);
  @$pb.TagNumber(3)
  void clearPushEnabled() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.bool get soundEnabled => $_getBF(3);
  @$pb.TagNumber(4)
  set soundEnabled($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasSoundEnabled() => $_has(3);
  @$pb.TagNumber(4)
  void clearSoundEnabled() => $_clearField(4);
}

class UpdateNotificationPreferenceResponse extends $pb.GeneratedMessage {
  factory UpdateNotificationPreferenceResponse({
    NotificationPreference? preference,
  }) {
    final result = create();
    if (preference != null) result.preference = preference;
    return result;
  }

  UpdateNotificationPreferenceResponse._();

  factory UpdateNotificationPreferenceResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateNotificationPreferenceResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateNotificationPreferenceResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.notification.v1'),
      createEmptyInstance: create)
    ..aOM<NotificationPreference>(1, _omitFieldNames ? '' : 'preference',
        subBuilder: NotificationPreference.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateNotificationPreferenceResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateNotificationPreferenceResponse copyWith(
          void Function(UpdateNotificationPreferenceResponse) updates) =>
      super.copyWith((message) =>
              updates(message as UpdateNotificationPreferenceResponse))
          as UpdateNotificationPreferenceResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateNotificationPreferenceResponse create() =>
      UpdateNotificationPreferenceResponse._();
  @$core.override
  UpdateNotificationPreferenceResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateNotificationPreferenceResponse getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<
          UpdateNotificationPreferenceResponse>(create);
  static UpdateNotificationPreferenceResponse? _defaultInstance;

  @$pb.TagNumber(1)
  NotificationPreference get preference => $_getN(0);
  @$pb.TagNumber(1)
  set preference(NotificationPreference value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPreference() => $_has(0);
  @$pb.TagNumber(1)
  void clearPreference() => $_clearField(1);
  @$pb.TagNumber(1)
  NotificationPreference ensurePreference() => $_ensure(0);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
