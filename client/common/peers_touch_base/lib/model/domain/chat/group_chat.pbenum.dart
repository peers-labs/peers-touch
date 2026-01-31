// This is a generated file - do not edit.
//
// Generated from domain/chat/group_chat.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

/// 群组类型
class GroupType extends $pb.ProtobufEnum {
  static const GroupType GROUP_TYPE_UNSPECIFIED =
      GroupType._(0, _omitEnumNames ? '' : 'GROUP_TYPE_UNSPECIFIED');
  static const GroupType GROUP_TYPE_NORMAL =
      GroupType._(1, _omitEnumNames ? '' : 'GROUP_TYPE_NORMAL');
  static const GroupType GROUP_TYPE_ANNOUNCEMENT =
      GroupType._(2, _omitEnumNames ? '' : 'GROUP_TYPE_ANNOUNCEMENT');
  static const GroupType GROUP_TYPE_DISCUSSION =
      GroupType._(3, _omitEnumNames ? '' : 'GROUP_TYPE_DISCUSSION');

  static const $core.List<GroupType> values = <GroupType>[
    GROUP_TYPE_UNSPECIFIED,
    GROUP_TYPE_NORMAL,
    GROUP_TYPE_ANNOUNCEMENT,
    GROUP_TYPE_DISCUSSION,
  ];

  static final $core.List<GroupType?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static GroupType? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const GroupType._(super.value, super.name);
}

/// 群组可见性
class GroupVisibility extends $pb.ProtobufEnum {
  static const GroupVisibility GROUP_VISIBILITY_UNSPECIFIED = GroupVisibility._(
      0, _omitEnumNames ? '' : 'GROUP_VISIBILITY_UNSPECIFIED');
  static const GroupVisibility GROUP_VISIBILITY_PUBLIC =
      GroupVisibility._(1, _omitEnumNames ? '' : 'GROUP_VISIBILITY_PUBLIC');
  static const GroupVisibility GROUP_VISIBILITY_PRIVATE =
      GroupVisibility._(2, _omitEnumNames ? '' : 'GROUP_VISIBILITY_PRIVATE');

  static const $core.List<GroupVisibility> values = <GroupVisibility>[
    GROUP_VISIBILITY_UNSPECIFIED,
    GROUP_VISIBILITY_PUBLIC,
    GROUP_VISIBILITY_PRIVATE,
  ];

  static final $core.List<GroupVisibility?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static GroupVisibility? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const GroupVisibility._(super.value, super.name);
}

/// 群角色
class GroupRole extends $pb.ProtobufEnum {
  static const GroupRole GROUP_ROLE_UNSPECIFIED =
      GroupRole._(0, _omitEnumNames ? '' : 'GROUP_ROLE_UNSPECIFIED');
  static const GroupRole GROUP_ROLE_MEMBER =
      GroupRole._(1, _omitEnumNames ? '' : 'GROUP_ROLE_MEMBER');
  static const GroupRole GROUP_ROLE_ADMIN =
      GroupRole._(2, _omitEnumNames ? '' : 'GROUP_ROLE_ADMIN');
  static const GroupRole GROUP_ROLE_OWNER =
      GroupRole._(3, _omitEnumNames ? '' : 'GROUP_ROLE_OWNER');

  static const $core.List<GroupRole> values = <GroupRole>[
    GROUP_ROLE_UNSPECIFIED,
    GROUP_ROLE_MEMBER,
    GROUP_ROLE_ADMIN,
    GROUP_ROLE_OWNER,
  ];

  static final $core.List<GroupRole?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static GroupRole? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const GroupRole._(super.value, super.name);
}

class GroupMessageType extends $pb.ProtobufEnum {
  static const GroupMessageType GROUP_MESSAGE_TYPE_UNSPECIFIED =
      GroupMessageType._(
          0, _omitEnumNames ? '' : 'GROUP_MESSAGE_TYPE_UNSPECIFIED');
  static const GroupMessageType GROUP_MESSAGE_TYPE_TEXT =
      GroupMessageType._(1, _omitEnumNames ? '' : 'GROUP_MESSAGE_TYPE_TEXT');
  static const GroupMessageType GROUP_MESSAGE_TYPE_IMAGE =
      GroupMessageType._(2, _omitEnumNames ? '' : 'GROUP_MESSAGE_TYPE_IMAGE');
  static const GroupMessageType GROUP_MESSAGE_TYPE_FILE =
      GroupMessageType._(3, _omitEnumNames ? '' : 'GROUP_MESSAGE_TYPE_FILE');
  static const GroupMessageType GROUP_MESSAGE_TYPE_AUDIO =
      GroupMessageType._(4, _omitEnumNames ? '' : 'GROUP_MESSAGE_TYPE_AUDIO');
  static const GroupMessageType GROUP_MESSAGE_TYPE_VIDEO =
      GroupMessageType._(5, _omitEnumNames ? '' : 'GROUP_MESSAGE_TYPE_VIDEO');
  static const GroupMessageType GROUP_MESSAGE_TYPE_SYSTEM =
      GroupMessageType._(10, _omitEnumNames ? '' : 'GROUP_MESSAGE_TYPE_SYSTEM');

