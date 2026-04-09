// This is a generated file - do not edit.
//
// Generated from domain/ai_chat/chat.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;
import 'package:peers_touch_base/model/google/protobuf/struct.pb.dart' as $0;

import 'chat.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'chat.pbenum.dart';

class ChatSession extends $pb.GeneratedMessage {
  factory ChatSession({
    $core.String? id,
    $core.String? userId,
    $core.String? agentId,
    $core.String? title,
    $core.String? description,
    $core.String? avatar,
    $core.String? modelName,
    $core.String? providerId,
    $core.bool? pinned,
    $core.String? group,
    $core.String? configJson,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? meta,
    $fixnum.Int64? createdAt,
    $fixnum.Int64? updatedAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (userId != null) result.userId = userId;
    if (agentId != null) result.agentId = agentId;
    if (title != null) result.title = title;
    if (description != null) result.description = description;
    if (avatar != null) result.avatar = avatar;
    if (modelName != null) result.modelName = modelName;
    if (providerId != null) result.providerId = providerId;
    if (pinned != null) result.pinned = pinned;
    if (group != null) result.group = group;
    if (configJson != null) result.configJson = configJson;
    if (meta != null) result.meta.addEntries(meta);
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
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
          _omitMessageNames ? '' : 'peers_touch.model.ai_chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'userId')
    ..aOS(3, _omitFieldNames ? '' : 'agentId')
    ..aOS(4, _omitFieldNames ? '' : 'title')
    ..aOS(5, _omitFieldNames ? '' : 'description')
    ..aOS(6, _omitFieldNames ? '' : 'avatar')
    ..aOS(7, _omitFieldNames ? '' : 'modelName')
    ..aOS(8, _omitFieldNames ? '' : 'providerId')
    ..aOB(9, _omitFieldNames ? '' : 'pinned')
    ..aOS(10, _omitFieldNames ? '' : 'group')
    ..aOS(11, _omitFieldNames ? '' : 'configJson')
    ..m<$core.String, $core.String>(12, _omitFieldNames ? '' : 'meta',
        entryClassName: 'ChatSession.MetaEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.model.ai_chat.v1'))
    ..aInt64(13, _omitFieldNames ? '' : 'createdAt')
    ..aInt64(14, _omitFieldNames ? '' : 'updatedAt')
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
  $core.String get userId => $_getSZ(1);
  @$pb.TagNumber(2)
  set userId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUserId() => $_has(1);
  @$pb.TagNumber(2)
  void clearUserId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get agentId => $_getSZ(2);
  @$pb.TagNumber(3)
  set agentId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasAgentId() => $_has(2);
  @$pb.TagNumber(3)
  void clearAgentId() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get title => $_getSZ(3);
  @$pb.TagNumber(4)
  set title($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasTitle() => $_has(3);
  @$pb.TagNumber(4)
  void clearTitle() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get description => $_getSZ(4);
  @$pb.TagNumber(5)
  set description($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasDescription() => $_has(4);
  @$pb.TagNumber(5)
  void clearDescription() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get avatar => $_getSZ(5);
  @$pb.TagNumber(6)
  set avatar($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasAvatar() => $_has(5);
  @$pb.TagNumber(6)
  void clearAvatar() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get modelName => $_getSZ(6);
  @$pb.TagNumber(7)
  set modelName($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasModelName() => $_has(6);
  @$pb.TagNumber(7)
  void clearModelName() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get providerId => $_getSZ(7);
  @$pb.TagNumber(8)
  set providerId($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasProviderId() => $_has(7);
  @$pb.TagNumber(8)
  void clearProviderId() => $_clearField(8);

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
  $core.String get configJson => $_getSZ(10);
  @$pb.TagNumber(11)
  set configJson($core.String value) => $_setString(10, value);
  @$pb.TagNumber(11)
  $core.bool hasConfigJson() => $_has(10);
  @$pb.TagNumber(11)
  void clearConfigJson() => $_clearField(11);

  @$pb.TagNumber(12)
  $pb.PbMap<$core.String, $core.String> get meta => $_getMap(11);

  @$pb.TagNumber(13)
  $fixnum.Int64 get createdAt => $_getI64(12);
  @$pb.TagNumber(13)
  set createdAt($fixnum.Int64 value) => $_setInt64(12, value);
  @$pb.TagNumber(13)
  $core.bool hasCreatedAt() => $_has(12);
  @$pb.TagNumber(13)
  void clearCreatedAt() => $_clearField(13);

  @$pb.TagNumber(14)
  $fixnum.Int64 get updatedAt => $_getI64(13);
  @$pb.TagNumber(14)
  set updatedAt($fixnum.Int64 value) => $_setInt64(13, value);
  @$pb.TagNumber(14)
  $core.bool hasUpdatedAt() => $_has(13);
  @$pb.TagNumber(14)
  void clearUpdatedAt() => $_clearField(14);
}

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
          _omitMessageNames ? '' : 'peers_touch.model.ai_chat.v1'),
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
          _omitMessageNames ? '' : 'peers_touch.model.ai_chat.v1'),
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
          _omitMessageNames ? '' : 'peers_touch.model.ai_chat.v1'),
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

class ChatMessage extends $pb.GeneratedMessage {
  factory ChatMessage({
    $core.String? id,
    $core.String? sessionId,
    $core.String? topicId,
    $core.String? modelName,
    ChatRole? role,
    $core.String? content,
    $core.String? reasoningJson,
    $core.Iterable<MessageAttachment>? attachments,
    $core.String? metadataJson,
    $core.String? pluginJson,
    $core.String? toolCallsJson,
    $core.String? errorJson,
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
    if (reasoningJson != null) result.reasoningJson = reasoningJson;
    if (attachments != null) result.attachments.addAll(attachments);
    if (metadataJson != null) result.metadataJson = metadataJson;
    if (pluginJson != null) result.pluginJson = pluginJson;
    if (toolCallsJson != null) result.toolCallsJson = toolCallsJson;
    if (errorJson != null) result.errorJson = errorJson;
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
          _omitMessageNames ? '' : 'peers_touch.model.ai_chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'sessionId')
    ..aOS(3, _omitFieldNames ? '' : 'topicId')
    ..aOS(4, _omitFieldNames ? '' : 'modelName')
    ..aE<ChatRole>(5, _omitFieldNames ? '' : 'role',
        enumValues: ChatRole.values)
    ..aOS(6, _omitFieldNames ? '' : 'content')
    ..aOS(7, _omitFieldNames ? '' : 'reasoningJson')
    ..pPM<MessageAttachment>(8, _omitFieldNames ? '' : 'attachments',
        subBuilder: MessageAttachment.create)
    ..aOS(9, _omitFieldNames ? '' : 'metadataJson')
    ..aOS(10, _omitFieldNames ? '' : 'pluginJson')
    ..aOS(11, _omitFieldNames ? '' : 'toolCallsJson')
    ..aOS(12, _omitFieldNames ? '' : 'errorJson')
    ..aInt64(13, _omitFieldNames ? '' : 'createdAt')
    ..aInt64(14, _omitFieldNames ? '' : 'updatedAt')
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
  $core.String get reasoningJson => $_getSZ(6);
  @$pb.TagNumber(7)
  set reasoningJson($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasReasoningJson() => $_has(6);
  @$pb.TagNumber(7)
  void clearReasoningJson() => $_clearField(7);

  @$pb.TagNumber(8)
  $pb.PbList<MessageAttachment> get attachments => $_getList(7);

  @$pb.TagNumber(9)
  $core.String get metadataJson => $_getSZ(8);
  @$pb.TagNumber(9)
  set metadataJson($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasMetadataJson() => $_has(8);
  @$pb.TagNumber(9)
  void clearMetadataJson() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.String get pluginJson => $_getSZ(9);
  @$pb.TagNumber(10)
  set pluginJson($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasPluginJson() => $_has(9);
  @$pb.TagNumber(10)
  void clearPluginJson() => $_clearField(10);

  @$pb.TagNumber(11)
  $core.String get toolCallsJson => $_getSZ(10);
  @$pb.TagNumber(11)
  set toolCallsJson($core.String value) => $_setString(10, value);
  @$pb.TagNumber(11)
  $core.bool hasToolCallsJson() => $_has(10);
  @$pb.TagNumber(11)
  void clearToolCallsJson() => $_clearField(11);

  @$pb.TagNumber(12)
  $core.String get errorJson => $_getSZ(11);
  @$pb.TagNumber(12)
  set errorJson($core.String value) => $_setString(11, value);
  @$pb.TagNumber(12)
  $core.bool hasErrorJson() => $_has(11);
  @$pb.TagNumber(12)
  void clearErrorJson() => $_clearField(12);

  @$pb.TagNumber(13)
  $fixnum.Int64 get createdAt => $_getI64(12);
  @$pb.TagNumber(13)
  set createdAt($fixnum.Int64 value) => $_setInt64(12, value);
  @$pb.TagNumber(13)
  $core.bool hasCreatedAt() => $_has(12);
  @$pb.TagNumber(13)
  void clearCreatedAt() => $_clearField(13);

  @$pb.TagNumber(14)
  $fixnum.Int64 get updatedAt => $_getI64(13);
  @$pb.TagNumber(14)
  set updatedAt($fixnum.Int64 value) => $_setInt64(13, value);
  @$pb.TagNumber(14)
  $core.bool hasUpdatedAt() => $_has(13);
  @$pb.TagNumber(14)
  void clearUpdatedAt() => $_clearField(14);
}

class ChatCompletionRequest extends $pb.GeneratedMessage {
  factory ChatCompletionRequest({
    $core.String? sessionId,
    $core.String? topicId,
    $core.String? model,
    $core.Iterable<ChatMessage>? messages,
    $core.bool? stream,
    $core.double? temperature,
    $core.int? maxTokens,
    $core.double? topP,
    $core.String? user,
  }) {
    final result = create();
    if (sessionId != null) result.sessionId = sessionId;
    if (topicId != null) result.topicId = topicId;
    if (model != null) result.model = model;
    if (messages != null) result.messages.addAll(messages);
    if (stream != null) result.stream = stream;
    if (temperature != null) result.temperature = temperature;
    if (maxTokens != null) result.maxTokens = maxTokens;
    if (topP != null) result.topP = topP;
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
          _omitMessageNames ? '' : 'peers_touch.model.ai_chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'sessionId')
    ..aOS(2, _omitFieldNames ? '' : 'topicId')
    ..aOS(3, _omitFieldNames ? '' : 'model')
    ..pPM<ChatMessage>(4, _omitFieldNames ? '' : 'messages',
        subBuilder: ChatMessage.create)
    ..aOB(5, _omitFieldNames ? '' : 'stream')
    ..aD(6, _omitFieldNames ? '' : 'temperature')
    ..aI(7, _omitFieldNames ? '' : 'maxTokens')
    ..aD(8, _omitFieldNames ? '' : 'topP')
    ..aOS(9, _omitFieldNames ? '' : 'user')
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
  $core.String get sessionId => $_getSZ(0);
  @$pb.TagNumber(1)
  set sessionId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSessionId() => $_has(0);
  @$pb.TagNumber(1)
  void clearSessionId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get topicId => $_getSZ(1);
  @$pb.TagNumber(2)
  set topicId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTopicId() => $_has(1);
  @$pb.TagNumber(2)
  void clearTopicId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get model => $_getSZ(2);
  @$pb.TagNumber(3)
  set model($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasModel() => $_has(2);
  @$pb.TagNumber(3)
  void clearModel() => $_clearField(3);

  @$pb.TagNumber(4)
  $pb.PbList<ChatMessage> get messages => $_getList(3);

  @$pb.TagNumber(5)
  $core.bool get stream => $_getBF(4);
  @$pb.TagNumber(5)
  set stream($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasStream() => $_has(4);
  @$pb.TagNumber(5)
  void clearStream() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.double get temperature => $_getN(5);
  @$pb.TagNumber(6)
  set temperature($core.double value) => $_setDouble(5, value);
  @$pb.TagNumber(6)
  $core.bool hasTemperature() => $_has(5);
  @$pb.TagNumber(6)
  void clearTemperature() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.int get maxTokens => $_getIZ(6);
  @$pb.TagNumber(7)
  set maxTokens($core.int value) => $_setSignedInt32(6, value);
  @$pb.TagNumber(7)
  $core.bool hasMaxTokens() => $_has(6);
  @$pb.TagNumber(7)
  void clearMaxTokens() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.double get topP => $_getN(7);
  @$pb.TagNumber(8)
  set topP($core.double value) => $_setDouble(7, value);
  @$pb.TagNumber(8)
  $core.bool hasTopP() => $_has(7);
  @$pb.TagNumber(8)
  void clearTopP() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.String get user => $_getSZ(8);
  @$pb.TagNumber(9)
  set user($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasUser() => $_has(8);
  @$pb.TagNumber(9)
  void clearUser() => $_clearField(9);
}

class ChatChoice extends $pb.GeneratedMessage {
  factory ChatChoice({
    $core.int? index,
    ChatMessage? message,
    $core.String? finishReason,
  }) {
    final result = create();
    if (index != null) result.index = index;
    if (message != null) result.message = message;
    if (finishReason != null) result.finishReason = finishReason;
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
          _omitMessageNames ? '' : 'peers_touch.model.ai_chat.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'index')
    ..aOM<ChatMessage>(2, _omitFieldNames ? '' : 'message',
        subBuilder: ChatMessage.create)
    ..aOS(3, _omitFieldNames ? '' : 'finishReason')
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
}

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
          _omitMessageNames ? '' : 'peers_touch.model.ai_chat.v1'),
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
          _omitMessageNames ? '' : 'peers_touch.model.ai_chat.v1'),
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
