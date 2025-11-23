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

@$core.Deprecated('Use sessionTypeDescriptor instead')
const SessionType$json = {
  '1': 'SessionType',
  '2': [
    {'1': 'SESSION_TYPE_UNSPECIFIED', '2': 0},
    {'1': 'SESSION_TYPE_DIRECT', '2': 1},
    {'1': 'SESSION_TYPE_GROUP', '2': 2},
  ],
};

/// Descriptor for `SessionType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List sessionTypeDescriptor = $convert.base64Decode(
    'CgtTZXNzaW9uVHlwZRIcChhTRVNTSU9OX1RZUEVfVU5TUEVDSUZJRUQQABIXChNTRVNTSU9OX1'
    'RZUEVfRElSRUNUEAESFgoSU0VTU0lPTl9UWVBFX0dST1VQEAI=');

@$core.Deprecated('Use messageTypeDescriptor instead')
const MessageType$json = {
  '1': 'MessageType',
  '2': [
    {'1': 'MESSAGE_TYPE_UNSPECIFIED', '2': 0},
    {'1': 'MESSAGE_TYPE_TEXT', '2': 1},
    {'1': 'MESSAGE_TYPE_IMAGE', '2': 2},
    {'1': 'MESSAGE_TYPE_FILE', '2': 3},
    {'1': 'MESSAGE_TYPE_LOCATION', '2': 4},
    {'1': 'MESSAGE_TYPE_SYSTEM', '2': 5},
  ],
};

/// Descriptor for `MessageType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List messageTypeDescriptor = $convert.base64Decode(
    'CgtNZXNzYWdlVHlwZRIcChhNRVNTQUdFX1RZUEVfVU5TUEVDSUZJRUQQABIVChFNRVNTQUdFX1'
    'RZUEVfVEVYVBABEhYKEk1FU1NBR0VfVFlQRV9JTUFHRRACEhUKEU1FU1NBR0VfVFlQRV9GSUxF'
    'EAMSGQoVTUVTU0FHRV9UWVBFX0xPQ0FUSU9OEAQSFwoTTUVTU0FHRV9UWVBFX1NZU1RFTRAF');

@$core.Deprecated('Use messageStatusDescriptor instead')
const MessageStatus$json = {
  '1': 'MessageStatus',
  '2': [
    {'1': 'MESSAGE_STATUS_UNSPECIFIED', '2': 0},
    {'1': 'MESSAGE_STATUS_SENDING', '2': 1},
    {'1': 'MESSAGE_STATUS_SENT', '2': 2},
    {'1': 'MESSAGE_STATUS_DELIVERED', '2': 3},
    {'1': 'MESSAGE_STATUS_FAILED', '2': 4},
  ],
};

/// Descriptor for `MessageStatus`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List messageStatusDescriptor = $convert.base64Decode(
    'Cg1NZXNzYWdlU3RhdHVzEh4KGk1FU1NBR0VfU1RBVFVTX1VOU1BFQ0lGSUVEEAASGgoWTUVTU0'
    'FHRV9TVEFUVVNfU0VORElORxABEhcKE01FU1NBR0VfU1RBVFVTX1NFTlQQAhIcChhNRVNTQUdF'
    'X1NUQVRVU19ERUxJVkVSRUQQAxIZChVNRVNTQUdFX1NUQVRVU19GQUlMRUQQBA==');

@$core.Deprecated('Use friendshipStatusDescriptor instead')
const FriendshipStatus$json = {
  '1': 'FriendshipStatus',
  '2': [
    {'1': 'FRIENDSHIP_STATUS_UNSPECIFIED', '2': 0},
    {'1': 'FRIENDSHIP_STATUS_PENDING', '2': 1},
    {'1': 'FRIENDSHIP_STATUS_ACCEPTED', '2': 2},
    {'1': 'FRIENDSHIP_STATUS_BLOCKED', '2': 3},
    {'1': 'FRIENDSHIP_STATUS_REMOVED', '2': 4},
  ],
};

