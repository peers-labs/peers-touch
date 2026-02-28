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

@$core.Deprecated('Use nodeDescriptor instead')
const Node$json = {
  '1': 'Node',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'version', '3': 3, '4': 1, '5': 9, '10': 'version'},
    {'1': 'addresses', '3': 4, '4': 3, '5': 9, '10': 'addresses'},
    {'1': 'capabilities', '3': 5, '4': 3, '5': 9, '10': 'capabilities'},
    {
      '1': 'metadata',
      '3': 6,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.peer.v1.Node.MetadataEntry',
      '10': 'metadata'
    },
    {'1': 'status', '3': 7, '4': 1, '5': 9, '10': 'status'},
    {'1': 'public_key', '3': 8, '4': 1, '5': 9, '10': 'publicKey'},
    {'1': 'port', '3': 9, '4': 1, '5': 5, '10': 'port'},
    {
      '1': 'last_seen_at',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'lastSeenAt'
    },
    {
      '1': 'heartbeat_at',
      '3': 11,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'heartbeatAt'
    },
    {
      '1': 'registered_at',
      '3': 12,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'registeredAt'
    },
  ],
  '3': [Node_MetadataEntry$json],
};

@$core.Deprecated('Use nodeDescriptor instead')
const Node_MetadataEntry$json = {
  '1': 'MetadataEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `Node`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List nodeDescriptor = $convert.base64Decode(
    'CgROb2RlEg4KAmlkGAEgASgJUgJpZBISCgRuYW1lGAIgASgJUgRuYW1lEhgKB3ZlcnNpb24YAy'
    'ABKAlSB3ZlcnNpb24SHAoJYWRkcmVzc2VzGAQgAygJUglhZGRyZXNzZXMSIgoMY2FwYWJpbGl0'
    'aWVzGAUgAygJUgxjYXBhYmlsaXRpZXMSSQoIbWV0YWRhdGEYBiADKAsyLS5wZWVyc190b3VjaC'
    '5tb2RlbC5wZWVyLnYxLk5vZGUuTWV0YWRhdGFFbnRyeVIIbWV0YWRhdGESFgoGc3RhdHVzGAcg'
    'ASgJUgZzdGF0dXMSHQoKcHVibGljX2tleRgIIAEoCVIJcHVibGljS2V5EhIKBHBvcnQYCSABKA'
    'VSBHBvcnQSPAoMbGFzdF9zZWVuX2F0GAogASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFt'
    'cFIKbGFzdFNlZW5BdBI9CgxoZWFydGJlYXRfYXQYCyABKAsyGi5nb29nbGUucHJvdG9idWYuVG'
    'ltZXN0YW1wUgtoZWFydGJlYXRBdBI/Cg1yZWdpc3RlcmVkX2F0GAwgASgLMhouZ29vZ2xlLnBy'
    'b3RvYnVmLlRpbWVzdGFtcFIMcmVnaXN0ZXJlZEF0GjsKDU1ldGFkYXRhRW50cnkSEAoDa2V5GA'
    'EgASgJUgNrZXkSFAoFdmFsdWUYAiABKAlSBXZhbHVlOgI4AQ==');

@$core.Deprecated('Use listNodesRequestDescriptor instead')
const ListNodesRequest$json = {
  '1': 'ListNodesRequest',
  '2': [
    {'1': 'limit', '3': 1, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'offset', '3': 2, '4': 1, '5': 5, '10': 'offset'},
    {'1': 'status', '3': 3, '4': 3, '5': 9, '10': 'status'},
    {'1': 'capabilities', '3': 4, '4': 3, '5': 9, '10': 'capabilities'},
    {'1': 'online_only', '3': 5, '4': 1, '5': 8, '10': 'onlineOnly'},
  ],
};

/// Descriptor for `ListNodesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listNodesRequestDescriptor = $convert.base64Decode(
    'ChBMaXN0Tm9kZXNSZXF1ZXN0EhQKBWxpbWl0GAEgASgFUgVsaW1pdBIWCgZvZmZzZXQYAiABKA'
    'VSBm9mZnNldBIWCgZzdGF0dXMYAyADKAlSBnN0YXR1cxIiCgxjYXBhYmlsaXRpZXMYBCADKAlS'
    'DGNhcGFiaWxpdGllcxIfCgtvbmxpbmVfb25seRgFIAEoCFIKb25saW5lT25seQ==');

@$core.Deprecated('Use listNodesResponseDescriptor instead')
const ListNodesResponse$json = {
  '1': 'ListNodesResponse',
  '2': [
    {
      '1': 'nodes',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.peer.v1.Node',
      '10': 'nodes'
    },
    {'1': 'total', '3': 2, '4': 1, '5': 3, '10': 'total'},
    {'1': 'page', '3': 3, '4': 1, '5': 5, '10': 'page'},
    {'1': 'size', '3': 4, '4': 1, '5': 5, '10': 'size'},
  ],
};

/// Descriptor for `ListNodesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listNodesResponseDescriptor = $convert.base64Decode(
    'ChFMaXN0Tm9kZXNSZXNwb25zZRI1CgVub2RlcxgBIAMoCzIfLnBlZXJzX3RvdWNoLm1vZGVsLn'
    'BlZXIudjEuTm9kZVIFbm9kZXMSFAoFdG90YWwYAiABKANSBXRvdGFsEhIKBHBhZ2UYAyABKAVS'
    'BHBhZ2USEgoEc2l6ZRgEIAEoBVIEc2l6ZQ==');

