// This is a generated file - do not edit.
//
// Generated from common.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use healthStatusDescriptor instead')
const HealthStatus$json = {
  '1': 'HealthStatus',
  '2': [
    {'1': 'HEALTH_STATUS_UNKNOWN', '2': 0},
    {'1': 'HEALTH_STATUS_HEALTHY', '2': 1},
    {'1': 'HEALTH_STATUS_DEGRADED', '2': 2},
    {'1': 'HEALTH_STATUS_UNHEALTHY', '2': 3},
  ],
};

/// Descriptor for `HealthStatus`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List healthStatusDescriptor = $convert.base64Decode(
    'CgxIZWFsdGhTdGF0dXMSGQoVSEVBTFRIX1NUQVRVU19VTktOT1dOEAASGQoVSEVBTFRIX1NUQV'
    'RVU19IRUFMVEhZEAESGgoWSEVBTFRIX1NUQVRVU19ERUdSQURFRBACEhsKF0hFQUxUSF9TVEFU'
    'VVNfVU5IRUFMVEhZEAM=');

@$core.Deprecated('Use errorDescriptor instead')
const Error$json = {
  '1': 'Error',
  '2': [
    {'1': 'code', '3': 1, '4': 1, '5': 9, '10': 'code'},
    {'1': 'message', '3': 2, '4': 1, '5': 9, '10': 'message'},
    {
      '1': 'details',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.Error.DetailsEntry',
      '10': 'details'
    },
    {
      '1': 'timestamp',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'timestamp'
    },
  ],
  '3': [Error_DetailsEntry$json],
};

@$core.Deprecated('Use errorDescriptor instead')
const Error_DetailsEntry$json = {
  '1': 'DetailsEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `Error`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List errorDescriptor = $convert.base64Decode(
    'CgVFcnJvchISCgRjb2RlGAEgASgJUgRjb2RlEhgKB21lc3NhZ2UYAiABKAlSB21lc3NhZ2USPA'
    'oHZGV0YWlscxgDIAMoCzIiLnBlZXJzX3RvdWNoLnYyLkVycm9yLkRldGFpbHNFbnRyeVIHZGV0'
    'YWlscxI4Cgl0aW1lc3RhbXAYBCABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgl0aW'
    '1lc3RhbXAaOgoMRGV0YWlsc0VudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbHVlGAIgASgJ'
    'UgV2YWx1ZToCOAE=');

@$core.Deprecated('Use resultDescriptor instead')
const Result$json = {
  '1': 'Result',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
    {
      '1': 'error',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.Error',
      '10': 'error'
    },
    {
      '1': 'metadata',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.Result.MetadataEntry',
      '10': 'metadata'
    },
  ],
  '3': [Result_MetadataEntry$json],
};

@$core.Deprecated('Use resultDescriptor instead')
const Result_MetadataEntry$json = {
  '1': 'MetadataEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `Result`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List resultDescriptor = $convert.base64Decode(
    'CgZSZXN1bHQSGAoHc3VjY2VzcxgBIAEoCFIHc3VjY2VzcxIrCgVlcnJvchgCIAEoCzIVLnBlZX'
    'JzX3RvdWNoLnYyLkVycm9yUgVlcnJvchJACghtZXRhZGF0YRgDIAMoCzIkLnBlZXJzX3RvdWNo'
    'LnYyLlJlc3VsdC5NZXRhZGF0YUVudHJ5UghtZXRhZGF0YRo7Cg1NZXRhZGF0YUVudHJ5EhAKA2'
    'tleRgBIAEoCVIDa2V5EhQKBXZhbHVlGAIgASgJUgV2YWx1ZToCOAE=');

@$core.Deprecated('Use paginationDescriptor instead')
const Pagination$json = {
  '1': 'Pagination',
  '2': [
    {'1': 'page', '3': 1, '4': 1, '5': 5, '10': 'page'},
    {'1': 'page_size', '3': 2, '4': 1, '5': 5, '10': 'pageSize'},
    {'1': 'total_count', '3': 3, '4': 1, '5': 5, '10': 'totalCount'},
    {'1': 'has_next', '3': 4, '4': 1, '5': 8, '10': 'hasNext'},
    {'1': 'has_prev', '3': 5, '4': 1, '5': 8, '10': 'hasPrev'},
    {'1': 'next_token', '3': 6, '4': 1, '5': 9, '10': 'nextToken'},
    {'1': 'prev_token', '3': 7, '4': 1, '5': 9, '10': 'prevToken'},
  ],
};

