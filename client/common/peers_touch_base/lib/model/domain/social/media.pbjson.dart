// This is a generated file - do not edit.
//
// Generated from domain/social/media.proto.

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

@$core.Deprecated('Use mediaUploadTypeDescriptor instead')
const MediaUploadType$json = {
  '1': 'MediaUploadType',
  '2': [
    {'1': 'MEDIA_IMAGE', '2': 0},
    {'1': 'MEDIA_VIDEO', '2': 1},
    {'1': 'MEDIA_AUDIO', '2': 2},
  ],
};

/// Descriptor for `MediaUploadType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List mediaUploadTypeDescriptor = $convert.base64Decode(
    'Cg9NZWRpYVVwbG9hZFR5cGUSDwoLTUVESUFfSU1BR0UQABIPCgtNRURJQV9WSURFTxABEg8KC0'
    '1FRElBX0FVRElPEAI=');

@$core.Deprecated('Use mediaProcessingStatusDescriptor instead')
const MediaProcessingStatus$json = {
  '1': 'MediaProcessingStatus',
  '2': [
    {'1': 'PENDING', '2': 0},
    {'1': 'PROCESSING', '2': 1},
    {'1': 'READY', '2': 2},
    {'1': 'FAILED', '2': 3},
  ],
};

/// Descriptor for `MediaProcessingStatus`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List mediaProcessingStatusDescriptor = $convert.base64Decode(
    'ChVNZWRpYVByb2Nlc3NpbmdTdGF0dXMSCwoHUEVORElORxAAEg4KClBST0NFU1NJTkcQARIJCg'
    'VSRUFEWRACEgoKBkZBSUxFRBAD');

@$core.Deprecated('Use uploadMediaRequestDescriptor instead')
const UploadMediaRequest$json = {
  '1': 'UploadMediaRequest',
  '2': [
    {'1': 'data', '3': 1, '4': 1, '5': 12, '10': 'data'},
    {'1': 'filename', '3': 2, '4': 1, '5': 9, '10': 'filename'},
    {'1': 'mime_type', '3': 3, '4': 1, '5': 9, '10': 'mimeType'},
    {
      '1': 'type',
      '3': 4,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.social.v1.MediaUploadType',
      '10': 'type'
    },
    {
      '1': 'alt_text',
      '3': 5,
      '4': 1,
      '5': 9,
      '9': 0,
      '10': 'altText',
      '17': true
    },
  ],
  '8': [
    {'1': '_alt_text'},
  ],
};

/// Descriptor for `UploadMediaRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List uploadMediaRequestDescriptor = $convert.base64Decode(
    'ChJVcGxvYWRNZWRpYVJlcXVlc3QSEgoEZGF0YRgBIAEoDFIEZGF0YRIaCghmaWxlbmFtZRgCIA'
    'EoCVIIZmlsZW5hbWUSGwoJbWltZV90eXBlGAMgASgJUghtaW1lVHlwZRJACgR0eXBlGAQgASgO'
    'MiwucGVlcnNfdG91Y2gubW9kZWwuc29jaWFsLnYxLk1lZGlhVXBsb2FkVHlwZVIEdHlwZRIeCg'
    'hhbHRfdGV4dBgFIAEoCUgAUgdhbHRUZXh0iAEBQgsKCV9hbHRfdGV4dA==');

@$core.Deprecated('Use uploadMediaResponseDescriptor instead')
const UploadMediaResponse$json = {
  '1': 'UploadMediaResponse',
  '2': [
    {'1': 'media_id', '3': 1, '4': 1, '5': 9, '10': 'mediaId'},
    {'1': 'url', '3': 2, '4': 1, '5': 9, '10': 'url'},
    {'1': 'thumbnail_url', '3': 3, '4': 1, '5': 9, '10': 'thumbnailUrl'},
    {'1': 'size_bytes', '3': 4, '4': 1, '5': 3, '10': 'sizeBytes'},
    {'1': 'width', '3': 5, '4': 1, '5': 5, '10': 'width'},
    {'1': 'height', '3': 6, '4': 1, '5': 5, '10': 'height'},
    {'1': 'duration_seconds', '3': 7, '4': 1, '5': 5, '10': 'durationSeconds'},
    {
      '1': 'status',
      '3': 8,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.social.v1.MediaProcessingStatus',
      '10': 'status'
    },
  ],
};

