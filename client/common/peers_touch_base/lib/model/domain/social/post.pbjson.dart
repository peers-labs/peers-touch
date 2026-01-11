// This is a generated file - do not edit.
//
// Generated from domain/social/post.proto.

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

@$core.Deprecated('Use postTypeDescriptor instead')
const PostType$json = {
  '1': 'PostType',
  '2': [
    {'1': 'TEXT', '2': 0},
    {'1': 'IMAGE', '2': 1},
    {'1': 'VIDEO', '2': 2},
    {'1': 'LINK', '2': 3},
    {'1': 'POLL', '2': 4},
    {'1': 'REPOST', '2': 5},
    {'1': 'LOCATION', '2': 6},
  ],
};

/// Descriptor for `PostType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List postTypeDescriptor = $convert.base64Decode(
    'CghQb3N0VHlwZRIICgRURVhUEAASCQoFSU1BR0UQARIJCgVWSURFTxACEggKBExJTksQAxIICg'
    'RQT0xMEAQSCgoGUkVQT1NUEAUSDAoITE9DQVRJT04QBg==');

@$core.Deprecated('Use postVisibilityDescriptor instead')
const PostVisibility$json = {
  '1': 'PostVisibility',
  '2': [
    {'1': 'PUBLIC', '2': 0},
    {'1': 'FOLLOWERS_ONLY', '2': 1},
    {'1': 'PRIVATE', '2': 2},
  ],
};

/// Descriptor for `PostVisibility`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List postVisibilityDescriptor = $convert.base64Decode(
    'Cg5Qb3N0VmlzaWJpbGl0eRIKCgZQVUJMSUMQABISCg5GT0xMT1dFUlNfT05MWRABEgsKB1BSSV'
    'ZBVEUQAg==');

@$core.Deprecated('Use videoQualityDescriptor instead')
const VideoQuality$json = {
  '1': 'VideoQuality',
  '2': [
    {'1': 'AUTO', '2': 0},
    {'1': 'LOW', '2': 1},
    {'1': 'MEDIUM', '2': 2},
    {'1': 'HIGH', '2': 3},
    {'1': 'HD', '2': 4},
  ],
};

/// Descriptor for `VideoQuality`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List videoQualityDescriptor = $convert.base64Decode(
    'CgxWaWRlb1F1YWxpdHkSCAoEQVVUTxAAEgcKA0xPVxABEgoKBk1FRElVTRACEggKBEhJR0gQAx'
    'IGCgJIRBAE');

@$core.Deprecated('Use timelineTypeDescriptor instead')
const TimelineType$json = {
  '1': 'TimelineType',
  '2': [
    {'1': 'TIMELINE_HOME', '2': 0},
    {'1': 'TIMELINE_USER', '2': 1},
    {'1': 'TIMELINE_PUBLIC', '2': 2},
  ],
};

/// Descriptor for `TimelineType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List timelineTypeDescriptor = $convert.base64Decode(
    'CgxUaW1lbGluZVR5cGUSEQoNVElNRUxJTkVfSE9NRRAAEhEKDVRJTUVMSU5FX1VTRVIQARITCg'
    '9USU1FTElORV9QVUJMSUMQAg==');

@$core.Deprecated('Use postDescriptor instead')
const Post$json = {
  '1': 'Post',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'author_id', '3': 2, '4': 1, '5': 9, '10': 'authorId'},
    {
      '1': 'type',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.social.v1.PostType',
      '10': 'type'
    },
    {
      '1': 'visibility',
      '3': 4,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.social.v1.PostVisibility',
      '10': 'visibility'
    },
    {
      '1': 'created_at',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'updated_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
    {'1': 'is_deleted', '3': 7, '4': 1, '5': 8, '10': 'isDeleted'},
    {
      '1': 'stats',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.PostStats',
      '10': 'stats'
    },
    {
      '1': 'author',
      '3': 20,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.PostAuthor',
      '10': 'author'
    },
    {
      '1': 'interaction',
      '3': 21,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.PostInteraction',
      '10': 'interaction'
    },
    {
      '1': 'text_post',
      '3': 30,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.TextPost',
      '9': 0,
      '10': 'textPost'
    },
    {
      '1': 'image_post',
      '3': 31,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.ImagePost',
      '9': 0,
      '10': 'imagePost'
    },
    {
      '1': 'video_post',
      '3': 32,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.VideoPost',
      '9': 0,
      '10': 'videoPost'
    },
    {
      '1': 'link_post',
      '3': 33,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.LinkPost',
      '9': 0,
      '10': 'linkPost'
    },
    {
      '1': 'poll_post',
      '3': 34,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.PollPost',
      '9': 0,
      '10': 'pollPost'
    },
    {
      '1': 'repost_post',
      '3': 35,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.RepostPost',
      '9': 0,
      '10': 'repostPost'
    },
    {
      '1': 'location_post',
      '3': 36,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.LocationPost',
      '9': 0,
      '10': 'locationPost'
    },
    {'1': 'reply_to_post_id', '3': 40, '4': 1, '5': 9, '10': 'replyToPostId'},
  ],
  '8': [
    {'1': 'content'},
  ],
};

