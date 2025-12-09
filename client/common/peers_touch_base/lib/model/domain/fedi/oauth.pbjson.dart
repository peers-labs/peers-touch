// This is a generated file - do not edit.
//
// Generated from domain/fedi/oauth.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use fediOAuthTokenDescriptor instead')
const FediOAuthToken$json = {
  '1': 'FediOAuthToken',
  '2': [
    {'1': 'access_token', '3': 1, '4': 1, '5': 9, '10': 'accessToken'},
    {'1': 'token_type', '3': 2, '4': 1, '5': 9, '10': 'tokenType'},
    {'1': 'scope', '3': 3, '4': 1, '5': 9, '10': 'scope'},
    {
      '1': 'created_at',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
  ],
};

/// Descriptor for `FediOAuthToken`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List fediOAuthTokenDescriptor = $convert.base64Decode(
    'Cg5GZWRpT0F1dGhUb2tlbhIhCgxhY2Nlc3NfdG9rZW4YASABKAlSC2FjY2Vzc1Rva2VuEh0KCn'
    'Rva2VuX3R5cGUYAiABKAlSCXRva2VuVHlwZRIUCgVzY29wZRgDIAEoCVIFc2NvcGUSOQoKY3Jl'
    'YXRlZF9hdBgEIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCWNyZWF0ZWRBdA==');
