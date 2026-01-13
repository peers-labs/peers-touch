// This is a generated file - do not edit.
//
// Generated from domain/ai_box/message_messages.proto.

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

@$core.Deprecated('Use listMessagesRequestDescriptor instead')
const ListMessagesRequest$json = {
  '1': 'ListMessagesRequest',
  '2': [
    {'1': 'session_id', '3': 1, '4': 1, '5': 9, '10': 'sessionId'},
    {'1': 'topic_id', '3': 2, '4': 1, '5': 9, '10': 'topicId'},
    {'1': 'page_size', '3': 3, '4': 1, '5': 5, '10': 'pageSize'},
    {'1': 'page_token', '3': 4, '4': 1, '5': 9, '10': 'pageToken'},
  ],
};

/// Descriptor for `ListMessagesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMessagesRequestDescriptor = $convert.base64Decode(
    'ChNMaXN0TWVzc2FnZXNSZXF1ZXN0Eh0KCnNlc3Npb25faWQYASABKAlSCXNlc3Npb25JZBIZCg'
    'h0b3BpY19pZBgCIAEoCVIHdG9waWNJZBIbCglwYWdlX3NpemUYAyABKAVSCHBhZ2VTaXplEh0K'
    'CnBhZ2VfdG9rZW4YBCABKAlSCXBhZ2VUb2tlbg==');

@$core.Deprecated('Use listMessagesResponseDescriptor instead')
const ListMessagesResponse$json = {
  '1': 'ListMessagesResponse',
  '2': [
    {
      '1': 'messages',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.ai_box.v1.ChatMessage',
      '10': 'messages'
    },
    {'1': 'next_page_token', '3': 2, '4': 1, '5': 9, '10': 'nextPageToken'},
  ],
};

/// Descriptor for `ListMessagesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMessagesResponseDescriptor = $convert.base64Decode(
    'ChRMaXN0TWVzc2FnZXNSZXNwb25zZRJECghtZXNzYWdlcxgBIAMoCzIoLnBlZXJzX3RvdWNoLm'
    '1vZGVsLmFpX2JveC52MS5DaGF0TWVzc2FnZVIIbWVzc2FnZXMSJgoPbmV4dF9wYWdlX3Rva2Vu'
    'GAIgASgJUg1uZXh0UGFnZVRva2Vu');
