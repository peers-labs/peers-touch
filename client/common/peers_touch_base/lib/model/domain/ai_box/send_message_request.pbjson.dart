// This is a generated file - do not edit.
//
// Generated from domain/ai_box/send_message_request.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use sendMessageRequestDescriptor instead')
const SendMessageRequest$json = {
  '1': 'SendMessageRequest',
  '2': [
    {'1': 'session_id', '3': 1, '4': 1, '5': 9, '10': 'sessionId'},
    {'1': 'topic_id', '3': 2, '4': 1, '5': 9, '10': 'topicId'},
    {'1': 'content', '3': 3, '4': 1, '5': 9, '10': 'content'},
    {
      '1': 'attachments',
      '3': 4,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.ai_box.v1.MessageAttachment',
      '10': 'attachments'
    },
    {'1': 'metadata_json', '3': 5, '4': 1, '5': 9, '10': 'metadataJson'},
    {'1': 'stream', '3': 6, '4': 1, '5': 8, '10': 'stream'},
  ],
};

/// Descriptor for `SendMessageRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List sendMessageRequestDescriptor = $convert.base64Decode(
    'ChJTZW5kTWVzc2FnZVJlcXVlc3QSHQoKc2Vzc2lvbl9pZBgBIAEoCVIJc2Vzc2lvbklkEhkKCH'
    'RvcGljX2lkGAIgASgJUgd0b3BpY0lkEhgKB2NvbnRlbnQYAyABKAlSB2NvbnRlbnQSUAoLYXR0'
    'YWNobWVudHMYBCADKAsyLi5wZWVyc190b3VjaC5tb2RlbC5haV9ib3gudjEuTWVzc2FnZUF0dG'
    'FjaG1lbnRSC2F0dGFjaG1lbnRzEiMKDW1ldGFkYXRhX2pzb24YBSABKAlSDG1ldGFkYXRhSnNv'
    'bhIWCgZzdHJlYW0YBiABKAhSBnN0cmVhbQ==');
