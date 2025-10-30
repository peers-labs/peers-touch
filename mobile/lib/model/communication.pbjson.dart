// This is a generated file - do not edit.
//
// Generated from communication.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use messageTypeDescriptor instead')
const MessageType$json = {
  '1': 'MessageType',
  '2': [
    {'1': 'MESSAGE_TYPE_UNKNOWN', '2': 0},
    {'1': 'MESSAGE_TYPE_TEXT', '2': 1},
    {'1': 'MESSAGE_TYPE_BINARY', '2': 2},
    {'1': 'MESSAGE_TYPE_JSON', '2': 3},
    {'1': 'MESSAGE_TYPE_PROTOBUF', '2': 4},
    {'1': 'MESSAGE_TYPE_CONTROL', '2': 5},
  ],
};

/// Descriptor for `MessageType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List messageTypeDescriptor = $convert.base64Decode(
    'CgtNZXNzYWdlVHlwZRIYChRNRVNTQUdFX1RZUEVfVU5LTk9XThAAEhUKEU1FU1NBR0VfVFlQRV'
    '9URVhUEAESFwoTTUVTU0FHRV9UWVBFX0JJTkFSWRACEhUKEU1FU1NBR0VfVFlQRV9KU09OEAMS'
    'GQoVTUVTU0FHRV9UWVBFX1BST1RPQlVGEAQSGAoUTUVTU0FHRV9UWVBFX0NPTlRST0wQBQ==');

@$core.Deprecated('Use messagePriorityDescriptor instead')
const MessagePriority$json = {
  '1': 'MessagePriority',
  '2': [
    {'1': 'MESSAGE_PRIORITY_UNKNOWN', '2': 0},
    {'1': 'MESSAGE_PRIORITY_LOW', '2': 1},
    {'1': 'MESSAGE_PRIORITY_NORMAL', '2': 2},
    {'1': 'MESSAGE_PRIORITY_HIGH', '2': 3},
    {'1': 'MESSAGE_PRIORITY_URGENT', '2': 4},
  ],
};

/// Descriptor for `MessagePriority`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List messagePriorityDescriptor = $convert.base64Decode(
    'Cg9NZXNzYWdlUHJpb3JpdHkSHAoYTUVTU0FHRV9QUklPUklUWV9VTktOT1dOEAASGAoUTUVTU0'
    'FHRV9QUklPUklUWV9MT1cQARIbChdNRVNTQUdFX1BSSU9SSVRZX05PUk1BTBACEhkKFU1FU1NB'
    'R0VfUFJJT1JJVFlfSElHSBADEhsKF01FU1NBR0VfUFJJT1JJVFlfVVJHRU5UEAQ=');

@$core.Deprecated('Use deliveryModeDescriptor instead')
const DeliveryMode$json = {
  '1': 'DeliveryMode',
  '2': [
    {'1': 'DELIVERY_MODE_UNKNOWN', '2': 0},
    {'1': 'DELIVERY_MODE_BEST_EFFORT', '2': 1},
    {'1': 'DELIVERY_MODE_AT_LEAST_ONCE', '2': 2},
    {'1': 'DELIVERY_MODE_EXACTLY_ONCE', '2': 3},
  ],
};

/// Descriptor for `DeliveryMode`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List deliveryModeDescriptor = $convert.base64Decode(
    'CgxEZWxpdmVyeU1vZGUSGQoVREVMSVZFUllfTU9ERV9VTktOT1dOEAASHQoZREVMSVZFUllfTU'
    '9ERV9CRVNUX0VGRk9SVBABEh8KG0RFTElWRVJZX01PREVfQVRfTEVBU1RfT05DRRACEh4KGkRF'
    'TElWRVJZX01PREVfRVhBQ1RMWV9PTkNFEAM=');

@$core.Deprecated('Use messageStatusDescriptor instead')
const MessageStatus$json = {
  '1': 'MessageStatus',
  '2': [
    {'1': 'MESSAGE_STATUS_UNKNOWN', '2': 0},
    {'1': 'MESSAGE_STATUS_PENDING', '2': 1},
    {'1': 'MESSAGE_STATUS_SENT', '2': 2},
    {'1': 'MESSAGE_STATUS_DELIVERED', '2': 3},
    {'1': 'MESSAGE_STATUS_ACKNOWLEDGED', '2': 4},
    {'1': 'MESSAGE_STATUS_FAILED', '2': 5},
  ],
};