/// Descriptor for `Post`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postDescriptor = $convert.base64Decode(
    'CgRQb3N0Eg4KAmlkGAEgASgJUgJpZBIbCglhdXRob3JfaWQYAiABKAlSCGF1dGhvcklkEjkKBH'
    'R5cGUYAyABKA4yJS5wZWVyc190b3VjaC5tb2RlbC5zb2NpYWwudjEuUG9zdFR5cGVSBHR5cGUS'
    'SwoKdmlzaWJpbGl0eRgEIAEoDjIrLnBlZXJzX3RvdWNoLm1vZGVsLnNvY2lhbC52MS5Qb3N0Vm'
    'lzaWJpbGl0eVIKdmlzaWJpbGl0eRI5CgpjcmVhdGVkX2F0GAUgASgLMhouZ29vZ2xlLnByb3Rv'
    'YnVmLlRpbWVzdGFtcFIJY3JlYXRlZEF0EjkKCnVwZGF0ZWRfYXQYBiABKAsyGi5nb29nbGUucH'
    'JvdG9idWYuVGltZXN0YW1wUgl1cGRhdGVkQXQSHQoKaXNfZGVsZXRlZBgHIAEoCFIJaXNEZWxl'
    'dGVkEjwKBXN0YXRzGAogASgLMiYucGVlcnNfdG91Y2gubW9kZWwuc29jaWFsLnYxLlBvc3RTdG'
    'F0c1IFc3RhdHMSPwoGYXV0aG9yGBQgASgLMicucGVlcnNfdG91Y2gubW9kZWwuc29jaWFsLnYx'
    'LlBvc3RBdXRob3JSBmF1dGhvchJOCgtpbnRlcmFjdGlvbhgVIAEoCzIsLnBlZXJzX3RvdWNoLm'
    '1vZGVsLnNvY2lhbC52MS5Qb3N0SW50ZXJhY3Rpb25SC2ludGVyYWN0aW9uEkQKCXRleHRfcG9z'
    'dBgeIAEoCzIlLnBlZXJzX3RvdWNoLm1vZGVsLnNvY2lhbC52MS5UZXh0UG9zdEgAUgh0ZXh0UG'
    '9zdBJHCgppbWFnZV9wb3N0GB8gASgLMiYucGVlcnNfdG91Y2gubW9kZWwuc29jaWFsLnYxLklt'
    'YWdlUG9zdEgAUglpbWFnZVBvc3QSRwoKdmlkZW9fcG9zdBggIAEoCzImLnBlZXJzX3RvdWNoLm'
    '1vZGVsLnNvY2lhbC52MS5WaWRlb1Bvc3RIAFIJdmlkZW9Qb3N0EkQKCWxpbmtfcG9zdBghIAEo'
    'CzIlLnBlZXJzX3RvdWNoLm1vZGVsLnNvY2lhbC52MS5MaW5rUG9zdEgAUghsaW5rUG9zdBJECg'
    'lwb2xsX3Bvc3QYIiABKAsyJS5wZWVyc190b3VjaC5tb2RlbC5zb2NpYWwudjEuUG9sbFBvc3RI'
    'AFIIcG9sbFBvc3QSSgoLcmVwb3N0X3Bvc3QYIyABKAsyJy5wZWVyc190b3VjaC5tb2RlbC5zb2'
    'NpYWwudjEuUmVwb3N0UG9zdEgAUgpyZXBvc3RQb3N0ElAKDWxvY2F0aW9uX3Bvc3QYJCABKAsy'
    'KS5wZWVyc190b3VjaC5tb2RlbC5zb2NpYWwudjEuTG9jYXRpb25Qb3N0SABSDGxvY2F0aW9uUG'
    '9zdBInChByZXBseV90b19wb3N0X2lkGCggASgJUg1yZXBseVRvUG9zdElkQgkKB2NvbnRlbnQ=');

@$core.Deprecated('Use postStatsDescriptor instead')
const PostStats$json = {
  '1': 'PostStats',
  '2': [
    {'1': 'likes_count', '3': 1, '4': 1, '5': 3, '10': 'likesCount'},
    {'1': 'comments_count', '3': 2, '4': 1, '5': 3, '10': 'commentsCount'},
    {'1': 'reposts_count', '3': 3, '4': 1, '5': 3, '10': 'repostsCount'},
    {'1': 'views_count', '3': 4, '4': 1, '5': 3, '10': 'viewsCount'},
  ],
};

/// Descriptor for `PostStats`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postStatsDescriptor = $convert.base64Decode(
    'CglQb3N0U3RhdHMSHwoLbGlrZXNfY291bnQYASABKANSCmxpa2VzQ291bnQSJQoOY29tbWVudH'
    'NfY291bnQYAiABKANSDWNvbW1lbnRzQ291bnQSIwoNcmVwb3N0c19jb3VudBgDIAEoA1IMcmVw'
    'b3N0c0NvdW50Eh8KC3ZpZXdzX2NvdW50GAQgASgDUgp2aWV3c0NvdW50');

@$core.Deprecated('Use postAuthorDescriptor instead')
const PostAuthor$json = {
  '1': 'PostAuthor',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'username', '3': 2, '4': 1, '5': 9, '10': 'username'},
    {'1': 'display_name', '3': 3, '4': 1, '5': 9, '10': 'displayName'},
    {'1': 'avatar_url', '3': 4, '4': 1, '5': 9, '10': 'avatarUrl'},
    {'1': 'is_following', '3': 5, '4': 1, '5': 8, '10': 'isFollowing'},
  ],
};

/// Descriptor for `PostAuthor`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postAuthorDescriptor = $convert.base64Decode(
    'CgpQb3N0QXV0aG9yEg4KAmlkGAEgASgJUgJpZBIaCgh1c2VybmFtZRgCIAEoCVIIdXNlcm5hbW'
    'USIQoMZGlzcGxheV9uYW1lGAMgASgJUgtkaXNwbGF5TmFtZRIdCgphdmF0YXJfdXJsGAQgASgJ'
    'UglhdmF0YXJVcmwSIQoMaXNfZm9sbG93aW5nGAUgASgIUgtpc0ZvbGxvd2luZw==');

@$core.Deprecated('Use postInteractionDescriptor instead')
const PostInteraction$json = {
  '1': 'PostInteraction',
  '2': [
    {'1': 'is_liked', '3': 1, '4': 1, '5': 8, '10': 'isLiked'},
    {'1': 'is_reposted', '3': 2, '4': 1, '5': 8, '10': 'isReposted'},
    {'1': 'is_bookmarked', '3': 3, '4': 1, '5': 8, '10': 'isBookmarked'},
  ],
};

/// Descriptor for `PostInteraction`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postInteractionDescriptor = $convert.base64Decode(
    'Cg9Qb3N0SW50ZXJhY3Rpb24SGQoIaXNfbGlrZWQYASABKAhSB2lzTGlrZWQSHwoLaXNfcmVwb3'
    'N0ZWQYAiABKAhSCmlzUmVwb3N0ZWQSIwoNaXNfYm9va21hcmtlZBgDIAEoCFIMaXNCb29rbWFy'
    'a2Vk');

@$core.Deprecated('Use textPostDescriptor instead')
const TextPost$json = {
  '1': 'TextPost',
  '2': [
    {'1': 'text', '3': 1, '4': 1, '5': 9, '10': 'text'},
    {'1': 'hashtags', '3': 2, '4': 3, '5': 9, '10': 'hashtags'},
    {'1': 'mentions', '3': 3, '4': 3, '5': 9, '10': 'mentions'},
  ],
};

/// Descriptor for `TextPost`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List textPostDescriptor = $convert.base64Decode(
    'CghUZXh0UG9zdBISCgR0ZXh0GAEgASgJUgR0ZXh0EhoKCGhhc2h0YWdzGAIgAygJUghoYXNodG'
    'FncxIaCghtZW50aW9ucxgDIAMoCVIIbWVudGlvbnM=');

