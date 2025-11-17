// This is a generated file - do not edit.
//
// Generated from domain/ai_box/access_control.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use accessControlDescriptor instead')
const AccessControl$json = {
  '1': 'AccessControl',
  '2': [
    {'1': 'user_id', '3': 1, '4': 1, '5': 9, '10': 'userId'},
    {'1': 'roles', '3': 2, '4': 3, '5': 9, '10': 'roles'},
    {
      '1': 'permissions',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.ai_box.v1.AccessControl.PermissionsEntry',
      '10': 'permissions'
    },
    {'1': 'granted_at', '3': 4, '4': 1, '5': 3, '10': 'grantedAt'},
    {'1': 'expires_at', '3': 5, '4': 1, '5': 3, '10': 'expiresAt'},
  ],
  '3': [AccessControl_PermissionsEntry$json],
};

@$core.Deprecated('Use accessControlDescriptor instead')
const AccessControl_PermissionsEntry$json = {
  '1': 'PermissionsEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 8, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `AccessControl`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List accessControlDescriptor = $convert.base64Decode(
    'Cg1BY2Nlc3NDb250cm9sEhcKB3VzZXJfaWQYASABKAlSBnVzZXJJZBIUCgVyb2xlcxgCIAMoCV'
    'IFcm9sZXMSXQoLcGVybWlzc2lvbnMYAyADKAsyOy5wZWVyc190b3VjaC5tb2RlbC5haV9ib3gu'
    'djEuQWNjZXNzQ29udHJvbC5QZXJtaXNzaW9uc0VudHJ5UgtwZXJtaXNzaW9ucxIdCgpncmFudG'
    'VkX2F0GAQgASgDUglncmFudGVkQXQSHQoKZXhwaXJlc19hdBgFIAEoA1IJZXhwaXJlc0F0Gj4K'
    'EFBlcm1pc3Npb25zRW50cnkSEAoDa2V5GAEgASgJUgNrZXkSFAoFdmFsdWUYAiABKAhSBXZhbH'
    'VlOgI4AQ==');
