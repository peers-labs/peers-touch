// This is a generated file - do not edit.
//
// Generated from domain/social/relationship.proto.

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

@$core.Deprecated('Use followRequestDescriptor instead')
const FollowRequest$json = {
  '1': 'FollowRequest',
  '2': [
    {'1': 'target_actor_id', '3': 1, '4': 1, '5': 9, '10': 'targetActorId'},
  ],
};

/// Descriptor for `FollowRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List followRequestDescriptor = $convert.base64Decode(
    'Cg1Gb2xsb3dSZXF1ZXN0EiYKD3RhcmdldF9hY3Rvcl9pZBgBIAEoCVINdGFyZ2V0QWN0b3JJZA'
    '==');

@$core.Deprecated('Use followResponseDescriptor instead')
const FollowResponse$json = {
  '1': 'FollowResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
    {
      '1': 'relationship',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Relationship',
      '10': 'relationship'
    },
  ],
};

/// Descriptor for `FollowResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List followResponseDescriptor = $convert.base64Decode(
    'Cg5Gb2xsb3dSZXNwb25zZRIYCgdzdWNjZXNzGAEgASgIUgdzdWNjZXNzEk0KDHJlbGF0aW9uc2'
    'hpcBgCIAEoCzIpLnBlZXJzX3RvdWNoLm1vZGVsLnNvY2lhbC52MS5SZWxhdGlvbnNoaXBSDHJl'
    'bGF0aW9uc2hpcA==');

@$core.Deprecated('Use unfollowRequestDescriptor instead')
const UnfollowRequest$json = {
  '1': 'UnfollowRequest',
  '2': [
    {'1': 'target_actor_id', '3': 1, '4': 1, '5': 9, '10': 'targetActorId'},
  ],
};

/// Descriptor for `UnfollowRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unfollowRequestDescriptor = $convert.base64Decode(
    'Cg9VbmZvbGxvd1JlcXVlc3QSJgoPdGFyZ2V0X2FjdG9yX2lkGAEgASgJUg10YXJnZXRBY3Rvck'
    'lk');

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

@$core.Deprecated('Use getRelationshipRequestDescriptor instead')
const GetRelationshipRequest$json = {
  '1': 'GetRelationshipRequest',
  '2': [
    {'1': 'target_actor_id', '3': 1, '4': 1, '5': 9, '10': 'targetActorId'},
  ],
};

/// Descriptor for `GetRelationshipRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getRelationshipRequestDescriptor =
    $convert.base64Decode(
        'ChZHZXRSZWxhdGlvbnNoaXBSZXF1ZXN0EiYKD3RhcmdldF9hY3Rvcl9pZBgBIAEoCVINdGFyZ2'
        'V0QWN0b3JJZA==');

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
    {'1': 'target_actor_ids', '3': 1, '4': 3, '5': 9, '10': 'targetActorIds'},
  ],
};

/// Descriptor for `GetRelationshipsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getRelationshipsRequestDescriptor =
    $convert.base64Decode(
        'ChdHZXRSZWxhdGlvbnNoaXBzUmVxdWVzdBIoChB0YXJnZXRfYWN0b3JfaWRzGAEgAygJUg50YX'
        'JnZXRBY3Rvcklkcw==');

@$core.Deprecated('Use getRelationshipsResponseDescriptor instead')
const GetRelationshipsResponse$json = {
  '1': 'GetRelationshipsResponse',
  '2': [
    {
      '1': 'relationships',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Relationship',
      '10': 'relationships'
    },
  ],
};

/// Descriptor for `GetRelationshipsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getRelationshipsResponseDescriptor =
    $convert.base64Decode(
        'ChhHZXRSZWxhdGlvbnNoaXBzUmVzcG9uc2USTwoNcmVsYXRpb25zaGlwcxgBIAMoCzIpLnBlZX'
        'JzX3RvdWNoLm1vZGVsLnNvY2lhbC52MS5SZWxhdGlvbnNoaXBSDXJlbGF0aW9uc2hpcHM=');

@$core.Deprecated('Use relationshipDescriptor instead')
const Relationship$json = {
  '1': 'Relationship',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'target_actor_id', '3': 2, '4': 1, '5': 9, '10': 'targetActorId'},
    {'1': 'following', '3': 3, '4': 1, '5': 8, '10': 'following'},
    {'1': 'followed_by', '3': 4, '4': 1, '5': 8, '10': 'followedBy'},
    {
      '1': 'followed_at',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'followedAt'
    },
  ],
};

/// Descriptor for `Relationship`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List relationshipDescriptor = $convert.base64Decode(
    'CgxSZWxhdGlvbnNoaXASDgoCaWQYASABKAlSAmlkEiYKD3RhcmdldF9hY3Rvcl9pZBgCIAEoCV'
    'INdGFyZ2V0QWN0b3JJZBIcCglmb2xsb3dpbmcYAyABKAhSCWZvbGxvd2luZxIfCgtmb2xsb3dl'
    'ZF9ieRgEIAEoCFIKZm9sbG93ZWRCeRI7Cgtmb2xsb3dlZF9hdBgFIAEoCzIaLmdvb2dsZS5wcm'
    '90b2J1Zi5UaW1lc3RhbXBSCmZvbGxvd2VkQXQ=');