/// Descriptor for `Pagination`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List paginationDescriptor = $convert.base64Decode(
    'CgpQYWdpbmF0aW9uEhIKBHBhZ2UYASABKAVSBHBhZ2USGwoJcGFnZV9zaXplGAIgASgFUghwYW'
    'dlU2l6ZRIfCgt0b3RhbF9jb3VudBgDIAEoBVIKdG90YWxDb3VudBIZCghoYXNfbmV4dBgEIAEo'
    'CFIHaGFzTmV4dBIZCghoYXNfcHJldhgFIAEoCFIHaGFzUHJldhIdCgpuZXh0X3Rva2VuGAYgAS'
    'gJUgluZXh0VG9rZW4SHQoKcHJldl90b2tlbhgHIAEoCVIJcHJldlRva2Vu');

@$core.Deprecated('Use healthCheckDescriptor instead')
const HealthCheck$json = {
  '1': 'HealthCheck',
  '2': [
    {'1': 'component', '3': 1, '4': 1, '5': 9, '10': 'component'},
    {
      '1': 'status',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.v2.HealthStatus',
      '10': 'status'
    },
    {'1': 'message', '3': 3, '4': 1, '5': 9, '10': 'message'},
    {
      '1': 'checked_at',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'checkedAt'
    },
    {
      '1': 'details',
      '3': 5,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.HealthCheck.DetailsEntry',
      '10': 'details'
    },
  ],
  '3': [HealthCheck_DetailsEntry$json],
};

@$core.Deprecated('Use healthCheckDescriptor instead')
const HealthCheck_DetailsEntry$json = {
  '1': 'DetailsEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `HealthCheck`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List healthCheckDescriptor = $convert.base64Decode(
    'CgtIZWFsdGhDaGVjaxIcCgljb21wb25lbnQYASABKAlSCWNvbXBvbmVudBI0CgZzdGF0dXMYAi'
    'ABKA4yHC5wZWVyc190b3VjaC52Mi5IZWFsdGhTdGF0dXNSBnN0YXR1cxIYCgdtZXNzYWdlGAMg'
    'ASgJUgdtZXNzYWdlEjkKCmNoZWNrZWRfYXQYBCABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZX'
    'N0YW1wUgljaGVja2VkQXQSQgoHZGV0YWlscxgFIAMoCzIoLnBlZXJzX3RvdWNoLnYyLkhlYWx0'
    'aENoZWNrLkRldGFpbHNFbnRyeVIHZGV0YWlscxo6CgxEZXRhaWxzRW50cnkSEAoDa2V5GAEgAS'
    'gJUgNrZXkSFAoFdmFsdWUYAiABKAlSBXZhbHVlOgI4AQ==');

@$core.Deprecated('Use metricsDescriptor instead')
const Metrics$json = {
  '1': 'Metrics',
  '2': [
    {
      '1': 'counters',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.Metrics.CountersEntry',
      '10': 'counters'
    },
    {
      '1': 'gauges',
      '3': 2,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.Metrics.GaugesEntry',
      '10': 'gauges'
    },
    {
      '1': 'histograms',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.Metrics.HistogramsEntry',
      '10': 'histograms'
    },
    {
      '1': 'collected_at',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'collectedAt'
    },
  ],
  '3': [
    Metrics_CountersEntry$json,
    Metrics_GaugesEntry$json,
    Metrics_HistogramsEntry$json
  ],
};

@$core.Deprecated('Use metricsDescriptor instead')
const Metrics_CountersEntry$json = {
  '1': 'CountersEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 1, '10': 'value'},
  ],
  '7': {'7': true},
};

@$core.Deprecated('Use metricsDescriptor instead')
const Metrics_GaugesEntry$json = {
  '1': 'GaugesEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 1, '10': 'value'},
  ],
  '7': {'7': true},
};

