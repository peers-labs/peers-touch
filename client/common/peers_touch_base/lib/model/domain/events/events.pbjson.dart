// This is a generated file - do not edit.
//
// Generated from domain/events/events.proto.

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

@$core.Deprecated('Use eventDescriptor instead')
const Event$json = {
  '1': 'Event',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'type', '3': 2, '4': 1, '5': 9, '10': 'type'},
    {'1': 'payload', '3': 3, '4': 1, '5': 12, '10': 'payload'},
    {
      '1': 'created_at',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
  ],
};

/// Descriptor for `Event`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List eventDescriptor = $convert.base64Decode(
    'CgVFdmVudBIOCgJpZBgBIAEoCVICaWQSEgoEdHlwZRgCIAEoCVIEdHlwZRIYCgdwYXlsb2FkGA'
    'MgASgMUgdwYXlsb2FkEjkKCmNyZWF0ZWRfYXQYBCABKAsyGi5nb29nbGUucHJvdG9idWYuVGlt'
    'ZXN0YW1wUgljcmVhdGVkQXQ=');

@$core.Deprecated('Use pullEventsRequestDescriptor instead')
const PullEventsRequest$json = {
  '1': 'PullEventsRequest',
  '2': [
    {'1': 'limit', '3': 1, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'since_ts', '3': 2, '4': 1, '5': 3, '10': 'sinceTs'},
  ],
};

/// Descriptor for `PullEventsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List pullEventsRequestDescriptor = $convert.base64Decode(
    'ChFQdWxsRXZlbnRzUmVxdWVzdBIUCgVsaW1pdBgBIAEoBVIFbGltaXQSGQoIc2luY2VfdHMYAi'
    'ABKANSB3NpbmNlVHM=');

@$core.Deprecated('Use pullEventsResponseDescriptor instead')
const PullEventsResponse$json = {
  '1': 'PullEventsResponse',
  '2': [
    {
      '1': 'events',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.events.v1.Event',
      '10': 'events'
    },
  ],
};

/// Descriptor for `PullEventsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List pullEventsResponseDescriptor = $convert.base64Decode(
    'ChJQdWxsRXZlbnRzUmVzcG9uc2USOgoGZXZlbnRzGAEgAygLMiIucGVlcnNfdG91Y2gubW9kZW'
    'wuZXZlbnRzLnYxLkV2ZW50UgZldmVudHM=');

@$core.Deprecated('Use ackEventsRequestDescriptor instead')
const AckEventsRequest$json = {
  '1': 'AckEventsRequest',
  '2': [
    {'1': 'event_ids', '3': 1, '4': 3, '5': 9, '10': 'eventIds'},
  ],
};

/// Descriptor for `AckEventsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List ackEventsRequestDescriptor = $convert.base64Decode(
    'ChBBY2tFdmVudHNSZXF1ZXN0EhsKCWV2ZW50X2lkcxgBIAMoCVIIZXZlbnRJZHM=');

@$core.Deprecated('Use ackEventsResponseDescriptor instead')
const AckEventsResponse$json = {
  '1': 'AckEventsResponse',
  '2': [
    {'1': 'acked_count', '3': 1, '4': 1, '5': 5, '10': 'ackedCount'},
  ],
};

/// Descriptor for `AckEventsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List ackEventsResponseDescriptor = $convert.base64Decode(
    'ChFBY2tFdmVudHNSZXNwb25zZRIfCgthY2tlZF9jb3VudBgBIAEoBVIKYWNrZWRDb3VudA==');

@$core.Deprecated('Use getEventsStatsRequestDescriptor instead')
const GetEventsStatsRequest$json = {
  '1': 'GetEventsStatsRequest',
};

/// Descriptor for `GetEventsStatsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getEventsStatsRequestDescriptor =
    $convert.base64Decode('ChVHZXRFdmVudHNTdGF0c1JlcXVlc3Q=');

@$core.Deprecated('Use getEventsStatsResponseDescriptor instead')
const GetEventsStatsResponse$json = {
  '1': 'GetEventsStatsResponse',
  '2': [
    {'1': 'pending_count', '3': 1, '4': 1, '5': 3, '10': 'pendingCount'},
    {'1': 'total_delivered', '3': 2, '4': 1, '5': 3, '10': 'totalDelivered'},
    {'1': 'active_streams', '3': 3, '4': 1, '5': 3, '10': 'activeStreams'},
  ],
};

/// Descriptor for `GetEventsStatsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getEventsStatsResponseDescriptor = $convert.base64Decode(
    'ChZHZXRFdmVudHNTdGF0c1Jlc3BvbnNlEiMKDXBlbmRpbmdfY291bnQYASABKANSDHBlbmRpbm'
    'dDb3VudBInCg90b3RhbF9kZWxpdmVyZWQYAiABKANSDnRvdGFsRGVsaXZlcmVkEiUKDmFjdGl2'
    'ZV9zdHJlYW1zGAMgASgDUg1hY3RpdmVTdHJlYW1z');
