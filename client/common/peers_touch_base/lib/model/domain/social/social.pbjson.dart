// This is a generated file - do not edit.
//
// Generated from domain/social/social.proto.

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

@$core.Deprecated('Use getTimelineRequestDescriptor instead')
const GetTimelineRequest$json = {
  '1': 'GetTimelineRequest',
  '2': [
    {'1': 'user_did', '3': 1, '4': 1, '5': 9, '10': 'userDid'},
    {'1': 'before_ts', '3': 2, '4': 1, '5': 3, '10': 'beforeTs'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `GetTimelineRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getTimelineRequestDescriptor = $convert.base64Decode(
    'ChJHZXRUaW1lbGluZVJlcXVlc3QSGQoIdXNlcl9kaWQYASABKAlSB3VzZXJEaWQSGwoJYmVmb3'
    'JlX3RzGAIgASgDUghiZWZvcmVUcxIUCgVsaW1pdBgDIAEoBVIFbGltaXQ=');

@$core.Deprecated('Use postDescriptor instead')
const Post$json = {
  '1': 'Post',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 4, '10': 'id'},
    {'1': 'author_did', '3': 2, '4': 1, '5': 9, '10': 'authorDid'},
    {'1': 'content', '3': 3, '4': 1, '5': 9, '10': 'content'},
    {'1': 'media_urls', '3': 4, '4': 3, '5': 9, '10': 'mediaUrls'},
    {'1': 'like_count', '3': 5, '4': 1, '5': 3, '10': 'likeCount'},
    {'1': 'repost_count', '3': 6, '4': 1, '5': 3, '10': 'repostCount'},
    {'1': 'comment_count', '3': 7, '4': 1, '5': 3, '10': 'commentCount'},
    {'1': 'liked_by_me', '3': 8, '4': 1, '5': 8, '10': 'likedByMe'},
    {'1': 'reposted_by_me', '3': 9, '4': 1, '5': 8, '10': 'repostedByMe'},
    {
      '1': 'created_at',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'updated_at',
      '3': 11,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
  ],
};

/// Descriptor for `Post`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postDescriptor = $convert.base64Decode(
    'CgRQb3N0Eg4KAmlkGAEgASgEUgJpZBIdCgphdXRob3JfZGlkGAIgASgJUglhdXRob3JEaWQSGA'
    'oHY29udGVudBgDIAEoCVIHY29udGVudBIdCgptZWRpYV91cmxzGAQgAygJUgltZWRpYVVybHMS'
    'HQoKbGlrZV9jb3VudBgFIAEoA1IJbGlrZUNvdW50EiEKDHJlcG9zdF9jb3VudBgGIAEoA1ILcm'
    'Vwb3N0Q291bnQSIwoNY29tbWVudF9jb3VudBgHIAEoA1IMY29tbWVudENvdW50Eh4KC2xpa2Vk'
    'X2J5X21lGAggASgIUglsaWtlZEJ5TWUSJAoOcmVwb3N0ZWRfYnlfbWUYCSABKAhSDHJlcG9zdG'
    'VkQnlNZRI5CgpjcmVhdGVkX2F0GAogASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJ'
    'Y3JlYXRlZEF0EjkKCnVwZGF0ZWRfYXQYCyABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW'
    '1wUgl1cGRhdGVkQXQ=');

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
    {'1': 'has_more', '3': 2, '4': 1, '5': 8, '10': 'hasMore'},
  ],
};

/// Descriptor for `GetTimelineResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getTimelineResponseDescriptor = $convert.base64Decode(
    'ChNHZXRUaW1lbGluZVJlc3BvbnNlEjcKBXBvc3RzGAEgAygLMiEucGVlcnNfdG91Y2gubW9kZW'
    'wuc29jaWFsLnYxLlBvc3RSBXBvc3RzEhkKCGhhc19tb3JlGAIgASgIUgdoYXNNb3Jl');

@$core.Deprecated('Use createPostRequestDescriptor instead')
const CreatePostRequest$json = {
  '1': 'CreatePostRequest',
  '2': [
    {'1': 'content', '3': 1, '4': 1, '5': 9, '10': 'content'},
    {'1': 'media_urls', '3': 2, '4': 3, '5': 9, '10': 'mediaUrls'},
  ],
};

/// Descriptor for `CreatePostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createPostRequestDescriptor = $convert.base64Decode(
    'ChFDcmVhdGVQb3N0UmVxdWVzdBIYCgdjb250ZW50GAEgASgJUgdjb250ZW50Eh0KCm1lZGlhX3'
    'VybHMYAiADKAlSCW1lZGlhVXJscw==');

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

@$core.Deprecated('Use getPostRequestDescriptor instead')
const GetPostRequest$json = {
  '1': 'GetPostRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 4, '10': 'postId'},
  ],
};

/// Descriptor for `GetPostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPostRequestDescriptor = $convert
    .base64Decode('Cg5HZXRQb3N0UmVxdWVzdBIXCgdwb3N0X2lkGAEgASgEUgZwb3N0SWQ=');

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

@$core.Deprecated('Use updatePostRequestDescriptor instead')
const UpdatePostRequest$json = {
  '1': 'UpdatePostRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 4, '10': 'postId'},
    {'1': 'content', '3': 2, '4': 1, '5': 9, '10': 'content'},
  ],
};

