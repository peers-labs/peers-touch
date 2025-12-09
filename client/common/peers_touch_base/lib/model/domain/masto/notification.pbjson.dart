// This is a generated file - do not edit.
//
// Generated from domain/masto/notification.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use mastoNotificationDescriptor instead')
const MastoNotification$json = {
  '1': 'MastoNotification',
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
      '6': '.peers_touch.model.masto.v1.MastoAccount',
      '10': 'account'
    },
    {
      '1': 'status',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.masto.v1.MastoStatus',
      '10': 'status'
    },
  ],
};

/// Descriptor for `MastoNotification`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List mastoNotificationDescriptor = $convert.base64Decode(
    'ChFNYXN0b05vdGlmaWNhdGlvbhIOCgJpZBgBIAEoCVICaWQSEgoEdHlwZRgCIAEoCVIEdHlwZR'
    'I5CgpjcmVhdGVkX2F0GAMgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJY3JlYXRl'
    'ZEF0EkIKB2FjY291bnQYBCABKAsyKC5wZWVyc190b3VjaC5tb2RlbC5tYXN0by52MS5NYXN0b0'
    'FjY291bnRSB2FjY291bnQSPwoGc3RhdHVzGAUgASgLMicucGVlcnNfdG91Y2gubW9kZWwubWFz'
    'dG8udjEuTWFzdG9TdGF0dXNSBnN0YXR1cw==');
