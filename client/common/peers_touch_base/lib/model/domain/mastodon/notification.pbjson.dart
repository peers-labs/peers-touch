// This is a generated file - do not edit.
//
// Generated from domain/mastodon/notification.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use mastodonNotificationDescriptor instead')
const MastodonNotification$json = {
  '1': 'MastodonNotification',
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
      '6': '.peers_touch.model.mastodon.v1.MastodonAccount',
      '10': 'account'
    },
    {
      '1': 'status',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.mastodon.v1.MastodonStatus',
      '10': 'status'
    },
  ],
};

/// Descriptor for `MastodonNotification`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List mastodonNotificationDescriptor = $convert.base64Decode(
    'ChRNYXN0b2Rvbk5vdGlmaWNhdGlvbhIOCgJpZBgBIAEoCVICaWQSEgoEdHlwZRgCIAEoCVIEdH'
    'lwZRI5CgpjcmVhdGVkX2F0GAMgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJY3Jl'
    'YXRlZEF0EkgKB2FjY291bnQYBCABKAsyLi5wZWVyc190b3VjaC5tb2RlbC5tYXN0b2Rvbi52MS'
    '5NYXN0b2RvbkFjY291bnRSB2FjY291bnQSRQoGc3RhdHVzGAUgASgLMi0ucGVlcnNfdG91Y2gu'
    'bW9kZWwubWFzdG9kb24udjEuTWFzdG9kb25TdGF0dXNSBnN0YXR1cw==');
