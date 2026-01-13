// This is a generated file - do not edit.
//
// Generated from domain/actor/session.proto.

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

@$core.Deprecated('Use actorSessionSnapshotDescriptor instead')
const ActorSessionSnapshot$json = {
  '1': 'ActorSessionSnapshot',
  '2': [
    {'1': 'actor_id', '3': 1, '4': 1, '5': 9, '10': 'actorId'},
    {'1': 'handle', '3': 2, '4': 1, '5': 9, '10': 'handle'},
    {'1': 'protocol', '3': 3, '4': 1, '5': 9, '10': 'protocol'},
    {'1': 'base_url', '3': 4, '4': 1, '5': 9, '10': 'baseUrl'},
    {'1': 'access_token', '3': 5, '4': 1, '5': 9, '10': 'accessToken'},
    {'1': 'refresh_token', '3': 6, '4': 1, '5': 9, '10': 'refreshToken'},
    {
      '1': 'expires_at',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'expiresAt'
    },
    {'1': 'roles', '3': 8, '4': 3, '5': 9, '10': 'roles'},
  ],
};

/// Descriptor for `ActorSessionSnapshot`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List actorSessionSnapshotDescriptor = $convert.base64Decode(
    'ChRBY3RvclNlc3Npb25TbmFwc2hvdBIZCghhY3Rvcl9pZBgBIAEoCVIHYWN0b3JJZBIWCgZoYW'
    '5kbGUYAiABKAlSBmhhbmRsZRIaCghwcm90b2NvbBgDIAEoCVIIcHJvdG9jb2wSGQoIYmFzZV91'
    'cmwYBCABKAlSB2Jhc2VVcmwSIQoMYWNjZXNzX3Rva2VuGAUgASgJUgthY2Nlc3NUb2tlbhIjCg'
    '1yZWZyZXNoX3Rva2VuGAYgASgJUgxyZWZyZXNoVG9rZW4SOQoKZXhwaXJlc19hdBgHIAEoCzIa'
    'Lmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCWV4cGlyZXNBdBIUCgVyb2xlcxgIIAMoCVIFcm'
    '9sZXM=');
