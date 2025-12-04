// This is a generated file - do not edit.
//
// Generated from domain/core/core.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use peerDescriptor instead')
const Peer$json = {
  '1': 'Peer',
  '2': [
    {'1': 'peer_id', '3': 1, '4': 1, '5': 9, '10': 'peerId'},
    {'1': 'multiaddrs', '3': 2, '4': 3, '5': 9, '10': 'multiaddrs'},
  ],
};

/// Descriptor for `Peer`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List peerDescriptor = $convert.base64Decode(
    'CgRQZWVyEhcKB3BlZXJfaWQYASABKAlSBnBlZXJJZBIeCgptdWx0aWFkZHJzGAIgAygJUgptdW'
    'x0aWFkZHJz');

@$core.Deprecated('Use profileDescriptor instead')
const Profile$json = {
  '1': 'Profile',
  '2': [
    {'1': 'actor_id', '3': 1, '4': 1, '5': 9, '10': 'actorId'},
    {'1': 'bio', '3': 2, '4': 1, '5': 9, '10': 'bio'},
    {
      '1': 'fields',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.core.v1.Profile.FieldsEntry',
      '10': 'fields'
    },
  ],
  '3': [Profile_FieldsEntry$json],
};

@$core.Deprecated('Use profileDescriptor instead')
const Profile_FieldsEntry$json = {
  '1': 'FieldsEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `Profile`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List profileDescriptor = $convert.base64Decode(
    'CgdQcm9maWxlEhkKCGFjdG9yX2lkGAEgASgJUgdhY3RvcklkEhAKA2JpbxgCIAEoCVIDYmlvEk'
    'YKBmZpZWxkcxgDIAMoCzIuLnBlZXJzX3RvdWNoLm1vZGVsLmNvcmUudjEuUHJvZmlsZS5GaWVs'
    'ZHNFbnRyeVIGZmllbGRzGjkKC0ZpZWxkc0VudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbH'
    'VlGAIgASgJUgV2YWx1ZToCOAE=');
