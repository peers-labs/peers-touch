//
//  Generated code. Do not modify.
//  source: station_user_moments.proto
//
// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_final_fields
// ignore_for_file: unnecessary_import, unnecessary_this, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use momentTypeDescriptor instead')
const MomentType$json = {
  '1': 'MomentType',
  '2': [
    {'1': 'MOMENT_TYPE_UNSPECIFIED', '2': 0},
    {'1': 'MOMENT_TYPE_TEXT', '2': 1},
    {'1': 'MOMENT_TYPE_PHOTO', '2': 2},
    {'1': 'MOMENT_TYPE_VIDEO', '2': 3},
    {'1': 'MOMENT_TYPE_LIFE_UPDATE', '2': 4},
    {'1': 'MOMENT_TYPE_MEMORY', '2': 5},
    {'1': 'MOMENT_TYPE_ACHIEVEMENT', '2': 6},
  ],
};

/// Descriptor for `MomentType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List momentTypeDescriptor = $convert.base64Decode(
    'CgpNb21lbnRUeXBlEhsKF01PTUVOVF9UWVBFX1VOU1BFQ0lGSUVEEAASFAoQTU9NRU5UX1RZUE'
    'VfVEVYVBABEhUKEU1PTUVOVF9UWVBFX1BIT1RPEAISFQoRTU9NRU5UX1RZUEVfVklERU8QAxIb'
    'ChdNT01FTlRfVFlQRV9MSUZFX1VQREFURRAEEhYKEk1PTUVOVF9UWVBFX01FTU9SWRAFEhsKF0'
    '1PTUVOVF9UWVBFX0FDSElFVkVNRU5UEAY=');

@$core.Deprecated('Use mediaTypeDescriptor instead')
const MediaType$json = {
  '1': 'MediaType',
  '2': [
    {'1': 'MEDIA_TYPE_UNSPECIFIED', '2': 0},
    {'1': 'MEDIA_TYPE_IMAGE', '2': 1},
    {'1': 'MEDIA_TYPE_VIDEO', '2': 2},
    {'1': 'MEDIA_TYPE_AUDIO', '2': 3},
    {'1': 'MEDIA_TYPE_DOCUMENT', '2': 4},
  ],
};

/// Descriptor for `MediaType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List mediaTypeDescriptor = $convert.base64Decode(
    'CglNZWRpYVR5cGUSGgoWTUVESUFfVFlQRV9VTlNQRUNJRklFRBAAEhQKEE1FRElBX1RZUEVfSU'
    '1BR0UQARIUChBNRURJQV9UWVBFX1ZJREVPEAISFAoQTUVESUFfVFlQRV9BVURJTxADEhcKE01F'
    'RElBX1RZUEVfRE9DVU1FTlQQBA==');

@$core.Deprecated('Use privacyDescriptor instead')
const Privacy$json = {
  '1': 'Privacy',
  '2': [
    {'1': 'PRIVACY_UNSPECIFIED', '2': 0},
    {'1': 'PRIVACY_FAMILY_ONLY', '2': 1},
    {'1': 'PRIVACY_CLOSE_FAMILY', '2': 2},
    {'1': 'PRIVACY_PUBLIC', '2': 3},
  ],
};

/// Descriptor for `Privacy`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List privacyDescriptor = $convert.base64Decode(
    'CgdQcml2YWN5EhcKE1BSSVZBQ1lfVU5TUEVDSUZJRUQQABIXChNQUklWQUNZX0ZBTUlMWV9PTk'
    'xZEAESGAoUUFJJVkFDWV9DTE9TRV9GQU1JTFkQAhISCg5QUklWQUNZX1BVQkxJQxAD');

@$core.Deprecated('Use likeTargetTypeDescriptor instead')
const LikeTargetType$json = {
  '1': 'LikeTargetType',
  '2': [
    {'1': 'LIKE_TARGET_TYPE_UNSPECIFIED', '2': 0},
    {'1': 'LIKE_TARGET_TYPE_MOMENT', '2': 1},
    {'1': 'LIKE_TARGET_TYPE_COMMENT', '2': 2},
  ],
};