@$core.Deprecated('Use imagePostDescriptor instead')
const ImagePost$json = {
  '1': 'ImagePost',
  '2': [
    {'1': 'text', '3': 1, '4': 1, '5': 9, '10': 'text'},
    {
      '1': 'images',
      '3': 2,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.ImageAttachment',
      '10': 'images'
    },
    {'1': 'hashtags', '3': 3, '4': 3, '5': 9, '10': 'hashtags'},
    {'1': 'mentions', '3': 4, '4': 3, '5': 9, '10': 'mentions'},
  ],
};

/// Descriptor for `ImagePost`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List imagePostDescriptor = $convert.base64Decode(
    'CglJbWFnZVBvc3QSEgoEdGV4dBgBIAEoCVIEdGV4dBJECgZpbWFnZXMYAiADKAsyLC5wZWVyc1'
    '90b3VjaC5tb2RlbC5zb2NpYWwudjEuSW1hZ2VBdHRhY2htZW50UgZpbWFnZXMSGgoIaGFzaHRh'
    'Z3MYAyADKAlSCGhhc2h0YWdzEhoKCG1lbnRpb25zGAQgAygJUghtZW50aW9ucw==');

@$core.Deprecated('Use videoPostDescriptor instead')
const VideoPost$json = {
  '1': 'VideoPost',
  '2': [
    {'1': 'text', '3': 1, '4': 1, '5': 9, '10': 'text'},
    {
      '1': 'video',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.VideoAttachment',
      '10': 'video'
    },
    {'1': 'hashtags', '3': 3, '4': 3, '5': 9, '10': 'hashtags'},
    {'1': 'mentions', '3': 4, '4': 3, '5': 9, '10': 'mentions'},
  ],
};

/// Descriptor for `VideoPost`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List videoPostDescriptor = $convert.base64Decode(
    'CglWaWRlb1Bvc3QSEgoEdGV4dBgBIAEoCVIEdGV4dBJCCgV2aWRlbxgCIAEoCzIsLnBlZXJzX3'
    'RvdWNoLm1vZGVsLnNvY2lhbC52MS5WaWRlb0F0dGFjaG1lbnRSBXZpZGVvEhoKCGhhc2h0YWdz'
    'GAMgAygJUghoYXNodGFncxIaCghtZW50aW9ucxgEIAMoCVIIbWVudGlvbnM=');

@$core.Deprecated('Use linkPostDescriptor instead')
const LinkPost$json = {
  '1': 'LinkPost',
  '2': [
    {'1': 'text', '3': 1, '4': 1, '5': 9, '10': 'text'},
    {
      '1': 'link',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.LinkPreview',
      '10': 'link'
    },
    {'1': 'hashtags', '3': 3, '4': 3, '5': 9, '10': 'hashtags'},
    {'1': 'mentions', '3': 4, '4': 3, '5': 9, '10': 'mentions'},
  ],
};

/// Descriptor for `LinkPost`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List linkPostDescriptor = $convert.base64Decode(
    'CghMaW5rUG9zdBISCgR0ZXh0GAEgASgJUgR0ZXh0EjwKBGxpbmsYAiABKAsyKC5wZWVyc190b3'
    'VjaC5tb2RlbC5zb2NpYWwudjEuTGlua1ByZXZpZXdSBGxpbmsSGgoIaGFzaHRhZ3MYAyADKAlS'
    'CGhhc2h0YWdzEhoKCG1lbnRpb25zGAQgAygJUghtZW50aW9ucw==');

@$core.Deprecated('Use pollPostDescriptor instead')
const PollPost$json = {
  '1': 'PollPost',
  '2': [
    {'1': 'text', '3': 1, '4': 1, '5': 9, '10': 'text'},
    {
      '1': 'poll',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.activity.v1.Poll',
      '10': 'poll'
    },
    {'1': 'hashtags', '3': 3, '4': 3, '5': 9, '10': 'hashtags'},
    {'1': 'mentions', '3': 4, '4': 3, '5': 9, '10': 'mentions'},
  ],
};

/// Descriptor for `PollPost`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List pollPostDescriptor = $convert.base64Decode(
    'CghQb2xsUG9zdBISCgR0ZXh0GAEgASgJUgR0ZXh0EjcKBHBvbGwYAiABKAsyIy5wZWVyc190b3'
    'VjaC5tb2RlbC5hY3Rpdml0eS52MS5Qb2xsUgRwb2xsEhoKCGhhc2h0YWdzGAMgAygJUghoYXNo'
    'dGFncxIaCghtZW50aW9ucxgEIAMoCVIIbWVudGlvbnM=');

@$core.Deprecated('Use repostPostDescriptor instead')
const RepostPost$json = {
  '1': 'RepostPost',
  '2': [
    {'1': 'comment', '3': 1, '4': 1, '5': 9, '10': 'comment'},
    {'1': 'original_post_id', '3': 2, '4': 1, '5': 9, '10': 'originalPostId'},
    {
      '1': 'original_post',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Post',
      '10': 'originalPost'
    },
  ],
};

/// Descriptor for `RepostPost`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List repostPostDescriptor = $convert.base64Decode(
    'CgpSZXBvc3RQb3N0EhgKB2NvbW1lbnQYASABKAlSB2NvbW1lbnQSKAoQb3JpZ2luYWxfcG9zdF'
    '9pZBgCIAEoCVIOb3JpZ2luYWxQb3N0SWQSRgoNb3JpZ2luYWxfcG9zdBgDIAEoCzIhLnBlZXJz'
    'X3RvdWNoLm1vZGVsLnNvY2lhbC52MS5Qb3N0UgxvcmlnaW5hbFBvc3Q=');

@$core.Deprecated('Use locationPostDescriptor instead')
const LocationPost$json = {
  '1': 'LocationPost',
  '2': [
    {'1': 'text', '3': 1, '4': 1, '5': 9, '10': 'text'},
    {
      '1': 'location',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Location',
      '10': 'location'
    },
    {
      '1': 'images',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.ImageAttachment',
      '10': 'images'
    },
    {'1': 'hashtags', '3': 4, '4': 3, '5': 9, '10': 'hashtags'},
    {'1': 'mentions', '3': 5, '4': 3, '5': 9, '10': 'mentions'},
  ],
};

/// Descriptor for `LocationPost`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List locationPostDescriptor = $convert.base64Decode(
    'CgxMb2NhdGlvblBvc3QSEgoEdGV4dBgBIAEoCVIEdGV4dBJBCghsb2NhdGlvbhgCIAEoCzIlLn'
    'BlZXJzX3RvdWNoLm1vZGVsLnNvY2lhbC52MS5Mb2NhdGlvblIIbG9jYXRpb24SRAoGaW1hZ2Vz'
    'GAMgAygLMiwucGVlcnNfdG91Y2gubW9kZWwuc29jaWFsLnYxLkltYWdlQXR0YWNobWVudFIGaW'
    '1hZ2VzEhoKCGhhc2h0YWdzGAQgAygJUghoYXNodGFncxIaCghtZW50aW9ucxgFIAMoCVIIbWVu'
    'dGlvbnM=');

