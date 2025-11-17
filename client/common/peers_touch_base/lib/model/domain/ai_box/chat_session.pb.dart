// This is a generated file - do not edit.
//
// Generated from domain/ai_box/chat_session.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class ChatSession extends $pb.GeneratedMessage {
  factory ChatSession({
    $core.String? id,
    $core.String? title,
    $core.String? description,
    $core.String? avatar,
    $core.String? backgroundColor,
    $core.String? providerId,
    $core.String? userId,
    $core.String? modelName,
    $core.bool? pinned,
    $core.String? group,
    $fixnum.Int64? createdAt,
    $fixnum.Int64? updatedAt,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? meta,
    $core.String? configJson,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (title != null) result.title = title;
    if (description != null) result.description = description;
    if (avatar != null) result.avatar = avatar;
    if (backgroundColor != null) result.backgroundColor = backgroundColor;
    if (providerId != null) result.providerId = providerId;
    if (userId != null) result.userId = userId;
    if (modelName != null) result.modelName = modelName;
    if (pinned != null) result.pinned = pinned;
    if (group != null) result.group = group;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    if (meta != null) result.meta.addEntries(meta);
    if (configJson != null) result.configJson = configJson;
    return result;
  }

  ChatSession._();

  factory ChatSession.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ChatSession.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ChatSession',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'title')
    ..aOS(3, _omitFieldNames ? '' : 'description')
    ..aOS(4, _omitFieldNames ? '' : 'avatar')
    ..aOS(5, _omitFieldNames ? '' : 'backgroundColor')
    ..aOS(6, _omitFieldNames ? '' : 'providerId')
    ..aOS(7, _omitFieldNames ? '' : 'userId')
    ..aOS(8, _omitFieldNames ? '' : 'modelName')
    ..aOB(9, _omitFieldNames ? '' : 'pinned')
    ..aOS(10, _omitFieldNames ? '' : 'group')
    ..aInt64(11, _omitFieldNames ? '' : 'createdAt')
    ..aInt64(12, _omitFieldNames ? '' : 'updatedAt')
    ..m<$core.String, $core.String>(13, _omitFieldNames ? '' : 'meta',
        entryClassName: 'ChatSession.MetaEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.model.ai_box.v1'))
    ..aOS(14, _omitFieldNames ? '' : 'configJson')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChatSession clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChatSession copyWith(void Function(ChatSession) updates) =>
      super.copyWith((message) => updates(message as ChatSession))
          as ChatSession;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ChatSession create() => ChatSession._();
  @$core.override
  ChatSession createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ChatSession getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ChatSession>(create);
  static ChatSession? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get title => $_getSZ(1);
  @$pb.TagNumber(2)
  set title($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTitle() => $_has(1);
  @$pb.TagNumber(2)
  void clearTitle() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get description => $_getSZ(2);
  @$pb.TagNumber(3)
  set description($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDescription() => $_has(2);
  @$pb.TagNumber(3)
  void clearDescription() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get avatar => $_getSZ(3);
  @$pb.TagNumber(4)
  set avatar($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasAvatar() => $_has(3);
  @$pb.TagNumber(4)
  void clearAvatar() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get backgroundColor => $_getSZ(4);
  @$pb.TagNumber(5)
  set backgroundColor($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasBackgroundColor() => $_has(4);
  @$pb.TagNumber(5)
  void clearBackgroundColor() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get providerId => $_getSZ(5);
  @$pb.TagNumber(6)
  set providerId($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasProviderId() => $_has(5);
  @$pb.TagNumber(6)
  void clearProviderId() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get userId => $_getSZ(6);
  @$pb.TagNumber(7)
  set userId($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasUserId() => $_has(6);
  @$pb.TagNumber(7)
  void clearUserId() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get modelName => $_getSZ(7);
  @$pb.TagNumber(8)
  set modelName($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasModelName() => $_has(7);
  @$pb.TagNumber(8)
  void clearModelName() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.bool get pinned => $_getBF(8);
  @$pb.TagNumber(9)
  set pinned($core.bool value) => $_setBool(8, value);
  @$pb.TagNumber(9)
  $core.bool hasPinned() => $_has(8);
  @$pb.TagNumber(9)
  void clearPinned() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.String get group => $_getSZ(9);
  @$pb.TagNumber(10)
  set group($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasGroup() => $_has(9);
  @$pb.TagNumber(10)
  void clearGroup() => $_clearField(10);

  @$pb.TagNumber(11)
  $fixnum.Int64 get createdAt => $_getI64(10);
  @$pb.TagNumber(11)
  set createdAt($fixnum.Int64 value) => $_setInt64(10, value);
  @$pb.TagNumber(11)
  $core.bool hasCreatedAt() => $_has(10);
  @$pb.TagNumber(11)
  void clearCreatedAt() => $_clearField(11);

  @$pb.TagNumber(12)
  $fixnum.Int64 get updatedAt => $_getI64(11);
  @$pb.TagNumber(12)
  set updatedAt($fixnum.Int64 value) => $_setInt64(11, value);
  @$pb.TagNumber(12)
  $core.bool hasUpdatedAt() => $_has(11);
  @$pb.TagNumber(12)
  void clearUpdatedAt() => $_clearField(12);

  @$pb.TagNumber(13)
  $pb.PbMap<$core.String, $core.String> get meta => $_getMap(12);

  @$pb.TagNumber(14)
  $core.String get configJson => $_getSZ(13);
  @$pb.TagNumber(14)
  set configJson($core.String value) => $_setString(13, value);
  @$pb.TagNumber(14)
  $core.bool hasConfigJson() => $_has(13);
  @$pb.TagNumber(14)
  void clearConfigJson() => $_clearField(14);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
