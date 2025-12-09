// This is a generated file - do not edit.
//
// Generated from domain/masto/account.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use mastoAccountDescriptor instead')
const MastoAccount$json = {
  '1': 'MastoAccount',
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

/// Descriptor for `MastoAccount`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List mastoAccountDescriptor = $convert.base64Decode(
    'CgxNYXN0b0FjY291bnQSDgoCaWQYASABKAlSAmlkEhoKCHVzZXJuYW1lGAIgASgJUgh1c2Vybm'
    'FtZRISCgRhY2N0GAMgASgJUgRhY2N0EiEKDGRpc3BsYXlfbmFtZRgEIAEoCVILZGlzcGxheU5h'
    'bWUSEgoEbm90ZRgFIAEoCVIEbm90ZRIWCgZhdmF0YXIYBiABKAlSBmF2YXRhchIWCgZoZWFkZX'
    'IYByABKAlSBmhlYWRlchInCg9mb2xsb3dlcnNfY291bnQYCCABKANSDmZvbGxvd2Vyc0NvdW50'
    'EicKD2ZvbGxvd2luZ19jb3VudBgJIAEoA1IOZm9sbG93aW5nQ291bnQSJQoOc3RhdHVzZXNfY2'
    '91bnQYCiABKANSDXN0YXR1c2VzQ291bnQ=');
