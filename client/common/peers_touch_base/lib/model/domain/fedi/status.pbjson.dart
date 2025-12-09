// This is a generated file - do not edit.
//
// Generated from domain/fedi/status.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use fediMediaAttachmentDescriptor instead')
const FediMediaAttachment$json = {
  '1': 'FediMediaAttachment',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'type', '3': 2, '4': 1, '5': 9, '10': 'type'},
    {'1': 'url', '3': 3, '4': 1, '5': 9, '10': 'url'},
    {'1': 'preview_url', '3': 4, '4': 1, '5': 9, '10': 'previewUrl'},
  ],
};

/// Descriptor for `FediMediaAttachment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List fediMediaAttachmentDescriptor = $convert.base64Decode(
    'ChNGZWRpTWVkaWFBdHRhY2htZW50Eg4KAmlkGAEgASgJUgJpZBISCgR0eXBlGAIgASgJUgR0eX'
    'BlEhAKA3VybBgDIAEoCVIDdXJsEh8KC3ByZXZpZXdfdXJsGAQgASgJUgpwcmV2aWV3VXJs');

@$core.Deprecated('Use fediStatusDescriptor instead')
const FediStatus$json = {
  '1': 'FediStatus',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'uri', '3': 2, '4': 1, '5': 9, '10': 'uri'},
    {
      '1': 'created_at',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {'1': 'content', '3': 4, '4': 1, '5': 9, '10': 'content'},
    {'1': 'visibility', '3': 5, '4': 1, '5': 9, '10': 'visibility'},
    {'1': 'reblogs_count', '3': 6, '4': 1, '5': 3, '10': 'reblogsCount'},
    {'1': 'favourites_count', '3': 7, '4': 1, '5': 3, '10': 'favouritesCount'},
    {'1': 'in_reply_to_id', '3': 8, '4': 1, '5': 9, '10': 'inReplyToId'},
    {'1': 'reblog_id', '3': 9, '4': 1, '5': 9, '10': 'reblogId'},
    {
      '1': 'account',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.fedi.v1.FediAccount',
      '10': 'account'
    },
    {
      '1': 'media_attachments',
      '3': 11,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.fedi.v1.FediMediaAttachment',
      '10': 'mediaAttachments'
    },
  ],
};

/// Descriptor for `FediStatus`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List fediStatusDescriptor = $convert.base64Decode(
    'CgpGZWRpU3RhdHVzEg4KAmlkGAEgASgJUgJpZBIQCgN1cmkYAiABKAlSA3VyaRI5CgpjcmVhdG'
    'VkX2F0GAMgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJY3JlYXRlZEF0EhgKB2Nv'
    'bnRlbnQYBCABKAlSB2NvbnRlbnQSHgoKdmlzaWJpbGl0eRgFIAEoCVIKdmlzaWJpbGl0eRIjCg'
    '1yZWJsb2dzX2NvdW50GAYgASgDUgxyZWJsb2dzQ291bnQSKQoQZmF2b3VyaXRlc19jb3VudBgH'
    'IAEoA1IPZmF2b3VyaXRlc0NvdW50EiMKDmluX3JlcGx5X3RvX2lkGAggASgJUgtpblJlcGx5VG'
    '9JZBIbCglyZWJsb2dfaWQYCSABKAlSCHJlYmxvZ0lkEkAKB2FjY291bnQYCiABKAsyJi5wZWVy'
    'c190b3VjaC5tb2RlbC5mZWRpLnYxLkZlZGlBY2NvdW50UgdhY2NvdW50ElsKEW1lZGlhX2F0dG'
    'FjaG1lbnRzGAsgAygLMi4ucGVlcnNfdG91Y2gubW9kZWwuZmVkaS52MS5GZWRpTWVkaWFBdHRh'
    'Y2htZW50UhBtZWRpYUF0dGFjaG1lbnRz');

@$core.Deprecated('Use fediTimelinePageDescriptor instead')
const FediTimelinePage$json = {
  '1': 'FediTimelinePage',
  '2': [
    {
      '1': 'items',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.fedi.v1.FediStatus',
      '10': 'items'
    },
    {'1': 'max_id', '3': 2, '4': 1, '5': 9, '10': 'maxId'},
    {'1': 'since_id', '3': 3, '4': 1, '5': 9, '10': 'sinceId'},
  ],
};

/// Descriptor for `FediTimelinePage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List fediTimelinePageDescriptor = $convert.base64Decode(
    'ChBGZWRpVGltZWxpbmVQYWdlEjsKBWl0ZW1zGAEgAygLMiUucGVlcnNfdG91Y2gubW9kZWwuZm'
    'VkaS52MS5GZWRpU3RhdHVzUgVpdGVtcxIVCgZtYXhfaWQYAiABKAlSBW1heElkEhkKCHNpbmNl'
    'X2lkGAMgASgJUgdzaW5jZUlk');
