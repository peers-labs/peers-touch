// This is a generated file - do not edit.
//
// Generated from domain/oss/oss.proto.

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

@$core.Deprecated('Use fileMetaDescriptor instead')
const FileMeta$json = {
  '1': 'FileMeta',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'filename', '3': 2, '4': 1, '5': 9, '10': 'filename'},
    {'1': 'mime_type', '3': 3, '4': 1, '5': 9, '10': 'mimeType'},
    {'1': 'size', '3': 4, '4': 1, '5': 3, '10': 'size'},
    {'1': 'uploader_did', '3': 5, '4': 1, '5': 9, '10': 'uploaderDid'},
    {
      '1': 'uploaded_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'uploadedAt'
    },
  ],
};

/// Descriptor for `FileMeta`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List fileMetaDescriptor = $convert.base64Decode(
    'CghGaWxlTWV0YRIQCgNrZXkYASABKAlSA2tleRIaCghmaWxlbmFtZRgCIAEoCVIIZmlsZW5hbW'
    'USGwoJbWltZV90eXBlGAMgASgJUghtaW1lVHlwZRISCgRzaXplGAQgASgDUgRzaXplEiEKDHVw'
    'bG9hZGVyX2RpZBgFIAEoCVILdXBsb2FkZXJEaWQSOwoLdXBsb2FkZWRfYXQYBiABKAsyGi5nb2'
    '9nbGUucHJvdG9idWYuVGltZXN0YW1wUgp1cGxvYWRlZEF0');

@$core.Deprecated('Use getFileMetaRequestDescriptor instead')
const GetFileMetaRequest$json = {
  '1': 'GetFileMetaRequest',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
  ],
};

/// Descriptor for `GetFileMetaRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getFileMetaRequestDescriptor = $convert
    .base64Decode('ChJHZXRGaWxlTWV0YVJlcXVlc3QSEAoDa2V5GAEgASgJUgNrZXk=');

@$core.Deprecated('Use getFileMetaResponseDescriptor instead')
const GetFileMetaResponse$json = {
  '1': 'GetFileMetaResponse',
  '2': [
    {
      '1': 'meta',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.oss.v1.FileMeta',
      '10': 'meta'
    },
  ],
};

/// Descriptor for `GetFileMetaResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getFileMetaResponseDescriptor = $convert.base64Decode(
    'ChNHZXRGaWxlTWV0YVJlc3BvbnNlEjYKBG1ldGEYASABKAsyIi5wZWVyc190b3VjaC5tb2RlbC'
    '5vc3MudjEuRmlsZU1ldGFSBG1ldGE=');

@$core.Deprecated('Use uploadFileResponseDescriptor instead')
const UploadFileResponse$json = {
  '1': 'UploadFileResponse',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'url', '3': 2, '4': 1, '5': 9, '10': 'url'},
    {'1': 'size', '3': 3, '4': 1, '5': 3, '10': 'size'},
  ],
};

/// Descriptor for `UploadFileResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List uploadFileResponseDescriptor = $convert.base64Decode(
    'ChJVcGxvYWRGaWxlUmVzcG9uc2USEAoDa2V5GAEgASgJUgNrZXkSEAoDdXJsGAIgASgJUgN1cm'
    'wSEgoEc2l6ZRgDIAEoA1IEc2l6ZQ==');
