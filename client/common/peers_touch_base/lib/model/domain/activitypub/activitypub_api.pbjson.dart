// This is a generated file - do not edit.
//
// Generated from domain/activitypub/activitypub_api.proto.

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

@$core.Deprecated('Use actorSignupRequestDescriptor instead')
const ActorSignupRequest$json = {
  '1': 'ActorSignupRequest',
  '2': [
    {'1': 'handle', '3': 1, '4': 1, '5': 9, '10': 'handle'},
    {'1': 'email', '3': 2, '4': 1, '5': 9, '10': 'email'},
    {'1': 'password', '3': 3, '4': 1, '5': 9, '10': 'password'},
    {'1': 'display_name', '3': 4, '4': 1, '5': 9, '10': 'displayName'},
  ],
};

/// Descriptor for `ActorSignupRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List actorSignupRequestDescriptor = $convert.base64Decode(
    'ChJBY3RvclNpZ251cFJlcXVlc3QSFgoGaGFuZGxlGAEgASgJUgZoYW5kbGUSFAoFZW1haWwYAi'
    'ABKAlSBWVtYWlsEhoKCHBhc3N3b3JkGAMgASgJUghwYXNzd29yZBIhCgxkaXNwbGF5X25hbWUY'
    'BCABKAlSC2Rpc3BsYXlOYW1l');

@$core.Deprecated('Use actorSignupResponseDescriptor instead')
const ActorSignupResponse$json = {
  '1': 'ActorSignupResponse',
  '2': [
    {'1': 'actor_id', '3': 1, '4': 1, '5': 9, '10': 'actorId'},
    {'1': 'handle', '3': 2, '4': 1, '5': 9, '10': 'handle'},
    {'1': 'token', '3': 3, '4': 1, '5': 9, '10': 'token'},
  ],
};

/// Descriptor for `ActorSignupResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List actorSignupResponseDescriptor = $convert.base64Decode(
    'ChNBY3RvclNpZ251cFJlc3BvbnNlEhkKCGFjdG9yX2lkGAEgASgJUgdhY3RvcklkEhYKBmhhbm'
    'RsZRgCIAEoCVIGaGFuZGxlEhQKBXRva2VuGAMgASgJUgV0b2tlbg==');

@$core.Deprecated('Use actorLoginRequestDescriptor instead')
const ActorLoginRequest$json = {
  '1': 'ActorLoginRequest',
  '2': [
    {'1': 'identifier', '3': 1, '4': 1, '5': 9, '10': 'identifier'},
    {'1': 'password', '3': 2, '4': 1, '5': 9, '10': 'password'},
  ],
};

/// Descriptor for `ActorLoginRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List actorLoginRequestDescriptor = $convert.base64Decode(
    'ChFBY3RvckxvZ2luUmVxdWVzdBIeCgppZGVudGlmaWVyGAEgASgJUgppZGVudGlmaWVyEhoKCH'
    'Bhc3N3b3JkGAIgASgJUghwYXNzd29yZA==');

@$core.Deprecated('Use actorLoginResponseDescriptor instead')
const ActorLoginResponse$json = {
  '1': 'ActorLoginResponse',
  '2': [
    {'1': 'actor_id', '3': 1, '4': 1, '5': 9, '10': 'actorId'},
    {'1': 'handle', '3': 2, '4': 1, '5': 9, '10': 'handle'},
    {'1': 'token', '3': 3, '4': 1, '5': 9, '10': 'token'},
  ],
};

/// Descriptor for `ActorLoginResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List actorLoginResponseDescriptor = $convert.base64Decode(
    'ChJBY3RvckxvZ2luUmVzcG9uc2USGQoIYWN0b3JfaWQYASABKAlSB2FjdG9ySWQSFgoGaGFuZG'
    'xlGAIgASgJUgZoYW5kbGUSFAoFdG9rZW4YAyABKAlSBXRva2Vu');

@$core.Deprecated('Use getActorProfileRequestDescriptor instead')
const GetActorProfileRequest$json = {
  '1': 'GetActorProfileRequest',
  '2': [
    {'1': 'actor_id', '3': 1, '4': 1, '5': 9, '10': 'actorId'},
  ],
};

/// Descriptor for `GetActorProfileRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getActorProfileRequestDescriptor =
    $convert.base64Decode(
        'ChZHZXRBY3RvclByb2ZpbGVSZXF1ZXN0EhkKCGFjdG9yX2lkGAEgASgJUgdhY3Rvcklk');

