// This is a generated file - do not edit.
//
// Generated from domain/peer/peer.proto.

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

@$core.Deprecated('Use setPeerAddrRequestDescriptor instead')
const SetPeerAddrRequest$json = {
  '1': 'SetPeerAddrRequest',
  '2': [
    {'1': 'addresses', '3': 1, '4': 3, '5': 9, '10': 'addresses'},
  ],
};

/// Descriptor for `SetPeerAddrRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List setPeerAddrRequestDescriptor =
    $convert.base64Decode(
        'ChJTZXRQZWVyQWRkclJlcXVlc3QSHAoJYWRkcmVzc2VzGAEgAygJUglhZGRyZXNzZXM=');

@$core.Deprecated('Use setPeerAddrResponseDescriptor instead')
const SetPeerAddrResponse$json = {
  '1': 'SetPeerAddrResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `SetPeerAddrResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List setPeerAddrResponseDescriptor =
    $convert.base64Decode(
        'ChNTZXRQZWVyQWRkclJlc3BvbnNlEhgKB3N1Y2Nlc3MYASABKAhSB3N1Y2Nlc3M=');

@$core.Deprecated('Use getMyPeerAddrRequestDescriptor instead')
const GetMyPeerAddrRequest$json = {
  '1': 'GetMyPeerAddrRequest',
};

/// Descriptor for `GetMyPeerAddrRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyPeerAddrRequestDescriptor =
    $convert.base64Decode('ChRHZXRNeVBlZXJBZGRyUmVxdWVzdA==');

@$core.Deprecated('Use peerAddrInfoDescriptor instead')
const PeerAddrInfo$json = {
  '1': 'PeerAddrInfo',
  '2': [
    {'1': 'address', '3': 1, '4': 1, '5': 9, '10': 'address'},
    {'1': 'protocol', '3': 2, '4': 1, '5': 9, '10': 'protocol'},
    {
      '1': 'last_seen',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'lastSeen'
    },
  ],
};

/// Descriptor for `PeerAddrInfo`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List peerAddrInfoDescriptor = $convert.base64Decode(
    'CgxQZWVyQWRkckluZm8SGAoHYWRkcmVzcxgBIAEoCVIHYWRkcmVzcxIaCghwcm90b2NvbBgCIA'
    'EoCVIIcHJvdG9jb2wSNwoJbGFzdF9zZWVuGAMgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVz'
    'dGFtcFIIbGFzdFNlZW4=');

@$core.Deprecated('Use getMyPeerAddrResponseDescriptor instead')
const GetMyPeerAddrResponse$json = {
  '1': 'GetMyPeerAddrResponse',
  '2': [
    {
      '1': 'addresses',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.peer.v1.PeerAddrInfo',
      '10': 'addresses'
    },
  ],
};

/// Descriptor for `GetMyPeerAddrResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyPeerAddrResponseDescriptor = $convert.base64Decode(
    'ChVHZXRNeVBlZXJBZGRyUmVzcG9uc2USRQoJYWRkcmVzc2VzGAEgAygLMicucGVlcnNfdG91Y2'
    'gubW9kZWwucGVlci52MS5QZWVyQWRkckluZm9SCWFkZHJlc3Nlcw==');

@$core.Deprecated('Use touchHiRequestDescriptor instead')
const TouchHiRequest$json = {
  '1': 'TouchHiRequest',
  '2': [
    {'1': 'target_peer_id', '3': 1, '4': 1, '5': 9, '10': 'targetPeerId'},
    {'1': 'message', '3': 2, '4': 1, '5': 9, '10': 'message'},
  ],
};

/// Descriptor for `TouchHiRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List touchHiRequestDescriptor = $convert.base64Decode(
    'Cg5Ub3VjaEhpUmVxdWVzdBIkCg50YXJnZXRfcGVlcl9pZBgBIAEoCVIMdGFyZ2V0UGVlcklkEh'
    'gKB21lc3NhZ2UYAiABKAlSB21lc3NhZ2U=');

@$core.Deprecated('Use touchHiResponseDescriptor instead')
const TouchHiResponse$json = {
  '1': 'TouchHiResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
    {'1': 'response_message', '3': 2, '4': 1, '5': 9, '10': 'responseMessage'},
  ],
};

/// Descriptor for `TouchHiResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List touchHiResponseDescriptor = $convert.base64Decode(
    'Cg9Ub3VjaEhpUmVzcG9uc2USGAoHc3VjY2VzcxgBIAEoCFIHc3VjY2VzcxIpChByZXNwb25zZV'
    '9tZXNzYWdlGAIgASgJUg9yZXNwb25zZU1lc3NhZ2U=');