/// Descriptor for `UpdatePostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updatePostRequestDescriptor = $convert.base64Decode(
    'ChFVcGRhdGVQb3N0UmVxdWVzdBIXCgdwb3N0X2lkGAEgASgEUgZwb3N0SWQSGAoHY29udGVudB'
    'gCIAEoCVIHY29udGVudA==');

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
    {'1': 'post_id', '3': 1, '4': 1, '5': 4, '10': 'postId'},
  ],
};

/// Descriptor for `DeletePostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deletePostRequestDescriptor = $convert.base64Decode(
    'ChFEZWxldGVQb3N0UmVxdWVzdBIXCgdwb3N0X2lkGAEgASgEUgZwb3N0SWQ=');

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

@$core.Deprecated('Use getUserPostsRequestDescriptor instead')
const GetUserPostsRequest$json = {
  '1': 'GetUserPostsRequest',
  '2': [
    {'1': 'user_did', '3': 1, '4': 1, '5': 9, '10': 'userDid'},
    {'1': 'before_ts', '3': 2, '4': 1, '5': 3, '10': 'beforeTs'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `GetUserPostsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserPostsRequestDescriptor = $convert.base64Decode(
    'ChNHZXRVc2VyUG9zdHNSZXF1ZXN0EhkKCHVzZXJfZGlkGAEgASgJUgd1c2VyRGlkEhsKCWJlZm'
    '9yZV90cxgCIAEoA1IIYmVmb3JlVHMSFAoFbGltaXQYAyABKAVSBWxpbWl0');

@$core.Deprecated('Use getUserPostsResponseDescriptor instead')
const GetUserPostsResponse$json = {
  '1': 'GetUserPostsResponse',
  '2': [
    {
      '1': 'posts',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Post',
      '10': 'posts'
    },
    {'1': 'has_more', '3': 2, '4': 1, '5': 8, '10': 'hasMore'},
  ],
};

/// Descriptor for `GetUserPostsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserPostsResponseDescriptor = $convert.base64Decode(
    'ChRHZXRVc2VyUG9zdHNSZXNwb25zZRI3CgVwb3N0cxgBIAMoCzIhLnBlZXJzX3RvdWNoLm1vZG'
    'VsLnNvY2lhbC52MS5Qb3N0UgVwb3N0cxIZCghoYXNfbW9yZRgCIAEoCFIHaGFzTW9yZQ==');

@$core.Deprecated('Use likePostRequestDescriptor instead')
const LikePostRequest$json = {
  '1': 'LikePostRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 4, '10': 'postId'},
  ],
};

/// Descriptor for `LikePostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List likePostRequestDescriptor = $convert
    .base64Decode('Cg9MaWtlUG9zdFJlcXVlc3QSFwoHcG9zdF9pZBgBIAEoBFIGcG9zdElk');

@$core.Deprecated('Use likePostResponseDescriptor instead')
const LikePostResponse$json = {
  '1': 'LikePostResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `LikePostResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List likePostResponseDescriptor = $convert.base64Decode(
    'ChBMaWtlUG9zdFJlc3BvbnNlEhgKB3N1Y2Nlc3MYASABKAhSB3N1Y2Nlc3M=');

@$core.Deprecated('Use unlikePostRequestDescriptor instead')
const UnlikePostRequest$json = {
  '1': 'UnlikePostRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 4, '10': 'postId'},
  ],
};

/// Descriptor for `UnlikePostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unlikePostRequestDescriptor = $convert.base64Decode(
    'ChFVbmxpa2VQb3N0UmVxdWVzdBIXCgdwb3N0X2lkGAEgASgEUgZwb3N0SWQ=');