@$core.Deprecated('Use actorProfileDescriptor instead')
const ActorProfile$json = {
  '1': 'ActorProfile',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'handle', '3': 2, '4': 1, '5': 9, '10': 'handle'},
    {'1': 'display_name', '3': 3, '4': 1, '5': 9, '10': 'displayName'},
    {'1': 'summary', '3': 4, '4': 1, '5': 9, '10': 'summary'},
    {'1': 'avatar_url', '3': 5, '4': 1, '5': 9, '10': 'avatarUrl'},
    {'1': 'header_url', '3': 6, '4': 1, '5': 9, '10': 'headerUrl'},
    {'1': 'followers_count', '3': 7, '4': 1, '5': 3, '10': 'followersCount'},
    {'1': 'following_count', '3': 8, '4': 1, '5': 3, '10': 'followingCount'},
    {'1': 'posts_count', '3': 9, '4': 1, '5': 3, '10': 'postsCount'},
    {
      '1': 'created_at',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
  ],
};

/// Descriptor for `ActorProfile`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List actorProfileDescriptor = $convert.base64Decode(
    'CgxBY3RvclByb2ZpbGUSDgoCaWQYASABKAlSAmlkEhYKBmhhbmRsZRgCIAEoCVIGaGFuZGxlEi'
    'EKDGRpc3BsYXlfbmFtZRgDIAEoCVILZGlzcGxheU5hbWUSGAoHc3VtbWFyeRgEIAEoCVIHc3Vt'
    'bWFyeRIdCgphdmF0YXJfdXJsGAUgASgJUglhdmF0YXJVcmwSHQoKaGVhZGVyX3VybBgGIAEoCV'
    'IJaGVhZGVyVXJsEicKD2ZvbGxvd2Vyc19jb3VudBgHIAEoA1IOZm9sbG93ZXJzQ291bnQSJwoP'
    'Zm9sbG93aW5nX2NvdW50GAggASgDUg5mb2xsb3dpbmdDb3VudBIfCgtwb3N0c19jb3VudBgJIA'
    'EoA1IKcG9zdHNDb3VudBI5CgpjcmVhdGVkX2F0GAogASgLMhouZ29vZ2xlLnByb3RvYnVmLlRp'
    'bWVzdGFtcFIJY3JlYXRlZEF0');

@$core.Deprecated('Use getActorProfileResponseDescriptor instead')
const GetActorProfileResponse$json = {
  '1': 'GetActorProfileResponse',
  '2': [
    {
      '1': 'profile',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.activitypub.v1.ActorProfile',
      '10': 'profile'
    },
  ],
};

/// Descriptor for `GetActorProfileResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getActorProfileResponseDescriptor =
    $convert.base64Decode(
        'ChdHZXRBY3RvclByb2ZpbGVSZXNwb25zZRJICgdwcm9maWxlGAEgASgLMi4ucGVlcnNfdG91Y2'
        'gubW9kZWwuYWN0aXZpdHlwdWIudjEuQWN0b3JQcm9maWxlUgdwcm9maWxl');

@$core.Deprecated('Use updateActorProfileRequestDescriptor instead')
const UpdateActorProfileRequest$json = {
  '1': 'UpdateActorProfileRequest',
  '2': [
    {'1': 'display_name', '3': 1, '4': 1, '5': 9, '10': 'displayName'},
    {'1': 'summary', '3': 2, '4': 1, '5': 9, '10': 'summary'},
    {'1': 'avatar_url', '3': 3, '4': 1, '5': 9, '10': 'avatarUrl'},
    {'1': 'header_url', '3': 4, '4': 1, '5': 9, '10': 'headerUrl'},
  ],
};

/// Descriptor for `UpdateActorProfileRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateActorProfileRequestDescriptor = $convert.base64Decode(
    'ChlVcGRhdGVBY3RvclByb2ZpbGVSZXF1ZXN0EiEKDGRpc3BsYXlfbmFtZRgBIAEoCVILZGlzcG'
    'xheU5hbWUSGAoHc3VtbWFyeRgCIAEoCVIHc3VtbWFyeRIdCgphdmF0YXJfdXJsGAMgASgJUglh'
    'dmF0YXJVcmwSHQoKaGVhZGVyX3VybBgEIAEoCVIJaGVhZGVyVXJs');

@$core.Deprecated('Use updateActorProfileResponseDescriptor instead')
const UpdateActorProfileResponse$json = {
  '1': 'UpdateActorProfileResponse',
  '2': [
    {
      '1': 'profile',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.activitypub.v1.ActorProfile',
      '10': 'profile'
    },
  ],
};

/// Descriptor for `UpdateActorProfileResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateActorProfileResponseDescriptor =
    $convert.base64Decode(
        'ChpVcGRhdGVBY3RvclByb2ZpbGVSZXNwb25zZRJICgdwcm9maWxlGAEgASgLMi4ucGVlcnNfdG'
        '91Y2gubW9kZWwuYWN0aXZpdHlwdWIudjEuQWN0b3JQcm9maWxlUgdwcm9maWxl');

@$core.Deprecated('Use getActorBasicInfoRequestDescriptor instead')
const GetActorBasicInfoRequest$json = {
  '1': 'GetActorBasicInfoRequest',
  '2': [
    {'1': 'actor_id', '3': 1, '4': 1, '5': 9, '10': 'actorId'},
  ],
};

