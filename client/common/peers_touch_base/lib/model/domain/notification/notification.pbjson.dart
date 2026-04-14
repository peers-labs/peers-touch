// This is a generated file - do not edit.
//
// Generated from domain/notification/notification.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports
// ignore_for_file: unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use notificationCategoryDescriptor instead')
const NotificationCategory$json = {
  '1': 'NotificationCategory',
  '2': [
    {'1': 'NOTIFICATION_CATEGORY_UNSPECIFIED', '2': 0},
    {'1': 'NOTIFICATION_CATEGORY_SOCIAL', '2': 1},
    {'1': 'NOTIFICATION_CATEGORY_CHAT', '2': 2},
    {'1': 'NOTIFICATION_CATEGORY_SYSTEM', '2': 3},
    {'1': 'NOTIFICATION_CATEGORY_TASK', '2': 4},
  ],
};

/// Descriptor for `NotificationCategory`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List notificationCategoryDescriptor = $convert.base64Decode(
    'ChROb3RpZmljYXRpb25DYXRlZ29yeRIlCiFOT1RJRklDQVRJT05fQ0FURUdPUllfVU5TUEVDSU'
    'ZJRUQQABIgChxOT1RJRklDQVRJT05fQ0FURUdPUllfU09DSUFMEAESHgoaTk9USUZJQ0FUSU9O'
    'X0NBVEVHT1JZX0NIQVQQAhIgChxOT1RJRklDQVRJT05fQ0FURUdPUllfU1lTVEVNEAMSHgoaTk'
    '9USUZJQ0FUSU9OX0NBVEVHT1JZX1RBU0sQBA==');

@$core.Deprecated('Use notificationTypeDescriptor instead')
const NotificationType$json = {
  '1': 'NotificationType',
  '2': [
    {'1': 'NOTIFICATION_TYPE_UNSPECIFIED', '2': 0},
    {'1': 'NOTIFICATION_TYPE_FOLLOW_REQUESTED', '2': 100},
    {'1': 'NOTIFICATION_TYPE_FOLLOW_ACCEPTED', '2': 101},
    {'1': 'NOTIFICATION_TYPE_POST_LIKED', '2': 102},
    {'1': 'NOTIFICATION_TYPE_POST_COMMENTED', '2': 103},
    {'1': 'NOTIFICATION_TYPE_POST_REPOSTED', '2': 104},
    {'1': 'NOTIFICATION_TYPE_MENTIONED', '2': 105},
    {'1': 'NOTIFICATION_TYPE_FRIEND_REQUEST', '2': 200},
    {'1': 'NOTIFICATION_TYPE_FRIEND_ACCEPTED', '2': 201},
    {'1': 'NOTIFICATION_TYPE_FRIEND_MESSAGE', '2': 202},
    {'1': 'NOTIFICATION_TYPE_GROUP_INVITED', '2': 203},
    {'1': 'NOTIFICATION_TYPE_CHAT_MENTIONED', '2': 204},
    {'1': 'NOTIFICATION_TYPE_WELCOME', '2': 300},
    {'1': 'NOTIFICATION_TYPE_SECURITY_ALERT', '2': 301},
    {'1': 'NOTIFICATION_TYPE_VERSION_UPDATE', '2': 302},
    {'1': 'NOTIFICATION_TYPE_MAINTENANCE', '2': 303},
    {'1': 'NOTIFICATION_TYPE_TASK_ASSIGNED', '2': 400},
    {'1': 'NOTIFICATION_TYPE_TASK_COMPLETED', '2': 401},
    {'1': 'NOTIFICATION_TYPE_TASK_REMINDER', '2': 402},
  ],
};

