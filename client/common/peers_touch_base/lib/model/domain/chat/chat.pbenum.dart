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

/// 会话类型
class SessionType extends $pb.ProtobufEnum {
  static const SessionType SESSION_TYPE_UNSPECIFIED =
      SessionType._(0, _omitEnumNames ? '' : 'SESSION_TYPE_UNSPECIFIED');
  static const SessionType SESSION_TYPE_DIRECT =
      SessionType._(1, _omitEnumNames ? '' : 'SESSION_TYPE_DIRECT');
  static const SessionType SESSION_TYPE_GROUP =
      SessionType._(2, _omitEnumNames ? '' : 'SESSION_TYPE_GROUP');

  static const $core.List<SessionType> values = <SessionType>[
    SESSION_TYPE_UNSPECIFIED,
    SESSION_TYPE_DIRECT,
    SESSION_TYPE_GROUP,
  ];

  static final $core.List<SessionType?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static SessionType? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const SessionType._(super.value, super.name);
}

/// 消息类型
class MessageType extends $pb.ProtobufEnum {
  static const MessageType MESSAGE_TYPE_UNSPECIFIED =
      MessageType._(0, _omitEnumNames ? '' : 'MESSAGE_TYPE_UNSPECIFIED');
  static const MessageType MESSAGE_TYPE_TEXT =
      MessageType._(1, _omitEnumNames ? '' : 'MESSAGE_TYPE_TEXT');
  static const MessageType MESSAGE_TYPE_IMAGE =
      MessageType._(2, _omitEnumNames ? '' : 'MESSAGE_TYPE_IMAGE');
  static const MessageType MESSAGE_TYPE_FILE =
      MessageType._(3, _omitEnumNames ? '' : 'MESSAGE_TYPE_FILE');
  static const MessageType MESSAGE_TYPE_LOCATION =
      MessageType._(4, _omitEnumNames ? '' : 'MESSAGE_TYPE_LOCATION');
  static const MessageType MESSAGE_TYPE_SYSTEM =
      MessageType._(5, _omitEnumNames ? '' : 'MESSAGE_TYPE_SYSTEM');

  static const $core.List<MessageType> values = <MessageType>[
    MESSAGE_TYPE_UNSPECIFIED,
    MESSAGE_TYPE_TEXT,
    MESSAGE_TYPE_IMAGE,
    MESSAGE_TYPE_FILE,
    MESSAGE_TYPE_LOCATION,
    MESSAGE_TYPE_SYSTEM,
  ];

  static final $core.List<MessageType?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 5);
  static MessageType? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const MessageType._(super.value, super.name);
}

/// 消息状态
class MessageStatus extends $pb.ProtobufEnum {
  static const MessageStatus MESSAGE_STATUS_UNSPECIFIED =
      MessageStatus._(0, _omitEnumNames ? '' : 'MESSAGE_STATUS_UNSPECIFIED');
  static const MessageStatus MESSAGE_STATUS_SENDING =
      MessageStatus._(1, _omitEnumNames ? '' : 'MESSAGE_STATUS_SENDING');
  static const MessageStatus MESSAGE_STATUS_SENT =
      MessageStatus._(2, _omitEnumNames ? '' : 'MESSAGE_STATUS_SENT');
  static const MessageStatus MESSAGE_STATUS_DELIVERED =
      MessageStatus._(3, _omitEnumNames ? '' : 'MESSAGE_STATUS_DELIVERED');
  static const MessageStatus MESSAGE_STATUS_FAILED =
      MessageStatus._(4, _omitEnumNames ? '' : 'MESSAGE_STATUS_FAILED');

  static const $core.List<MessageStatus> values = <MessageStatus>[
    MESSAGE_STATUS_UNSPECIFIED,
    MESSAGE_STATUS_SENDING,
    MESSAGE_STATUS_SENT,
    MESSAGE_STATUS_DELIVERED,
    MESSAGE_STATUS_FAILED,
  ];

  static final $core.List<MessageStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static MessageStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const MessageStatus._(super.value, super.name);
}

/// 好友关系状态
class FriendshipStatus extends $pb.ProtobufEnum {
  static const FriendshipStatus FRIENDSHIP_STATUS_UNSPECIFIED =
      FriendshipStatus._(
          0, _omitEnumNames ? '' : 'FRIENDSHIP_STATUS_UNSPECIFIED');
  static const FriendshipStatus FRIENDSHIP_STATUS_PENDING =
      FriendshipStatus._(1, _omitEnumNames ? '' : 'FRIENDSHIP_STATUS_PENDING');
  static const FriendshipStatus FRIENDSHIP_STATUS_ACCEPTED =
      FriendshipStatus._(2, _omitEnumNames ? '' : 'FRIENDSHIP_STATUS_ACCEPTED');
  static const FriendshipStatus FRIENDSHIP_STATUS_BLOCKED =
      FriendshipStatus._(3, _omitEnumNames ? '' : 'FRIENDSHIP_STATUS_BLOCKED');
  static const FriendshipStatus FRIENDSHIP_STATUS_REMOVED =
      FriendshipStatus._(4, _omitEnumNames ? '' : 'FRIENDSHIP_STATUS_REMOVED');

  static const $core.List<FriendshipStatus> values = <FriendshipStatus>[
    FRIENDSHIP_STATUS_UNSPECIFIED,
    FRIENDSHIP_STATUS_PENDING,
    FRIENDSHIP_STATUS_ACCEPTED,
    FRIENDSHIP_STATUS_BLOCKED,
    FRIENDSHIP_STATUS_REMOVED,
  ];

  static final $core.List<FriendshipStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static FriendshipStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const FriendshipStatus._(super.value, super.name);
}

/// 好友请求状态
class FriendRequestStatus extends $pb.ProtobufEnum {
  static const FriendRequestStatus FRIEND_REQUEST_STATUS_UNSPECIFIED =
      FriendRequestStatus._(
          0, _omitEnumNames ? '' : 'FRIEND_REQUEST_STATUS_UNSPECIFIED');
  static const FriendRequestStatus FRIEND_REQUEST_STATUS_PENDING =
      FriendRequestStatus._(
          1, _omitEnumNames ? '' : 'FRIEND_REQUEST_STATUS_PENDING');
  static const FriendRequestStatus FRIEND_REQUEST_STATUS_ACCEPTED =
      FriendRequestStatus._(
          2, _omitEnumNames ? '' : 'FRIEND_REQUEST_STATUS_ACCEPTED');
  static const FriendRequestStatus FRIEND_REQUEST_STATUS_REJECTED =
      FriendRequestStatus._(
          3, _omitEnumNames ? '' : 'FRIEND_REQUEST_STATUS_REJECTED');
  static const FriendRequestStatus FRIEND_REQUEST_STATUS_EXPIRED =
      FriendRequestStatus._(
          4, _omitEnumNames ? '' : 'FRIEND_REQUEST_STATUS_EXPIRED');

  static const $core.List<FriendRequestStatus> values = <FriendRequestStatus>[
    FRIEND_REQUEST_STATUS_UNSPECIFIED,
    FRIEND_REQUEST_STATUS_PENDING,
    FRIEND_REQUEST_STATUS_ACCEPTED,
    FRIEND_REQUEST_STATUS_REJECTED,
    FRIEND_REQUEST_STATUS_EXPIRED,
  ];

  static final $core.List<FriendRequestStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static FriendRequestStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const FriendRequestStatus._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
