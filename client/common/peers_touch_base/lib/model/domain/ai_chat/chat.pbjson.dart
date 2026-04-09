// This is a generated file - do not edit.
//
// Generated from domain/ai_chat/chat.proto.

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

@$core.Deprecated('Use chatRoleDescriptor instead')
const ChatRole$json = {
  '1': 'ChatRole',
  '2': [
    {'1': 'CHAT_ROLE_UNSPECIFIED', '2': 0},
    {'1': 'CHAT_ROLE_SYSTEM', '2': 1},
    {'1': 'CHAT_ROLE_USER', '2': 2},
    {'1': 'CHAT_ROLE_ASSISTANT', '2': 3},
    {'1': 'CHAT_ROLE_TOOL', '2': 4},
  ],
};

/// Descriptor for `ChatRole`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List chatRoleDescriptor = $convert.base64Decode(
    'CghDaGF0Um9sZRIZChVDSEFUX1JPTEVfVU5TUEVDSUZJRUQQABIUChBDSEFUX1JPTEVfU1lTVE'
    'VNEAESEgoOQ0hBVF9ST0xFX1VTRVIQAhIXChNDSEFUX1JPTEVfQVNTSVNUQU5UEAMSEgoOQ0hB'
    'VF9ST0xFX1RPT0wQBA==');

@$core.Deprecated('Use chatSessionDescriptor instead')
const ChatSession$json = {
  '1': 'ChatSession',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'user_id', '3': 2, '4': 1, '5': 9, '10': 'userId'},
    {'1': 'agent_id', '3': 3, '4': 1, '5': 9, '10': 'agentId'},
    {'1': 'title', '3': 4, '4': 1, '5': 9, '10': 'title'},
    {'1': 'description', '3': 5, '4': 1, '5': 9, '10': 'description'},
    {'1': 'avatar', '3': 6, '4': 1, '5': 9, '10': 'avatar'},
    {'1': 'model_name', '3': 7, '4': 1, '5': 9, '10': 'modelName'},
    {'1': 'provider_id', '3': 8, '4': 1, '5': 9, '10': 'providerId'},
    {'1': 'pinned', '3': 9, '4': 1, '5': 8, '10': 'pinned'},
    {'1': 'group', '3': 10, '4': 1, '5': 9, '10': 'group'},
    {'1': 'config_json', '3': 11, '4': 1, '5': 9, '10': 'configJson'},
    {
      '1': 'meta',
      '3': 12,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.ai_chat.v1.ChatSession.MetaEntry',
      '10': 'meta'
    },
    {'1': 'created_at', '3': 13, '4': 1, '5': 3, '10': 'createdAt'},
    {'1': 'updated_at', '3': 14, '4': 1, '5': 3, '10': 'updatedAt'},
  ],
  '3': [ChatSession_MetaEntry$json],
};

@$core.Deprecated('Use chatSessionDescriptor instead')
const ChatSession_MetaEntry$json = {
  '1': 'MetaEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `ChatSession`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List chatSessionDescriptor = $convert.base64Decode(
    'CgtDaGF0U2Vzc2lvbhIOCgJpZBgBIAEoCVICaWQSFwoHdXNlcl9pZBgCIAEoCVIGdXNlcklkEh'
    'kKCGFnZW50X2lkGAMgASgJUgdhZ2VudElkEhQKBXRpdGxlGAQgASgJUgV0aXRsZRIgCgtkZXNj'
    'cmlwdGlvbhgFIAEoCVILZGVzY3JpcHRpb24SFgoGYXZhdGFyGAYgASgJUgZhdmF0YXISHQoKbW'
    '9kZWxfbmFtZRgHIAEoCVIJbW9kZWxOYW1lEh8KC3Byb3ZpZGVyX2lkGAggASgJUgpwcm92aWRl'
    'cklkEhYKBnBpbm5lZBgJIAEoCFIGcGlubmVkEhQKBWdyb3VwGAogASgJUgVncm91cBIfCgtjb2'
    '5maWdfanNvbhgLIAEoCVIKY29uZmlnSnNvbhJHCgRtZXRhGAwgAygLMjMucGVlcnNfdG91Y2gu'
    'bW9kZWwuYWlfY2hhdC52MS5DaGF0U2Vzc2lvbi5NZXRhRW50cnlSBG1ldGESHQoKY3JlYXRlZF'
    '9hdBgNIAEoA1IJY3JlYXRlZEF0Eh0KCnVwZGF0ZWRfYXQYDiABKANSCXVwZGF0ZWRBdBo3CglN'
    'ZXRhRW50cnkSEAoDa2V5GAEgASgJUgNrZXkSFAoFdmFsdWUYAiABKAlSBXZhbHVlOgI4AQ==');

