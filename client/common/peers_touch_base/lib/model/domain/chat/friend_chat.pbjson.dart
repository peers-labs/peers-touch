// This is a generated file - do not edit.
//
// Generated from domain/chat/friend_chat.proto.

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

@$core.Deprecated('Use friendMessageTypeDescriptor instead')
const FriendMessageType$json = {
  '1': 'FriendMessageType',
  '2': [
    {'1': 'FRIEND_MESSAGE_TYPE_UNSPECIFIED', '2': 0},
    {'1': 'FRIEND_MESSAGE_TYPE_TEXT', '2': 1},
    {'1': 'FRIEND_MESSAGE_TYPE_IMAGE', '2': 2},
    {'1': 'FRIEND_MESSAGE_TYPE_FILE', '2': 3},
    {'1': 'FRIEND_MESSAGE_TYPE_AUDIO', '2': 4},
    {'1': 'FRIEND_MESSAGE_TYPE_VIDEO', '2': 5},
  ],
};

/// Descriptor for `FriendMessageType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List friendMessageTypeDescriptor = $convert.base64Decode(
    'ChFGcmllbmRNZXNzYWdlVHlwZRIjCh9GUklFTkRfTUVTU0FHRV9UWVBFX1VOU1BFQ0lGSUVEEA'
    'ASHAoYRlJJRU5EX01FU1NBR0VfVFlQRV9URVhUEAESHQoZRlJJRU5EX01FU1NBR0VfVFlQRV9J'
    'TUFHRRACEhwKGEZSSUVORF9NRVNTQUdFX1RZUEVfRklMRRADEh0KGUZSSUVORF9NRVNTQUdFX1'
    'RZUEVfQVVESU8QBBIdChlGUklFTkRfTUVTU0FHRV9UWVBFX1ZJREVPEAU=');

@$core.Deprecated('Use friendMessageStatusDescriptor instead')
const FriendMessageStatus$json = {
  '1': 'FriendMessageStatus',
  '2': [
    {'1': 'FRIEND_MESSAGE_STATUS_UNSPECIFIED', '2': 0},
    {'1': 'FRIEND_MESSAGE_STATUS_SENDING', '2': 1},
    {'1': 'FRIEND_MESSAGE_STATUS_SENT', '2': 2},
    {'1': 'FRIEND_MESSAGE_STATUS_DELIVERED', '2': 3},
    {'1': 'FRIEND_MESSAGE_STATUS_READ', '2': 4},
    {'1': 'FRIEND_MESSAGE_STATUS_FAILED', '2': 5},
  ],
};

/// Descriptor for `FriendMessageStatus`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List friendMessageStatusDescriptor = $convert.base64Decode(
    'ChNGcmllbmRNZXNzYWdlU3RhdHVzEiUKIUZSSUVORF9NRVNTQUdFX1NUQVRVU19VTlNQRUNJRk'
    'lFRBAAEiEKHUZSSUVORF9NRVNTQUdFX1NUQVRVU19TRU5ESU5HEAESHgoaRlJJRU5EX01FU1NB'
    'R0VfU1RBVFVTX1NFTlQQAhIjCh9GUklFTkRfTUVTU0FHRV9TVEFUVVNfREVMSVZFUkVEEAMSHg'
    'oaRlJJRU5EX01FU1NBR0VfU1RBVFVTX1JFQUQQBBIgChxGUklFTkRfTUVTU0FHRV9TVEFUVVNf'
    'RkFJTEVEEAU=');

@$core.Deprecated('Use offlineMessageStatusDescriptor instead')
const OfflineMessageStatus$json = {
  '1': 'OfflineMessageStatus',
  '2': [
    {'1': 'OFFLINE_MESSAGE_STATUS_UNSPECIFIED', '2': 0},
    {'1': 'OFFLINE_MESSAGE_STATUS_PENDING', '2': 1},
    {'1': 'OFFLINE_MESSAGE_STATUS_DELIVERED', '2': 2},
    {'1': 'OFFLINE_MESSAGE_STATUS_EXPIRED', '2': 3},
  ],
};