/// Descriptor for `LikeTargetType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List likeTargetTypeDescriptor = $convert.base64Decode(
    'Cg5MaWtlVGFyZ2V0VHlwZRIgChxMSUtFX1RBUkdFVF9UWVBFX1VOU1BFQ0lGSUVEEAASGwoXTE'
    'lLRV9UQVJHRVRfVFlQRV9NT01FTlQQARIcChhMSUtFX1RBUkdFVF9UWVBFX0NPTU1FTlQQAg==');

@$core.Deprecated('Use reactionTypeDescriptor instead')
const ReactionType$json = {
  '1': 'ReactionType',
  '2': [
    {'1': 'REACTION_TYPE_UNSPECIFIED', '2': 0},
    {'1': 'REACTION_TYPE_LIKE', '2': 1},
    {'1': 'REACTION_TYPE_LOVE', '2': 2},
    {'1': 'REACTION_TYPE_LAUGH', '2': 3},
    {'1': 'REACTION_TYPE_WOW', '2': 4},
    {'1': 'REACTION_TYPE_SAD', '2': 5},
    {'1': 'REACTION_TYPE_ANGRY', '2': 6},
  ],
};

/// Descriptor for `ReactionType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List reactionTypeDescriptor = $convert.base64Decode(
    'CgxSZWFjdGlvblR5cGUSHQoZUkVBQ1RJT05fVFlQRV9VTlNQRUNJRklFRBAAEhYKElJFQUNUSU'
    '9OX1RZUEVfTElLRRABEhYKElJFQUNUSU9OX1RZUEVfTE9WRRACEhcKE1JFQUNUSU9OX1RZUEVf'
    'TEFVR0gQAxIVChFSRUFDVElPTl9UWVBFX1dPVxAEEhUKEVJFQUNUSU9OX1RZUEVfU0FEEAUSFw'
    'oTUkVBQ1RJT05fVFlQRV9BTkdSWRAG');

@$core.Deprecated('Use familyRoleDescriptor instead')
const FamilyRole$json = {
  '1': 'FamilyRole',
  '2': [
    {'1': 'FAMILY_ROLE_UNSPECIFIED', '2': 0},
    {'1': 'FAMILY_ROLE_PARENT', '2': 1},
    {'1': 'FAMILY_ROLE_CHILD', '2': 2},
    {'1': 'FAMILY_ROLE_GRANDPARENT', '2': 3},
    {'1': 'FAMILY_ROLE_SIBLING', '2': 4},
    {'1': 'FAMILY_ROLE_SPOUSE', '2': 5},
    {'1': 'FAMILY_ROLE_EXTENDED', '2': 6},
  ],
};

/// Descriptor for `FamilyRole`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List familyRoleDescriptor = $convert.base64Decode(
    'CgpGYW1pbHlSb2xlEhsKF0ZBTUlMWV9ST0xFX1VOU1BFQ0lGSUVEEAASFgoSRkFNSUxZX1JPTE'
    'VfUEFSRU5UEAESFQoRRkFNSUxZX1JPTEVfQ0hJTEQQAhIbChdGQU1JTFlfUk9MRV9HUkFORFBB'
    'UkVOVBADEhcKE0ZBTUlMWV9ST0xFX1NJQkxJTkcQBBIWChJGQU1JTFlfUk9MRV9TUE9VU0UQBR'
    'IYChRGQU1JTFlfUk9MRV9FWFRFTkRFRBAG');

