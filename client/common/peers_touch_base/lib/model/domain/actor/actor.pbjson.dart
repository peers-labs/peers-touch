// This is a generated file - do not edit.
//
// Generated from domain/actor/actor.proto.

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

@$core.Deprecated('Use actorDescriptor instead')
const Actor$json = {
  '1': 'Actor',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'username', '3': 2, '4': 1, '5': 9, '10': 'username'},
    {'1': 'display_name', '3': 3, '4': 1, '5': 9, '10': 'displayName'},
    {'1': 'email', '3': 4, '4': 1, '5': 9, '10': 'email'},
    {'1': 'inbox', '3': 5, '4': 1, '5': 9, '10': 'inbox'},
    {'1': 'outbox', '3': 6, '4': 1, '5': 9, '10': 'outbox'},
    {
      '1': 'endpoints',
      '3': 7,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.actor.v1.Actor.EndpointsEntry',
      '10': 'endpoints'
    },
  ],
  '3': [Actor_EndpointsEntry$json],
};

@$core.Deprecated('Use actorDescriptor instead')
const Actor_EndpointsEntry$json = {
  '1': 'EndpointsEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `Actor`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List actorDescriptor = $convert.base64Decode(
    'CgVBY3RvchIOCgJpZBgBIAEoCVICaWQSGgoIdXNlcm5hbWUYAiABKAlSCHVzZXJuYW1lEiEKDG'
    'Rpc3BsYXlfbmFtZRgDIAEoCVILZGlzcGxheU5hbWUSFAoFZW1haWwYBCABKAlSBWVtYWlsEhQK'
    'BWluYm94GAUgASgJUgVpbmJveBIWCgZvdXRib3gYBiABKAlSBm91dGJveBJOCgllbmRwb2ludH'
    'MYByADKAsyMC5wZWVyc190b3VjaC5tb2RlbC5hY3Rvci52MS5BY3Rvci5FbmRwb2ludHNFbnRy'
    'eVIJZW5kcG9pbnRzGjwKDkVuZHBvaW50c0VudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbH'
    'VlGAIgASgJUgV2YWx1ZToCOAE=');

@$core.Deprecated('Use actorListDescriptor instead')
const ActorList$json = {
  '1': 'ActorList',
  '2': [
    {
      '1': 'items',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.actor.v1.Actor',
      '10': 'items'
    },
    {'1': 'total', '3': 2, '4': 1, '5': 3, '10': 'total'},
  ],
};

/// Descriptor for `ActorList`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List actorListDescriptor = $convert.base64Decode(
    'CglBY3Rvckxpc3QSNwoFaXRlbXMYASADKAsyIS5wZWVyc190b3VjaC5tb2RlbC5hY3Rvci52MS'
    '5BY3RvclIFaXRlbXMSFAoFdG90YWwYAiABKANSBXRvdGFs');