@$core.Deprecated('Use metricsDescriptor instead')
const Metrics_HistogramsEntry$json = {
  '1': 'HistogramsEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 1, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `Metrics`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List metricsDescriptor = $convert.base64Decode(
    'CgdNZXRyaWNzEkEKCGNvdW50ZXJzGAEgAygLMiUucGVlcnNfdG91Y2gudjIuTWV0cmljcy5Db3'
    'VudGVyc0VudHJ5Ughjb3VudGVycxI7CgZnYXVnZXMYAiADKAsyIy5wZWVyc190b3VjaC52Mi5N'
    'ZXRyaWNzLkdhdWdlc0VudHJ5UgZnYXVnZXMSRwoKaGlzdG9ncmFtcxgDIAMoCzInLnBlZXJzX3'
    'RvdWNoLnYyLk1ldHJpY3MuSGlzdG9ncmFtc0VudHJ5UgpoaXN0b2dyYW1zEj0KDGNvbGxlY3Rl'
    'ZF9hdBgEIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSC2NvbGxlY3RlZEF0GjsKDU'
    'NvdW50ZXJzRW50cnkSEAoDa2V5GAEgASgJUgNrZXkSFAoFdmFsdWUYAiABKAFSBXZhbHVlOgI4'
    'ARo5CgtHYXVnZXNFbnRyeRIQCgNrZXkYASABKAlSA2tleRIUCgV2YWx1ZRgCIAEoAVIFdmFsdW'
    'U6AjgBGj0KD0hpc3RvZ3JhbXNFbnRyeRIQCgNrZXkYASABKAlSA2tleRIUCgV2YWx1ZRgCIAEo'
    'AVIFdmFsdWU6AjgB');

@$core.Deprecated('Use eventDescriptor instead')
const Event$json = {
  '1': 'Event',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'type', '3': 2, '4': 1, '5': 9, '10': 'type'},
    {'1': 'source', '3': 3, '4': 1, '5': 9, '10': 'source'},
    {'1': 'payload', '3': 4, '4': 1, '5': 12, '10': 'payload'},
    {
      '1': 'attributes',
      '3': 5,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.Event.AttributesEntry',
      '10': 'attributes'
    },
    {
      '1': 'occurred_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'occurredAt'
    },
  ],
  '3': [Event_AttributesEntry$json],
};

@$core.Deprecated('Use eventDescriptor instead')
const Event_AttributesEntry$json = {
  '1': 'AttributesEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `Event`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List eventDescriptor = $convert.base64Decode(
    'CgVFdmVudBIOCgJpZBgBIAEoCVICaWQSEgoEdHlwZRgCIAEoCVIEdHlwZRIWCgZzb3VyY2UYAy'
    'ABKAlSBnNvdXJjZRIYCgdwYXlsb2FkGAQgASgMUgdwYXlsb2FkEkUKCmF0dHJpYnV0ZXMYBSAD'
    'KAsyJS5wZWVyc190b3VjaC52Mi5FdmVudC5BdHRyaWJ1dGVzRW50cnlSCmF0dHJpYnV0ZXMSOw'
    'oLb2NjdXJyZWRfYXQYBiABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgpvY2N1cnJl'
    'ZEF0Gj0KD0F0dHJpYnV0ZXNFbnRyeRIQCgNrZXkYASABKAlSA2tleRIUCgV2YWx1ZRgCIAEoCV'
    'IFdmFsdWU6AjgB');

@$core.Deprecated('Use configurationDescriptor instead')
const Configuration$json = {
  '1': 'Configuration',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
    {'1': 'type', '3': 3, '4': 1, '5': 9, '10': 'type'},
    {'1': 'description', '3': 4, '4': 1, '5': 9, '10': 'description'},
    {'1': 'is_secret', '3': 5, '4': 1, '5': 8, '10': 'isSecret'},
    {
      '1': 'updated_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
  ],
};

/// Descriptor for `Configuration`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List configurationDescriptor = $convert.base64Decode(
    'Cg1Db25maWd1cmF0aW9uEhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbHVlGAIgASgJUgV2YWx1ZR'
    'ISCgR0eXBlGAMgASgJUgR0eXBlEiAKC2Rlc2NyaXB0aW9uGAQgASgJUgtkZXNjcmlwdGlvbhIb'
    'Cglpc19zZWNyZXQYBSABKAhSCGlzU2VjcmV0EjkKCnVwZGF0ZWRfYXQYBiABKAsyGi5nb29nbG'
    'UucHJvdG9idWYuVGltZXN0YW1wUgl1cGRhdGVkQXQ=');