@$core.Deprecated('Use unlikePostResponseDescriptor instead')
const UnlikePostResponse$json = {
  '1': 'UnlikePostResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `UnlikePostResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unlikePostResponseDescriptor =
    $convert.base64Decode(
        'ChJVbmxpa2VQb3N0UmVzcG9uc2USGAoHc3VjY2VzcxgBIAEoCFIHc3VjY2Vzcw==');

@$core.Deprecated('Use getPostLikersRequestDescriptor instead')
const GetPostLikersRequest$json = {
  '1': 'GetPostLikersRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 4, '10': 'postId'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `GetPostLikersRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPostLikersRequestDescriptor = $convert.base64Decode(
    'ChRHZXRQb3N0TGlrZXJzUmVxdWVzdBIXCgdwb3N0X2lkGAEgASgEUgZwb3N0SWQSFAoFbGltaX'
    'QYAiABKAVSBWxpbWl0');

@$core.Deprecated('Use userInfoDescriptor instead')
const UserInfo$json = {
  '1': 'UserInfo',
  '2': [
    {'1': 'did', '3': 1, '4': 1, '5': 9, '10': 'did'},
    {'1': 'handle', '3': 2, '4': 1, '5': 9, '10': 'handle'},
    {'1': 'display_name', '3': 3, '4': 1, '5': 9, '10': 'displayName'},
    {'1': 'avatar_url', '3': 4, '4': 1, '5': 9, '10': 'avatarUrl'},
  ],
};

/// Descriptor for `UserInfo`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List userInfoDescriptor = $convert.base64Decode(
    'CghVc2VySW5mbxIQCgNkaWQYASABKAlSA2RpZBIWCgZoYW5kbGUYAiABKAlSBmhhbmRsZRIhCg'
    'xkaXNwbGF5X25hbWUYAyABKAlSC2Rpc3BsYXlOYW1lEh0KCmF2YXRhcl91cmwYBCABKAlSCWF2'
    'YXRhclVybA==');

@$core.Deprecated('Use getPostLikersResponseDescriptor instead')
const GetPostLikersResponse$json = {
  '1': 'GetPostLikersResponse',
  '2': [
    {
      '1': 'users',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.UserInfo',
      '10': 'users'
    },
  ],
};

/// Descriptor for `GetPostLikersResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPostLikersResponseDescriptor = $convert.base64Decode(
    'ChVHZXRQb3N0TGlrZXJzUmVzcG9uc2USOwoFdXNlcnMYASADKAsyJS5wZWVyc190b3VjaC5tb2'
    'RlbC5zb2NpYWwudjEuVXNlckluZm9SBXVzZXJz');

@$core.Deprecated('Use repostPostRequestDescriptor instead')
const RepostPostRequest$json = {
  '1': 'RepostPostRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 4, '10': 'postId'},
    {'1': 'comment', '3': 2, '4': 1, '5': 9, '10': 'comment'},
  ],
};

