// This is a generated file - do not edit.
//
// Generated from domain/chat/chat.proto.

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
    {'1': 'topic', '3': 2, '4': 1, '5': 9, '10': 'topic'},
    {'1': 'participant_ids', '3': 3, '4': 3, '5': 9, '10': 'participantIds'},
    {
      '1': 'last_message_at',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'lastMessageAt'
    },
    {
      '1': 'last_message_snippet',
      '3': 5,
      '4': 1,
      '5': 9,
      '10': 'lastMessageSnippet'
    },
  ],
};

/// Descriptor for `ChatSession`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List chatSessionDescriptor = $convert.base64Decode(
    'CgtDaGF0U2Vzc2lvbhIOCgJpZBgBIAEoCVICaWQSFAoFdG9waWMYAiABKAlSBXRvcGljEicKD3'
    'BhcnRpY2lwYW50X2lkcxgDIAMoCVIOcGFydGljaXBhbnRJZHMSQgoPbGFzdF9tZXNzYWdlX2F0'
    'GAQgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFINbGFzdE1lc3NhZ2VBdBIwChRsYX'
    'N0X21lc3NhZ2Vfc25pcHBldBgFIAEoCVISbGFzdE1lc3NhZ2VTbmlwcGV0');

@$core.Deprecated('Use messageDescriptor instead')
const Message$json = {
  '1': 'Message',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'session_id', '3': 2, '4': 1, '5': 9, '10': 'sessionId'},
    {'1': 'sender_id', '3': 3, '4': 1, '5': 9, '10': 'senderId'},
    {'1': 'content', '3': 4, '4': 1, '5': 9, '10': 'content'},
    {
      '1': 'sent_at',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'sentAt'
    },
  ],
};

/// Descriptor for `Message`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List messageDescriptor = $convert.base64Decode(
    'CgdNZXNzYWdlEg4KAmlkGAEgASgJUgJpZBIdCgpzZXNzaW9uX2lkGAIgASgJUglzZXNzaW9uSW'
    'QSGwoJc2VuZGVyX2lkGAMgASgJUghzZW5kZXJJZBIYCgdjb250ZW50GAQgASgJUgdjb250ZW50'
    'EjMKB3NlbnRfYXQYBSABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgZzZW50QXQ=');

@$core.Deprecated('Use friendDescriptor instead')
const Friend$json = {
  '1': 'Friend',
  '2': [
    {
      '1': 'user',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.core.v1.Actor',
      '10': 'user'
    },
    {
      '1': 'status',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.core.v1.Friend.FriendshipStatus',
      '10': 'status'
    },
    {
      '1': 'friendship_created_at',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'friendshipCreatedAt'
    },
  ],
  '4': [Friend_FriendshipStatus$json],
};

@$core.Deprecated('Use friendDescriptor instead')
const Friend_FriendshipStatus$json = {
  '1': 'FriendshipStatus',
  '2': [
    {'1': 'PENDING', '2': 0},
    {'1': 'ACCEPTED', '2': 1},
    {'1': 'BLOCKED', '2': 2},
  ],
};

/// Descriptor for `Friend`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List friendDescriptor = $convert.base64Decode(
    'CgZGcmllbmQSNAoEdXNlchgBIAEoCzIgLnBlZXJzX3RvdWNoLm1vZGVsLmNvcmUudjEuQWN0b3'
    'JSBHVzZXISSgoGc3RhdHVzGAIgASgOMjIucGVlcnNfdG91Y2gubW9kZWwuY29yZS52MS5Gcmll'
    'bmQuRnJpZW5kc2hpcFN0YXR1c1IGc3RhdHVzEk4KFWZyaWVuZHNoaXBfY3JlYXRlZF9hdBgDIA'
    'EoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSE2ZyaWVuZHNoaXBDcmVhdGVkQXQiOgoQ'
    'RnJpZW5kc2hpcFN0YXR1cxILCgdQRU5ESU5HEAASDAoIQUNDRVBURUQQARILCgdCTE9DS0VEEA'
    'I=');