/// Descriptor for `OfflineMessageStatus`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List offlineMessageStatusDescriptor = $convert.base64Decode(
    'ChRPZmZsaW5lTWVzc2FnZVN0YXR1cxImCiJPRkZMSU5FX01FU1NBR0VfU1RBVFVTX1VOU1BFQ0'
    'lGSUVEEAASIgoeT0ZGTElORV9NRVNTQUdFX1NUQVRVU19QRU5ESU5HEAESJAogT0ZGTElORV9N'
    'RVNTQUdFX1NUQVRVU19ERUxJVkVSRUQQAhIiCh5PRkZMSU5FX01FU1NBR0VfU1RBVFVTX0VYUE'
    'lSRUQQAw==');

@$core.Deprecated('Use friendChatSessionDescriptor instead')
const FriendChatSession$json = {
  '1': 'FriendChatSession',
  '2': [
    {'1': 'ulid', '3': 1, '4': 1, '5': 9, '10': 'ulid'},
    {'1': 'participant_a_did', '3': 2, '4': 1, '5': 9, '10': 'participantADid'},
    {'1': 'participant_b_did', '3': 3, '4': 1, '5': 9, '10': 'participantBDid'},
    {'1': 'last_message_ulid', '3': 4, '4': 1, '5': 9, '10': 'lastMessageUlid'},
    {
      '1': 'last_message_at',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'lastMessageAt'
    },
    {'1': 'unread_count_a', '3': 6, '4': 1, '5': 5, '10': 'unreadCountA'},
    {'1': 'unread_count_b', '3': 7, '4': 1, '5': 5, '10': 'unreadCountB'},
    {
      '1': 'created_at',
      '3': 8,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'updated_at',
      '3': 9,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
  ],
};

/// Descriptor for `FriendChatSession`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List friendChatSessionDescriptor = $convert.base64Decode(
    'ChFGcmllbmRDaGF0U2Vzc2lvbhISCgR1bGlkGAEgASgJUgR1bGlkEioKEXBhcnRpY2lwYW50X2'
    'FfZGlkGAIgASgJUg9wYXJ0aWNpcGFudEFEaWQSKgoRcGFydGljaXBhbnRfYl9kaWQYAyABKAlS'
    'D3BhcnRpY2lwYW50QkRpZBIqChFsYXN0X21lc3NhZ2VfdWxpZBgEIAEoCVIPbGFzdE1lc3NhZ2'
    'VVbGlkEkIKD2xhc3RfbWVzc2FnZV9hdBgFIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3Rh'
    'bXBSDWxhc3RNZXNzYWdlQXQSJAoOdW5yZWFkX2NvdW50X2EYBiABKAVSDHVucmVhZENvdW50QR'
    'IkCg51bnJlYWRfY291bnRfYhgHIAEoBVIMdW5yZWFkQ291bnRCEjkKCmNyZWF0ZWRfYXQYCCAB'
    'KAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgljcmVhdGVkQXQSOQoKdXBkYXRlZF9hdB'
    'gJIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCXVwZGF0ZWRBdA==');