/// Descriptor for `GetActorBasicInfoRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getActorBasicInfoRequestDescriptor =
    $convert.base64Decode(
        'ChhHZXRBY3RvckJhc2ljSW5mb1JlcXVlc3QSGQoIYWN0b3JfaWQYASABKAlSB2FjdG9ySWQ=');

@$core.Deprecated('Use actorBasicInfoDescriptor instead')
const ActorBasicInfo$json = {
  '1': 'ActorBasicInfo',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'handle', '3': 2, '4': 1, '5': 9, '10': 'handle'},
    {'1': 'display_name', '3': 3, '4': 1, '5': 9, '10': 'displayName'},
    {'1': 'avatar_url', '3': 4, '4': 1, '5': 9, '10': 'avatarUrl'},
  ],
};

/// Descriptor for `ActorBasicInfo`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List actorBasicInfoDescriptor = $convert.base64Decode(
    'Cg5BY3RvckJhc2ljSW5mbxIOCgJpZBgBIAEoCVICaWQSFgoGaGFuZGxlGAIgASgJUgZoYW5kbG'
    'USIQoMZGlzcGxheV9uYW1lGAMgASgJUgtkaXNwbGF5TmFtZRIdCgphdmF0YXJfdXJsGAQgASgJ'
    'UglhdmF0YXJVcmw=');

@$core.Deprecated('Use getActorBasicInfoResponseDescriptor instead')
const GetActorBasicInfoResponse$json = {
  '1': 'GetActorBasicInfoResponse',
  '2': [
    {
      '1': 'info',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.activitypub.v1.ActorBasicInfo',
      '10': 'info'
    },
  ],
};

/// Descriptor for `GetActorBasicInfoResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getActorBasicInfoResponseDescriptor =
    $convert.base64Decode(
        'ChlHZXRBY3RvckJhc2ljSW5mb1Jlc3BvbnNlEkQKBGluZm8YASABKAsyMC5wZWVyc190b3VjaC'
        '5tb2RlbC5hY3Rpdml0eXB1Yi52MS5BY3RvckJhc2ljSW5mb1IEaW5mbw==');

@$core.Deprecated('Use listActorsRequestDescriptor instead')
const ListActorsRequest$json = {
  '1': 'ListActorsRequest',
  '2': [
    {'1': 'limit', '3': 1, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'cursor', '3': 2, '4': 1, '5': 9, '10': 'cursor'},
  ],
};

/// Descriptor for `ListActorsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listActorsRequestDescriptor = $convert.base64Decode(
    'ChFMaXN0QWN0b3JzUmVxdWVzdBIUCgVsaW1pdBgBIAEoBVIFbGltaXQSFgoGY3Vyc29yGAIgAS'
    'gJUgZjdXJzb3I=');

@$core.Deprecated('Use listActorsResponseDescriptor instead')
const ListActorsResponse$json = {
  '1': 'ListActorsResponse',
  '2': [
    {
      '1': 'actors',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.activitypub.v1.ActorProfile',
      '10': 'actors'
    },
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
  ],
};

/// Descriptor for `ListActorsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listActorsResponseDescriptor = $convert.base64Decode(
    'ChJMaXN0QWN0b3JzUmVzcG9uc2USRgoGYWN0b3JzGAEgAygLMi4ucGVlcnNfdG91Y2gubW9kZW'
    'wuYWN0aXZpdHlwdWIudjEuQWN0b3JQcm9maWxlUgZhY3RvcnMSHwoLbmV4dF9jdXJzb3IYAiAB'
    'KAlSCm5leHRDdXJzb3I=');

