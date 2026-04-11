// This is a generated file - do not edit.
//
// Generated from domain/agent/memory.proto.

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

@$core.Deprecated('Use memoryItemDescriptor instead')
const MemoryItem$json = {
  '1': 'MemoryItem',
  '2': [
    {'1': 'memory_id', '3': 1, '4': 1, '5': 9, '10': 'memoryId'},
    {'1': 'agent_id', '3': 2, '4': 1, '5': 9, '10': 'agentId'},
    {'1': 'target', '3': 3, '4': 1, '5': 9, '10': 'target'},
    {'1': 'content', '3': 4, '4': 1, '5': 9, '10': 'content'},
    {'1': 'source_turn_id', '3': 5, '4': 1, '5': 9, '10': 'sourceTurnId'},
    {
      '1': 'created_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'updated_at',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
  ],
};

/// Descriptor for `MemoryItem`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List memoryItemDescriptor = $convert.base64Decode(
    'CgpNZW1vcnlJdGVtEhsKCW1lbW9yeV9pZBgBIAEoCVIIbWVtb3J5SWQSGQoIYWdlbnRfaWQYAi'
    'ABKAlSB2FnZW50SWQSFgoGdGFyZ2V0GAMgASgJUgZ0YXJnZXQSGAoHY29udGVudBgEIAEoCVIH'
    'Y29udGVudBIkCg5zb3VyY2VfdHVybl9pZBgFIAEoCVIMc291cmNlVHVybklkEjkKCmNyZWF0ZW'
    'RfYXQYBiABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgljcmVhdGVkQXQSOQoKdXBk'
    'YXRlZF9hdBgHIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCXVwZGF0ZWRBdA==');

@$core.Deprecated('Use memorySnapshotDescriptor instead')
const MemorySnapshot$json = {
  '1': 'MemorySnapshot',
  '2': [
    {'1': 'agent_id', '3': 1, '4': 1, '5': 9, '10': 'agentId'},
    {'1': 'memory_content', '3': 2, '4': 1, '5': 9, '10': 'memoryContent'},
    {'1': 'user_content', '3': 3, '4': 1, '5': 9, '10': 'userContent'},
    {
      '1': 'captured_at',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'capturedAt'
    },
  ],
};

/// Descriptor for `MemorySnapshot`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List memorySnapshotDescriptor = $convert.base64Decode(
    'Cg5NZW1vcnlTbmFwc2hvdBIZCghhZ2VudF9pZBgBIAEoCVIHYWdlbnRJZBIlCg5tZW1vcnlfY2'
    '9udGVudBgCIAEoCVINbWVtb3J5Q29udGVudBIhCgx1c2VyX2NvbnRlbnQYAyABKAlSC3VzZXJD'
    'b250ZW50EjsKC2NhcHR1cmVkX2F0GAQgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcF'
    'IKY2FwdHVyZWRBdA==');

@$core.Deprecated('Use listMemoriesRequestDescriptor instead')
const ListMemoriesRequest$json = {
  '1': 'ListMemoriesRequest',
  '2': [
    {'1': 'agent_id', '3': 1, '4': 1, '5': 9, '10': 'agentId'},
    {'1': 'target', '3': 2, '4': 1, '5': 9, '10': 'target'},
  ],
};

/// Descriptor for `ListMemoriesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMemoriesRequestDescriptor = $convert.base64Decode(
    'ChNMaXN0TWVtb3JpZXNSZXF1ZXN0EhkKCGFnZW50X2lkGAEgASgJUgdhZ2VudElkEhYKBnRhcm'
    'dldBgCIAEoCVIGdGFyZ2V0');

@$core.Deprecated('Use listMemoriesResponseDescriptor instead')
const ListMemoriesResponse$json = {
  '1': 'ListMemoriesResponse',
  '2': [
    {
      '1': 'items',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.MemoryItem',
      '10': 'items'
    },
  ],
};

/// Descriptor for `ListMemoriesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMemoriesResponseDescriptor = $convert.base64Decode(
    'ChRMaXN0TWVtb3JpZXNSZXNwb25zZRI8CgVpdGVtcxgBIAMoCzImLnBlZXJzX3RvdWNoLm1vZG'
    'VsLmFnZW50LnYxLk1lbW9yeUl0ZW1SBWl0ZW1z');