@$core.Deprecated('Use chatTopicDescriptor instead')
const ChatTopic$json = {
  '1': 'ChatTopic',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'session_id', '3': 2, '4': 1, '5': 9, '10': 'sessionId'},
    {'1': 'title', '3': 3, '4': 1, '5': 9, '10': 'title'},
    {'1': 'description', '3': 4, '4': 1, '5': 9, '10': 'description'},
    {'1': 'message_count', '3': 5, '4': 1, '5': 5, '10': 'messageCount'},
    {'1': 'first_message_id', '3': 6, '4': 1, '5': 9, '10': 'firstMessageId'},
    {'1': 'last_message_id', '3': 7, '4': 1, '5': 9, '10': 'lastMessageId'},
    {'1': 'created_at', '3': 8, '4': 1, '5': 3, '10': 'createdAt'},
    {'1': 'updated_at', '3': 9, '4': 1, '5': 3, '10': 'updatedAt'},
  ],
};

/// Descriptor for `ChatTopic`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List chatTopicDescriptor = $convert.base64Decode(
    'CglDaGF0VG9waWMSDgoCaWQYASABKAlSAmlkEh0KCnNlc3Npb25faWQYAiABKAlSCXNlc3Npb2'
    '5JZBIUCgV0aXRsZRgDIAEoCVIFdGl0bGUSIAoLZGVzY3JpcHRpb24YBCABKAlSC2Rlc2NyaXB0'
    'aW9uEiMKDW1lc3NhZ2VfY291bnQYBSABKAVSDG1lc3NhZ2VDb3VudBIoChBmaXJzdF9tZXNzYW'
    'dlX2lkGAYgASgJUg5maXJzdE1lc3NhZ2VJZBImCg9sYXN0X21lc3NhZ2VfaWQYByABKAlSDWxh'
    'c3RNZXNzYWdlSWQSHQoKY3JlYXRlZF9hdBgIIAEoA1IJY3JlYXRlZEF0Eh0KCnVwZGF0ZWRfYX'
    'QYCSABKANSCXVwZGF0ZWRBdA==');

@$core.Deprecated('Use messageAttachmentDescriptor instead')
const MessageAttachment$json = {
  '1': 'MessageAttachment',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'message_id', '3': 2, '4': 1, '5': 9, '10': 'messageId'},
    {'1': 'name', '3': 3, '4': 1, '5': 9, '10': 'name'},
    {'1': 'size', '3': 4, '4': 1, '5': 3, '10': 'size'},
    {'1': 'type', '3': 5, '4': 1, '5': 9, '10': 'type'},
    {'1': 'url', '3': 6, '4': 1, '5': 9, '10': 'url'},
    {'1': 'metadata_json', '3': 7, '4': 1, '5': 9, '10': 'metadataJson'},
    {'1': 'created_at', '3': 8, '4': 1, '5': 3, '10': 'createdAt'},
  ],
};

