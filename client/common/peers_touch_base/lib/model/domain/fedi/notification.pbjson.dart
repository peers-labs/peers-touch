// This is a generated file - do not edit.
//
// Generated from domain/fedi/notification.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use fediNotificationDescriptor instead')
const FediNotification$json = {
  '1': 'FediNotification',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'type', '3': 2, '4': 1, '5': 9, '10': 'type'},
    {
      '1': 'created_at',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'account',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.fedi.v1.FediAccount',
      '10': 'account'
    },
    {
      '1': 'status',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.fedi.v1.FediStatus',
      '10': 'status'
    },
  ],
};

/// Descriptor for `FediNotification`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List fediNotificationDescriptor = $convert.base64Decode(
    'ChBGZWRpTm90aWZpY2F0aW9uEg4KAmlkGAEgASgJUgJpZBISCgR0eXBlGAIgASgJUgR0eXBlEj'
    'kKCmNyZWF0ZWRfYXQYAyABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgljcmVhdGVk'
    'QXQSQAoHYWNjb3VudBgEIAEoCzImLnBlZXJzX3RvdWNoLm1vZGVsLmZlZGkudjEuRmVkaUFjY2'
    '91bnRSB2FjY291bnQSPQoGc3RhdHVzGAUgASgLMiUucGVlcnNfdG91Y2gubW9kZWwuZmVkaS52'
    'MS5GZWRpU3RhdHVzUgZzdGF0dXM=');
