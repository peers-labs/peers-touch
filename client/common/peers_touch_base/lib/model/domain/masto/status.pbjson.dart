// This is a generated file - do not edit.
//
// Generated from domain/masto/status.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use mastoMediaAttachmentDescriptor instead')
const MastoMediaAttachment$json = {
  '1': 'MastoMediaAttachment',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'type', '3': 2, '4': 1, '5': 9, '10': 'type'},
    {'1': 'url', '3': 3, '4': 1, '5': 9, '10': 'url'},
    {'1': 'preview_url', '3': 4, '4': 1, '5': 9, '10': 'previewUrl'},
  ],
};

/// Descriptor for `MastoMediaAttachment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List mastoMediaAttachmentDescriptor = $convert.base64Decode(
    'ChRNYXN0b01lZGlhQXR0YWNobWVudBIOCgJpZBgBIAEoCVICaWQSEgoEdHlwZRgCIAEoCVIEdH'
    'lwZRIQCgN1cmwYAyABKAlSA3VybBIfCgtwcmV2aWV3X3VybBgEIAEoCVIKcHJldmlld1VybA==');

@$core.Deprecated('Use mastoStatusDescriptor instead')
const MastoStatus$json = {
  '1': 'MastoStatus',
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
      '6': '.peers_touch.model.masto.v1.MastoAccount',
      '10': 'account'
    },
    {
      '1': 'media_attachments',
      '3': 11,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.masto.v1.MastoMediaAttachment',
      '10': 'mediaAttachments'
    },
  ],
};

/// Descriptor for `MastoStatus`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List mastoStatusDescriptor = $convert.base64Decode(
    'CgtNYXN0b1N0YXR1cxIOCgJpZBgBIAEoCVICaWQSEAoDdXJpGAIgASgJUgN1cmkSOQoKY3JlYX'
    'RlZF9hdBgDIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCWNyZWF0ZWRBdBIYCgdj'
    'b250ZW50GAQgASgJUgdjb250ZW50Eh4KCnZpc2liaWxpdHkYBSABKAlSCnZpc2liaWxpdHkSIw'
    'oNcmVibG9nc19jb3VudBgGIAEoA1IMcmVibG9nc0NvdW50EikKEGZhdm91cml0ZXNfY291bnQY'
    'ByABKANSD2Zhdm91cml0ZXNDb3VudBIjCg5pbl9yZXBseV90b19pZBgIIAEoCVILaW5SZXBseV'
    'RvSWQSGwoJcmVibG9nX2lkGAkgASgJUghyZWJsb2dJZBJCCgdhY2NvdW50GAogASgLMigucGVl'
    'cnNfdG91Y2gubW9kZWwubWFzdG8udjEuTWFzdG9BY2NvdW50UgdhY2NvdW50El0KEW1lZGlhX2'
    'F0dGFjaG1lbnRzGAsgAygLMjAucGVlcnNfdG91Y2gubW9kZWwubWFzdG8udjEuTWFzdG9NZWRp'
    'YUF0dGFjaG1lbnRSEG1lZGlhQXR0YWNobWVudHM=');

@$core.Deprecated('Use mastoTimelinePageDescriptor instead')
const MastoTimelinePage$json = {
  '1': 'MastoTimelinePage',
  '2': [
    {
      '1': 'items',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.masto.v1.MastoStatus',
      '10': 'items'
    },
    {'1': 'max_id', '3': 2, '4': 1, '5': 9, '10': 'maxId'},
    {'1': 'since_id', '3': 3, '4': 1, '5': 9, '10': 'sinceId'},
  ],
};

/// Descriptor for `MastoTimelinePage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List mastoTimelinePageDescriptor = $convert.base64Decode(
    'ChFNYXN0b1RpbWVsaW5lUGFnZRI9CgVpdGVtcxgBIAMoCzInLnBlZXJzX3RvdWNoLm1vZGVsLm'
    '1hc3RvLnYxLk1hc3RvU3RhdHVzUgVpdGVtcxIVCgZtYXhfaWQYAiABKAlSBW1heElkEhkKCHNp'
    'bmNlX2lkGAMgASgJUgdzaW5jZUlk');
