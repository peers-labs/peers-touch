// This is a generated file - do not edit.
//
// Generated from domain/auth/auth.proto.

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

@$core.Deprecated('Use loginRequestDescriptor instead')
const LoginRequest$json = {
  '1': 'LoginRequest',
  '2': [
    {'1': 'email', '3': 1, '4': 1, '5': 9, '10': 'email'},
    {'1': 'password', '3': 2, '4': 1, '5': 9, '10': 'password'},
  ],
};

/// Descriptor for `LoginRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List loginRequestDescriptor = $convert.base64Decode(
    'CgxMb2dpblJlcXVlc3QSFAoFZW1haWwYASABKAlSBWVtYWlsEhoKCHBhc3N3b3JkGAIgASgJUg'
    'hwYXNzd29yZA==');

@$core.Deprecated('Use authTokensDescriptor instead')
const AuthTokens$json = {
  '1': 'AuthTokens',
  '2': [
    {'1': 'token', '3': 1, '4': 1, '5': 9, '10': 'token'},
    {'1': 'access_token', '3': 2, '4': 1, '5': 9, '10': 'accessToken'},
    {'1': 'refresh_token', '3': 3, '4': 1, '5': 9, '10': 'refreshToken'},
    {'1': 'token_type', '3': 4, '4': 1, '5': 9, '10': 'tokenType'},
    {
      '1': 'expires_at',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'expiresAt'
    },
  ],
};

/// Descriptor for `AuthTokens`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List authTokensDescriptor = $convert.base64Decode(
    'CgpBdXRoVG9rZW5zEhQKBXRva2VuGAEgASgJUgV0b2tlbhIhCgxhY2Nlc3NfdG9rZW4YAiABKA'
    'lSC2FjY2Vzc1Rva2VuEiMKDXJlZnJlc2hfdG9rZW4YAyABKAlSDHJlZnJlc2hUb2tlbhIdCgp0'
    'b2tlbl90eXBlGAQgASgJUgl0b2tlblR5cGUSOQoKZXhwaXJlc19hdBgFIAEoCzIaLmdvb2dsZS'
    '5wcm90b2J1Zi5UaW1lc3RhbXBSCWV4cGlyZXNBdA==');

@$core.Deprecated('Use loginDataDescriptor instead')
const LoginData$json = {
  '1': 'LoginData',
  '2': [
    {
      '1': 'tokens',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.auth.v1.AuthTokens',
      '10': 'tokens'
    },
    {'1': 'session_id', '3': 2, '4': 1, '5': 9, '10': 'sessionId'},
    {
      '1': 'actor',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Any',
      '10': 'actor'
    },
  ],
};

/// Descriptor for `LoginData`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List loginDataDescriptor = $convert.base64Decode(
    'CglMb2dpbkRhdGESPQoGdG9rZW5zGAEgASgLMiUucGVlcnNfdG91Y2gubW9kZWwuYXV0aC52MS'
    '5BdXRoVG9rZW5zUgZ0b2tlbnMSHQoKc2Vzc2lvbl9pZBgCIAEoCVIJc2Vzc2lvbklkEioKBWFj'
    'dG9yGAMgASgLMhQuZ29vZ2xlLnByb3RvYnVmLkFueVIFYWN0b3I=');