@$core.Deprecated('Use momentDescriptor instead')
const Moment$json = {
  '1': 'Moment',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'author_id', '3': 2, '4': 1, '5': 9, '10': 'authorId'},
    {'1': 'author_name', '3': 3, '4': 1, '5': 9, '10': 'authorName'},
    {'1': 'content', '3': 4, '4': 1, '5': 9, '10': 'content'},
    {'1': 'media', '3': 5, '4': 3, '5': 11, '6': '.moments.MediaAttachment', '10': 'media'},
    {'1': 'type', '3': 6, '4': 1, '5': 14, '6': '.moments.MomentType', '10': 'type'},
    {'1': 'tags', '3': 7, '4': 3, '5': 9, '10': 'tags'},
    {'1': 'location', '3': 8, '4': 1, '5': 11, '6': '.moments.Location', '10': 'location'},
    {'1': 'privacy', '3': 9, '4': 1, '5': 14, '6': '.moments.Privacy', '10': 'privacy'},
    {'1': 'likes_count', '3': 10, '4': 1, '5': 5, '10': 'likesCount'},
    {'1': 'comments_count', '3': 11, '4': 1, '5': 5, '10': 'commentsCount'},
    {'1': 'created_at', '3': 12, '4': 1, '5': 11, '6': '.google.protobuf.Timestamp', '10': 'createdAt'},
    {'1': 'updated_at', '3': 13, '4': 1, '5': 11, '6': '.google.protobuf.Timestamp', '10': 'updatedAt'},
  ],
};

/// Descriptor for `Moment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List momentDescriptor = $convert.base64Decode(
    'CgZNb21lbnQSDgoCaWQYASABKAlSAmlkEhsKCWF1dGhvcl9pZBgCIAEoCVIIYXV0aG9ySWQSHw'
    'oLYXV0aG9yX25hbWUYAyABKAlSCmF1dGhvck5hbWUSGAoHY29udGVudBgEIAEoCVIHY29udGVu'
    'dBIuCgVtZWRpYRgFIAMoCzIYLm1vbWVudHMuTWVkaWFBdHRhY2htZW50UgVtZWRpYRInCgR0eX'
    'BlGAYgASgOMhMubW9tZW50cy5Nb21lbnRUeXBlUgR0eXBlEhIKBHRhZ3MYByADKAlSBHRhZ3MS'
    'LQoIbG9jYXRpb24YCCABKAsyES5tb21lbnRzLkxvY2F0aW9uUghsb2NhdGlvbhIqCgdwcml2YW'
    'N5GAkgASgOMhAubW9tZW50cy5Qcml2YWN5Ugdwcml2YWN5Eh8KC2xpa2VzX2NvdW50GAogASgF'
    'UgpsaWtlc0NvdW50EiUKDmNvbW1lbnRzX2NvdW50GAsgASgFUg1jb21tZW50c0NvdW50EjkKCm'
    'NyZWF0ZWRfYXQYDCABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgljcmVhdGVkQXQS'
    'OQoKdXBkYXRlZF9hdBgNIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCXVwZGF0ZW'
    'RBdA==');

@$core.Deprecated('Use mediaAttachmentDescriptor instead')
const MediaAttachment$json = {
  '1': 'MediaAttachment',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'type', '3': 2, '4': 1, '5': 14, '6': '.moments.MediaType', '10': 'type'},
    {'1': 'url', '3': 3, '4': 1, '5': 9, '10': 'url'},
    {'1': 'thumbnail_url', '3': 4, '4': 1, '5': 9, '10': 'thumbnailUrl'},
    {'1': 'caption', '3': 5, '4': 1, '5': 9, '10': 'caption'},
    {'1': 'file_size', '3': 6, '4': 1, '5': 3, '10': 'fileSize'},
    {'1': 'mime_type', '3': 7, '4': 1, '5': 9, '10': 'mimeType'},
    {'1': 'width', '3': 8, '4': 1, '5': 5, '10': 'width'},
    {'1': 'height', '3': 9, '4': 1, '5': 5, '10': 'height'},
    {'1': 'duration', '3': 10, '4': 1, '5': 5, '10': 'duration'},
  ],
};