@$core.Deprecated('Use imageAttachmentDescriptor instead')
const ImageAttachment$json = {
  '1': 'ImageAttachment',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'url', '3': 2, '4': 1, '5': 9, '10': 'url'},
    {'1': 'thumbnail_url', '3': 3, '4': 1, '5': 9, '10': 'thumbnailUrl'},
    {'1': 'size_bytes', '3': 4, '4': 1, '5': 3, '10': 'sizeBytes'},
    {'1': 'width', '3': 5, '4': 1, '5': 5, '10': 'width'},
    {'1': 'height', '3': 6, '4': 1, '5': 5, '10': 'height'},
    {'1': 'blurhash', '3': 7, '4': 1, '5': 9, '10': 'blurhash'},
    {'1': 'alt_text', '3': 8, '4': 1, '5': 9, '10': 'altText'},
  ],
};

/// Descriptor for `ImageAttachment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List imageAttachmentDescriptor = $convert.base64Decode(
    'Cg9JbWFnZUF0dGFjaG1lbnQSDgoCaWQYASABKAlSAmlkEhAKA3VybBgCIAEoCVIDdXJsEiMKDX'
    'RodW1ibmFpbF91cmwYAyABKAlSDHRodW1ibmFpbFVybBIdCgpzaXplX2J5dGVzGAQgASgDUglz'
    'aXplQnl0ZXMSFAoFd2lkdGgYBSABKAVSBXdpZHRoEhYKBmhlaWdodBgGIAEoBVIGaGVpZ2h0Eh'
    'oKCGJsdXJoYXNoGAcgASgJUghibHVyaGFzaBIZCghhbHRfdGV4dBgIIAEoCVIHYWx0VGV4dA==');

@$core.Deprecated('Use videoAttachmentDescriptor instead')
const VideoAttachment$json = {
  '1': 'VideoAttachment',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'url', '3': 2, '4': 1, '5': 9, '10': 'url'},
    {'1': 'thumbnail_url', '3': 3, '4': 1, '5': 9, '10': 'thumbnailUrl'},
    {'1': 'size_bytes', '3': 4, '4': 1, '5': 3, '10': 'sizeBytes'},
    {'1': 'width', '3': 5, '4': 1, '5': 5, '10': 'width'},
    {'1': 'height', '3': 6, '4': 1, '5': 5, '10': 'height'},
    {'1': 'duration_seconds', '3': 7, '4': 1, '5': 5, '10': 'durationSeconds'},
    {'1': 'blurhash', '3': 8, '4': 1, '5': 9, '10': 'blurhash'},
    {
      '1': 'quality',
      '3': 9,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.social.v1.VideoQuality',
      '10': 'quality'
    },
    {
      '1': 'variants',
      '3': 10,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.VideoVariant',
      '10': 'variants'
    },
  ],
};

/// Descriptor for `VideoAttachment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List videoAttachmentDescriptor = $convert.base64Decode(
    'Cg9WaWRlb0F0dGFjaG1lbnQSDgoCaWQYASABKAlSAmlkEhAKA3VybBgCIAEoCVIDdXJsEiMKDX'
    'RodW1ibmFpbF91cmwYAyABKAlSDHRodW1ibmFpbFVybBIdCgpzaXplX2J5dGVzGAQgASgDUglz'
    'aXplQnl0ZXMSFAoFd2lkdGgYBSABKAVSBXdpZHRoEhYKBmhlaWdodBgGIAEoBVIGaGVpZ2h0Ei'
    'kKEGR1cmF0aW9uX3NlY29uZHMYByABKAVSD2R1cmF0aW9uU2Vjb25kcxIaCghibHVyaGFzaBgI'
    'IAEoCVIIYmx1cmhhc2gSQwoHcXVhbGl0eRgJIAEoDjIpLnBlZXJzX3RvdWNoLm1vZGVsLnNvY2'
    'lhbC52MS5WaWRlb1F1YWxpdHlSB3F1YWxpdHkSRQoIdmFyaWFudHMYCiADKAsyKS5wZWVyc190'
    'b3VjaC5tb2RlbC5zb2NpYWwudjEuVmlkZW9WYXJpYW50Ugh2YXJpYW50cw==');

@$core.Deprecated('Use videoVariantDescriptor instead')
const VideoVariant$json = {
  '1': 'VideoVariant',
  '2': [
    {'1': 'url', '3': 1, '4': 1, '5': 9, '10': 'url'},
    {'1': 'bitrate', '3': 2, '4': 1, '5': 5, '10': 'bitrate'},
    {'1': 'codec', '3': 3, '4': 1, '5': 9, '10': 'codec'},
    {'1': 'width', '3': 4, '4': 1, '5': 5, '10': 'width'},
    {'1': 'height', '3': 5, '4': 1, '5': 5, '10': 'height'},
  ],
};

/// Descriptor for `VideoVariant`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List videoVariantDescriptor = $convert.base64Decode(
    'CgxWaWRlb1ZhcmlhbnQSEAoDdXJsGAEgASgJUgN1cmwSGAoHYml0cmF0ZRgCIAEoBVIHYml0cm'
    'F0ZRIUCgVjb2RlYxgDIAEoCVIFY29kZWMSFAoFd2lkdGgYBCABKAVSBXdpZHRoEhYKBmhlaWdo'
    'dBgFIAEoBVIGaGVpZ2h0');

@$core.Deprecated('Use linkPreviewDescriptor instead')
const LinkPreview$json = {
  '1': 'LinkPreview',
  '2': [
    {'1': 'url', '3': 1, '4': 1, '5': 9, '10': 'url'},
    {'1': 'title', '3': 2, '4': 1, '5': 9, '10': 'title'},
    {'1': 'description', '3': 3, '4': 1, '5': 9, '10': 'description'},
    {'1': 'image_url', '3': 4, '4': 1, '5': 9, '10': 'imageUrl'},
    {'1': 'site_name', '3': 5, '4': 1, '5': 9, '10': 'siteName'},
    {'1': 'favicon_url', '3': 6, '4': 1, '5': 9, '10': 'faviconUrl'},
  ],
};