@$core.Deprecated('Use searchActorsRequestDescriptor instead')
const SearchActorsRequest$json = {
  '1': 'SearchActorsRequest',
  '2': [
    {'1': 'query', '3': 1, '4': 1, '5': 9, '10': 'query'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `SearchActorsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchActorsRequestDescriptor = $convert.base64Decode(
    'ChNTZWFyY2hBY3RvcnNSZXF1ZXN0EhQKBXF1ZXJ5GAEgASgJUgVxdWVyeRIUCgVsaW1pdBgCIA'
    'EoBVIFbGltaXQ=');

@$core.Deprecated('Use searchActorsResponseDescriptor instead')
const SearchActorsResponse$json = {
  '1': 'SearchActorsResponse',
  '2': [
    {
      '1': 'actors',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.activitypub.v1.ActorProfile',
      '10': 'actors'
    },
  ],
};

/// Descriptor for `SearchActorsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchActorsResponseDescriptor = $convert.base64Decode(
    'ChRTZWFyY2hBY3RvcnNSZXNwb25zZRJGCgZhY3RvcnMYASADKAsyLi5wZWVyc190b3VjaC5tb2'
    'RlbC5hY3Rpdml0eXB1Yi52MS5BY3RvclByb2ZpbGVSBmFjdG9ycw==');

@$core.Deprecated('Use getUserActorRequestDescriptor instead')
const GetUserActorRequest$json = {
  '1': 'GetUserActorRequest',
  '2': [
    {'1': 'username', '3': 1, '4': 1, '5': 9, '10': 'username'},
  ],
};

/// Descriptor for `GetUserActorRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserActorRequestDescriptor =
    $convert.base64Decode(
        'ChNHZXRVc2VyQWN0b3JSZXF1ZXN0EhoKCHVzZXJuYW1lGAEgASgJUgh1c2VybmFtZQ==');

@$core.Deprecated('Use getUserActorResponseDescriptor instead')
const GetUserActorResponse$json = {
  '1': 'GetUserActorResponse',
  '2': [
    {
      '1': 'actor',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.activitypub.v1.ActorProfile',
      '10': 'actor'
    },
  ],
};

/// Descriptor for `GetUserActorResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserActorResponseDescriptor = $convert.base64Decode(
    'ChRHZXRVc2VyQWN0b3JSZXNwb25zZRJECgVhY3RvchgBIAEoCzIuLnBlZXJzX3RvdWNoLm1vZG'
    'VsLmFjdGl2aXR5cHViLnYxLkFjdG9yUHJvZmlsZVIFYWN0b3I=');

@$core.Deprecated('Use getUserInboxRequestDescriptor instead')
const GetUserInboxRequest$json = {
  '1': 'GetUserInboxRequest',
  '2': [
    {'1': 'username', '3': 1, '4': 1, '5': 9, '10': 'username'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'max_id', '3': 3, '4': 1, '5': 9, '10': 'maxId'},
  ],
};

/// Descriptor for `GetUserInboxRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserInboxRequestDescriptor = $convert.base64Decode(
    'ChNHZXRVc2VySW5ib3hSZXF1ZXN0EhoKCHVzZXJuYW1lGAEgASgJUgh1c2VybmFtZRIUCgVsaW'
    '1pdBgCIAEoBVIFbGltaXQSFQoGbWF4X2lkGAMgASgJUgVtYXhJZA==');

@$core.Deprecated('Use activityDescriptor instead')
const Activity$json = {
  '1': 'Activity',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'type', '3': 2, '4': 1, '5': 9, '10': 'type'},
    {'1': 'actor', '3': 3, '4': 1, '5': 9, '10': 'actor'},
    {'1': 'object', '3': 4, '4': 1, '5': 12, '10': 'object'},
    {
      '1': 'published',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'published'
    },
  ],
};

/// Descriptor for `Activity`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List activityDescriptor = $convert.base64Decode(
    'CghBY3Rpdml0eRIOCgJpZBgBIAEoCVICaWQSEgoEdHlwZRgCIAEoCVIEdHlwZRIUCgVhY3Rvch'
    'gDIAEoCVIFYWN0b3ISFgoGb2JqZWN0GAQgASgMUgZvYmplY3QSOAoJcHVibGlzaGVkGAUgASgL'
    'MhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJcHVibGlzaGVk');

@$core.Deprecated('Use getUserInboxResponseDescriptor instead')
const GetUserInboxResponse$json = {
  '1': 'GetUserInboxResponse',
  '2': [
    {
      '1': 'activities',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.activitypub.v1.Activity',
      '10': 'activities'
    },
    {'1': 'next_max_id', '3': 2, '4': 1, '5': 9, '10': 'nextMaxId'},
  ],
};

/// Descriptor for `GetUserInboxResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserInboxResponseDescriptor = $convert.base64Decode(
    'ChRHZXRVc2VySW5ib3hSZXNwb25zZRJKCgphY3Rpdml0aWVzGAEgAygLMioucGVlcnNfdG91Y2'
    'gubW9kZWwuYWN0aXZpdHlwdWIudjEuQWN0aXZpdHlSCmFjdGl2aXRpZXMSHgoLbmV4dF9tYXhf'
    'aWQYAiABKAlSCW5leHRNYXhJZA==');

@$core.Deprecated('Use postUserInboxRequestDescriptor instead')
const PostUserInboxRequest$json = {
  '1': 'PostUserInboxRequest',
  '2': [
    {'1': 'username', '3': 1, '4': 1, '5': 9, '10': 'username'},
    {'1': 'activity', '3': 2, '4': 1, '5': 12, '10': 'activity'},
  ],
};

/// Descriptor for `PostUserInboxRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postUserInboxRequestDescriptor = $convert.base64Decode(
    'ChRQb3N0VXNlckluYm94UmVxdWVzdBIaCgh1c2VybmFtZRgBIAEoCVIIdXNlcm5hbWUSGgoIYW'
    'N0aXZpdHkYAiABKAxSCGFjdGl2aXR5');

@$core.Deprecated('Use postUserInboxResponseDescriptor instead')
const PostUserInboxResponse$json = {
  '1': 'PostUserInboxResponse',
  '2': [
    {'1': 'accepted', '3': 1, '4': 1, '5': 8, '10': 'accepted'},
  ],
};

