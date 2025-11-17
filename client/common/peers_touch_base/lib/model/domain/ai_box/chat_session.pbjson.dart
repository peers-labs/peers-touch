// This is a generated file - do not edit.
//
// Generated from domain/ai_box/chat_session.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use chatSessionDescriptor instead')
const ChatSession$json = {
  '1': 'ChatSession',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'title', '3': 2, '4': 1, '5': 9, '10': 'title'},
    {'1': 'description', '3': 3, '4': 1, '5': 9, '10': 'description'},
    {'1': 'avatar', '3': 4, '4': 1, '5': 9, '10': 'avatar'},
    {'1': 'background_color', '3': 5, '4': 1, '5': 9, '10': 'backgroundColor'},
    {'1': 'provider_id', '3': 6, '4': 1, '5': 9, '10': 'providerId'},
    {'1': 'user_id', '3': 7, '4': 1, '5': 9, '10': 'userId'},
    {'1': 'model_name', '3': 8, '4': 1, '5': 9, '10': 'modelName'},
    {'1': 'pinned', '3': 9, '4': 1, '5': 8, '10': 'pinned'},
    {'1': 'group', '3': 10, '4': 1, '5': 9, '10': 'group'},
    {'1': 'created_at', '3': 11, '4': 1, '5': 3, '10': 'createdAt'},
    {'1': 'updated_at', '3': 12, '4': 1, '5': 3, '10': 'updatedAt'},
    {
      '1': 'meta',
      '3': 13,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.ai_box.v1.ChatSession.MetaEntry',
      '10': 'meta'
    },
    {'1': 'config_json', '3': 14, '4': 1, '5': 9, '10': 'configJson'},
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
    'CgtDaGF0U2Vzc2lvbhIOCgJpZBgBIAEoCVICaWQSFAoFdGl0bGUYAiABKAlSBXRpdGxlEiAKC2'
    'Rlc2NyaXB0aW9uGAMgASgJUgtkZXNjcmlwdGlvbhIWCgZhdmF0YXIYBCABKAlSBmF2YXRhchIp'
    'ChBiYWNrZ3JvdW5kX2NvbG9yGAUgASgJUg9iYWNrZ3JvdW5kQ29sb3ISHwoLcHJvdmlkZXJfaW'
    'QYBiABKAlSCnByb3ZpZGVySWQSFwoHdXNlcl9pZBgHIAEoCVIGdXNlcklkEh0KCm1vZGVsX25h'
    'bWUYCCABKAlSCW1vZGVsTmFtZRIWCgZwaW5uZWQYCSABKAhSBnBpbm5lZBIUCgVncm91cBgKIA'
    'EoCVIFZ3JvdXASHQoKY3JlYXRlZF9hdBgLIAEoA1IJY3JlYXRlZEF0Eh0KCnVwZGF0ZWRfYXQY'
    'DCABKANSCXVwZGF0ZWRBdBJGCgRtZXRhGA0gAygLMjIucGVlcnNfdG91Y2gubW9kZWwuYWlfYm'
    '94LnYxLkNoYXRTZXNzaW9uLk1ldGFFbnRyeVIEbWV0YRIfCgtjb25maWdfanNvbhgOIAEoCVIK'
    'Y29uZmlnSnNvbho3CglNZXRhRW50cnkSEAoDa2V5GAEgASgJUgNrZXkSFAoFdmFsdWUYAiABKA'
    'lSBXZhbHVlOgI4AQ==');
