// This is a generated file - do not edit.
//
// Generated from domain/actor/actor_status.proto.

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

@$core.Deprecated('Use onlineActorsResponseDescriptor instead')
const OnlineActorsResponse$json = {
  '1': 'OnlineActorsResponse',
  '2': [
    {
      '1': 'actors',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.actor.v1.OnlineActor',
      '10': 'actors'
    },
  ],
};

/// Descriptor for `OnlineActorsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List onlineActorsResponseDescriptor = $convert.base64Decode(
    'ChRPbmxpbmVBY3RvcnNSZXNwb25zZRI/CgZhY3RvcnMYASADKAsyJy5wZWVyc190b3VjaC5tb2'
    'RlbC5hY3Rvci52MS5PbmxpbmVBY3RvclIGYWN0b3Jz');

@$core.Deprecated('Use onlineActorDescriptor instead')
const OnlineActor$json = {
  '1': 'OnlineActor',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 4, '10': 'id'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {
      '1': 'preferred_username',
      '3': 3,
      '4': 1,
      '5': 9,
      '10': 'preferredUsername'
    },
    {'1': 'avatar_url', '3': 4, '4': 1, '5': 9, '10': 'avatarUrl'},
    {'1': 'status', '3': 5, '4': 1, '5': 5, '10': 'status'},
    {'1': 'last_heartbeat', '3': 6, '4': 1, '5': 9, '10': 'lastHeartbeat'},
  ],
};

/// Descriptor for `OnlineActor`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List onlineActorDescriptor = $convert.base64Decode(
    'CgtPbmxpbmVBY3RvchIOCgJpZBgBIAEoBFICaWQSEgoEbmFtZRgCIAEoCVIEbmFtZRItChJwcm'
    'VmZXJyZWRfdXNlcm5hbWUYAyABKAlSEXByZWZlcnJlZFVzZXJuYW1lEh0KCmF2YXRhcl91cmwY'
    'BCABKAlSCWF2YXRhclVybBIWCgZzdGF0dXMYBSABKAVSBnN0YXR1cxIlCg5sYXN0X2hlYXJ0Ym'
    'VhdBgGIAEoCVINbGFzdEhlYXJ0YmVhdA==');

@$core.Deprecated('Use heartbeatRequestDescriptor instead')
const HeartbeatRequest$json = {
  '1': 'HeartbeatRequest',
};

/// Descriptor for `HeartbeatRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List heartbeatRequestDescriptor =
    $convert.base64Decode('ChBIZWFydGJlYXRSZXF1ZXN0');

@$core.Deprecated('Use heartbeatResponseDescriptor instead')
const HeartbeatResponse$json = {
  '1': 'HeartbeatResponse',
};

/// Descriptor for `HeartbeatResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List heartbeatResponseDescriptor =
    $convert.base64Decode('ChFIZWFydGJlYXRSZXNwb25zZQ==');