/// Descriptor for `MessageStatus`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List messageStatusDescriptor = $convert.base64Decode(
    'Cg1NZXNzYWdlU3RhdHVzEhoKFk1FU1NBR0VfU1RBVFVTX1VOS05PV04QABIaChZNRVNTQUdFX1'
    'NUQVRVU19QRU5ESU5HEAESFwoTTUVTU0FHRV9TVEFUVVNfU0VOVBACEhwKGE1FU1NBR0VfU1RB'
    'VFVTX0RFTElWRVJFRBADEh8KG01FU1NBR0VfU1RBVFVTX0FDS05PV0xFREdFRBAEEhkKFU1FU1'
    'NBR0VfU1RBVFVTX0ZBSUxFRBAF');

@$core.Deprecated('Use messageIDDescriptor instead')
const MessageID$json = {
  '1': 'MessageID',
  '2': [
    {'1': 'value', '3': 1, '4': 1, '5': 9, '10': 'value'},
  ],
};

/// Descriptor for `MessageID`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List messageIDDescriptor =
    $convert.base64Decode('CglNZXNzYWdlSUQSFAoFdmFsdWUYASABKAlSBXZhbHVl');

@$core.Deprecated('Use streamIDDescriptor instead')
const StreamID$json = {
  '1': 'StreamID',
  '2': [
    {'1': 'value', '3': 1, '4': 1, '5': 9, '10': 'value'},
  ],
};

/// Descriptor for `StreamID`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List streamIDDescriptor =
    $convert.base64Decode('CghTdHJlYW1JRBIUCgV2YWx1ZRgBIAEoCVIFdmFsdWU=');

@$core.Deprecated('Use topicIDDescriptor instead')
const TopicID$json = {
  '1': 'TopicID',
  '2': [
    {'1': 'value', '3': 1, '4': 1, '5': 9, '10': 'value'},
  ],
};

/// Descriptor for `TopicID`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List topicIDDescriptor =
    $convert.base64Decode('CgdUb3BpY0lEEhQKBXZhbHVlGAEgASgJUgV2YWx1ZQ==');

@$core.Deprecated('Use messageDescriptor instead')
const Message$json = {
  '1': 'Message',
  '2': [
    {
      '1': 'id',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.MessageID',
      '10': 'id'
    },
    {
      '1': 'sender',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'sender'
    },
    {
      '1': 'recipients',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'recipients'
    },
    {
      '1': 'type',
      '3': 4,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.v2.MessageType',
      '10': 'type'
    },
    {
      '1': 'priority',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.v2.MessagePriority',
      '10': 'priority'
    },
    {'1': 'payload', '3': 6, '4': 1, '5': 12, '10': 'payload'},
    {
      '1': 'headers',
      '3': 7,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.Message.HeadersEntry',
      '10': 'headers'
    },
    {
      '1': 'created_at',
      '3': 8,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'expires_at',
      '3': 9,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'expiresAt'
    },
    {'1': 'correlation_id', '3': 10, '4': 1, '5': 9, '10': 'correlationId'},
    {'1': 'reply_to', '3': 11, '4': 1, '5': 9, '10': 'replyTo'},
  ],
  '3': [Message_HeadersEntry$json],
};

@$core.Deprecated('Use messageDescriptor instead')
const Message_HeadersEntry$json = {
  '1': 'HeadersEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `Message`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List messageDescriptor = $convert.base64Decode(
    'CgdNZXNzYWdlEikKAmlkGAEgASgLMhkucGVlcnNfdG91Y2gudjIuTWVzc2FnZUlEUgJpZBIyCg'
    'ZzZW5kZXIYAiABKAsyGi5wZWVyc190b3VjaC52Mi5JZGVudGl0eUlEUgZzZW5kZXISOgoKcmVj'
    'aXBpZW50cxgDIAMoCzIaLnBlZXJzX3RvdWNoLnYyLklkZW50aXR5SURSCnJlY2lwaWVudHMSLw'
    'oEdHlwZRgEIAEoDjIbLnBlZXJzX3RvdWNoLnYyLk1lc3NhZ2VUeXBlUgR0eXBlEjsKCHByaW9y'
    'aXR5GAUgASgOMh8ucGVlcnNfdG91Y2gudjIuTWVzc2FnZVByaW9yaXR5Ughwcmlvcml0eRIYCg'
    'dwYXlsb2FkGAYgASgMUgdwYXlsb2FkEj4KB2hlYWRlcnMYByADKAsyJC5wZWVyc190b3VjaC52'
    'Mi5NZXNzYWdlLkhlYWRlcnNFbnRyeVIHaGVhZGVycxI5CgpjcmVhdGVkX2F0GAggASgLMhouZ2'
    '9vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJY3JlYXRlZEF0EjkKCmV4cGlyZXNfYXQYCSABKAsy'
    'Gi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUglleHBpcmVzQXQSJQoOY29ycmVsYXRpb25faW'
    'QYCiABKAlSDWNvcnJlbGF0aW9uSWQSGQoIcmVwbHlfdG8YCyABKAlSB3JlcGx5VG8aOgoMSGVh'
    'ZGVyc0VudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbHVlGAIgASgJUgV2YWx1ZToCOAE=');