@$core.Deprecated('Use friendChatMessageDescriptor instead')
const FriendChatMessage$json = {
  '1': 'FriendChatMessage',
  '2': [
    {'1': 'ulid', '3': 1, '4': 1, '5': 9, '10': 'ulid'},
    {'1': 'session_ulid', '3': 2, '4': 1, '5': 9, '10': 'sessionUlid'},
    {'1': 'sender_did', '3': 3, '4': 1, '5': 9, '10': 'senderDid'},
    {'1': 'receiver_did', '3': 4, '4': 1, '5': 9, '10': 'receiverDid'},
    {
      '1': 'type',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.FriendMessageType',
      '10': 'type'
    },
    {'1': 'content', '3': 6, '4': 1, '5': 9, '10': 'content'},
    {
      '1': 'attachments',
      '3': 7,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.FriendMessageAttachment',
      '10': 'attachments'
    },
    {'1': 'reply_to_ulid', '3': 8, '4': 1, '5': 9, '10': 'replyToUlid'},
    {
      '1': 'status',
      '3': 9,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.FriendMessageStatus',
      '10': 'status'
    },
    {
      '1': 'sent_at',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'sentAt'
    },
    {
      '1': 'delivered_at',
      '3': 11,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'deliveredAt'
    },
    {
      '1': 'read_at',
      '3': 12,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'readAt'
    },
    {
      '1': 'created_at',
      '3': 13,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'updated_at',
      '3': 14,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
  ],
};

/// Descriptor for `FriendChatMessage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List friendChatMessageDescriptor = $convert.base64Decode(
    'ChFGcmllbmRDaGF0TWVzc2FnZRISCgR1bGlkGAEgASgJUgR1bGlkEiEKDHNlc3Npb25fdWxpZB'
    'gCIAEoCVILc2Vzc2lvblVsaWQSHQoKc2VuZGVyX2RpZBgDIAEoCVIJc2VuZGVyRGlkEiEKDHJl'
    'Y2VpdmVyX2RpZBgEIAEoCVILcmVjZWl2ZXJEaWQSQAoEdHlwZRgFIAEoDjIsLnBlZXJzX3RvdW'
    'NoLm1vZGVsLmNoYXQudjEuRnJpZW5kTWVzc2FnZVR5cGVSBHR5cGUSGAoHY29udGVudBgGIAEo'
    'CVIHY29udGVudBJUCgthdHRhY2htZW50cxgHIAMoCzIyLnBlZXJzX3RvdWNoLm1vZGVsLmNoYX'
    'QudjEuRnJpZW5kTWVzc2FnZUF0dGFjaG1lbnRSC2F0dGFjaG1lbnRzEiIKDXJlcGx5X3RvX3Vs'
    'aWQYCCABKAlSC3JlcGx5VG9VbGlkEkYKBnN0YXR1cxgJIAEoDjIuLnBlZXJzX3RvdWNoLm1vZG'
    'VsLmNoYXQudjEuRnJpZW5kTWVzc2FnZVN0YXR1c1IGc3RhdHVzEjMKB3NlbnRfYXQYCiABKAsy'
    'Gi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgZzZW50QXQSPQoMZGVsaXZlcmVkX2F0GAsgAS'
    'gLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFILZGVsaXZlcmVkQXQSMwoHcmVhZF9hdBgM'
    'IAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSBnJlYWRBdBI5CgpjcmVhdGVkX2F0GA'
    '0gASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJY3JlYXRlZEF0EjkKCnVwZGF0ZWRf'
    'YXQYDiABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgl1cGRhdGVkQXQ=');

@$core.Deprecated('Use friendMessageAttachmentDescriptor instead')
const FriendMessageAttachment$json = {
  '1': 'FriendMessageAttachment',
  '2': [
    {'1': 'cid', '3': 1, '4': 1, '5': 9, '10': 'cid'},
    {'1': 'filename', '3': 2, '4': 1, '5': 9, '10': 'filename'},
    {'1': 'mime_type', '3': 3, '4': 1, '5': 9, '10': 'mimeType'},
    {'1': 'size', '3': 4, '4': 1, '5': 3, '10': 'size'},
    {'1': 'thumbnail_cid', '3': 5, '4': 1, '5': 9, '10': 'thumbnailCid'},
  ],
};

/// Descriptor for `FriendMessageAttachment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List friendMessageAttachmentDescriptor = $convert.base64Decode(
    'ChdGcmllbmRNZXNzYWdlQXR0YWNobWVudBIQCgNjaWQYASABKAlSA2NpZBIaCghmaWxlbmFtZR'
    'gCIAEoCVIIZmlsZW5hbWUSGwoJbWltZV90eXBlGAMgASgJUghtaW1lVHlwZRISCgRzaXplGAQg'
    'ASgDUgRzaXplEiMKDXRodW1ibmFpbF9jaWQYBSABKAlSDHRodW1ibmFpbENpZA==');

@$core.Deprecated('Use messageEnvelopeDescriptor instead')
const MessageEnvelope$json = {
  '1': 'MessageEnvelope',
  '2': [
    {'1': 'message_ulid', '3': 1, '4': 1, '5': 9, '10': 'messageUlid'},
    {'1': 'sender_did', '3': 2, '4': 1, '5': 9, '10': 'senderDid'},
    {'1': 'receiver_did', '3': 3, '4': 1, '5': 9, '10': 'receiverDid'},
    {'1': 'session_ulid', '3': 4, '4': 1, '5': 9, '10': 'sessionUlid'},
    {
      '1': 'encrypted_payload',
      '3': 5,
      '4': 1,
      '5': 12,
      '10': 'encryptedPayload'
    },
    {'1': 'timestamp', '3': 6, '4': 1, '5': 3, '10': 'timestamp'},
    {'1': 'signature', '3': 7, '4': 1, '5': 9, '10': 'signature'},
  ],
};

