// This is a generated file - do not edit.
//
// Generated from domain/notification/notification.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

class NotificationCategory extends $pb.ProtobufEnum {
  static const NotificationCategory NOTIFICATION_CATEGORY_UNSPECIFIED =
      NotificationCategory._(
          0, _omitEnumNames ? '' : 'NOTIFICATION_CATEGORY_UNSPECIFIED');
  static const NotificationCategory NOTIFICATION_CATEGORY_SOCIAL =
      NotificationCategory._(
          1, _omitEnumNames ? '' : 'NOTIFICATION_CATEGORY_SOCIAL');
  static const NotificationCategory NOTIFICATION_CATEGORY_CHAT =
      NotificationCategory._(
          2, _omitEnumNames ? '' : 'NOTIFICATION_CATEGORY_CHAT');
  static const NotificationCategory NOTIFICATION_CATEGORY_SYSTEM =
      NotificationCategory._(
          3, _omitEnumNames ? '' : 'NOTIFICATION_CATEGORY_SYSTEM');
  static const NotificationCategory NOTIFICATION_CATEGORY_TASK =
      NotificationCategory._(
          4, _omitEnumNames ? '' : 'NOTIFICATION_CATEGORY_TASK');

  static const $core.List<NotificationCategory> values = <NotificationCategory>[
    NOTIFICATION_CATEGORY_UNSPECIFIED,
    NOTIFICATION_CATEGORY_SOCIAL,
    NOTIFICATION_CATEGORY_CHAT,
    NOTIFICATION_CATEGORY_SYSTEM,
    NOTIFICATION_CATEGORY_TASK,
  ];

  static final $core.List<NotificationCategory?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static NotificationCategory? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const NotificationCategory._(super.value, super.name);
}

class NotificationType extends $pb.ProtobufEnum {
  static const NotificationType NOTIFICATION_TYPE_UNSPECIFIED =
      NotificationType._(
          0, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_UNSPECIFIED');

  /// Social (100-199)
  static const NotificationType NOTIFICATION_TYPE_FOLLOW_REQUESTED =
      NotificationType._(
          100, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_FOLLOW_REQUESTED');
  static const NotificationType NOTIFICATION_TYPE_FOLLOW_ACCEPTED =
      NotificationType._(
          101, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_FOLLOW_ACCEPTED');
  static const NotificationType NOTIFICATION_TYPE_POST_LIKED =
      NotificationType._(
          102, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_POST_LIKED');
  static const NotificationType NOTIFICATION_TYPE_POST_COMMENTED =
      NotificationType._(
          103, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_POST_COMMENTED');
  static const NotificationType NOTIFICATION_TYPE_POST_REPOSTED =
      NotificationType._(
          104, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_POST_REPOSTED');
  static const NotificationType NOTIFICATION_TYPE_MENTIONED =
      NotificationType._(
          105, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_MENTIONED');

  /// Chat (200-299)
  static const NotificationType NOTIFICATION_TYPE_FRIEND_REQUEST =
      NotificationType._(
          200, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_FRIEND_REQUEST');
  static const NotificationType NOTIFICATION_TYPE_FRIEND_ACCEPTED =
      NotificationType._(
          201, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_FRIEND_ACCEPTED');
  static const NotificationType NOTIFICATION_TYPE_FRIEND_MESSAGE =
      NotificationType._(
          202, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_FRIEND_MESSAGE');
  static const NotificationType NOTIFICATION_TYPE_GROUP_INVITED =
      NotificationType._(
          203, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_GROUP_INVITED');
  static const NotificationType NOTIFICATION_TYPE_CHAT_MENTIONED =
      NotificationType._(
          204, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_CHAT_MENTIONED');

  /// System (300-399)
  static const NotificationType NOTIFICATION_TYPE_WELCOME = NotificationType._(
      300, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_WELCOME');
  static const NotificationType NOTIFICATION_TYPE_SECURITY_ALERT =
      NotificationType._(
          301, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_SECURITY_ALERT');
  static const NotificationType NOTIFICATION_TYPE_VERSION_UPDATE =
      NotificationType._(
          302, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_VERSION_UPDATE');
  static const NotificationType NOTIFICATION_TYPE_MAINTENANCE =
      NotificationType._(
          303, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_MAINTENANCE');

  /// Task (400-499)
  static const NotificationType NOTIFICATION_TYPE_TASK_ASSIGNED =
      NotificationType._(
          400, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_TASK_ASSIGNED');
  static const NotificationType NOTIFICATION_TYPE_TASK_COMPLETED =
      NotificationType._(
          401, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_TASK_COMPLETED');
  static const NotificationType NOTIFICATION_TYPE_TASK_REMINDER =
      NotificationType._(
          402, _omitEnumNames ? '' : 'NOTIFICATION_TYPE_TASK_REMINDER');

  static const $core.List<NotificationType> values = <NotificationType>[
    NOTIFICATION_TYPE_UNSPECIFIED,
    NOTIFICATION_TYPE_FOLLOW_REQUESTED,
    NOTIFICATION_TYPE_FOLLOW_ACCEPTED,
    NOTIFICATION_TYPE_POST_LIKED,
    NOTIFICATION_TYPE_POST_COMMENTED,
    NOTIFICATION_TYPE_POST_REPOSTED,
    NOTIFICATION_TYPE_MENTIONED,
    NOTIFICATION_TYPE_FRIEND_REQUEST,
    NOTIFICATION_TYPE_FRIEND_ACCEPTED,
    NOTIFICATION_TYPE_FRIEND_MESSAGE,
    NOTIFICATION_TYPE_GROUP_INVITED,
    NOTIFICATION_TYPE_CHAT_MENTIONED,
    NOTIFICATION_TYPE_WELCOME,
    NOTIFICATION_TYPE_SECURITY_ALERT,
    NOTIFICATION_TYPE_VERSION_UPDATE,
    NOTIFICATION_TYPE_MAINTENANCE,
    NOTIFICATION_TYPE_TASK_ASSIGNED,
    NOTIFICATION_TYPE_TASK_COMPLETED,
    NOTIFICATION_TYPE_TASK_REMINDER,
  ];

  static final $core.Map<$core.int, NotificationType> _byValue =
      $pb.ProtobufEnum.initByValue(values);
  static NotificationType? valueOf($core.int value) => _byValue[value];

  const NotificationType._(super.value, super.name);
}

class NotificationStatus extends $pb.ProtobufEnum {
  static const NotificationStatus NOTIFICATION_STATUS_UNSPECIFIED =
      NotificationStatus._(
          0, _omitEnumNames ? '' : 'NOTIFICATION_STATUS_UNSPECIFIED');
  static const NotificationStatus NOTIFICATION_STATUS_UNREAD =
      NotificationStatus._(
          1, _omitEnumNames ? '' : 'NOTIFICATION_STATUS_UNREAD');
  static const NotificationStatus NOTIFICATION_STATUS_READ =
      NotificationStatus._(2, _omitEnumNames ? '' : 'NOTIFICATION_STATUS_READ');
  static const NotificationStatus NOTIFICATION_STATUS_ARCHIVED =
      NotificationStatus._(
          3, _omitEnumNames ? '' : 'NOTIFICATION_STATUS_ARCHIVED');

  static const $core.List<NotificationStatus> values = <NotificationStatus>[
    NOTIFICATION_STATUS_UNSPECIFIED,
    NOTIFICATION_STATUS_UNREAD,
    NOTIFICATION_STATUS_READ,
    NOTIFICATION_STATUS_ARCHIVED,
  ];

  static final $core.List<NotificationStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static NotificationStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const NotificationStatus._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