/// Descriptor for `MessageAttachment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List messageAttachmentDescriptor = $convert.base64Decode(
    'ChFNZXNzYWdlQXR0YWNobWVudBIOCgJpZBgBIAEoCVICaWQSHQoKbWVzc2FnZV9pZBgCIAEoCV'
    'IJbWVzc2FnZUlkEhIKBG5hbWUYAyABKAlSBG5hbWUSEgoEc2l6ZRgEIAEoA1IEc2l6ZRISCgR0'
    'eXBlGAUgASgJUgR0eXBlEhAKA3VybBgGIAEoCVIDdXJsEiMKDW1ldGFkYXRhX2pzb24YByABKA'
    'lSDG1ldGFkYXRhSnNvbhIdCgpjcmVhdGVkX2F0GAggASgDUgljcmVhdGVkQXQ=');

@$core.Deprecated('Use toolCallDescriptor instead')
const ToolCall$json = {
  '1': 'ToolCall',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'type', '3': 2, '4': 1, '5': 9, '10': 'type'},
    {
      '1': 'function',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Struct',
      '10': 'function'
    },
  ],
};

/// Descriptor for `ToolCall`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List toolCallDescriptor = $convert.base64Decode(
    'CghUb29sQ2FsbBIOCgJpZBgBIAEoCVICaWQSEgoEdHlwZRgCIAEoCVIEdHlwZRIzCghmdW5jdG'
    'lvbhgDIAEoCzIXLmdvb2dsZS5wcm90b2J1Zi5TdHJ1Y3RSCGZ1bmN0aW9u');

@$core.Deprecated('Use chatMessageDescriptor instead')
const ChatMessage$json = {
  '1': 'ChatMessage',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'session_id', '3': 2, '4': 1, '5': 9, '10': 'sessionId'},
    {'1': 'topic_id', '3': 3, '4': 1, '5': 9, '10': 'topicId'},
    {'1': 'model_name', '3': 4, '4': 1, '5': 9, '10': 'modelName'},
    {
      '1': 'role',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.ai_chat.v1.ChatRole',
      '10': 'role'
    },
    {'1': 'content', '3': 6, '4': 1, '5': 9, '10': 'content'},
    {'1': 'reasoning_json', '3': 7, '4': 1, '5': 9, '10': 'reasoningJson'},
    {
      '1': 'attachments',
      '3': 8,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.ai_chat.v1.MessageAttachment',
      '10': 'attachments'
    },
    {'1': 'metadata_json', '3': 9, '4': 1, '5': 9, '10': 'metadataJson'},
    {'1': 'plugin_json', '3': 10, '4': 1, '5': 9, '10': 'pluginJson'},
    {'1': 'tool_calls_json', '3': 11, '4': 1, '5': 9, '10': 'toolCallsJson'},
    {'1': 'error_json', '3': 12, '4': 1, '5': 9, '10': 'errorJson'},
    {'1': 'created_at', '3': 13, '4': 1, '5': 3, '10': 'createdAt'},
    {'1': 'updated_at', '3': 14, '4': 1, '5': 3, '10': 'updatedAt'},
  ],
};

/// Descriptor for `ChatMessage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List chatMessageDescriptor = $convert.base64Decode(
    'CgtDaGF0TWVzc2FnZRIOCgJpZBgBIAEoCVICaWQSHQoKc2Vzc2lvbl9pZBgCIAEoCVIJc2Vzc2'
    'lvbklkEhkKCHRvcGljX2lkGAMgASgJUgd0b3BpY0lkEh0KCm1vZGVsX25hbWUYBCABKAlSCW1v'
    'ZGVsTmFtZRI6CgRyb2xlGAUgASgOMiYucGVlcnNfdG91Y2gubW9kZWwuYWlfY2hhdC52MS5DaG'
    'F0Um9sZVIEcm9sZRIYCgdjb250ZW50GAYgASgJUgdjb250ZW50EiUKDnJlYXNvbmluZ19qc29u'
    'GAcgASgJUg1yZWFzb25pbmdKc29uElEKC2F0dGFjaG1lbnRzGAggAygLMi8ucGVlcnNfdG91Y2'
    'gubW9kZWwuYWlfY2hhdC52MS5NZXNzYWdlQXR0YWNobWVudFILYXR0YWNobWVudHMSIwoNbWV0'
    'YWRhdGFfanNvbhgJIAEoCVIMbWV0YWRhdGFKc29uEh8KC3BsdWdpbl9qc29uGAogASgJUgpwbH'
    'VnaW5Kc29uEiYKD3Rvb2xfY2FsbHNfanNvbhgLIAEoCVINdG9vbENhbGxzSnNvbhIdCgplcnJv'
    'cl9qc29uGAwgASgJUgllcnJvckpzb24SHQoKY3JlYXRlZF9hdBgNIAEoA1IJY3JlYXRlZEF0Eh'
    '0KCnVwZGF0ZWRfYXQYDiABKANSCXVwZGF0ZWRBdA==');

