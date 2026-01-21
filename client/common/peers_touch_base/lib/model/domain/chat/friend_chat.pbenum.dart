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

import 'package:protobuf/protobuf.dart' as $pb;

class FriendMessageType extends $pb.ProtobufEnum {
  static const FriendMessageType FRIEND_MESSAGE_TYPE_UNSPECIFIED =
      FriendMessageType._(
          0, _omitEnumNames ? '' : 'FRIEND_MESSAGE_TYPE_UNSPECIFIED');
  static const FriendMessageType FRIEND_MESSAGE_TYPE_TEXT =
      FriendMessageType._(1, _omitEnumNames ? '' : 'FRIEND_MESSAGE_TYPE_TEXT');
  static const FriendMessageType FRIEND_MESSAGE_TYPE_IMAGE =
      FriendMessageType._(2, _omitEnumNames ? '' : 'FRIEND_MESSAGE_TYPE_IMAGE');
  static const FriendMessageType FRIEND_MESSAGE_TYPE_FILE =
      FriendMessageType._(3, _omitEnumNames ? '' : 'FRIEND_MESSAGE_TYPE_FILE');
  static const FriendMessageType FRIEND_MESSAGE_TYPE_AUDIO =
      FriendMessageType._(4, _omitEnumNames ? '' : 'FRIEND_MESSAGE_TYPE_AUDIO');
  static const FriendMessageType FRIEND_MESSAGE_TYPE_VIDEO =
      FriendMessageType._(5, _omitEnumNames ? '' : 'FRIEND_MESSAGE_TYPE_VIDEO');

  static const $core.List<FriendMessageType> values = <FriendMessageType>[
    FRIEND_MESSAGE_TYPE_UNSPECIFIED,
    FRIEND_MESSAGE_TYPE_TEXT,
    FRIEND_MESSAGE_TYPE_IMAGE,
    FRIEND_MESSAGE_TYPE_FILE,
    FRIEND_MESSAGE_TYPE_AUDIO,
    FRIEND_MESSAGE_TYPE_VIDEO,
  ];

  static final $core.List<FriendMessageType?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 5);
  static FriendMessageType? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const FriendMessageType._(super.value, super.name);
}

class FriendMessageStatus extends $pb.ProtobufEnum {
  static const FriendMessageStatus FRIEND_MESSAGE_STATUS_UNSPECIFIED =
      FriendMessageStatus._(
          0, _omitEnumNames ? '' : 'FRIEND_MESSAGE_STATUS_UNSPECIFIED');
  static const FriendMessageStatus FRIEND_MESSAGE_STATUS_SENDING =
      FriendMessageStatus._(
          1, _omitEnumNames ? '' : 'FRIEND_MESSAGE_STATUS_SENDING');
  static const FriendMessageStatus FRIEND_MESSAGE_STATUS_SENT =
      FriendMessageStatus._(
          2, _omitEnumNames ? '' : 'FRIEND_MESSAGE_STATUS_SENT');
  static const FriendMessageStatus FRIEND_MESSAGE_STATUS_DELIVERED =
      FriendMessageStatus._(
          3, _omitEnumNames ? '' : 'FRIEND_MESSAGE_STATUS_DELIVERED');
  static const FriendMessageStatus FRIEND_MESSAGE_STATUS_READ =
      FriendMessageStatus._(
          4, _omitEnumNames ? '' : 'FRIEND_MESSAGE_STATUS_READ');
  static const FriendMessageStatus FRIEND_MESSAGE_STATUS_FAILED =
      FriendMessageStatus._(
          5, _omitEnumNames ? '' : 'FRIEND_MESSAGE_STATUS_FAILED');

  static const $core.List<FriendMessageStatus> values = <FriendMessageStatus>[
    FRIEND_MESSAGE_STATUS_UNSPECIFIED,
    FRIEND_MESSAGE_STATUS_SENDING,
    FRIEND_MESSAGE_STATUS_SENT,
    FRIEND_MESSAGE_STATUS_DELIVERED,
    FRIEND_MESSAGE_STATUS_READ,
    FRIEND_MESSAGE_STATUS_FAILED,
  ];

  static final $core.List<FriendMessageStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 5);
  static FriendMessageStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const FriendMessageStatus._(super.value, super.name);
}

class OfflineMessageStatus extends $pb.ProtobufEnum {
  static const OfflineMessageStatus OFFLINE_MESSAGE_STATUS_UNSPECIFIED =
      OfflineMessageStatus._(
          0, _omitEnumNames ? '' : 'OFFLINE_MESSAGE_STATUS_UNSPECIFIED');
  static const OfflineMessageStatus OFFLINE_MESSAGE_STATUS_PENDING =
      OfflineMessageStatus._(
          1, _omitEnumNames ? '' : 'OFFLINE_MESSAGE_STATUS_PENDING');
  static const OfflineMessageStatus OFFLINE_MESSAGE_STATUS_DELIVERED =
      OfflineMessageStatus._(
          2, _omitEnumNames ? '' : 'OFFLINE_MESSAGE_STATUS_DELIVERED');
  static const OfflineMessageStatus OFFLINE_MESSAGE_STATUS_EXPIRED =
      OfflineMessageStatus._(
          3, _omitEnumNames ? '' : 'OFFLINE_MESSAGE_STATUS_EXPIRED');

  static const $core.List<OfflineMessageStatus> values = <OfflineMessageStatus>[
    OFFLINE_MESSAGE_STATUS_UNSPECIFIED,
    OFFLINE_MESSAGE_STATUS_PENDING,
    OFFLINE_MESSAGE_STATUS_DELIVERED,
    OFFLINE_MESSAGE_STATUS_EXPIRED,
  ];

  static final $core.List<OfflineMessageStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static OfflineMessageStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const OfflineMessageStatus._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
