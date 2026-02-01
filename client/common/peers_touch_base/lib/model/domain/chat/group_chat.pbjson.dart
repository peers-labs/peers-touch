// This is a generated file - do not edit.
//
// Generated from domain/chat/group_chat.proto.

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

@$core.Deprecated('Use groupTypeDescriptor instead')
const GroupType$json = {
  '1': 'GroupType',
  '2': [
    {'1': 'GROUP_TYPE_UNSPECIFIED', '2': 0},
    {'1': 'GROUP_TYPE_NORMAL', '2': 1},
    {'1': 'GROUP_TYPE_ANNOUNCEMENT', '2': 2},
    {'1': 'GROUP_TYPE_DISCUSSION', '2': 3},
  ],
};

/// Descriptor for `GroupType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List groupTypeDescriptor = $convert.base64Decode(
    'CglHcm91cFR5cGUSGgoWR1JPVVBfVFlQRV9VTlNQRUNJRklFRBAAEhUKEUdST1VQX1RZUEVfTk'
    '9STUFMEAESGwoXR1JPVVBfVFlQRV9BTk5PVU5DRU1FTlQQAhIZChVHUk9VUF9UWVBFX0RJU0NV'
    'U1NJT04QAw==');

@$core.Deprecated('Use groupVisibilityDescriptor instead')
const GroupVisibility$json = {
  '1': 'GroupVisibility',
  '2': [
    {'1': 'GROUP_VISIBILITY_UNSPECIFIED', '2': 0},
    {'1': 'GROUP_VISIBILITY_PUBLIC', '2': 1},
    {'1': 'GROUP_VISIBILITY_PRIVATE', '2': 2},
  ],
};

/// Descriptor for `GroupVisibility`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List groupVisibilityDescriptor = $convert.base64Decode(
    'Cg9Hcm91cFZpc2liaWxpdHkSIAocR1JPVVBfVklTSUJJTElUWV9VTlNQRUNJRklFRBAAEhsKF0'
    'dST1VQX1ZJU0lCSUxJVFlfUFVCTElDEAESHAoYR1JPVVBfVklTSUJJTElUWV9QUklWQVRFEAI=');

@$core.Deprecated('Use groupRoleDescriptor instead')
const GroupRole$json = {
  '1': 'GroupRole',
  '2': [
    {'1': 'GROUP_ROLE_UNSPECIFIED', '2': 0},
    {'1': 'GROUP_ROLE_MEMBER', '2': 1},
    {'1': 'GROUP_ROLE_ADMIN', '2': 2},
    {'1': 'GROUP_ROLE_OWNER', '2': 3},
  ],
};

/// Descriptor for `GroupRole`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List groupRoleDescriptor = $convert.base64Decode(
    'CglHcm91cFJvbGUSGgoWR1JPVVBfUk9MRV9VTlNQRUNJRklFRBAAEhUKEUdST1VQX1JPTEVfTU'
    'VNQkVSEAESFAoQR1JPVVBfUk9MRV9BRE1JThACEhQKEEdST1VQX1JPTEVfT1dORVIQAw==');

@$core.Deprecated('Use groupMessageTypeDescriptor instead')
const GroupMessageType$json = {
  '1': 'GroupMessageType',
  '2': [
    {'1': 'GROUP_MESSAGE_TYPE_UNSPECIFIED', '2': 0},
    {'1': 'GROUP_MESSAGE_TYPE_TEXT', '2': 1},
    {'1': 'GROUP_MESSAGE_TYPE_IMAGE', '2': 2},
    {'1': 'GROUP_MESSAGE_TYPE_FILE', '2': 3},
    {'1': 'GROUP_MESSAGE_TYPE_AUDIO', '2': 4},
    {'1': 'GROUP_MESSAGE_TYPE_VIDEO', '2': 5},
    {'1': 'GROUP_MESSAGE_TYPE_SYSTEM', '2': 10},
  ],
};

/// Descriptor for `GroupMessageType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List groupMessageTypeDescriptor = $convert.base64Decode(
    'ChBHcm91cE1lc3NhZ2VUeXBlEiIKHkdST1VQX01FU1NBR0VfVFlQRV9VTlNQRUNJRklFRBAAEh'
    'sKF0dST1VQX01FU1NBR0VfVFlQRV9URVhUEAESHAoYR1JPVVBfTUVTU0FHRV9UWVBFX0lNQUdF'
    'EAISGwoXR1JPVVBfTUVTU0FHRV9UWVBFX0ZJTEUQAxIcChhHUk9VUF9NRVNTQUdFX1RZUEVfQV'
    'VESU8QBBIcChhHUk9VUF9NRVNTQUdFX1RZUEVfVklERU8QBRIdChlHUk9VUF9NRVNTQUdFX1RZ'
    'UEVfU1lTVEVNEAo=');

@$core.Deprecated('Use groupInvitationStatusDescriptor instead')
const GroupInvitationStatus$json = {
  '1': 'GroupInvitationStatus',
  '2': [
    {'1': 'GROUP_INVITATION_STATUS_UNSPECIFIED', '2': 0},
    {'1': 'GROUP_INVITATION_STATUS_PENDING', '2': 1},
    {'1': 'GROUP_INVITATION_STATUS_ACCEPTED', '2': 2},
    {'1': 'GROUP_INVITATION_STATUS_REJECTED', '2': 3},
    {'1': 'GROUP_INVITATION_STATUS_EXPIRED', '2': 4},
  ],
};

/// Descriptor for `GroupInvitationStatus`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List groupInvitationStatusDescriptor = $convert.base64Decode(
    'ChVHcm91cEludml0YXRpb25TdGF0dXMSJwojR1JPVVBfSU5WSVRBVElPTl9TVEFUVVNfVU5TUE'
    'VDSUZJRUQQABIjCh9HUk9VUF9JTlZJVEFUSU9OX1NUQVRVU19QRU5ESU5HEAESJAogR1JPVVBf'
    'SU5WSVRBVElPTl9TVEFUVVNfQUNDRVBURUQQAhIkCiBHUk9VUF9JTlZJVEFUSU9OX1NUQVRVU1'
    '9SRUpFQ1RFRBADEiMKH0dST1VQX0lOVklUQVRJT05fU1RBVFVTX0VYUElSRUQQBA==');

