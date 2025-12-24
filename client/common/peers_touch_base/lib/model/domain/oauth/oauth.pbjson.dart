// This is a generated file - do not edit.
//
// Generated from domain/oauth/oauth.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use oAuthClientDescriptor instead')
const OAuthClient$json = {
  '1': 'OAuthClient',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'client_id', '3': 3, '4': 1, '5': 9, '10': 'clientId'},
    {
      '1': 'client_secret_hash',
      '3': 4,
      '4': 1,
      '5': 9,
      '10': 'clientSecretHash'
    },
    {'1': 'redirect_uri', '3': 5, '4': 1, '5': 9, '10': 'redirectUri'},
    {'1': 'scopes', '3': 6, '4': 1, '5': 9, '10': 'scopes'},
    {
      '1': 'created_at',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
  ],
};

/// Descriptor for `OAuthClient`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List oAuthClientDescriptor = $convert.base64Decode(
    'CgtPQXV0aENsaWVudBIOCgJpZBgBIAEoCVICaWQSEgoEbmFtZRgCIAEoCVIEbmFtZRIbCgljbG'
    'llbnRfaWQYAyABKAlSCGNsaWVudElkEiwKEmNsaWVudF9zZWNyZXRfaGFzaBgEIAEoCVIQY2xp'
    'ZW50U2VjcmV0SGFzaBIhCgxyZWRpcmVjdF91cmkYBSABKAlSC3JlZGlyZWN0VXJpEhYKBnNjb3'
    'BlcxgGIAEoCVIGc2NvcGVzEjkKCmNyZWF0ZWRfYXQYByABKAsyGi5nb29nbGUucHJvdG9idWYu'
    'VGltZXN0YW1wUgljcmVhdGVkQXQ=');

@$core.Deprecated('Use oAuthAuthCodeDescriptor instead')
const OAuthAuthCode$json = {
  '1': 'OAuthAuthCode',
  '2': [
    {'1': 'code_hash', '3': 1, '4': 1, '5': 9, '10': 'codeHash'},
    {'1': 'client_id', '3': 2, '4': 1, '5': 9, '10': 'clientId'},
    {'1': 'user_id', '3': 3, '4': 1, '5': 9, '10': 'userId'},
    {'1': 'scopes', '3': 4, '4': 1, '5': 9, '10': 'scopes'},
    {
      '1': 'expires_at',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'expiresAt'
    },
    {'1': 'used', '3': 6, '4': 1, '5': 8, '10': 'used'},
  ],
};

/// Descriptor for `OAuthAuthCode`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List oAuthAuthCodeDescriptor = $convert.base64Decode(
    'Cg1PQXV0aEF1dGhDb2RlEhsKCWNvZGVfaGFzaBgBIAEoCVIIY29kZUhhc2gSGwoJY2xpZW50X2'
    'lkGAIgASgJUghjbGllbnRJZBIXCgd1c2VyX2lkGAMgASgJUgZ1c2VySWQSFgoGc2NvcGVzGAQg'
    'ASgJUgZzY29wZXMSOQoKZXhwaXJlc19hdBgFIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3'
    'RhbXBSCWV4cGlyZXNBdBISCgR1c2VkGAYgASgIUgR1c2Vk');

@$core.Deprecated('Use oAuthTokenDescriptor instead')
const OAuthToken$json = {
  '1': 'OAuthToken',
  '2': [
    {'1': 'access_token_hash', '3': 1, '4': 1, '5': 9, '10': 'accessTokenHash'},
    {
      '1': 'refresh_token_hash',
      '3': 2,
      '4': 1,
      '5': 9,
      '10': 'refreshTokenHash'
    },
    {'1': 'token_type', '3': 3, '4': 1, '5': 9, '10': 'tokenType'},
    {'1': 'scope', '3': 4, '4': 1, '5': 9, '10': 'scope'},
    {'1': 'user_id', '3': 5, '4': 1, '5': 9, '10': 'userId'},
    {'1': 'client_id', '3': 6, '4': 1, '5': 9, '10': 'clientId'},
    {
      '1': 'created_at',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'expires_at',
      '3': 8,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'expiresAt'
    },
  ],
};

/// Descriptor for `OAuthToken`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List oAuthTokenDescriptor = $convert.base64Decode(
    'CgpPQXV0aFRva2VuEioKEWFjY2Vzc190b2tlbl9oYXNoGAEgASgJUg9hY2Nlc3NUb2tlbkhhc2'
    'gSLAoScmVmcmVzaF90b2tlbl9oYXNoGAIgASgJUhByZWZyZXNoVG9rZW5IYXNoEh0KCnRva2Vu'
    'X3R5cGUYAyABKAlSCXRva2VuVHlwZRIUCgVzY29wZRgEIAEoCVIFc2NvcGUSFwoHdXNlcl9pZB'
    'gFIAEoCVIGdXNlcklkEhsKCWNsaWVudF9pZBgGIAEoCVIIY2xpZW50SWQSOQoKY3JlYXRlZF9h'
    'dBgHIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCWNyZWF0ZWRBdBI5CgpleHBpcm'
    'VzX2F0GAggASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJZXhwaXJlc0F0');