@$core.Deprecated('Use chatCompletionRequestDescriptor instead')
const ChatCompletionRequest$json = {
  '1': 'ChatCompletionRequest',
  '2': [
    {'1': 'session_id', '3': 1, '4': 1, '5': 9, '10': 'sessionId'},
    {'1': 'topic_id', '3': 2, '4': 1, '5': 9, '10': 'topicId'},
    {'1': 'model', '3': 3, '4': 1, '5': 9, '10': 'model'},
    {
      '1': 'messages',
      '3': 4,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.ai_chat.v1.ChatMessage',
      '10': 'messages'
    },
    {'1': 'stream', '3': 5, '4': 1, '5': 8, '9': 0, '10': 'stream', '17': true},
    {
      '1': 'temperature',
      '3': 6,
      '4': 1,
      '5': 1,
      '9': 1,
      '10': 'temperature',
      '17': true
    },
    {
      '1': 'max_tokens',
      '3': 7,
      '4': 1,
      '5': 5,
      '9': 2,
      '10': 'maxTokens',
      '17': true
    },
    {'1': 'top_p', '3': 8, '4': 1, '5': 1, '9': 3, '10': 'topP', '17': true},
    {'1': 'user', '3': 9, '4': 1, '5': 9, '9': 4, '10': 'user', '17': true},
  ],
  '8': [
    {'1': '_stream'},
    {'1': '_temperature'},
    {'1': '_max_tokens'},
    {'1': '_top_p'},
    {'1': '_user'},
  ],
};

/// Descriptor for `ChatCompletionRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List chatCompletionRequestDescriptor = $convert.base64Decode(
    'ChVDaGF0Q29tcGxldGlvblJlcXVlc3QSHQoKc2Vzc2lvbl9pZBgBIAEoCVIJc2Vzc2lvbklkEh'
    'kKCHRvcGljX2lkGAIgASgJUgd0b3BpY0lkEhQKBW1vZGVsGAMgASgJUgVtb2RlbBJFCghtZXNz'
    'YWdlcxgEIAMoCzIpLnBlZXJzX3RvdWNoLm1vZGVsLmFpX2NoYXQudjEuQ2hhdE1lc3NhZ2VSCG'
    '1lc3NhZ2VzEhsKBnN0cmVhbRgFIAEoCEgAUgZzdHJlYW2IAQESJQoLdGVtcGVyYXR1cmUYBiAB'
    'KAFIAVILdGVtcGVyYXR1cmWIAQESIgoKbWF4X3Rva2VucxgHIAEoBUgCUgltYXhUb2tlbnOIAQ'
    'ESGAoFdG9wX3AYCCABKAFIA1IEdG9wUIgBARIXCgR1c2VyGAkgASgJSARSBHVzZXKIAQFCCQoH'
    'X3N0cmVhbUIOCgxfdGVtcGVyYXR1cmVCDQoLX21heF90b2tlbnNCCAoGX3RvcF9wQgcKBV91c2'
    'Vy');