/// Descriptor for `RepostPostRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List repostPostRequestDescriptor = $convert.base64Decode(
    'ChFSZXBvc3RQb3N0UmVxdWVzdBIXCgdwb3N0X2lkGAEgASgEUgZwb3N0SWQSGAoHY29tbWVudB'
    'gCIAEoCVIHY29tbWVudA==');

@$core.Deprecated('Use repostPostResponseDescriptor instead')
const RepostPostResponse$json = {
  '1': 'RepostPostResponse',
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

/// Descriptor for `RepostPostResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List repostPostResponseDescriptor = $convert.base64Decode(
    'ChJSZXBvc3RQb3N0UmVzcG9uc2USOQoGcmVwb3N0GAEgASgLMiEucGVlcnNfdG91Y2gubW9kZW'
    'wuc29jaWFsLnYxLlBvc3RSBnJlcG9zdA==');

@$core.Deprecated('Use getPostCommentsRequestDescriptor instead')
const GetPostCommentsRequest$json = {
  '1': 'GetPostCommentsRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 4, '10': 'postId'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `GetPostCommentsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPostCommentsRequestDescriptor =
    $convert.base64Decode(
        'ChZHZXRQb3N0Q29tbWVudHNSZXF1ZXN0EhcKB3Bvc3RfaWQYASABKARSBnBvc3RJZBIUCgVsaW'
        '1pdBgCIAEoBVIFbGltaXQ=');

@$core.Deprecated('Use commentDescriptor instead')
const Comment$json = {
  '1': 'Comment',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 4, '10': 'id'},
    {'1': 'post_id', '3': 2, '4': 1, '5': 4, '10': 'postId'},
    {'1': 'author_did', '3': 3, '4': 1, '5': 9, '10': 'authorDid'},
    {'1': 'content', '3': 4, '4': 1, '5': 9, '10': 'content'},
    {'1': 'like_count', '3': 5, '4': 1, '5': 3, '10': 'likeCount'},
    {
      '1': 'created_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
  ],
};

/// Descriptor for `Comment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List commentDescriptor = $convert.base64Decode(
    'CgdDb21tZW50Eg4KAmlkGAEgASgEUgJpZBIXCgdwb3N0X2lkGAIgASgEUgZwb3N0SWQSHQoKYX'
    'V0aG9yX2RpZBgDIAEoCVIJYXV0aG9yRGlkEhgKB2NvbnRlbnQYBCABKAlSB2NvbnRlbnQSHQoK'
    'bGlrZV9jb3VudBgFIAEoA1IJbGlrZUNvdW50EjkKCmNyZWF0ZWRfYXQYBiABKAsyGi5nb29nbG'
    'UucHJvdG9idWYuVGltZXN0YW1wUgljcmVhdGVkQXQ=');

@$core.Deprecated('Use getPostCommentsResponseDescriptor instead')
const GetPostCommentsResponse$json = {
  '1': 'GetPostCommentsResponse',
  '2': [
    {
      '1': 'comments',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Comment',
      '10': 'comments'
    },
    {'1': 'has_more', '3': 2, '4': 1, '5': 8, '10': 'hasMore'},
  ],
};

/// Descriptor for `GetPostCommentsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPostCommentsResponseDescriptor = $convert.base64Decode(
    'ChdHZXRQb3N0Q29tbWVudHNSZXNwb25zZRJACghjb21tZW50cxgBIAMoCzIkLnBlZXJzX3RvdW'
    'NoLm1vZGVsLnNvY2lhbC52MS5Db21tZW50Ughjb21tZW50cxIZCghoYXNfbW9yZRgCIAEoCFIH'
    'aGFzTW9yZQ==');

@$core.Deprecated('Use createCommentRequestDescriptor instead')
const CreateCommentRequest$json = {
  '1': 'CreateCommentRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 4, '10': 'postId'},
    {'1': 'content', '3': 2, '4': 1, '5': 9, '10': 'content'},
  ],
};