/// Descriptor for `LinkPreview`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List linkPreviewDescriptor = $convert.base64Decode(
    'CgtMaW5rUHJldmlldxIQCgN1cmwYASABKAlSA3VybBIUCgV0aXRsZRgCIAEoCVIFdGl0bGUSIA'
    'oLZGVzY3JpcHRpb24YAyABKAlSC2Rlc2NyaXB0aW9uEhsKCWltYWdlX3VybBgEIAEoCVIIaW1h'
    'Z2VVcmwSGwoJc2l0ZV9uYW1lGAUgASgJUghzaXRlTmFtZRIfCgtmYXZpY29uX3VybBgGIAEoCV'
    'IKZmF2aWNvblVybA==');

@$core.Deprecated('Use locationDescriptor instead')
const Location$json = {
  '1': 'Location',
  '2': [
    {'1': 'name', '3': 1, '4': 1, '5': 9, '10': 'name'},
    {'1': 'latitude', '3': 2, '4': 1, '5': 1, '10': 'latitude'},
    {'1': 'longitude', '3': 3, '4': 1, '5': 1, '10': 'longitude'},
    {'1': 'address', '3': 4, '4': 1, '5': 9, '10': 'address'},
    {'1': 'place_id', '3': 5, '4': 1, '5': 9, '10': 'placeId'},
  ],
};

/// Descriptor for `Location`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List locationDescriptor = $convert.base64Decode(
    'CghMb2NhdGlvbhISCgRuYW1lGAEgASgJUgRuYW1lEhoKCGxhdGl0dWRlGAIgASgBUghsYXRpdH'
    'VkZRIcCglsb25naXR1ZGUYAyABKAFSCWxvbmdpdHVkZRIYCgdhZGRyZXNzGAQgASgJUgdhZGRy'
    'ZXNzEhkKCHBsYWNlX2lkGAUgASgJUgdwbGFjZUlk');

@$core.Deprecated('Use createPostRequestDescriptor instead')
const CreatePostRequest$json = {
  '1': 'CreatePostRequest',
  '2': [
    {
      '1': 'type',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.social.v1.PostType',
      '10': 'type'
    },
    {
      '1': 'visibility',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.social.v1.PostVisibility',
      '10': 'visibility'
    },
    {'1': 'reply_to_post_id', '3': 3, '4': 1, '5': 9, '10': 'replyToPostId'},
    {
      '1': 'text',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.CreateTextPostRequest',
      '9': 0,
      '10': 'text'
    },
    {
      '1': 'image',
      '3': 11,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.CreateImagePostRequest',
      '9': 0,
      '10': 'image'
    },
    {
      '1': 'video',
      '3': 12,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.CreateVideoPostRequest',
      '9': 0,
      '10': 'video'
    },
    {
      '1': 'link',
      '3': 13,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.CreateLinkPostRequest',
      '9': 0,
      '10': 'link'
    },
    {
      '1': 'poll',
      '3': 14,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.CreatePollPostRequest',
      '9': 0,
      '10': 'poll'
    },
    {
      '1': 'repost',
      '3': 15,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.CreateRepostRequest',
      '9': 0,
      '10': 'repost'
    },
    {
      '1': 'location',
      '3': 16,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.CreateLocationPostRequest',
      '9': 0,
      '10': 'location'
    },
  ],
  '8': [
    {'1': 'content'},
  ],
};

/// Descriptor for `CreatePostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createPostRequestDescriptor = $convert.base64Decode(
    'ChFDcmVhdGVQb3N0UmVxdWVzdBI5CgR0eXBlGAEgASgOMiUucGVlcnNfdG91Y2gubW9kZWwuc2'
    '9jaWFsLnYxLlBvc3RUeXBlUgR0eXBlEksKCnZpc2liaWxpdHkYAiABKA4yKy5wZWVyc190b3Vj'
    'aC5tb2RlbC5zb2NpYWwudjEuUG9zdFZpc2liaWxpdHlSCnZpc2liaWxpdHkSJwoQcmVwbHlfdG'
    '9fcG9zdF9pZBgDIAEoCVINcmVwbHlUb1Bvc3RJZBJICgR0ZXh0GAogASgLMjIucGVlcnNfdG91'
    'Y2gubW9kZWwuc29jaWFsLnYxLkNyZWF0ZVRleHRQb3N0UmVxdWVzdEgAUgR0ZXh0EksKBWltYW'
    'dlGAsgASgLMjMucGVlcnNfdG91Y2gubW9kZWwuc29jaWFsLnYxLkNyZWF0ZUltYWdlUG9zdFJl'
    'cXVlc3RIAFIFaW1hZ2USSwoFdmlkZW8YDCABKAsyMy5wZWVyc190b3VjaC5tb2RlbC5zb2NpYW'
    'wudjEuQ3JlYXRlVmlkZW9Qb3N0UmVxdWVzdEgAUgV2aWRlbxJICgRsaW5rGA0gASgLMjIucGVl'
    'cnNfdG91Y2gubW9kZWwuc29jaWFsLnYxLkNyZWF0ZUxpbmtQb3N0UmVxdWVzdEgAUgRsaW5rEk'
    'gKBHBvbGwYDiABKAsyMi5wZWVyc190b3VjaC5tb2RlbC5zb2NpYWwudjEuQ3JlYXRlUG9sbFBv'
    'c3RSZXF1ZXN0SABSBHBvbGwSSgoGcmVwb3N0GA8gASgLMjAucGVlcnNfdG91Y2gubW9kZWwuc2'
    '9jaWFsLnYxLkNyZWF0ZVJlcG9zdFJlcXVlc3RIAFIGcmVwb3N0ElQKCGxvY2F0aW9uGBAgASgL'
    'MjYucGVlcnNfdG91Y2gubW9kZWwuc29jaWFsLnYxLkNyZWF0ZUxvY2F0aW9uUG9zdFJlcXVlc3'
    'RIAFIIbG9jYXRpb25CCQoHY29udGVudA==');

@$core.Deprecated('Use createTextPostRequestDescriptor instead')
const CreateTextPostRequest$json = {
  '1': 'CreateTextPostRequest',
  '2': [
    {'1': 'text', '3': 1, '4': 1, '5': 9, '10': 'text'},
  ],
};

/// Descriptor for `CreateTextPostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createTextPostRequestDescriptor =
    $convert.base64Decode(
        'ChVDcmVhdGVUZXh0UG9zdFJlcXVlc3QSEgoEdGV4dBgBIAEoCVIEdGV4dA==');

@$core.Deprecated('Use createImagePostRequestDescriptor instead')
const CreateImagePostRequest$json = {
  '1': 'CreateImagePostRequest',
  '2': [
    {'1': 'text', '3': 1, '4': 1, '5': 9, '10': 'text'},
    {'1': 'image_ids', '3': 2, '4': 3, '5': 9, '10': 'imageIds'},
  ],
};

