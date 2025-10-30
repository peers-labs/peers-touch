// This is a generated file - do not edit.
//
// Generated from communication.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

import 'communication.pbenum.dart';
import 'connection.pb.dart' as $2;
import 'google/protobuf/timestamp.pb.dart' as $1;
import 'identity.pb.dart' as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'communication.pbenum.dart';

/// MessageID represents a unique identifier for a message.
class MessageID extends $pb.GeneratedMessage {
  factory MessageID({
    $core.String? value,
  }) {
    final result = create();
    if (value != null) result.value = value;
    return result;
  }

  MessageID._();

  factory MessageID.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MessageID.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MessageID',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'value')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MessageID clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MessageID copyWith(void Function(MessageID) updates) =>
      super.copyWith((message) => updates(message as MessageID)) as MessageID;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MessageID create() => MessageID._();
  @$core.override
  MessageID createEmptyInstance() => create();
  static $pb.PbList<MessageID> createRepeated() => $pb.PbList<MessageID>();
  @$core.pragma('dart2js:noInline')
  static MessageID getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<MessageID>(create);
  static MessageID? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get value => $_getSZ(0);
  @$pb.TagNumber(1)
  set value($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasValue() => $_has(0);
  @$pb.TagNumber(1)
  void clearValue() => $_clearField(1);
}

/// StreamID represents a unique identifier for a stream.
class StreamID extends $pb.GeneratedMessage {
  factory StreamID({
    $core.String? value,
  }) {
    final result = create();
    if (value != null) result.value = value;
    return result;
  }

  StreamID._();

  factory StreamID.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory StreamID.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'StreamID',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'value')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StreamID clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StreamID copyWith(void Function(StreamID) updates) =>
      super.copyWith((message) => updates(message as StreamID)) as StreamID;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static StreamID create() => StreamID._();
  @$core.override
  StreamID createEmptyInstance() => create();
  static $pb.PbList<StreamID> createRepeated() => $pb.PbList<StreamID>();
  @$core.pragma('dart2js:noInline')
  static StreamID getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<StreamID>(create);
  static StreamID? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get value => $_getSZ(0);
  @$pb.TagNumber(1)
  set value($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasValue() => $_has(0);
  @$pb.TagNumber(1)
  void clearValue() => $_clearField(1);
}

/// TopicID represents a unique identifier for a topic.
class TopicID extends $pb.GeneratedMessage {
  factory TopicID({
    $core.String? value,
  }) {
    final result = create();
    if (value != null) result.value = value;
    return result;
  }

  TopicID._();