/// Descriptor for `CreateCommentRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createCommentRequestDescriptor = $convert.base64Decode(
    'ChRDcmVhdGVDb21tZW50UmVxdWVzdBIXCgdwb3N0X2lkGAEgASgEUgZwb3N0SWQSGAoHY29udG'
    'VudBgCIAEoCVIHY29udGVudA==');

@$core.Deprecated('Use createCommentResponseDescriptor instead')
const CreateCommentResponse$json = {
  '1': 'CreateCommentResponse',
  '2': [
    {
      '1': 'comment',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Comment',
      '10': 'comment'
    },
  ],
};

/// Descriptor for `CreateCommentResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createCommentResponseDescriptor = $convert.base64Decode(
    'ChVDcmVhdGVDb21tZW50UmVzcG9uc2USPgoHY29tbWVudBgBIAEoCzIkLnBlZXJzX3RvdWNoLm'
    '1vZGVsLnNvY2lhbC52MS5Db21tZW50Ugdjb21tZW50');

@$core.Deprecated('Use deleteCommentRequestDescriptor instead')
const DeleteCommentRequest$json = {
  '1': 'DeleteCommentRequest',
  '2': [
    {'1': 'comment_id', '3': 1, '4': 1, '5': 4, '10': 'commentId'},
  ],
};

/// Descriptor for `DeleteCommentRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteCommentRequestDescriptor = $convert.base64Decode(
    'ChREZWxldGVDb21tZW50UmVxdWVzdBIdCgpjb21tZW50X2lkGAEgASgEUgljb21tZW50SWQ=');

@$core.Deprecated('Use deleteCommentResponseDescriptor instead')
const DeleteCommentResponse$json = {
  '1': 'DeleteCommentResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `DeleteCommentResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteCommentResponseDescriptor =
    $convert.base64Decode(
        'ChVEZWxldGVDb21tZW50UmVzcG9uc2USGAoHc3VjY2VzcxgBIAEoCFIHc3VjY2Vzcw==');

@$core.Deprecated('Use followRequestDescriptor instead')
const FollowRequest$json = {
  '1': 'FollowRequest',
  '2': [
    {'1': 'target_did', '3': 1, '4': 1, '5': 9, '10': 'targetDid'},
  ],
};

/// Descriptor for `FollowRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List followRequestDescriptor = $convert.base64Decode(
    'Cg1Gb2xsb3dSZXF1ZXN0Eh0KCnRhcmdldF9kaWQYASABKAlSCXRhcmdldERpZA==');

@$core.Deprecated('Use followResponseDescriptor instead')
const FollowResponse$json = {
  '1': 'FollowResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `FollowResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List followResponseDescriptor = $convert
    .base64Decode('Cg5Gb2xsb3dSZXNwb25zZRIYCgdzdWNjZXNzGAEgASgIUgdzdWNjZXNz');

@$core.Deprecated('Use unfollowRequestDescriptor instead')
const UnfollowRequest$json = {
  '1': 'UnfollowRequest',
  '2': [
    {'1': 'target_did', '3': 1, '4': 1, '5': 9, '10': 'targetDid'},
  ],
};

/// Descriptor for `UnfollowRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unfollowRequestDescriptor = $convert.base64Decode(
    'Cg9VbmZvbGxvd1JlcXVlc3QSHQoKdGFyZ2V0X2RpZBgBIAEoCVIJdGFyZ2V0RGlk');

@$core.Deprecated('Use unfollowResponseDescriptor instead')
const UnfollowResponse$json = {
  '1': 'UnfollowResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `UnfollowResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unfollowResponseDescriptor = $convert.base64Decode(
    'ChBVbmZvbGxvd1Jlc3BvbnNlEhgKB3N1Y2Nlc3MYASABKAhSB3N1Y2Nlc3M=');

@$core.Deprecated('Use getFollowersRequestDescriptor instead')
const GetFollowersRequest$json = {
  '1': 'GetFollowersRequest',
  '2': [
    {'1': 'user_did', '3': 1, '4': 1, '5': 9, '10': 'userDid'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'cursor', '3': 3, '4': 1, '5': 9, '10': 'cursor'},
  ],
};