/// Descriptor for `UploadMediaResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List uploadMediaResponseDescriptor = $convert.base64Decode(
    'ChNVcGxvYWRNZWRpYVJlc3BvbnNlEhkKCG1lZGlhX2lkGAEgASgJUgdtZWRpYUlkEhAKA3VybB'
    'gCIAEoCVIDdXJsEiMKDXRodW1ibmFpbF91cmwYAyABKAlSDHRodW1ibmFpbFVybBIdCgpzaXpl'
    'X2J5dGVzGAQgASgDUglzaXplQnl0ZXMSFAoFd2lkdGgYBSABKAVSBXdpZHRoEhYKBmhlaWdodB'
    'gGIAEoBVIGaGVpZ2h0EikKEGR1cmF0aW9uX3NlY29uZHMYByABKAVSD2R1cmF0aW9uU2Vjb25k'
    'cxJKCgZzdGF0dXMYCCABKA4yMi5wZWVyc190b3VjaC5tb2RlbC5zb2NpYWwudjEuTWVkaWFQcm'
    '9jZXNzaW5nU3RhdHVzUgZzdGF0dXM=');

@$core.Deprecated('Use getMediaRequestDescriptor instead')
const GetMediaRequest$json = {
  '1': 'GetMediaRequest',
  '2': [
    {'1': 'media_id', '3': 1, '4': 1, '5': 9, '10': 'mediaId'},
  ],
};

/// Descriptor for `GetMediaRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMediaRequestDescriptor = $convert.base64Decode(
    'Cg9HZXRNZWRpYVJlcXVlc3QSGQoIbWVkaWFfaWQYASABKAlSB21lZGlhSWQ=');

@$core.Deprecated('Use getMediaResponseDescriptor instead')
const GetMediaResponse$json = {
  '1': 'GetMediaResponse',
  '2': [
    {'1': 'media_id', '3': 1, '4': 1, '5': 9, '10': 'mediaId'},
    {'1': 'url', '3': 2, '4': 1, '5': 9, '10': 'url'},
    {'1': 'thumbnail_url', '3': 3, '4': 1, '5': 9, '10': 'thumbnailUrl'},
    {'1': 'size_bytes', '3': 4, '4': 1, '5': 3, '10': 'sizeBytes'},
    {'1': 'width', '3': 5, '4': 1, '5': 5, '10': 'width'},
    {'1': 'height', '3': 6, '4': 1, '5': 5, '10': 'height'},
    {
      '1': 'status',
      '3': 7,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.social.v1.MediaProcessingStatus',
      '10': 'status'
    },
    {
      '1': 'created_at',
      '3': 8,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
  ],
};

/// Descriptor for `GetMediaResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMediaResponseDescriptor = $convert.base64Decode(
    'ChBHZXRNZWRpYVJlc3BvbnNlEhkKCG1lZGlhX2lkGAEgASgJUgdtZWRpYUlkEhAKA3VybBgCIA'
    'EoCVIDdXJsEiMKDXRodW1ibmFpbF91cmwYAyABKAlSDHRodW1ibmFpbFVybBIdCgpzaXplX2J5'
    'dGVzGAQgASgDUglzaXplQnl0ZXMSFAoFd2lkdGgYBSABKAVSBXdpZHRoEhYKBmhlaWdodBgGIA'
    'EoBVIGaGVpZ2h0EkoKBnN0YXR1cxgHIAEoDjIyLnBlZXJzX3RvdWNoLm1vZGVsLnNvY2lhbC52'
    'MS5NZWRpYVByb2Nlc3NpbmdTdGF0dXNSBnN0YXR1cxI5CgpjcmVhdGVkX2F0GAggASgLMhouZ2'
    '9vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJY3JlYXRlZEF0');

@$core.Deprecated('Use deleteMediaRequestDescriptor instead')
const DeleteMediaRequest$json = {
  '1': 'DeleteMediaRequest',
  '2': [
    {'1': 'media_id', '3': 1, '4': 1, '5': 9, '10': 'mediaId'},
  ],
};

/// Descriptor for `DeleteMediaRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteMediaRequestDescriptor =
    $convert.base64Decode(
        'ChJEZWxldGVNZWRpYVJlcXVlc3QSGQoIbWVkaWFfaWQYASABKAlSB21lZGlhSWQ=');

@$core.Deprecated('Use deleteMediaResponseDescriptor instead')
const DeleteMediaResponse$json = {
  '1': 'DeleteMediaResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `DeleteMediaResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteMediaResponseDescriptor =
    $convert.base64Decode(
        'ChNEZWxldGVNZWRpYVJlc3BvbnNlEhgKB3N1Y2Nlc3MYASABKAhSB3N1Y2Nlc3M=');