/// Descriptor for `NotificationType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List notificationTypeDescriptor = $convert.base64Decode(
    'ChBOb3RpZmljYXRpb25UeXBlEiEKHU5PVElGSUNBVElPTl9UWVBFX1VOU1BFQ0lGSUVEEAASJg'
    'oiTk9USUZJQ0FUSU9OX1RZUEVfRk9MTE9XX1JFUVVFU1RFRBBkEiUKIU5PVElGSUNBVElPTl9U'
    'WVBFX0ZPTExPV19BQ0NFUFRFRBBlEiAKHE5PVElGSUNBVElPTl9UWVBFX1BPU1RfTElLRUQQZh'
    'IkCiBOT1RJRklDQVRJT05fVFlQRV9QT1NUX0NPTU1FTlRFRBBnEiMKH05PVElGSUNBVElPTl9U'
    'WVBFX1BPU1RfUkVQT1NURUQQaBIfChtOT1RJRklDQVRJT05fVFlQRV9NRU5USU9ORUQQaRIlCi'
    'BOT1RJRklDQVRJT05fVFlQRV9GUklFTkRfUkVRVUVTVBDIARImCiFOT1RJRklDQVRJT05fVFlQ'
    'RV9GUklFTkRfQUNDRVBURUQQyQESJQogTk9USUZJQ0FUSU9OX1RZUEVfRlJJRU5EX01FU1NBR0'
    'UQygESJAofTk9USUZJQ0FUSU9OX1RZUEVfR1JPVVBfSU5WSVRFRBDLARIlCiBOT1RJRklDQVRJ'
    'T05fVFlQRV9DSEFUX01FTlRJT05FRBDMARIeChlOT1RJRklDQVRJT05fVFlQRV9XRUxDT01FEK'
    'wCEiUKIE5PVElGSUNBVElPTl9UWVBFX1NFQ1VSSVRZX0FMRVJUEK0CEiUKIE5PVElGSUNBVElP'
    'Tl9UWVBFX1ZFUlNJT05fVVBEQVRFEK4CEiIKHU5PVElGSUNBVElPTl9UWVBFX01BSU5URU5BTk'
    'NFEK8CEiQKH05PVElGSUNBVElPTl9UWVBFX1RBU0tfQVNTSUdORUQQkAMSJQogTk9USUZJQ0FU'
    'SU9OX1RZUEVfVEFTS19DT01QTEVURUQQkQMSJAofTk9USUZJQ0FUSU9OX1RZUEVfVEFTS19SRU'
    '1JTkRFUhCSAw==');

@$core.Deprecated('Use notificationStatusDescriptor instead')
const NotificationStatus$json = {
  '1': 'NotificationStatus',
  '2': [
    {'1': 'NOTIFICATION_STATUS_UNSPECIFIED', '2': 0},
    {'1': 'NOTIFICATION_STATUS_UNREAD', '2': 1},
    {'1': 'NOTIFICATION_STATUS_READ', '2': 2},
    {'1': 'NOTIFICATION_STATUS_ARCHIVED', '2': 3},
  ],
};

/// Descriptor for `NotificationStatus`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List notificationStatusDescriptor = $convert.base64Decode(
    'ChJOb3RpZmljYXRpb25TdGF0dXMSIwofTk9USUZJQ0FUSU9OX1NUQVRVU19VTlNQRUNJRklFRB'
    'AAEh4KGk5PVElGSUNBVElPTl9TVEFUVVNfVU5SRUFEEAESHAoYTk9USUZJQ0FUSU9OX1NUQVRV'
    'U19SRUFEEAISIAocTk9USUZJQ0FUSU9OX1NUQVRVU19BUkNISVZFRBAD');