  static const $core.List<GroupMessageType> values = <GroupMessageType>[
    GROUP_MESSAGE_TYPE_UNSPECIFIED,
    GROUP_MESSAGE_TYPE_TEXT,
    GROUP_MESSAGE_TYPE_IMAGE,
    GROUP_MESSAGE_TYPE_FILE,
    GROUP_MESSAGE_TYPE_AUDIO,
    GROUP_MESSAGE_TYPE_VIDEO,
    GROUP_MESSAGE_TYPE_SYSTEM,
  ];

  static final $core.Map<$core.int, GroupMessageType> _byValue =
      $pb.ProtobufEnum.initByValue(values);
  static GroupMessageType? valueOf($core.int value) => _byValue[value];

  const GroupMessageType._(super.value, super.name);
}

class GroupInvitationStatus extends $pb.ProtobufEnum {
  static const GroupInvitationStatus GROUP_INVITATION_STATUS_UNSPECIFIED =
      GroupInvitationStatus._(
          0, _omitEnumNames ? '' : 'GROUP_INVITATION_STATUS_UNSPECIFIED');
  static const GroupInvitationStatus GROUP_INVITATION_STATUS_PENDING =
      GroupInvitationStatus._(
          1, _omitEnumNames ? '' : 'GROUP_INVITATION_STATUS_PENDING');
  static const GroupInvitationStatus GROUP_INVITATION_STATUS_ACCEPTED =
      GroupInvitationStatus._(
          2, _omitEnumNames ? '' : 'GROUP_INVITATION_STATUS_ACCEPTED');
  static const GroupInvitationStatus GROUP_INVITATION_STATUS_REJECTED =
      GroupInvitationStatus._(
          3, _omitEnumNames ? '' : 'GROUP_INVITATION_STATUS_REJECTED');
  static const GroupInvitationStatus GROUP_INVITATION_STATUS_EXPIRED =
      GroupInvitationStatus._(
          4, _omitEnumNames ? '' : 'GROUP_INVITATION_STATUS_EXPIRED');

  static const $core.List<GroupInvitationStatus> values =
      <GroupInvitationStatus>[
    GROUP_INVITATION_STATUS_UNSPECIFIED,
    GROUP_INVITATION_STATUS_PENDING,
    GROUP_INVITATION_STATUS_ACCEPTED,
    GROUP_INVITATION_STATUS_REJECTED,
    GROUP_INVITATION_STATUS_EXPIRED,
  ];

  static final $core.List<GroupInvitationStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static GroupInvitationStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const GroupInvitationStatus._(super.value, super.name);
}

class GroupOfflineMessageStatus extends $pb.ProtobufEnum {
  static const GroupOfflineMessageStatus
      GROUP_OFFLINE_MESSAGE_STATUS_UNSPECIFIED = GroupOfflineMessageStatus._(
          0, _omitEnumNames ? '' : 'GROUP_OFFLINE_MESSAGE_STATUS_UNSPECIFIED');
  static const GroupOfflineMessageStatus GROUP_OFFLINE_MESSAGE_STATUS_PENDING =
      GroupOfflineMessageStatus._(
          1, _omitEnumNames ? '' : 'GROUP_OFFLINE_MESSAGE_STATUS_PENDING');
  static const GroupOfflineMessageStatus
      GROUP_OFFLINE_MESSAGE_STATUS_DELIVERED = GroupOfflineMessageStatus._(
          2, _omitEnumNames ? '' : 'GROUP_OFFLINE_MESSAGE_STATUS_DELIVERED');
  static const GroupOfflineMessageStatus GROUP_OFFLINE_MESSAGE_STATUS_EXPIRED =
      GroupOfflineMessageStatus._(
          3, _omitEnumNames ? '' : 'GROUP_OFFLINE_MESSAGE_STATUS_EXPIRED');

  static const $core.List<GroupOfflineMessageStatus> values =
      <GroupOfflineMessageStatus>[
    GROUP_OFFLINE_MESSAGE_STATUS_UNSPECIFIED,
    GROUP_OFFLINE_MESSAGE_STATUS_PENDING,
    GROUP_OFFLINE_MESSAGE_STATUS_DELIVERED,
    GROUP_OFFLINE_MESSAGE_STATUS_EXPIRED,
  ];

  static final $core.List<GroupOfflineMessageStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static GroupOfflineMessageStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const GroupOfflineMessageStatus._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