/// Descriptor for `MediaAttachment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List mediaAttachmentDescriptor = $convert.base64Decode(
    'Cg9NZWRpYUF0dGFjaG1lbnQSDgoCaWQYASABKAlSAmlkEiYKBHR5cGUYAiABKA4yEi5tb21lbn'
    'RzLk1lZGlhVHlwZVIEdHlwZRIQCgN1cmwYAyABKAlSA3VybBIjCg10aHVtYm5haWxfdXJsGAQg'
    'ASgJUgx0aHVtYm5haWxVcmwSGAoHY2FwdGlvbhgFIAEoCVIHY2FwdGlvbhIbCglmaWxlX3Npem'
    'UYBiABKANSCGZpbGVTaXplEhsKCW1pbWVfdHlwZRgHIAEoCVIIbWltZVR5cGUSFAoFd2lkdGgY'
    'CCABKAVSBXdpZHRoEhYKBmhlaWdodBgJIAEoBVIGaGVpZ2h0EhoKCGR1cmF0aW9uGAogASgFUg'
    'hkdXJhdGlvbg==');

@$core.Deprecated('Use locationDescriptor instead')
const Location$json = {
  '1': 'Location',
  '2': [
    {'1': 'latitude', '3': 1, '4': 1, '5': 1, '10': 'latitude'},
    {'1': 'longitude', '3': 2, '4': 1, '5': 1, '10': 'longitude'},
    {'1': 'address', '3': 3, '4': 1, '5': 9, '10': 'address'},
    {'1': 'city', '3': 4, '4': 1, '5': 9, '10': 'city'},
    {'1': 'country', '3': 5, '4': 1, '5': 9, '10': 'country'},
  ],
};

/// Descriptor for `Location`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List locationDescriptor = $convert.base64Decode(
    'CghMb2NhdGlvbhIaCghsYXRpdHVkZRgBIAEoAVIIbGF0aXR1ZGUSHAoJbG9uZ2l0dWRlGAIgAS'
    'gBUglsb25naXR1ZGUSGAoHYWRkcmVzcxgDIAEoCVIHYWRkcmVzcxISCgRjaXR5GAQgASgJUgRj'
    'aXR5EhgKB2NvdW50cnkYBSABKAlSB2NvdW50cnk=');

@$core.Deprecated('Use commentDescriptor instead')
const Comment$json = {
  '1': 'Comment',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'moment_id', '3': 2, '4': 1, '5': 9, '10': 'momentId'},
    {'1': 'author_id', '3': 3, '4': 1, '5': 9, '10': 'authorId'},
    {'1': 'author_name', '3': 4, '4': 1, '5': 9, '10': 'authorName'},
    {'1': 'content', '3': 5, '4': 1, '5': 9, '10': 'content'},
    {'1': 'parent_comment_id', '3': 6, '4': 1, '5': 9, '10': 'parentCommentId'},
    {'1': 'likes_count', '3': 7, '4': 1, '5': 5, '10': 'likesCount'},
    {'1': 'created_at', '3': 8, '4': 1, '5': 11, '6': '.google.protobuf.Timestamp', '10': 'createdAt'},
    {'1': 'updated_at', '3': 9, '4': 1, '5': 11, '6': '.google.protobuf.Timestamp', '10': 'updatedAt'},
  ],
};

/// Descriptor for `Comment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List commentDescriptor = $convert.base64Decode(
    'CgdDb21tZW50Eg4KAmlkGAEgASgJUgJpZBIbCgltb21lbnRfaWQYAiABKAlSCG1vbWVudElkEh'
    'sKCWF1dGhvcl9pZBgDIAEoCVIIYXV0aG9ySWQSHwoLYXV0aG9yX25hbWUYBCABKAlSCmF1dGhv'
    'ck5hbWUSGAoHY29udGVudBgFIAEoCVIHY29udGVudBIqChFwYXJlbnRfY29tbWVudF9pZBgGIA'
    'EoCVIPcGFyZW50Q29tbWVudElkEh8KC2xpa2VzX2NvdW50GAcgASgFUgpsaWtlc0NvdW50EjkK'
    'CmNyZWF0ZWRfYXQYCCABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgljcmVhdGVkQX'
    'QSOQoKdXBkYXRlZF9hdBgJIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCXVwZGF0'
    'ZWRBdA==');

