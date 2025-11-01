// This is a generated file - do not edit.
//
// Generated from station_user_avatar.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use userAvatarDescriptor instead')
const UserAvatar$json = {
  '1': 'UserAvatar',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'user_id', '3': 2, '4': 1, '5': 9, '10': 'userId'},
    {'1': 'filename', '3': 3, '4': 1, '5': 9, '10': 'filename'},
    {'1': 'url', '3': 4, '4': 1, '5': 9, '10': 'url'},
    {'1': 'size', '3': 5, '4': 1, '5': 3, '10': 'size'},
    {'1': 'mime_type', '3': 6, '4': 1, '5': 9, '10': 'mimeType'},
    {'1': 'is_current', '3': 7, '4': 1, '5': 8, '10': 'isCurrent'},
    {
      '1': 'created_at',
      '3': 8,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
  ],
};

/// Descriptor for `UserAvatar`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List userAvatarDescriptor = $convert.base64Decode(
    'CgpVc2VyQXZhdGFyEg4KAmlkGAEgASgJUgJpZBIXCgd1c2VyX2lkGAIgASgJUgZ1c2VySWQSGg'
    'oIZmlsZW5hbWUYAyABKAlSCGZpbGVuYW1lEhAKA3VybBgEIAEoCVIDdXJsEhIKBHNpemUYBSAB'
    'KANSBHNpemUSGwoJbWltZV90eXBlGAYgASgJUghtaW1lVHlwZRIdCgppc19jdXJyZW50GAcgAS'
    'gIUglpc0N1cnJlbnQSOQoKY3JlYXRlZF9hdBgIIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1l'
    'c3RhbXBSCWNyZWF0ZWRBdA==');

@$core.Deprecated('Use uploadAvatarRequestDescriptor instead')
const UploadAvatarRequest$json = {
  '1': 'UploadAvatarRequest',
  '2': [
    {'1': 'user_id', '3': 1, '4': 1, '5': 9, '10': 'userId'},
  ],
};

/// Descriptor for `UploadAvatarRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List uploadAvatarRequestDescriptor =
    $convert.base64Decode(
        'ChNVcGxvYWRBdmF0YXJSZXF1ZXN0EhcKB3VzZXJfaWQYASABKAlSBnVzZXJJZA==');

@$core.Deprecated('Use uploadAvatarResponseDescriptor instead')
const UploadAvatarResponse$json = {
  '1': 'UploadAvatarResponse',
  '2': [
    {
      '1': 'avatar',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v1.user.UserAvatar',
      '10': 'avatar'
    },
    {'1': 'success', '3': 2, '4': 1, '5': 8, '10': 'success'},
    {'1': 'message', '3': 3, '4': 1, '5': 9, '10': 'message'},
  ],
};

/// Descriptor for `UploadAvatarResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List uploadAvatarResponseDescriptor = $convert.base64Decode(
    'ChRVcGxvYWRBdmF0YXJSZXNwb25zZRI3CgZhdmF0YXIYASABKAsyHy5wZWVyc190b3VjaC52MS'
    '51c2VyLlVzZXJBdmF0YXJSBmF2YXRhchIYCgdzdWNjZXNzGAIgASgIUgdzdWNjZXNzEhgKB21l'
    'c3NhZ2UYAyABKAlSB21lc3NhZ2U=');

@$core.Deprecated('Use getUserAvatarsRequestDescriptor instead')
const GetUserAvatarsRequest$json = {
  '1': 'GetUserAvatarsRequest',
  '2': [
    {'1': 'user_id', '3': 1, '4': 1, '5': 9, '10': 'userId'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `GetUserAvatarsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserAvatarsRequestDescriptor = $convert.base64Decode(
    'ChVHZXRVc2VyQXZhdGFyc1JlcXVlc3QSFwoHdXNlcl9pZBgBIAEoCVIGdXNlcklkEhQKBWxpbW'
    'l0GAIgASgFUgVsaW1pdA==');

@$core.Deprecated('Use getUserAvatarsResponseDescriptor instead')
const GetUserAvatarsResponse$json = {
  '1': 'GetUserAvatarsResponse',
  '2': [
    {
      '1': 'avatars',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v1.user.UserAvatar',
      '10': 'avatars'
    },
    {'1': 'success', '3': 2, '4': 1, '5': 8, '10': 'success'},
    {'1': 'message', '3': 3, '4': 1, '5': 9, '10': 'message'},
  ],
};

/// Descriptor for `GetUserAvatarsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserAvatarsResponseDescriptor = $convert.base64Decode(
    'ChZHZXRVc2VyQXZhdGFyc1Jlc3BvbnNlEjkKB2F2YXRhcnMYASADKAsyHy5wZWVyc190b3VjaC'
    '52MS51c2VyLlVzZXJBdmF0YXJSB2F2YXRhcnMSGAoHc3VjY2VzcxgCIAEoCFIHc3VjY2VzcxIY'
    'CgdtZXNzYWdlGAMgASgJUgdtZXNzYWdl');
