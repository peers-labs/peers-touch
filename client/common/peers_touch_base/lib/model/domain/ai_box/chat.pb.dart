// This is a generated file - do not edit.
//
// Generated from domain/ai_box/chat.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;
import 'package:protobuf/well_known_types/google/protobuf/struct.pb.dart' as $0;

import 'chat.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'chat.pbenum.dart';

/// 聊天会话
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

/// 消息附件
class MessageAttachment extends $pb.GeneratedMessage {
  factory MessageAttachment({
    $core.String? id,
    $core.String? messageId,
    $core.String? name,
    $fixnum.Int64? size,
    $core.String? type,
    $core.String? url,
    $core.String? metadataJson,
    $fixnum.Int64? createdAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (messageId != null) result.messageId = messageId;
    if (name != null) result.name = name;
    if (size != null) result.size = size;
    if (type != null) result.type = type;
    if (url != null) result.url = url;
    if (metadataJson != null) result.metadataJson = metadataJson;
    if (createdAt != null) result.createdAt = createdAt;
    return result;
  }

  MessageAttachment._();

  factory MessageAttachment.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MessageAttachment.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MessageAttachment',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'messageId')
    ..aOS(3, _omitFieldNames ? '' : 'name')
    ..aInt64(4, _omitFieldNames ? '' : 'size')
    ..aOS(5, _omitFieldNames ? '' : 'type')
    ..aOS(6, _omitFieldNames ? '' : 'url')
    ..aOS(7, _omitFieldNames ? '' : 'metadataJson')
    ..aInt64(8, _omitFieldNames ? '' : 'createdAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MessageAttachment clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MessageAttachment copyWith(void Function(MessageAttachment) updates) =>
      super.copyWith((message) => updates(message as MessageAttachment))
          as MessageAttachment;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MessageAttachment create() => MessageAttachment._();
  @$core.override
  MessageAttachment createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MessageAttachment getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MessageAttachment>(create);
  static MessageAttachment? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get messageId => $_getSZ(1);
  @$pb.TagNumber(2)
  set messageId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasMessageId() => $_has(1);
  @$pb.TagNumber(2)
  void clearMessageId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get name => $_getSZ(2);
  @$pb.TagNumber(3)
  set name($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasName() => $_has(2);
  @$pb.TagNumber(3)
  void clearName() => $_clearField(3);

  @$pb.TagNumber(4)
  $fixnum.Int64 get size => $_getI64(3);
  @$pb.TagNumber(4)
  set size($fixnum.Int64 value) => $_setInt64(3, value);
  @$pb.TagNumber(4)
  $core.bool hasSize() => $_has(3);
  @$pb.TagNumber(4)
  void clearSize() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get type => $_getSZ(4);
  @$pb.TagNumber(5)
  set type($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasType() => $_has(4);
  @$pb.TagNumber(5)
  void clearType() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get url => $_getSZ(5);
  @$pb.TagNumber(6)
  set url($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasUrl() => $_has(5);
  @$pb.TagNumber(6)
  void clearUrl() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get metadataJson => $_getSZ(6);
  @$pb.TagNumber(7)
  set metadataJson($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasMetadataJson() => $_has(6);
  @$pb.TagNumber(7)
  void clearMetadataJson() => $_clearField(7);

  @$pb.TagNumber(8)
  $fixnum.Int64 get createdAt => $_getI64(7);
  @$pb.TagNumber(8)
  set createdAt($fixnum.Int64 value) => $_setInt64(7, value);
  @$pb.TagNumber(8)
  $core.bool hasCreatedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearCreatedAt() => $_clearField(8);
}

/// 聊天消息
class ChatMessage extends $pb.GeneratedMessage {
  factory ChatMessage({
    $core.String? id,
    $core.String? sessionId,
    $core.String? topicId,
    $core.String? modelName,
    ChatRole? role,
    $core.String? content,
    $core.String? errorJson,
    $core.Iterable<MessageAttachment>? attachments,
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
    ..aE<ChatRole>(5, _omitFieldNames ? '' : 'role',
        enumValues: ChatRole.values)
    ..aOS(6, _omitFieldNames ? '' : 'content')
    ..aOS(7, _omitFieldNames ? '' : 'errorJson')
    ..pPM<MessageAttachment>(8, _omitFieldNames ? '' : 'attachments',
        subBuilder: MessageAttachment.create)
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
  ChatRole get role => $_getN(4);
  @$pb.TagNumber(5)
  set role(ChatRole value) => $_setField(5, value);
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
  $pb.PbList<MessageAttachment> get attachments => $_getList(7);

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

/// 聊天主题
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

/// 工具调用类
class ToolCall extends $pb.GeneratedMessage {
  factory ToolCall({
    $core.String? id,
    $core.String? type,
    $0.Struct? function,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (type != null) result.type = type;
    if (function != null) result.function = function;
    return result;
  }

  ToolCall._();

  factory ToolCall.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ToolCall.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ToolCall',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'type')
    ..aOM<$0.Struct>(3, _omitFieldNames ? '' : 'function',
        subBuilder: $0.Struct.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ToolCall clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ToolCall copyWith(void Function(ToolCall) updates) =>
      super.copyWith((message) => updates(message as ToolCall)) as ToolCall;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ToolCall create() => ToolCall._();
  @$core.override
  ToolCall createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ToolCall getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<ToolCall>(create);
  static ToolCall? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get type => $_getSZ(1);
  @$pb.TagNumber(2)
  set type($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasType() => $_has(1);
  @$pb.TagNumber(2)
  void clearType() => $_clearField(2);

  @$pb.TagNumber(3)
  $0.Struct get function => $_getN(2);
  @$pb.TagNumber(3)
  set function($0.Struct value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasFunction() => $_has(2);
  @$pb.TagNumber(3)
  void clearFunction() => $_clearField(3);
  @$pb.TagNumber(3)
  $0.Struct ensureFunction() => $_ensure(2);
}

/// 聊天完成请求
class ChatCompletionRequest extends $pb.GeneratedMessage {
  factory ChatCompletionRequest({
    $core.String? model,
    $core.Iterable<ChatMessage>? messages,
    $core.double? temperature,
    $core.int? maxTokens,
    $core.double? topP,
    $core.int? n,
    $core.bool? stream,
    $core.Iterable<$core.String>? stop,
    $core.double? presencePenalty,
    $core.double? frequencyPenalty,
    $0.Struct? logitBias,
    $core.String? user,
  }) {
    final result = create();
    if (model != null) result.model = model;
    if (messages != null) result.messages.addAll(messages);
    if (temperature != null) result.temperature = temperature;
    if (maxTokens != null) result.maxTokens = maxTokens;
    if (topP != null) result.topP = topP;
    if (n != null) result.n = n;
    if (stream != null) result.stream = stream;
    if (stop != null) result.stop.addAll(stop);
    if (presencePenalty != null) result.presencePenalty = presencePenalty;
    if (frequencyPenalty != null) result.frequencyPenalty = frequencyPenalty;
    if (logitBias != null) result.logitBias = logitBias;
    if (user != null) result.user = user;
    return result;
  }

  ChatCompletionRequest._();

  factory ChatCompletionRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ChatCompletionRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ChatCompletionRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'model')
    ..pPM<ChatMessage>(2, _omitFieldNames ? '' : 'messages',
        subBuilder: ChatMessage.create)
    ..aD(3, _omitFieldNames ? '' : 'temperature')
    ..aI(4, _omitFieldNames ? '' : 'maxTokens')
    ..aD(5, _omitFieldNames ? '' : 'topP')
    ..aI(6, _omitFieldNames ? '' : 'n')
    ..aOB(7, _omitFieldNames ? '' : 'stream')
    ..pPS(8, _omitFieldNames ? '' : 'stop')
    ..aD(9, _omitFieldNames ? '' : 'presencePenalty')
    ..aD(10, _omitFieldNames ? '' : 'frequencyPenalty')
    ..aOM<$0.Struct>(11, _omitFieldNames ? '' : 'logitBias',
        subBuilder: $0.Struct.create)
    ..aOS(12, _omitFieldNames ? '' : 'user')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChatCompletionRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChatCompletionRequest copyWith(
          void Function(ChatCompletionRequest) updates) =>
      super.copyWith((message) => updates(message as ChatCompletionRequest))
          as ChatCompletionRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ChatCompletionRequest create() => ChatCompletionRequest._();
  @$core.override
  ChatCompletionRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ChatCompletionRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ChatCompletionRequest>(create);
  static ChatCompletionRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get model => $_getSZ(0);
  @$pb.TagNumber(1)
  set model($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasModel() => $_has(0);
  @$pb.TagNumber(1)
  void clearModel() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<ChatMessage> get messages => $_getList(1);

  @$pb.TagNumber(3)
  $core.double get temperature => $_getN(2);
  @$pb.TagNumber(3)
  set temperature($core.double value) => $_setDouble(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTemperature() => $_has(2);
  @$pb.TagNumber(3)
  void clearTemperature() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get maxTokens => $_getIZ(3);
  @$pb.TagNumber(4)
  set maxTokens($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasMaxTokens() => $_has(3);
  @$pb.TagNumber(4)
  void clearMaxTokens() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.double get topP => $_getN(4);
  @$pb.TagNumber(5)
  set topP($core.double value) => $_setDouble(4, value);
  @$pb.TagNumber(5)
  $core.bool hasTopP() => $_has(4);
  @$pb.TagNumber(5)
  void clearTopP() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.int get n => $_getIZ(5);
  @$pb.TagNumber(6)
  set n($core.int value) => $_setSignedInt32(5, value);
  @$pb.TagNumber(6)
  $core.bool hasN() => $_has(5);
  @$pb.TagNumber(6)
  void clearN() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.bool get stream => $_getBF(6);
  @$pb.TagNumber(7)
  set stream($core.bool value) => $_setBool(6, value);
  @$pb.TagNumber(7)
  $core.bool hasStream() => $_has(6);
  @$pb.TagNumber(7)
  void clearStream() => $_clearField(7);

  @$pb.TagNumber(8)
  $pb.PbList<$core.String> get stop => $_getList(7);

  @$pb.TagNumber(9)
  $core.double get presencePenalty => $_getN(8);
  @$pb.TagNumber(9)
  set presencePenalty($core.double value) => $_setDouble(8, value);
  @$pb.TagNumber(9)
  $core.bool hasPresencePenalty() => $_has(8);
  @$pb.TagNumber(9)
  void clearPresencePenalty() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.double get frequencyPenalty => $_getN(9);
  @$pb.TagNumber(10)
  set frequencyPenalty($core.double value) => $_setDouble(9, value);
  @$pb.TagNumber(10)
  $core.bool hasFrequencyPenalty() => $_has(9);
  @$pb.TagNumber(10)
  void clearFrequencyPenalty() => $_clearField(10);

  @$pb.TagNumber(11)
  $0.Struct get logitBias => $_getN(10);
  @$pb.TagNumber(11)
  set logitBias($0.Struct value) => $_setField(11, value);
  @$pb.TagNumber(11)
  $core.bool hasLogitBias() => $_has(10);
  @$pb.TagNumber(11)
  void clearLogitBias() => $_clearField(11);
  @$pb.TagNumber(11)
  $0.Struct ensureLogitBias() => $_ensure(10);

  @$pb.TagNumber(12)
  $core.String get user => $_getSZ(11);
  @$pb.TagNumber(12)
  set user($core.String value) => $_setString(11, value);
  @$pb.TagNumber(12)
  $core.bool hasUser() => $_has(11);
  @$pb.TagNumber(12)
  void clearUser() => $_clearField(12);
}

/// 聊天选择
class ChatChoice extends $pb.GeneratedMessage {
  factory ChatChoice({
    $core.int? index,
    ChatMessage? message,
    $core.String? finishReason,
    $core.double? logprobs,
  }) {
    final result = create();
    if (index != null) result.index = index;
    if (message != null) result.message = message;
    if (finishReason != null) result.finishReason = finishReason;
    if (logprobs != null) result.logprobs = logprobs;
    return result;
  }

  ChatChoice._();

  factory ChatChoice.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ChatChoice.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ChatChoice',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'index')
    ..aOM<ChatMessage>(2, _omitFieldNames ? '' : 'message',
        subBuilder: ChatMessage.create)
    ..aOS(3, _omitFieldNames ? '' : 'finishReason')
    ..aD(4, _omitFieldNames ? '' : 'logprobs')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChatChoice clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChatChoice copyWith(void Function(ChatChoice) updates) =>
      super.copyWith((message) => updates(message as ChatChoice)) as ChatChoice;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ChatChoice create() => ChatChoice._();
  @$core.override
  ChatChoice createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ChatChoice getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ChatChoice>(create);
  static ChatChoice? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get index => $_getIZ(0);
  @$pb.TagNumber(1)
  set index($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasIndex() => $_has(0);
  @$pb.TagNumber(1)
  void clearIndex() => $_clearField(1);

  @$pb.TagNumber(2)
  ChatMessage get message => $_getN(1);
  @$pb.TagNumber(2)
  set message(ChatMessage value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasMessage() => $_has(1);
  @$pb.TagNumber(2)
  void clearMessage() => $_clearField(2);
  @$pb.TagNumber(2)
  ChatMessage ensureMessage() => $_ensure(1);

  @$pb.TagNumber(3)
  $core.String get finishReason => $_getSZ(2);
  @$pb.TagNumber(3)
  set finishReason($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasFinishReason() => $_has(2);
  @$pb.TagNumber(3)
  void clearFinishReason() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.double get logprobs => $_getN(3);
  @$pb.TagNumber(4)
  set logprobs($core.double value) => $_setDouble(3, value);
  @$pb.TagNumber(4)
  $core.bool hasLogprobs() => $_has(3);
  @$pb.TagNumber(4)
  void clearLogprobs() => $_clearField(4);
}

/// 使用统计
class Usage extends $pb.GeneratedMessage {
  factory Usage({
    $core.int? promptTokens,
    $core.int? completionTokens,
    $core.int? totalTokens,
  }) {
    final result = create();
    if (promptTokens != null) result.promptTokens = promptTokens;
    if (completionTokens != null) result.completionTokens = completionTokens;
    if (totalTokens != null) result.totalTokens = totalTokens;
    return result;
  }

  Usage._();

  factory Usage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Usage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Usage',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'promptTokens')
    ..aI(2, _omitFieldNames ? '' : 'completionTokens')
    ..aI(3, _omitFieldNames ? '' : 'totalTokens')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Usage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Usage copyWith(void Function(Usage) updates) =>
      super.copyWith((message) => updates(message as Usage)) as Usage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Usage create() => Usage._();
  @$core.override
  Usage createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Usage getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Usage>(create);
  static Usage? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get promptTokens => $_getIZ(0);
  @$pb.TagNumber(1)
  set promptTokens($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPromptTokens() => $_has(0);
  @$pb.TagNumber(1)
  void clearPromptTokens() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get completionTokens => $_getIZ(1);
  @$pb.TagNumber(2)
  set completionTokens($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCompletionTokens() => $_has(1);
  @$pb.TagNumber(2)
  void clearCompletionTokens() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get totalTokens => $_getIZ(2);
  @$pb.TagNumber(3)
  set totalTokens($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTotalTokens() => $_has(2);
  @$pb.TagNumber(3)
  void clearTotalTokens() => $_clearField(3);
}

/// 聊天完成响应
class ChatCompletionResponse extends $pb.GeneratedMessage {
  factory ChatCompletionResponse({
    $core.String? id,
    $core.String? object,
    $fixnum.Int64? created,
    $core.String? model,
    $core.Iterable<ChatChoice>? choices,
    Usage? usage,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (object != null) result.object = object;
    if (created != null) result.created = created;
    if (model != null) result.model = model;
    if (choices != null) result.choices.addAll(choices);
    if (usage != null) result.usage = usage;
    return result;
  }

  ChatCompletionResponse._();

  factory ChatCompletionResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ChatCompletionResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ChatCompletionResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'object')
    ..aInt64(3, _omitFieldNames ? '' : 'created')
    ..aOS(4, _omitFieldNames ? '' : 'model')
    ..pPM<ChatChoice>(5, _omitFieldNames ? '' : 'choices',
        subBuilder: ChatChoice.create)
    ..aOM<Usage>(6, _omitFieldNames ? '' : 'usage', subBuilder: Usage.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChatCompletionResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChatCompletionResponse copyWith(
          void Function(ChatCompletionResponse) updates) =>
      super.copyWith((message) => updates(message as ChatCompletionResponse))
          as ChatCompletionResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ChatCompletionResponse create() => ChatCompletionResponse._();
  @$core.override
  ChatCompletionResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ChatCompletionResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ChatCompletionResponse>(create);
  static ChatCompletionResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get object => $_getSZ(1);
  @$pb.TagNumber(2)
  set object($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasObject() => $_has(1);
  @$pb.TagNumber(2)
  void clearObject() => $_clearField(2);

  @$pb.TagNumber(3)
  $fixnum.Int64 get created => $_getI64(2);
  @$pb.TagNumber(3)
  set created($fixnum.Int64 value) => $_setInt64(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCreated() => $_has(2);
  @$pb.TagNumber(3)
  void clearCreated() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get model => $_getSZ(3);
  @$pb.TagNumber(4)
  set model($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasModel() => $_has(3);
  @$pb.TagNumber(4)
  void clearModel() => $_clearField(4);

  @$pb.TagNumber(5)
  $pb.PbList<ChatChoice> get choices => $_getList(4);

  @$pb.TagNumber(6)
  Usage get usage => $_getN(5);
  @$pb.TagNumber(6)
  set usage(Usage value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasUsage() => $_has(5);
  @$pb.TagNumber(6)
  void clearUsage() => $_clearField(6);
  @$pb.TagNumber(6)
  Usage ensureUsage() => $_ensure(5);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
