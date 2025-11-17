// This is a generated file - do not edit.
//
// Generated from domain/ai_box/chat_topic.proto.

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

class ChatTopic extends $pb.GeneratedMessage {
  factory ChatTopic({
    $core.String? id,
    $core.String? sessionId,
    $core.String? title,
    $core.String? description,
    $core.int? messageCount,
    $core.String? firstMessageId,
    $core.String? lastMessageId,
    $fixnum.Int64? createdAt,
    $fixnum.Int64? updatedAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (sessionId != null) result.sessionId = sessionId;
    if (title != null) result.title = title;
    if (description != null) result.description = description;
    if (messageCount != null) result.messageCount = messageCount;
    if (firstMessageId != null) result.firstMessageId = firstMessageId;
    if (lastMessageId != null) result.lastMessageId = lastMessageId;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  ChatTopic._();

  factory ChatTopic.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ChatTopic.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ChatTopic',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'sessionId')
    ..aOS(3, _omitFieldNames ? '' : 'title')
    ..aOS(4, _omitFieldNames ? '' : 'description')
    ..aI(5, _omitFieldNames ? '' : 'messageCount')
    ..aOS(6, _omitFieldNames ? '' : 'firstMessageId')
    ..aOS(7, _omitFieldNames ? '' : 'lastMessageId')
    ..aInt64(8, _omitFieldNames ? '' : 'createdAt')
    ..aInt64(9, _omitFieldNames ? '' : 'updatedAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChatTopic clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChatTopic copyWith(void Function(ChatTopic) updates) =>
      super.copyWith((message) => updates(message as ChatTopic)) as ChatTopic;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ChatTopic create() => ChatTopic._();
  @$core.override
  ChatTopic createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ChatTopic getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<ChatTopic>(create);
  static ChatTopic? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get sessionId => $_getSZ(1);
  @$pb.TagNumber(2)
  set sessionId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSessionId() => $_has(1);
  @$pb.TagNumber(2)
  void clearSessionId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get title => $_getSZ(2);
  @$pb.TagNumber(3)
  set title($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTitle() => $_has(2);
  @$pb.TagNumber(3)
  void clearTitle() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get description => $_getSZ(3);
  @$pb.TagNumber(4)
  set description($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasDescription() => $_has(3);
  @$pb.TagNumber(4)
  void clearDescription() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.int get messageCount => $_getIZ(4);
  @$pb.TagNumber(5)
  set messageCount($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasMessageCount() => $_has(4);
  @$pb.TagNumber(5)
  void clearMessageCount() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get firstMessageId => $_getSZ(5);
  @$pb.TagNumber(6)
  set firstMessageId($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasFirstMessageId() => $_has(5);
  @$pb.TagNumber(6)
  void clearFirstMessageId() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get lastMessageId => $_getSZ(6);
  @$pb.TagNumber(7)
  set lastMessageId($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasLastMessageId() => $_has(6);
  @$pb.TagNumber(7)
  void clearLastMessageId() => $_clearField(7);

  @$pb.TagNumber(8)
  $fixnum.Int64 get createdAt => $_getI64(7);
  @$pb.TagNumber(8)
  set createdAt($fixnum.Int64 value) => $_setInt64(7, value);
  @$pb.TagNumber(8)
  $core.bool hasCreatedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearCreatedAt() => $_clearField(8);

  @$pb.TagNumber(9)
  $fixnum.Int64 get updatedAt => $_getI64(8);
  @$pb.TagNumber(9)
  set updatedAt($fixnum.Int64 value) => $_setInt64(8, value);
  @$pb.TagNumber(9)
  $core.bool hasUpdatedAt() => $_has(8);
  @$pb.TagNumber(9)
  void clearUpdatedAt() => $_clearField(9);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