@$core.Deprecated('Use streamInfoDescriptor instead')
const StreamInfo$json = {
  '1': 'StreamInfo',
  '2': [
    {
      '1': 'id',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.StreamID',
      '10': 'id'
    },
    {
      '1': 'local_peer',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'localPeer'
    },
    {
      '1': 'remote_peer',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'remotePeer'
    },
    {
      '1': 'link_id',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.LinkID',
      '10': 'linkId'
    },
    {'1': 'protocol', '3': 5, '4': 1, '5': 9, '10': 'protocol'},
    {'1': 'is_bidirectional', '3': 6, '4': 1, '5': 8, '10': 'isBidirectional'},
    {'1': 'is_reliable', '3': 7, '4': 1, '5': 8, '10': 'isReliable'},
    {'1': 'is_ordered', '3': 8, '4': 1, '5': 8, '10': 'isOrdered'},
    {
      '1': 'created_at',
      '3': 9,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'last_activity',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'lastActivity'
    },
    {'1': 'bytes_sent', '3': 11, '4': 1, '5': 4, '10': 'bytesSent'},
    {'1': 'bytes_received', '3': 12, '4': 1, '5': 4, '10': 'bytesReceived'},
  ],
};

/// Descriptor for `StreamInfo`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List streamInfoDescriptor = $convert.base64Decode(
    'CgpTdHJlYW1JbmZvEigKAmlkGAEgASgLMhgucGVlcnNfdG91Y2gudjIuU3RyZWFtSURSAmlkEj'
    'kKCmxvY2FsX3BlZXIYAiABKAsyGi5wZWVyc190b3VjaC52Mi5JZGVudGl0eUlEUglsb2NhbFBl'
    'ZXISOwoLcmVtb3RlX3BlZXIYAyABKAsyGi5wZWVyc190b3VjaC52Mi5JZGVudGl0eUlEUgpyZW'
    '1vdGVQZWVyEi8KB2xpbmtfaWQYBCABKAsyFi5wZWVyc190b3VjaC52Mi5MaW5rSURSBmxpbmtJ'
    'ZBIaCghwcm90b2NvbBgFIAEoCVIIcHJvdG9jb2wSKQoQaXNfYmlkaXJlY3Rpb25hbBgGIAEoCF'
    'IPaXNCaWRpcmVjdGlvbmFsEh8KC2lzX3JlbGlhYmxlGAcgASgIUgppc1JlbGlhYmxlEh0KCmlz'
    'X29yZGVyZWQYCCABKAhSCWlzT3JkZXJlZBI5CgpjcmVhdGVkX2F0GAkgASgLMhouZ29vZ2xlLn'
    'Byb3RvYnVmLlRpbWVzdGFtcFIJY3JlYXRlZEF0Ej8KDWxhc3RfYWN0aXZpdHkYCiABKAsyGi5n'
    'b29nbGUucHJvdG9idWYuVGltZXN0YW1wUgxsYXN0QWN0aXZpdHkSHQoKYnl0ZXNfc2VudBgLIA'
    'EoBFIJYnl0ZXNTZW50EiUKDmJ5dGVzX3JlY2VpdmVkGAwgASgEUg1ieXRlc1JlY2VpdmVk');

@$core.Deprecated('Use topicInfoDescriptor instead')
const TopicInfo$json = {
  '1': 'TopicInfo',
  '2': [
    {
      '1': 'id',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.TopicID',
      '10': 'id'
    },
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'description', '3': 3, '4': 1, '5': 9, '10': 'description'},
    {
      '1': 'subscribers',
      '3': 4,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'subscribers'
    },
    {
      '1': 'publishers',
      '3': 5,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'publishers'
    },
    {
      '1': 'created_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {'1': 'message_count', '3': 7, '4': 1, '5': 4, '10': 'messageCount'},
    {
      '1': 'metadata',
      '3': 8,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.TopicInfo.MetadataEntry',
      '10': 'metadata'
    },
  ],
  '3': [TopicInfo_MetadataEntry$json],
};