@$core.Deprecated('Use groupOfflineMessageStatusDescriptor instead')
const GroupOfflineMessageStatus$json = {
  '1': 'GroupOfflineMessageStatus',
  '2': [
    {'1': 'GROUP_OFFLINE_MESSAGE_STATUS_UNSPECIFIED', '2': 0},
    {'1': 'GROUP_OFFLINE_MESSAGE_STATUS_PENDING', '2': 1},
    {'1': 'GROUP_OFFLINE_MESSAGE_STATUS_DELIVERED', '2': 2},
    {'1': 'GROUP_OFFLINE_MESSAGE_STATUS_EXPIRED', '2': 3},
  ],
};

/// Descriptor for `GroupOfflineMessageStatus`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List groupOfflineMessageStatusDescriptor = $convert.base64Decode(
    'ChlHcm91cE9mZmxpbmVNZXNzYWdlU3RhdHVzEiwKKEdST1VQX09GRkxJTkVfTUVTU0FHRV9TVE'
    'FUVVNfVU5TUEVDSUZJRUQQABIoCiRHUk9VUF9PRkZMSU5FX01FU1NBR0VfU1RBVFVTX1BFTkRJ'
    'TkcQARIqCiZHUk9VUF9PRkZMSU5FX01FU1NBR0VfU1RBVFVTX0RFTElWRVJFRBACEigKJEdST1'
    'VQX09GRkxJTkVfTUVTU0FHRV9TVEFUVVNfRVhQSVJFRBAD');

@$core.Deprecated('Use groupDescriptor instead')
const Group$json = {
  '1': 'Group',
  '2': [
    {'1': 'ulid', '3': 1, '4': 1, '5': 9, '10': 'ulid'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'description', '3': 3, '4': 1, '5': 9, '10': 'description'},
    {'1': 'avatar_cid', '3': 4, '4': 1, '5': 9, '10': 'avatarCid'},
    {'1': 'owner_did', '3': 5, '4': 1, '5': 9, '10': 'ownerDid'},
    {
      '1': 'type',
      '3': 6,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.GroupType',
      '10': 'type'
    },
    {
      '1': 'visibility',
      '3': 7,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.GroupVisibility',
      '10': 'visibility'
    },
    {'1': 'member_count', '3': 8, '4': 1, '5': 5, '10': 'memberCount'},
    {'1': 'max_members', '3': 9, '4': 1, '5': 5, '10': 'maxMembers'},
    {'1': 'muted', '3': 10, '4': 1, '5': 8, '10': 'muted'},
    {
      '1': 'settings',
      '3': 11,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.Group.SettingsEntry',
      '10': 'settings'
    },
    {
      '1': 'created_at',
      '3': 12,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'updated_at',
      '3': 13,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
  ],
  '3': [Group_SettingsEntry$json],
};

@$core.Deprecated('Use groupDescriptor instead')
const Group_SettingsEntry$json = {
  '1': 'SettingsEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `Group`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List groupDescriptor = $convert.base64Decode(
    'CgVHcm91cBISCgR1bGlkGAEgASgJUgR1bGlkEhIKBG5hbWUYAiABKAlSBG5hbWUSIAoLZGVzY3'
    'JpcHRpb24YAyABKAlSC2Rlc2NyaXB0aW9uEh0KCmF2YXRhcl9jaWQYBCABKAlSCWF2YXRhckNp'
    'ZBIbCglvd25lcl9kaWQYBSABKAlSCG93bmVyRGlkEjgKBHR5cGUYBiABKA4yJC5wZWVyc190b3'
    'VjaC5tb2RlbC5jaGF0LnYxLkdyb3VwVHlwZVIEdHlwZRJKCgp2aXNpYmlsaXR5GAcgASgOMiou'
    'cGVlcnNfdG91Y2gubW9kZWwuY2hhdC52MS5Hcm91cFZpc2liaWxpdHlSCnZpc2liaWxpdHkSIQ'
    'oMbWVtYmVyX2NvdW50GAggASgFUgttZW1iZXJDb3VudBIfCgttYXhfbWVtYmVycxgJIAEoBVIK'
    'bWF4TWVtYmVycxIUCgVtdXRlZBgKIAEoCFIFbXV0ZWQSSgoIc2V0dGluZ3MYCyADKAsyLi5wZW'
    'Vyc190b3VjaC5tb2RlbC5jaGF0LnYxLkdyb3VwLlNldHRpbmdzRW50cnlSCHNldHRpbmdzEjkK'
    'CmNyZWF0ZWRfYXQYDCABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgljcmVhdGVkQX'
    'QSOQoKdXBkYXRlZF9hdBgNIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCXVwZGF0'
    'ZWRBdBo7Cg1TZXR0aW5nc0VudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbHVlGAIgASgJUg'
    'V2YWx1ZToCOAE=');

@$core.Deprecated('Use groupMemberDescriptor instead')
const GroupMember$json = {
  '1': 'GroupMember',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'actor_did', '3': 2, '4': 1, '5': 9, '10': 'actorDid'},
    {
      '1': 'role',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.GroupRole',
      '10': 'role'
    },
    {'1': 'nickname', '3': 4, '4': 1, '5': 9, '10': 'nickname'},
    {'1': 'muted', '3': 5, '4': 1, '5': 8, '10': 'muted'},
    {
      '1': 'muted_until',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'mutedUntil'
    },
    {
      '1': 'joined_at',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'joinedAt'
    },
    {'1': 'invited_by', '3': 8, '4': 1, '5': 9, '10': 'invitedBy'},
  ],
};

/// Descriptor for `GroupMember`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List groupMemberDescriptor = $convert.base64Decode(
    'CgtHcm91cE1lbWJlchIdCgpncm91cF91bGlkGAEgASgJUglncm91cFVsaWQSGwoJYWN0b3JfZG'
    'lkGAIgASgJUghhY3RvckRpZBI4CgRyb2xlGAMgASgOMiQucGVlcnNfdG91Y2gubW9kZWwuY2hh'
    'dC52MS5Hcm91cFJvbGVSBHJvbGUSGgoIbmlja25hbWUYBCABKAlSCG5pY2tuYW1lEhQKBW11dG'
    'VkGAUgASgIUgVtdXRlZBI7CgttdXRlZF91bnRpbBgGIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5U'
    'aW1lc3RhbXBSCm11dGVkVW50aWwSNwoJam9pbmVkX2F0GAcgASgLMhouZ29vZ2xlLnByb3RvYn'
    'VmLlRpbWVzdGFtcFIIam9pbmVkQXQSHQoKaW52aXRlZF9ieRgIIAEoCVIJaW52aXRlZEJ5');

