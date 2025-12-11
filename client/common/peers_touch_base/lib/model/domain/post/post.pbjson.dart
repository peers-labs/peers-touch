// This is a generated file - do not edit.
//
// Generated from domain/post/post.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use attachmentDescriptor instead')
const Attachment$json = {
  '1': 'Attachment',
  '2': [
    {'1': 'media_id', '3': 1, '4': 1, '5': 9, '10': 'mediaId'},
    {'1': 'url', '3': 2, '4': 1, '5': 9, '10': 'url'},
    {'1': 'media_type', '3': 3, '4': 1, '5': 9, '10': 'mediaType'},
    {'1': 'alt', '3': 4, '4': 1, '5': 9, '10': 'alt'},
  ],
};

/// Descriptor for `Attachment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List attachmentDescriptor = $convert.base64Decode(
    'CgpBdHRhY2htZW50EhkKCG1lZGlhX2lkGAEgASgJUgdtZWRpYUlkEhAKA3VybBgCIAEoCVIDdX'
    'JsEh0KCm1lZGlhX3R5cGUYAyABKAlSCW1lZGlhVHlwZRIQCgNhbHQYBCABKAlSA2FsdA==');

@$core.Deprecated('Use pollOptionDescriptor instead')
const PollOption$json = {
  '1': 'PollOption',
  '2': [
    {'1': 'text', '3': 1, '4': 1, '5': 9, '10': 'text'},
  ],
};

/// Descriptor for `PollOption`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List pollOptionDescriptor =
    $convert.base64Decode('CgpQb2xsT3B0aW9uEhIKBHRleHQYASABKAlSBHRleHQ=');

@$core.Deprecated('Use pollDescriptor instead')
const Poll$json = {
  '1': 'Poll',
  '2': [
    {
      '1': 'options',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.post.v1.PollOption',
      '10': 'options'
    },
    {'1': 'expires_in', '3': 2, '4': 1, '5': 5, '10': 'expiresIn'},
    {'1': 'multiple', '3': 3, '4': 1, '5': 8, '10': 'multiple'},
    {'1': 'hide_totals', '3': 4, '4': 1, '5': 8, '10': 'hideTotals'},
  ],
};

/// Descriptor for `Poll`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List pollDescriptor = $convert.base64Decode(
    'CgRQb2xsEj8KB29wdGlvbnMYASADKAsyJS5wZWVyc190b3VjaC5tb2RlbC5wb3N0LnYxLlBvbG'
    'xPcHRpb25SB29wdGlvbnMSHQoKZXhwaXJlc19pbhgCIAEoBVIJZXhwaXJlc0luEhoKCG11bHRp'
    'cGxlGAMgASgIUghtdWx0aXBsZRIfCgtoaWRlX3RvdGFscxgEIAEoCFIKaGlkZVRvdGFscw==');

@$core.Deprecated('Use postInputDescriptor instead')
const PostInput$json = {
  '1': 'PostInput',
  '2': [
    {'1': 'text', '3': 1, '4': 1, '5': 9, '10': 'text'},
    {
      '1': 'attachments',
      '3': 2,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.post.v1.Attachment',
      '10': 'attachments'
    },
    {'1': 'tags', '3': 3, '4': 3, '5': 9, '10': 'tags'},
    {'1': 'visibility', '3': 4, '4': 1, '5': 9, '10': 'visibility'},
    {'1': 'audience', '3': 5, '4': 3, '5': 9, '10': 'audience'},
    {'1': 'cw', '3': 6, '4': 1, '5': 9, '10': 'cw'},
    {'1': 'sensitive', '3': 7, '4': 1, '5': 8, '10': 'sensitive'},
    {'1': 'reply_to', '3': 8, '4': 1, '5': 9, '10': 'replyTo'},
    {
      '1': 'poll',
      '3': 9,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.post.v1.Poll',
      '10': 'poll'
    },
    {
      '1': 'client_time',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'clientTime'
    },
  ],
};

/// Descriptor for `PostInput`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postInputDescriptor = $convert.base64Decode(
    'CglQb3N0SW5wdXQSEgoEdGV4dBgBIAEoCVIEdGV4dBJHCgthdHRhY2htZW50cxgCIAMoCzIlLn'
    'BlZXJzX3RvdWNoLm1vZGVsLnBvc3QudjEuQXR0YWNobWVudFILYXR0YWNobWVudHMSEgoEdGFn'
    'cxgDIAMoCVIEdGFncxIeCgp2aXNpYmlsaXR5GAQgASgJUgp2aXNpYmlsaXR5EhoKCGF1ZGllbm'
    'NlGAUgAygJUghhdWRpZW5jZRIOCgJjdxgGIAEoCVICY3cSHAoJc2Vuc2l0aXZlGAcgASgIUglz'
    'ZW5zaXRpdmUSGQoIcmVwbHlfdG8YCCABKAlSB3JlcGx5VG8SMwoEcG9sbBgJIAEoCzIfLnBlZX'
    'JzX3RvdWNoLm1vZGVsLnBvc3QudjEuUG9sbFIEcG9sbBI7CgtjbGllbnRfdGltZRgKIAEoCzIa'
    'Lmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCmNsaWVudFRpbWU=');

@$core.Deprecated('Use postResponseDescriptor instead')
const PostResponse$json = {
  '1': 'PostResponse',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 9, '10': 'postId'},
    {'1': 'activity_id', '3': 2, '4': 1, '5': 9, '10': 'activityId'},
  ],
};

/// Descriptor for `PostResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postResponseDescriptor = $convert.base64Decode(
    'CgxQb3N0UmVzcG9uc2USFwoHcG9zdF9pZBgBIAEoCVIGcG9zdElkEh8KC2FjdGl2aXR5X2lkGA'
    'IgASgJUgphY3Rpdml0eUlk');

@$core.Deprecated('Use mediaUploadResponseDescriptor instead')
const MediaUploadResponse$json = {
  '1': 'MediaUploadResponse',
  '2': [
    {'1': 'media_id', '3': 1, '4': 1, '5': 9, '10': 'mediaId'},
    {'1': 'url', '3': 2, '4': 1, '5': 9, '10': 'url'},
    {'1': 'media_type', '3': 3, '4': 1, '5': 9, '10': 'mediaType'},
    {'1': 'alt', '3': 4, '4': 1, '5': 9, '10': 'alt'},
  ],
};

/// Descriptor for `MediaUploadResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List mediaUploadResponseDescriptor = $convert.base64Decode(
    'ChNNZWRpYVVwbG9hZFJlc3BvbnNlEhkKCG1lZGlhX2lkGAEgASgJUgdtZWRpYUlkEhAKA3VybB'
    'gCIAEoCVIDdXJsEh0KCm1lZGlhX3R5cGUYAyABKAlSCW1lZGlhVHlwZRIQCgNhbHQYBCABKAlS'
    'A2FsdA==');