@$core.Deprecated('Use notificationDescriptor instead')
const Notification$json = {
  '1': 'Notification',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'recipient_id', '3': 2, '4': 1, '5': 9, '10': 'recipientId'},
    {'1': 'actor_id', '3': 3, '4': 1, '5': 9, '10': 'actorId'},
    {
      '1': 'type',
      '3': 4,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.notification.v1.NotificationType',
      '10': 'type'
    },
    {
      '1': 'category',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.notification.v1.NotificationCategory',
      '10': 'category'
    },
    {
      '1': 'status',
      '3': 6,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.notification.v1.NotificationStatus',
      '10': 'status'
    },
    {'1': 'target_type', '3': 7, '4': 1, '5': 9, '10': 'targetType'},
    {'1': 'target_id', '3': 8, '4': 1, '5': 9, '10': 'targetId'},
    {'1': 'title', '3': 9, '4': 1, '5': 9, '10': 'title'},
    {'1': 'body', '3': 10, '4': 1, '5': 9, '10': 'body'},
    {
      '1': 'metadata',
      '3': 11,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.notification.v1.Notification.MetadataEntry',
      '10': 'metadata'
    },
    {'1': 'group_key', '3': 12, '4': 1, '5': 9, '10': 'groupKey'},
    {
      '1': 'created_at',
      '3': 13,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'read_at',
      '3': 14,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'readAt'
    },
  ],
  '3': [Notification_MetadataEntry$json],
};

@$core.Deprecated('Use notificationDescriptor instead')
const Notification_MetadataEntry$json = {
  '1': 'MetadataEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `Notification`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List notificationDescriptor = $convert.base64Decode(
    'CgxOb3RpZmljYXRpb24SDgoCaWQYASABKAlSAmlkEiEKDHJlY2lwaWVudF9pZBgCIAEoCVILcm'
    'VjaXBpZW50SWQSGQoIYWN0b3JfaWQYAyABKAlSB2FjdG9ySWQSRwoEdHlwZRgEIAEoDjIzLnBl'
    'ZXJzX3RvdWNoLm1vZGVsLm5vdGlmaWNhdGlvbi52MS5Ob3RpZmljYXRpb25UeXBlUgR0eXBlEl'
    'MKCGNhdGVnb3J5GAUgASgOMjcucGVlcnNfdG91Y2gubW9kZWwubm90aWZpY2F0aW9uLnYxLk5v'
    'dGlmaWNhdGlvbkNhdGVnb3J5UghjYXRlZ29yeRJNCgZzdGF0dXMYBiABKA4yNS5wZWVyc190b3'
    'VjaC5tb2RlbC5ub3RpZmljYXRpb24udjEuTm90aWZpY2F0aW9uU3RhdHVzUgZzdGF0dXMSHwoL'
    'dGFyZ2V0X3R5cGUYByABKAlSCnRhcmdldFR5cGUSGwoJdGFyZ2V0X2lkGAggASgJUgh0YXJnZX'
    'RJZBIUCgV0aXRsZRgJIAEoCVIFdGl0bGUSEgoEYm9keRgKIAEoCVIEYm9keRJZCghtZXRhZGF0'
    'YRgLIAMoCzI9LnBlZXJzX3RvdWNoLm1vZGVsLm5vdGlmaWNhdGlvbi52MS5Ob3RpZmljYXRpb2'
    '4uTWV0YWRhdGFFbnRyeVIIbWV0YWRhdGESGwoJZ3JvdXBfa2V5GAwgASgJUghncm91cEtleRI5'
    'CgpjcmVhdGVkX2F0GA0gASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJY3JlYXRlZE'
    'F0EjMKB3JlYWRfYXQYDiABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgZyZWFkQXQa'
    'OwoNTWV0YWRhdGFFbnRyeRIQCgNrZXkYASABKAlSA2tleRIUCgV2YWx1ZRgCIAEoCVIFdmFsdW'
    'U6AjgB');