@$core.Deprecated('Use groupMessageDescriptor instead')
const GroupMessage$json = {
  '1': 'GroupMessage',
  '2': [
    {'1': 'ulid', '3': 1, '4': 1, '5': 9, '10': 'ulid'},
    {'1': 'group_ulid', '3': 2, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'sender_did', '3': 3, '4': 1, '5': 9, '10': 'senderDid'},
    {
      '1': 'type',
      '3': 4,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.GroupMessageType',
      '10': 'type'
    },
    {'1': 'content', '3': 5, '4': 1, '5': 9, '10': 'content'},
    {
      '1': 'attachments',
      '3': 6,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupMessageAttachment',
      '10': 'attachments'
    },
    {'1': 'reply_to_ulid', '3': 7, '4': 1, '5': 9, '10': 'replyToUlid'},
    {'1': 'mentioned_dids', '3': 8, '4': 3, '5': 9, '10': 'mentionedDids'},
    {'1': 'mention_all', '3': 9, '4': 1, '5': 8, '10': 'mentionAll'},
    {
      '1': 'sent_at',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'sentAt'
    },
    {
      '1': 'created_at',
      '3': 11,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'updated_at',
      '3': 12,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
    {'1': 'deleted', '3': 13, '4': 1, '5': 8, '10': 'deleted'},
  ],
};

/// Descriptor for `GroupMessage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List groupMessageDescriptor = $convert.base64Decode(
    'CgxHcm91cE1lc3NhZ2USEgoEdWxpZBgBIAEoCVIEdWxpZBIdCgpncm91cF91bGlkGAIgASgJUg'
    'lncm91cFVsaWQSHQoKc2VuZGVyX2RpZBgDIAEoCVIJc2VuZGVyRGlkEj8KBHR5cGUYBCABKA4y'
    'Ky5wZWVyc190b3VjaC5tb2RlbC5jaGF0LnYxLkdyb3VwTWVzc2FnZVR5cGVSBHR5cGUSGAoHY2'
    '9udGVudBgFIAEoCVIHY29udGVudBJTCgthdHRhY2htZW50cxgGIAMoCzIxLnBlZXJzX3RvdWNo'
    'Lm1vZGVsLmNoYXQudjEuR3JvdXBNZXNzYWdlQXR0YWNobWVudFILYXR0YWNobWVudHMSIgoNcm'
    'VwbHlfdG9fdWxpZBgHIAEoCVILcmVwbHlUb1VsaWQSJQoObWVudGlvbmVkX2RpZHMYCCADKAlS'
    'DW1lbnRpb25lZERpZHMSHwoLbWVudGlvbl9hbGwYCSABKAhSCm1lbnRpb25BbGwSMwoHc2VudF'
    '9hdBgKIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSBnNlbnRBdBI5CgpjcmVhdGVk'
    'X2F0GAsgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJY3JlYXRlZEF0EjkKCnVwZG'
    'F0ZWRfYXQYDCABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgl1cGRhdGVkQXQSGAoH'
    'ZGVsZXRlZBgNIAEoCFIHZGVsZXRlZA==');

@$core.Deprecated('Use groupMessageAttachmentDescriptor instead')
const GroupMessageAttachment$json = {
  '1': 'GroupMessageAttachment',
  '2': [
    {'1': 'cid', '3': 1, '4': 1, '5': 9, '10': 'cid'},
    {'1': 'filename', '3': 2, '4': 1, '5': 9, '10': 'filename'},
    {'1': 'mime_type', '3': 3, '4': 1, '5': 9, '10': 'mimeType'},
    {'1': 'size', '3': 4, '4': 1, '5': 3, '10': 'size'},
    {'1': 'thumbnail_cid', '3': 5, '4': 1, '5': 9, '10': 'thumbnailCid'},
  ],
};

/// Descriptor for `GroupMessageAttachment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List groupMessageAttachmentDescriptor = $convert.base64Decode(
    'ChZHcm91cE1lc3NhZ2VBdHRhY2htZW50EhAKA2NpZBgBIAEoCVIDY2lkEhoKCGZpbGVuYW1lGA'
    'IgASgJUghmaWxlbmFtZRIbCgltaW1lX3R5cGUYAyABKAlSCG1pbWVUeXBlEhIKBHNpemUYBCAB'
    'KANSBHNpemUSIwoNdGh1bWJuYWlsX2NpZBgFIAEoCVIMdGh1bWJuYWlsQ2lk');

@$core.Deprecated('Use groupInvitationDescriptor instead')
const GroupInvitation$json = {
  '1': 'GroupInvitation',
  '2': [
    {'1': 'ulid', '3': 1, '4': 1, '5': 9, '10': 'ulid'},
    {'1': 'group_ulid', '3': 2, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'inviter_did', '3': 3, '4': 1, '5': 9, '10': 'inviterDid'},
    {'1': 'invitee_did', '3': 4, '4': 1, '5': 9, '10': 'inviteeDid'},
    {
      '1': 'status',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.GroupInvitationStatus',
      '10': 'status'
    },
    {
      '1': 'expire_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'expireAt'
    },
    {
      '1': 'created_at',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
  ],
};

/// Descriptor for `GroupInvitation`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List groupInvitationDescriptor = $convert.base64Decode(
    'Cg9Hcm91cEludml0YXRpb24SEgoEdWxpZBgBIAEoCVIEdWxpZBIdCgpncm91cF91bGlkGAIgAS'
    'gJUglncm91cFVsaWQSHwoLaW52aXRlcl9kaWQYAyABKAlSCmludml0ZXJEaWQSHwoLaW52aXRl'
    'ZV9kaWQYBCABKAlSCmludml0ZWVEaWQSSAoGc3RhdHVzGAUgASgOMjAucGVlcnNfdG91Y2gubW'
    '9kZWwuY2hhdC52MS5Hcm91cEludml0YXRpb25TdGF0dXNSBnN0YXR1cxI3CglleHBpcmVfYXQY'
    'BiABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUghleHBpcmVBdBI5CgpjcmVhdGVkX2'
    'F0GAcgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJY3JlYXRlZEF0');

@$core.Deprecated('Use createGroupRequestDescriptor instead')
const CreateGroupRequest$json = {
  '1': 'CreateGroupRequest',
  '2': [
    {'1': 'name', '3': 1, '4': 1, '5': 9, '10': 'name'},
    {'1': 'description', '3': 2, '4': 1, '5': 9, '10': 'description'},
    {
      '1': 'type',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.GroupType',
      '10': 'type'
    },
    {
      '1': 'visibility',
      '3': 4,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.GroupVisibility',
      '10': 'visibility'
    },
    {
      '1': 'initial_member_dids',
      '3': 5,
      '4': 3,
      '5': 9,
      '10': 'initialMemberDids'
    },
  ],
};

