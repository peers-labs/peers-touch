// This is a generated file - do not edit.
//
// Generated from domain/chat/chat.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import '../../google/protobuf/timestamp.pb.dart' as $0;
import '../core/core.pb.dart' as $1;
import 'chat.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'chat.pbenum.dart';

/// ChatSession: 聊天会话
class ChatSession extends $pb.GeneratedMessage {
  factory ChatSession({
    $core.String? id,
    $core.String? topic,
    $core.Iterable<$core.String>? participantIds,
    $0.Timestamp? lastMessageAt,
    $core.String? lastMessageSnippet,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (topic != null) result.topic = topic;
    if (participantIds != null) result.participantIds.addAll(participantIds);
    if (lastMessageAt != null) result.lastMessageAt = lastMessageAt;
    if (lastMessageSnippet != null)
      result.lastMessageSnippet = lastMessageSnippet;
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
          _omitMessageNames ? '' : 'peers_touch.model.core.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'topic')
    ..pPS(3, _omitFieldNames ? '' : 'participantIds')
    ..aOM<$0.Timestamp>(4, _omitFieldNames ? '' : 'lastMessageAt',
        subBuilder: $0.Timestamp.create)
    ..aOS(5, _omitFieldNames ? '' : 'lastMessageSnippet')
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
  $core.String get topic => $_getSZ(1);
  @$pb.TagNumber(2)
  set topic($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTopic() => $_has(1);
  @$pb.TagNumber(2)
  void clearTopic() => $_clearField(2);

  @$pb.TagNumber(3)
  $pb.PbList<$core.String> get participantIds => $_getList(2);

  @$pb.TagNumber(4)
  $0.Timestamp get lastMessageAt => $_getN(3);
  @$pb.TagNumber(4)
  set lastMessageAt($0.Timestamp value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasLastMessageAt() => $_has(3);
  @$pb.TagNumber(4)
  void clearLastMessageAt() => $_clearField(4);
  @$pb.TagNumber(4)
  $0.Timestamp ensureLastMessageAt() => $_ensure(3);

  @$pb.TagNumber(5)
  $core.String get lastMessageSnippet => $_getSZ(4);
  @$pb.TagNumber(5)
  set lastMessageSnippet($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLastMessageSnippet() => $_has(4);
  @$pb.TagNumber(5)
  void clearLastMessageSnippet() => $_clearField(5);
}

/// Message: 聊天消息
class Message extends $pb.GeneratedMessage {
  factory Message({
    $core.String? id,
    $core.String? sessionId,
    $core.String? senderId,
    $core.String? content,
    $0.Timestamp? sentAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (sessionId != null) result.sessionId = sessionId;
    if (senderId != null) result.senderId = senderId;
    if (content != null) result.content = content;
    if (sentAt != null) result.sentAt = sentAt;
    return result;
  }

  Message._();

  factory Message.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Message.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Message',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.core.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'sessionId')
    ..aOS(3, _omitFieldNames ? '' : 'senderId')
    ..aOS(4, _omitFieldNames ? '' : 'content')
    ..aOM<$0.Timestamp>(5, _omitFieldNames ? '' : 'sentAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Message clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Message copyWith(void Function(Message) updates) =>
      super.copyWith((message) => updates(message as Message)) as Message;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Message create() => Message._();
  @$core.override
  Message createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Message getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Message>(create);
  static Message? _defaultInstance;

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
  $core.String get senderId => $_getSZ(2);
  @$pb.TagNumber(3)
  set senderId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSenderId() => $_has(2);
  @$pb.TagNumber(3)
  void clearSenderId() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get content => $_getSZ(3);
  @$pb.TagNumber(4)
  set content($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasContent() => $_has(3);
  @$pb.TagNumber(4)
  void clearContent() => $_clearField(4);

  @$pb.TagNumber(5)
  $0.Timestamp get sentAt => $_getN(4);
  @$pb.TagNumber(5)
  set sentAt($0.Timestamp value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasSentAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearSentAt() => $_clearField(5);
  @$pb.TagNumber(5)
  $0.Timestamp ensureSentAt() => $_ensure(4);
}

/// Friend: 好友关系
class Friend extends $pb.GeneratedMessage {
  factory Friend({
    $1.Actor? user,
    Friend_FriendshipStatus? status,
    $0.Timestamp? friendshipCreatedAt,
  }) {
    final result = create();
    if (user != null) result.user = user;
    if (status != null) result.status = status;
    if (friendshipCreatedAt != null)
      result.friendshipCreatedAt = friendshipCreatedAt;
    return result;
  }

  Friend._();

  factory Friend.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Friend.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Friend',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.core.v1'),
      createEmptyInstance: create)
    ..aOM<$1.Actor>(1, _omitFieldNames ? '' : 'user',
        subBuilder: $1.Actor.create)
    ..aE<Friend_FriendshipStatus>(2, _omitFieldNames ? '' : 'status',
        enumValues: Friend_FriendshipStatus.values)
    ..aOM<$0.Timestamp>(3, _omitFieldNames ? '' : 'friendshipCreatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Friend clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Friend copyWith(void Function(Friend) updates) =>
      super.copyWith((message) => updates(message as Friend)) as Friend;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Friend create() => Friend._();
  @$core.override
  Friend createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Friend getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Friend>(create);
  static Friend? _defaultInstance;

  @$pb.TagNumber(1)
  $1.Actor get user => $_getN(0);
  @$pb.TagNumber(1)
  set user($1.Actor value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasUser() => $_has(0);
  @$pb.TagNumber(1)
  void clearUser() => $_clearField(1);
  @$pb.TagNumber(1)
  $1.Actor ensureUser() => $_ensure(0);

  @$pb.TagNumber(2)
  Friend_FriendshipStatus get status => $_getN(1);
  @$pb.TagNumber(2)
  set status(Friend_FriendshipStatus value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasStatus() => $_has(1);
  @$pb.TagNumber(2)
  void clearStatus() => $_clearField(2);

  @$pb.TagNumber(3)
  $0.Timestamp get friendshipCreatedAt => $_getN(2);
  @$pb.TagNumber(3)
  set friendshipCreatedAt($0.Timestamp value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasFriendshipCreatedAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearFriendshipCreatedAt() => $_clearField(3);
  @$pb.TagNumber(3)
  $0.Timestamp ensureFriendshipCreatedAt() => $_ensure(2);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