  factory TopicID.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory TopicID.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TopicID',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'value')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TopicID clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TopicID copyWith(void Function(TopicID) updates) =>
      super.copyWith((message) => updates(message as TopicID)) as TopicID;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static TopicID create() => TopicID._();
  @$core.override
  TopicID createEmptyInstance() => create();
  static $pb.PbList<TopicID> createRepeated() => $pb.PbList<TopicID>();
  @$core.pragma('dart2js:noInline')
  static TopicID getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<TopicID>(create);
  static TopicID? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get value => $_getSZ(0);
  @$pb.TagNumber(1)
  set value($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasValue() => $_has(0);
  @$pb.TagNumber(1)
  void clearValue() => $_clearField(1);
}

/// Message represents a message in the communication system.
class Message extends $pb.GeneratedMessage {
  factory Message({
    MessageID? id,
    $0.IdentityID? sender,
    $core.Iterable<$0.IdentityID>? recipients,
    MessageType? type,
    MessagePriority? priority,
    $core.List<$core.int>? payload,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? headers,
    $1.Timestamp? createdAt,
    $1.Timestamp? expiresAt,
    $core.String? correlationId,
    $core.String? replyTo,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (sender != null) result.sender = sender;
    if (recipients != null) result.recipients.addAll(recipients);
    if (type != null) result.type = type;
    if (priority != null) result.priority = priority;
    if (payload != null) result.payload = payload;
    if (headers != null) result.headers.addEntries(headers);
    if (createdAt != null) result.createdAt = createdAt;
    if (expiresAt != null) result.expiresAt = expiresAt;
    if (correlationId != null) result.correlationId = correlationId;
    if (replyTo != null) result.replyTo = replyTo;
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
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<MessageID>(1, _omitFieldNames ? '' : 'id',
        subBuilder: MessageID.create)
    ..aOM<$0.IdentityID>(2, _omitFieldNames ? '' : 'sender',
        subBuilder: $0.IdentityID.create)
    ..pPM<$0.IdentityID>(3, _omitFieldNames ? '' : 'recipients',
        subBuilder: $0.IdentityID.create)
    ..aE<MessageType>(4, _omitFieldNames ? '' : 'type',
        enumValues: MessageType.values)
    ..aE<MessagePriority>(5, _omitFieldNames ? '' : 'priority',
        enumValues: MessagePriority.values)
    ..a<$core.List<$core.int>>(
        6, _omitFieldNames ? '' : 'payload', $pb.PbFieldType.OY)
    ..m<$core.String, $core.String>(7, _omitFieldNames ? '' : 'headers',
        entryClassName: 'Message.HeadersEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..aOM<$1.Timestamp>(8, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $1.Timestamp.create)
    ..aOM<$1.Timestamp>(9, _omitFieldNames ? '' : 'expiresAt',
        subBuilder: $1.Timestamp.create)
    ..aOS(10, _omitFieldNames ? '' : 'correlationId')
    ..aOS(11, _omitFieldNames ? '' : 'replyTo')
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
  static $pb.PbList<Message> createRepeated() => $pb.PbList<Message>();
  @$core.pragma('dart2js:noInline')
  static Message getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Message>(create);
  static Message? _defaultInstance;

  @$pb.TagNumber(1)
  MessageID get id => $_getN(0);
  @$pb.TagNumber(1)
  set id(MessageID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);
  @$pb.TagNumber(1)
  MessageID ensureId() => $_ensure(0);

  @$pb.TagNumber(2)
  $0.IdentityID get sender => $_getN(1);
  @$pb.TagNumber(2)
  set sender($0.IdentityID value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasSender() => $_has(1);
  @$pb.TagNumber(2)
  void clearSender() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.IdentityID ensureSender() => $_ensure(1);

  @$pb.TagNumber(3)
  $pb.PbList<$0.IdentityID> get recipients => $_getList(2);

  @$pb.TagNumber(4)
  MessageType get type => $_getN(3);
  @$pb.TagNumber(4)
  set type(MessageType value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasType() => $_has(3);
  @$pb.TagNumber(4)
  void clearType() => $_clearField(4);

  @$pb.TagNumber(5)
  MessagePriority get priority => $_getN(4);
  @$pb.TagNumber(5)
  set priority(MessagePriority value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasPriority() => $_has(4);
  @$pb.TagNumber(5)
  void clearPriority() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.List<$core.int> get payload => $_getN(5);
  @$pb.TagNumber(6)
  set payload($core.List<$core.int> value) => $_setBytes(5, value);
  @$pb.TagNumber(6)
  $core.bool hasPayload() => $_has(5);
  @$pb.TagNumber(6)
  void clearPayload() => $_clearField(6);

  @$pb.TagNumber(7)
  $pb.PbMap<$core.String, $core.String> get headers => $_getMap(6);

  @$pb.TagNumber(8)
  $1.Timestamp get createdAt => $_getN(7);
  @$pb.TagNumber(8)
  set createdAt($1.Timestamp value) => $_setField(8, value);
  @$pb.TagNumber(8)
  $core.bool hasCreatedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearCreatedAt() => $_clearField(8);
  @$pb.TagNumber(8)
  $1.Timestamp ensureCreatedAt() => $_ensure(7);

  @$pb.TagNumber(9)
  $1.Timestamp get expiresAt => $_getN(8);
  @$pb.TagNumber(9)
  set expiresAt($1.Timestamp value) => $_setField(9, value);
  @$pb.TagNumber(9)
  $core.bool hasExpiresAt() => $_has(8);
  @$pb.TagNumber(9)
  void clearExpiresAt() => $_clearField(9);
  @$pb.TagNumber(9)
  $1.Timestamp ensureExpiresAt() => $_ensure(8);

  @$pb.TagNumber(10)
  $core.String get correlationId => $_getSZ(9);
  @$pb.TagNumber(10)
  set correlationId($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasCorrelationId() => $_has(9);
  @$pb.TagNumber(10)
  void clearCorrelationId() => $_clearField(10);

  @$pb.TagNumber(11)
  $core.String get replyTo => $_getSZ(10);
  @$pb.TagNumber(11)
  set replyTo($core.String value) => $_setString(10, value);
  @$pb.TagNumber(11)
  $core.bool hasReplyTo() => $_has(10);
  @$pb.TagNumber(11)
  void clearReplyTo() => $_clearField(11);
}

/// StreamInfo contains metadata about a stream.
class StreamInfo extends $pb.GeneratedMessage {
  factory StreamInfo({
    StreamID? id,
    $0.IdentityID? localPeer,
    $0.IdentityID? remotePeer,
    $2.LinkID? linkId,
    $core.String? protocol,
    $core.bool? isBidirectional,
    $core.bool? isReliable,
    $core.bool? isOrdered,
    $1.Timestamp? createdAt,
    $1.Timestamp? lastActivity,
    $fixnum.Int64? bytesSent,
    $fixnum.Int64? bytesReceived,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (localPeer != null) result.localPeer = localPeer;
    if (remotePeer != null) result.remotePeer = remotePeer;
    if (linkId != null) result.linkId = linkId;
    if (protocol != null) result.protocol = protocol;
    if (isBidirectional != null) result.isBidirectional = isBidirectional;
    if (isReliable != null) result.isReliable = isReliable;
    if (isOrdered != null) result.isOrdered = isOrdered;
    if (createdAt != null) result.createdAt = createdAt;
    if (lastActivity != null) result.lastActivity = lastActivity;
    if (bytesSent != null) result.bytesSent = bytesSent;
    if (bytesReceived != null) result.bytesReceived = bytesReceived;
    return result;
  }

  StreamInfo._();

  factory StreamInfo.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory StreamInfo.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'StreamInfo',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<StreamID>(1, _omitFieldNames ? '' : 'id', subBuilder: StreamID.create)
    ..aOM<$0.IdentityID>(2, _omitFieldNames ? '' : 'localPeer',
        subBuilder: $0.IdentityID.create)
    ..aOM<$0.IdentityID>(3, _omitFieldNames ? '' : 'remotePeer',
        subBuilder: $0.IdentityID.create)
    ..aOM<$2.LinkID>(4, _omitFieldNames ? '' : 'linkId',
        subBuilder: $2.LinkID.create)
    ..aOS(5, _omitFieldNames ? '' : 'protocol')
    ..aOB(6, _omitFieldNames ? '' : 'isBidirectional')
    ..aOB(7, _omitFieldNames ? '' : 'isReliable')
    ..aOB(8, _omitFieldNames ? '' : 'isOrdered')
    ..aOM<$1.Timestamp>(9, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $1.Timestamp.create)
    ..aOM<$1.Timestamp>(10, _omitFieldNames ? '' : 'lastActivity',
        subBuilder: $1.Timestamp.create)
    ..a<$fixnum.Int64>(
        11, _omitFieldNames ? '' : 'bytesSent', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..a<$fixnum.Int64>(
        12, _omitFieldNames ? '' : 'bytesReceived', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StreamInfo clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StreamInfo copyWith(void Function(StreamInfo) updates) =>
      super.copyWith((message) => updates(message as StreamInfo)) as StreamInfo;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static StreamInfo create() => StreamInfo._();
  @$core.override
  StreamInfo createEmptyInstance() => create();
  static $pb.PbList<StreamInfo> createRepeated() => $pb.PbList<StreamInfo>();
  @$core.pragma('dart2js:noInline')
  static StreamInfo getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<StreamInfo>(create);
  static StreamInfo? _defaultInstance;

  @$pb.TagNumber(1)
  StreamID get id => $_getN(0);
  @$pb.TagNumber(1)
  set id(StreamID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);
  @$pb.TagNumber(1)
  StreamID ensureId() => $_ensure(0);

  @$pb.TagNumber(2)
  $0.IdentityID get localPeer => $_getN(1);
  @$pb.TagNumber(2)
  set localPeer($0.IdentityID value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasLocalPeer() => $_has(1);
  @$pb.TagNumber(2)
  void clearLocalPeer() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.IdentityID ensureLocalPeer() => $_ensure(1);

  @$pb.TagNumber(3)
  $0.IdentityID get remotePeer => $_getN(2);
  @$pb.TagNumber(3)
  set remotePeer($0.IdentityID value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasRemotePeer() => $_has(2);
  @$pb.TagNumber(3)
  void clearRemotePeer() => $_clearField(3);
  @$pb.TagNumber(3)
  $0.IdentityID ensureRemotePeer() => $_ensure(2);

  @$pb.TagNumber(4)
  $2.LinkID get linkId => $_getN(3);
  @$pb.TagNumber(4)
  set linkId($2.LinkID value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasLinkId() => $_has(3);
  @$pb.TagNumber(4)
  void clearLinkId() => $_clearField(4);
  @$pb.TagNumber(4)
  $2.LinkID ensureLinkId() => $_ensure(3);

  @$pb.TagNumber(5)
  $core.String get protocol => $_getSZ(4);
  @$pb.TagNumber(5)
  set protocol($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasProtocol() => $_has(4);
  @$pb.TagNumber(5)
  void clearProtocol() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.bool get isBidirectional => $_getBF(5);
  @$pb.TagNumber(6)
  set isBidirectional($core.bool value) => $_setBool(5, value);
  @$pb.TagNumber(6)
  $core.bool hasIsBidirectional() => $_has(5);
  @$pb.TagNumber(6)
  void clearIsBidirectional() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.bool get isReliable => $_getBF(6);
  @$pb.TagNumber(7)
  set isReliable($core.bool value) => $_setBool(6, value);
  @$pb.TagNumber(7)
  $core.bool hasIsReliable() => $_has(6);
  @$pb.TagNumber(7)
  void clearIsReliable() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.bool get isOrdered => $_getBF(7);
  @$pb.TagNumber(8)
  set isOrdered($core.bool value) => $_setBool(7, value);
  @$pb.TagNumber(8)
  $core.bool hasIsOrdered() => $_has(7);
  @$pb.TagNumber(8)
  void clearIsOrdered() => $_clearField(8);

  @$pb.TagNumber(9)
  $1.Timestamp get createdAt => $_getN(8);
  @$pb.TagNumber(9)
  set createdAt($1.Timestamp value) => $_setField(9, value);
  @$pb.TagNumber(9)
  $core.bool hasCreatedAt() => $_has(8);
  @$pb.TagNumber(9)
  void clearCreatedAt() => $_clearField(9);
  @$pb.TagNumber(9)
  $1.Timestamp ensureCreatedAt() => $_ensure(8);

  @$pb.TagNumber(10)
  $1.Timestamp get lastActivity => $_getN(9);
  @$pb.TagNumber(10)
  set lastActivity($1.Timestamp value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasLastActivity() => $_has(9);
  @$pb.TagNumber(10)
  void clearLastActivity() => $_clearField(10);
  @$pb.TagNumber(10)
  $1.Timestamp ensureLastActivity() => $_ensure(9);

  @$pb.TagNumber(11)
  $fixnum.Int64 get bytesSent => $_getI64(10);
  @$pb.TagNumber(11)
  set bytesSent($fixnum.Int64 value) => $_setInt64(10, value);
  @$pb.TagNumber(11)
  $core.bool hasBytesSent() => $_has(10);
  @$pb.TagNumber(11)
  void clearBytesSent() => $_clearField(11);

  @$pb.TagNumber(12)
  $fixnum.Int64 get bytesReceived => $_getI64(11);
  @$pb.TagNumber(12)
  set bytesReceived($fixnum.Int64 value) => $_setInt64(11, value);
  @$pb.TagNumber(12)
  $core.bool hasBytesReceived() => $_has(11);
  @$pb.TagNumber(12)
  void clearBytesReceived() => $_clearField(12);
}

/// TopicInfo contains metadata about a topic.
class TopicInfo extends $pb.GeneratedMessage {
  factory TopicInfo({
    TopicID? id,
    $core.String? name,
    $core.String? description,
    $core.Iterable<$0.IdentityID>? subscribers,
    $core.Iterable<$0.IdentityID>? publishers,
    $1.Timestamp? createdAt,
    $fixnum.Int64? messageCount,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? metadata,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (name != null) result.name = name;
    if (description != null) result.description = description;
    if (subscribers != null) result.subscribers.addAll(subscribers);
    if (publishers != null) result.publishers.addAll(publishers);
    if (createdAt != null) result.createdAt = createdAt;
    if (messageCount != null) result.messageCount = messageCount;
    if (metadata != null) result.metadata.addEntries(metadata);
    return result;
  }

  TopicInfo._();

  factory TopicInfo.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory TopicInfo.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TopicInfo',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<TopicID>(1, _omitFieldNames ? '' : 'id', subBuilder: TopicID.create)
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'description')
    ..pPM<$0.IdentityID>(4, _omitFieldNames ? '' : 'subscribers',
        subBuilder: $0.IdentityID.create)
    ..pPM<$0.IdentityID>(5, _omitFieldNames ? '' : 'publishers',
        subBuilder: $0.IdentityID.create)
    ..aOM<$1.Timestamp>(6, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $1.Timestamp.create)
    ..a<$fixnum.Int64>(
        7, _omitFieldNames ? '' : 'messageCount', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..m<$core.String, $core.String>(8, _omitFieldNames ? '' : 'metadata',
        entryClassName: 'TopicInfo.MetadataEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TopicInfo clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TopicInfo copyWith(void Function(TopicInfo) updates) =>
      super.copyWith((message) => updates(message as TopicInfo)) as TopicInfo;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static TopicInfo create() => TopicInfo._();
  @$core.override
  TopicInfo createEmptyInstance() => create();
  static $pb.PbList<TopicInfo> createRepeated() => $pb.PbList<TopicInfo>();
  @$core.pragma('dart2js:noInline')
  static TopicInfo getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<TopicInfo>(create);
  static TopicInfo? _defaultInstance;

  @$pb.TagNumber(1)
  TopicID get id => $_getN(0);
  @$pb.TagNumber(1)
  set id(TopicID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);
  @$pb.TagNumber(1)
  TopicID ensureId() => $_ensure(0);

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
  $pb.PbList<$0.IdentityID> get subscribers => $_getList(3);

  @$pb.TagNumber(5)
  $pb.PbList<$0.IdentityID> get publishers => $_getList(4);

  @$pb.TagNumber(6)
  $1.Timestamp get createdAt => $_getN(5);
  @$pb.TagNumber(6)
  set createdAt($1.Timestamp value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasCreatedAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearCreatedAt() => $_clearField(6);
  @$pb.TagNumber(6)
  $1.Timestamp ensureCreatedAt() => $_ensure(5);

  @$pb.TagNumber(7)
  $fixnum.Int64 get messageCount => $_getI64(6);
  @$pb.TagNumber(7)
  set messageCount($fixnum.Int64 value) => $_setInt64(6, value);
  @$pb.TagNumber(7)
  $core.bool hasMessageCount() => $_has(6);
  @$pb.TagNumber(7)
  void clearMessageCount() => $_clearField(7);

  @$pb.TagNumber(8)
  $pb.PbMap<$core.String, $core.String> get metadata => $_getMap(7);
}

/// SendOptions contains options for sending messages.
class SendOptions extends $pb.GeneratedMessage {
  factory SendOptions({
    MessagePriority? priority,
    DeliveryMode? deliveryMode,
    $fixnum.Int64? timeoutMs,
    $core.int? maxRetries,
    $core.bool? requireAck,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? headers,
  }) {
    final result = create();
    if (priority != null) result.priority = priority;
    if (deliveryMode != null) result.deliveryMode = deliveryMode;
    if (timeoutMs != null) result.timeoutMs = timeoutMs;
    if (maxRetries != null) result.maxRetries = maxRetries;
    if (requireAck != null) result.requireAck = requireAck;
    if (headers != null) result.headers.addEntries(headers);
    return result;
  }

  SendOptions._();

  factory SendOptions.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SendOptions.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SendOptions',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aE<MessagePriority>(1, _omitFieldNames ? '' : 'priority',
        enumValues: MessagePriority.values)
    ..aE<DeliveryMode>(2, _omitFieldNames ? '' : 'deliveryMode',
        enumValues: DeliveryMode.values)
    ..aInt64(3, _omitFieldNames ? '' : 'timeoutMs')
    ..aI(4, _omitFieldNames ? '' : 'maxRetries')
    ..aOB(5, _omitFieldNames ? '' : 'requireAck')
    ..m<$core.String, $core.String>(6, _omitFieldNames ? '' : 'headers',
        entryClassName: 'SendOptions.HeadersEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SendOptions clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SendOptions copyWith(void Function(SendOptions) updates) =>
      super.copyWith((message) => updates(message as SendOptions))
          as SendOptions;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SendOptions create() => SendOptions._();
  @$core.override
  SendOptions createEmptyInstance() => create();
  static $pb.PbList<SendOptions> createRepeated() => $pb.PbList<SendOptions>();
  @$core.pragma('dart2js:noInline')
  static SendOptions getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SendOptions>(create);
  static SendOptions? _defaultInstance;

  @$pb.TagNumber(1)
  MessagePriority get priority => $_getN(0);
  @$pb.TagNumber(1)
  set priority(MessagePriority value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPriority() => $_has(0);
  @$pb.TagNumber(1)
  void clearPriority() => $_clearField(1);

  @$pb.TagNumber(2)
  DeliveryMode get deliveryMode => $_getN(1);
  @$pb.TagNumber(2)
  set deliveryMode(DeliveryMode value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasDeliveryMode() => $_has(1);
  @$pb.TagNumber(2)
  void clearDeliveryMode() => $_clearField(2);

  @$pb.TagNumber(3)
  $fixnum.Int64 get timeoutMs => $_getI64(2);
  @$pb.TagNumber(3)
  set timeoutMs($fixnum.Int64 value) => $_setInt64(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTimeoutMs() => $_has(2);
  @$pb.TagNumber(3)
  void clearTimeoutMs() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get maxRetries => $_getIZ(3);
  @$pb.TagNumber(4)
  set maxRetries($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasMaxRetries() => $_has(3);
  @$pb.TagNumber(4)
  void clearMaxRetries() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.bool get requireAck => $_getBF(4);
  @$pb.TagNumber(5)
  set requireAck($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasRequireAck() => $_has(4);
  @$pb.TagNumber(5)
  void clearRequireAck() => $_clearField(5);

  @$pb.TagNumber(6)
  $pb.PbMap<$core.String, $core.String> get headers => $_getMap(5);
}

/// ReceiveOptions contains options for receiving messages.
class ReceiveOptions extends $pb.GeneratedMessage {
  factory ReceiveOptions({
    $fixnum.Int64? timeoutMs,
    $core.int? maxMessages,
    MessageType? typeFilter,
    $0.IdentityID? senderFilter,
  }) {
    final result = create();
    if (timeoutMs != null) result.timeoutMs = timeoutMs;
    if (maxMessages != null) result.maxMessages = maxMessages;
    if (typeFilter != null) result.typeFilter = typeFilter;
    if (senderFilter != null) result.senderFilter = senderFilter;
    return result;
  }

  ReceiveOptions._();

  factory ReceiveOptions.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ReceiveOptions.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ReceiveOptions',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aInt64(1, _omitFieldNames ? '' : 'timeoutMs')
    ..aI(2, _omitFieldNames ? '' : 'maxMessages')
    ..aE<MessageType>(3, _omitFieldNames ? '' : 'typeFilter',
        enumValues: MessageType.values)
    ..aOM<$0.IdentityID>(4, _omitFieldNames ? '' : 'senderFilter',
        subBuilder: $0.IdentityID.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReceiveOptions clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReceiveOptions copyWith(void Function(ReceiveOptions) updates) =>
      super.copyWith((message) => updates(message as ReceiveOptions))
          as ReceiveOptions;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ReceiveOptions create() => ReceiveOptions._();
  @$core.override
  ReceiveOptions createEmptyInstance() => create();
  static $pb.PbList<ReceiveOptions> createRepeated() =>
      $pb.PbList<ReceiveOptions>();
  @$core.pragma('dart2js:noInline')
  static ReceiveOptions getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ReceiveOptions>(create);
  static ReceiveOptions? _defaultInstance;

  @$pb.TagNumber(1)
  $fixnum.Int64 get timeoutMs => $_getI64(0);
  @$pb.TagNumber(1)
  set timeoutMs($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTimeoutMs() => $_has(0);
  @$pb.TagNumber(1)
  void clearTimeoutMs() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get maxMessages => $_getIZ(1);
  @$pb.TagNumber(2)
  set maxMessages($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasMaxMessages() => $_has(1);
  @$pb.TagNumber(2)
  void clearMaxMessages() => $_clearField(2);

  @$pb.TagNumber(3)
  MessageType get typeFilter => $_getN(2);
  @$pb.TagNumber(3)
  set typeFilter(MessageType value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasTypeFilter() => $_has(2);
  @$pb.TagNumber(3)
  void clearTypeFilter() => $_clearField(3);

  @$pb.TagNumber(4)
  $0.IdentityID get senderFilter => $_getN(3);
  @$pb.TagNumber(4)
  set senderFilter($0.IdentityID value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSenderFilter() => $_has(3);
  @$pb.TagNumber(4)
  void clearSenderFilter() => $_clearField(4);
  @$pb.TagNumber(4)
  $0.IdentityID ensureSenderFilter() => $_ensure(3);
}

/// StreamOptions contains options for creating streams.
class StreamOptions extends $pb.GeneratedMessage {
  factory StreamOptions({
    $core.String? protocol,
    $core.bool? bidirectional,
    $core.bool? reliable,
    $core.bool? ordered,
    $core.int? bufferSize,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? metadata,
  }) {
    final result = create();
    if (protocol != null) result.protocol = protocol;
    if (bidirectional != null) result.bidirectional = bidirectional;
    if (reliable != null) result.reliable = reliable;
    if (ordered != null) result.ordered = ordered;
    if (bufferSize != null) result.bufferSize = bufferSize;
    if (metadata != null) result.metadata.addEntries(metadata);
    return result;
  }

  StreamOptions._();

  factory StreamOptions.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory StreamOptions.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'StreamOptions',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'protocol')
    ..aOB(2, _omitFieldNames ? '' : 'bidirectional')
    ..aOB(3, _omitFieldNames ? '' : 'reliable')
    ..aOB(4, _omitFieldNames ? '' : 'ordered')
    ..aI(5, _omitFieldNames ? '' : 'bufferSize')
    ..m<$core.String, $core.String>(6, _omitFieldNames ? '' : 'metadata',
        entryClassName: 'StreamOptions.MetadataEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StreamOptions clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StreamOptions copyWith(void Function(StreamOptions) updates) =>
      super.copyWith((message) => updates(message as StreamOptions))
          as StreamOptions;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static StreamOptions create() => StreamOptions._();
  @$core.override
  StreamOptions createEmptyInstance() => create();
  static $pb.PbList<StreamOptions> createRepeated() =>
      $pb.PbList<StreamOptions>();
  @$core.pragma('dart2js:noInline')
  static StreamOptions getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<StreamOptions>(create);
  static StreamOptions? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get protocol => $_getSZ(0);
  @$pb.TagNumber(1)
  set protocol($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasProtocol() => $_has(0);
  @$pb.TagNumber(1)
  void clearProtocol() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.bool get bidirectional => $_getBF(1);
  @$pb.TagNumber(2)
  set bidirectional($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasBidirectional() => $_has(1);
  @$pb.TagNumber(2)
  void clearBidirectional() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.bool get reliable => $_getBF(2);
  @$pb.TagNumber(3)
  set reliable($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasReliable() => $_has(2);
  @$pb.TagNumber(3)
  void clearReliable() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.bool get ordered => $_getBF(3);
  @$pb.TagNumber(4)
  set ordered($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasOrdered() => $_has(3);
  @$pb.TagNumber(4)
  void clearOrdered() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.int get bufferSize => $_getIZ(4);
  @$pb.TagNumber(5)
  set bufferSize($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasBufferSize() => $_has(4);
  @$pb.TagNumber(5)
  void clearBufferSize() => $_clearField(5);

  @$pb.TagNumber(6)
  $pb.PbMap<$core.String, $core.String> get metadata => $_getMap(5);
}

/// SubscribeOptions contains options for subscribing to topics.
class SubscribeOptions extends $pb.GeneratedMessage {
  factory SubscribeOptions({
    MessageType? typeFilter,
    $0.IdentityID? senderFilter,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? metadata,
  }) {
    final result = create();
    if (typeFilter != null) result.typeFilter = typeFilter;
    if (senderFilter != null) result.senderFilter = senderFilter;
    if (metadata != null) result.metadata.addEntries(metadata);
    return result;
  }

  SubscribeOptions._();

  factory SubscribeOptions.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SubscribeOptions.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SubscribeOptions',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aE<MessageType>(1, _omitFieldNames ? '' : 'typeFilter',
        enumValues: MessageType.values)
    ..aOM<$0.IdentityID>(2, _omitFieldNames ? '' : 'senderFilter',
        subBuilder: $0.IdentityID.create)
    ..m<$core.String, $core.String>(3, _omitFieldNames ? '' : 'metadata',
        entryClassName: 'SubscribeOptions.MetadataEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SubscribeOptions clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SubscribeOptions copyWith(void Function(SubscribeOptions) updates) =>
      super.copyWith((message) => updates(message as SubscribeOptions))
          as SubscribeOptions;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SubscribeOptions create() => SubscribeOptions._();
  @$core.override
  SubscribeOptions createEmptyInstance() => create();
  static $pb.PbList<SubscribeOptions> createRepeated() =>
      $pb.PbList<SubscribeOptions>();
  @$core.pragma('dart2js:noInline')
  static SubscribeOptions getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SubscribeOptions>(create);
  static SubscribeOptions? _defaultInstance;

  @$pb.TagNumber(1)
  MessageType get typeFilter => $_getN(0);
  @$pb.TagNumber(1)
  set typeFilter(MessageType value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTypeFilter() => $_has(0);
  @$pb.TagNumber(1)
  void clearTypeFilter() => $_clearField(1);

  @$pb.TagNumber(2)
  $0.IdentityID get senderFilter => $_getN(1);
  @$pb.TagNumber(2)
  set senderFilter($0.IdentityID value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasSenderFilter() => $_has(1);
  @$pb.TagNumber(2)
  void clearSenderFilter() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.IdentityID ensureSenderFilter() => $_ensure(1);

  @$pb.TagNumber(3)
  $pb.PbMap<$core.String, $core.String> get metadata => $_getMap(2);
}

/// SendRequest represents a request to send a message.
class SendRequest extends $pb.GeneratedMessage {
  factory SendRequest({
    Message? message,
    SendOptions? options,
  }) {
    final result = create();
    if (message != null) result.message = message;
    if (options != null) result.options = options;
    return result;
  }

  SendRequest._();

  factory SendRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SendRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SendRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<Message>(1, _omitFieldNames ? '' : 'message',
        subBuilder: Message.create)
    ..aOM<SendOptions>(2, _omitFieldNames ? '' : 'options',
        subBuilder: SendOptions.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SendRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SendRequest copyWith(void Function(SendRequest) updates) =>
      super.copyWith((message) => updates(message as SendRequest))
          as SendRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SendRequest create() => SendRequest._();
  @$core.override
  SendRequest createEmptyInstance() => create();
  static $pb.PbList<SendRequest> createRepeated() => $pb.PbList<SendRequest>();
  @$core.pragma('dart2js:noInline')
  static SendRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SendRequest>(create);
  static SendRequest? _defaultInstance;

  @$pb.TagNumber(1)
  Message get message => $_getN(0);
  @$pb.TagNumber(1)
  set message(Message value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasMessage() => $_has(0);
  @$pb.TagNumber(1)
  void clearMessage() => $_clearField(1);
  @$pb.TagNumber(1)
  Message ensureMessage() => $_ensure(0);

  @$pb.TagNumber(2)
  SendOptions get options => $_getN(1);
  @$pb.TagNumber(2)
  set options(SendOptions value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasOptions() => $_has(1);
  @$pb.TagNumber(2)
  void clearOptions() => $_clearField(2);
  @$pb.TagNumber(2)
  SendOptions ensureOptions() => $_ensure(1);
}

/// SendResponse represents the response to a send request.
class SendResponse extends $pb.GeneratedMessage {
  factory SendResponse({
    MessageID? messageId,
    MessageStatus? status,
    $core.String? errorMessage,
  }) {
    final result = create();
    if (messageId != null) result.messageId = messageId;
    if (status != null) result.status = status;
    if (errorMessage != null) result.errorMessage = errorMessage;
    return result;
  }

  SendResponse._();

  factory SendResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SendResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SendResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<MessageID>(1, _omitFieldNames ? '' : 'messageId',
        subBuilder: MessageID.create)
    ..aE<MessageStatus>(2, _omitFieldNames ? '' : 'status',
        enumValues: MessageStatus.values)
    ..aOS(3, _omitFieldNames ? '' : 'errorMessage')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SendResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SendResponse copyWith(void Function(SendResponse) updates) =>
      super.copyWith((message) => updates(message as SendResponse))
          as SendResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SendResponse create() => SendResponse._();
  @$core.override
  SendResponse createEmptyInstance() => create();
  static $pb.PbList<SendResponse> createRepeated() =>
      $pb.PbList<SendResponse>();
  @$core.pragma('dart2js:noInline')
  static SendResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SendResponse>(create);
  static SendResponse? _defaultInstance;

  @$pb.TagNumber(1)
  MessageID get messageId => $_getN(0);
  @$pb.TagNumber(1)
  set messageId(MessageID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasMessageId() => $_has(0);
  @$pb.TagNumber(1)
  void clearMessageId() => $_clearField(1);
  @$pb.TagNumber(1)
  MessageID ensureMessageId() => $_ensure(0);

  @$pb.TagNumber(2)
  MessageStatus get status => $_getN(1);
  @$pb.TagNumber(2)
  set status(MessageStatus value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasStatus() => $_has(1);
  @$pb.TagNumber(2)
  void clearStatus() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get errorMessage => $_getSZ(2);
  @$pb.TagNumber(3)
  set errorMessage($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasErrorMessage() => $_has(2);
  @$pb.TagNumber(3)
  void clearErrorMessage() => $_clearField(3);
}

/// ReceiveRequest represents a request to receive messages.
class ReceiveRequest extends $pb.GeneratedMessage {
  factory ReceiveRequest({
    ReceiveOptions? options,
  }) {
    final result = create();
    if (options != null) result.options = options;
    return result;
  }

  ReceiveRequest._();

  factory ReceiveRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ReceiveRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ReceiveRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<ReceiveOptions>(1, _omitFieldNames ? '' : 'options',
        subBuilder: ReceiveOptions.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReceiveRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReceiveRequest copyWith(void Function(ReceiveRequest) updates) =>
      super.copyWith((message) => updates(message as ReceiveRequest))
          as ReceiveRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ReceiveRequest create() => ReceiveRequest._();
  @$core.override
  ReceiveRequest createEmptyInstance() => create();
  static $pb.PbList<ReceiveRequest> createRepeated() =>
      $pb.PbList<ReceiveRequest>();
  @$core.pragma('dart2js:noInline')
  static ReceiveRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ReceiveRequest>(create);
  static ReceiveRequest? _defaultInstance;

  @$pb.TagNumber(1)
  ReceiveOptions get options => $_getN(0);
  @$pb.TagNumber(1)
  set options(ReceiveOptions value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasOptions() => $_has(0);
  @$pb.TagNumber(1)
  void clearOptions() => $_clearField(1);
  @$pb.TagNumber(1)
  ReceiveOptions ensureOptions() => $_ensure(0);
}

/// ReceiveResponse represents the response to a receive request.
class ReceiveResponse extends $pb.GeneratedMessage {
  factory ReceiveResponse({
    $core.Iterable<Message>? messages,
  }) {
    final result = create();
    if (messages != null) result.messages.addAll(messages);
    return result;
  }

  ReceiveResponse._();

  factory ReceiveResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ReceiveResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ReceiveResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..pPM<Message>(1, _omitFieldNames ? '' : 'messages',
        subBuilder: Message.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReceiveResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReceiveResponse copyWith(void Function(ReceiveResponse) updates) =>
      super.copyWith((message) => updates(message as ReceiveResponse))
          as ReceiveResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ReceiveResponse create() => ReceiveResponse._();
  @$core.override
  ReceiveResponse createEmptyInstance() => create();
  static $pb.PbList<ReceiveResponse> createRepeated() =>
      $pb.PbList<ReceiveResponse>();
  @$core.pragma('dart2js:noInline')
  static ReceiveResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ReceiveResponse>(create);
  static ReceiveResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Message> get messages => $_getList(0);
}

/// CreateStreamRequest represents a request to create a stream.
class CreateStreamRequest extends $pb.GeneratedMessage {
  factory CreateStreamRequest({
    $0.IdentityID? remotePeer,
    $2.LinkID? linkId,
    StreamOptions? options,
  }) {
    final result = create();
    if (remotePeer != null) result.remotePeer = remotePeer;
    if (linkId != null) result.linkId = linkId;
    if (options != null) result.options = options;
    return result;
  }

  CreateStreamRequest._();

  factory CreateStreamRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateStreamRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateStreamRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<$0.IdentityID>(1, _omitFieldNames ? '' : 'remotePeer',
        subBuilder: $0.IdentityID.create)
    ..aOM<$2.LinkID>(2, _omitFieldNames ? '' : 'linkId',
        subBuilder: $2.LinkID.create)
    ..aOM<StreamOptions>(3, _omitFieldNames ? '' : 'options',
        subBuilder: StreamOptions.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateStreamRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateStreamRequest copyWith(void Function(CreateStreamRequest) updates) =>
      super.copyWith((message) => updates(message as CreateStreamRequest))
          as CreateStreamRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateStreamRequest create() => CreateStreamRequest._();
  @$core.override
  CreateStreamRequest createEmptyInstance() => create();
  static $pb.PbList<CreateStreamRequest> createRepeated() =>
      $pb.PbList<CreateStreamRequest>();
  @$core.pragma('dart2js:noInline')
  static CreateStreamRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateStreamRequest>(create);
  static CreateStreamRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $0.IdentityID get remotePeer => $_getN(0);
  @$pb.TagNumber(1)
  set remotePeer($0.IdentityID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasRemotePeer() => $_has(0);
  @$pb.TagNumber(1)
  void clearRemotePeer() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.IdentityID ensureRemotePeer() => $_ensure(0);

  @$pb.TagNumber(2)
  $2.LinkID get linkId => $_getN(1);
  @$pb.TagNumber(2)
  set linkId($2.LinkID value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasLinkId() => $_has(1);
  @$pb.TagNumber(2)
  void clearLinkId() => $_clearField(2);
  @$pb.TagNumber(2)
  $2.LinkID ensureLinkId() => $_ensure(1);

  @$pb.TagNumber(3)
  StreamOptions get options => $_getN(2);
  @$pb.TagNumber(3)
  set options(StreamOptions value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasOptions() => $_has(2);
  @$pb.TagNumber(3)
  void clearOptions() => $_clearField(3);
  @$pb.TagNumber(3)
  StreamOptions ensureOptions() => $_ensure(2);
}

/// CreateStreamResponse represents the response to a stream creation request.
class CreateStreamResponse extends $pb.GeneratedMessage {
  factory CreateStreamResponse({
    StreamInfo? stream,
    $core.String? errorMessage,
  }) {
    final result = create();
    if (stream != null) result.stream = stream;
    if (errorMessage != null) result.errorMessage = errorMessage;
    return result;
  }

  CreateStreamResponse._();

  factory CreateStreamResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateStreamResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateStreamResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<StreamInfo>(1, _omitFieldNames ? '' : 'stream',
        subBuilder: StreamInfo.create)
    ..aOS(2, _omitFieldNames ? '' : 'errorMessage')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateStreamResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateStreamResponse copyWith(void Function(CreateStreamResponse) updates) =>
      super.copyWith((message) => updates(message as CreateStreamResponse))
          as CreateStreamResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateStreamResponse create() => CreateStreamResponse._();
  @$core.override
  CreateStreamResponse createEmptyInstance() => create();
  static $pb.PbList<CreateStreamResponse> createRepeated() =>
      $pb.PbList<CreateStreamResponse>();
  @$core.pragma('dart2js:noInline')
  static CreateStreamResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateStreamResponse>(create);
  static CreateStreamResponse? _defaultInstance;

  @$pb.TagNumber(1)
  StreamInfo get stream => $_getN(0);
  @$pb.TagNumber(1)
  set stream(StreamInfo value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasStream() => $_has(0);
  @$pb.TagNumber(1)
  void clearStream() => $_clearField(1);
  @$pb.TagNumber(1)
  StreamInfo ensureStream() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.String get errorMessage => $_getSZ(1);
  @$pb.TagNumber(2)
  set errorMessage($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasErrorMessage() => $_has(1);
  @$pb.TagNumber(2)
  void clearErrorMessage() => $_clearField(2);
}

/// WriteStreamRequest represents a request to write data to a stream.
class WriteStreamRequest extends $pb.GeneratedMessage {
  factory WriteStreamRequest({
    StreamID? streamId,
    $core.List<$core.int>? data,
  }) {
    final result = create();
    if (streamId != null) result.streamId = streamId;
    if (data != null) result.data = data;
    return result;
  }

  WriteStreamRequest._();

  factory WriteStreamRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory WriteStreamRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'WriteStreamRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<StreamID>(1, _omitFieldNames ? '' : 'streamId',
        subBuilder: StreamID.create)
    ..a<$core.List<$core.int>>(
        2, _omitFieldNames ? '' : 'data', $pb.PbFieldType.OY)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  WriteStreamRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  WriteStreamRequest copyWith(void Function(WriteStreamRequest) updates) =>
      super.copyWith((message) => updates(message as WriteStreamRequest))
          as WriteStreamRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static WriteStreamRequest create() => WriteStreamRequest._();
  @$core.override
  WriteStreamRequest createEmptyInstance() => create();
  static $pb.PbList<WriteStreamRequest> createRepeated() =>
      $pb.PbList<WriteStreamRequest>();
  @$core.pragma('dart2js:noInline')
  static WriteStreamRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<WriteStreamRequest>(create);
  static WriteStreamRequest? _defaultInstance;

  @$pb.TagNumber(1)
  StreamID get streamId => $_getN(0);
  @$pb.TagNumber(1)
  set streamId(StreamID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasStreamId() => $_has(0);
  @$pb.TagNumber(1)
  void clearStreamId() => $_clearField(1);
  @$pb.TagNumber(1)
  StreamID ensureStreamId() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.List<$core.int> get data => $_getN(1);
  @$pb.TagNumber(2)
  set data($core.List<$core.int> value) => $_setBytes(1, value);
  @$pb.TagNumber(2)
  $core.bool hasData() => $_has(1);
  @$pb.TagNumber(2)
  void clearData() => $_clearField(2);
}

/// ReadStreamRequest represents a request to read data from a stream.
class ReadStreamRequest extends $pb.GeneratedMessage {
  factory ReadStreamRequest({
    StreamID? streamId,
    $core.int? maxBytes,
  }) {
    final result = create();
    if (streamId != null) result.streamId = streamId;
    if (maxBytes != null) result.maxBytes = maxBytes;
    return result;
  }

  ReadStreamRequest._();

  factory ReadStreamRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ReadStreamRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ReadStreamRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<StreamID>(1, _omitFieldNames ? '' : 'streamId',
        subBuilder: StreamID.create)
    ..aI(2, _omitFieldNames ? '' : 'maxBytes')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReadStreamRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReadStreamRequest copyWith(void Function(ReadStreamRequest) updates) =>
      super.copyWith((message) => updates(message as ReadStreamRequest))
          as ReadStreamRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ReadStreamRequest create() => ReadStreamRequest._();
  @$core.override
  ReadStreamRequest createEmptyInstance() => create();
  static $pb.PbList<ReadStreamRequest> createRepeated() =>
      $pb.PbList<ReadStreamRequest>();
  @$core.pragma('dart2js:noInline')
  static ReadStreamRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ReadStreamRequest>(create);
  static ReadStreamRequest? _defaultInstance;

  @$pb.TagNumber(1)
  StreamID get streamId => $_getN(0);
  @$pb.TagNumber(1)
  set streamId(StreamID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasStreamId() => $_has(0);
  @$pb.TagNumber(1)
  void clearStreamId() => $_clearField(1);
  @$pb.TagNumber(1)
  StreamID ensureStreamId() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.int get maxBytes => $_getIZ(1);
  @$pb.TagNumber(2)
  set maxBytes($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasMaxBytes() => $_has(1);
  @$pb.TagNumber(2)
  void clearMaxBytes() => $_clearField(2);
}

/// ReadStreamResponse represents the response to a stream read request.
class ReadStreamResponse extends $pb.GeneratedMessage {
  factory ReadStreamResponse({
    $core.List<$core.int>? data,
    $core.bool? eof,
  }) {
    final result = create();
    if (data != null) result.data = data;
    if (eof != null) result.eof = eof;
    return result;
  }

  ReadStreamResponse._();

  factory ReadStreamResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ReadStreamResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ReadStreamResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..a<$core.List<$core.int>>(
        1, _omitFieldNames ? '' : 'data', $pb.PbFieldType.OY)
    ..aOB(2, _omitFieldNames ? '' : 'eof')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReadStreamResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReadStreamResponse copyWith(void Function(ReadStreamResponse) updates) =>
      super.copyWith((message) => updates(message as ReadStreamResponse))
          as ReadStreamResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ReadStreamResponse create() => ReadStreamResponse._();
  @$core.override
  ReadStreamResponse createEmptyInstance() => create();
  static $pb.PbList<ReadStreamResponse> createRepeated() =>
      $pb.PbList<ReadStreamResponse>();
  @$core.pragma('dart2js:noInline')
  static ReadStreamResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ReadStreamResponse>(create);
  static ReadStreamResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.List<$core.int> get data => $_getN(0);
  @$pb.TagNumber(1)
  set data($core.List<$core.int> value) => $_setBytes(0, value);
  @$pb.TagNumber(1)
  $core.bool hasData() => $_has(0);
  @$pb.TagNumber(1)
  void clearData() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.bool get eof => $_getBF(1);
  @$pb.TagNumber(2)
  set eof($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEof() => $_has(1);
  @$pb.TagNumber(2)
  void clearEof() => $_clearField(2);
}

/// CloseStreamRequest represents a request to close a stream.
class CloseStreamRequest extends $pb.GeneratedMessage {
  factory CloseStreamRequest({
    StreamID? streamId,
  }) {
    final result = create();
    if (streamId != null) result.streamId = streamId;
    return result;
  }

  CloseStreamRequest._();

  factory CloseStreamRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CloseStreamRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CloseStreamRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<StreamID>(1, _omitFieldNames ? '' : 'streamId',
        subBuilder: StreamID.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CloseStreamRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CloseStreamRequest copyWith(void Function(CloseStreamRequest) updates) =>
      super.copyWith((message) => updates(message as CloseStreamRequest))
          as CloseStreamRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CloseStreamRequest create() => CloseStreamRequest._();
  @$core.override
  CloseStreamRequest createEmptyInstance() => create();
  static $pb.PbList<CloseStreamRequest> createRepeated() =>
      $pb.PbList<CloseStreamRequest>();
  @$core.pragma('dart2js:noInline')
  static CloseStreamRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CloseStreamRequest>(create);
  static CloseStreamRequest? _defaultInstance;

  @$pb.TagNumber(1)
  StreamID get streamId => $_getN(0);
  @$pb.TagNumber(1)
  set streamId(StreamID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasStreamId() => $_has(0);
  @$pb.TagNumber(1)
  void clearStreamId() => $_clearField(1);
  @$pb.TagNumber(1)
  StreamID ensureStreamId() => $_ensure(0);
}

/// SubscribeRequest represents a request to subscribe to a topic.
class SubscribeRequest extends $pb.GeneratedMessage {
  factory SubscribeRequest({
    TopicID? topicId,
    SubscribeOptions? options,
  }) {
    final result = create();
    if (topicId != null) result.topicId = topicId;
    if (options != null) result.options = options;
    return result;
  }

  SubscribeRequest._();

  factory SubscribeRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SubscribeRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SubscribeRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<TopicID>(1, _omitFieldNames ? '' : 'topicId',
        subBuilder: TopicID.create)
    ..aOM<SubscribeOptions>(2, _omitFieldNames ? '' : 'options',
        subBuilder: SubscribeOptions.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SubscribeRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SubscribeRequest copyWith(void Function(SubscribeRequest) updates) =>
      super.copyWith((message) => updates(message as SubscribeRequest))
          as SubscribeRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SubscribeRequest create() => SubscribeRequest._();
  @$core.override
  SubscribeRequest createEmptyInstance() => create();
  static $pb.PbList<SubscribeRequest> createRepeated() =>
      $pb.PbList<SubscribeRequest>();
  @$core.pragma('dart2js:noInline')
  static SubscribeRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SubscribeRequest>(create);
  static SubscribeRequest? _defaultInstance;

  @$pb.TagNumber(1)
  TopicID get topicId => $_getN(0);
  @$pb.TagNumber(1)
  set topicId(TopicID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTopicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearTopicId() => $_clearField(1);
  @$pb.TagNumber(1)
  TopicID ensureTopicId() => $_ensure(0);

  @$pb.TagNumber(2)
  SubscribeOptions get options => $_getN(1);
  @$pb.TagNumber(2)
  set options(SubscribeOptions value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasOptions() => $_has(1);
  @$pb.TagNumber(2)
  void clearOptions() => $_clearField(2);
  @$pb.TagNumber(2)
  SubscribeOptions ensureOptions() => $_ensure(1);
}

/// UnsubscribeRequest represents a request to unsubscribe from a topic.
class UnsubscribeRequest extends $pb.GeneratedMessage {
  factory UnsubscribeRequest({
    TopicID? topicId,
  }) {
    final result = create();
    if (topicId != null) result.topicId = topicId;
    return result;
  }

  UnsubscribeRequest._();

  factory UnsubscribeRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UnsubscribeRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnsubscribeRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<TopicID>(1, _omitFieldNames ? '' : 'topicId',
        subBuilder: TopicID.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnsubscribeRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnsubscribeRequest copyWith(void Function(UnsubscribeRequest) updates) =>
      super.copyWith((message) => updates(message as UnsubscribeRequest))
          as UnsubscribeRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UnsubscribeRequest create() => UnsubscribeRequest._();
  @$core.override
  UnsubscribeRequest createEmptyInstance() => create();
  static $pb.PbList<UnsubscribeRequest> createRepeated() =>
      $pb.PbList<UnsubscribeRequest>();
  @$core.pragma('dart2js:noInline')
  static UnsubscribeRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UnsubscribeRequest>(create);
  static UnsubscribeRequest? _defaultInstance;

  @$pb.TagNumber(1)
  TopicID get topicId => $_getN(0);
  @$pb.TagNumber(1)
  set topicId(TopicID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTopicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearTopicId() => $_clearField(1);
  @$pb.TagNumber(1)
  TopicID ensureTopicId() => $_ensure(0);
}

/// PublishRequest represents a request to publish a message to a topic.
class PublishRequest extends $pb.GeneratedMessage {
  factory PublishRequest({
    TopicID? topicId,
    Message? message,
  }) {
    final result = create();
    if (topicId != null) result.topicId = topicId;
    if (message != null) result.message = message;
    return result;
  }

  PublishRequest._();

  factory PublishRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PublishRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PublishRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<TopicID>(1, _omitFieldNames ? '' : 'topicId',
        subBuilder: TopicID.create)
    ..aOM<Message>(2, _omitFieldNames ? '' : 'message',
        subBuilder: Message.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishRequest copyWith(void Function(PublishRequest) updates) =>
      super.copyWith((message) => updates(message as PublishRequest))
          as PublishRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PublishRequest create() => PublishRequest._();
  @$core.override
  PublishRequest createEmptyInstance() => create();
  static $pb.PbList<PublishRequest> createRepeated() =>
      $pb.PbList<PublishRequest>();
  @$core.pragma('dart2js:noInline')
  static PublishRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PublishRequest>(create);
  static PublishRequest? _defaultInstance;

  @$pb.TagNumber(1)
  TopicID get topicId => $_getN(0);
  @$pb.TagNumber(1)
  set topicId(TopicID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTopicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearTopicId() => $_clearField(1);
  @$pb.TagNumber(1)
  TopicID ensureTopicId() => $_ensure(0);

  @$pb.TagNumber(2)
  Message get message => $_getN(1);
  @$pb.TagNumber(2)
  set message(Message value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasMessage() => $_has(1);
  @$pb.TagNumber(2)
  void clearMessage() => $_clearField(2);
  @$pb.TagNumber(2)
  Message ensureMessage() => $_ensure(1);
}

/// PublishResponse represents the response to a publish request.
class PublishResponse extends $pb.GeneratedMessage {
  factory PublishResponse({
    MessageID? messageId,
    $core.int? subscriberCount,
    $core.String? errorMessage,
  }) {
    final result = create();
    if (messageId != null) result.messageId = messageId;
    if (subscriberCount != null) result.subscriberCount = subscriberCount;
    if (errorMessage != null) result.errorMessage = errorMessage;
    return result;
  }

  PublishResponse._();

  factory PublishResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PublishResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PublishResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<MessageID>(1, _omitFieldNames ? '' : 'messageId',
        subBuilder: MessageID.create)
    ..aI(2, _omitFieldNames ? '' : 'subscriberCount')
    ..aOS(3, _omitFieldNames ? '' : 'errorMessage')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishResponse copyWith(void Function(PublishResponse) updates) =>
      super.copyWith((message) => updates(message as PublishResponse))
          as PublishResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PublishResponse create() => PublishResponse._();
  @$core.override
  PublishResponse createEmptyInstance() => create();
  static $pb.PbList<PublishResponse> createRepeated() =>
      $pb.PbList<PublishResponse>();
  @$core.pragma('dart2js:noInline')
  static PublishResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PublishResponse>(create);
  static PublishResponse? _defaultInstance;

  @$pb.TagNumber(1)
  MessageID get messageId => $_getN(0);
  @$pb.TagNumber(1)
  set messageId(MessageID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasMessageId() => $_has(0);
  @$pb.TagNumber(1)
  void clearMessageId() => $_clearField(1);
  @$pb.TagNumber(1)
  MessageID ensureMessageId() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.int get subscriberCount => $_getIZ(1);
  @$pb.TagNumber(2)
  set subscriberCount($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSubscriberCount() => $_has(1);
  @$pb.TagNumber(2)
  void clearSubscriberCount() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get errorMessage => $_getSZ(2);
  @$pb.TagNumber(3)
  set errorMessage($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasErrorMessage() => $_has(2);
  @$pb.TagNumber(3)
  void clearErrorMessage() => $_clearField(3);
}

/// ListTopicsRequest represents a request to list available topics.
class ListTopicsRequest extends $pb.GeneratedMessage {
  factory ListTopicsRequest({
    $core.String? nameFilter,
  }) {
    final result = create();
    if (nameFilter != null) result.nameFilter = nameFilter;
    return result;
  }

  ListTopicsRequest._();

  factory ListTopicsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListTopicsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListTopicsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'nameFilter')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListTopicsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListTopicsRequest copyWith(void Function(ListTopicsRequest) updates) =>
      super.copyWith((message) => updates(message as ListTopicsRequest))
          as ListTopicsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListTopicsRequest create() => ListTopicsRequest._();
  @$core.override
  ListTopicsRequest createEmptyInstance() => create();
  static $pb.PbList<ListTopicsRequest> createRepeated() =>
      $pb.PbList<ListTopicsRequest>();
  @$core.pragma('dart2js:noInline')
  static ListTopicsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListTopicsRequest>(create);
  static ListTopicsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get nameFilter => $_getSZ(0);
  @$pb.TagNumber(1)
  set nameFilter($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasNameFilter() => $_has(0);
  @$pb.TagNumber(1)
  void clearNameFilter() => $_clearField(1);
}

/// ListTopicsResponse represents the response to list topics.
class ListTopicsResponse extends $pb.GeneratedMessage {
  factory ListTopicsResponse({
    $core.Iterable<TopicInfo>? topics,
  }) {
    final result = create();
    if (topics != null) result.topics.addAll(topics);
    return result;
  }

  ListTopicsResponse._();

  factory ListTopicsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListTopicsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListTopicsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..pPM<TopicInfo>(1, _omitFieldNames ? '' : 'topics',
        subBuilder: TopicInfo.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListTopicsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListTopicsResponse copyWith(void Function(ListTopicsResponse) updates) =>
      super.copyWith((message) => updates(message as ListTopicsResponse))
          as ListTopicsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListTopicsResponse create() => ListTopicsResponse._();
  @$core.override
  ListTopicsResponse createEmptyInstance() => create();
  static $pb.PbList<ListTopicsResponse> createRepeated() =>
      $pb.PbList<ListTopicsResponse>();
  @$core.pragma('dart2js:noInline')
  static ListTopicsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListTopicsResponse>(create);
  static ListTopicsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<TopicInfo> get topics => $_getList(0);
}

/// MessageAck represents an acknowledgment for a received message.
class MessageAck extends $pb.GeneratedMessage {
  factory MessageAck({
    MessageID? messageId,
    $0.IdentityID? recipient,
    $1.Timestamp? timestamp,
  }) {
    final result = create();
    if (messageId != null) result.messageId = messageId;
    if (recipient != null) result.recipient = recipient;
    if (timestamp != null) result.timestamp = timestamp;
    return result;
  }

  MessageAck._();

  factory MessageAck.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MessageAck.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MessageAck',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<MessageID>(1, _omitFieldNames ? '' : 'messageId',
        subBuilder: MessageID.create)
    ..aOM<$0.IdentityID>(2, _omitFieldNames ? '' : 'recipient',
        subBuilder: $0.IdentityID.create)
    ..aOM<$1.Timestamp>(3, _omitFieldNames ? '' : 'timestamp',
        subBuilder: $1.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MessageAck clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MessageAck copyWith(void Function(MessageAck) updates) =>
      super.copyWith((message) => updates(message as MessageAck)) as MessageAck;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MessageAck create() => MessageAck._();
  @$core.override
  MessageAck createEmptyInstance() => create();
  static $pb.PbList<MessageAck> createRepeated() => $pb.PbList<MessageAck>();
  @$core.pragma('dart2js:noInline')
  static MessageAck getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MessageAck>(create);
  static MessageAck? _defaultInstance;

  @$pb.TagNumber(1)
  MessageID get messageId => $_getN(0);
  @$pb.TagNumber(1)
  set messageId(MessageID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasMessageId() => $_has(0);
  @$pb.TagNumber(1)
  void clearMessageId() => $_clearField(1);
  @$pb.TagNumber(1)
  MessageID ensureMessageId() => $_ensure(0);

  @$pb.TagNumber(2)
  $0.IdentityID get recipient => $_getN(1);
  @$pb.TagNumber(2)
  set recipient($0.IdentityID value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasRecipient() => $_has(1);
  @$pb.TagNumber(2)
  void clearRecipient() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.IdentityID ensureRecipient() => $_ensure(1);

  @$pb.TagNumber(3)
  $1.Timestamp get timestamp => $_getN(2);
  @$pb.TagNumber(3)
  set timestamp($1.Timestamp value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasTimestamp() => $_has(2);
  @$pb.TagNumber(3)
  void clearTimestamp() => $_clearField(3);
  @$pb.TagNumber(3)
  $1.Timestamp ensureTimestamp() => $_ensure(2);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