/// Descriptor for `CreateGroupRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createGroupRequestDescriptor = $convert.base64Decode(
    'ChJDcmVhdGVHcm91cFJlcXVlc3QSEgoEbmFtZRgBIAEoCVIEbmFtZRIgCgtkZXNjcmlwdGlvbh'
    'gCIAEoCVILZGVzY3JpcHRpb24SOAoEdHlwZRgDIAEoDjIkLnBlZXJzX3RvdWNoLm1vZGVsLmNo'
    'YXQudjEuR3JvdXBUeXBlUgR0eXBlEkoKCnZpc2liaWxpdHkYBCABKA4yKi5wZWVyc190b3VjaC'
    '5tb2RlbC5jaGF0LnYxLkdyb3VwVmlzaWJpbGl0eVIKdmlzaWJpbGl0eRIuChNpbml0aWFsX21l'
    'bWJlcl9kaWRzGAUgAygJUhFpbml0aWFsTWVtYmVyRGlkcw==');

@$core.Deprecated('Use createGroupResponseDescriptor instead')
const CreateGroupResponse$json = {
  '1': 'CreateGroupResponse',
  '2': [
    {
      '1': 'group',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.Group',
      '10': 'group'
    },
  ],
};

/// Descriptor for `CreateGroupResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createGroupResponseDescriptor = $convert.base64Decode(
    'ChNDcmVhdGVHcm91cFJlc3BvbnNlEjYKBWdyb3VwGAEgASgLMiAucGVlcnNfdG91Y2gubW9kZW'
    'wuY2hhdC52MS5Hcm91cFIFZ3JvdXA=');

@$core.Deprecated('Use listGroupsRequestDescriptor instead')
const ListGroupsRequest$json = {
  '1': 'ListGroupsRequest',
  '2': [
    {'1': 'limit', '3': 1, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'offset', '3': 2, '4': 1, '5': 5, '10': 'offset'},
  ],
};

/// Descriptor for `ListGroupsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listGroupsRequestDescriptor = $convert.base64Decode(
    'ChFMaXN0R3JvdXBzUmVxdWVzdBIUCgVsaW1pdBgBIAEoBVIFbGltaXQSFgoGb2Zmc2V0GAIgAS'
    'gFUgZvZmZzZXQ=');

@$core.Deprecated('Use listGroupsResponseDescriptor instead')
const ListGroupsResponse$json = {
  '1': 'ListGroupsResponse',
  '2': [
    {
      '1': 'groups',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.Group',
      '10': 'groups'
    },
    {'1': 'total', '3': 2, '4': 1, '5': 5, '10': 'total'},
  ],
};

/// Descriptor for `ListGroupsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listGroupsResponseDescriptor = $convert.base64Decode(
    'ChJMaXN0R3JvdXBzUmVzcG9uc2USOAoGZ3JvdXBzGAEgAygLMiAucGVlcnNfdG91Y2gubW9kZW'
    'wuY2hhdC52MS5Hcm91cFIGZ3JvdXBzEhQKBXRvdGFsGAIgASgFUgV0b3RhbA==');

@$core.Deprecated('Use getGroupRequestDescriptor instead')
const GetGroupRequest$json = {
  '1': 'GetGroupRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
  ],
};

/// Descriptor for `GetGroupRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getGroupRequestDescriptor = $convert.base64Decode(
    'Cg9HZXRHcm91cFJlcXVlc3QSHQoKZ3JvdXBfdWxpZBgBIAEoCVIJZ3JvdXBVbGlk');

@$core.Deprecated('Use getGroupResponseDescriptor instead')
const GetGroupResponse$json = {
  '1': 'GetGroupResponse',
  '2': [
    {
      '1': 'group',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.Group',
      '10': 'group'
    },
    {
      '1': 'my_membership',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupMember',
      '10': 'myMembership'
    },
  ],
};

/// Descriptor for `GetGroupResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getGroupResponseDescriptor = $convert.base64Decode(
    'ChBHZXRHcm91cFJlc3BvbnNlEjYKBWdyb3VwGAEgASgLMiAucGVlcnNfdG91Y2gubW9kZWwuY2'
    'hhdC52MS5Hcm91cFIFZ3JvdXASSwoNbXlfbWVtYmVyc2hpcBgCIAEoCzImLnBlZXJzX3RvdWNo'
    'Lm1vZGVsLmNoYXQudjEuR3JvdXBNZW1iZXJSDG15TWVtYmVyc2hpcA==');

@$core.Deprecated('Use updateGroupRequestDescriptor instead')
const UpdateGroupRequest$json = {
  '1': 'UpdateGroupRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '9': 0, '10': 'name', '17': true},
    {
      '1': 'description',
      '3': 3,
      '4': 1,
      '5': 9,
      '9': 1,
      '10': 'description',
      '17': true
    },
    {
      '1': 'avatar_cid',
      '3': 4,
      '4': 1,
      '5': 9,
      '9': 2,
      '10': 'avatarCid',
      '17': true
    },
    {
      '1': 'type',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.GroupType',
      '9': 3,
      '10': 'type',
      '17': true
    },
    {
      '1': 'visibility',
      '3': 6,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.GroupVisibility',
      '9': 4,
      '10': 'visibility',
      '17': true
    },
    {'1': 'muted', '3': 7, '4': 1, '5': 8, '9': 5, '10': 'muted', '17': true},
  ],
  '8': [
    {'1': '_name'},
    {'1': '_description'},
    {'1': '_avatar_cid'},
    {'1': '_type'},
    {'1': '_visibility'},
    {'1': '_muted'},
  ],
};

/// Descriptor for `UpdateGroupRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateGroupRequestDescriptor = $convert.base64Decode(
    'ChJVcGRhdGVHcm91cFJlcXVlc3QSHQoKZ3JvdXBfdWxpZBgBIAEoCVIJZ3JvdXBVbGlkEhcKBG'
    '5hbWUYAiABKAlIAFIEbmFtZYgBARIlCgtkZXNjcmlwdGlvbhgDIAEoCUgBUgtkZXNjcmlwdGlv'
    'bogBARIiCgphdmF0YXJfY2lkGAQgASgJSAJSCWF2YXRhckNpZIgBARI9CgR0eXBlGAUgASgOMi'
    'QucGVlcnNfdG91Y2gubW9kZWwuY2hhdC52MS5Hcm91cFR5cGVIA1IEdHlwZYgBARJPCgp2aXNp'
    'YmlsaXR5GAYgASgOMioucGVlcnNfdG91Y2gubW9kZWwuY2hhdC52MS5Hcm91cFZpc2liaWxpdH'
    'lIBFIKdmlzaWJpbGl0eYgBARIZCgVtdXRlZBgHIAEoCEgFUgVtdXRlZIgBAUIHCgVfbmFtZUIO'
    'CgxfZGVzY3JpcHRpb25CDQoLX2F2YXRhcl9jaWRCBwoFX3R5cGVCDQoLX3Zpc2liaWxpdHlCCA'
    'oGX211dGVk');