/// Descriptor for `GetFollowersRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getFollowersRequestDescriptor = $convert.base64Decode(
    'ChNHZXRGb2xsb3dlcnNSZXF1ZXN0EhkKCHVzZXJfZGlkGAEgASgJUgd1c2VyRGlkEhQKBWxpbW'
    'l0GAIgASgFUgVsaW1pdBIWCgZjdXJzb3IYAyABKAlSBmN1cnNvcg==');

@$core.Deprecated('Use getFollowersResponseDescriptor instead')
const GetFollowersResponse$json = {
  '1': 'GetFollowersResponse',
  '2': [
    {
      '1': 'users',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.UserInfo',
      '10': 'users'
    },
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
  ],
};

/// Descriptor for `GetFollowersResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getFollowersResponseDescriptor = $convert.base64Decode(
    'ChRHZXRGb2xsb3dlcnNSZXNwb25zZRI7CgV1c2VycxgBIAMoCzIlLnBlZXJzX3RvdWNoLm1vZG'
    'VsLnNvY2lhbC52MS5Vc2VySW5mb1IFdXNlcnMSHwoLbmV4dF9jdXJzb3IYAiABKAlSCm5leHRD'
    'dXJzb3I=');

@$core.Deprecated('Use getFollowingRequestDescriptor instead')
const GetFollowingRequest$json = {
  '1': 'GetFollowingRequest',
  '2': [
    {'1': 'user_did', '3': 1, '4': 1, '5': 9, '10': 'userDid'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'cursor', '3': 3, '4': 1, '5': 9, '10': 'cursor'},
  ],
};

/// Descriptor for `GetFollowingRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getFollowingRequestDescriptor = $convert.base64Decode(
    'ChNHZXRGb2xsb3dpbmdSZXF1ZXN0EhkKCHVzZXJfZGlkGAEgASgJUgd1c2VyRGlkEhQKBWxpbW'
    'l0GAIgASgFUgVsaW1pdBIWCgZjdXJzb3IYAyABKAlSBmN1cnNvcg==');

@$core.Deprecated('Use getFollowingResponseDescriptor instead')
const GetFollowingResponse$json = {
  '1': 'GetFollowingResponse',
  '2': [
    {
      '1': 'users',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.UserInfo',
      '10': 'users'
    },
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
  ],
};

/// Descriptor for `GetFollowingResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getFollowingResponseDescriptor = $convert.base64Decode(
    'ChRHZXRGb2xsb3dpbmdSZXNwb25zZRI7CgV1c2VycxgBIAMoCzIlLnBlZXJzX3RvdWNoLm1vZG'
    'VsLnNvY2lhbC52MS5Vc2VySW5mb1IFdXNlcnMSHwoLbmV4dF9jdXJzb3IYAiABKAlSCm5leHRD'
    'dXJzb3I=');

@$core.Deprecated('Use getRelationshipRequestDescriptor instead')
const GetRelationshipRequest$json = {
  '1': 'GetRelationshipRequest',
  '2': [
    {'1': 'target_did', '3': 1, '4': 1, '5': 9, '10': 'targetDid'},
  ],
};

/// Descriptor for `GetRelationshipRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getRelationshipRequestDescriptor =
    $convert.base64Decode(
        'ChZHZXRSZWxhdGlvbnNoaXBSZXF1ZXN0Eh0KCnRhcmdldF9kaWQYASABKAlSCXRhcmdldERpZA'
        '==');

@$core.Deprecated('Use relationshipDescriptor instead')
const Relationship$json = {
  '1': 'Relationship',
  '2': [
    {'1': 'following', '3': 1, '4': 1, '5': 8, '10': 'following'},
    {'1': 'followed_by', '3': 2, '4': 1, '5': 8, '10': 'followedBy'},
    {'1': 'blocking', '3': 3, '4': 1, '5': 8, '10': 'blocking'},
    {'1': 'blocked_by', '3': 4, '4': 1, '5': 8, '10': 'blockedBy'},
    {'1': 'muting', '3': 5, '4': 1, '5': 8, '10': 'muting'},
  ],
};

