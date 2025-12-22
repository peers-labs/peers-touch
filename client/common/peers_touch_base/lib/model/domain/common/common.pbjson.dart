// This is a generated file - do not edit.
//
// Generated from domain/common/common.proto.

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

@$core.Deprecated('Use pageQueryDescriptor instead')
const PageQuery$json = {
  '1': 'PageQuery',
  '2': [
    {'1': 'page_number', '3': 1, '4': 1, '5': 5, '10': 'pageNumber'},
    {'1': 'page_size', '3': 2, '4': 1, '5': 5, '10': 'pageSize'},
  ],
};

/// Descriptor for `PageQuery`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List pageQueryDescriptor = $convert.base64Decode(
    'CglQYWdlUXVlcnkSHwoLcGFnZV9udW1iZXIYASABKAVSCnBhZ2VOdW1iZXISGwoJcGFnZV9zaX'
    'plGAIgASgFUghwYWdlU2l6ZQ==');

@$core.Deprecated('Use pageDataDescriptor instead')
const PageData$json = {
  '1': 'PageData',
  '2': [
    {'1': 'total', '3': 1, '4': 1, '5': 3, '10': 'total'},
    {'1': 'no', '3': 2, '4': 1, '5': 5, '10': 'no'},
  ],
};

/// Descriptor for `PageData`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List pageDataDescriptor = $convert.base64Decode(
    'CghQYWdlRGF0YRIUCgV0b3RhbBgBIAEoA1IFdG90YWwSDgoCbm8YAiABKAVSAm5v');

@$core.Deprecated('Use peersResponseDescriptor instead')
const PeersResponse$json = {
  '1': 'PeersResponse',
  '2': [
    {'1': 'code', '3': 1, '4': 1, '5': 9, '10': 'code'},
    {'1': 'msg', '3': 2, '4': 1, '5': 9, '10': 'msg'},
    {
      '1': 'data',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Any',
      '10': 'data'
    },
  ],
};

/// Descriptor for `PeersResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List peersResponseDescriptor = $convert.base64Decode(
    'Cg1QZWVyc1Jlc3BvbnNlEhIKBGNvZGUYASABKAlSBGNvZGUSEAoDbXNnGAIgASgJUgNtc2cSKA'
    'oEZGF0YRgDIAEoCzIULmdvb2dsZS5wcm90b2J1Zi5BbnlSBGRhdGE=');

@$core.Deprecated('Use errorDescriptor instead')
const Error$json = {
  '1': 'Error',
  '2': [
    {'1': 'code', '3': 1, '4': 1, '5': 9, '10': 'code'},
    {'1': 'message', '3': 2, '4': 1, '5': 9, '10': 'message'},
  ],
};

/// Descriptor for `Error`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List errorDescriptor = $convert.base64Decode(
    'CgVFcnJvchISCgRjb2RlGAEgASgJUgRjb2RlEhgKB21lc3NhZ2UYAiABKAlSB21lc3NhZ2U=');