@$core.Deprecated('Use likeDescriptor instead')
const Like$json = {
  '1': 'Like',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'user_id', '3': 2, '4': 1, '5': 9, '10': 'userId'},
    {'1': 'target_id', '3': 3, '4': 1, '5': 9, '10': 'targetId'},
    {'1': 'target_type', '3': 4, '4': 1, '5': 14, '6': '.moments.LikeTargetType', '10': 'targetType'},
    {'1': 'reaction', '3': 5, '4': 1, '5': 14, '6': '.moments.ReactionType', '10': 'reaction'},
    {'1': 'created_at', '3': 6, '4': 1, '5': 11, '6': '.google.protobuf.Timestamp', '10': 'createdAt'},
  ],
};

/// Descriptor for `Like`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List likeDescriptor = $convert.base64Decode(
    'CgRMaWtlEg4KAmlkGAEgASgJUgJpZBIXCgd1c2VyX2lkGAIgASgJUgZ1c2VySWQSGwoJdGFyZ2'
    'V0X2lkGAMgASgJUgh0YXJnZXRJZBI4Cgt0YXJnZXRfdHlwZRgEIAEoDjIXLm1vbWVudHMuTGlr'
    'ZVRhcmdldFR5cGVSCnRhcmdldFR5cGUSMQoIcmVhY3Rpb24YBSABKA4yFS5tb21lbnRzLlJlYW'
    'N0aW9uVHlwZVIIcmVhY3Rpb24SOQoKY3JlYXRlZF9hdBgGIAEoCzIaLmdvb2dsZS5wcm90b2J1'
    'Zi5UaW1lc3RhbXBSCWNyZWF0ZWRBdA==');

@$core.Deprecated('Use familyMemberDescriptor instead')
const FamilyMember$json = {
  '1': 'FamilyMember',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'email', '3': 3, '4': 1, '5': 9, '10': 'email'},
    {'1': 'avatar_url', '3': 4, '4': 1, '5': 9, '10': 'avatarUrl'},
    {'1': 'bio', '3': 5, '4': 1, '5': 9, '10': 'bio'},
    {'1': 'role', '3': 6, '4': 1, '5': 14, '6': '.moments.FamilyRole', '10': 'role'},
    {'1': 'is_active', '3': 7, '4': 1, '5': 8, '10': 'isActive'},
    {'1': 'joined_at', '3': 8, '4': 1, '5': 11, '6': '.google.protobuf.Timestamp', '10': 'joinedAt'},
    {'1': 'last_seen', '3': 9, '4': 1, '5': 11, '6': '.google.protobuf.Timestamp', '10': 'lastSeen'},
  ],
};

/// Descriptor for `FamilyMember`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List familyMemberDescriptor = $convert.base64Decode(
    'CgxGYW1pbHlNZW1iZXISDgoCaWQYASABKAlSAmlkEhIKBG5hbWUYAiABKAlSBG5hbWUSFAoFZW'
    '1haWwYAyABKAlSBWVtYWlsEh0KCmF2YXRhcl91cmwYBCABKAlSCWF2YXRhclVybBIQCgNiaW8Y'
    'BSABKAlSA2JpbxInCgRyb2xlGAYgASgOMhMubW9tZW50cy5GYW1pbHlSb2xlUgRyb2xlEhsKCW'
    'lzX2FjdGl2ZRgHIAEoCFIIaXNBY3RpdmUSNwoJam9pbmVkX2F0GAggASgLMhouZ29vZ2xlLnBy'
    'b3RvYnVmLlRpbWVzdGFtcFIIam9pbmVkQXQSNwoJbGFzdF9zZWVuGAkgASgLMhouZ29vZ2xlLn'
    'Byb3RvYnVmLlRpbWVzdGFtcFIIbGFzdFNlZW4=');