/// Descriptor for `CreateImagePostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createImagePostRequestDescriptor =
    $convert.base64Decode(
        'ChZDcmVhdGVJbWFnZVBvc3RSZXF1ZXN0EhIKBHRleHQYASABKAlSBHRleHQSGwoJaW1hZ2VfaW'
        'RzGAIgAygJUghpbWFnZUlkcw==');

@$core.Deprecated('Use createVideoPostRequestDescriptor instead')
const CreateVideoPostRequest$json = {
  '1': 'CreateVideoPostRequest',
  '2': [
    {'1': 'text', '3': 1, '4': 1, '5': 9, '10': 'text'},
    {'1': 'video_id', '3': 2, '4': 1, '5': 9, '10': 'videoId'},
  ],
};

/// Descriptor for `CreateVideoPostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createVideoPostRequestDescriptor =
    $convert.base64Decode(
        'ChZDcmVhdGVWaWRlb1Bvc3RSZXF1ZXN0EhIKBHRleHQYASABKAlSBHRleHQSGQoIdmlkZW9faW'
        'QYAiABKAlSB3ZpZGVvSWQ=');

@$core.Deprecated('Use createLinkPostRequestDescriptor instead')
const CreateLinkPostRequest$json = {
  '1': 'CreateLinkPostRequest',
  '2': [
    {'1': 'text', '3': 1, '4': 1, '5': 9, '10': 'text'},
    {'1': 'url', '3': 2, '4': 1, '5': 9, '10': 'url'},
  ],
};

/// Descriptor for `CreateLinkPostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createLinkPostRequestDescriptor = $convert.base64Decode(
    'ChVDcmVhdGVMaW5rUG9zdFJlcXVlc3QSEgoEdGV4dBgBIAEoCVIEdGV4dBIQCgN1cmwYAiABKA'
    'lSA3VybA==');

@$core.Deprecated('Use createPollPostRequestDescriptor instead')
const CreatePollPostRequest$json = {
  '1': 'CreatePollPostRequest',
  '2': [
    {'1': 'text', '3': 1, '4': 1, '5': 9, '10': 'text'},
    {'1': 'question', '3': 2, '4': 1, '5': 9, '10': 'question'},
    {'1': 'options', '3': 3, '4': 3, '5': 9, '10': 'options'},
    {'1': 'duration_hours', '3': 4, '4': 1, '5': 5, '10': 'durationHours'},
    {'1': 'multiple_choice', '3': 5, '4': 1, '5': 8, '10': 'multipleChoice'},
  ],
};

/// Descriptor for `CreatePollPostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createPollPostRequestDescriptor = $convert.base64Decode(
    'ChVDcmVhdGVQb2xsUG9zdFJlcXVlc3QSEgoEdGV4dBgBIAEoCVIEdGV4dBIaCghxdWVzdGlvbh'
    'gCIAEoCVIIcXVlc3Rpb24SGAoHb3B0aW9ucxgDIAMoCVIHb3B0aW9ucxIlCg5kdXJhdGlvbl9o'
    'b3VycxgEIAEoBVINZHVyYXRpb25Ib3VycxInCg9tdWx0aXBsZV9jaG9pY2UYBSABKAhSDm11bH'
    'RpcGxlQ2hvaWNl');

@$core.Deprecated('Use createRepostRequestDescriptor instead')
const CreateRepostRequest$json = {
  '1': 'CreateRepostRequest',
  '2': [
    {'1': 'original_post_id', '3': 1, '4': 1, '5': 9, '10': 'originalPostId'},
    {'1': 'comment', '3': 2, '4': 1, '5': 9, '10': 'comment'},
  ],
};

/// Descriptor for `CreateRepostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createRepostRequestDescriptor = $convert.base64Decode(
    'ChNDcmVhdGVSZXBvc3RSZXF1ZXN0EigKEG9yaWdpbmFsX3Bvc3RfaWQYASABKAlSDm9yaWdpbm'
    'FsUG9zdElkEhgKB2NvbW1lbnQYAiABKAlSB2NvbW1lbnQ=');

@$core.Deprecated('Use createLocationPostRequestDescriptor instead')
const CreateLocationPostRequest$json = {
  '1': 'CreateLocationPostRequest',
  '2': [
    {'1': 'text', '3': 1, '4': 1, '5': 9, '10': 'text'},
    {'1': 'image_ids', '3': 2, '4': 3, '5': 9, '10': 'imageIds'},
    {
      '1': 'location',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Location',
      '10': 'location'
    },
  ],
};

/// Descriptor for `CreateLocationPostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createLocationPostRequestDescriptor = $convert.base64Decode(
    'ChlDcmVhdGVMb2NhdGlvblBvc3RSZXF1ZXN0EhIKBHRleHQYASABKAlSBHRleHQSGwoJaW1hZ2'
    'VfaWRzGAIgAygJUghpbWFnZUlkcxJBCghsb2NhdGlvbhgDIAEoCzIlLnBlZXJzX3RvdWNoLm1v'
    'ZGVsLnNvY2lhbC52MS5Mb2NhdGlvblIIbG9jYXRpb24=');

@$core.Deprecated('Use createPostResponseDescriptor instead')
const CreatePostResponse$json = {
  '1': 'CreatePostResponse',
  '2': [
    {
      '1': 'post',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Post',
      '10': 'post'
    },
  ],
};

/// Descriptor for `CreatePostResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createPostResponseDescriptor = $convert.base64Decode(
    'ChJDcmVhdGVQb3N0UmVzcG9uc2USNQoEcG9zdBgBIAEoCzIhLnBlZXJzX3RvdWNoLm1vZGVsLn'
    'NvY2lhbC52MS5Qb3N0UgRwb3N0');

@$core.Deprecated('Use updatePostRequestDescriptor instead')
const UpdatePostRequest$json = {
  '1': 'UpdatePostRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 9, '10': 'postId'},
    {
      '1': 'content',
      '3': 2,
      '4': 1,
      '5': 9,
      '9': 0,
      '10': 'content',
      '17': true
    },
    {
      '1': 'visibility',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.social.v1.PostVisibility',
      '9': 1,
      '10': 'visibility',
      '17': true
    },
  ],
  '8': [
    {'1': '_content'},
    {'1': '_visibility'},
  ],
};

/// Descriptor for `UpdatePostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updatePostRequestDescriptor = $convert.base64Decode(
    'ChFVcGRhdGVQb3N0UmVxdWVzdBIXCgdwb3N0X2lkGAEgASgJUgZwb3N0SWQSHQoHY29udGVudB'
    'gCIAEoCUgAUgdjb250ZW50iAEBElAKCnZpc2liaWxpdHkYAyABKA4yKy5wZWVyc190b3VjaC5t'
    'b2RlbC5zb2NpYWwudjEuUG9zdFZpc2liaWxpdHlIAVIKdmlzaWJpbGl0eYgBAUIKCghfY29udG'
    'VudEINCgtfdmlzaWJpbGl0eQ==');

