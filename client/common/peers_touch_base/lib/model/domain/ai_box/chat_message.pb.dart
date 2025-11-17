// This is a generated file - do not edit.
//
// Generated from domain/ai_box/chat_message.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

import 'message_attachment.pb.dart' as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class ChatMessage extends $pb.GeneratedMessage {
  factory ChatMessage({
    $core.String? id,
    $core.String? sessionId,
    $core.String? topicId,
    $core.String? modelName,
    $core.String? role,
    $core.String? content,
    $core.String? errorJson,
    $core.Iterable<$0.MessageAttachment>? attachments,
    $core.String? imagesJson,
    $core.String? metadataJson,
    $core.String? pluginJson,
    $core.String? toolCallsJson,
    $core.String? reasoningJson,
    $fixnum.Int64? createdAt,
    $fixnum.Int64? updatedAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (sessionId != null) result.sessionId = sessionId;
    if (topicId != null) result.topicId = topicId;
    if (modelName != null) result.modelName = modelName;
    if (role != null) result.role = role;
    if (content != null) result.content = content;
    if (errorJson != null) result.errorJson = errorJson;
    if (attachments != null) result.attachments.addAll(attachments);
    if (imagesJson != null) result.imagesJson = imagesJson;
    if (metadataJson != null) result.metadataJson = metadataJson;
    if (pluginJson != null) result.pluginJson = pluginJson;
    if (toolCallsJson != null) result.toolCallsJson = toolCallsJson;
    if (reasoningJson != null) result.reasoningJson = reasoningJson;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  ChatMessage._();

  factory ChatMessage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ChatMessage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ChatMessage',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'sessionId')
    ..aOS(3, _omitFieldNames ? '' : 'topicId')
    ..aOS(4, _omitFieldNames ? '' : 'modelName')
    ..aOS(5, _omitFieldNames ? '' : 'role')
    ..aOS(6, _omitFieldNames ? '' : 'content')
    ..aOS(7, _omitFieldNames ? '' : 'errorJson')
    ..pPM<$0.MessageAttachment>(8, _omitFieldNames ? '' : 'attachments',
        subBuilder: $0.MessageAttachment.create)
    ..aOS(9, _omitFieldNames ? '' : 'imagesJson')
    ..aOS(10, _omitFieldNames ? '' : 'metadataJson')
    ..aOS(11, _omitFieldNames ? '' : 'pluginJson')
    ..aOS(12, _omitFieldNames ? '' : 'toolCallsJson')
    ..aOS(13, _omitFieldNames ? '' : 'reasoningJson')
    ..aInt64(14, _omitFieldNames ? '' : 'createdAt')
    ..aInt64(15, _omitFieldNames ? '' : 'updatedAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChatMessage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChatMessage copyWith(void Function(ChatMessage) updates) =>
      super.copyWith((message) => updates(message as ChatMessage))
          as ChatMessage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ChatMessage create() => ChatMessage._();
  @$core.override
  ChatMessage createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ChatMessage getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ChatMessage>(create);
  static ChatMessage? _defaultInstance;

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
  $core.String get topicId => $_getSZ(2);
  @$pb.TagNumber(3)
  set topicId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTopicId() => $_has(2);
  @$pb.TagNumber(3)
  void clearTopicId() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get modelName => $_getSZ(3);
  @$pb.TagNumber(4)
  set modelName($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasModelName() => $_has(3);
  @$pb.TagNumber(4)
  void clearModelName() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get role => $_getSZ(4);
  @$pb.TagNumber(5)
  set role($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasRole() => $_has(4);
  @$pb.TagNumber(5)
  void clearRole() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get content => $_getSZ(5);
  @$pb.TagNumber(6)
  set content($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasContent() => $_has(5);
  @$pb.TagNumber(6)
  void clearContent() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get errorJson => $_getSZ(6);
  @$pb.TagNumber(7)
  set errorJson($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasErrorJson() => $_has(6);
  @$pb.TagNumber(7)
  void clearErrorJson() => $_clearField(7);

  @$pb.TagNumber(8)
  $pb.PbList<$0.MessageAttachment> get attachments => $_getList(7);

  @$pb.TagNumber(9)
  $core.String get imagesJson => $_getSZ(8);
  @$pb.TagNumber(9)
  set imagesJson($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasImagesJson() => $_has(8);
  @$pb.TagNumber(9)
  void clearImagesJson() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.String get metadataJson => $_getSZ(9);
  @$pb.TagNumber(10)
  set metadataJson($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasMetadataJson() => $_has(9);
  @$pb.TagNumber(10)
  void clearMetadataJson() => $_clearField(10);

  @$pb.TagNumber(11)
  $core.String get pluginJson => $_getSZ(10);
  @$pb.TagNumber(11)
  set pluginJson($core.String value) => $_setString(10, value);
  @$pb.TagNumber(11)
  $core.bool hasPluginJson() => $_has(10);
  @$pb.TagNumber(11)
  void clearPluginJson() => $_clearField(11);

  @$pb.TagNumber(12)
  $core.String get toolCallsJson => $_getSZ(11);
  @$pb.TagNumber(12)
  set toolCallsJson($core.String value) => $_setString(11, value);
  @$pb.TagNumber(12)
  $core.bool hasToolCallsJson() => $_has(11);
  @$pb.TagNumber(12)
  void clearToolCallsJson() => $_clearField(12);

  @$pb.TagNumber(13)
  $core.String get reasoningJson => $_getSZ(12);
  @$pb.TagNumber(13)
  set reasoningJson($core.String value) => $_setString(12, value);
  @$pb.TagNumber(13)
  $core.bool hasReasoningJson() => $_has(12);
  @$pb.TagNumber(13)
  void clearReasoningJson() => $_clearField(13);

  @$pb.TagNumber(14)
  $fixnum.Int64 get createdAt => $_getI64(13);
  @$pb.TagNumber(14)
  set createdAt($fixnum.Int64 value) => $_setInt64(13, value);
  @$pb.TagNumber(14)
  $core.bool hasCreatedAt() => $_has(13);
  @$pb.TagNumber(14)
  void clearCreatedAt() => $_clearField(14);

  @$pb.TagNumber(15)
  $fixnum.Int64 get updatedAt => $_getI64(14);
  @$pb.TagNumber(15)
  set updatedAt($fixnum.Int64 value) => $_setInt64(14, value);
  @$pb.TagNumber(15)
  $core.bool hasUpdatedAt() => $_has(14);
  @$pb.TagNumber(15)
  void clearUpdatedAt() => $_clearField(15);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