@$core.Deprecated('Use notificationGroupDescriptor instead')
const NotificationGroup$json = {
  '1': 'NotificationGroup',
  '2': [
    {'1': 'group_key', '3': 1, '4': 1, '5': 9, '10': 'groupKey'},
    {
      '1': 'type',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.notification.v1.NotificationType',
      '10': 'type'
    },
    {
      '1': 'category',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.notification.v1.NotificationCategory',
      '10': 'category'
    },
    {'1': 'target_type', '3': 4, '4': 1, '5': 9, '10': 'targetType'},
    {'1': 'target_id', '3': 5, '4': 1, '5': 9, '10': 'targetId'},
    {'1': 'title', '3': 6, '4': 1, '5': 9, '10': 'title'},
    {'1': 'body', '3': 7, '4': 1, '5': 9, '10': 'body'},
    {'1': 'count', '3': 8, '4': 1, '5': 5, '10': 'count'},
    {'1': 'actor_ids', '3': 9, '4': 3, '5': 9, '10': 'actorIds'},
    {
      '1': 'latest',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.notification.v1.Notification',
      '10': 'latest'
    },
    {
      '1': 'updated_at',
      '3': 11,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
  ],
};

/// Descriptor for `NotificationGroup`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List notificationGroupDescriptor = $convert.base64Decode(
    'ChFOb3RpZmljYXRpb25Hcm91cBIbCglncm91cF9rZXkYASABKAlSCGdyb3VwS2V5EkcKBHR5cG'
    'UYAiABKA4yMy5wZWVyc190b3VjaC5tb2RlbC5ub3RpZmljYXRpb24udjEuTm90aWZpY2F0aW9u'
    'VHlwZVIEdHlwZRJTCghjYXRlZ29yeRgDIAEoDjI3LnBlZXJzX3RvdWNoLm1vZGVsLm5vdGlmaW'
    'NhdGlvbi52MS5Ob3RpZmljYXRpb25DYXRlZ29yeVIIY2F0ZWdvcnkSHwoLdGFyZ2V0X3R5cGUY'
    'BCABKAlSCnRhcmdldFR5cGUSGwoJdGFyZ2V0X2lkGAUgASgJUgh0YXJnZXRJZBIUCgV0aXRsZR'
    'gGIAEoCVIFdGl0bGUSEgoEYm9keRgHIAEoCVIEYm9keRIUCgVjb3VudBgIIAEoBVIFY291bnQS'
    'GwoJYWN0b3JfaWRzGAkgAygJUghhY3RvcklkcxJHCgZsYXRlc3QYCiABKAsyLy5wZWVyc190b3'
    'VjaC5tb2RlbC5ub3RpZmljYXRpb24udjEuTm90aWZpY2F0aW9uUgZsYXRlc3QSOQoKdXBkYXRl'
    'ZF9hdBgLIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCXVwZGF0ZWRBdA==');

@$core.Deprecated('Use notificationPreferenceDescriptor instead')
const NotificationPreference$json = {
  '1': 'NotificationPreference',
  '2': [
    {'1': 'actor_id', '3': 1, '4': 1, '5': 9, '10': 'actorId'},
    {
      '1': 'category',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.notification.v1.NotificationCategory',
      '10': 'category'
    },
    {'1': 'enabled', '3': 3, '4': 1, '5': 8, '10': 'enabled'},
    {'1': 'push_enabled', '3': 4, '4': 1, '5': 8, '10': 'pushEnabled'},
    {'1': 'sound_enabled', '3': 5, '4': 1, '5': 8, '10': 'soundEnabled'},
    {
      '1': 'updated_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
    {
      '1': 'type',
      '3': 7,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.notification.v1.NotificationType',
      '10': 'type'
    },
  ],
};

/// Descriptor for `NotificationPreference`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List notificationPreferenceDescriptor = $convert.base64Decode(
    'ChZOb3RpZmljYXRpb25QcmVmZXJlbmNlEhkKCGFjdG9yX2lkGAEgASgJUgdhY3RvcklkElMKCG'
    'NhdGVnb3J5GAIgASgOMjcucGVlcnNfdG91Y2gubW9kZWwubm90aWZpY2F0aW9uLnYxLk5vdGlm'
    'aWNhdGlvbkNhdGVnb3J5UghjYXRlZ29yeRIYCgdlbmFibGVkGAMgASgIUgdlbmFibGVkEiEKDH'
    'B1c2hfZW5hYmxlZBgEIAEoCFILcHVzaEVuYWJsZWQSIwoNc291bmRfZW5hYmxlZBgFIAEoCFIM'
    'c291bmRFbmFibGVkEjkKCnVwZGF0ZWRfYXQYBiABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZX'
    'N0YW1wUgl1cGRhdGVkQXQSRwoEdHlwZRgHIAEoDjIzLnBlZXJzX3RvdWNoLm1vZGVsLm5vdGlm'
    'aWNhdGlvbi52MS5Ob3RpZmljYXRpb25UeXBlUgR0eXBl');

