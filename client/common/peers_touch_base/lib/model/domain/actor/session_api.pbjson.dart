// This is a generated file - do not edit.
//
// Generated from domain/actor/session_api.proto.

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

@$core.Deprecated('Use verifySessionRequestDescriptor instead')
const VerifySessionRequest$json = {
  '1': 'VerifySessionRequest',
};

/// Descriptor for `VerifySessionRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List verifySessionRequestDescriptor =
    $convert.base64Decode('ChRWZXJpZnlTZXNzaW9uUmVxdWVzdA==');

@$core.Deprecated('Use verifySessionResponseDescriptor instead')
const VerifySessionResponse$json = {
  '1': 'VerifySessionResponse',
  '2': [
    {'1': 'valid', '3': 1, '4': 1, '5': 8, '10': 'valid'},
    {'1': 'subject_id', '3': 2, '4': 1, '5': 9, '10': 'subjectId'},
    {
      '1': 'attributes',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers.actor.VerifySessionResponse.AttributesEntry',
      '10': 'attributes'
    },
    {
      '1': 'expires_at',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'expiresAt'
    },
  ],
  '3': [VerifySessionResponse_AttributesEntry$json],
};

@$core.Deprecated('Use verifySessionResponseDescriptor instead')
const VerifySessionResponse_AttributesEntry$json = {
  '1': 'AttributesEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `VerifySessionResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List verifySessionResponseDescriptor = $convert.base64Decode(
    'ChVWZXJpZnlTZXNzaW9uUmVzcG9uc2USFAoFdmFsaWQYASABKAhSBXZhbGlkEh0KCnN1YmplY3'
    'RfaWQYAiABKAlSCXN1YmplY3RJZBJSCgphdHRyaWJ1dGVzGAMgAygLMjIucGVlcnMuYWN0b3Iu'
    'VmVyaWZ5U2Vzc2lvblJlc3BvbnNlLkF0dHJpYnV0ZXNFbnRyeVIKYXR0cmlidXRlcxI5CgpleH'
    'BpcmVzX2F0GAQgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJZXhwaXJlc0F0Gj0K'
    'D0F0dHJpYnV0ZXNFbnRyeRIQCgNrZXkYASABKAlSA2tleRIUCgV2YWx1ZRgCIAEoCVIFdmFsdW'
    'U6AjgB');