/// Descriptor for `PostUserInboxResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postUserInboxResponseDescriptor =
    $convert.base64Decode(
        'ChVQb3N0VXNlckluYm94UmVzcG9uc2USGgoIYWNjZXB0ZWQYASABKAhSCGFjY2VwdGVk');

@$core.Deprecated('Use getUserOutboxRequestDescriptor instead')
const GetUserOutboxRequest$json = {
  '1': 'GetUserOutboxRequest',
  '2': [
    {'1': 'username', '3': 1, '4': 1, '5': 9, '10': 'username'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'max_id', '3': 3, '4': 1, '5': 9, '10': 'maxId'},
  ],
};

/// Descriptor for `GetUserOutboxRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserOutboxRequestDescriptor = $convert.base64Decode(
    'ChRHZXRVc2VyT3V0Ym94UmVxdWVzdBIaCgh1c2VybmFtZRgBIAEoCVIIdXNlcm5hbWUSFAoFbG'
    'ltaXQYAiABKAVSBWxpbWl0EhUKBm1heF9pZBgDIAEoCVIFbWF4SWQ=');

@$core.Deprecated('Use getUserOutboxResponseDescriptor instead')
const GetUserOutboxResponse$json = {
  '1': 'GetUserOutboxResponse',
  '2': [
    {
      '1': 'activities',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.activitypub.v1.Activity',
      '10': 'activities'
    },
    {'1': 'next_max_id', '3': 2, '4': 1, '5': 9, '10': 'nextMaxId'},
  ],
};

/// Descriptor for `GetUserOutboxResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserOutboxResponseDescriptor = $convert.base64Decode(
    'ChVHZXRVc2VyT3V0Ym94UmVzcG9uc2USSgoKYWN0aXZpdGllcxgBIAMoCzIqLnBlZXJzX3RvdW'
    'NoLm1vZGVsLmFjdGl2aXR5cHViLnYxLkFjdGl2aXR5UgphY3Rpdml0aWVzEh4KC25leHRfbWF4'
    'X2lkGAIgASgJUgluZXh0TWF4SWQ=');

@$core.Deprecated('Use postUserOutboxRequestDescriptor instead')
const PostUserOutboxRequest$json = {
  '1': 'PostUserOutboxRequest',
  '2': [
    {'1': 'username', '3': 1, '4': 1, '5': 9, '10': 'username'},
    {'1': 'activity', '3': 2, '4': 1, '5': 12, '10': 'activity'},
  ],
};

/// Descriptor for `PostUserOutboxRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postUserOutboxRequestDescriptor = $convert.base64Decode(
    'ChVQb3N0VXNlck91dGJveFJlcXVlc3QSGgoIdXNlcm5hbWUYASABKAlSCHVzZXJuYW1lEhoKCG'
    'FjdGl2aXR5GAIgASgMUghhY3Rpdml0eQ==');

@$core.Deprecated('Use postUserOutboxResponseDescriptor instead')
const PostUserOutboxResponse$json = {
  '1': 'PostUserOutboxResponse',
  '2': [
    {'1': 'activity_id', '3': 1, '4': 1, '5': 9, '10': 'activityId'},
  ],
};

/// Descriptor for `PostUserOutboxResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postUserOutboxResponseDescriptor =
    $convert.base64Decode(
        'ChZQb3N0VXNlck91dGJveFJlc3BvbnNlEh8KC2FjdGl2aXR5X2lkGAEgASgJUgphY3Rpdml0eU'
        'lk');

@$core.Deprecated('Use getUserFollowersRequestDescriptor instead')
const GetUserFollowersRequest$json = {
  '1': 'GetUserFollowersRequest',
  '2': [
    {'1': 'username', '3': 1, '4': 1, '5': 9, '10': 'username'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'cursor', '3': 3, '4': 1, '5': 9, '10': 'cursor'},
  ],
};

/// Descriptor for `GetUserFollowersRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserFollowersRequestDescriptor =
    $convert.base64Decode(
        'ChdHZXRVc2VyRm9sbG93ZXJzUmVxdWVzdBIaCgh1c2VybmFtZRgBIAEoCVIIdXNlcm5hbWUSFA'
        'oFbGltaXQYAiABKAVSBWxpbWl0EhYKBmN1cnNvchgDIAEoCVIGY3Vyc29y');

@$core.Deprecated('Use getUserFollowersResponseDescriptor instead')
const GetUserFollowersResponse$json = {
  '1': 'GetUserFollowersResponse',
  '2': [
    {'1': 'followers', '3': 1, '4': 3, '5': 9, '10': 'followers'},
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
  ],
};

/// Descriptor for `GetUserFollowersResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserFollowersResponseDescriptor =
    $convert.base64Decode(
        'ChhHZXRVc2VyRm9sbG93ZXJzUmVzcG9uc2USHAoJZm9sbG93ZXJzGAEgAygJUglmb2xsb3dlcn'
        'MSHwoLbmV4dF9jdXJzb3IYAiABKAlSCm5leHRDdXJzb3I=');