@$core.Deprecated('Use topicInfoDescriptor instead')
const TopicInfo_MetadataEntry$json = {
  '1': 'MetadataEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `TopicInfo`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List topicInfoDescriptor = $convert.base64Decode(
    'CglUb3BpY0luZm8SJwoCaWQYASABKAsyFy5wZWVyc190b3VjaC52Mi5Ub3BpY0lEUgJpZBISCg'
    'RuYW1lGAIgASgJUgRuYW1lEiAKC2Rlc2NyaXB0aW9uGAMgASgJUgtkZXNjcmlwdGlvbhI8Cgtz'
    'dWJzY3JpYmVycxgEIAMoCzIaLnBlZXJzX3RvdWNoLnYyLklkZW50aXR5SURSC3N1YnNjcmliZX'
    'JzEjoKCnB1Ymxpc2hlcnMYBSADKAsyGi5wZWVyc190b3VjaC52Mi5JZGVudGl0eUlEUgpwdWJs'
    'aXNoZXJzEjkKCmNyZWF0ZWRfYXQYBiABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUg'
    'ljcmVhdGVkQXQSIwoNbWVzc2FnZV9jb3VudBgHIAEoBFIMbWVzc2FnZUNvdW50EkMKCG1ldGFk'
    'YXRhGAggAygLMicucGVlcnNfdG91Y2gudjIuVG9waWNJbmZvLk1ldGFkYXRhRW50cnlSCG1ldG'
    'FkYXRhGjsKDU1ldGFkYXRhRW50cnkSEAoDa2V5GAEgASgJUgNrZXkSFAoFdmFsdWUYAiABKAlS'
    'BXZhbHVlOgI4AQ==');

@$core.Deprecated('Use sendOptionsDescriptor instead')
const SendOptions$json = {
  '1': 'SendOptions',
  '2': [
    {
      '1': 'priority',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.v2.MessagePriority',
      '10': 'priority'
    },
    {
      '1': 'delivery_mode',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.v2.DeliveryMode',
      '10': 'deliveryMode'
    },
    {'1': 'timeout_ms', '3': 3, '4': 1, '5': 3, '10': 'timeoutMs'},
    {'1': 'max_retries', '3': 4, '4': 1, '5': 5, '10': 'maxRetries'},
    {'1': 'require_ack', '3': 5, '4': 1, '5': 8, '10': 'requireAck'},
    {
      '1': 'headers',
      '3': 6,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.SendOptions.HeadersEntry',
      '10': 'headers'
    },
  ],
  '3': [SendOptions_HeadersEntry$json],
};

@$core.Deprecated('Use sendOptionsDescriptor instead')
const SendOptions_HeadersEntry$json = {
  '1': 'HeadersEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `SendOptions`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List sendOptionsDescriptor = $convert.base64Decode(
    'CgtTZW5kT3B0aW9ucxI7Cghwcmlvcml0eRgBIAEoDjIfLnBlZXJzX3RvdWNoLnYyLk1lc3NhZ2'
    'VQcmlvcml0eVIIcHJpb3JpdHkSQQoNZGVsaXZlcnlfbW9kZRgCIAEoDjIcLnBlZXJzX3RvdWNo'
    'LnYyLkRlbGl2ZXJ5TW9kZVIMZGVsaXZlcnlNb2RlEh0KCnRpbWVvdXRfbXMYAyABKANSCXRpbW'
    'VvdXRNcxIfCgttYXhfcmV0cmllcxgEIAEoBVIKbWF4UmV0cmllcxIfCgtyZXF1aXJlX2FjaxgF'
    'IAEoCFIKcmVxdWlyZUFjaxJCCgdoZWFkZXJzGAYgAygLMigucGVlcnNfdG91Y2gudjIuU2VuZE'
    '9wdGlvbnMuSGVhZGVyc0VudHJ5UgdoZWFkZXJzGjoKDEhlYWRlcnNFbnRyeRIQCgNrZXkYASAB'
    'KAlSA2tleRIUCgV2YWx1ZRgCIAEoCVIFdmFsdWU6AjgB');

@$core.Deprecated('Use receiveOptionsDescriptor instead')
const ReceiveOptions$json = {
  '1': 'ReceiveOptions',
  '2': [
    {'1': 'timeout_ms', '3': 1, '4': 1, '5': 3, '10': 'timeoutMs'},
    {'1': 'max_messages', '3': 2, '4': 1, '5': 5, '10': 'maxMessages'},
    {
      '1': 'type_filter',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.v2.MessageType',
      '10': 'typeFilter'
    },
    {
      '1': 'sender_filter',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'senderFilter'
    },
  ],
};