@$core.Deprecated('Use updateGroupResponseDescriptor instead')
const UpdateGroupResponse$json = {
  '1': 'UpdateGroupResponse',
  '2': [
    {
      '1': 'group',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.Group',
      '10': 'group'
    },
  ],
};

/// Descriptor for `UpdateGroupResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateGroupResponseDescriptor = $convert.base64Decode(
    'ChNVcGRhdGVHcm91cFJlc3BvbnNlEjYKBWdyb3VwGAEgASgLMiAucGVlcnNfdG91Y2gubW9kZW'
    'wuY2hhdC52MS5Hcm91cFIFZ3JvdXA=');

@$core.Deprecated('Use inviteToGroupRequestDescriptor instead')
const InviteToGroupRequest$json = {
  '1': 'InviteToGroupRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'invitee_dids', '3': 2, '4': 3, '5': 9, '10': 'inviteeDids'},
  ],
};

/// Descriptor for `InviteToGroupRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List inviteToGroupRequestDescriptor = $convert.base64Decode(
    'ChRJbnZpdGVUb0dyb3VwUmVxdWVzdBIdCgpncm91cF91bGlkGAEgASgJUglncm91cFVsaWQSIQ'
    'oMaW52aXRlZV9kaWRzGAIgAygJUgtpbnZpdGVlRGlkcw==');

@$core.Deprecated('Use inviteToGroupResponseDescriptor instead')
const InviteToGroupResponse$json = {
  '1': 'InviteToGroupResponse',
  '2': [
    {
      '1': 'invitations',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupInvitation',
      '10': 'invitations'
    },
  ],
};

/// Descriptor for `InviteToGroupResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List inviteToGroupResponseDescriptor = $convert.base64Decode(
    'ChVJbnZpdGVUb0dyb3VwUmVzcG9uc2USTAoLaW52aXRhdGlvbnMYASADKAsyKi5wZWVyc190b3'
    'VjaC5tb2RlbC5jaGF0LnYxLkdyb3VwSW52aXRhdGlvblILaW52aXRhdGlvbnM=');

@$core.Deprecated('Use joinGroupRequestDescriptor instead')
const JoinGroupRequest$json = {
  '1': 'JoinGroupRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'invitation_ulid', '3': 2, '4': 1, '5': 9, '10': 'invitationUlid'},
  ],
};

/// Descriptor for `JoinGroupRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List joinGroupRequestDescriptor = $convert.base64Decode(
    'ChBKb2luR3JvdXBSZXF1ZXN0Eh0KCmdyb3VwX3VsaWQYASABKAlSCWdyb3VwVWxpZBInCg9pbn'
    'ZpdGF0aW9uX3VsaWQYAiABKAlSDmludml0YXRpb25VbGlk');

@$core.Deprecated('Use joinGroupResponseDescriptor instead')
const JoinGroupResponse$json = {
  '1': 'JoinGroupResponse',
  '2': [
    {
      '1': 'membership',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupMember',
      '10': 'membership'
    },
  ],
};

/// Descriptor for `JoinGroupResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List joinGroupResponseDescriptor = $convert.base64Decode(
    'ChFKb2luR3JvdXBSZXNwb25zZRJGCgptZW1iZXJzaGlwGAEgASgLMiYucGVlcnNfdG91Y2gubW'
    '9kZWwuY2hhdC52MS5Hcm91cE1lbWJlclIKbWVtYmVyc2hpcA==');

@$core.Deprecated('Use leaveGroupRequestDescriptor instead')
const LeaveGroupRequest$json = {
  '1': 'LeaveGroupRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
  ],
};

/// Descriptor for `LeaveGroupRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List leaveGroupRequestDescriptor = $convert.base64Decode(
    'ChFMZWF2ZUdyb3VwUmVxdWVzdBIdCgpncm91cF91bGlkGAEgASgJUglncm91cFVsaWQ=');

@$core.Deprecated('Use leaveGroupResponseDescriptor instead')
const LeaveGroupResponse$json = {
  '1': 'LeaveGroupResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `LeaveGroupResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List leaveGroupResponseDescriptor =
    $convert.base64Decode(
        'ChJMZWF2ZUdyb3VwUmVzcG9uc2USGAoHc3VjY2VzcxgBIAEoCFIHc3VjY2Vzcw==');

@$core.Deprecated('Use getGroupMembersRequestDescriptor instead')
const GetGroupMembersRequest$json = {
  '1': 'GetGroupMembersRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'offset', '3': 3, '4': 1, '5': 5, '10': 'offset'},
  ],
};

/// Descriptor for `GetGroupMembersRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getGroupMembersRequestDescriptor =
    $convert.base64Decode(
        'ChZHZXRHcm91cE1lbWJlcnNSZXF1ZXN0Eh0KCmdyb3VwX3VsaWQYASABKAlSCWdyb3VwVWxpZB'
        'IUCgVsaW1pdBgCIAEoBVIFbGltaXQSFgoGb2Zmc2V0GAMgASgFUgZvZmZzZXQ=');

@$core.Deprecated('Use getGroupMembersResponseDescriptor instead')
const GetGroupMembersResponse$json = {
  '1': 'GetGroupMembersResponse',
  '2': [
    {
      '1': 'members',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupMember',
      '10': 'members'
    },
    {'1': 'total', '3': 2, '4': 1, '5': 5, '10': 'total'},
  ],
};

/// Descriptor for `GetGroupMembersResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getGroupMembersResponseDescriptor = $convert.base64Decode(
    'ChdHZXRHcm91cE1lbWJlcnNSZXNwb25zZRJACgdtZW1iZXJzGAEgAygLMiYucGVlcnNfdG91Y2'
    'gubW9kZWwuY2hhdC52MS5Hcm91cE1lbWJlclIHbWVtYmVycxIUCgV0b3RhbBgCIAEoBVIFdG90'
    'YWw=');