@$core.Deprecated('Use getMemorySnapshotRequestDescriptor instead')
const GetMemorySnapshotRequest$json = {
  '1': 'GetMemorySnapshotRequest',
  '2': [
    {'1': 'agent_id', '3': 1, '4': 1, '5': 9, '10': 'agentId'},
  ],
};

/// Descriptor for `GetMemorySnapshotRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMemorySnapshotRequestDescriptor =
    $convert.base64Decode(
        'ChhHZXRNZW1vcnlTbmFwc2hvdFJlcXVlc3QSGQoIYWdlbnRfaWQYASABKAlSB2FnZW50SWQ=');

@$core.Deprecated('Use getMemorySnapshotResponseDescriptor instead')
const GetMemorySnapshotResponse$json = {
  '1': 'GetMemorySnapshotResponse',
  '2': [
    {
      '1': 'snapshot',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.MemorySnapshot',
      '10': 'snapshot'
    },
  ],
};

/// Descriptor for `GetMemorySnapshotResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMemorySnapshotResponseDescriptor =
    $convert.base64Decode(
        'ChlHZXRNZW1vcnlTbmFwc2hvdFJlc3BvbnNlEkYKCHNuYXBzaG90GAEgASgLMioucGVlcnNfdG'
        '91Y2gubW9kZWwuYWdlbnQudjEuTWVtb3J5U25hcHNob3RSCHNuYXBzaG90');

@$core.Deprecated('Use writeMemoryRequestDescriptor instead')
const WriteMemoryRequest$json = {
  '1': 'WriteMemoryRequest',
  '2': [
    {'1': 'agent_id', '3': 1, '4': 1, '5': 9, '10': 'agentId'},
    {'1': 'target', '3': 2, '4': 1, '5': 9, '10': 'target'},
    {'1': 'action', '3': 3, '4': 1, '5': 9, '10': 'action'},
    {'1': 'content', '3': 4, '4': 1, '5': 9, '10': 'content'},
    {'1': 'old_content', '3': 5, '4': 1, '5': 9, '10': 'oldContent'},
    {'1': 'source_turn_id', '3': 6, '4': 1, '5': 9, '10': 'sourceTurnId'},
  ],
};

/// Descriptor for `WriteMemoryRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List writeMemoryRequestDescriptor = $convert.base64Decode(
    'ChJXcml0ZU1lbW9yeVJlcXVlc3QSGQoIYWdlbnRfaWQYASABKAlSB2FnZW50SWQSFgoGdGFyZ2'
    'V0GAIgASgJUgZ0YXJnZXQSFgoGYWN0aW9uGAMgASgJUgZhY3Rpb24SGAoHY29udGVudBgEIAEo'
    'CVIHY29udGVudBIfCgtvbGRfY29udGVudBgFIAEoCVIKb2xkQ29udGVudBIkCg5zb3VyY2VfdH'
    'Vybl9pZBgGIAEoCVIMc291cmNlVHVybklk');

@$core.Deprecated('Use writeMemoryResponseDescriptor instead')
const WriteMemoryResponse$json = {
  '1': 'WriteMemoryResponse',
  '2': [
    {
      '1': 'item',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.MemoryItem',
      '10': 'item'
    },
    {'1': 'success', '3': 2, '4': 1, '5': 8, '10': 'success'},
    {'1': 'message', '3': 3, '4': 1, '5': 9, '10': 'message'},
  ],
};

/// Descriptor for `WriteMemoryResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List writeMemoryResponseDescriptor = $convert.base64Decode(
    'ChNXcml0ZU1lbW9yeVJlc3BvbnNlEjoKBGl0ZW0YASABKAsyJi5wZWVyc190b3VjaC5tb2RlbC'
    '5hZ2VudC52MS5NZW1vcnlJdGVtUgRpdGVtEhgKB3N1Y2Nlc3MYAiABKAhSB3N1Y2Nlc3MSGAoH'
    'bWVzc2FnZRgDIAEoCVIHbWVzc2FnZQ==');