/// Descriptor for `ReceiveOptions`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List receiveOptionsDescriptor = $convert.base64Decode(
    'Cg5SZWNlaXZlT3B0aW9ucxIdCgp0aW1lb3V0X21zGAEgASgDUgl0aW1lb3V0TXMSIQoMbWF4X2'
    '1lc3NhZ2VzGAIgASgFUgttYXhNZXNzYWdlcxI8Cgt0eXBlX2ZpbHRlchgDIAEoDjIbLnBlZXJz'
    'X3RvdWNoLnYyLk1lc3NhZ2VUeXBlUgp0eXBlRmlsdGVyEj8KDXNlbmRlcl9maWx0ZXIYBCABKA'
    'syGi5wZWVyc190b3VjaC52Mi5JZGVudGl0eUlEUgxzZW5kZXJGaWx0ZXI=');

@$core.Deprecated('Use streamOptionsDescriptor instead')
const StreamOptions$json = {
  '1': 'StreamOptions',
  '2': [
    {'1': 'protocol', '3': 1, '4': 1, '5': 9, '10': 'protocol'},
    {'1': 'bidirectional', '3': 2, '4': 1, '5': 8, '10': 'bidirectional'},
    {'1': 'reliable', '3': 3, '4': 1, '5': 8, '10': 'reliable'},
    {'1': 'ordered', '3': 4, '4': 1, '5': 8, '10': 'ordered'},
    {'1': 'buffer_size', '3': 5, '4': 1, '5': 5, '10': 'bufferSize'},
    {
      '1': 'metadata',
      '3': 6,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.StreamOptions.MetadataEntry',
      '10': 'metadata'
    },
  ],
  '3': [StreamOptions_MetadataEntry$json],
};

@$core.Deprecated('Use streamOptionsDescriptor instead')
const StreamOptions_MetadataEntry$json = {
  '1': 'MetadataEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `StreamOptions`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List streamOptionsDescriptor = $convert.base64Decode(
    'Cg1TdHJlYW1PcHRpb25zEhoKCHByb3RvY29sGAEgASgJUghwcm90b2NvbBIkCg1iaWRpcmVjdG'
    'lvbmFsGAIgASgIUg1iaWRpcmVjdGlvbmFsEhoKCHJlbGlhYmxlGAMgASgIUghyZWxpYWJsZRIY'
    'CgdvcmRlcmVkGAQgASgIUgdvcmRlcmVkEh8KC2J1ZmZlcl9zaXplGAUgASgFUgpidWZmZXJTaX'
    'plEkcKCG1ldGFkYXRhGAYgAygLMisucGVlcnNfdG91Y2gudjIuU3RyZWFtT3B0aW9ucy5NZXRh'
    'ZGF0YUVudHJ5UghtZXRhZGF0YRo7Cg1NZXRhZGF0YUVudHJ5EhAKA2tleRgBIAEoCVIDa2V5Eh'
    'QKBXZhbHVlGAIgASgJUgV2YWx1ZToCOAE=');

@$core.Deprecated('Use subscribeOptionsDescriptor instead')
const SubscribeOptions$json = {
  '1': 'SubscribeOptions',
  '2': [
    {
      '1': 'type_filter',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.v2.MessageType',
      '10': 'typeFilter'
    },
    {
      '1': 'sender_filter',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'senderFilter'
    },
    {
      '1': 'metadata',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.SubscribeOptions.MetadataEntry',
      '10': 'metadata'
    },
  ],
  '3': [SubscribeOptions_MetadataEntry$json],
};

@$core.Deprecated('Use subscribeOptionsDescriptor instead')
const SubscribeOptions_MetadataEntry$json = {
  '1': 'MetadataEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `SubscribeOptions`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List subscribeOptionsDescriptor = $convert.base64Decode(
    'ChBTdWJzY3JpYmVPcHRpb25zEjwKC3R5cGVfZmlsdGVyGAEgASgOMhsucGVlcnNfdG91Y2gudj'
    'IuTWVzc2FnZVR5cGVSCnR5cGVGaWx0ZXISPwoNc2VuZGVyX2ZpbHRlchgCIAEoCzIaLnBlZXJz'
    'X3RvdWNoLnYyLklkZW50aXR5SURSDHNlbmRlckZpbHRlchJKCghtZXRhZGF0YRgDIAMoCzIuLn'
    'BlZXJzX3RvdWNoLnYyLlN1YnNjcmliZU9wdGlvbnMuTWV0YWRhdGFFbnRyeVIIbWV0YWRhdGEa'
    'OwoNTWV0YWRhdGFFbnRyeRIQCgNrZXkYASABKAlSA2tleRIUCgV2YWx1ZRgCIAEoCVIFdmFsdW'
    'U6AjgB');