@$core.Deprecated('Use getNodeRequestDescriptor instead')
const GetNodeRequest$json = {
  '1': 'GetNodeRequest',
  '2': [
    {'1': 'node_id', '3': 1, '4': 1, '5': 9, '10': 'nodeId'},
  ],
};

/// Descriptor for `GetNodeRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getNodeRequestDescriptor = $convert
    .base64Decode('Cg5HZXROb2RlUmVxdWVzdBIXCgdub2RlX2lkGAEgASgJUgZub2RlSWQ=');

@$core.Deprecated('Use getNodeResponseDescriptor instead')
const GetNodeResponse$json = {
  '1': 'GetNodeResponse',
  '2': [
    {
      '1': 'node',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.peer.v1.Node',
      '10': 'node'
    },
  ],
};

/// Descriptor for `GetNodeResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getNodeResponseDescriptor = $convert.base64Decode(
    'Cg9HZXROb2RlUmVzcG9uc2USMwoEbm9kZRgBIAEoCzIfLnBlZXJzX3RvdWNoLm1vZGVsLnBlZX'
    'IudjEuTm9kZVIEbm9kZQ==');

@$core.Deprecated('Use registerNodeRequestDescriptor instead')
const RegisterNodeRequest$json = {
  '1': 'RegisterNodeRequest',
  '2': [
    {'1': 'name', '3': 1, '4': 1, '5': 9, '10': 'name'},
    {'1': 'version', '3': 2, '4': 1, '5': 9, '10': 'version'},
    {'1': 'capabilities', '3': 3, '4': 3, '5': 9, '10': 'capabilities'},
    {
      '1': 'metadata',
      '3': 4,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.peer.v1.RegisterNodeRequest.MetadataEntry',
      '10': 'metadata'
    },
    {'1': 'public_key', '3': 5, '4': 1, '5': 9, '10': 'publicKey'},
    {'1': 'addresses', '3': 6, '4': 3, '5': 9, '10': 'addresses'},
    {'1': 'port', '3': 7, '4': 1, '5': 5, '10': 'port'},
  ],
  '3': [RegisterNodeRequest_MetadataEntry$json],
};

@$core.Deprecated('Use registerNodeRequestDescriptor instead')
const RegisterNodeRequest_MetadataEntry$json = {
  '1': 'MetadataEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `RegisterNodeRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List registerNodeRequestDescriptor = $convert.base64Decode(
    'ChNSZWdpc3Rlck5vZGVSZXF1ZXN0EhIKBG5hbWUYASABKAlSBG5hbWUSGAoHdmVyc2lvbhgCIA'
    'EoCVIHdmVyc2lvbhIiCgxjYXBhYmlsaXRpZXMYAyADKAlSDGNhcGFiaWxpdGllcxJYCghtZXRh'
    'ZGF0YRgEIAMoCzI8LnBlZXJzX3RvdWNoLm1vZGVsLnBlZXIudjEuUmVnaXN0ZXJOb2RlUmVxdW'
    'VzdC5NZXRhZGF0YUVudHJ5UghtZXRhZGF0YRIdCgpwdWJsaWNfa2V5GAUgASgJUglwdWJsaWNL'
    'ZXkSHAoJYWRkcmVzc2VzGAYgAygJUglhZGRyZXNzZXMSEgoEcG9ydBgHIAEoBVIEcG9ydBo7Cg'
    '1NZXRhZGF0YUVudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbHVlGAIgASgJUgV2YWx1ZToC'
    'OAE=');

@$core.Deprecated('Use registerNodeResponseDescriptor instead')
const RegisterNodeResponse$json = {
  '1': 'RegisterNodeResponse',
  '2': [
    {
      '1': 'node',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.peer.v1.Node',
      '10': 'node'
    },
  ],
};

/// Descriptor for `RegisterNodeResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List registerNodeResponseDescriptor = $convert.base64Decode(
    'ChRSZWdpc3Rlck5vZGVSZXNwb25zZRIzCgRub2RlGAEgASgLMh8ucGVlcnNfdG91Y2gubW9kZW'
    'wucGVlci52MS5Ob2RlUgRub2Rl');

@$core.Deprecated('Use deregisterNodeRequestDescriptor instead')
const DeregisterNodeRequest$json = {
  '1': 'DeregisterNodeRequest',
  '2': [
    {'1': 'node_id', '3': 1, '4': 1, '5': 9, '10': 'nodeId'},
  ],
};

/// Descriptor for `DeregisterNodeRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deregisterNodeRequestDescriptor =
    $convert.base64Decode(
        'ChVEZXJlZ2lzdGVyTm9kZVJlcXVlc3QSFwoHbm9kZV9pZBgBIAEoCVIGbm9kZUlk');

@$core.Deprecated('Use deregisterNodeResponseDescriptor instead')
const DeregisterNodeResponse$json = {
  '1': 'DeregisterNodeResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
    {'1': 'node_id', '3': 2, '4': 1, '5': 9, '10': 'nodeId'},
  ],
};

/// Descriptor for `DeregisterNodeResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deregisterNodeResponseDescriptor =
    $convert.base64Decode(
        'ChZEZXJlZ2lzdGVyTm9kZVJlc3BvbnNlEhgKB3N1Y2Nlc3MYASABKAhSB3N1Y2Nlc3MSFwoHbm'
        '9kZV9pZBgCIAEoCVIGbm9kZUlk');
