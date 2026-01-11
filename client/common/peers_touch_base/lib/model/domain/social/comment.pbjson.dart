// This is a generated file - do not edit.
//
// Generated from domain/social/comment.proto.

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

@$core.Deprecated('Use commentSortDescriptor instead')
const CommentSort$json = {
  '1': 'CommentSort',
  '2': [
    {'1': 'NEWEST', '2': 0},
    {'1': 'OLDEST', '2': 1},
    {'1': 'MOST_LIKED', '2': 2},
  ],
};

/// Descriptor for `CommentSort`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List commentSortDescriptor = $convert.base64Decode(
    'CgtDb21tZW50U29ydBIKCgZORVdFU1QQABIKCgZPTERFU1QQARIOCgpNT1NUX0xJS0VEEAI=');

@$core.Deprecated('Use commentDescriptor instead')
const Comment$json = {
  '1': 'Comment',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'post_id', '3': 2, '4': 1, '5': 9, '10': 'postId'},
    {'1': 'author_id', '3': 3, '4': 1, '5': 9, '10': 'authorId'},
    {'1': 'content', '3': 4, '4': 1, '5': 9, '10': 'content'},
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
      '1': 'author',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.PostAuthor',
      '10': 'author'
    },
    {'1': 'likes_count', '3': 11, '4': 1, '5': 3, '10': 'likesCount'},
    {'1': 'is_liked', '3': 12, '4': 1, '5': 8, '10': 'isLiked'},
    {
      '1': 'reply_to_comment_id',
      '3': 20,
      '4': 1,
      '5': 9,
      '10': 'replyToCommentId'
    },
    {'1': 'replies_count', '3': 21, '4': 1, '5': 3, '10': 'repliesCount'},
  ],
};

/// Descriptor for `Comment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List commentDescriptor = $convert.base64Decode(
    'CgdDb21tZW50Eg4KAmlkGAEgASgJUgJpZBIXCgdwb3N0X2lkGAIgASgJUgZwb3N0SWQSGwoJYX'
    'V0aG9yX2lkGAMgASgJUghhdXRob3JJZBIYCgdjb250ZW50GAQgASgJUgdjb250ZW50EjkKCmNy'
    'ZWF0ZWRfYXQYBSABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgljcmVhdGVkQXQSOQ'
    'oKdXBkYXRlZF9hdBgGIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCXVwZGF0ZWRB'
    'dBIdCgppc19kZWxldGVkGAcgASgIUglpc0RlbGV0ZWQSPwoGYXV0aG9yGAogASgLMicucGVlcn'
    'NfdG91Y2gubW9kZWwuc29jaWFsLnYxLlBvc3RBdXRob3JSBmF1dGhvchIfCgtsaWtlc19jb3Vu'
    'dBgLIAEoA1IKbGlrZXNDb3VudBIZCghpc19saWtlZBgMIAEoCFIHaXNMaWtlZBItChNyZXBseV'
    '90b19jb21tZW50X2lkGBQgASgJUhByZXBseVRvQ29tbWVudElkEiMKDXJlcGxpZXNfY291bnQY'
    'FSABKANSDHJlcGxpZXNDb3VudA==');

@$core.Deprecated('Use createCommentRequestDescriptor instead')
const CreateCommentRequest$json = {
  '1': 'CreateCommentRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 9, '10': 'postId'},
    {'1': 'content', '3': 2, '4': 1, '5': 9, '10': 'content'},
    {
      '1': 'reply_to_comment_id',
      '3': 3,
      '4': 1,
      '5': 9,
      '10': 'replyToCommentId'
    },
  ],
};

/// Descriptor for `CreateCommentRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createCommentRequestDescriptor = $convert.base64Decode(
    'ChRDcmVhdGVDb21tZW50UmVxdWVzdBIXCgdwb3N0X2lkGAEgASgJUgZwb3N0SWQSGAoHY29udG'
    'VudBgCIAEoCVIHY29udGVudBItChNyZXBseV90b19jb21tZW50X2lkGAMgASgJUhByZXBseVRv'
    'Q29tbWVudElk');

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

@$core.Deprecated('Use updateCommentRequestDescriptor instead')
const UpdateCommentRequest$json = {
  '1': 'UpdateCommentRequest',
  '2': [
    {'1': 'comment_id', '3': 1, '4': 1, '5': 9, '10': 'commentId'},
    {'1': 'content', '3': 2, '4': 1, '5': 9, '10': 'content'},
  ],
};

/// Descriptor for `UpdateCommentRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateCommentRequestDescriptor = $convert.base64Decode(
    'ChRVcGRhdGVDb21tZW50UmVxdWVzdBIdCgpjb21tZW50X2lkGAEgASgJUgljb21tZW50SWQSGA'
    'oHY29udGVudBgCIAEoCVIHY29udGVudA==');

@$core.Deprecated('Use updateCommentResponseDescriptor instead')
const UpdateCommentResponse$json = {
  '1': 'UpdateCommentResponse',
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

/// Descriptor for `UpdateCommentResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateCommentResponseDescriptor = $convert.base64Decode(
    'ChVVcGRhdGVDb21tZW50UmVzcG9uc2USPgoHY29tbWVudBgBIAEoCzIkLnBlZXJzX3RvdWNoLm'
    '1vZGVsLnNvY2lhbC52MS5Db21tZW50Ugdjb21tZW50');