@$core.Deprecated('Use sendRequestDescriptor instead')
const SendRequest$json = {
  '1': 'SendRequest',
  '2': [
    {
      '1': 'message',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.Message',
      '10': 'message'
    },
    {
      '1': 'options',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.SendOptions',
      '10': 'options'
    },
  ],
};

/// Descriptor for `SendRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List sendRequestDescriptor = $convert.base64Decode(
    'CgtTZW5kUmVxdWVzdBIxCgdtZXNzYWdlGAEgASgLMhcucGVlcnNfdG91Y2gudjIuTWVzc2FnZV'
    'IHbWVzc2FnZRI1CgdvcHRpb25zGAIgASgLMhsucGVlcnNfdG91Y2gudjIuU2VuZE9wdGlvbnNS'
    'B29wdGlvbnM=');

@$core.Deprecated('Use sendResponseDescriptor instead')
const SendResponse$json = {
  '1': 'SendResponse',
  '2': [
    {
      '1': 'message_id',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.MessageID',
      '10': 'messageId'
    },
    {
      '1': 'status',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.v2.MessageStatus',
      '10': 'status'
    },
    {'1': 'error_message', '3': 3, '4': 1, '5': 9, '10': 'errorMessage'},
  ],
};

/// Descriptor for `SendResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List sendResponseDescriptor = $convert.base64Decode(
    'CgxTZW5kUmVzcG9uc2USOAoKbWVzc2FnZV9pZBgBIAEoCzIZLnBlZXJzX3RvdWNoLnYyLk1lc3'
    'NhZ2VJRFIJbWVzc2FnZUlkEjUKBnN0YXR1cxgCIAEoDjIdLnBlZXJzX3RvdWNoLnYyLk1lc3Nh'
    'Z2VTdGF0dXNSBnN0YXR1cxIjCg1lcnJvcl9tZXNzYWdlGAMgASgJUgxlcnJvck1lc3NhZ2U=');

@$core.Deprecated('Use receiveRequestDescriptor instead')
const ReceiveRequest$json = {
  '1': 'ReceiveRequest',
  '2': [
    {
      '1': 'options',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.ReceiveOptions',
      '10': 'options'
    },
  ],
};

/// Descriptor for `ReceiveRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List receiveRequestDescriptor = $convert.base64Decode(
    'Cg5SZWNlaXZlUmVxdWVzdBI4CgdvcHRpb25zGAEgASgLMh4ucGVlcnNfdG91Y2gudjIuUmVjZW'
    'l2ZU9wdGlvbnNSB29wdGlvbnM=');

@$core.Deprecated('Use receiveResponseDescriptor instead')
const ReceiveResponse$json = {
  '1': 'ReceiveResponse',
  '2': [
    {
      '1': 'messages',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.Message',
      '10': 'messages'
    },
  ],
};

/// Descriptor for `ReceiveResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List receiveResponseDescriptor = $convert.base64Decode(
    'Cg9SZWNlaXZlUmVzcG9uc2USMwoIbWVzc2FnZXMYASADKAsyFy5wZWVyc190b3VjaC52Mi5NZX'
    'NzYWdlUghtZXNzYWdlcw==');

@$core.Deprecated('Use createStreamRequestDescriptor instead')
const CreateStreamRequest$json = {
  '1': 'CreateStreamRequest',
  '2': [
    {
      '1': 'remote_peer',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'remotePeer'
    },
    {
      '1': 'link_id',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.LinkID',
      '10': 'linkId'
    },
    {
      '1': 'options',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.StreamOptions',
      '10': 'options'
    },
  ],
};

/// Descriptor for `CreateStreamRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createStreamRequestDescriptor = $convert.base64Decode(
    'ChNDcmVhdGVTdHJlYW1SZXF1ZXN0EjsKC3JlbW90ZV9wZWVyGAEgASgLMhoucGVlcnNfdG91Y2'
    'gudjIuSWRlbnRpdHlJRFIKcmVtb3RlUGVlchIvCgdsaW5rX2lkGAIgASgLMhYucGVlcnNfdG91'
    'Y2gudjIuTGlua0lEUgZsaW5rSWQSNwoHb3B0aW9ucxgDIAEoCzIdLnBlZXJzX3RvdWNoLnYyLl'
    'N0cmVhbU9wdGlvbnNSB29wdGlvbnM=');

@$core.Deprecated('Use createStreamResponseDescriptor instead')
const CreateStreamResponse$json = {
  '1': 'CreateStreamResponse',
  '2': [
    {
      '1': 'stream',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.StreamInfo',
      '10': 'stream'
    },
    {'1': 'error_message', '3': 2, '4': 1, '5': 9, '10': 'errorMessage'},
  ],
};