@$core.Deprecated('Use updatePostResponseDescriptor instead')
const UpdatePostResponse$json = {
  '1': 'UpdatePostResponse',
  '2': [
    {
      '1': 'post',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Post',
      '10': 'post'
    },
  ],
};

/// Descriptor for `UpdatePostResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updatePostResponseDescriptor = $convert.base64Decode(
    'ChJVcGRhdGVQb3N0UmVzcG9uc2USNQoEcG9zdBgBIAEoCzIhLnBlZXJzX3RvdWNoLm1vZGVsLn'
    'NvY2lhbC52MS5Qb3N0UgRwb3N0');

@$core.Deprecated('Use deletePostRequestDescriptor instead')
const DeletePostRequest$json = {
  '1': 'DeletePostRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 9, '10': 'postId'},
  ],
};

/// Descriptor for `DeletePostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deletePostRequestDescriptor = $convert.base64Decode(
    'ChFEZWxldGVQb3N0UmVxdWVzdBIXCgdwb3N0X2lkGAEgASgJUgZwb3N0SWQ=');

@$core.Deprecated('Use deletePostResponseDescriptor instead')
const DeletePostResponse$json = {
  '1': 'DeletePostResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `DeletePostResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deletePostResponseDescriptor =
    $convert.base64Decode(
        'ChJEZWxldGVQb3N0UmVzcG9uc2USGAoHc3VjY2VzcxgBIAEoCFIHc3VjY2Vzcw==');

@$core.Deprecated('Use getPostRequestDescriptor instead')
const GetPostRequest$json = {
  '1': 'GetPostRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 9, '10': 'postId'},
  ],
};

/// Descriptor for `GetPostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPostRequestDescriptor = $convert
    .base64Decode('Cg5HZXRQb3N0UmVxdWVzdBIXCgdwb3N0X2lkGAEgASgJUgZwb3N0SWQ=');

@$core.Deprecated('Use getPostResponseDescriptor instead')
const GetPostResponse$json = {
  '1': 'GetPostResponse',
  '2': [
    {
      '1': 'post',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Post',
      '10': 'post'
    },
  ],
};

/// Descriptor for `GetPostResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPostResponseDescriptor = $convert.base64Decode(
    'Cg9HZXRQb3N0UmVzcG9uc2USNQoEcG9zdBgBIAEoCzIhLnBlZXJzX3RvdWNoLm1vZGVsLnNvY2'
    'lhbC52MS5Qb3N0UgRwb3N0');

@$core.Deprecated('Use listPostsRequestDescriptor instead')
const ListPostsRequest$json = {
  '1': 'ListPostsRequest',
  '2': [
    {'1': 'cursor', '3': 1, '4': 1, '5': 9, '10': 'cursor'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
    {
      '1': 'filter',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.PostFilter',
      '10': 'filter'
    },
  ],
};

/// Descriptor for `ListPostsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPostsRequestDescriptor = $convert.base64Decode(
    'ChBMaXN0UG9zdHNSZXF1ZXN0EhYKBmN1cnNvchgBIAEoCVIGY3Vyc29yEhQKBWxpbWl0GAIgAS'
    'gFUgVsaW1pdBI/CgZmaWx0ZXIYAyABKAsyJy5wZWVyc190b3VjaC5tb2RlbC5zb2NpYWwudjEu'
    'UG9zdEZpbHRlclIGZmlsdGVy');

@$core.Deprecated('Use listPostsResponseDescriptor instead')
const ListPostsResponse$json = {
  '1': 'ListPostsResponse',
  '2': [
    {
      '1': 'posts',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Post',
      '10': 'posts'
    },
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
    {'1': 'has_more', '3': 3, '4': 1, '5': 8, '10': 'hasMore'},
  ],
};

/// Descriptor for `ListPostsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPostsResponseDescriptor = $convert.base64Decode(
    'ChFMaXN0UG9zdHNSZXNwb25zZRI3CgVwb3N0cxgBIAMoCzIhLnBlZXJzX3RvdWNoLm1vZGVsLn'
    'NvY2lhbC52MS5Qb3N0UgVwb3N0cxIfCgtuZXh0X2N1cnNvchgCIAEoCVIKbmV4dEN1cnNvchIZ'
    'CghoYXNfbW9yZRgDIAEoCFIHaGFzTW9yZQ==');

@$core.Deprecated('Use postFilterDescriptor instead')
const PostFilter$json = {
  '1': 'PostFilter',
  '2': [
    {'1': 'author_id', '3': 1, '4': 1, '5': 9, '10': 'authorId'},
    {
      '1': 'visibility',
      '3': 2,
      '4': 3,
      '5': 14,
      '6': '.peers_touch.model.social.v1.PostVisibility',
      '10': 'visibility'
    },
    {'1': 'exclude_replies', '3': 3, '4': 1, '5': 8, '10': 'excludeReplies'},
    {'1': 'exclude_reposts', '3': 4, '4': 1, '5': 8, '10': 'excludeReposts'},
  ],
};

/// Descriptor for `PostFilter`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postFilterDescriptor = $convert.base64Decode(
    'CgpQb3N0RmlsdGVyEhsKCWF1dGhvcl9pZBgBIAEoCVIIYXV0aG9ySWQSSwoKdmlzaWJpbGl0eR'
    'gCIAMoDjIrLnBlZXJzX3RvdWNoLm1vZGVsLnNvY2lhbC52MS5Qb3N0VmlzaWJpbGl0eVIKdmlz'
    'aWJpbGl0eRInCg9leGNsdWRlX3JlcGxpZXMYAyABKAhSDmV4Y2x1ZGVSZXBsaWVzEicKD2V4Y2'
    'x1ZGVfcmVwb3N0cxgEIAEoCFIOZXhjbHVkZVJlcG9zdHM=');

@$core.Deprecated('Use getTimelineRequestDescriptor instead')
const GetTimelineRequest$json = {
  '1': 'GetTimelineRequest',
  '2': [
    {
      '1': 'type',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.social.v1.TimelineType',
      '10': 'type'
    },
    {'1': 'cursor', '3': 2, '4': 1, '5': 9, '10': 'cursor'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'user_id', '3': 4, '4': 1, '5': 9, '10': 'userId'},
  ],
};

