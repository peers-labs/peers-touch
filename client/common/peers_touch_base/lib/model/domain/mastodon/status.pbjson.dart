// This is a generated file - do not edit.
//
// Generated from domain/mastodon/status.proto.

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

@$core.Deprecated('Use mastodonMediaAttachmentDescriptor instead')
const MastodonMediaAttachment$json = {
  '1': 'MastodonMediaAttachment',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'type', '3': 2, '4': 1, '5': 9, '10': 'type'},
    {'1': 'url', '3': 3, '4': 1, '5': 9, '10': 'url'},
    {'1': 'preview_url', '3': 4, '4': 1, '5': 9, '10': 'previewUrl'},
  ],
};

/// Descriptor for `MastodonMediaAttachment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List mastodonMediaAttachmentDescriptor = $convert.base64Decode(
    'ChdNYXN0b2Rvbk1lZGlhQXR0YWNobWVudBIOCgJpZBgBIAEoCVICaWQSEgoEdHlwZRgCIAEoCV'
    'IEdHlwZRIQCgN1cmwYAyABKAlSA3VybBIfCgtwcmV2aWV3X3VybBgEIAEoCVIKcHJldmlld1Vy'
    'bA==');

@$core.Deprecated('Use mastodonStatusDescriptor instead')
const MastodonStatus$json = {
  '1': 'MastodonStatus',
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
      '6': '.peers_touch.model.mastodon.v1.MastodonAccount',
      '10': 'account'
    },
    {
      '1': 'media_attachments',
      '3': 11,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.mastodon.v1.MastodonMediaAttachment',
      '10': 'mediaAttachments'
    },
  ],
};

/// Descriptor for `MastodonStatus`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List mastodonStatusDescriptor = $convert.base64Decode(
    'Cg5NYXN0b2RvblN0YXR1cxIOCgJpZBgBIAEoCVICaWQSEAoDdXJpGAIgASgJUgN1cmkSOQoKY3'
    'JlYXRlZF9hdBgDIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCWNyZWF0ZWRBdBIY'
    'Cgdjb250ZW50GAQgASgJUgdjb250ZW50Eh4KCnZpc2liaWxpdHkYBSABKAlSCnZpc2liaWxpdH'
    'kSIwoNcmVibG9nc19jb3VudBgGIAEoA1IMcmVibG9nc0NvdW50EikKEGZhdm91cml0ZXNfY291'
    'bnQYByABKANSD2Zhdm91cml0ZXNDb3VudBIjCg5pbl9yZXBseV90b19pZBgIIAEoCVILaW5SZX'
    'BseVRvSWQSGwoJcmVibG9nX2lkGAkgASgJUghyZWJsb2dJZBJICgdhY2NvdW50GAogASgLMi4u'
    'cGVlcnNfdG91Y2gubW9kZWwubWFzdG9kb24udjEuTWFzdG9kb25BY2NvdW50UgdhY2NvdW50Em'
    'MKEW1lZGlhX2F0dGFjaG1lbnRzGAsgAygLMjYucGVlcnNfdG91Y2gubW9kZWwubWFzdG9kb24u'
    'djEuTWFzdG9kb25NZWRpYUF0dGFjaG1lbnRSEG1lZGlhQXR0YWNobWVudHM=');

@$core.Deprecated('Use mastodonTimelinePageDescriptor instead')
const MastodonTimelinePage$json = {
  '1': 'MastodonTimelinePage',
  '2': [
    {
      '1': 'items',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.mastodon.v1.MastodonStatus',
      '10': 'items'
    },
    {'1': 'max_id', '3': 2, '4': 1, '5': 9, '10': 'maxId'},
    {'1': 'since_id', '3': 3, '4': 1, '5': 9, '10': 'sinceId'},
  ],
};

/// Descriptor for `MastodonTimelinePage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List mastodonTimelinePageDescriptor = $convert.base64Decode(
    'ChRNYXN0b2RvblRpbWVsaW5lUGFnZRJDCgVpdGVtcxgBIAMoCzItLnBlZXJzX3RvdWNoLm1vZG'
    'VsLm1hc3RvZG9uLnYxLk1hc3RvZG9uU3RhdHVzUgVpdGVtcxIVCgZtYXhfaWQYAiABKAlSBW1h'
    'eElkEhkKCHNpbmNlX2lkGAMgASgJUgdzaW5jZUlk');

@$core.Deprecated('Use mastodonCreateStatusRequestDescriptor instead')
const MastodonCreateStatusRequest$json = {
  '1': 'MastodonCreateStatusRequest',
  '2': [
    {'1': 'status', '3': 1, '4': 1, '5': 9, '10': 'status'},
    {'1': 'in_reply_to_id', '3': 2, '4': 1, '5': 9, '10': 'inReplyToId'},
    {'1': 'visibility', '3': 3, '4': 1, '5': 9, '10': 'visibility'},
    {'1': 'media_ids', '3': 4, '4': 3, '5': 9, '10': 'mediaIds'},
  ],
};

/// Descriptor for `MastodonCreateStatusRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List mastodonCreateStatusRequestDescriptor =
    $convert.base64Decode(
        'ChtNYXN0b2RvbkNyZWF0ZVN0YXR1c1JlcXVlc3QSFgoGc3RhdHVzGAEgASgJUgZzdGF0dXMSIw'
        'oOaW5fcmVwbHlfdG9faWQYAiABKAlSC2luUmVwbHlUb0lkEh4KCnZpc2liaWxpdHkYAyABKAlS'
        'CnZpc2liaWxpdHkSGwoJbWVkaWFfaWRzGAQgAygJUghtZWRpYUlkcw==');