/// Descriptor for `MessageEnvelope`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List messageEnvelopeDescriptor = $convert.base64Decode(
    'Cg9NZXNzYWdlRW52ZWxvcGUSIQoMbWVzc2FnZV91bGlkGAEgASgJUgttZXNzYWdlVWxpZBIdCg'
    'pzZW5kZXJfZGlkGAIgASgJUglzZW5kZXJEaWQSIQoMcmVjZWl2ZXJfZGlkGAMgASgJUgtyZWNl'
    'aXZlckRpZBIhCgxzZXNzaW9uX3VsaWQYBCABKAlSC3Nlc3Npb25VbGlkEisKEWVuY3J5cHRlZF'
    '9wYXlsb2FkGAUgASgMUhBlbmNyeXB0ZWRQYXlsb2FkEhwKCXRpbWVzdGFtcBgGIAEoA1IJdGlt'
    'ZXN0YW1wEhwKCXNpZ25hdHVyZRgHIAEoCVIJc2lnbmF0dXJl');

@$core.Deprecated('Use offlineMessageDescriptor instead')
const OfflineMessage$json = {
  '1': 'OfflineMessage',
  '2': [
    {'1': 'ulid', '3': 1, '4': 1, '5': 9, '10': 'ulid'},
    {'1': 'receiver_did', '3': 2, '4': 1, '5': 9, '10': 'receiverDid'},
    {'1': 'sender_did', '3': 3, '4': 1, '5': 9, '10': 'senderDid'},
    {'1': 'session_ulid', '3': 4, '4': 1, '5': 9, '10': 'sessionUlid'},
    {
      '1': 'encrypted_payload',
      '3': 5,
      '4': 1,
      '5': 12,
      '10': 'encryptedPayload'
    },
    {
      '1': 'status',
      '3': 6,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.OfflineMessageStatus',
      '10': 'status'
    },
    {
      '1': 'expire_at',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'expireAt'
    },
    {
      '1': 'delivered_at',
      '3': 8,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'deliveredAt'
    },
    {
      '1': 'created_at',
      '3': 9,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'updated_at',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
  ],
};

/// Descriptor for `OfflineMessage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List offlineMessageDescriptor = $convert.base64Decode(
    'Cg5PZmZsaW5lTWVzc2FnZRISCgR1bGlkGAEgASgJUgR1bGlkEiEKDHJlY2VpdmVyX2RpZBgCIA'
    'EoCVILcmVjZWl2ZXJEaWQSHQoKc2VuZGVyX2RpZBgDIAEoCVIJc2VuZGVyRGlkEiEKDHNlc3Np'
    'b25fdWxpZBgEIAEoCVILc2Vzc2lvblVsaWQSKwoRZW5jcnlwdGVkX3BheWxvYWQYBSABKAxSEG'
    'VuY3J5cHRlZFBheWxvYWQSRwoGc3RhdHVzGAYgASgOMi8ucGVlcnNfdG91Y2gubW9kZWwuY2hh'
    'dC52MS5PZmZsaW5lTWVzc2FnZVN0YXR1c1IGc3RhdHVzEjcKCWV4cGlyZV9hdBgHIAEoCzIaLm'
    'dvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCGV4cGlyZUF0Ej0KDGRlbGl2ZXJlZF9hdBgIIAEo'
    'CzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSC2RlbGl2ZXJlZEF0EjkKCmNyZWF0ZWRfYX'
    'QYCSABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgljcmVhdGVkQXQSOQoKdXBkYXRl'
    'ZF9hdBgKIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCXVwZGF0ZWRBdA==');

@$core.Deprecated('Use sendMessageRequestDescriptor instead')
const SendMessageRequest$json = {
  '1': 'SendMessageRequest',
  '2': [
    {'1': 'receiver_did', '3': 1, '4': 1, '5': 9, '10': 'receiverDid'},
    {
      '1': 'type',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.FriendMessageType',
      '10': 'type'
    },
    {'1': 'content', '3': 3, '4': 1, '5': 9, '10': 'content'},
    {
      '1': 'attachments',
      '3': 4,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.FriendMessageAttachment',
      '10': 'attachments'
    },
    {'1': 'reply_to_ulid', '3': 5, '4': 1, '5': 9, '10': 'replyToUlid'},
  ],
};