@$core.Deprecated('Use listNotificationsRequestDescriptor instead')
const ListNotificationsRequest$json = {
  '1': 'ListNotificationsRequest',
  '2': [
    {
      '1': 'category',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.notification.v1.NotificationCategory',
      '10': 'category'
    },
    {
      '1': 'status',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.notification.v1.NotificationStatus',
      '10': 'status'
    },
    {'1': 'cursor', '3': 3, '4': 1, '5': 9, '10': 'cursor'},
    {'1': 'limit', '3': 4, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `ListNotificationsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listNotificationsRequestDescriptor = $convert.base64Decode(
    'ChhMaXN0Tm90aWZpY2F0aW9uc1JlcXVlc3QSUwoIY2F0ZWdvcnkYASABKA4yNy5wZWVyc190b3'
    'VjaC5tb2RlbC5ub3RpZmljYXRpb24udjEuTm90aWZpY2F0aW9uQ2F0ZWdvcnlSCGNhdGVnb3J5'
    'Ek0KBnN0YXR1cxgCIAEoDjI1LnBlZXJzX3RvdWNoLm1vZGVsLm5vdGlmaWNhdGlvbi52MS5Ob3'
    'RpZmljYXRpb25TdGF0dXNSBnN0YXR1cxIWCgZjdXJzb3IYAyABKAlSBmN1cnNvchIUCgVsaW1p'
    'dBgEIAEoBVIFbGltaXQ=');

@$core.Deprecated('Use listNotificationsResponseDescriptor instead')
const ListNotificationsResponse$json = {
  '1': 'ListNotificationsResponse',
  '2': [
    {
      '1': 'notifications',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.notification.v1.Notification',
      '10': 'notifications'
    },
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
    {'1': 'total_count', '3': 3, '4': 1, '5': 5, '10': 'totalCount'},
    {'1': 'unread_count', '3': 4, '4': 1, '5': 5, '10': 'unreadCount'},
  ],
};

/// Descriptor for `ListNotificationsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listNotificationsResponseDescriptor = $convert.base64Decode(
    'ChlMaXN0Tm90aWZpY2F0aW9uc1Jlc3BvbnNlElUKDW5vdGlmaWNhdGlvbnMYASADKAsyLy5wZW'
    'Vyc190b3VjaC5tb2RlbC5ub3RpZmljYXRpb24udjEuTm90aWZpY2F0aW9uUg1ub3RpZmljYXRp'
    'b25zEh8KC25leHRfY3Vyc29yGAIgASgJUgpuZXh0Q3Vyc29yEh8KC3RvdGFsX2NvdW50GAMgAS'
    'gFUgp0b3RhbENvdW50EiEKDHVucmVhZF9jb3VudBgEIAEoBVILdW5yZWFkQ291bnQ=');

@$core.Deprecated('Use listGroupedNotificationsRequestDescriptor instead')
const ListGroupedNotificationsRequest$json = {
  '1': 'ListGroupedNotificationsRequest',
  '2': [
    {
      '1': 'category',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.notification.v1.NotificationCategory',
      '10': 'category'
    },
    {'1': 'cursor', '3': 2, '4': 1, '5': 9, '10': 'cursor'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `ListGroupedNotificationsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listGroupedNotificationsRequestDescriptor =
    $convert.base64Decode(
        'Ch9MaXN0R3JvdXBlZE5vdGlmaWNhdGlvbnNSZXF1ZXN0ElMKCGNhdGVnb3J5GAEgASgOMjcucG'
        'VlcnNfdG91Y2gubW9kZWwubm90aWZpY2F0aW9uLnYxLk5vdGlmaWNhdGlvbkNhdGVnb3J5Ughj'
        'YXRlZ29yeRIWCgZjdXJzb3IYAiABKAlSBmN1cnNvchIUCgVsaW1pdBgDIAEoBVIFbGltaXQ=');

@$core.Deprecated('Use listGroupedNotificationsResponseDescriptor instead')
const ListGroupedNotificationsResponse$json = {
  '1': 'ListGroupedNotificationsResponse',
  '2': [
    {
      '1': 'groups',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.notification.v1.NotificationGroup',
      '10': 'groups'
    },
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
  ],
};

/// Descriptor for `ListGroupedNotificationsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listGroupedNotificationsResponseDescriptor =
    $convert.base64Decode(
        'CiBMaXN0R3JvdXBlZE5vdGlmaWNhdGlvbnNSZXNwb25zZRJMCgZncm91cHMYASADKAsyNC5wZW'
        'Vyc190b3VjaC5tb2RlbC5ub3RpZmljYXRpb24udjEuTm90aWZpY2F0aW9uR3JvdXBSBmdyb3Vw'
        'cxIfCgtuZXh0X2N1cnNvchgCIAEoCVIKbmV4dEN1cnNvcg==');

@$core.Deprecated('Use markNotificationsReadRequestDescriptor instead')
const MarkNotificationsReadRequest$json = {
  '1': 'MarkNotificationsReadRequest',
  '2': [
    {'1': 'notification_ids', '3': 1, '4': 3, '5': 9, '10': 'notificationIds'},
  ],
};

/// Descriptor for `MarkNotificationsReadRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markNotificationsReadRequestDescriptor =
    $convert.base64Decode(
        'ChxNYXJrTm90aWZpY2F0aW9uc1JlYWRSZXF1ZXN0EikKEG5vdGlmaWNhdGlvbl9pZHMYASADKA'
        'lSD25vdGlmaWNhdGlvbklkcw==');

@$core.Deprecated('Use markNotificationsReadResponseDescriptor instead')
const MarkNotificationsReadResponse$json = {
  '1': 'MarkNotificationsReadResponse',
  '2': [
    {'1': 'updated_count', '3': 1, '4': 1, '5': 5, '10': 'updatedCount'},
  ],
};

/// Descriptor for `MarkNotificationsReadResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markNotificationsReadResponseDescriptor =
    $convert.base64Decode(
        'Ch1NYXJrTm90aWZpY2F0aW9uc1JlYWRSZXNwb25zZRIjCg11cGRhdGVkX2NvdW50GAEgASgFUg'
        'x1cGRhdGVkQ291bnQ=');

@$core.Deprecated('Use markAllNotificationsReadRequestDescriptor instead')
const MarkAllNotificationsReadRequest$json = {
  '1': 'MarkAllNotificationsReadRequest',
  '2': [
    {
      '1': 'category',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.notification.v1.NotificationCategory',
      '10': 'category'
    },
  ],
};

/// Descriptor for `MarkAllNotificationsReadRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markAllNotificationsReadRequestDescriptor =
    $convert.base64Decode(
        'Ch9NYXJrQWxsTm90aWZpY2F0aW9uc1JlYWRSZXF1ZXN0ElMKCGNhdGVnb3J5GAEgASgOMjcucG'
        'VlcnNfdG91Y2gubW9kZWwubm90aWZpY2F0aW9uLnYxLk5vdGlmaWNhdGlvbkNhdGVnb3J5Ughj'
        'YXRlZ29yeQ==');

@$core.Deprecated('Use markAllNotificationsReadResponseDescriptor instead')
const MarkAllNotificationsReadResponse$json = {
  '1': 'MarkAllNotificationsReadResponse',
  '2': [
    {'1': 'updated_count', '3': 1, '4': 1, '5': 5, '10': 'updatedCount'},
  ],
};

/// Descriptor for `MarkAllNotificationsReadResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markAllNotificationsReadResponseDescriptor =
    $convert.base64Decode(
        'CiBNYXJrQWxsTm90aWZpY2F0aW9uc1JlYWRSZXNwb25zZRIjCg11cGRhdGVkX2NvdW50GAEgAS'
        'gFUgx1cGRhdGVkQ291bnQ=');

@$core.Deprecated('Use deleteNotificationsRequestDescriptor instead')
const DeleteNotificationsRequest$json = {
  '1': 'DeleteNotificationsRequest',
  '2': [
    {'1': 'notification_ids', '3': 1, '4': 3, '5': 9, '10': 'notificationIds'},
  ],
};

/// Descriptor for `DeleteNotificationsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteNotificationsRequestDescriptor =
    $convert.base64Decode(
        'ChpEZWxldGVOb3RpZmljYXRpb25zUmVxdWVzdBIpChBub3RpZmljYXRpb25faWRzGAEgAygJUg'
        '9ub3RpZmljYXRpb25JZHM=');

@$core.Deprecated('Use deleteNotificationsResponseDescriptor instead')
const DeleteNotificationsResponse$json = {
  '1': 'DeleteNotificationsResponse',
  '2': [
    {'1': 'deleted_count', '3': 1, '4': 1, '5': 5, '10': 'deletedCount'},
  ],
};

/// Descriptor for `DeleteNotificationsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteNotificationsResponseDescriptor =
    $convert.base64Decode(
        'ChtEZWxldGVOb3RpZmljYXRpb25zUmVzcG9uc2USIwoNZGVsZXRlZF9jb3VudBgBIAEoBVIMZG'
        'VsZXRlZENvdW50');

@$core.Deprecated('Use getUnreadCountsRequestDescriptor instead')
const GetUnreadCountsRequest$json = {
  '1': 'GetUnreadCountsRequest',
};

/// Descriptor for `GetUnreadCountsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUnreadCountsRequestDescriptor =
    $convert.base64Decode('ChZHZXRVbnJlYWRDb3VudHNSZXF1ZXN0');

@$core.Deprecated('Use getUnreadCountsResponseDescriptor instead')
const GetUnreadCountsResponse$json = {
  '1': 'GetUnreadCountsResponse',
  '2': [
    {'1': 'total', '3': 1, '4': 1, '5': 5, '10': 'total'},
    {
      '1': 'by_category',
      '3': 2,
      '4': 3,
      '5': 11,
      '6':
          '.peers_touch.model.notification.v1.GetUnreadCountsResponse.ByCategoryEntry',
      '10': 'byCategory'
    },
  ],
  '3': [GetUnreadCountsResponse_ByCategoryEntry$json],
};

@$core.Deprecated('Use getUnreadCountsResponseDescriptor instead')
const GetUnreadCountsResponse_ByCategoryEntry$json = {
  '1': 'ByCategoryEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 5, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 5, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `GetUnreadCountsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUnreadCountsResponseDescriptor = $convert.base64Decode(
    'ChdHZXRVbnJlYWRDb3VudHNSZXNwb25zZRIUCgV0b3RhbBgBIAEoBVIFdG90YWwSawoLYnlfY2'
    'F0ZWdvcnkYAiADKAsySi5wZWVyc190b3VjaC5tb2RlbC5ub3RpZmljYXRpb24udjEuR2V0VW5y'
    'ZWFkQ291bnRzUmVzcG9uc2UuQnlDYXRlZ29yeUVudHJ5UgpieUNhdGVnb3J5Gj0KD0J5Q2F0ZW'
    'dvcnlFbnRyeRIQCgNrZXkYASABKAVSA2tleRIUCgV2YWx1ZRgCIAEoBVIFdmFsdWU6AjgB');

@$core.Deprecated('Use getNotificationPreferencesRequestDescriptor instead')
const GetNotificationPreferencesRequest$json = {
  '1': 'GetNotificationPreferencesRequest',
};

/// Descriptor for `GetNotificationPreferencesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getNotificationPreferencesRequestDescriptor =
    $convert.base64Decode('CiFHZXROb3RpZmljYXRpb25QcmVmZXJlbmNlc1JlcXVlc3Q=');

@$core.Deprecated('Use getNotificationPreferencesResponseDescriptor instead')
const GetNotificationPreferencesResponse$json = {
  '1': 'GetNotificationPreferencesResponse',
  '2': [
    {
      '1': 'preferences',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.notification.v1.NotificationPreference',
      '10': 'preferences'
    },
  ],
};

/// Descriptor for `GetNotificationPreferencesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getNotificationPreferencesResponseDescriptor =
    $convert.base64Decode(
        'CiJHZXROb3RpZmljYXRpb25QcmVmZXJlbmNlc1Jlc3BvbnNlElsKC3ByZWZlcmVuY2VzGAEgAy'
        'gLMjkucGVlcnNfdG91Y2gubW9kZWwubm90aWZpY2F0aW9uLnYxLk5vdGlmaWNhdGlvblByZWZl'
        'cmVuY2VSC3ByZWZlcmVuY2Vz');

@$core.Deprecated('Use updateNotificationPreferenceRequestDescriptor instead')
const UpdateNotificationPreferenceRequest$json = {
  '1': 'UpdateNotificationPreferenceRequest',
  '2': [
    {
      '1': 'category',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.notification.v1.NotificationCategory',
      '10': 'category'
    },
    {'1': 'enabled', '3': 2, '4': 1, '5': 8, '10': 'enabled'},
    {'1': 'push_enabled', '3': 3, '4': 1, '5': 8, '10': 'pushEnabled'},
    {'1': 'sound_enabled', '3': 4, '4': 1, '5': 8, '10': 'soundEnabled'},
  ],
};

/// Descriptor for `UpdateNotificationPreferenceRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateNotificationPreferenceRequestDescriptor =
    $convert.base64Decode(
        'CiNVcGRhdGVOb3RpZmljYXRpb25QcmVmZXJlbmNlUmVxdWVzdBJTCghjYXRlZ29yeRgBIAEoDj'
        'I3LnBlZXJzX3RvdWNoLm1vZGVsLm5vdGlmaWNhdGlvbi52MS5Ob3RpZmljYXRpb25DYXRlZ29y'
        'eVIIY2F0ZWdvcnkSGAoHZW5hYmxlZBgCIAEoCFIHZW5hYmxlZBIhCgxwdXNoX2VuYWJsZWQYAy'
        'ABKAhSC3B1c2hFbmFibGVkEiMKDXNvdW5kX2VuYWJsZWQYBCABKAhSDHNvdW5kRW5hYmxlZA==');

@$core.Deprecated('Use updateNotificationPreferenceResponseDescriptor instead')
const UpdateNotificationPreferenceResponse$json = {
  '1': 'UpdateNotificationPreferenceResponse',
  '2': [
    {
      '1': 'preference',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.notification.v1.NotificationPreference',
      '10': 'preference'
    },
  ],
};

/// Descriptor for `UpdateNotificationPreferenceResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateNotificationPreferenceResponseDescriptor =
    $convert.base64Decode(
        'CiRVcGRhdGVOb3RpZmljYXRpb25QcmVmZXJlbmNlUmVzcG9uc2USWQoKcHJlZmVyZW5jZRgBIA'
        'EoCzI5LnBlZXJzX3RvdWNoLm1vZGVsLm5vdGlmaWNhdGlvbi52MS5Ob3RpZmljYXRpb25QcmVm'
        'ZXJlbmNlUgpwcmVmZXJlbmNl');