@$core.Deprecated('Use updateMemberRequestDescriptor instead')
const UpdateMemberRequest$json = {
  '1': 'UpdateMemberRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'actor_did', '3': 2, '4': 1, '5': 9, '10': 'actorDid'},
    {
      '1': 'role',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.GroupRole',
      '9': 0,
      '10': 'role',
      '17': true
    },
    {'1': 'muted', '3': 4, '4': 1, '5': 8, '9': 1, '10': 'muted', '17': true},
    {
      '1': 'muted_until',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '9': 2,
      '10': 'mutedUntil',
      '17': true
    },
  ],
  '8': [
    {'1': '_role'},
    {'1': '_muted'},
    {'1': '_muted_until'},
  ],
};

/// Descriptor for `UpdateMemberRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateMemberRequestDescriptor = $convert.base64Decode(
    'ChNVcGRhdGVNZW1iZXJSZXF1ZXN0Eh0KCmdyb3VwX3VsaWQYASABKAlSCWdyb3VwVWxpZBIbCg'
    'lhY3Rvcl9kaWQYAiABKAlSCGFjdG9yRGlkEj0KBHJvbGUYAyABKA4yJC5wZWVyc190b3VjaC5t'
    'b2RlbC5jaGF0LnYxLkdyb3VwUm9sZUgAUgRyb2xliAEBEhkKBW11dGVkGAQgASgISAFSBW11dG'
    'VkiAEBEkAKC211dGVkX3VudGlsGAUgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcEgC'
    'UgptdXRlZFVudGlsiAEBQgcKBV9yb2xlQggKBl9tdXRlZEIOCgxfbXV0ZWRfdW50aWw=');

@$core.Deprecated('Use updateMemberResponseDescriptor instead')
const UpdateMemberResponse$json = {
  '1': 'UpdateMemberResponse',
  '2': [
    {
      '1': 'member',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupMember',
      '10': 'member'
    },
  ],
};

/// Descriptor for `UpdateMemberResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateMemberResponseDescriptor = $convert.base64Decode(
    'ChRVcGRhdGVNZW1iZXJSZXNwb25zZRI+CgZtZW1iZXIYASABKAsyJi5wZWVyc190b3VjaC5tb2'
    'RlbC5jaGF0LnYxLkdyb3VwTWVtYmVyUgZtZW1iZXI=');

@$core.Deprecated('Use removeMemberRequestDescriptor instead')
const RemoveMemberRequest$json = {
  '1': 'RemoveMemberRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'actor_did', '3': 2, '4': 1, '5': 9, '10': 'actorDid'},
  ],
};

/// Descriptor for `RemoveMemberRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List removeMemberRequestDescriptor = $convert.base64Decode(
    'ChNSZW1vdmVNZW1iZXJSZXF1ZXN0Eh0KCmdyb3VwX3VsaWQYASABKAlSCWdyb3VwVWxpZBIbCg'
    'lhY3Rvcl9kaWQYAiABKAlSCGFjdG9yRGlk');

@$core.Deprecated('Use removeMemberResponseDescriptor instead')
const RemoveMemberResponse$json = {
  '1': 'RemoveMemberResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `RemoveMemberResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List removeMemberResponseDescriptor =
    $convert.base64Decode(
        'ChRSZW1vdmVNZW1iZXJSZXNwb25zZRIYCgdzdWNjZXNzGAEgASgIUgdzdWNjZXNz');

@$core.Deprecated('Use sendGroupMessageRequestDescriptor instead')
const SendGroupMessageRequest$json = {
  '1': 'SendGroupMessageRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {
      '1': 'type',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.GroupMessageType',
      '10': 'type'
    },
    {'1': 'content', '3': 3, '4': 1, '5': 9, '10': 'content'},
    {
      '1': 'attachments',
      '3': 4,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupMessageAttachment',
      '10': 'attachments'
    },
    {'1': 'reply_to_ulid', '3': 5, '4': 1, '5': 9, '10': 'replyToUlid'},
    {'1': 'mentioned_dids', '3': 6, '4': 3, '5': 9, '10': 'mentionedDids'},
    {'1': 'mention_all', '3': 7, '4': 1, '5': 8, '10': 'mentionAll'},
  ],
};

/// Descriptor for `SendGroupMessageRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List sendGroupMessageRequestDescriptor = $convert.base64Decode(
    'ChdTZW5kR3JvdXBNZXNzYWdlUmVxdWVzdBIdCgpncm91cF91bGlkGAEgASgJUglncm91cFVsaW'
    'QSPwoEdHlwZRgCIAEoDjIrLnBlZXJzX3RvdWNoLm1vZGVsLmNoYXQudjEuR3JvdXBNZXNzYWdl'
    'VHlwZVIEdHlwZRIYCgdjb250ZW50GAMgASgJUgdjb250ZW50ElMKC2F0dGFjaG1lbnRzGAQgAy'
    'gLMjEucGVlcnNfdG91Y2gubW9kZWwuY2hhdC52MS5Hcm91cE1lc3NhZ2VBdHRhY2htZW50Ugth'
    'dHRhY2htZW50cxIiCg1yZXBseV90b191bGlkGAUgASgJUgtyZXBseVRvVWxpZBIlCg5tZW50aW'
    '9uZWRfZGlkcxgGIAMoCVINbWVudGlvbmVkRGlkcxIfCgttZW50aW9uX2FsbBgHIAEoCFIKbWVu'
    'dGlvbkFsbA==');

@$core.Deprecated('Use sendGroupMessageResponseDescriptor instead')
const SendGroupMessageResponse$json = {
  '1': 'SendGroupMessageResponse',
  '2': [
    {
      '1': 'message',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupMessage',
      '10': 'message'
    },
  ],
};

/// Descriptor for `SendGroupMessageResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List sendGroupMessageResponseDescriptor =
    $convert.base64Decode(
        'ChhTZW5kR3JvdXBNZXNzYWdlUmVzcG9uc2USQQoHbWVzc2FnZRgBIAEoCzInLnBlZXJzX3RvdW'
        'NoLm1vZGVsLmNoYXQudjEuR3JvdXBNZXNzYWdlUgdtZXNzYWdl');

@$core.Deprecated('Use getGroupMessagesRequestDescriptor instead')
const GetGroupMessagesRequest$json = {
  '1': 'GetGroupMessagesRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'before_ulid', '3': 2, '4': 1, '5': 9, '10': 'beforeUlid'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `GetGroupMessagesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getGroupMessagesRequestDescriptor = $convert.base64Decode(
    'ChdHZXRHcm91cE1lc3NhZ2VzUmVxdWVzdBIdCgpncm91cF91bGlkGAEgASgJUglncm91cFVsaW'
    'QSHwoLYmVmb3JlX3VsaWQYAiABKAlSCmJlZm9yZVVsaWQSFAoFbGltaXQYAyABKAVSBWxpbWl0');