/// Descriptor for `Relationship`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List relationshipDescriptor = $convert.base64Decode(
    'CgxSZWxhdGlvbnNoaXASHAoJZm9sbG93aW5nGAEgASgIUglmb2xsb3dpbmcSHwoLZm9sbG93ZW'
    'RfYnkYAiABKAhSCmZvbGxvd2VkQnkSGgoIYmxvY2tpbmcYAyABKAhSCGJsb2NraW5nEh0KCmJs'
    'b2NrZWRfYnkYBCABKAhSCWJsb2NrZWRCeRIWCgZtdXRpbmcYBSABKAhSBm11dGluZw==');

@$core.Deprecated('Use getRelationshipResponseDescriptor instead')
const GetRelationshipResponse$json = {
  '1': 'GetRelationshipResponse',
  '2': [
    {
      '1': 'relationship',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Relationship',
      '10': 'relationship'
    },
  ],
};

/// Descriptor for `GetRelationshipResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getRelationshipResponseDescriptor =
    $convert.base64Decode(
        'ChdHZXRSZWxhdGlvbnNoaXBSZXNwb25zZRJNCgxyZWxhdGlvbnNoaXAYASABKAsyKS5wZWVyc1'
        '90b3VjaC5tb2RlbC5zb2NpYWwudjEuUmVsYXRpb25zaGlwUgxyZWxhdGlvbnNoaXA=');

@$core.Deprecated('Use getRelationshipsRequestDescriptor instead')
const GetRelationshipsRequest$json = {
  '1': 'GetRelationshipsRequest',
  '2': [
    {'1': 'target_dids', '3': 1, '4': 3, '5': 9, '10': 'targetDids'},
  ],
};

/// Descriptor for `GetRelationshipsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getRelationshipsRequestDescriptor =
    $convert.base64Decode(
        'ChdHZXRSZWxhdGlvbnNoaXBzUmVxdWVzdBIfCgt0YXJnZXRfZGlkcxgBIAMoCVIKdGFyZ2V0RG'
        'lkcw==');

@$core.Deprecated('Use getRelationshipsResponseDescriptor instead')
const GetRelationshipsResponse$json = {
  '1': 'GetRelationshipsResponse',
  '2': [
    {
      '1': 'relationships',
      '3': 1,
      '4': 3,
      '5': 11,
      '6':
          '.peers_touch.model.social.v1.GetRelationshipsResponse.RelationshipsEntry',
      '10': 'relationships'
    },
  ],
  '3': [GetRelationshipsResponse_RelationshipsEntry$json],
};

@$core.Deprecated('Use getRelationshipsResponseDescriptor instead')
const GetRelationshipsResponse_RelationshipsEntry$json = {
  '1': 'RelationshipsEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {
      '1': 'value',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Relationship',
      '10': 'value'
    },
  ],
  '7': {'7': true},
};

/// Descriptor for `GetRelationshipsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getRelationshipsResponseDescriptor = $convert.base64Decode(
    'ChhHZXRSZWxhdGlvbnNoaXBzUmVzcG9uc2USbgoNcmVsYXRpb25zaGlwcxgBIAMoCzJILnBlZX'
    'JzX3RvdWNoLm1vZGVsLnNvY2lhbC52MS5HZXRSZWxhdGlvbnNoaXBzUmVzcG9uc2UuUmVsYXRp'
    'b25zaGlwc0VudHJ5Ug1yZWxhdGlvbnNoaXBzGmsKElJlbGF0aW9uc2hpcHNFbnRyeRIQCgNrZX'
    'kYASABKAlSA2tleRI/CgV2YWx1ZRgCIAEoCzIpLnBlZXJzX3RvdWNoLm1vZGVsLnNvY2lhbC52'
    'MS5SZWxhdGlvbnNoaXBSBXZhbHVlOgI4AQ==');