@$core.Deprecated('Use getUserFollowingRequestDescriptor instead')
const GetUserFollowingRequest$json = {
  '1': 'GetUserFollowingRequest',
  '2': [
    {'1': 'username', '3': 1, '4': 1, '5': 9, '10': 'username'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'cursor', '3': 3, '4': 1, '5': 9, '10': 'cursor'},
  ],
};

/// Descriptor for `GetUserFollowingRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserFollowingRequestDescriptor =
    $convert.base64Decode(
        'ChdHZXRVc2VyRm9sbG93aW5nUmVxdWVzdBIaCgh1c2VybmFtZRgBIAEoCVIIdXNlcm5hbWUSFA'
        'oFbGltaXQYAiABKAVSBWxpbWl0EhYKBmN1cnNvchgDIAEoCVIGY3Vyc29y');

@$core.Deprecated('Use getUserFollowingResponseDescriptor instead')
const GetUserFollowingResponse$json = {
  '1': 'GetUserFollowingResponse',
  '2': [
    {'1': 'following', '3': 1, '4': 3, '5': 9, '10': 'following'},
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
  ],
};

/// Descriptor for `GetUserFollowingResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserFollowingResponseDescriptor =
    $convert.base64Decode(
        'ChhHZXRVc2VyRm9sbG93aW5nUmVzcG9uc2USHAoJZm9sbG93aW5nGAEgAygJUglmb2xsb3dpbm'
        'cSHwoLbmV4dF9jdXJzb3IYAiABKAlSCm5leHRDdXJzb3I=');

@$core.Deprecated('Use getUserLikedRequestDescriptor instead')
const GetUserLikedRequest$json = {
  '1': 'GetUserLikedRequest',
  '2': [
    {'1': 'username', '3': 1, '4': 1, '5': 9, '10': 'username'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'cursor', '3': 3, '4': 1, '5': 9, '10': 'cursor'},
  ],
};

/// Descriptor for `GetUserLikedRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserLikedRequestDescriptor = $convert.base64Decode(
    'ChNHZXRVc2VyTGlrZWRSZXF1ZXN0EhoKCHVzZXJuYW1lGAEgASgJUgh1c2VybmFtZRIUCgVsaW'
    '1pdBgCIAEoBVIFbGltaXQSFgoGY3Vyc29yGAMgASgJUgZjdXJzb3I=');

@$core.Deprecated('Use getUserLikedResponseDescriptor instead')
const GetUserLikedResponse$json = {
  '1': 'GetUserLikedResponse',
  '2': [
    {'1': 'liked', '3': 1, '4': 3, '5': 9, '10': 'liked'},
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
  ],
};

/// Descriptor for `GetUserLikedResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getUserLikedResponseDescriptor = $convert.base64Decode(
    'ChRHZXRVc2VyTGlrZWRSZXNwb25zZRIUCgVsaWtlZBgBIAMoCVIFbGlrZWQSHwoLbmV4dF9jdX'
    'Jzb3IYAiABKAlSCm5leHRDdXJzb3I=');

@$core.Deprecated('Use getSharedInboxRequestDescriptor instead')
const GetSharedInboxRequest$json = {
  '1': 'GetSharedInboxRequest',
  '2': [
    {'1': 'limit', '3': 1, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'max_id', '3': 2, '4': 1, '5': 9, '10': 'maxId'},
  ],
};

/// Descriptor for `GetSharedInboxRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getSharedInboxRequestDescriptor = $convert.base64Decode(
    'ChVHZXRTaGFyZWRJbmJveFJlcXVlc3QSFAoFbGltaXQYASABKAVSBWxpbWl0EhUKBm1heF9pZB'
    'gCIAEoCVIFbWF4SWQ=');

@$core.Deprecated('Use getSharedInboxResponseDescriptor instead')
const GetSharedInboxResponse$json = {
  '1': 'GetSharedInboxResponse',
  '2': [
    {
      '1': 'activities',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.activitypub.v1.Activity',
      '10': 'activities'
    },
    {'1': 'next_max_id', '3': 2, '4': 1, '5': 9, '10': 'nextMaxId'},
  ],
};

/// Descriptor for `GetSharedInboxResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getSharedInboxResponseDescriptor = $convert.base64Decode(
    'ChZHZXRTaGFyZWRJbmJveFJlc3BvbnNlEkoKCmFjdGl2aXRpZXMYASADKAsyKi5wZWVyc190b3'
    'VjaC5tb2RlbC5hY3Rpdml0eXB1Yi52MS5BY3Rpdml0eVIKYWN0aXZpdGllcxIeCgtuZXh0X21h'
    'eF9pZBgCIAEoCVIJbmV4dE1heElk');

@$core.Deprecated('Use postSharedInboxRequestDescriptor instead')
const PostSharedInboxRequest$json = {
  '1': 'PostSharedInboxRequest',
  '2': [
    {'1': 'activity', '3': 1, '4': 1, '5': 12, '10': 'activity'},
  ],
};