@$core.Deprecated('Use getGroupMessagesResponseDescriptor instead')
const GetGroupMessagesResponse$json = {
  '1': 'GetGroupMessagesResponse',
  '2': [
    {
      '1': 'messages',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupMessage',
      '10': 'messages'
    },
    {'1': 'has_more', '3': 2, '4': 1, '5': 8, '10': 'hasMore'},
  ],
};

/// Descriptor for `GetGroupMessagesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getGroupMessagesResponseDescriptor = $convert.base64Decode(
    'ChhHZXRHcm91cE1lc3NhZ2VzUmVzcG9uc2USQwoIbWVzc2FnZXMYASADKAsyJy5wZWVyc190b3'
    'VjaC5tb2RlbC5jaGF0LnYxLkdyb3VwTWVzc2FnZVIIbWVzc2FnZXMSGQoIaGFzX21vcmUYAiAB'
    'KAhSB2hhc01vcmU=');

@$core.Deprecated('Use recallGroupMessageRequestDescriptor instead')
const RecallGroupMessageRequest$json = {
  '1': 'RecallGroupMessageRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'message_ulid', '3': 2, '4': 1, '5': 9, '10': 'messageUlid'},
  ],
};

/// Descriptor for `RecallGroupMessageRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List recallGroupMessageRequestDescriptor =
    $convert.base64Decode(
        'ChlSZWNhbGxHcm91cE1lc3NhZ2VSZXF1ZXN0Eh0KCmdyb3VwX3VsaWQYASABKAlSCWdyb3VwVW'
        'xpZBIhCgxtZXNzYWdlX3VsaWQYAiABKAlSC21lc3NhZ2VVbGlk');

@$core.Deprecated('Use recallGroupMessageResponseDescriptor instead')
const RecallGroupMessageResponse$json = {
  '1': 'RecallGroupMessageResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `RecallGroupMessageResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List recallGroupMessageResponseDescriptor =
    $convert.base64Decode(
        'ChpSZWNhbGxHcm91cE1lc3NhZ2VSZXNwb25zZRIYCgdzdWNjZXNzGAEgASgIUgdzdWNjZXNz');

@$core.Deprecated('Use groupOfflineMessageDescriptor instead')
const GroupOfflineMessage$json = {
  '1': 'GroupOfflineMessage',
  '2': [
    {'1': 'ulid', '3': 1, '4': 1, '5': 9, '10': 'ulid'},
    {'1': 'group_ulid', '3': 2, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'receiver_did', '3': 3, '4': 1, '5': 9, '10': 'receiverDid'},
    {'1': 'message_ulid', '3': 4, '4': 1, '5': 9, '10': 'messageUlid'},
    {
      '1': 'status',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.chat.v1.GroupOfflineMessageStatus',
      '10': 'status'
    },
    {
      '1': 'expire_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'expireAt'
    },
    {
      '1': 'delivered_at',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'deliveredAt'
    },
    {
      '1': 'created_at',
      '3': 8,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
  ],
};

/// Descriptor for `GroupOfflineMessage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List groupOfflineMessageDescriptor = $convert.base64Decode(
    'ChNHcm91cE9mZmxpbmVNZXNzYWdlEhIKBHVsaWQYASABKAlSBHVsaWQSHQoKZ3JvdXBfdWxpZB'
    'gCIAEoCVIJZ3JvdXBVbGlkEiEKDHJlY2VpdmVyX2RpZBgDIAEoCVILcmVjZWl2ZXJEaWQSIQoM'
    'bWVzc2FnZV91bGlkGAQgASgJUgttZXNzYWdlVWxpZBJMCgZzdGF0dXMYBSABKA4yNC5wZWVyc1'
    '90b3VjaC5tb2RlbC5jaGF0LnYxLkdyb3VwT2ZmbGluZU1lc3NhZ2VTdGF0dXNSBnN0YXR1cxI3'
    'CglleHBpcmVfYXQYBiABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUghleHBpcmVBdB'
    'I9CgxkZWxpdmVyZWRfYXQYByABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgtkZWxp'
    'dmVyZWRBdBI5CgpjcmVhdGVkX2F0GAggASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcF'
    'IJY3JlYXRlZEF0');

@$core.Deprecated('Use updateMyNicknameRequestDescriptor instead')
const UpdateMyNicknameRequest$json = {
  '1': 'UpdateMyNicknameRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'nickname', '3': 2, '4': 1, '5': 9, '10': 'nickname'},
  ],
};

/// Descriptor for `UpdateMyNicknameRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateMyNicknameRequestDescriptor =
    $convert.base64Decode(
        'ChdVcGRhdGVNeU5pY2tuYW1lUmVxdWVzdBIdCgpncm91cF91bGlkGAEgASgJUglncm91cFVsaW'
        'QSGgoIbmlja25hbWUYAiABKAlSCG5pY2tuYW1l');

@$core.Deprecated('Use updateMyNicknameResponseDescriptor instead')
const UpdateMyNicknameResponse$json = {
  '1': 'UpdateMyNicknameResponse',
  '2': [
    {
      '1': 'member',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupMember',
      '10': 'member'
    },
  ],
};

/// Descriptor for `UpdateMyNicknameResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateMyNicknameResponseDescriptor =
    $convert.base64Decode(
        'ChhVcGRhdGVNeU5pY2tuYW1lUmVzcG9uc2USPgoGbWVtYmVyGAEgASgLMiYucGVlcnNfdG91Y2'
        'gubW9kZWwuY2hhdC52MS5Hcm91cE1lbWJlclIGbWVtYmVy');

@$core.Deprecated('Use searchGroupMessagesRequestDescriptor instead')
const SearchGroupMessagesRequest$json = {
  '1': 'SearchGroupMessagesRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'query', '3': 2, '4': 1, '5': 9, '10': 'query'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'before_ulid', '3': 4, '4': 1, '5': 9, '10': 'beforeUlid'},
  ],
};

