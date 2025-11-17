// This is a generated file - do not edit.
//
// Generated from domain/ai_box/chat_message.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use chatMessageDescriptor instead')
const ChatMessage$json = {
  '1': 'ChatMessage',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'session_id', '3': 2, '4': 1, '5': 9, '10': 'sessionId'},
    {'1': 'topic_id', '3': 3, '4': 1, '5': 9, '10': 'topicId'},
    {'1': 'model_name', '3': 4, '4': 1, '5': 9, '10': 'modelName'},
    {'1': 'role', '3': 5, '4': 1, '5': 9, '10': 'role'},
    {'1': 'content', '3': 6, '4': 1, '5': 9, '10': 'content'},
    {'1': 'error_json', '3': 7, '4': 1, '5': 9, '10': 'errorJson'},
    {
      '1': 'attachments',
      '3': 8,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.ai_box.v1.MessageAttachment',
      '10': 'attachments'
    },
    {'1': 'images_json', '3': 9, '4': 1, '5': 9, '10': 'imagesJson'},
    {'1': 'metadata_json', '3': 10, '4': 1, '5': 9, '10': 'metadataJson'},
    {'1': 'plugin_json', '3': 11, '4': 1, '5': 9, '10': 'pluginJson'},
    {'1': 'tool_calls_json', '3': 12, '4': 1, '5': 9, '10': 'toolCallsJson'},
    {'1': 'reasoning_json', '3': 13, '4': 1, '5': 9, '10': 'reasoningJson'},
    {'1': 'created_at', '3': 14, '4': 1, '5': 3, '10': 'createdAt'},
    {'1': 'updated_at', '3': 15, '4': 1, '5': 3, '10': 'updatedAt'},
  ],
};

/// Descriptor for `ChatMessage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List chatMessageDescriptor = $convert.base64Decode(
    'CgtDaGF0TWVzc2FnZRIOCgJpZBgBIAEoCVICaWQSHQoKc2Vzc2lvbl9pZBgCIAEoCVIJc2Vzc2'
    'lvbklkEhkKCHRvcGljX2lkGAMgASgJUgd0b3BpY0lkEh0KCm1vZGVsX25hbWUYBCABKAlSCW1v'
    'ZGVsTmFtZRISCgRyb2xlGAUgASgJUgRyb2xlEhgKB2NvbnRlbnQYBiABKAlSB2NvbnRlbnQSHQ'
    'oKZXJyb3JfanNvbhgHIAEoCVIJZXJyb3JKc29uElAKC2F0dGFjaG1lbnRzGAggAygLMi4ucGVl'
    'cnNfdG91Y2gubW9kZWwuYWlfYm94LnYxLk1lc3NhZ2VBdHRhY2htZW50UgthdHRhY2htZW50cx'
    'IfCgtpbWFnZXNfanNvbhgJIAEoCVIKaW1hZ2VzSnNvbhIjCg1tZXRhZGF0YV9qc29uGAogASgJ'
    'UgxtZXRhZGF0YUpzb24SHwoLcGx1Z2luX2pzb24YCyABKAlSCnBsdWdpbkpzb24SJgoPdG9vbF'
    '9jYWxsc19qc29uGAwgASgJUg10b29sQ2FsbHNKc29uEiUKDnJlYXNvbmluZ19qc29uGA0gASgJ'
    'Ug1yZWFzb25pbmdKc29uEh0KCmNyZWF0ZWRfYXQYDiABKANSCWNyZWF0ZWRBdBIdCgp1cGRhdG'
    'VkX2F0GA8gASgDUgl1cGRhdGVkQXQ=');