@$core.Deprecated('Use getFollowersRequestDescriptor instead')
const GetFollowersRequest$json = {
  '1': 'GetFollowersRequest',
  '2': [
    {'1': 'actor_id', '3': 1, '4': 1, '5': 9, '10': 'actorId'},
    {'1': 'cursor', '3': 2, '4': 1, '5': 9, '10': 'cursor'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `GetFollowersRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getFollowersRequestDescriptor = $convert.base64Decode(
    'ChNHZXRGb2xsb3dlcnNSZXF1ZXN0EhkKCGFjdG9yX2lkGAEgASgJUgdhY3RvcklkEhYKBmN1cn'
    'NvchgCIAEoCVIGY3Vyc29yEhQKBWxpbWl0GAMgASgFUgVsaW1pdA==');

@$core.Deprecated('Use getFollowersResponseDescriptor instead')
const GetFollowersResponse$json = {
  '1': 'GetFollowersResponse',
  '2': [
    {
      '1': 'followers',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Follower',
      '10': 'followers'
    },
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
    {'1': 'total', '3': 3, '4': 1, '5': 5, '10': 'total'},
  ],
};

/// Descriptor for `GetFollowersResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getFollowersResponseDescriptor = $convert.base64Decode(
    'ChRHZXRGb2xsb3dlcnNSZXNwb25zZRJDCglmb2xsb3dlcnMYASADKAsyJS5wZWVyc190b3VjaC'
    '5tb2RlbC5zb2NpYWwudjEuRm9sbG93ZXJSCWZvbGxvd2VycxIfCgtuZXh0X2N1cnNvchgCIAEo'
    'CVIKbmV4dEN1cnNvchIUCgV0b3RhbBgDIAEoBVIFdG90YWw=');

@$core.Deprecated('Use getFollowingRequestDescriptor instead')
const GetFollowingRequest$json = {
  '1': 'GetFollowingRequest',
  '2': [
    {'1': 'actor_id', '3': 1, '4': 1, '5': 9, '10': 'actorId'},
    {'1': 'cursor', '3': 2, '4': 1, '5': 9, '10': 'cursor'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `GetFollowingRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getFollowingRequestDescriptor = $convert.base64Decode(
    'ChNHZXRGb2xsb3dpbmdSZXF1ZXN0EhkKCGFjdG9yX2lkGAEgASgJUgdhY3RvcklkEhYKBmN1cn'
    'NvchgCIAEoCVIGY3Vyc29yEhQKBWxpbWl0GAMgASgFUgVsaW1pdA==');

@$core.Deprecated('Use getFollowingResponseDescriptor instead')
const GetFollowingResponse$json = {
  '1': 'GetFollowingResponse',
  '2': [
    {
      '1': 'following',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.social.v1.Following',
      '10': 'following'
    },
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
    {'1': 'total', '3': 3, '4': 1, '5': 5, '10': 'total'},
  ],
};

/// Descriptor for `GetFollowingResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getFollowingResponseDescriptor = $convert.base64Decode(
    'ChRHZXRGb2xsb3dpbmdSZXNwb25zZRJECglmb2xsb3dpbmcYASADKAsyJi5wZWVyc190b3VjaC'
    '5tb2RlbC5zb2NpYWwudjEuRm9sbG93aW5nUglmb2xsb3dpbmcSHwoLbmV4dF9jdXJzb3IYAiAB'
    'KAlSCm5leHRDdXJzb3ISFAoFdG90YWwYAyABKAVSBXRvdGFs');

@$core.Deprecated('Use followerDescriptor instead')
const Follower$json = {
  '1': 'Follower',
  '2': [
    {'1': 'actor_id', '3': 1, '4': 1, '5': 9, '10': 'actorId'},
    {'1': 'username', '3': 2, '4': 1, '5': 9, '10': 'username'},
    {'1': 'display_name', '3': 3, '4': 1, '5': 9, '10': 'displayName'},
    {'1': 'avatar_url', '3': 4, '4': 1, '5': 9, '10': 'avatarUrl'},
    {
      '1': 'followed_at',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'followedAt'
    },
  ],
};

/// Descriptor for `Follower`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List followerDescriptor = $convert.base64Decode(
    'CghGb2xsb3dlchIZCghhY3Rvcl9pZBgBIAEoCVIHYWN0b3JJZBIaCgh1c2VybmFtZRgCIAEoCV'
    'IIdXNlcm5hbWUSIQoMZGlzcGxheV9uYW1lGAMgASgJUgtkaXNwbGF5TmFtZRIdCgphdmF0YXJf'
    'dXJsGAQgASgJUglhdmF0YXJVcmwSOwoLZm9sbG93ZWRfYXQYBSABKAsyGi5nb29nbGUucHJvdG'
    '9idWYuVGltZXN0YW1wUgpmb2xsb3dlZEF0');

@$core.Deprecated('Use followingDescriptor instead')
const Following$json = {
  '1': 'Following',
  '2': [
    {'1': 'actor_id', '3': 1, '4': 1, '5': 9, '10': 'actorId'},
    {'1': 'username', '3': 2, '4': 1, '5': 9, '10': 'username'},
    {'1': 'display_name', '3': 3, '4': 1, '5': 9, '10': 'displayName'},
    {'1': 'avatar_url', '3': 4, '4': 1, '5': 9, '10': 'avatarUrl'},
    {
      '1': 'followed_at',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'followedAt'
    },
  ],
};

/// Descriptor for `Following`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List followingDescriptor = $convert.base64Decode(
    'CglGb2xsb3dpbmcSGQoIYWN0b3JfaWQYASABKAlSB2FjdG9ySWQSGgoIdXNlcm5hbWUYAiABKA'
    'lSCHVzZXJuYW1lEiEKDGRpc3BsYXlfbmFtZRgDIAEoCVILZGlzcGxheU5hbWUSHQoKYXZhdGFy'
    'X3VybBgEIAEoCVIJYXZhdGFyVXJsEjsKC2ZvbGxvd2VkX2F0GAUgASgLMhouZ29vZ2xlLnByb3'
    'RvYnVmLlRpbWVzdGFtcFIKZm9sbG93ZWRBdA==');