/// Descriptor for `SendMessageRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List sendMessageRequestDescriptor = $convert.base64Decode(
    'ChJTZW5kTWVzc2FnZVJlcXVlc3QSIQoMcmVjZWl2ZXJfZGlkGAEgASgJUgtyZWNlaXZlckRpZB'
    'JACgR0eXBlGAIgASgOMiwucGVlcnNfdG91Y2gubW9kZWwuY2hhdC52MS5GcmllbmRNZXNzYWdl'
    'VHlwZVIEdHlwZRIYCgdjb250ZW50GAMgASgJUgdjb250ZW50ElQKC2F0dGFjaG1lbnRzGAQgAy'
    'gLMjIucGVlcnNfdG91Y2gubW9kZWwuY2hhdC52MS5GcmllbmRNZXNzYWdlQXR0YWNobWVudFIL'
    'YXR0YWNobWVudHMSIgoNcmVwbHlfdG9fdWxpZBgFIAEoCVILcmVwbHlUb1VsaWQ=');

@$core.Deprecated('Use sendMessageResponseDescriptor instead')
const SendMessageResponse$json = {
  '1': 'SendMessageResponse',
  '2': [
    {
      '1': 'message',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.FriendChatMessage',
      '10': 'message'
    },
    {'1': 'relay_status', '3': 2, '4': 1, '5': 9, '10': 'relayStatus'},
  ],
};

/// Descriptor for `SendMessageResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List sendMessageResponseDescriptor = $convert.base64Decode(
    'ChNTZW5kTWVzc2FnZVJlc3BvbnNlEkYKB21lc3NhZ2UYASABKAsyLC5wZWVyc190b3VjaC5tb2'
    'RlbC5jaGF0LnYxLkZyaWVuZENoYXRNZXNzYWdlUgdtZXNzYWdlEiEKDHJlbGF5X3N0YXR1cxgC'
    'IAEoCVILcmVsYXlTdGF0dXM=');

@$core.Deprecated('Use getMessagesRequestDescriptor instead')
const GetMessagesRequest$json = {
  '1': 'GetMessagesRequest',
  '2': [
    {'1': 'session_ulid', '3': 1, '4': 1, '5': 9, '10': 'sessionUlid'},
    {'1': 'before_ulid', '3': 2, '4': 1, '5': 9, '10': 'beforeUlid'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `GetMessagesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMessagesRequestDescriptor = $convert.base64Decode(
    'ChJHZXRNZXNzYWdlc1JlcXVlc3QSIQoMc2Vzc2lvbl91bGlkGAEgASgJUgtzZXNzaW9uVWxpZB'
    'IfCgtiZWZvcmVfdWxpZBgCIAEoCVIKYmVmb3JlVWxpZBIUCgVsaW1pdBgDIAEoBVIFbGltaXQ=');

@$core.Deprecated('Use getMessagesResponseDescriptor instead')
const GetMessagesResponse$json = {
  '1': 'GetMessagesResponse',
  '2': [
    {
      '1': 'messages',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.FriendChatMessage',
      '10': 'messages'
    },
    {'1': 'has_more', '3': 2, '4': 1, '5': 8, '10': 'hasMore'},
  ],
};

/// Descriptor for `GetMessagesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMessagesResponseDescriptor = $convert.base64Decode(
    'ChNHZXRNZXNzYWdlc1Jlc3BvbnNlEkgKCG1lc3NhZ2VzGAEgAygLMiwucGVlcnNfdG91Y2gubW'
    '9kZWwuY2hhdC52MS5GcmllbmRDaGF0TWVzc2FnZVIIbWVzc2FnZXMSGQoIaGFzX21vcmUYAiAB'
    'KAhSB2hhc01vcmU=');

@$core.Deprecated('Use getSessionsRequestDescriptor instead')
const GetSessionsRequest$json = {
  '1': 'GetSessionsRequest',
  '2': [
    {'1': 'limit', '3': 1, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'offset', '3': 2, '4': 1, '5': 5, '10': 'offset'},
  ],
};

/// Descriptor for `GetSessionsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getSessionsRequestDescriptor = $convert.base64Decode(
    'ChJHZXRTZXNzaW9uc1JlcXVlc3QSFAoFbGltaXQYASABKAVSBWxpbWl0EhYKBm9mZnNldBgCIA'
    'EoBVIGb2Zmc2V0');

@$core.Deprecated('Use getSessionsResponseDescriptor instead')
const GetSessionsResponse$json = {
  '1': 'GetSessionsResponse',
  '2': [
    {
      '1': 'sessions',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.FriendChatSession',
      '10': 'sessions'
    },
    {'1': 'total', '3': 2, '4': 1, '5': 5, '10': 'total'},
  ],
};

/// Descriptor for `GetSessionsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getSessionsResponseDescriptor = $convert.base64Decode(
    'ChNHZXRTZXNzaW9uc1Jlc3BvbnNlEkgKCHNlc3Npb25zGAEgAygLMiwucGVlcnNfdG91Y2gubW'
    '9kZWwuY2hhdC52MS5GcmllbmRDaGF0U2Vzc2lvblIIc2Vzc2lvbnMSFAoFdG90YWwYAiABKAVS'
    'BXRvdGFs');

@$core.Deprecated('Use markReadRequestDescriptor instead')
const MarkReadRequest$json = {
  '1': 'MarkReadRequest',
  '2': [
    {'1': 'session_ulid', '3': 1, '4': 1, '5': 9, '10': 'sessionUlid'},
    {'1': 'last_read_ulid', '3': 2, '4': 1, '5': 9, '10': 'lastReadUlid'},
  ],
};

/// Descriptor for `MarkReadRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markReadRequestDescriptor = $convert.base64Decode(
    'Cg9NYXJrUmVhZFJlcXVlc3QSIQoMc2Vzc2lvbl91bGlkGAEgASgJUgtzZXNzaW9uVWxpZBIkCg'
    '5sYXN0X3JlYWRfdWxpZBgCIAEoCVIMbGFzdFJlYWRVbGlk');

