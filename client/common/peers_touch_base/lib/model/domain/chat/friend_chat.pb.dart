// This is a generated file - do not edit.
//
// Generated from domain/chat/friend_chat.proto.

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

import 'friend_chat.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'friend_chat.pbenum.dart';

class FriendChatSession extends $pb.GeneratedMessage {
  factory FriendChatSession({
    $core.String? ulid,
    $core.String? participantADid,
    $core.String? participantBDid,
    $core.String? lastMessageUlid,
    $0.Timestamp? lastMessageAt,
    $core.int? unreadCountA,
    $core.int? unreadCountB,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (ulid != null) result.ulid = ulid;
    if (participantADid != null) result.participantADid = participantADid;
    if (participantBDid != null) result.participantBDid = participantBDid;
    if (lastMessageUlid != null) result.lastMessageUlid = lastMessageUlid;
    if (lastMessageAt != null) result.lastMessageAt = lastMessageAt;
    if (unreadCountA != null) result.unreadCountA = unreadCountA;
    if (unreadCountB != null) result.unreadCountB = unreadCountB;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  FriendChatSession._();

  factory FriendChatSession.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory FriendChatSession.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FriendChatSession',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'ulid')
    ..aOS(2, _omitFieldNames ? '' : 'participantADid')
    ..aOS(3, _omitFieldNames ? '' : 'participantBDid')
    ..aOS(4, _omitFieldNames ? '' : 'lastMessageUlid')
    ..aOM<$0.Timestamp>(5, _omitFieldNames ? '' : 'lastMessageAt',
        subBuilder: $0.Timestamp.create)
    ..aI(6, _omitFieldNames ? '' : 'unreadCountA')
    ..aI(7, _omitFieldNames ? '' : 'unreadCountB')
    ..aOM<$0.Timestamp>(8, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(9, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FriendChatSession clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FriendChatSession copyWith(void Function(FriendChatSession) updates) =>
      super.copyWith((message) => updates(message as FriendChatSession))
          as FriendChatSession;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static FriendChatSession create() => FriendChatSession._();
  @$core.override
  FriendChatSession createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static FriendChatSession getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<FriendChatSession>(create);
  static FriendChatSession? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get ulid => $_getSZ(0);
  @$pb.TagNumber(1)
  set ulid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get participantADid => $_getSZ(1);
  @$pb.TagNumber(2)
  set participantADid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasParticipantADid() => $_has(1);
  @$pb.TagNumber(2)
  void clearParticipantADid() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get participantBDid => $_getSZ(2);
  @$pb.TagNumber(3)
  set participantBDid($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasParticipantBDid() => $_has(2);
  @$pb.TagNumber(3)
  void clearParticipantBDid() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get lastMessageUlid => $_getSZ(3);
  @$pb.TagNumber(4)
  set lastMessageUlid($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasLastMessageUlid() => $_has(3);
  @$pb.TagNumber(4)
  void clearLastMessageUlid() => $_clearField(4);

  @$pb.TagNumber(5)
  $0.Timestamp get lastMessageAt => $_getN(4);
  @$pb.TagNumber(5)
  set lastMessageAt($0.Timestamp value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasLastMessageAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearLastMessageAt() => $_clearField(5);
  @$pb.TagNumber(5)
  $0.Timestamp ensureLastMessageAt() => $_ensure(4);

  @$pb.TagNumber(6)
  $core.int get unreadCountA => $_getIZ(5);
  @$pb.TagNumber(6)
  set unreadCountA($core.int value) => $_setSignedInt32(5, value);
  @$pb.TagNumber(6)
  $core.bool hasUnreadCountA() => $_has(5);
  @$pb.TagNumber(6)
  void clearUnreadCountA() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.int get unreadCountB => $_getIZ(6);
  @$pb.TagNumber(7)
  set unreadCountB($core.int value) => $_setSignedInt32(6, value);
  @$pb.TagNumber(7)
  $core.bool hasUnreadCountB() => $_has(6);
  @$pb.TagNumber(7)
  void clearUnreadCountB() => $_clearField(7);

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
}

class FriendChatMessage extends $pb.GeneratedMessage {
  factory FriendChatMessage({
    $core.String? ulid,
    $core.String? sessionUlid,
    $core.String? senderDid,
    $core.String? receiverDid,
    FriendMessageType? type,
    $core.String? content,
    $core.Iterable<FriendMessageAttachment>? attachments,
    $core.String? replyToUlid,
    FriendMessageStatus? status,
    $0.Timestamp? sentAt,
    $0.Timestamp? deliveredAt,
    $0.Timestamp? readAt,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (ulid != null) result.ulid = ulid;
    if (sessionUlid != null) result.sessionUlid = sessionUlid;
    if (senderDid != null) result.senderDid = senderDid;
    if (receiverDid != null) result.receiverDid = receiverDid;
    if (type != null) result.type = type;
    if (content != null) result.content = content;
    if (attachments != null) result.attachments.addAll(attachments);
    if (replyToUlid != null) result.replyToUlid = replyToUlid;
    if (status != null) result.status = status;
    if (sentAt != null) result.sentAt = sentAt;
    if (deliveredAt != null) result.deliveredAt = deliveredAt;
    if (readAt != null) result.readAt = readAt;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  FriendChatMessage._();

  factory FriendChatMessage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory FriendChatMessage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FriendChatMessage',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'ulid')
    ..aOS(2, _omitFieldNames ? '' : 'sessionUlid')
    ..aOS(3, _omitFieldNames ? '' : 'senderDid')
    ..aOS(4, _omitFieldNames ? '' : 'receiverDid')
    ..aE<FriendMessageType>(5, _omitFieldNames ? '' : 'type',
        enumValues: FriendMessageType.values)
    ..aOS(6, _omitFieldNames ? '' : 'content')
    ..pPM<FriendMessageAttachment>(7, _omitFieldNames ? '' : 'attachments',
        subBuilder: FriendMessageAttachment.create)
    ..aOS(8, _omitFieldNames ? '' : 'replyToUlid')
    ..aE<FriendMessageStatus>(9, _omitFieldNames ? '' : 'status',
        enumValues: FriendMessageStatus.values)
    ..aOM<$0.Timestamp>(10, _omitFieldNames ? '' : 'sentAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(11, _omitFieldNames ? '' : 'deliveredAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(12, _omitFieldNames ? '' : 'readAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(13, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(14, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FriendChatMessage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FriendChatMessage copyWith(void Function(FriendChatMessage) updates) =>
      super.copyWith((message) => updates(message as FriendChatMessage))
          as FriendChatMessage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static FriendChatMessage create() => FriendChatMessage._();
  @$core.override
  FriendChatMessage createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static FriendChatMessage getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<FriendChatMessage>(create);
  static FriendChatMessage? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get ulid => $_getSZ(0);
  @$pb.TagNumber(1)
  set ulid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get sessionUlid => $_getSZ(1);
  @$pb.TagNumber(2)
  set sessionUlid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSessionUlid() => $_has(1);
  @$pb.TagNumber(2)
  void clearSessionUlid() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get senderDid => $_getSZ(2);
  @$pb.TagNumber(3)
  set senderDid($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSenderDid() => $_has(2);
  @$pb.TagNumber(3)
  void clearSenderDid() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get receiverDid => $_getSZ(3);
  @$pb.TagNumber(4)
  set receiverDid($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasReceiverDid() => $_has(3);
  @$pb.TagNumber(4)
  void clearReceiverDid() => $_clearField(4);

  @$pb.TagNumber(5)
  FriendMessageType get type => $_getN(4);
  @$pb.TagNumber(5)
  set type(FriendMessageType value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasType() => $_has(4);
  @$pb.TagNumber(5)
  void clearType() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get content => $_getSZ(5);
  @$pb.TagNumber(6)
  set content($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasContent() => $_has(5);
  @$pb.TagNumber(6)
  void clearContent() => $_clearField(6);

  @$pb.TagNumber(7)
  $pb.PbList<FriendMessageAttachment> get attachments => $_getList(6);

  @$pb.TagNumber(8)
  $core.String get replyToUlid => $_getSZ(7);
  @$pb.TagNumber(8)
  set replyToUlid($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasReplyToUlid() => $_has(7);
  @$pb.TagNumber(8)
  void clearReplyToUlid() => $_clearField(8);

  @$pb.TagNumber(9)
  FriendMessageStatus get status => $_getN(8);
  @$pb.TagNumber(9)
  set status(FriendMessageStatus value) => $_setField(9, value);
  @$pb.TagNumber(9)
  $core.bool hasStatus() => $_has(8);
  @$pb.TagNumber(9)
  void clearStatus() => $_clearField(9);

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
  $0.Timestamp get deliveredAt => $_getN(10);
  @$pb.TagNumber(11)
  set deliveredAt($0.Timestamp value) => $_setField(11, value);
  @$pb.TagNumber(11)
  $core.bool hasDeliveredAt() => $_has(10);
  @$pb.TagNumber(11)
  void clearDeliveredAt() => $_clearField(11);
  @$pb.TagNumber(11)
  $0.Timestamp ensureDeliveredAt() => $_ensure(10);

  @$pb.TagNumber(12)
  $0.Timestamp get readAt => $_getN(11);
  @$pb.TagNumber(12)
  set readAt($0.Timestamp value) => $_setField(12, value);
  @$pb.TagNumber(12)
  $core.bool hasReadAt() => $_has(11);
  @$pb.TagNumber(12)
  void clearReadAt() => $_clearField(12);
  @$pb.TagNumber(12)
  $0.Timestamp ensureReadAt() => $_ensure(11);

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
  $0.Timestamp get updatedAt => $_getN(13);
  @$pb.TagNumber(14)
  set updatedAt($0.Timestamp value) => $_setField(14, value);
  @$pb.TagNumber(14)
  $core.bool hasUpdatedAt() => $_has(13);
  @$pb.TagNumber(14)
  void clearUpdatedAt() => $_clearField(14);
  @$pb.TagNumber(14)
  $0.Timestamp ensureUpdatedAt() => $_ensure(13);
}

class FriendMessageAttachment extends $pb.GeneratedMessage {
  factory FriendMessageAttachment({
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

  FriendMessageAttachment._();

  factory FriendMessageAttachment.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory FriendMessageAttachment.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FriendMessageAttachment',
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
  FriendMessageAttachment clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FriendMessageAttachment copyWith(
          void Function(FriendMessageAttachment) updates) =>
      super.copyWith((message) => updates(message as FriendMessageAttachment))
          as FriendMessageAttachment;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static FriendMessageAttachment create() => FriendMessageAttachment._();
  @$core.override
  FriendMessageAttachment createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static FriendMessageAttachment getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<FriendMessageAttachment>(create);
  static FriendMessageAttachment? _defaultInstance;

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

class MessageEnvelope extends $pb.GeneratedMessage {
  factory MessageEnvelope({
    $core.String? messageUlid,
    $core.String? senderDid,
    $core.String? receiverDid,
    $core.String? sessionUlid,
    $core.List<$core.int>? encryptedPayload,
    $fixnum.Int64? timestamp,
    $core.String? signature,
  }) {
    final result = create();
    if (messageUlid != null) result.messageUlid = messageUlid;
    if (senderDid != null) result.senderDid = senderDid;
    if (receiverDid != null) result.receiverDid = receiverDid;
    if (sessionUlid != null) result.sessionUlid = sessionUlid;
    if (encryptedPayload != null) result.encryptedPayload = encryptedPayload;
    if (timestamp != null) result.timestamp = timestamp;
    if (signature != null) result.signature = signature;
    return result;
  }

  MessageEnvelope._();

  factory MessageEnvelope.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MessageEnvelope.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MessageEnvelope',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'messageUlid')
    ..aOS(2, _omitFieldNames ? '' : 'senderDid')
    ..aOS(3, _omitFieldNames ? '' : 'receiverDid')
    ..aOS(4, _omitFieldNames ? '' : 'sessionUlid')
    ..a<$core.List<$core.int>>(
        5, _omitFieldNames ? '' : 'encryptedPayload', $pb.PbFieldType.OY)
    ..aInt64(6, _omitFieldNames ? '' : 'timestamp')
    ..aOS(7, _omitFieldNames ? '' : 'signature')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MessageEnvelope clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MessageEnvelope copyWith(void Function(MessageEnvelope) updates) =>
      super.copyWith((message) => updates(message as MessageEnvelope))
          as MessageEnvelope;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MessageEnvelope create() => MessageEnvelope._();
  @$core.override
  MessageEnvelope createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MessageEnvelope getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MessageEnvelope>(create);
  static MessageEnvelope? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get messageUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set messageUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasMessageUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearMessageUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get senderDid => $_getSZ(1);
  @$pb.TagNumber(2)
  set senderDid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSenderDid() => $_has(1);
  @$pb.TagNumber(2)
  void clearSenderDid() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get receiverDid => $_getSZ(2);
  @$pb.TagNumber(3)
  set receiverDid($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasReceiverDid() => $_has(2);
  @$pb.TagNumber(3)
  void clearReceiverDid() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get sessionUlid => $_getSZ(3);
  @$pb.TagNumber(4)
  set sessionUlid($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasSessionUlid() => $_has(3);
  @$pb.TagNumber(4)
  void clearSessionUlid() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.List<$core.int> get encryptedPayload => $_getN(4);
  @$pb.TagNumber(5)
  set encryptedPayload($core.List<$core.int> value) => $_setBytes(4, value);
  @$pb.TagNumber(5)
  $core.bool hasEncryptedPayload() => $_has(4);
  @$pb.TagNumber(5)
  void clearEncryptedPayload() => $_clearField(5);

  @$pb.TagNumber(6)
  $fixnum.Int64 get timestamp => $_getI64(5);
  @$pb.TagNumber(6)
  set timestamp($fixnum.Int64 value) => $_setInt64(5, value);
  @$pb.TagNumber(6)
  $core.bool hasTimestamp() => $_has(5);
  @$pb.TagNumber(6)
  void clearTimestamp() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get signature => $_getSZ(6);
  @$pb.TagNumber(7)
  set signature($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasSignature() => $_has(6);
  @$pb.TagNumber(7)
  void clearSignature() => $_clearField(7);
}

class OfflineMessage extends $pb.GeneratedMessage {
  factory OfflineMessage({
    $core.String? ulid,
    $core.String? receiverDid,
    $core.String? senderDid,
    $core.String? sessionUlid,
    $core.List<$core.int>? encryptedPayload,
    OfflineMessageStatus? status,
    $0.Timestamp? expireAt,
    $0.Timestamp? deliveredAt,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (ulid != null) result.ulid = ulid;
    if (receiverDid != null) result.receiverDid = receiverDid;
    if (senderDid != null) result.senderDid = senderDid;
    if (sessionUlid != null) result.sessionUlid = sessionUlid;
    if (encryptedPayload != null) result.encryptedPayload = encryptedPayload;
    if (status != null) result.status = status;
    if (expireAt != null) result.expireAt = expireAt;
    if (deliveredAt != null) result.deliveredAt = deliveredAt;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  OfflineMessage._();

  factory OfflineMessage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory OfflineMessage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'OfflineMessage',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'ulid')
    ..aOS(2, _omitFieldNames ? '' : 'receiverDid')
    ..aOS(3, _omitFieldNames ? '' : 'senderDid')
    ..aOS(4, _omitFieldNames ? '' : 'sessionUlid')
    ..a<$core.List<$core.int>>(
        5, _omitFieldNames ? '' : 'encryptedPayload', $pb.PbFieldType.OY)
    ..aE<OfflineMessageStatus>(6, _omitFieldNames ? '' : 'status',
        enumValues: OfflineMessageStatus.values)
    ..aOM<$0.Timestamp>(7, _omitFieldNames ? '' : 'expireAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(8, _omitFieldNames ? '' : 'deliveredAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(9, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(10, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OfflineMessage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OfflineMessage copyWith(void Function(OfflineMessage) updates) =>
      super.copyWith((message) => updates(message as OfflineMessage))
          as OfflineMessage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static OfflineMessage create() => OfflineMessage._();
  @$core.override
  OfflineMessage createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static OfflineMessage getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<OfflineMessage>(create);
  static OfflineMessage? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get ulid => $_getSZ(0);
  @$pb.TagNumber(1)
  set ulid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get receiverDid => $_getSZ(1);
  @$pb.TagNumber(2)
  set receiverDid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasReceiverDid() => $_has(1);
  @$pb.TagNumber(2)
  void clearReceiverDid() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get senderDid => $_getSZ(2);
  @$pb.TagNumber(3)
  set senderDid($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSenderDid() => $_has(2);
  @$pb.TagNumber(3)
  void clearSenderDid() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get sessionUlid => $_getSZ(3);
  @$pb.TagNumber(4)
  set sessionUlid($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasSessionUlid() => $_has(3);
  @$pb.TagNumber(4)
  void clearSessionUlid() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.List<$core.int> get encryptedPayload => $_getN(4);
  @$pb.TagNumber(5)
  set encryptedPayload($core.List<$core.int> value) => $_setBytes(4, value);
  @$pb.TagNumber(5)
  $core.bool hasEncryptedPayload() => $_has(4);
  @$pb.TagNumber(5)
  void clearEncryptedPayload() => $_clearField(5);

  @$pb.TagNumber(6)
  OfflineMessageStatus get status => $_getN(5);
  @$pb.TagNumber(6)
  set status(OfflineMessageStatus value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasStatus() => $_has(5);
  @$pb.TagNumber(6)
  void clearStatus() => $_clearField(6);

  @$pb.TagNumber(7)
  $0.Timestamp get expireAt => $_getN(6);
  @$pb.TagNumber(7)
  set expireAt($0.Timestamp value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasExpireAt() => $_has(6);
  @$pb.TagNumber(7)
  void clearExpireAt() => $_clearField(7);
  @$pb.TagNumber(7)
  $0.Timestamp ensureExpireAt() => $_ensure(6);

  @$pb.TagNumber(8)
  $0.Timestamp get deliveredAt => $_getN(7);
  @$pb.TagNumber(8)
  set deliveredAt($0.Timestamp value) => $_setField(8, value);
  @$pb.TagNumber(8)
  $core.bool hasDeliveredAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearDeliveredAt() => $_clearField(8);
  @$pb.TagNumber(8)
  $0.Timestamp ensureDeliveredAt() => $_ensure(7);

  @$pb.TagNumber(9)
  $0.Timestamp get createdAt => $_getN(8);
  @$pb.TagNumber(9)
  set createdAt($0.Timestamp value) => $_setField(9, value);
  @$pb.TagNumber(9)
  $core.bool hasCreatedAt() => $_has(8);
  @$pb.TagNumber(9)
  void clearCreatedAt() => $_clearField(9);
  @$pb.TagNumber(9)
  $0.Timestamp ensureCreatedAt() => $_ensure(8);

  @$pb.TagNumber(10)
  $0.Timestamp get updatedAt => $_getN(9);
  @$pb.TagNumber(10)
  set updatedAt($0.Timestamp value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasUpdatedAt() => $_has(9);
  @$pb.TagNumber(10)
  void clearUpdatedAt() => $_clearField(10);
  @$pb.TagNumber(10)
  $0.Timestamp ensureUpdatedAt() => $_ensure(9);
}

class SendMessageRequest extends $pb.GeneratedMessage {
  factory SendMessageRequest({
    $core.String? sessionUlid,
    $core.String? receiverDid,
    FriendMessageType? type,
    $core.String? content,
    $core.Iterable<FriendMessageAttachment>? attachments,
    $core.String? replyToUlid,
  }) {
    final result = create();
    if (sessionUlid != null) result.sessionUlid = sessionUlid;
    if (receiverDid != null) result.receiverDid = receiverDid;
    if (type != null) result.type = type;
    if (content != null) result.content = content;
    if (attachments != null) result.attachments.addAll(attachments);
    if (replyToUlid != null) result.replyToUlid = replyToUlid;
    return result;
  }

  SendMessageRequest._();

  factory SendMessageRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SendMessageRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SendMessageRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'sessionUlid')
    ..aOS(2, _omitFieldNames ? '' : 'receiverDid')
    ..aE<FriendMessageType>(3, _omitFieldNames ? '' : 'type',
        enumValues: FriendMessageType.values)
    ..aOS(4, _omitFieldNames ? '' : 'content')
    ..pPM<FriendMessageAttachment>(5, _omitFieldNames ? '' : 'attachments',
        subBuilder: FriendMessageAttachment.create)
    ..aOS(6, _omitFieldNames ? '' : 'replyToUlid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SendMessageRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SendMessageRequest copyWith(void Function(SendMessageRequest) updates) =>
      super.copyWith((message) => updates(message as SendMessageRequest))
          as SendMessageRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SendMessageRequest create() => SendMessageRequest._();
  @$core.override
  SendMessageRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SendMessageRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SendMessageRequest>(create);
  static SendMessageRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get sessionUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set sessionUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSessionUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearSessionUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get receiverDid => $_getSZ(1);
  @$pb.TagNumber(2)
  set receiverDid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasReceiverDid() => $_has(1);
  @$pb.TagNumber(2)
  void clearReceiverDid() => $_clearField(2);

  @$pb.TagNumber(3)
  FriendMessageType get type => $_getN(2);
  @$pb.TagNumber(3)
  set type(FriendMessageType value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasType() => $_has(2);
  @$pb.TagNumber(3)
  void clearType() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get content => $_getSZ(3);
  @$pb.TagNumber(4)
  set content($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasContent() => $_has(3);
  @$pb.TagNumber(4)
  void clearContent() => $_clearField(4);

  @$pb.TagNumber(5)
  $pb.PbList<FriendMessageAttachment> get attachments => $_getList(4);

  @$pb.TagNumber(6)
  $core.String get replyToUlid => $_getSZ(5);
  @$pb.TagNumber(6)
  set replyToUlid($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasReplyToUlid() => $_has(5);
  @$pb.TagNumber(6)
  void clearReplyToUlid() => $_clearField(6);
}

class SendMessageResponse extends $pb.GeneratedMessage {
  factory SendMessageResponse({
    FriendChatMessage? message,
    $core.String? relayStatus,
  }) {
    final result = create();
    if (message != null) result.message = message;
    if (relayStatus != null) result.relayStatus = relayStatus;
    return result;
  }

  SendMessageResponse._();

  factory SendMessageResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SendMessageResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SendMessageResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOM<FriendChatMessage>(1, _omitFieldNames ? '' : 'message',
        subBuilder: FriendChatMessage.create)
    ..aOS(2, _omitFieldNames ? '' : 'relayStatus')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SendMessageResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SendMessageResponse copyWith(void Function(SendMessageResponse) updates) =>
      super.copyWith((message) => updates(message as SendMessageResponse))
          as SendMessageResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SendMessageResponse create() => SendMessageResponse._();
  @$core.override
  SendMessageResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SendMessageResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SendMessageResponse>(create);
  static SendMessageResponse? _defaultInstance;

  @$pb.TagNumber(1)
  FriendChatMessage get message => $_getN(0);
  @$pb.TagNumber(1)
  set message(FriendChatMessage value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasMessage() => $_has(0);
  @$pb.TagNumber(1)
  void clearMessage() => $_clearField(1);
  @$pb.TagNumber(1)
  FriendChatMessage ensureMessage() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.String get relayStatus => $_getSZ(1);
  @$pb.TagNumber(2)
  set relayStatus($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasRelayStatus() => $_has(1);
  @$pb.TagNumber(2)
  void clearRelayStatus() => $_clearField(2);
}

class GetMessagesRequest extends $pb.GeneratedMessage {
  factory GetMessagesRequest({
    $core.String? sessionUlid,
    $core.String? beforeUlid,
    $core.int? limit,
  }) {
    final result = create();
    if (sessionUlid != null) result.sessionUlid = sessionUlid;
    if (beforeUlid != null) result.beforeUlid = beforeUlid;
    if (limit != null) result.limit = limit;
    return result;
  }

  GetMessagesRequest._();

  factory GetMessagesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetMessagesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMessagesRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'sessionUlid')
    ..aOS(2, _omitFieldNames ? '' : 'beforeUlid')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMessagesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMessagesRequest copyWith(void Function(GetMessagesRequest) updates) =>
      super.copyWith((message) => updates(message as GetMessagesRequest))
          as GetMessagesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetMessagesRequest create() => GetMessagesRequest._();
  @$core.override
  GetMessagesRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetMessagesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMessagesRequest>(create);
  static GetMessagesRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get sessionUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set sessionUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSessionUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearSessionUlid() => $_clearField(1);

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

class GetMessagesResponse extends $pb.GeneratedMessage {
  factory GetMessagesResponse({
    $core.Iterable<FriendChatMessage>? messages,
    $core.bool? hasMore,
  }) {
    final result = create();
    if (messages != null) result.messages.addAll(messages);
    if (hasMore != null) result.hasMore = hasMore;
    return result;
  }

  GetMessagesResponse._();

  factory GetMessagesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetMessagesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMessagesResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..pPM<FriendChatMessage>(1, _omitFieldNames ? '' : 'messages',
        subBuilder: FriendChatMessage.create)
    ..aOB(2, _omitFieldNames ? '' : 'hasMore')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMessagesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMessagesResponse copyWith(void Function(GetMessagesResponse) updates) =>
      super.copyWith((message) => updates(message as GetMessagesResponse))
          as GetMessagesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetMessagesResponse create() => GetMessagesResponse._();
  @$core.override
  GetMessagesResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetMessagesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMessagesResponse>(create);
  static GetMessagesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<FriendChatMessage> get messages => $_getList(0);

  @$pb.TagNumber(2)
  $core.bool get hasMore => $_getBF(1);
  @$pb.TagNumber(2)
  set hasMore($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasHasMore() => $_has(1);
  @$pb.TagNumber(2)
  void clearHasMore() => $_clearField(2);
}

class CreateSessionRequest extends $pb.GeneratedMessage {
  factory CreateSessionRequest({
    $core.String? participantDid,
  }) {
    final result = create();
    if (participantDid != null) result.participantDid = participantDid;
    return result;
  }

  CreateSessionRequest._();

  factory CreateSessionRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateSessionRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateSessionRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'participantDid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateSessionRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateSessionRequest copyWith(void Function(CreateSessionRequest) updates) =>
      super.copyWith((message) => updates(message as CreateSessionRequest))
          as CreateSessionRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateSessionRequest create() => CreateSessionRequest._();
  @$core.override
  CreateSessionRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateSessionRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateSessionRequest>(create);
  static CreateSessionRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get participantDid => $_getSZ(0);
  @$pb.TagNumber(1)
  set participantDid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasParticipantDid() => $_has(0);
  @$pb.TagNumber(1)
  void clearParticipantDid() => $_clearField(1);
}

class CreateSessionResponse extends $pb.GeneratedMessage {
  factory CreateSessionResponse({
    FriendChatSession? session,
    $core.bool? created,
  }) {
    final result = create();
    if (session != null) result.session = session;
    if (created != null) result.created = created;
    return result;
  }

  CreateSessionResponse._();

  factory CreateSessionResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateSessionResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateSessionResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOM<FriendChatSession>(1, _omitFieldNames ? '' : 'session',
        subBuilder: FriendChatSession.create)
    ..aOB(2, _omitFieldNames ? '' : 'created')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateSessionResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateSessionResponse copyWith(
          void Function(CreateSessionResponse) updates) =>
      super.copyWith((message) => updates(message as CreateSessionResponse))
          as CreateSessionResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateSessionResponse create() => CreateSessionResponse._();
  @$core.override
  CreateSessionResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateSessionResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateSessionResponse>(create);
  static CreateSessionResponse? _defaultInstance;

  @$pb.TagNumber(1)
  FriendChatSession get session => $_getN(0);
  @$pb.TagNumber(1)
  set session(FriendChatSession value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasSession() => $_has(0);
  @$pb.TagNumber(1)
  void clearSession() => $_clearField(1);
  @$pb.TagNumber(1)
  FriendChatSession ensureSession() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.bool get created => $_getBF(1);
  @$pb.TagNumber(2)
  set created($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCreated() => $_has(1);
  @$pb.TagNumber(2)
  void clearCreated() => $_clearField(2);
}

class GetSessionsRequest extends $pb.GeneratedMessage {
  factory GetSessionsRequest({
    $core.int? limit,
    $core.int? offset,
  }) {
    final result = create();
    if (limit != null) result.limit = limit;
    if (offset != null) result.offset = offset;
    return result;
  }

  GetSessionsRequest._();

  factory GetSessionsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetSessionsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetSessionsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'limit')
    ..aI(2, _omitFieldNames ? '' : 'offset')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSessionsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSessionsRequest copyWith(void Function(GetSessionsRequest) updates) =>
      super.copyWith((message) => updates(message as GetSessionsRequest))
          as GetSessionsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetSessionsRequest create() => GetSessionsRequest._();
  @$core.override
  GetSessionsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetSessionsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetSessionsRequest>(create);
  static GetSessionsRequest? _defaultInstance;

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

class GetSessionsResponse extends $pb.GeneratedMessage {
  factory GetSessionsResponse({
    $core.Iterable<FriendChatSession>? sessions,
    $core.int? total,
  }) {
    final result = create();
    if (sessions != null) result.sessions.addAll(sessions);
    if (total != null) result.total = total;
    return result;
  }

  GetSessionsResponse._();

  factory GetSessionsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetSessionsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetSessionsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..pPM<FriendChatSession>(1, _omitFieldNames ? '' : 'sessions',
        subBuilder: FriendChatSession.create)
    ..aI(2, _omitFieldNames ? '' : 'total')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSessionsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSessionsResponse copyWith(void Function(GetSessionsResponse) updates) =>
      super.copyWith((message) => updates(message as GetSessionsResponse))
          as GetSessionsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetSessionsResponse create() => GetSessionsResponse._();
  @$core.override
  GetSessionsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetSessionsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetSessionsResponse>(create);
  static GetSessionsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<FriendChatSession> get sessions => $_getList(0);

  @$pb.TagNumber(2)
  $core.int get total => $_getIZ(1);
  @$pb.TagNumber(2)
  set total($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTotal() => $_has(1);
  @$pb.TagNumber(2)
  void clearTotal() => $_clearField(2);
}

class MarkReadRequest extends $pb.GeneratedMessage {
  factory MarkReadRequest({
    $core.String? sessionUlid,
    $core.String? lastReadUlid,
  }) {
    final result = create();
    if (sessionUlid != null) result.sessionUlid = sessionUlid;
    if (lastReadUlid != null) result.lastReadUlid = lastReadUlid;
    return result;
  }

  MarkReadRequest._();

  factory MarkReadRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MarkReadRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkReadRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'sessionUlid')
    ..aOS(2, _omitFieldNames ? '' : 'lastReadUlid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkReadRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkReadRequest copyWith(void Function(MarkReadRequest) updates) =>
      super.copyWith((message) => updates(message as MarkReadRequest))
          as MarkReadRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MarkReadRequest create() => MarkReadRequest._();
  @$core.override
  MarkReadRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MarkReadRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkReadRequest>(create);
  static MarkReadRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get sessionUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set sessionUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSessionUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearSessionUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get lastReadUlid => $_getSZ(1);
  @$pb.TagNumber(2)
  set lastReadUlid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLastReadUlid() => $_has(1);
  @$pb.TagNumber(2)
  void clearLastReadUlid() => $_clearField(2);
}

class MarkReadResponse extends $pb.GeneratedMessage {
  factory MarkReadResponse({
    $core.int? unreadCount,
  }) {
    final result = create();
    if (unreadCount != null) result.unreadCount = unreadCount;
    return result;
  }

  MarkReadResponse._();

  factory MarkReadResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MarkReadResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkReadResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'unreadCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkReadResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkReadResponse copyWith(void Function(MarkReadResponse) updates) =>
      super.copyWith((message) => updates(message as MarkReadResponse))
          as MarkReadResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MarkReadResponse create() => MarkReadResponse._();
  @$core.override
  MarkReadResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MarkReadResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkReadResponse>(create);
  static MarkReadResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get unreadCount => $_getIZ(0);
  @$pb.TagNumber(1)
  set unreadCount($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUnreadCount() => $_has(0);
  @$pb.TagNumber(1)
  void clearUnreadCount() => $_clearField(1);
}

class RelayMessageRequest extends $pb.GeneratedMessage {
  factory RelayMessageRequest({
    MessageEnvelope? envelope,
  }) {
    final result = create();
    if (envelope != null) result.envelope = envelope;
    return result;
  }

  RelayMessageRequest._();

  factory RelayMessageRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RelayMessageRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RelayMessageRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOM<MessageEnvelope>(1, _omitFieldNames ? '' : 'envelope',
        subBuilder: MessageEnvelope.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RelayMessageRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RelayMessageRequest copyWith(void Function(RelayMessageRequest) updates) =>
      super.copyWith((message) => updates(message as RelayMessageRequest))
          as RelayMessageRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RelayMessageRequest create() => RelayMessageRequest._();
  @$core.override
  RelayMessageRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RelayMessageRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RelayMessageRequest>(create);
  static RelayMessageRequest? _defaultInstance;

  @$pb.TagNumber(1)
  MessageEnvelope get envelope => $_getN(0);
  @$pb.TagNumber(1)
  set envelope(MessageEnvelope value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasEnvelope() => $_has(0);
  @$pb.TagNumber(1)
  void clearEnvelope() => $_clearField(1);
  @$pb.TagNumber(1)
  MessageEnvelope ensureEnvelope() => $_ensure(0);
}

class RelayMessageResponse extends $pb.GeneratedMessage {
  factory RelayMessageResponse({
    $core.String? status,
    $0.Timestamp? deliveredAt,
    $core.String? forwardedTo,
  }) {
    final result = create();
    if (status != null) result.status = status;
    if (deliveredAt != null) result.deliveredAt = deliveredAt;
    if (forwardedTo != null) result.forwardedTo = forwardedTo;
    return result;
  }

  RelayMessageResponse._();

  factory RelayMessageResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RelayMessageResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RelayMessageResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'status')
    ..aOM<$0.Timestamp>(2, _omitFieldNames ? '' : 'deliveredAt',
        subBuilder: $0.Timestamp.create)
    ..aOS(3, _omitFieldNames ? '' : 'forwardedTo')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RelayMessageResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RelayMessageResponse copyWith(void Function(RelayMessageResponse) updates) =>
      super.copyWith((message) => updates(message as RelayMessageResponse))
          as RelayMessageResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RelayMessageResponse create() => RelayMessageResponse._();
  @$core.override
  RelayMessageResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RelayMessageResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RelayMessageResponse>(create);
  static RelayMessageResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get status => $_getSZ(0);
  @$pb.TagNumber(1)
  set status($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasStatus() => $_has(0);
  @$pb.TagNumber(1)
  void clearStatus() => $_clearField(1);

  @$pb.TagNumber(2)
  $0.Timestamp get deliveredAt => $_getN(1);
  @$pb.TagNumber(2)
  set deliveredAt($0.Timestamp value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasDeliveredAt() => $_has(1);
  @$pb.TagNumber(2)
  void clearDeliveredAt() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.Timestamp ensureDeliveredAt() => $_ensure(1);

  @$pb.TagNumber(3)
  $core.String get forwardedTo => $_getSZ(2);
  @$pb.TagNumber(3)
  set forwardedTo($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasForwardedTo() => $_has(2);
  @$pb.TagNumber(3)
  void clearForwardedTo() => $_clearField(3);
}

/// SyncMessages: batch sync pending messages to server (POST /friend-chat/message/sync).
class SyncMessageItem extends $pb.GeneratedMessage {
  factory SyncMessageItem({
    $core.String? ulid,
    $core.String? sessionUlid,
    $core.String? receiverDid,
    FriendMessageType? type,
    $core.String? content,
    $0.Timestamp? sentAt,
  }) {
    final result = create();
    if (ulid != null) result.ulid = ulid;
    if (sessionUlid != null) result.sessionUlid = sessionUlid;
    if (receiverDid != null) result.receiverDid = receiverDid;
    if (type != null) result.type = type;
    if (content != null) result.content = content;
    if (sentAt != null) result.sentAt = sentAt;
    return result;
  }

  SyncMessageItem._();

  factory SyncMessageItem.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SyncMessageItem.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SyncMessageItem',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'ulid')
    ..aOS(2, _omitFieldNames ? '' : 'sessionUlid')
    ..aOS(3, _omitFieldNames ? '' : 'receiverDid')
    ..aE<FriendMessageType>(4, _omitFieldNames ? '' : 'type',
        enumValues: FriendMessageType.values)
    ..aOS(5, _omitFieldNames ? '' : 'content')
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'sentAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SyncMessageItem clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SyncMessageItem copyWith(void Function(SyncMessageItem) updates) =>
      super.copyWith((message) => updates(message as SyncMessageItem))
          as SyncMessageItem;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SyncMessageItem create() => SyncMessageItem._();
  @$core.override
  SyncMessageItem createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SyncMessageItem getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SyncMessageItem>(create);
  static SyncMessageItem? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get ulid => $_getSZ(0);
  @$pb.TagNumber(1)
  set ulid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get sessionUlid => $_getSZ(1);
  @$pb.TagNumber(2)
  set sessionUlid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSessionUlid() => $_has(1);
  @$pb.TagNumber(2)
  void clearSessionUlid() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get receiverDid => $_getSZ(2);
  @$pb.TagNumber(3)
  set receiverDid($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasReceiverDid() => $_has(2);
  @$pb.TagNumber(3)
  void clearReceiverDid() => $_clearField(3);

  @$pb.TagNumber(4)
  FriendMessageType get type => $_getN(3);
  @$pb.TagNumber(4)
  set type(FriendMessageType value) => $_setField(4, value);
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
  $0.Timestamp get sentAt => $_getN(5);
  @$pb.TagNumber(6)
  set sentAt($0.Timestamp value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasSentAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearSentAt() => $_clearField(6);
  @$pb.TagNumber(6)
  $0.Timestamp ensureSentAt() => $_ensure(5);
}

class SyncMessagesRequest extends $pb.GeneratedMessage {
  factory SyncMessagesRequest({
    $core.Iterable<SyncMessageItem>? messages,
  }) {
    final result = create();
    if (messages != null) result.messages.addAll(messages);
    return result;
  }

  SyncMessagesRequest._();

  factory SyncMessagesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SyncMessagesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SyncMessagesRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..pPM<SyncMessageItem>(1, _omitFieldNames ? '' : 'messages',
        subBuilder: SyncMessageItem.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SyncMessagesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SyncMessagesRequest copyWith(void Function(SyncMessagesRequest) updates) =>
      super.copyWith((message) => updates(message as SyncMessagesRequest))
          as SyncMessagesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SyncMessagesRequest create() => SyncMessagesRequest._();
  @$core.override
  SyncMessagesRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SyncMessagesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SyncMessagesRequest>(create);
  static SyncMessagesRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<SyncMessageItem> get messages => $_getList(0);
}

class SyncMessagesResponse extends $pb.GeneratedMessage {
  factory SyncMessagesResponse({
    $core.int? synced,
    $core.Iterable<$core.String>? failed,
  }) {
    final result = create();
    if (synced != null) result.synced = synced;
    if (failed != null) result.failed.addAll(failed);
    return result;
  }

  SyncMessagesResponse._();

  factory SyncMessagesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SyncMessagesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SyncMessagesResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'synced')
    ..pPS(2, _omitFieldNames ? '' : 'failed')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SyncMessagesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SyncMessagesResponse copyWith(void Function(SyncMessagesResponse) updates) =>
      super.copyWith((message) => updates(message as SyncMessagesResponse))
          as SyncMessagesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SyncMessagesResponse create() => SyncMessagesResponse._();
  @$core.override
  SyncMessagesResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SyncMessagesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SyncMessagesResponse>(create);
  static SyncMessagesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get synced => $_getIZ(0);
  @$pb.TagNumber(1)
  set synced($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSynced() => $_has(0);
  @$pb.TagNumber(1)
  void clearSynced() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get failed => $_getList(1);
}

/// MessageAck: acknowledge message delivery/read status
class MessageAckRequest extends $pb.GeneratedMessage {
  factory MessageAckRequest({
    $core.Iterable<$core.String>? ulids,
    $core.int? status,
  }) {
    final result = create();
    if (ulids != null) result.ulids.addAll(ulids);
    if (status != null) result.status = status;
    return result;
  }

  MessageAckRequest._();

  factory MessageAckRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MessageAckRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MessageAckRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..pPS(1, _omitFieldNames ? '' : 'ulids')
    ..aI(2, _omitFieldNames ? '' : 'status')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MessageAckRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MessageAckRequest copyWith(void Function(MessageAckRequest) updates) =>
      super.copyWith((message) => updates(message as MessageAckRequest))
          as MessageAckRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MessageAckRequest create() => MessageAckRequest._();
  @$core.override
  MessageAckRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MessageAckRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MessageAckRequest>(create);
  static MessageAckRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$core.String> get ulids => $_getList(0);

  @$pb.TagNumber(2)
  $core.int get status => $_getIZ(1);
  @$pb.TagNumber(2)
  set status($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasStatus() => $_has(1);
  @$pb.TagNumber(2)
  void clearStatus() => $_clearField(2);
}

class MessageAckResponse extends $pb.GeneratedMessage {
  factory MessageAckResponse() => create();

  MessageAckResponse._();

  factory MessageAckResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MessageAckResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MessageAckResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MessageAckResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MessageAckResponse copyWith(void Function(MessageAckResponse) updates) =>
      super.copyWith((message) => updates(message as MessageAckResponse))
          as MessageAckResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MessageAckResponse create() => MessageAckResponse._();
  @$core.override
  MessageAckResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MessageAckResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MessageAckResponse>(create);
  static MessageAckResponse? _defaultInstance;
}

/// Online/Offline status
class OnlineRequest extends $pb.GeneratedMessage {
  factory OnlineRequest({
    $core.String? did,
  }) {
    final result = create();
    if (did != null) result.did = did;
    return result;
  }

  OnlineRequest._();

  factory OnlineRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory OnlineRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'OnlineRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'did')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OnlineRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OnlineRequest copyWith(void Function(OnlineRequest) updates) =>
      super.copyWith((message) => updates(message as OnlineRequest))
          as OnlineRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static OnlineRequest create() => OnlineRequest._();
  @$core.override
  OnlineRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static OnlineRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<OnlineRequest>(create);
  static OnlineRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get did => $_getSZ(0);
  @$pb.TagNumber(1)
  set did($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasDid() => $_has(0);
  @$pb.TagNumber(1)
  void clearDid() => $_clearField(1);
}

class OnlineResponse extends $pb.GeneratedMessage {
  factory OnlineResponse({
    $core.String? status,
  }) {
    final result = create();
    if (status != null) result.status = status;
    return result;
  }

  OnlineResponse._();

  factory OnlineResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory OnlineResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'OnlineResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'status')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OnlineResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OnlineResponse copyWith(void Function(OnlineResponse) updates) =>
      super.copyWith((message) => updates(message as OnlineResponse))
          as OnlineResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static OnlineResponse create() => OnlineResponse._();
  @$core.override
  OnlineResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static OnlineResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<OnlineResponse>(create);
  static OnlineResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get status => $_getSZ(0);
  @$pb.TagNumber(1)
  set status($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasStatus() => $_has(0);
  @$pb.TagNumber(1)
  void clearStatus() => $_clearField(1);
}

/// Pending offline messages
class GetPendingRequest extends $pb.GeneratedMessage {
  factory GetPendingRequest({
    $core.int? limit,
  }) {
    final result = create();
    if (limit != null) result.limit = limit;
    return result;
  }

  GetPendingRequest._();

  factory GetPendingRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetPendingRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPendingRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPendingRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPendingRequest copyWith(void Function(GetPendingRequest) updates) =>
      super.copyWith((message) => updates(message as GetPendingRequest))
          as GetPendingRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetPendingRequest create() => GetPendingRequest._();
  @$core.override
  GetPendingRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetPendingRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPendingRequest>(create);
  static GetPendingRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get limit => $_getIZ(0);
  @$pb.TagNumber(1)
  set limit($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasLimit() => $_has(0);
  @$pb.TagNumber(1)
  void clearLimit() => $_clearField(1);
}

class PendingMessageInfo extends $pb.GeneratedMessage {
  factory PendingMessageInfo({
    $core.String? ulid,
    $core.String? senderDid,
    $core.String? sessionUlid,
    $core.List<$core.int>? encryptedPayload,
    $fixnum.Int64? createdAt,
  }) {
    final result = create();
    if (ulid != null) result.ulid = ulid;
    if (senderDid != null) result.senderDid = senderDid;
    if (sessionUlid != null) result.sessionUlid = sessionUlid;
    if (encryptedPayload != null) result.encryptedPayload = encryptedPayload;
    if (createdAt != null) result.createdAt = createdAt;
    return result;
  }

  PendingMessageInfo._();

  factory PendingMessageInfo.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PendingMessageInfo.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PendingMessageInfo',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'ulid')
    ..aOS(2, _omitFieldNames ? '' : 'senderDid')
    ..aOS(3, _omitFieldNames ? '' : 'sessionUlid')
    ..a<$core.List<$core.int>>(
        4, _omitFieldNames ? '' : 'encryptedPayload', $pb.PbFieldType.OY)
    ..aInt64(5, _omitFieldNames ? '' : 'createdAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PendingMessageInfo clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PendingMessageInfo copyWith(void Function(PendingMessageInfo) updates) =>
      super.copyWith((message) => updates(message as PendingMessageInfo))
          as PendingMessageInfo;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PendingMessageInfo create() => PendingMessageInfo._();
  @$core.override
  PendingMessageInfo createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PendingMessageInfo getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PendingMessageInfo>(create);
  static PendingMessageInfo? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get ulid => $_getSZ(0);
  @$pb.TagNumber(1)
  set ulid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get senderDid => $_getSZ(1);
  @$pb.TagNumber(2)
  set senderDid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSenderDid() => $_has(1);
  @$pb.TagNumber(2)
  void clearSenderDid() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get sessionUlid => $_getSZ(2);
  @$pb.TagNumber(3)
  set sessionUlid($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSessionUlid() => $_has(2);
  @$pb.TagNumber(3)
  void clearSessionUlid() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.List<$core.int> get encryptedPayload => $_getN(3);
  @$pb.TagNumber(4)
  set encryptedPayload($core.List<$core.int> value) => $_setBytes(3, value);
  @$pb.TagNumber(4)
  $core.bool hasEncryptedPayload() => $_has(3);
  @$pb.TagNumber(4)
  void clearEncryptedPayload() => $_clearField(4);

  @$pb.TagNumber(5)
  $fixnum.Int64 get createdAt => $_getI64(4);
  @$pb.TagNumber(5)
  set createdAt($fixnum.Int64 value) => $_setInt64(4, value);
  @$pb.TagNumber(5)
  $core.bool hasCreatedAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearCreatedAt() => $_clearField(5);
}

class GetPendingResponse extends $pb.GeneratedMessage {
  factory GetPendingResponse({
    $core.Iterable<PendingMessageInfo>? messages,
  }) {
    final result = create();
    if (messages != null) result.messages.addAll(messages);
    return result;
  }

  GetPendingResponse._();

  factory GetPendingResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetPendingResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPendingResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..pPM<PendingMessageInfo>(1, _omitFieldNames ? '' : 'messages',
        subBuilder: PendingMessageInfo.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPendingResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPendingResponse copyWith(void Function(GetPendingResponse) updates) =>
      super.copyWith((message) => updates(message as GetPendingResponse))
          as GetPendingResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetPendingResponse create() => GetPendingResponse._();
  @$core.override
  GetPendingResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetPendingResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPendingResponse>(create);
  static GetPendingResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<PendingMessageInfo> get messages => $_getList(0);
}

/// Stats
class GetStatsRequest extends $pb.GeneratedMessage {
  factory GetStatsRequest() => create();

  GetStatsRequest._();

  factory GetStatsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetStatsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetStatsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetStatsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetStatsRequest copyWith(void Function(GetStatsRequest) updates) =>
      super.copyWith((message) => updates(message as GetStatsRequest))
          as GetStatsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetStatsRequest create() => GetStatsRequest._();
  @$core.override
  GetStatsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetStatsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetStatsRequest>(create);
  static GetStatsRequest? _defaultInstance;
}

class GetStatsResponse extends $pb.GeneratedMessage {
  factory GetStatsResponse({
    $core.int? onlinePeers,
    $fixnum.Int64? pendingMessages,
    $core.String? status,
  }) {
    final result = create();
    if (onlinePeers != null) result.onlinePeers = onlinePeers;
    if (pendingMessages != null) result.pendingMessages = pendingMessages;
    if (status != null) result.status = status;
    return result;
  }

  GetStatsResponse._();

  factory GetStatsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetStatsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetStatsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'onlinePeers')
    ..aInt64(2, _omitFieldNames ? '' : 'pendingMessages')
    ..aOS(3, _omitFieldNames ? '' : 'status')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetStatsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetStatsResponse copyWith(void Function(GetStatsResponse) updates) =>
      super.copyWith((message) => updates(message as GetStatsResponse))
          as GetStatsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetStatsResponse create() => GetStatsResponse._();
  @$core.override
  GetStatsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetStatsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetStatsResponse>(create);
  static GetStatsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get onlinePeers => $_getIZ(0);
  @$pb.TagNumber(1)
  set onlinePeers($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasOnlinePeers() => $_has(0);
  @$pb.TagNumber(1)
  void clearOnlinePeers() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get pendingMessages => $_getI64(1);
  @$pb.TagNumber(2)
  set pendingMessages($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPendingMessages() => $_has(1);
  @$pb.TagNumber(2)
  void clearPendingMessages() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get status => $_getSZ(2);
  @$pb.TagNumber(3)
  set status($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasStatus() => $_has(2);
  @$pb.TagNumber(3)
  void clearStatus() => $_clearField(3);
}

/// Common empty request for APIs that don't need parameters
class EmptyRequest extends $pb.GeneratedMessage {
  factory EmptyRequest() => create();

  EmptyRequest._();

  factory EmptyRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory EmptyRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'EmptyRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  EmptyRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  EmptyRequest copyWith(void Function(EmptyRequest) updates) =>
      super.copyWith((message) => updates(message as EmptyRequest))
          as EmptyRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static EmptyRequest create() => EmptyRequest._();
  @$core.override
  EmptyRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static EmptyRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<EmptyRequest>(create);
  static EmptyRequest? _defaultInstance;
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