@$core.Deprecated('Use chatChoiceDescriptor instead')
const ChatChoice$json = {
  '1': 'ChatChoice',
  '2': [
    {'1': 'index', '3': 1, '4': 1, '5': 5, '10': 'index'},
    {
      '1': 'message',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.ai_chat.v1.ChatMessage',
      '10': 'message'
    },
    {
      '1': 'finish_reason',
      '3': 3,
      '4': 1,
      '5': 9,
      '9': 0,
      '10': 'finishReason',
      '17': true
    },
  ],
  '8': [
    {'1': '_finish_reason'},
  ],
};

/// Descriptor for `ChatChoice`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List chatChoiceDescriptor = $convert.base64Decode(
    'CgpDaGF0Q2hvaWNlEhQKBWluZGV4GAEgASgFUgVpbmRleBJDCgdtZXNzYWdlGAIgASgLMikucG'
    'VlcnNfdG91Y2gubW9kZWwuYWlfY2hhdC52MS5DaGF0TWVzc2FnZVIHbWVzc2FnZRIoCg1maW5p'
    'c2hfcmVhc29uGAMgASgJSABSDGZpbmlzaFJlYXNvbogBAUIQCg5fZmluaXNoX3JlYXNvbg==');

@$core.Deprecated('Use usageDescriptor instead')
const Usage$json = {
  '1': 'Usage',
  '2': [
    {'1': 'prompt_tokens', '3': 1, '4': 1, '5': 5, '10': 'promptTokens'},
    {
      '1': 'completion_tokens',
      '3': 2,
      '4': 1,
      '5': 5,
      '10': 'completionTokens'
    },
    {'1': 'total_tokens', '3': 3, '4': 1, '5': 5, '10': 'totalTokens'},
  ],
};

/// Descriptor for `Usage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List usageDescriptor = $convert.base64Decode(
    'CgVVc2FnZRIjCg1wcm9tcHRfdG9rZW5zGAEgASgFUgxwcm9tcHRUb2tlbnMSKwoRY29tcGxldG'
    'lvbl90b2tlbnMYAiABKAVSEGNvbXBsZXRpb25Ub2tlbnMSIQoMdG90YWxfdG9rZW5zGAMgASgF'
    'Ugt0b3RhbFRva2Vucw==');

@$core.Deprecated('Use chatCompletionResponseDescriptor instead')
const ChatCompletionResponse$json = {
  '1': 'ChatCompletionResponse',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'object', '3': 2, '4': 1, '5': 9, '10': 'object'},
    {'1': 'created', '3': 3, '4': 1, '5': 3, '10': 'created'},
    {'1': 'model', '3': 4, '4': 1, '5': 9, '10': 'model'},
    {
      '1': 'choices',
      '3': 5,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.ai_chat.v1.ChatChoice',
      '10': 'choices'
    },
    {
      '1': 'usage',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.ai_chat.v1.Usage',
      '10': 'usage'
    },
  ],
};

/// Descriptor for `ChatCompletionResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List chatCompletionResponseDescriptor = $convert.base64Decode(
    'ChZDaGF0Q29tcGxldGlvblJlc3BvbnNlEg4KAmlkGAEgASgJUgJpZBIWCgZvYmplY3QYAiABKA'
    'lSBm9iamVjdBIYCgdjcmVhdGVkGAMgASgDUgdjcmVhdGVkEhQKBW1vZGVsGAQgASgJUgVtb2Rl'
    'bBJCCgdjaG9pY2VzGAUgAygLMigucGVlcnNfdG91Y2gubW9kZWwuYWlfY2hhdC52MS5DaGF0Q2'
    'hvaWNlUgdjaG9pY2VzEjkKBXVzYWdlGAYgASgLMiMucGVlcnNfdG91Y2gubW9kZWwuYWlfY2hh'
    'dC52MS5Vc2FnZVIFdXNhZ2U=');