@$core.Deprecated('Use familyDescriptor instead')
const Family$json = {
  '1': 'Family',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'description', '3': 3, '4': 1, '5': 9, '10': 'description'},
    {'1': 'member_ids', '3': 4, '4': 3, '5': 9, '10': 'memberIds'},
    {'1': 'admin_id', '3': 5, '4': 1, '5': 9, '10': 'adminId'},
    {'1': 'invite_code', '3': 6, '4': 1, '5': 9, '10': 'inviteCode'},
    {'1': 'is_private', '3': 7, '4': 1, '5': 8, '10': 'isPrivate'},
    {'1': 'created_at', '3': 8, '4': 1, '5': 11, '6': '.google.protobuf.Timestamp', '10': 'createdAt'},
    {'1': 'updated_at', '3': 9, '4': 1, '5': 11, '6': '.google.protobuf.Timestamp', '10': 'updatedAt'},
  ],
};

/// Descriptor for `Family`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List familyDescriptor = $convert.base64Decode(
    'CgZGYW1pbHkSDgoCaWQYASABKAlSAmlkEhIKBG5hbWUYAiABKAlSBG5hbWUSIAoLZGVzY3JpcH'
    'Rpb24YAyABKAlSC2Rlc2NyaXB0aW9uEh0KCm1lbWJlcl9pZHMYBCADKAlSCW1lbWJlcklkcxIZ'
    'CghhZG1pbl9pZBgFIAEoCVIHYWRtaW5JZBIfCgtpbnZpdGVfY29kZRgGIAEoCVIKaW52aXRlQ2'
    '9kZRIdCgppc19wcml2YXRlGAcgASgIUglpc1ByaXZhdGUSOQoKY3JlYXRlZF9hdBgIIAEoCzIa'
    'Lmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCWNyZWF0ZWRBdBI5Cgp1cGRhdGVkX2F0GAkgAS'
    'gLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJdXBkYXRlZEF0');

@$core.Deprecated('Use createMomentRequestDescriptor instead')
const CreateMomentRequest$json = {
  '1': 'CreateMomentRequest',
  '2': [
    {'1': 'moment', '3': 1, '4': 1, '5': 11, '6': '.moments.Moment', '10': 'moment'},
  ],
};

/// Descriptor for `CreateMomentRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createMomentRequestDescriptor = $convert.base64Decode(
    'ChNDcmVhdGVNb21lbnRSZXF1ZXN0EicKBm1vbWVudBgBIAEoCzIPLm1vbWVudHMuTW9tZW50Ug'
    'Ztb21lbnQ=');

@$core.Deprecated('Use createMomentResponseDescriptor instead')
const CreateMomentResponse$json = {
  '1': 'CreateMomentResponse',
  '2': [
    {'1': 'moment', '3': 1, '4': 1, '5': 11, '6': '.moments.Moment', '10': 'moment'},
  ],
};

/// Descriptor for `CreateMomentResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createMomentResponseDescriptor = $convert.base64Decode(
    'ChRDcmVhdGVNb21lbnRSZXNwb25zZRInCgZtb21lbnQYASABKAsyDy5tb21lbnRzLk1vbWVudF'
    'IGbW9tZW50');

@$core.Deprecated('Use getMomentsRequestDescriptor instead')
const GetMomentsRequest$json = {
  '1': 'GetMomentsRequest',
  '2': [
    {'1': 'family_id', '3': 1, '4': 1, '5': 9, '10': 'familyId'},
    {'1': 'page_size', '3': 2, '4': 1, '5': 5, '10': 'pageSize'},
    {'1': 'page_token', '3': 3, '4': 1, '5': 9, '10': 'pageToken'},
    {'1': 'type_filter', '3': 4, '4': 1, '5': 14, '6': '.moments.MomentType', '10': 'typeFilter'},
    {'1': 'author_filter', '3': 5, '4': 1, '5': 9, '10': 'authorFilter'},
  ],
};