/// Descriptor for `GetTimelineRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getTimelineRequestDescriptor = $convert.base64Decode(
    'ChJHZXRUaW1lbGluZVJlcXVlc3QSPQoEdHlwZRgBIAEoDjIpLnBlZXJzX3RvdWNoLm1vZGVsLn'
    'NvY2lhbC52MS5UaW1lbGluZVR5cGVSBHR5cGUSFgoGY3Vyc29yGAIgASgJUgZjdXJzb3ISFAoF'
    'bGltaXQYAyABKAVSBWxpbWl0EhcKB3VzZXJfaWQYBCABKAlSBnVzZXJJZA==');

@$core.Deprecated('Use getTimelineResponseDescriptor instead')
const GetTimelineResponse$json = {
  '1': 'GetTimelineResponse',
  '2': [
    {
      '1': 'posts',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Post',
      '10': 'posts'
    },
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
    {'1': 'has_more', '3': 3, '4': 1, '5': 8, '10': 'hasMore'},
  ],
};

/// Descriptor for `GetTimelineResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getTimelineResponseDescriptor = $convert.base64Decode(
    'ChNHZXRUaW1lbGluZVJlc3BvbnNlEjcKBXBvc3RzGAEgAygLMiEucGVlcnNfdG91Y2gubW9kZW'
    'wuc29jaWFsLnYxLlBvc3RSBXBvc3RzEh8KC25leHRfY3Vyc29yGAIgASgJUgpuZXh0Q3Vyc29y'
    'EhkKCGhhc19tb3JlGAMgASgIUgdoYXNNb3Jl');

@$core.Deprecated('Use likePostRequestDescriptor instead')
const LikePostRequest$json = {
  '1': 'LikePostRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 9, '10': 'postId'},
  ],
};

/// Descriptor for `LikePostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List likePostRequestDescriptor = $convert
    .base64Decode('Cg9MaWtlUG9zdFJlcXVlc3QSFwoHcG9zdF9pZBgBIAEoCVIGcG9zdElk');

@$core.Deprecated('Use likePostResponseDescriptor instead')
const LikePostResponse$json = {
  '1': 'LikePostResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
    {'1': 'new_likes_count', '3': 2, '4': 1, '5': 3, '10': 'newLikesCount'},
  ],
};

/// Descriptor for `LikePostResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List likePostResponseDescriptor = $convert.base64Decode(
    'ChBMaWtlUG9zdFJlc3BvbnNlEhgKB3N1Y2Nlc3MYASABKAhSB3N1Y2Nlc3MSJgoPbmV3X2xpa2'
    'VzX2NvdW50GAIgASgDUg1uZXdMaWtlc0NvdW50');

@$core.Deprecated('Use unlikePostRequestDescriptor instead')
const UnlikePostRequest$json = {
  '1': 'UnlikePostRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 9, '10': 'postId'},
  ],
};

/// Descriptor for `UnlikePostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unlikePostRequestDescriptor = $convert.base64Decode(
    'ChFVbmxpa2VQb3N0UmVxdWVzdBIXCgdwb3N0X2lkGAEgASgJUgZwb3N0SWQ=');

@$core.Deprecated('Use unlikePostResponseDescriptor instead')
const UnlikePostResponse$json = {
  '1': 'UnlikePostResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
    {'1': 'new_likes_count', '3': 2, '4': 1, '5': 3, '10': 'newLikesCount'},
  ],
};

/// Descriptor for `UnlikePostResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unlikePostResponseDescriptor = $convert.base64Decode(
    'ChJVbmxpa2VQb3N0UmVzcG9uc2USGAoHc3VjY2VzcxgBIAEoCFIHc3VjY2VzcxImCg9uZXdfbG'
    'lrZXNfY291bnQYAiABKANSDW5ld0xpa2VzQ291bnQ=');

@$core.Deprecated('Use repostRequestDescriptor instead')
const RepostRequest$json = {
  '1': 'RepostRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 9, '10': 'postId'},
    {
      '1': 'comment',
      '3': 2,
      '4': 1,
      '5': 9,
      '9': 0,
      '10': 'comment',
      '17': true
    },
  ],
  '8': [
    {'1': '_comment'},
  ],
};

/// Descriptor for `RepostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List repostRequestDescriptor = $convert.base64Decode(
    'Cg1SZXBvc3RSZXF1ZXN0EhcKB3Bvc3RfaWQYASABKAlSBnBvc3RJZBIdCgdjb21tZW50GAIgAS'
    'gJSABSB2NvbW1lbnSIAQFCCgoIX2NvbW1lbnQ=');

@$core.Deprecated('Use repostResponseDescriptor instead')
const RepostResponse$json = {
  '1': 'RepostResponse',
  '2': [
    {
      '1': 'repost',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Post',
      '10': 'repost'
    },
  ],
};

/// Descriptor for `RepostResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List repostResponseDescriptor = $convert.base64Decode(
    'Cg5SZXBvc3RSZXNwb25zZRI5CgZyZXBvc3QYASABKAsyIS5wZWVyc190b3VjaC5tb2RlbC5zb2'
    'NpYWwudjEuUG9zdFIGcmVwb3N0');

@$core.Deprecated('Use getPostLikersRequestDescriptor instead')
const GetPostLikersRequest$json = {
  '1': 'GetPostLikersRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 9, '10': 'postId'},
    {'1': 'cursor', '3': 2, '4': 1, '5': 9, '10': 'cursor'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `GetPostLikersRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPostLikersRequestDescriptor = $convert.base64Decode(
    'ChRHZXRQb3N0TGlrZXJzUmVxdWVzdBIXCgdwb3N0X2lkGAEgASgJUgZwb3N0SWQSFgoGY3Vyc2'
    '9yGAIgASgJUgZjdXJzb3ISFAoFbGltaXQYAyABKAVSBWxpbWl0');

@$core.Deprecated('Use getPostLikersResponseDescriptor instead')
const GetPostLikersResponse$json = {
  '1': 'GetPostLikersResponse',
  '2': [
    {
      '1': 'users',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.PostAuthor',
      '10': 'users'
    },
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
    {'1': 'has_more', '3': 3, '4': 1, '5': 8, '10': 'hasMore'},
  ],
};

/// Descriptor for `GetPostLikersResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPostLikersResponseDescriptor = $convert.base64Decode(
    'ChVHZXRQb3N0TGlrZXJzUmVzcG9uc2USPQoFdXNlcnMYASADKAsyJy5wZWVyc190b3VjaC5tb2'
    'RlbC5zb2NpYWwudjEuUG9zdEF1dGhvclIFdXNlcnMSHwoLbmV4dF9jdXJzb3IYAiABKAlSCm5l'
    'eHRDdXJzb3ISGQoIaGFzX21vcmUYAyABKAhSB2hhc01vcmU=');