/// Descriptor for `CreateStreamResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createStreamResponseDescriptor = $convert.base64Decode(
    'ChRDcmVhdGVTdHJlYW1SZXNwb25zZRIyCgZzdHJlYW0YASABKAsyGi5wZWVyc190b3VjaC52Mi'
    '5TdHJlYW1JbmZvUgZzdHJlYW0SIwoNZXJyb3JfbWVzc2FnZRgCIAEoCVIMZXJyb3JNZXNzYWdl');

@$core.Deprecated('Use writeStreamRequestDescriptor instead')
const WriteStreamRequest$json = {
  '1': 'WriteStreamRequest',
  '2': [
    {
      '1': 'stream_id',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.StreamID',
      '10': 'streamId'
    },
    {'1': 'data', '3': 2, '4': 1, '5': 12, '10': 'data'},
  ],
};

/// Descriptor for `WriteStreamRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List writeStreamRequestDescriptor = $convert.base64Decode(
    'ChJXcml0ZVN0cmVhbVJlcXVlc3QSNQoJc3RyZWFtX2lkGAEgASgLMhgucGVlcnNfdG91Y2gudj'
    'IuU3RyZWFtSURSCHN0cmVhbUlkEhIKBGRhdGEYAiABKAxSBGRhdGE=');

@$core.Deprecated('Use readStreamRequestDescriptor instead')
const ReadStreamRequest$json = {
  '1': 'ReadStreamRequest',
  '2': [
    {
      '1': 'stream_id',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.StreamID',
      '10': 'streamId'
    },
    {'1': 'max_bytes', '3': 2, '4': 1, '5': 5, '10': 'maxBytes'},
  ],
};

/// Descriptor for `ReadStreamRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List readStreamRequestDescriptor = $convert.base64Decode(
    'ChFSZWFkU3RyZWFtUmVxdWVzdBI1CglzdHJlYW1faWQYASABKAsyGC5wZWVyc190b3VjaC52Mi'
    '5TdHJlYW1JRFIIc3RyZWFtSWQSGwoJbWF4X2J5dGVzGAIgASgFUghtYXhCeXRlcw==');

@$core.Deprecated('Use readStreamResponseDescriptor instead')
const ReadStreamResponse$json = {
  '1': 'ReadStreamResponse',
  '2': [
    {'1': 'data', '3': 1, '4': 1, '5': 12, '10': 'data'},
    {'1': 'eof', '3': 2, '4': 1, '5': 8, '10': 'eof'},
  ],
};

/// Descriptor for `ReadStreamResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List readStreamResponseDescriptor = $convert.base64Decode(
    'ChJSZWFkU3RyZWFtUmVzcG9uc2USEgoEZGF0YRgBIAEoDFIEZGF0YRIQCgNlb2YYAiABKAhSA2'
    'VvZg==');

@$core.Deprecated('Use closeStreamRequestDescriptor instead')
const CloseStreamRequest$json = {
  '1': 'CloseStreamRequest',
  '2': [
    {
      '1': 'stream_id',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.StreamID',
      '10': 'streamId'
    },
  ],
};

/// Descriptor for `CloseStreamRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List closeStreamRequestDescriptor = $convert.base64Decode(
    'ChJDbG9zZVN0cmVhbVJlcXVlc3QSNQoJc3RyZWFtX2lkGAEgASgLMhgucGVlcnNfdG91Y2gudj'
    'IuU3RyZWFtSURSCHN0cmVhbUlk');

@$core.Deprecated('Use subscribeRequestDescriptor instead')
const SubscribeRequest$json = {
  '1': 'SubscribeRequest',
  '2': [
    {
      '1': 'topic_id',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.TopicID',
      '10': 'topicId'
    },
    {
      '1': 'options',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.SubscribeOptions',
      '10': 'options'
    },
  ],
};

/// Descriptor for `SubscribeRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List subscribeRequestDescriptor = $convert.base64Decode(
    'ChBTdWJzY3JpYmVSZXF1ZXN0EjIKCHRvcGljX2lkGAEgASgLMhcucGVlcnNfdG91Y2gudjIuVG'
    '9waWNJRFIHdG9waWNJZBI6CgdvcHRpb25zGAIgASgLMiAucGVlcnNfdG91Y2gudjIuU3Vic2Ny'
    'aWJlT3B0aW9uc1IHb3B0aW9ucw==');

@$core.Deprecated('Use unsubscribeRequestDescriptor instead')
const UnsubscribeRequest$json = {
  '1': 'UnsubscribeRequest',
  '2': [
    {
      '1': 'topic_id',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.TopicID',
      '10': 'topicId'
    },
  ],
};

