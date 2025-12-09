// This is a generated file - do not edit.
//
// Generated from domain/masto/oauth.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use mastoOAuthTokenDescriptor instead')
const MastoOAuthToken$json = {
  '1': 'MastoOAuthToken',
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

/// Descriptor for `MastoOAuthToken`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List mastoOAuthTokenDescriptor = $convert.base64Decode(
    'Cg9NYXN0b09BdXRoVG9rZW4SIQoMYWNjZXNzX3Rva2VuGAEgASgJUgthY2Nlc3NUb2tlbhIdCg'
    'p0b2tlbl90eXBlGAIgASgJUgl0b2tlblR5cGUSFAoFc2NvcGUYAyABKAlSBXNjb3BlEjkKCmNy'
    'ZWF0ZWRfYXQYBCABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgljcmVhdGVkQXQ=');
