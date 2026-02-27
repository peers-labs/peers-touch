// This is a generated file - do not edit.
//
// Generated from domain/message/conversation.proto.

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

@$core.Deprecated('Use createConvRequestDescriptor instead')
const CreateConvRequest$json = {
  '1': 'CreateConvRequest',
  '2': [
    {'1': 'conv_id', '3': 1, '4': 1, '5': 9, '10': 'convId'},
    {'1': 'type', '3': 2, '4': 1, '5': 9, '10': 'type'},
    {'1': 'title', '3': 3, '4': 1, '5': 9, '10': 'title'},
    {'1': 'avatar_cid', '3': 4, '4': 1, '5': 9, '10': 'avatarCid'},
    {'1': 'policy', '3': 5, '4': 1, '5': 9, '10': 'policy'},
  ],
};

/// Descriptor for `CreateConvRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createConvRequestDescriptor = $convert.base64Decode(
    'ChFDcmVhdGVDb252UmVxdWVzdBIXCgdjb252X2lkGAEgASgJUgZjb252SWQSEgoEdHlwZRgCIA'
    'EoCVIEdHlwZRIUCgV0aXRsZRgDIAEoCVIFdGl0bGUSHQoKYXZhdGFyX2NpZBgEIAEoCVIJYXZh'
    'dGFyQ2lkEhYKBnBvbGljeRgFIAEoCVIGcG9saWN5');

@$core.Deprecated('Use conversationDescriptor instead')
const Conversation$json = {
  '1': 'Conversation',
  '2': [
    {'1': 'pk', '3': 1, '4': 1, '5': 4, '10': 'pk'},
    {'1': 'conv_id', '3': 2, '4': 1, '5': 9, '10': 'convId'},
    {'1': 'type', '3': 3, '4': 1, '5': 9, '10': 'type'},
    {'1': 'title', '3': 4, '4': 1, '5': 9, '10': 'title'},
    {'1': 'avatar_cid', '3': 5, '4': 1, '5': 9, '10': 'avatarCid'},
    {'1': 'policy', '3': 6, '4': 1, '5': 9, '10': 'policy'},
    {'1': 'epoch', '3': 7, '4': 1, '5': 13, '10': 'epoch'},
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

/// Descriptor for `Conversation`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List conversationDescriptor = $convert.base64Decode(
    'CgxDb252ZXJzYXRpb24SDgoCcGsYASABKARSAnBrEhcKB2NvbnZfaWQYAiABKAlSBmNvbnZJZB'
    'ISCgR0eXBlGAMgASgJUgR0eXBlEhQKBXRpdGxlGAQgASgJUgV0aXRsZRIdCgphdmF0YXJfY2lk'
    'GAUgASgJUglhdmF0YXJDaWQSFgoGcG9saWN5GAYgASgJUgZwb2xpY3kSFAoFZXBvY2gYByABKA'
    '1SBWVwb2NoEjkKCmNyZWF0ZWRfYXQYCCABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1w'
    'UgljcmVhdGVkQXQSOQoKdXBkYXRlZF9hdBgJIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3'
    'RhbXBSCXVwZGF0ZWRBdA==');

@$core.Deprecated('Use createConvResponseDescriptor instead')
const CreateConvResponse$json = {
  '1': 'CreateConvResponse',
  '2': [
    {
      '1': 'conv',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.message.v1.Conversation',
      '10': 'conv'
    },
  ],
};

/// Descriptor for `CreateConvResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createConvResponseDescriptor = $convert.base64Decode(
    'ChJDcmVhdGVDb252UmVzcG9uc2USPgoEY29udhgBIAEoCzIqLnBlZXJzX3RvdWNoLm1vZGVsLm'
    '1lc3NhZ2UudjEuQ29udmVyc2F0aW9uUgRjb252');

@$core.Deprecated('Use getConvRequestDescriptor instead')
const GetConvRequest$json = {
  '1': 'GetConvRequest',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
  ],
};

/// Descriptor for `GetConvRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getConvRequestDescriptor =
    $convert.base64Decode('Cg5HZXRDb252UmVxdWVzdBIOCgJpZBgBIAEoCVICaWQ=');

@$core.Deprecated('Use getConvResponseDescriptor instead')
const GetConvResponse$json = {
  '1': 'GetConvResponse',
  '2': [
    {
      '1': 'conv',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.message.v1.Conversation',
      '10': 'conv'
    },
  ],
};

/// Descriptor for `GetConvResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getConvResponseDescriptor = $convert.base64Decode(
    'Cg9HZXRDb252UmVzcG9uc2USPgoEY29udhgBIAEoCzIqLnBlZXJzX3RvdWNoLm1vZGVsLm1lc3'
    'NhZ2UudjEuQ29udmVyc2F0aW9uUgRjb252');

@$core.Deprecated('Use getConvStateRequestDescriptor instead')
const GetConvStateRequest$json = {
  '1': 'GetConvStateRequest',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
  ],
};

/// Descriptor for `GetConvStateRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getConvStateRequestDescriptor = $convert
    .base64Decode('ChNHZXRDb252U3RhdGVSZXF1ZXN0Eg4KAmlkGAEgASgJUgJpZA==');

@$core.Deprecated('Use getConvStateResponseDescriptor instead')
const GetConvStateResponse$json = {
  '1': 'GetConvStateResponse',
  '2': [
    {'1': 'epoch', '3': 1, '4': 1, '5': 13, '10': 'epoch'},
  ],
};

/// Descriptor for `GetConvStateResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getConvStateResponseDescriptor =
    $convert.base64Decode(
        'ChRHZXRDb252U3RhdGVSZXNwb25zZRIUCgVlcG9jaBgBIAEoDVIFZXBvY2g=');

@$core.Deprecated('Use updateMembersRequestDescriptor instead')
const UpdateMembersRequest$json = {
  '1': 'UpdateMembersRequest',
  '2': [
    {'1': 'conv_pk', '3': 1, '4': 1, '5': 4, '10': 'convPk'},
    {'1': 'add', '3': 2, '4': 3, '5': 9, '10': 'add'},
    {'1': 'remove', '3': 3, '4': 3, '5': 9, '10': 'remove'},
    {'1': 'role', '3': 4, '4': 1, '5': 9, '10': 'role'},
  ],
};

/// Descriptor for `UpdateMembersRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateMembersRequestDescriptor = $convert.base64Decode(
    'ChRVcGRhdGVNZW1iZXJzUmVxdWVzdBIXCgdjb252X3BrGAEgASgEUgZjb252UGsSEAoDYWRkGA'
    'IgAygJUgNhZGQSFgoGcmVtb3ZlGAMgAygJUgZyZW1vdmUSEgoEcm9sZRgEIAEoCVIEcm9sZQ==');

@$core.Deprecated('Use updateMembersResponseDescriptor instead')
const UpdateMembersResponse$json = {
  '1': 'UpdateMembersResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `UpdateMembersResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateMembersResponseDescriptor =
    $convert.base64Decode(
        'ChVVcGRhdGVNZW1iZXJzUmVzcG9uc2USGAoHc3VjY2VzcxgBIAEoCFIHc3VjY2Vzcw==');

@$core.Deprecated('Use getMembersRequestDescriptor instead')
const GetMembersRequest$json = {
  '1': 'GetMembersRequest',
  '2': [
    {'1': 'conv_id', '3': 1, '4': 1, '5': 9, '10': 'convId'},
  ],
};

/// Descriptor for `GetMembersRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMembersRequestDescriptor = $convert.base64Decode(
    'ChFHZXRNZW1iZXJzUmVxdWVzdBIXCgdjb252X2lkGAEgASgJUgZjb252SWQ=');

@$core.Deprecated('Use convMemberDescriptor instead')
const ConvMember$json = {
  '1': 'ConvMember',
  '2': [
    {'1': 'did', '3': 1, '4': 1, '5': 9, '10': 'did'},
    {'1': 'role', '3': 2, '4': 1, '5': 9, '10': 'role'},
    {
      '1': 'joined_at',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'joinedAt'
    },
  ],
};

/// Descriptor for `ConvMember`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List convMemberDescriptor = $convert.base64Decode(
    'CgpDb252TWVtYmVyEhAKA2RpZBgBIAEoCVIDZGlkEhIKBHJvbGUYAiABKAlSBHJvbGUSNwoJam'
    '9pbmVkX2F0GAMgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIIam9pbmVkQXQ=');

@$core.Deprecated('Use getMembersResponseDescriptor instead')
const GetMembersResponse$json = {
  '1': 'GetMembersResponse',
  '2': [
    {
      '1': 'members',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.message.v1.ConvMember',
      '10': 'members'
    },
  ],
};

/// Descriptor for `GetMembersResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMembersResponseDescriptor = $convert.base64Decode(
    'ChJHZXRNZW1iZXJzUmVzcG9uc2USQgoHbWVtYmVycxgBIAMoCzIoLnBlZXJzX3RvdWNoLm1vZG'
    'VsLm1lc3NhZ2UudjEuQ29udk1lbWJlclIHbWVtYmVycw==');

@$core.Deprecated('Use keyRotateRequestDescriptor instead')
const KeyRotateRequest$json = {
  '1': 'KeyRotateRequest',
  '2': [
    {'1': 'conv_id', '3': 1, '4': 1, '5': 9, '10': 'convId'},
    {'1': 'epoch', '3': 2, '4': 1, '5': 13, '10': 'epoch'},
    {
      '1': 'packages',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.message.v1.KeyPackage',
      '10': 'packages'
    },
  ],
};

/// Descriptor for `KeyRotateRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List keyRotateRequestDescriptor = $convert.base64Decode(
    'ChBLZXlSb3RhdGVSZXF1ZXN0EhcKB2NvbnZfaWQYASABKAlSBmNvbnZJZBIUCgVlcG9jaBgCIA'
    'EoDVIFZXBvY2gSRAoIcGFja2FnZXMYAyADKAsyKC5wZWVyc190b3VjaC5tb2RlbC5tZXNzYWdl'
    'LnYxLktleVBhY2thZ2VSCHBhY2thZ2Vz');

@$core.Deprecated('Use keyPackageDescriptor instead')
const KeyPackage$json = {
  '1': 'KeyPackage',
  '2': [
    {'1': 'did', '3': 1, '4': 1, '5': 9, '10': 'did'},
    {'1': 'package', '3': 2, '4': 1, '5': 12, '10': 'package'},
  ],
};

/// Descriptor for `KeyPackage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List keyPackageDescriptor = $convert.base64Decode(
    'CgpLZXlQYWNrYWdlEhAKA2RpZBgBIAEoCVIDZGlkEhgKB3BhY2thZ2UYAiABKAxSB3BhY2thZ2'
    'U=');

@$core.Deprecated('Use keyRotateResponseDescriptor instead')
const KeyRotateResponse$json = {
  '1': 'KeyRotateResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `KeyRotateResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List keyRotateResponseDescriptor = $convert.base64Decode(
    'ChFLZXlSb3RhdGVSZXNwb25zZRIYCgdzdWNjZXNzGAEgASgIUgdzdWNjZXNz');

@$core.Deprecated('Use appendMessageRequestDescriptor instead')
const AppendMessageRequest$json = {
  '1': 'AppendMessageRequest',
  '2': [
    {'1': 'conv_id', '3': 1, '4': 1, '5': 9, '10': 'convId'},
    {
      '1': 'encrypted_content',
      '3': 2,
      '4': 1,
      '5': 12,
      '10': 'encryptedContent'
    },
    {'1': 'timestamp', '3': 3, '4': 1, '5': 9, '10': 'timestamp'},
  ],
};

/// Descriptor for `AppendMessageRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List appendMessageRequestDescriptor = $convert.base64Decode(
    'ChRBcHBlbmRNZXNzYWdlUmVxdWVzdBIXCgdjb252X2lkGAEgASgJUgZjb252SWQSKwoRZW5jcn'
    'lwdGVkX2NvbnRlbnQYAiABKAxSEGVuY3J5cHRlZENvbnRlbnQSHAoJdGltZXN0YW1wGAMgASgJ'
    'Ugl0aW1lc3RhbXA=');

@$core.Deprecated('Use messageDescriptor instead')
const Message$json = {
  '1': 'Message',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 4, '10': 'id'},
    {'1': 'conv_id', '3': 2, '4': 1, '5': 9, '10': 'convId'},
    {'1': 'sender_did', '3': 3, '4': 1, '5': 9, '10': 'senderDid'},
    {
      '1': 'encrypted_content',
      '3': 4,
      '4': 1,
      '5': 12,
      '10': 'encryptedContent'
    },
    {'1': 'epoch', '3': 5, '4': 1, '5': 13, '10': 'epoch'},
    {
      '1': 'timestamp',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'timestamp'
    },
  ],
};

/// Descriptor for `Message`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List messageDescriptor = $convert.base64Decode(
    'CgdNZXNzYWdlEg4KAmlkGAEgASgEUgJpZBIXCgdjb252X2lkGAIgASgJUgZjb252SWQSHQoKc2'
    'VuZGVyX2RpZBgDIAEoCVIJc2VuZGVyRGlkEisKEWVuY3J5cHRlZF9jb250ZW50GAQgASgMUhBl'
    'bmNyeXB0ZWRDb250ZW50EhQKBWVwb2NoGAUgASgNUgVlcG9jaBI4Cgl0aW1lc3RhbXAYBiABKA'
    'syGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgl0aW1lc3RhbXA=');

@$core.Deprecated('Use appendMessageResponseDescriptor instead')
const AppendMessageResponse$json = {
  '1': 'AppendMessageResponse',
  '2': [
    {
      '1': 'message',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.message.v1.Message',
      '10': 'message'
    },
  ],
};

/// Descriptor for `AppendMessageResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List appendMessageResponseDescriptor = $convert.base64Decode(
    'ChVBcHBlbmRNZXNzYWdlUmVzcG9uc2USPwoHbWVzc2FnZRgBIAEoCzIlLnBlZXJzX3RvdWNoLm'
    '1vZGVsLm1lc3NhZ2UudjEuTWVzc2FnZVIHbWVzc2FnZQ==');

@$core.Deprecated('Use listMessagesRequestDescriptor instead')
const ListMessagesRequest$json = {
  '1': 'ListMessagesRequest',
  '2': [
    {'1': 'conv_id', '3': 1, '4': 1, '5': 9, '10': 'convId'},
    {'1': 'before_id', '3': 2, '4': 1, '5': 4, '10': 'beforeId'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `ListMessagesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMessagesRequestDescriptor = $convert.base64Decode(
    'ChNMaXN0TWVzc2FnZXNSZXF1ZXN0EhcKB2NvbnZfaWQYASABKAlSBmNvbnZJZBIbCgliZWZvcm'
    'VfaWQYAiABKARSCGJlZm9yZUlkEhQKBWxpbWl0GAMgASgFUgVsaW1pdA==');

@$core.Deprecated('Use listMessagesResponseDescriptor instead')
const ListMessagesResponse$json = {
  '1': 'ListMessagesResponse',
  '2': [
    {
      '1': 'messages',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.message.v1.Message',
      '10': 'messages'
    },
    {'1': 'has_more', '3': 2, '4': 1, '5': 8, '10': 'hasMore'},
  ],
};

/// Descriptor for `ListMessagesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMessagesResponseDescriptor = $convert.base64Decode(
    'ChRMaXN0TWVzc2FnZXNSZXNwb25zZRJBCghtZXNzYWdlcxgBIAMoCzIlLnBlZXJzX3RvdWNoLm'
    '1vZGVsLm1lc3NhZ2UudjEuTWVzc2FnZVIIbWVzc2FnZXMSGQoIaGFzX21vcmUYAiABKAhSB2hh'
    'c01vcmU=');

@$core.Deprecated('Use streamMessagesRequestDescriptor instead')
const StreamMessagesRequest$json = {
  '1': 'StreamMessagesRequest',
  '2': [
    {'1': 'conv_id', '3': 1, '4': 1, '5': 9, '10': 'convId'},
    {'1': 'since_id', '3': 2, '4': 1, '5': 4, '10': 'sinceId'},
  ],
};

/// Descriptor for `StreamMessagesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List streamMessagesRequestDescriptor = $convert.base64Decode(
    'ChVTdHJlYW1NZXNzYWdlc1JlcXVlc3QSFwoHY29udl9pZBgBIAEoCVIGY29udklkEhkKCHNpbm'
    'NlX2lkGAIgASgEUgdzaW5jZUlk');

@$core.Deprecated('Use streamMessagesResponseDescriptor instead')
const StreamMessagesResponse$json = {
  '1': 'StreamMessagesResponse',
  '2': [
    {
      '1': 'messages',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.message.v1.Message',
      '10': 'messages'
    },
  ],
};

/// Descriptor for `StreamMessagesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List streamMessagesResponseDescriptor =
    $convert.base64Decode(
        'ChZTdHJlYW1NZXNzYWdlc1Jlc3BvbnNlEkEKCG1lc3NhZ2VzGAEgAygLMiUucGVlcnNfdG91Y2'
        'gubW9kZWwubWVzc2FnZS52MS5NZXNzYWdlUghtZXNzYWdlcw==');

@$core.Deprecated('Use postReceiptRequestDescriptor instead')
const PostReceiptRequest$json = {
  '1': 'PostReceiptRequest',
  '2': [
    {'1': 'conv_id', '3': 1, '4': 1, '5': 9, '10': 'convId'},
    {'1': 'message_id', '3': 2, '4': 1, '5': 4, '10': 'messageId'},
    {'1': 'type', '3': 3, '4': 1, '5': 9, '10': 'type'},
  ],
};

/// Descriptor for `PostReceiptRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postReceiptRequestDescriptor = $convert.base64Decode(
    'ChJQb3N0UmVjZWlwdFJlcXVlc3QSFwoHY29udl9pZBgBIAEoCVIGY29udklkEh0KCm1lc3NhZ2'
    'VfaWQYAiABKARSCW1lc3NhZ2VJZBISCgR0eXBlGAMgASgJUgR0eXBl');

@$core.Deprecated('Use postReceiptResponseDescriptor instead')
const PostReceiptResponse$json = {
  '1': 'PostReceiptResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `PostReceiptResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postReceiptResponseDescriptor =
    $convert.base64Decode(
        'ChNQb3N0UmVjZWlwdFJlc3BvbnNlEhgKB3N1Y2Nlc3MYASABKAhSB3N1Y2Nlc3M=');

@$core.Deprecated('Use getReceiptsRequestDescriptor instead')
const GetReceiptsRequest$json = {
  '1': 'GetReceiptsRequest',
  '2': [
    {'1': 'conv_id', '3': 1, '4': 1, '5': 9, '10': 'convId'},
    {'1': 'message_id', '3': 2, '4': 1, '5': 4, '10': 'messageId'},
  ],
};

/// Descriptor for `GetReceiptsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getReceiptsRequestDescriptor = $convert.base64Decode(
    'ChJHZXRSZWNlaXB0c1JlcXVlc3QSFwoHY29udl9pZBgBIAEoCVIGY29udklkEh0KCm1lc3NhZ2'
    'VfaWQYAiABKARSCW1lc3NhZ2VJZA==');

@$core.Deprecated('Use receiptDescriptor instead')
const Receipt$json = {
  '1': 'Receipt',
  '2': [
    {'1': 'did', '3': 1, '4': 1, '5': 9, '10': 'did'},
    {'1': 'type', '3': 2, '4': 1, '5': 9, '10': 'type'},
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

/// Descriptor for `Receipt`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List receiptDescriptor = $convert.base64Decode(
    'CgdSZWNlaXB0EhAKA2RpZBgBIAEoCVIDZGlkEhIKBHR5cGUYAiABKAlSBHR5cGUSOAoJdGltZX'
    'N0YW1wGAMgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJdGltZXN0YW1w');

@$core.Deprecated('Use getReceiptsResponseDescriptor instead')
const GetReceiptsResponse$json = {
  '1': 'GetReceiptsResponse',
  '2': [
    {
      '1': 'receipts',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.message.v1.Receipt',
      '10': 'receipts'
    },
  ],
};

/// Descriptor for `GetReceiptsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getReceiptsResponseDescriptor = $convert.base64Decode(
    'ChNHZXRSZWNlaXB0c1Jlc3BvbnNlEkEKCHJlY2VpcHRzGAEgAygLMiUucGVlcnNfdG91Y2gubW'
    '9kZWwubWVzc2FnZS52MS5SZWNlaXB0UghyZWNlaXB0cw==');

@$core.Deprecated('Use postAttachmentRequestDescriptor instead')
const PostAttachmentRequest$json = {
  '1': 'PostAttachmentRequest',
  '2': [
    {'1': 'conv_id', '3': 1, '4': 1, '5': 9, '10': 'convId'},
    {'1': 'filename', '3': 2, '4': 1, '5': 9, '10': 'filename'},
    {'1': 'mime_type', '3': 3, '4': 1, '5': 9, '10': 'mimeType'},
    {'1': 'encrypted_data', '3': 4, '4': 1, '5': 12, '10': 'encryptedData'},
  ],
};

/// Descriptor for `PostAttachmentRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postAttachmentRequestDescriptor = $convert.base64Decode(
    'ChVQb3N0QXR0YWNobWVudFJlcXVlc3QSFwoHY29udl9pZBgBIAEoCVIGY29udklkEhoKCGZpbG'
    'VuYW1lGAIgASgJUghmaWxlbmFtZRIbCgltaW1lX3R5cGUYAyABKAlSCG1pbWVUeXBlEiUKDmVu'
    'Y3J5cHRlZF9kYXRhGAQgASgMUg1lbmNyeXB0ZWREYXRh');

@$core.Deprecated('Use attachmentDescriptor instead')
const Attachment$json = {
  '1': 'Attachment',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'filename', '3': 2, '4': 1, '5': 9, '10': 'filename'},
    {'1': 'mime_type', '3': 3, '4': 1, '5': 9, '10': 'mimeType'},
    {'1': 'size', '3': 4, '4': 1, '5': 3, '10': 'size'},
    {
      '1': 'uploaded_at',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'uploadedAt'
    },
  ],
};

/// Descriptor for `Attachment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List attachmentDescriptor = $convert.base64Decode(
    'CgpBdHRhY2htZW50Eg4KAmlkGAEgASgJUgJpZBIaCghmaWxlbmFtZRgCIAEoCVIIZmlsZW5hbW'
    'USGwoJbWltZV90eXBlGAMgASgJUghtaW1lVHlwZRISCgRzaXplGAQgASgDUgRzaXplEjsKC3Vw'
    'bG9hZGVkX2F0GAUgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIKdXBsb2FkZWRBdA'
    '==');

@$core.Deprecated('Use postAttachmentResponseDescriptor instead')
const PostAttachmentResponse$json = {
  '1': 'PostAttachmentResponse',
  '2': [
    {
      '1': 'attachment',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.message.v1.Attachment',
      '10': 'attachment'
    },
  ],
};

/// Descriptor for `PostAttachmentResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postAttachmentResponseDescriptor =
    $convert.base64Decode(
        'ChZQb3N0QXR0YWNobWVudFJlc3BvbnNlEkgKCmF0dGFjaG1lbnQYASABKAsyKC5wZWVyc190b3'
        'VjaC5tb2RlbC5tZXNzYWdlLnYxLkF0dGFjaG1lbnRSCmF0dGFjaG1lbnQ=');

@$core.Deprecated('Use getAttachmentRequestDescriptor instead')
const GetAttachmentRequest$json = {
  '1': 'GetAttachmentRequest',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
  ],
};

/// Descriptor for `GetAttachmentRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getAttachmentRequestDescriptor = $convert
    .base64Decode('ChRHZXRBdHRhY2htZW50UmVxdWVzdBIOCgJpZBgBIAEoCVICaWQ=');

@$core.Deprecated('Use getAttachmentResponseDescriptor instead')
const GetAttachmentResponse$json = {
  '1': 'GetAttachmentResponse',
  '2': [
    {
      '1': 'attachment',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.message.v1.Attachment',
      '10': 'attachment'
    },
    {'1': 'encrypted_data', '3': 2, '4': 1, '5': 12, '10': 'encryptedData'},
  ],
};

/// Descriptor for `GetAttachmentResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getAttachmentResponseDescriptor = $convert.base64Decode(
    'ChVHZXRBdHRhY2htZW50UmVzcG9uc2USSAoKYXR0YWNobWVudBgBIAEoCzIoLnBlZXJzX3RvdW'
    'NoLm1vZGVsLm1lc3NhZ2UudjEuQXR0YWNobWVudFIKYXR0YWNobWVudBIlCg5lbmNyeXB0ZWRf'
    'ZGF0YRgCIAEoDFINZW5jcnlwdGVkRGF0YQ==');

@$core.Deprecated('Use searchMessagesRequestDescriptor instead')
const SearchMessagesRequest$json = {
  '1': 'SearchMessagesRequest',
  '2': [
    {'1': 'conv_id', '3': 1, '4': 1, '5': 9, '10': 'convId'},
    {'1': 'query', '3': 2, '4': 1, '5': 9, '10': 'query'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `SearchMessagesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchMessagesRequestDescriptor = $convert.base64Decode(
    'ChVTZWFyY2hNZXNzYWdlc1JlcXVlc3QSFwoHY29udl9pZBgBIAEoCVIGY29udklkEhQKBXF1ZX'
    'J5GAIgASgJUgVxdWVyeRIUCgVsaW1pdBgDIAEoBVIFbGltaXQ=');

@$core.Deprecated('Use searchMessagesResponseDescriptor instead')
const SearchMessagesResponse$json = {
  '1': 'SearchMessagesResponse',
  '2': [
    {
      '1': 'messages',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.message.v1.Message',
      '10': 'messages'
    },
  ],
};

/// Descriptor for `SearchMessagesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchMessagesResponseDescriptor =
    $convert.base64Decode(
        'ChZTZWFyY2hNZXNzYWdlc1Jlc3BvbnNlEkEKCG1lc3NhZ2VzGAEgAygLMiUucGVlcnNfdG91Y2'
        'gubW9kZWwubWVzc2FnZS52MS5NZXNzYWdlUghtZXNzYWdlcw==');

@$core.Deprecated('Use getSnapshotRequestDescriptor instead')
const GetSnapshotRequest$json = {
  '1': 'GetSnapshotRequest',
  '2': [
    {'1': 'conv_id', '3': 1, '4': 1, '5': 9, '10': 'convId'},
  ],
};

/// Descriptor for `GetSnapshotRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getSnapshotRequestDescriptor =
    $convert.base64Decode(
        'ChJHZXRTbmFwc2hvdFJlcXVlc3QSFwoHY29udl9pZBgBIAEoCVIGY29udklk');

@$core.Deprecated('Use snapshotDescriptor instead')
const Snapshot$json = {
  '1': 'Snapshot',
  '2': [
    {'1': 'conv_id', '3': 1, '4': 1, '5': 9, '10': 'convId'},
    {'1': 'epoch', '3': 2, '4': 1, '5': 13, '10': 'epoch'},
    {'1': 'state_data', '3': 3, '4': 1, '5': 12, '10': 'stateData'},
    {
      '1': 'created_at',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
  ],
};

/// Descriptor for `Snapshot`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List snapshotDescriptor = $convert.base64Decode(
    'CghTbmFwc2hvdBIXCgdjb252X2lkGAEgASgJUgZjb252SWQSFAoFZXBvY2gYAiABKA1SBWVwb2'
    'NoEh0KCnN0YXRlX2RhdGEYAyABKAxSCXN0YXRlRGF0YRI5CgpjcmVhdGVkX2F0GAQgASgLMhou'
    'Z29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJY3JlYXRlZEF0');

@$core.Deprecated('Use getSnapshotResponseDescriptor instead')
const GetSnapshotResponse$json = {
  '1': 'GetSnapshotResponse',
  '2': [
    {
      '1': 'snapshot',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.message.v1.Snapshot',
      '10': 'snapshot'
    },
  ],
};

/// Descriptor for `GetSnapshotResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getSnapshotResponseDescriptor = $convert.base64Decode(
    'ChNHZXRTbmFwc2hvdFJlc3BvbnNlEkIKCHNuYXBzaG90GAEgASgLMiYucGVlcnNfdG91Y2gubW'
    '9kZWwubWVzc2FnZS52MS5TbmFwc2hvdFIIc25hcHNob3Q=');

@$core.Deprecated('Use postSnapshotRequestDescriptor instead')
const PostSnapshotRequest$json = {
  '1': 'PostSnapshotRequest',
  '2': [
    {'1': 'conv_id', '3': 1, '4': 1, '5': 9, '10': 'convId'},
    {'1': 'epoch', '3': 2, '4': 1, '5': 13, '10': 'epoch'},
    {'1': 'state_data', '3': 3, '4': 1, '5': 12, '10': 'stateData'},
  ],
};

/// Descriptor for `PostSnapshotRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postSnapshotRequestDescriptor = $convert.base64Decode(
    'ChNQb3N0U25hcHNob3RSZXF1ZXN0EhcKB2NvbnZfaWQYASABKAlSBmNvbnZJZBIUCgVlcG9jaB'
    'gCIAEoDVIFZXBvY2gSHQoKc3RhdGVfZGF0YRgDIAEoDFIJc3RhdGVEYXRh');

@$core.Deprecated('Use postSnapshotResponseDescriptor instead')
const PostSnapshotResponse$json = {
  '1': 'PostSnapshotResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `PostSnapshotResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postSnapshotResponseDescriptor =
    $convert.base64Decode(
        'ChRQb3N0U25hcHNob3RSZXNwb25zZRIYCgdzdWNjZXNzGAEgASgIUgdzdWNjZXNz');