/// Descriptor for `FriendshipStatus`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List friendshipStatusDescriptor = $convert.base64Decode(
    'ChBGcmllbmRzaGlwU3RhdHVzEiEKHUZSSUVORFNISVBfU1RBVFVTX1VOU1BFQ0lGSUVEEAASHQ'
    'oZRlJJRU5EU0hJUF9TVEFUVVNfUEVORElORxABEh4KGkZSSUVORFNISVBfU1RBVFVTX0FDQ0VQ'
    'VEVEEAISHQoZRlJJRU5EU0hJUF9TVEFUVVNfQkxPQ0tFRBADEh0KGUZSSUVORFNISVBfU1RBVF'
    'VTX1JFTU9WRUQQBA==');

@$core.Deprecated('Use friendRequestStatusDescriptor instead')
const FriendRequestStatus$json = {
  '1': 'FriendRequestStatus',
  '2': [
    {'1': 'FRIEND_REQUEST_STATUS_UNSPECIFIED', '2': 0},
    {'1': 'FRIEND_REQUEST_STATUS_PENDING', '2': 1},
    {'1': 'FRIEND_REQUEST_STATUS_ACCEPTED', '2': 2},
    {'1': 'FRIEND_REQUEST_STATUS_REJECTED', '2': 3},
    {'1': 'FRIEND_REQUEST_STATUS_EXPIRED', '2': 4},
  ],
};

/// Descriptor for `FriendRequestStatus`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List friendRequestStatusDescriptor = $convert.base64Decode(
    'ChNGcmllbmRSZXF1ZXN0U3RhdHVzEiUKIUZSSUVORF9SRVFVRVNUX1NUQVRVU19VTlNQRUNJRk'
    'lFRBAAEiEKHUZSSUVORF9SRVFVRVNUX1NUQVRVU19QRU5ESU5HEAESIgoeRlJJRU5EX1JFUVVF'
    'U1RfU1RBVFVTX0FDQ0VQVEVEEAISIgoeRlJJRU5EX1JFUVVFU1RfU1RBVFVTX1JFSkVDVEVEEA'
    'MSIQodRlJJRU5EX1JFUVVFU1RfU1RBVFVTX0VYUElSRUQQBA==');

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
    {
      '1': 'type',
      '3': 6,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.SessionType',
      '10': 'type'
    },
    {'1': 'is_pinned', '3': 7, '4': 1, '5': 8, '10': 'isPinned'},
    {'1': 'unread_count', '3': 8, '4': 1, '5': 3, '10': 'unreadCount'},
    {
      '1': 'metadata',
      '3': 9,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.ChatSession.MetadataEntry',
      '10': 'metadata'
    },
  ],
  '3': [ChatSession_MetadataEntry$json],
};

@$core.Deprecated('Use chatSessionDescriptor instead')
const ChatSession_MetadataEntry$json = {
  '1': 'MetadataEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `ChatSession`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List chatSessionDescriptor = $convert.base64Decode(
    'CgtDaGF0U2Vzc2lvbhIOCgJpZBgBIAEoCVICaWQSFAoFdG9waWMYAiABKAlSBXRvcGljEicKD3'
    'BhcnRpY2lwYW50X2lkcxgDIAMoCVIOcGFydGljaXBhbnRJZHMSQgoPbGFzdF9tZXNzYWdlX2F0'
    'GAQgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFINbGFzdE1lc3NhZ2VBdBIwChRsYX'
    'N0X21lc3NhZ2Vfc25pcHBldBgFIAEoCVISbGFzdE1lc3NhZ2VTbmlwcGV0EjoKBHR5cGUYBiAB'
    'KA4yJi5wZWVyc190b3VjaC5tb2RlbC5jaGF0LnYxLlNlc3Npb25UeXBlUgR0eXBlEhsKCWlzX3'
    'Bpbm5lZBgHIAEoCFIIaXNQaW5uZWQSIQoMdW5yZWFkX2NvdW50GAggASgDUgt1bnJlYWRDb3Vu'
    'dBJQCghtZXRhZGF0YRgJIAMoCzI0LnBlZXJzX3RvdWNoLm1vZGVsLmNoYXQudjEuQ2hhdFNlc3'
    'Npb24uTWV0YWRhdGFFbnRyeVIIbWV0YWRhdGEaOwoNTWV0YWRhdGFFbnRyeRIQCgNrZXkYASAB'
    'KAlSA2tleRIUCgV2YWx1ZRgCIAEoCVIFdmFsdWU6AjgB');

@$core.Deprecated('Use chatMessageDescriptor instead')
const ChatMessage$json = {
  '1': 'ChatMessage',
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
    {
      '1': 'type',
      '3': 6,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.MessageType',
      '10': 'type'
    },
    {
      '1': 'status',
      '3': 7,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.MessageStatus',
      '10': 'status'
    },
    {
      '1': 'encrypted_content',
      '3': 8,
      '4': 1,
      '5': 9,
      '10': 'encryptedContent'
    },
    {
      '1': 'attachments',
      '3': 9,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.MessageAttachment',
      '10': 'attachments'
    },
    {
      '1': 'metadata',
      '3': 10,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.ChatMessage.MetadataEntry',
      '10': 'metadata'
    },
  ],
  '3': [ChatMessage_MetadataEntry$json],
};

@$core.Deprecated('Use chatMessageDescriptor instead')
const ChatMessage_MetadataEntry$json = {
  '1': 'MetadataEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `ChatMessage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List chatMessageDescriptor = $convert.base64Decode(
    'CgtDaGF0TWVzc2FnZRIOCgJpZBgBIAEoCVICaWQSHQoKc2Vzc2lvbl9pZBgCIAEoCVIJc2Vzc2'
    'lvbklkEhsKCXNlbmRlcl9pZBgDIAEoCVIIc2VuZGVySWQSGAoHY29udGVudBgEIAEoCVIHY29u'
    'dGVudBIzCgdzZW50X2F0GAUgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIGc2VudE'
    'F0EjoKBHR5cGUYBiABKA4yJi5wZWVyc190b3VjaC5tb2RlbC5jaGF0LnYxLk1lc3NhZ2VUeXBl'
    'UgR0eXBlEkAKBnN0YXR1cxgHIAEoDjIoLnBlZXJzX3RvdWNoLm1vZGVsLmNoYXQudjEuTWVzc2'
    'FnZVN0YXR1c1IGc3RhdHVzEisKEWVuY3J5cHRlZF9jb250ZW50GAggASgJUhBlbmNyeXB0ZWRD'
    'b250ZW50Ek4KC2F0dGFjaG1lbnRzGAkgAygLMiwucGVlcnNfdG91Y2gubW9kZWwuY2hhdC52MS'
    '5NZXNzYWdlQXR0YWNobWVudFILYXR0YWNobWVudHMSUAoIbWV0YWRhdGEYCiADKAsyNC5wZWVy'
    'c190b3VjaC5tb2RlbC5jaGF0LnYxLkNoYXRNZXNzYWdlLk1ldGFkYXRhRW50cnlSCG1ldGFkYX'
    'RhGjsKDU1ldGFkYXRhRW50cnkSEAoDa2V5GAEgASgJUgNrZXkSFAoFdmFsdWUYAiABKAlSBXZh'
    'bHVlOgI4AQ==');

@$core.Deprecated('Use messageAttachmentDescriptor instead')
const MessageAttachment$json = {
  '1': 'MessageAttachment',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'size', '3': 3, '4': 1, '5': 3, '10': 'size'},
    {'1': 'type', '3': 4, '4': 1, '5': 9, '10': 'type'},
    {'1': 'url', '3': 5, '4': 1, '5': 9, '10': 'url'},
    {'1': 'thumbnail_url', '3': 6, '4': 1, '5': 9, '10': 'thumbnailUrl'},
    {
      '1': 'metadata',
      '3': 7,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.MessageAttachment.MetadataEntry',
      '10': 'metadata'
    },
  ],
  '3': [MessageAttachment_MetadataEntry$json],
};

@$core.Deprecated('Use messageAttachmentDescriptor instead')
const MessageAttachment_MetadataEntry$json = {
  '1': 'MetadataEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `MessageAttachment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List messageAttachmentDescriptor = $convert.base64Decode(
    'ChFNZXNzYWdlQXR0YWNobWVudBIOCgJpZBgBIAEoCVICaWQSEgoEbmFtZRgCIAEoCVIEbmFtZR'
    'ISCgRzaXplGAMgASgDUgRzaXplEhIKBHR5cGUYBCABKAlSBHR5cGUSEAoDdXJsGAUgASgJUgN1'
    'cmwSIwoNdGh1bWJuYWlsX3VybBgGIAEoCVIMdGh1bWJuYWlsVXJsElYKCG1ldGFkYXRhGAcgAy'
    'gLMjoucGVlcnNfdG91Y2gubW9kZWwuY2hhdC52MS5NZXNzYWdlQXR0YWNobWVudC5NZXRhZGF0'
    'YUVudHJ5UghtZXRhZGF0YRo7Cg1NZXRhZGF0YUVudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBX'
    'ZhbHVlGAIgASgJUgV2YWx1ZToCOAE=');

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
      '6': '.peers_touch.model.chat.v1.FriendshipStatus',
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
    {'1': 'public_key', '3': 4, '4': 1, '5': 9, '10': 'publicKey'},
    {
      '1': 'metadata',
      '3': 5,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.Friend.MetadataEntry',
      '10': 'metadata'
    },
  ],
  '3': [Friend_MetadataEntry$json],
};

@$core.Deprecated('Use friendDescriptor instead')
const Friend_MetadataEntry$json = {
  '1': 'MetadataEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `Friend`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List friendDescriptor = $convert.base64Decode(
    'CgZGcmllbmQSNAoEdXNlchgBIAEoCzIgLnBlZXJzX3RvdWNoLm1vZGVsLmNvcmUudjEuQWN0b3'
    'JSBHVzZXISQwoGc3RhdHVzGAIgASgOMisucGVlcnNfdG91Y2gubW9kZWwuY2hhdC52MS5Gcmll'
    'bmRzaGlwU3RhdHVzUgZzdGF0dXMSTgoVZnJpZW5kc2hpcF9jcmVhdGVkX2F0GAMgASgLMhouZ2'
    '9vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFITZnJpZW5kc2hpcENyZWF0ZWRBdBIdCgpwdWJsaWNf'
    'a2V5GAQgASgJUglwdWJsaWNLZXkSSwoIbWV0YWRhdGEYBSADKAsyLy5wZWVyc190b3VjaC5tb2'
    'RlbC5jaGF0LnYxLkZyaWVuZC5NZXRhZGF0YUVudHJ5UghtZXRhZGF0YRo7Cg1NZXRhZGF0YUVu'
    'dHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbHVlGAIgASgJUgV2YWx1ZToCOAE=');

@$core.Deprecated('Use friendRequestDescriptor instead')
const FriendRequest$json = {
  '1': 'FriendRequest',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'sender_id', '3': 2, '4': 1, '5': 9, '10': 'senderId'},
    {'1': 'receiver_id', '3': 3, '4': 1, '5': 9, '10': 'receiverId'},
    {'1': 'message', '3': 4, '4': 1, '5': 9, '10': 'message'},
    {
      '1': 'status',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.FriendRequestStatus',
      '10': 'status'
    },
    {
      '1': 'created_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'responded_at',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'respondedAt'
    },
  ],
};

/// Descriptor for `FriendRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List friendRequestDescriptor = $convert.base64Decode(
    'Cg1GcmllbmRSZXF1ZXN0Eg4KAmlkGAEgASgJUgJpZBIbCglzZW5kZXJfaWQYAiABKAlSCHNlbm'
    'RlcklkEh8KC3JlY2VpdmVyX2lkGAMgASgJUgpyZWNlaXZlcklkEhgKB21lc3NhZ2UYBCABKAlS'
    'B21lc3NhZ2USRgoGc3RhdHVzGAUgASgOMi4ucGVlcnNfdG91Y2gubW9kZWwuY2hhdC52MS5Gcm'
    'llbmRSZXF1ZXN0U3RhdHVzUgZzdGF0dXMSOQoKY3JlYXRlZF9hdBgGIAEoCzIaLmdvb2dsZS5w'
    'cm90b2J1Zi5UaW1lc3RhbXBSCWNyZWF0ZWRBdBI9CgxyZXNwb25kZWRfYXQYByABKAsyGi5nb2'
    '9nbGUucHJvdG9idWYuVGltZXN0YW1wUgtyZXNwb25kZWRBdA==');
