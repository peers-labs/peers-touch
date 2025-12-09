// This is a generated file - do not edit.
//
// Generated from domain/fedi/account.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use fediAccountDescriptor instead')
const FediAccount$json = {
  '1': 'FediAccount',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'username', '3': 2, '4': 1, '5': 9, '10': 'username'},
    {'1': 'acct', '3': 3, '4': 1, '5': 9, '10': 'acct'},
    {'1': 'display_name', '3': 4, '4': 1, '5': 9, '10': 'displayName'},
    {'1': 'note', '3': 5, '4': 1, '5': 9, '10': 'note'},
    {'1': 'avatar', '3': 6, '4': 1, '5': 9, '10': 'avatar'},
    {'1': 'header', '3': 7, '4': 1, '5': 9, '10': 'header'},
    {'1': 'followers_count', '3': 8, '4': 1, '5': 3, '10': 'followersCount'},
    {'1': 'following_count', '3': 9, '4': 1, '5': 3, '10': 'followingCount'},
    {'1': 'statuses_count', '3': 10, '4': 1, '5': 3, '10': 'statusesCount'},
  ],
};

/// Descriptor for `FediAccount`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List fediAccountDescriptor = $convert.base64Decode(
    'CgtGZWRpQWNjb3VudBIOCgJpZBgBIAEoCVICaWQSGgoIdXNlcm5hbWUYAiABKAlSCHVzZXJuYW'
    '1lEhIKBGFjY3QYAyABKAlSBGFjY3QSIQoMZGlzcGxheV9uYW1lGAQgASgJUgtkaXNwbGF5TmFt'
    'ZRISCgRub3RlGAUgASgJUgRub3RlEhYKBmF2YXRhchgGIAEoCVIGYXZhdGFyEhYKBmhlYWRlch'
    'gHIAEoCVIGaGVhZGVyEicKD2ZvbGxvd2Vyc19jb3VudBgIIAEoA1IOZm9sbG93ZXJzQ291bnQS'
    'JwoPZm9sbG93aW5nX2NvdW50GAkgASgDUg5mb2xsb3dpbmdDb3VudBIlCg5zdGF0dXNlc19jb3'
    'VudBgKIAEoA1INc3RhdHVzZXNDb3VudA==');