/// Descriptor for `PostSharedInboxRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postSharedInboxRequestDescriptor =
    $convert.base64Decode(
        'ChZQb3N0U2hhcmVkSW5ib3hSZXF1ZXN0EhoKCGFjdGl2aXR5GAEgASgMUghhY3Rpdml0eQ==');

@$core.Deprecated('Use postSharedInboxResponseDescriptor instead')
const PostSharedInboxResponse$json = {
  '1': 'PostSharedInboxResponse',
  '2': [
    {'1': 'accepted', '3': 1, '4': 1, '5': 8, '10': 'accepted'},
  ],
};

/// Descriptor for `PostSharedInboxResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postSharedInboxResponseDescriptor =
    $convert.base64Decode(
        'ChdQb3N0U2hhcmVkSW5ib3hSZXNwb25zZRIaCghhY2NlcHRlZBgBIAEoCFIIYWNjZXB0ZWQ=');

@$core.Deprecated('Use getObjectRepliesRequestDescriptor instead')
const GetObjectRepliesRequest$json = {
  '1': 'GetObjectRepliesRequest',
  '2': [
    {'1': 'object_id', '3': 1, '4': 1, '5': 9, '10': 'objectId'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'cursor', '3': 3, '4': 1, '5': 9, '10': 'cursor'},
  ],
};

/// Descriptor for `GetObjectRepliesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getObjectRepliesRequestDescriptor =
    $convert.base64Decode(
        'ChdHZXRPYmplY3RSZXBsaWVzUmVxdWVzdBIbCglvYmplY3RfaWQYASABKAlSCG9iamVjdElkEh'
        'QKBWxpbWl0GAIgASgFUgVsaW1pdBIWCgZjdXJzb3IYAyABKAlSBmN1cnNvcg==');

@$core.Deprecated('Use getObjectRepliesResponseDescriptor instead')
const GetObjectRepliesResponse$json = {
  '1': 'GetObjectRepliesResponse',
  '2': [
    {
      '1': 'replies',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.activitypub.v1.Activity',
      '10': 'replies'
    },
    {'1': 'next_cursor', '3': 2, '4': 1, '5': 9, '10': 'nextCursor'},
  ],
};

/// Descriptor for `GetObjectRepliesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getObjectRepliesResponseDescriptor = $convert.base64Decode(
    'ChhHZXRPYmplY3RSZXBsaWVzUmVzcG9uc2USRAoHcmVwbGllcxgBIAMoCzIqLnBlZXJzX3RvdW'
    'NoLm1vZGVsLmFjdGl2aXR5cHViLnYxLkFjdGl2aXR5UgdyZXBsaWVzEh8KC25leHRfY3Vyc29y'
    'GAIgASgJUgpuZXh0Q3Vyc29y');

@$core.Deprecated('Use createActivityRequestDescriptor instead')
const CreateActivityRequest$json = {
  '1': 'CreateActivityRequest',
  '2': [
    {'1': 'type', '3': 1, '4': 1, '5': 9, '10': 'type'},
    {'1': 'object', '3': 2, '4': 1, '5': 12, '10': 'object'},
  ],
};

/// Descriptor for `CreateActivityRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createActivityRequestDescriptor = $convert.base64Decode(
    'ChVDcmVhdGVBY3Rpdml0eVJlcXVlc3QSEgoEdHlwZRgBIAEoCVIEdHlwZRIWCgZvYmplY3QYAi'
    'ABKAxSBm9iamVjdA==');

@$core.Deprecated('Use createActivityResponseDescriptor instead')
const CreateActivityResponse$json = {
  '1': 'CreateActivityResponse',
  '2': [
    {'1': 'activity_id', '3': 1, '4': 1, '5': 9, '10': 'activityId'},
  ],
};

/// Descriptor for `CreateActivityResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createActivityResponseDescriptor =
    $convert.base64Decode(
        'ChZDcmVhdGVBY3Rpdml0eVJlc3BvbnNlEh8KC2FjdGl2aXR5X2lkGAEgASgJUgphY3Rpdml0eU'
        'lk');

@$core.Deprecated('Use nodeInfoRequestDescriptor instead')
const NodeInfoRequest$json = {
  '1': 'NodeInfoRequest',
};

/// Descriptor for `NodeInfoRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List nodeInfoRequestDescriptor =
    $convert.base64Decode('Cg9Ob2RlSW5mb1JlcXVlc3Q=');

@$core.Deprecated('Use nodeInfoResponseDescriptor instead')
const NodeInfoResponse$json = {
  '1': 'NodeInfoResponse',
  '2': [
    {'1': 'version', '3': 1, '4': 1, '5': 9, '10': 'version'},
    {
      '1': 'software',
      '3': 2,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.activitypub.v1.NodeInfoResponse.SoftwareEntry',
      '10': 'software'
    },
    {
      '1': 'usage',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.activitypub.v1.NodeInfoResponse.UsageEntry',
      '10': 'usage'
    },
  ],
  '3': [NodeInfoResponse_SoftwareEntry$json, NodeInfoResponse_UsageEntry$json],
};

@$core.Deprecated('Use nodeInfoResponseDescriptor instead')
const NodeInfoResponse_SoftwareEntry$json = {
  '1': 'SoftwareEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

@$core.Deprecated('Use nodeInfoResponseDescriptor instead')
const NodeInfoResponse_UsageEntry$json = {
  '1': 'UsageEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 3, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `NodeInfoResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List nodeInfoResponseDescriptor = $convert.base64Decode(
    'ChBOb2RlSW5mb1Jlc3BvbnNlEhgKB3ZlcnNpb24YASABKAlSB3ZlcnNpb24SXAoIc29mdHdhcm'
    'UYAiADKAsyQC5wZWVyc190b3VjaC5tb2RlbC5hY3Rpdml0eXB1Yi52MS5Ob2RlSW5mb1Jlc3Bv'
    'bnNlLlNvZnR3YXJlRW50cnlSCHNvZnR3YXJlElMKBXVzYWdlGAMgAygLMj0ucGVlcnNfdG91Y2'
    'gubW9kZWwuYWN0aXZpdHlwdWIudjEuTm9kZUluZm9SZXNwb25zZS5Vc2FnZUVudHJ5UgV1c2Fn'
    'ZRo7Cg1Tb2Z0d2FyZUVudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbHVlGAIgASgJUgV2YW'
    'x1ZToCOAEaOAoKVXNhZ2VFbnRyeRIQCgNrZXkYASABKAlSA2tleRIUCgV2YWx1ZRgCIAEoA1IF'
    'dmFsdWU6AjgB');

@$core.Deprecated('Use eventsPullRequestDescriptor instead')
const EventsPullRequest$json = {
  '1': 'EventsPullRequest',
  '2': [
    {'1': 'since_ts', '3': 1, '4': 1, '5': 3, '10': 'sinceTs'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `EventsPullRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List eventsPullRequestDescriptor = $convert.base64Decode(
    'ChFFdmVudHNQdWxsUmVxdWVzdBIZCghzaW5jZV90cxgBIAEoA1IHc2luY2VUcxIUCgVsaW1pdB'
    'gCIAEoBVIFbGltaXQ=');

@$core.Deprecated('Use eventDescriptor instead')
const Event$json = {
  '1': 'Event',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'type', '3': 2, '4': 1, '5': 9, '10': 'type'},
    {'1': 'data', '3': 3, '4': 1, '5': 12, '10': 'data'},
    {
      '1': 'timestamp',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'timestamp'
    },
  ],
};

/// Descriptor for `Event`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List eventDescriptor = $convert.base64Decode(
    'CgVFdmVudBIOCgJpZBgBIAEoCVICaWQSEgoEdHlwZRgCIAEoCVIEdHlwZRISCgRkYXRhGAMgAS'
    'gMUgRkYXRhEjgKCXRpbWVzdGFtcBgEIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBS'
    'CXRpbWVzdGFtcA==');

@$core.Deprecated('Use eventsPullResponseDescriptor instead')
const EventsPullResponse$json = {
  '1': 'EventsPullResponse',
  '2': [
    {
      '1': 'events',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.activitypub.v1.Event',
      '10': 'events'
    },
  ],
};

/// Descriptor for `EventsPullResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List eventsPullResponseDescriptor = $convert.base64Decode(
    'ChJFdmVudHNQdWxsUmVzcG9uc2USPwoGZXZlbnRzGAEgAygLMicucGVlcnNfdG91Y2gubW9kZW'
    'wuYWN0aXZpdHlwdWIudjEuRXZlbnRSBmV2ZW50cw==');

@$core.Deprecated('Use publicProfileRequestDescriptor instead')
const PublicProfileRequest$json = {
  '1': 'PublicProfileRequest',
  '2': [
    {'1': 'username', '3': 1, '4': 1, '5': 9, '10': 'username'},
  ],
};

/// Descriptor for `PublicProfileRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List publicProfileRequestDescriptor =
    $convert.base64Decode(
        'ChRQdWJsaWNQcm9maWxlUmVxdWVzdBIaCgh1c2VybmFtZRgBIAEoCVIIdXNlcm5hbWU=');

@$core.Deprecated('Use publicProfileResponseDescriptor instead')
const PublicProfileResponse$json = {
  '1': 'PublicProfileResponse',
  '2': [
    {'1': 'html', '3': 1, '4': 1, '5': 9, '10': 'html'},
  ],
};

/// Descriptor for `PublicProfileResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List publicProfileResponseDescriptor =
    $convert.base64Decode(
        'ChVQdWJsaWNQcm9maWxlUmVzcG9uc2USEgoEaHRtbBgBIAEoCVIEaHRtbA==');