/// Descriptor for `UnsubscribeRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unsubscribeRequestDescriptor = $convert.base64Decode(
    'ChJVbnN1YnNjcmliZVJlcXVlc3QSMgoIdG9waWNfaWQYASABKAsyFy5wZWVyc190b3VjaC52Mi'
    '5Ub3BpY0lEUgd0b3BpY0lk');

@$core.Deprecated('Use publishRequestDescriptor instead')
const PublishRequest$json = {
  '1': 'PublishRequest',
  '2': [
    {
      '1': 'topic_id',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.TopicID',
      '10': 'topicId'
    },
    {
      '1': 'message',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.Message',
      '10': 'message'
    },
  ],
};

/// Descriptor for `PublishRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List publishRequestDescriptor = $convert.base64Decode(
    'Cg5QdWJsaXNoUmVxdWVzdBIyCgh0b3BpY19pZBgBIAEoCzIXLnBlZXJzX3RvdWNoLnYyLlRvcG'
    'ljSURSB3RvcGljSWQSMQoHbWVzc2FnZRgCIAEoCzIXLnBlZXJzX3RvdWNoLnYyLk1lc3NhZ2VS'
    'B21lc3NhZ2U=');

@$core.Deprecated('Use publishResponseDescriptor instead')
const PublishResponse$json = {
  '1': 'PublishResponse',
  '2': [
    {
      '1': 'message_id',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.MessageID',
      '10': 'messageId'
    },
    {'1': 'subscriber_count', '3': 2, '4': 1, '5': 5, '10': 'subscriberCount'},
    {'1': 'error_message', '3': 3, '4': 1, '5': 9, '10': 'errorMessage'},
  ],
};

/// Descriptor for `PublishResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List publishResponseDescriptor = $convert.base64Decode(
    'Cg9QdWJsaXNoUmVzcG9uc2USOAoKbWVzc2FnZV9pZBgBIAEoCzIZLnBlZXJzX3RvdWNoLnYyLk'
    '1lc3NhZ2VJRFIJbWVzc2FnZUlkEikKEHN1YnNjcmliZXJfY291bnQYAiABKAVSD3N1YnNjcmli'
    'ZXJDb3VudBIjCg1lcnJvcl9tZXNzYWdlGAMgASgJUgxlcnJvck1lc3NhZ2U=');

@$core.Deprecated('Use listTopicsRequestDescriptor instead')
const ListTopicsRequest$json = {
  '1': 'ListTopicsRequest',
  '2': [
    {'1': 'name_filter', '3': 1, '4': 1, '5': 9, '10': 'nameFilter'},
  ],
};

/// Descriptor for `ListTopicsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listTopicsRequestDescriptor = $convert.base64Decode(
    'ChFMaXN0VG9waWNzUmVxdWVzdBIfCgtuYW1lX2ZpbHRlchgBIAEoCVIKbmFtZUZpbHRlcg==');

@$core.Deprecated('Use listTopicsResponseDescriptor instead')
const ListTopicsResponse$json = {
  '1': 'ListTopicsResponse',
  '2': [
    {
      '1': 'topics',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v2.TopicInfo',
      '10': 'topics'
    },
  ],
};

/// Descriptor for `ListTopicsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listTopicsResponseDescriptor = $convert.base64Decode(
    'ChJMaXN0VG9waWNzUmVzcG9uc2USMQoGdG9waWNzGAEgAygLMhkucGVlcnNfdG91Y2gudjIuVG'
    '9waWNJbmZvUgZ0b3BpY3M=');

@$core.Deprecated('Use messageAckDescriptor instead')
const MessageAck$json = {
  '1': 'MessageAck',
  '2': [
    {
      '1': 'message_id',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.MessageID',
      '10': 'messageId'
    },
    {
      '1': 'recipient',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.v2.IdentityID',
      '10': 'recipient'
    },
    {
      '1': 'timestamp',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'timestamp'
    },
  ],
};

/// Descriptor for `MessageAck`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List messageAckDescriptor = $convert.base64Decode(
    'CgpNZXNzYWdlQWNrEjgKCm1lc3NhZ2VfaWQYASABKAsyGS5wZWVyc190b3VjaC52Mi5NZXNzYW'
    'dlSURSCW1lc3NhZ2VJZBI4CglyZWNpcGllbnQYAiABKAsyGi5wZWVyc190b3VjaC52Mi5JZGVu'
    'dGl0eUlEUglyZWNpcGllbnQSOAoJdGltZXN0YW1wGAMgASgLMhouZ29vZ2xlLnByb3RvYnVmLl'
    'RpbWVzdGFtcFIJdGltZXN0YW1w');