/// Descriptor for `SearchGroupMessagesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchGroupMessagesRequestDescriptor =
    $convert.base64Decode(
        'ChpTZWFyY2hHcm91cE1lc3NhZ2VzUmVxdWVzdBIdCgpncm91cF91bGlkGAEgASgJUglncm91cF'
        'VsaWQSFAoFcXVlcnkYAiABKAlSBXF1ZXJ5EhQKBWxpbWl0GAMgASgFUgVsaW1pdBIfCgtiZWZv'
        'cmVfdWxpZBgEIAEoCVIKYmVmb3JlVWxpZA==');

@$core.Deprecated('Use searchGroupMessagesResponseDescriptor instead')
const SearchGroupMessagesResponse$json = {
  '1': 'SearchGroupMessagesResponse',
  '2': [
    {
      '1': 'messages',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupMessage',
      '10': 'messages'
    },
    {'1': 'has_more', '3': 2, '4': 1, '5': 8, '10': 'hasMore'},
  ],
};

/// Descriptor for `SearchGroupMessagesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchGroupMessagesResponseDescriptor =
    $convert.base64Decode(
        'ChtTZWFyY2hHcm91cE1lc3NhZ2VzUmVzcG9uc2USQwoIbWVzc2FnZXMYASADKAsyJy5wZWVyc1'
        '90b3VjaC5tb2RlbC5jaGF0LnYxLkdyb3VwTWVzc2FnZVIIbWVzc2FnZXMSGQoIaGFzX21vcmUY'
        'AiABKAhSB2hhc01vcmU=');

@$core.Deprecated('Use getGroupSettingsRequestDescriptor instead')
const GetGroupSettingsRequest$json = {
  '1': 'GetGroupSettingsRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
  ],
};

/// Descriptor for `GetGroupSettingsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getGroupSettingsRequestDescriptor =
    $convert.base64Decode(
        'ChdHZXRHcm91cFNldHRpbmdzUmVxdWVzdBIdCgpncm91cF91bGlkGAEgASgJUglncm91cFVsaW'
        'Q=');

@$core.Deprecated('Use getGroupSettingsResponseDescriptor instead')
const GetGroupSettingsResponse$json = {
  '1': 'GetGroupSettingsResponse',
  '2': [
    {'1': 'is_muted', '3': 1, '4': 1, '5': 8, '10': 'isMuted'},
    {'1': 'is_pinned', '3': 2, '4': 1, '5': 8, '10': 'isPinned'},
    {'1': 'my_nickname', '3': 3, '4': 1, '5': 9, '10': 'myNickname'},
    {
      '1': 'show_member_nickname',
      '3': 4,
      '4': 1,
      '5': 8,
      '10': 'showMemberNickname'
    },
  ],
};

/// Descriptor for `GetGroupSettingsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getGroupSettingsResponseDescriptor = $convert.base64Decode(
    'ChhHZXRHcm91cFNldHRpbmdzUmVzcG9uc2USGQoIaXNfbXV0ZWQYASABKAhSB2lzTXV0ZWQSGw'
    'oJaXNfcGlubmVkGAIgASgIUghpc1Bpbm5lZBIfCgtteV9uaWNrbmFtZRgDIAEoCVIKbXlOaWNr'
    'bmFtZRIwChRzaG93X21lbWJlcl9uaWNrbmFtZRgEIAEoCFISc2hvd01lbWJlck5pY2tuYW1l');

@$core.Deprecated('Use updateGroupSettingsRequestDescriptor instead')
const UpdateGroupSettingsRequest$json = {
  '1': 'UpdateGroupSettingsRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {
      '1': 'is_muted',
      '3': 2,
      '4': 1,
      '5': 8,
      '9': 0,
      '10': 'isMuted',
      '17': true
    },
    {
      '1': 'is_pinned',
      '3': 3,
      '4': 1,
      '5': 8,
      '9': 1,
      '10': 'isPinned',
      '17': true
    },
    {
      '1': 'show_member_nickname',
      '3': 4,
      '4': 1,
      '5': 8,
      '9': 2,
      '10': 'showMemberNickname',
      '17': true
    },
  ],
  '8': [
    {'1': '_is_muted'},
    {'1': '_is_pinned'},
    {'1': '_show_member_nickname'},
  ],
};

/// Descriptor for `UpdateGroupSettingsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateGroupSettingsRequestDescriptor = $convert.base64Decode(
    'ChpVcGRhdGVHcm91cFNldHRpbmdzUmVxdWVzdBIdCgpncm91cF91bGlkGAEgASgJUglncm91cF'
    'VsaWQSHgoIaXNfbXV0ZWQYAiABKAhIAFIHaXNNdXRlZIgBARIgCglpc19waW5uZWQYAyABKAhI'
    'AVIIaXNQaW5uZWSIAQESNQoUc2hvd19tZW1iZXJfbmlja25hbWUYBCABKAhIAlISc2hvd01lbW'
    'Jlck5pY2tuYW1liAEBQgsKCV9pc19tdXRlZEIMCgpfaXNfcGlubmVkQhcKFV9zaG93X21lbWJl'
    'cl9uaWNrbmFtZQ==');

@$core.Deprecated('Use updateGroupSettingsResponseDescriptor instead')
const UpdateGroupSettingsResponse$json = {
  '1': 'UpdateGroupSettingsResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `UpdateGroupSettingsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateGroupSettingsResponseDescriptor =
    $convert.base64Decode(
        'ChtVcGRhdGVHcm91cFNldHRpbmdzUmVzcG9uc2USGAoHc3VjY2VzcxgBIAEoCFIHc3VjY2Vzcw'
        '==');

@$core.Deprecated('Use deleteGroupMessageRequestDescriptor instead')
const DeleteGroupMessageRequest$json = {
  '1': 'DeleteGroupMessageRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'message_ulid', '3': 2, '4': 1, '5': 9, '10': 'messageUlid'},
  ],
};

/// Descriptor for `DeleteGroupMessageRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteGroupMessageRequestDescriptor =
    $convert.base64Decode(
        'ChlEZWxldGVHcm91cE1lc3NhZ2VSZXF1ZXN0Eh0KCmdyb3VwX3VsaWQYASABKAlSCWdyb3VwVW'
        'xpZBIhCgxtZXNzYWdlX3VsaWQYAiABKAlSC21lc3NhZ2VVbGlk');

@$core.Deprecated('Use deleteGroupMessageResponseDescriptor instead')
const DeleteGroupMessageResponse$json = {
  '1': 'DeleteGroupMessageResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `DeleteGroupMessageResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteGroupMessageResponseDescriptor =
    $convert.base64Decode(
        'ChpEZWxldGVHcm91cE1lc3NhZ2VSZXNwb25zZRIYCgdzdWNjZXNzGAEgASgIUgdzdWNjZXNz');