/// Descriptor for `GetMomentsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMomentsRequestDescriptor = $convert.base64Decode(
    'ChFHZXRNb21lbnRzUmVxdWVzdBIbCglmYW1pbHlfaWQYASABKAlSCGZhbWlseUlkEhsKCXBhZ2'
    'Vfc2l6ZRgCIAEoBVIIcGFnZVNpemUSHQoKcGFnZV90b2tlbhgDIAEoCVIJcGFnZVRva2VuEjQK'
    'C3R5cGVfZmlsdGVyGAQgASgOMhMubW9tZW50cy5Nb21lbnRUeXBlUgp0eXBlRmlsdGVyEiMKDW'
    'F1dGhvcl9maWx0ZXIYBSABKAlSDGF1dGhvckZpbHRlcg==');

@$core.Deprecated('Use getMomentsResponseDescriptor instead')
const GetMomentsResponse$json = {
  '1': 'GetMomentsResponse',
  '2': [
    {'1': 'moments', '3': 1, '4': 3, '5': 11, '6': '.moments.Moment', '10': 'moments'},
    {'1': 'next_page_token', '3': 2, '4': 1, '5': 9, '10': 'nextPageToken'},
    {'1': 'total_count', '3': 3, '4': 1, '5': 5, '10': 'totalCount'},
  ],
};

/// Descriptor for `GetMomentsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMomentsResponseDescriptor = $convert.base64Decode(
    'ChJHZXRNb21lbnRzUmVzcG9uc2USKQoHbW9tZW50cxgBIAMoCzIPLm1vbWVudHMuTW9tZW50Ug'
    'dtb21lbnRzEiYKD25leHRfcGFnZV90b2tlbhgCIAEoCVINbmV4dFBhZ2VUb2tlbhIfCgt0b3Rh'
    'bF9jb3VudBgDIAEoBVIKdG90YWxDb3VudA==');

@$core.Deprecated('Use addCommentRequestDescriptor instead')
const AddCommentRequest$json = {
  '1': 'AddCommentRequest',
  '2': [
    {'1': 'comment', '3': 1, '4': 1, '5': 11, '6': '.moments.Comment', '10': 'comment'},
  ],
};

/// Descriptor for `AddCommentRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List addCommentRequestDescriptor = $convert.base64Decode(
    'ChFBZGRDb21tZW50UmVxdWVzdBIqCgdjb21tZW50GAEgASgLMhAubW9tZW50cy5Db21tZW50Ug'
    'djb21tZW50');

@$core.Deprecated('Use addCommentResponseDescriptor instead')
const AddCommentResponse$json = {
  '1': 'AddCommentResponse',
  '2': [
    {'1': 'comment', '3': 1, '4': 1, '5': 11, '6': '.moments.Comment', '10': 'comment'},
  ],
};

/// Descriptor for `AddCommentResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List addCommentResponseDescriptor = $convert.base64Decode(
    'ChJBZGRDb21tZW50UmVzcG9uc2USKgoHY29tbWVudBgBIAEoCzIQLm1vbWVudHMuQ29tbWVudF'
    'IHY29tbWVudA==');

@$core.Deprecated('Use addLikeRequestDescriptor instead')
const AddLikeRequest$json = {
  '1': 'AddLikeRequest',
  '2': [
    {'1': 'like', '3': 1, '4': 1, '5': 11, '6': '.moments.Like', '10': 'like'},
  ],
};

/// Descriptor for `AddLikeRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List addLikeRequestDescriptor = $convert.base64Decode(
    'Cg5BZGRMaWtlUmVxdWVzdBIhCgRsaWtlGAEgASgLMg0ubW9tZW50cy5MaWtlUgRsaWtl');

@$core.Deprecated('Use addLikeResponseDescriptor instead')
const AddLikeResponse$json = {
  '1': 'AddLikeResponse',
  '2': [
    {'1': 'like', '3': 1, '4': 1, '5': 11, '6': '.moments.Like', '10': 'like'},
  ],
};

/// Descriptor for `AddLikeResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List addLikeResponseDescriptor = $convert.base64Decode(
    'Cg9BZGRMaWtlUmVzcG9uc2USIQoEbGlrZRgBIAEoCzINLm1vbWVudHMuTGlrZVIEbGlrZQ==');