@$core.Deprecated('Use deleteCommentRequestDescriptor instead')
const DeleteCommentRequest$json = {
  '1': 'DeleteCommentRequest',
  '2': [
    {'1': 'comment_id', '3': 1, '4': 1, '5': 9, '10': 'commentId'},
  ],
};

/// Descriptor for `DeleteCommentRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteCommentRequestDescriptor = $convert.base64Decode(
    'ChREZWxldGVDb21tZW50UmVxdWVzdBIdCgpjb21tZW50X2lkGAEgASgJUgljb21tZW50SWQ=');

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

@$core.Deprecated('Use getCommentsRequestDescriptor instead')
const GetCommentsRequest$json = {
  '1': 'GetCommentsRequest',
  '2': [
    {'1': 'post_id', '3': 1, '4': 1, '5': 9, '10': 'postId'},
    {'1': 'cursor', '3': 2, '4': 1, '5': 9, '10': 'cursor'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
    {
      '1': 'sort',
      '3': 4,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.social.v1.CommentSort',
      '10': 'sort'
    },
  ],
};

/// Descriptor for `GetCommentsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getCommentsRequestDescriptor = $convert.base64Decode(
    'ChJHZXRDb21tZW50c1JlcXVlc3QSFwoHcG9zdF9pZBgBIAEoCVIGcG9zdElkEhYKBmN1cnNvch'
    'gCIAEoCVIGY3Vyc29yEhQKBWxpbWl0GAMgASgFUgVsaW1pdBI8CgRzb3J0GAQgASgOMigucGVl'
    'cnNfdG91Y2gubW9kZWwuc29jaWFsLnYxLkNvbW1lbnRTb3J0UgRzb3J0');

@$core.Deprecated('Use getCommentsResponseDescriptor instead')
const GetCommentsResponse$json = {
  '1': 'GetCommentsResponse',
  '2': [
    {
      '1': 'comments',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Comment',
      '10': 'comments'
    },
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
    {'1': 'has_more', '3': 3, '4': 1, '5': 8, '10': 'hasMore'},
  ],
};

/// Descriptor for `GetCommentsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getCommentsResponseDescriptor = $convert.base64Decode(
    'ChNHZXRDb21tZW50c1Jlc3BvbnNlEkAKCGNvbW1lbnRzGAEgAygLMiQucGVlcnNfdG91Y2gubW'
    '9kZWwuc29jaWFsLnYxLkNvbW1lbnRSCGNvbW1lbnRzEh8KC25leHRfY3Vyc29yGAIgASgJUgpu'
    'ZXh0Q3Vyc29yEhkKCGhhc19tb3JlGAMgASgIUgdoYXNNb3Jl');

@$core.Deprecated('Use likeCommentRequestDescriptor instead')
const LikeCommentRequest$json = {
  '1': 'LikeCommentRequest',
  '2': [
    {'1': 'comment_id', '3': 1, '4': 1, '5': 9, '10': 'commentId'},
  ],
};

/// Descriptor for `LikeCommentRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List likeCommentRequestDescriptor =
    $convert.base64Decode(
        'ChJMaWtlQ29tbWVudFJlcXVlc3QSHQoKY29tbWVudF9pZBgBIAEoCVIJY29tbWVudElk');

@$core.Deprecated('Use likeCommentResponseDescriptor instead')
const LikeCommentResponse$json = {
  '1': 'LikeCommentResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
    {'1': 'new_likes_count', '3': 2, '4': 1, '5': 3, '10': 'newLikesCount'},
  ],
};

/// Descriptor for `LikeCommentResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List likeCommentResponseDescriptor = $convert.base64Decode(
    'ChNMaWtlQ29tbWVudFJlc3BvbnNlEhgKB3N1Y2Nlc3MYASABKAhSB3N1Y2Nlc3MSJgoPbmV3X2'
    'xpa2VzX2NvdW50GAIgASgDUg1uZXdMaWtlc0NvdW50');

@$core.Deprecated('Use unlikeCommentRequestDescriptor instead')
const UnlikeCommentRequest$json = {
  '1': 'UnlikeCommentRequest',
  '2': [
    {'1': 'comment_id', '3': 1, '4': 1, '5': 9, '10': 'commentId'},
  ],
};

/// Descriptor for `UnlikeCommentRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unlikeCommentRequestDescriptor = $convert.base64Decode(
    'ChRVbmxpa2VDb21tZW50UmVxdWVzdBIdCgpjb21tZW50X2lkGAEgASgJUgljb21tZW50SWQ=');

@$core.Deprecated('Use unlikeCommentResponseDescriptor instead')
const UnlikeCommentResponse$json = {
  '1': 'UnlikeCommentResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
    {'1': 'new_likes_count', '3': 2, '4': 1, '5': 3, '10': 'newLikesCount'},
  ],
};

/// Descriptor for `UnlikeCommentResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unlikeCommentResponseDescriptor = $convert.base64Decode(
    'ChVVbmxpa2VDb21tZW50UmVzcG9uc2USGAoHc3VjY2VzcxgBIAEoCFIHc3VjY2VzcxImCg9uZX'
    'dfbGlrZXNfY291bnQYAiABKANSDW5ld0xpa2VzQ291bnQ=');