@$core.Deprecated('Use markReadResponseDescriptor instead')
const MarkReadResponse$json = {
  '1': 'MarkReadResponse',
  '2': [
    {'1': 'unread_count', '3': 1, '4': 1, '5': 5, '10': 'unreadCount'},
  ],
};

/// Descriptor for `MarkReadResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markReadResponseDescriptor = $convert.base64Decode(
    'ChBNYXJrUmVhZFJlc3BvbnNlEiEKDHVucmVhZF9jb3VudBgBIAEoBVILdW5yZWFkQ291bnQ=');

@$core.Deprecated('Use relayMessageRequestDescriptor instead')
const RelayMessageRequest$json = {
  '1': 'RelayMessageRequest',
  '2': [
    {
      '1': 'envelope',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.MessageEnvelope',
      '10': 'envelope'
    },
  ],
};

/// Descriptor for `RelayMessageRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List relayMessageRequestDescriptor = $convert.base64Decode(
    'ChNSZWxheU1lc3NhZ2VSZXF1ZXN0EkYKCGVudmVsb3BlGAEgASgLMioucGVlcnNfdG91Y2gubW'
    '9kZWwuY2hhdC52MS5NZXNzYWdlRW52ZWxvcGVSCGVudmVsb3Bl');

@$core.Deprecated('Use relayMessageResponseDescriptor instead')
const RelayMessageResponse$json = {
  '1': 'RelayMessageResponse',
  '2': [
    {'1': 'status', '3': 1, '4': 1, '5': 9, '10': 'status'},
    {
      '1': 'delivered_at',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'deliveredAt'
    },
    {'1': 'forwarded_to', '3': 3, '4': 1, '5': 9, '10': 'forwardedTo'},
  ],
};

/// Descriptor for `RelayMessageResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List relayMessageResponseDescriptor = $convert.base64Decode(
    'ChRSZWxheU1lc3NhZ2VSZXNwb25zZRIWCgZzdGF0dXMYASABKAlSBnN0YXR1cxI9CgxkZWxpdm'
    'VyZWRfYXQYAiABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgtkZWxpdmVyZWRBdBIh'
    'Cgxmb3J3YXJkZWRfdG8YAyABKAlSC2ZvcndhcmRlZFRv');
