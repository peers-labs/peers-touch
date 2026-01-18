// This is a generated file - do not edit.
//
// Generated from domain/actor/actor.proto.

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

@$core.Deprecated('Use actorDescriptor instead')
const Actor$json = {
  '1': 'Actor',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'username', '3': 2, '4': 1, '5': 9, '10': 'username'},
    {'1': 'display_name', '3': 3, '4': 1, '5': 9, '10': 'displayName'},
    {'1': 'email', '3': 4, '4': 1, '5': 9, '10': 'email'},
    {'1': 'inbox', '3': 5, '4': 1, '5': 9, '10': 'inbox'},
    {'1': 'outbox', '3': 6, '4': 1, '5': 9, '10': 'outbox'},
    {
      '1': 'endpoints',
      '3': 7,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.actor.v1.Actor.EndpointsEntry',
      '10': 'endpoints'
    },
    {'1': 'is_following', '3': 8, '4': 1, '5': 8, '10': 'is_following'},
    {'1': 'actor_id', '3': 9, '4': 1, '5': 4, '10': 'actor_id'},
    {'1': 'followed_by', '3': 10, '4': 1, '5': 8, '10': 'followed_by'},
  ],
  '3': [Actor_EndpointsEntry$json],
};

@$core.Deprecated('Use actorDescriptor instead')
const Actor_EndpointsEntry$json = {
  '1': 'EndpointsEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `Actor`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List actorDescriptor = $convert.base64Decode(
    'CgVBY3RvchIOCgJpZBgBIAEoCVICaWQSGgoIdXNlcm5hbWUYAiABKAlSCHVzZXJuYW1lEiEKDG'
    'Rpc3BsYXlfbmFtZRgDIAEoCVILZGlzcGxheU5hbWUSFAoFZW1haWwYBCABKAlSBWVtYWlsEhQK'
    'BWluYm94GAUgASgJUgVpbmJveBIWCgZvdXRib3gYBiABKAlSBm91dGJveBJOCgllbmRwb2ludH'
    'MYByADKAsyMC5wZWVyc190b3VjaC5tb2RlbC5hY3Rvci52MS5BY3Rvci5FbmRwb2ludHNFbnRy'
    'eVIJZW5kcG9pbnRzEiIKDGlzX2ZvbGxvd2luZxgIIAEoCFIMaXNfZm9sbG93aW5nEhoKCGFjdG'
    '9yX2lkGAkgASgEUghhY3Rvcl9pZBIgCgtmb2xsb3dlZF9ieRgKIAEoCFILZm9sbG93ZWRfYnka'
    'PAoORW5kcG9pbnRzRW50cnkSEAoDa2V5GAEgASgJUgNrZXkSFAoFdmFsdWUYAiABKAlSBXZhbH'
    'VlOgI4AQ==');

@$core.Deprecated('Use userLinkDescriptor instead')
const UserLink$json = {
  '1': 'UserLink',
  '2': [
    {'1': 'label', '3': 1, '4': 1, '5': 9, '10': 'label'},
    {'1': 'url', '3': 2, '4': 1, '5': 9, '10': 'url'},
  ],
};

/// Descriptor for `UserLink`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List userLinkDescriptor = $convert.base64Decode(
    'CghVc2VyTGluaxIUCgVsYWJlbBgBIAEoCVIFbGFiZWwSEAoDdXJsGAIgASgJUgN1cmw=');

@$core.Deprecated('Use peersTouchInfoDescriptor instead')
const PeersTouchInfo$json = {
  '1': 'PeersTouchInfo',
  '2': [
    {'1': 'network_id', '3': 1, '4': 1, '5': 9, '10': 'network_id'},
  ],
};

/// Descriptor for `PeersTouchInfo`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List peersTouchInfoDescriptor = $convert.base64Decode(
    'Cg5QZWVyc1RvdWNoSW5mbxIeCgpuZXR3b3JrX2lkGAEgASgJUgpuZXR3b3JrX2lk');

@$core.Deprecated('Use actorProfileDescriptor instead')
const ActorProfile$json = {
  '1': 'ActorProfile',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'display_name', '3': 2, '4': 1, '5': 9, '10': 'display_name'},
    {'1': 'username', '3': 3, '4': 1, '5': 9, '10': 'username'},
    {'1': 'note', '3': 4, '4': 1, '5': 9, '10': 'note'},
    {'1': 'avatar', '3': 5, '4': 1, '5': 9, '10': 'avatar'},
    {'1': 'header', '3': 6, '4': 1, '5': 9, '10': 'header'},
    {'1': 'region', '3': 7, '4': 1, '5': 9, '10': 'region'},
    {'1': 'timezone', '3': 8, '4': 1, '5': 9, '10': 'timezone'},
    {'1': 'tags', '3': 9, '4': 3, '5': 9, '10': 'tags'},
    {
      '1': 'links',
      '3': 10,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.actor.v1.UserLink',
      '10': 'links'
    },
    {'1': 'url', '3': 11, '4': 1, '5': 9, '10': 'url'},
    {'1': 'server_domain', '3': 12, '4': 1, '5': 9, '10': 'server_domain'},
    {'1': 'key_fingerprint', '3': 13, '4': 1, '5': 9, '10': 'key_fingerprint'},
    {'1': 'verifications', '3': 14, '4': 3, '5': 9, '10': 'verifications'},
    {
      '1': 'peers_touch',
      '3': 15,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.actor.v1.PeersTouchInfo',
      '10': 'peers_touch'
    },
    {'1': 'acct', '3': 16, '4': 1, '5': 9, '10': 'acct'},
    {'1': 'locked', '3': 17, '4': 1, '5': 8, '10': 'locked'},
    {'1': 'created_at', '3': 18, '4': 1, '5': 9, '10': 'created_at'},
    {'1': 'followers_count', '3': 19, '4': 1, '5': 3, '10': 'followers_count'},
    {'1': 'following_count', '3': 20, '4': 1, '5': 3, '10': 'following_count'},
    {'1': 'statuses_count', '3': 21, '4': 1, '5': 3, '10': 'statuses_count'},
    {'1': 'show_counts', '3': 22, '4': 1, '5': 8, '10': 'show_counts'},
    {'1': 'moments', '3': 23, '4': 3, '5': 9, '10': 'moments'},
    {
      '1': 'default_visibility',
      '3': 24,
      '4': 1,
      '5': 9,
      '10': 'default_visibility'
    },
    {
      '1': 'manually_approves_followers',
      '3': 25,
      '4': 1,
      '5': 8,
      '10': 'manually_approves_followers'
    },
    {
      '1': 'message_permission',
      '3': 26,
      '4': 1,
      '5': 9,
      '10': 'message_permission'
    },
    {
      '1': 'auto_expire_days',
      '3': 27,
      '4': 1,
      '5': 5,
      '10': 'auto_expire_days'
    },
  ],
};

/// Descriptor for `ActorProfile`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List actorProfileDescriptor = $convert.base64Decode(
    'CgxBY3RvclByb2ZpbGUSDgoCaWQYASABKAlSAmlkEiIKDGRpc3BsYXlfbmFtZRgCIAEoCVIMZG'
    'lzcGxheV9uYW1lEhoKCHVzZXJuYW1lGAMgASgJUgh1c2VybmFtZRISCgRub3RlGAQgASgJUgRu'
    'b3RlEhYKBmF2YXRhchgFIAEoCVIGYXZhdGFyEhYKBmhlYWRlchgGIAEoCVIGaGVhZGVyEhYKBn'
    'JlZ2lvbhgHIAEoCVIGcmVnaW9uEhoKCHRpbWV6b25lGAggASgJUgh0aW1lem9uZRISCgR0YWdz'
    'GAkgAygJUgR0YWdzEjoKBWxpbmtzGAogAygLMiQucGVlcnNfdG91Y2gubW9kZWwuYWN0b3Iudj'
    'EuVXNlckxpbmtSBWxpbmtzEhAKA3VybBgLIAEoCVIDdXJsEiQKDXNlcnZlcl9kb21haW4YDCAB'
    'KAlSDXNlcnZlcl9kb21haW4SKAoPa2V5X2ZpbmdlcnByaW50GA0gASgJUg9rZXlfZmluZ2VycH'
    'JpbnQSJAoNdmVyaWZpY2F0aW9ucxgOIAMoCVINdmVyaWZpY2F0aW9ucxJMCgtwZWVyc190b3Vj'
    'aBgPIAEoCzIqLnBlZXJzX3RvdWNoLm1vZGVsLmFjdG9yLnYxLlBlZXJzVG91Y2hJbmZvUgtwZW'
    'Vyc190b3VjaBISCgRhY2N0GBAgASgJUgRhY2N0EhYKBmxvY2tlZBgRIAEoCFIGbG9ja2VkEh4K'
    'CmNyZWF0ZWRfYXQYEiABKAlSCmNyZWF0ZWRfYXQSKAoPZm9sbG93ZXJzX2NvdW50GBMgASgDUg'
    '9mb2xsb3dlcnNfY291bnQSKAoPZm9sbG93aW5nX2NvdW50GBQgASgDUg9mb2xsb3dpbmdfY291'
    'bnQSJgoOc3RhdHVzZXNfY291bnQYFSABKANSDnN0YXR1c2VzX2NvdW50EiAKC3Nob3dfY291bn'
    'RzGBYgASgIUgtzaG93X2NvdW50cxIYCgdtb21lbnRzGBcgAygJUgdtb21lbnRzEi4KEmRlZmF1'
    'bHRfdmlzaWJpbGl0eRgYIAEoCVISZGVmYXVsdF92aXNpYmlsaXR5EkAKG21hbnVhbGx5X2FwcH'
    'JvdmVzX2ZvbGxvd2VycxgZIAEoCFIbbWFudWFsbHlfYXBwcm92ZXNfZm9sbG93ZXJzEi4KEm1l'
    'c3NhZ2VfcGVybWlzc2lvbhgaIAEoCVISbWVzc2FnZV9wZXJtaXNzaW9uEioKEGF1dG9fZXhwaX'
    'JlX2RheXMYGyABKAVSEGF1dG9fZXhwaXJlX2RheXM=');

@$core.Deprecated('Use updateProfileRequestDescriptor instead')
const UpdateProfileRequest$json = {
  '1': 'UpdateProfileRequest',
  '2': [
    {
      '1': 'display_name',
      '3': 1,
      '4': 1,
      '5': 9,
      '9': 0,
      '10': 'display_name',
      '17': true
    },
    {'1': 'note', '3': 2, '4': 1, '5': 9, '9': 1, '10': 'note', '17': true},
    {'1': 'avatar', '3': 3, '4': 1, '5': 9, '9': 2, '10': 'avatar', '17': true},
    {'1': 'header', '3': 4, '4': 1, '5': 9, '9': 3, '10': 'header', '17': true},
    {'1': 'region', '3': 5, '4': 1, '5': 9, '9': 4, '10': 'region', '17': true},
    {
      '1': 'timezone',
      '3': 6,
      '4': 1,
      '5': 9,
      '9': 5,
      '10': 'timezone',
      '17': true
    },
    {'1': 'tags', '3': 7, '4': 3, '5': 9, '10': 'tags'},
    {
      '1': 'links',
      '3': 8,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.actor.v1.UserLink',
      '10': 'links'
    },
    {
      '1': 'default_visibility',
      '3': 9,
      '4': 1,
      '5': 9,
      '9': 6,
      '10': 'default_visibility',
      '17': true
    },
    {
      '1': 'manually_approves_followers',
      '3': 10,
      '4': 1,
      '5': 8,
      '9': 7,
      '10': 'manually_approves_followers',
      '17': true
    },
    {
      '1': 'message_permission',
      '3': 11,
      '4': 1,
      '5': 9,
      '9': 8,
      '10': 'message_permission',
      '17': true
    },
    {
      '1': 'auto_expire_days',
      '3': 12,
      '4': 1,
      '5': 5,
      '9': 9,
      '10': 'auto_expire_days',
      '17': true
    },
  ],
  '8': [
    {'1': '_display_name'},
    {'1': '_note'},
    {'1': '_avatar'},
    {'1': '_header'},
    {'1': '_region'},
    {'1': '_timezone'},
    {'1': '_default_visibility'},
    {'1': '_manually_approves_followers'},
    {'1': '_message_permission'},
    {'1': '_auto_expire_days'},
  ],
};

/// Descriptor for `UpdateProfileRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateProfileRequestDescriptor = $convert.base64Decode(
    'ChRVcGRhdGVQcm9maWxlUmVxdWVzdBInCgxkaXNwbGF5X25hbWUYASABKAlIAFIMZGlzcGxheV'
    '9uYW1liAEBEhcKBG5vdGUYAiABKAlIAVIEbm90ZYgBARIbCgZhdmF0YXIYAyABKAlIAlIGYXZh'
    'dGFyiAEBEhsKBmhlYWRlchgEIAEoCUgDUgZoZWFkZXKIAQESGwoGcmVnaW9uGAUgASgJSARSBn'
    'JlZ2lvbogBARIfCgh0aW1lem9uZRgGIAEoCUgFUgh0aW1lem9uZYgBARISCgR0YWdzGAcgAygJ'
    'UgR0YWdzEjoKBWxpbmtzGAggAygLMiQucGVlcnNfdG91Y2gubW9kZWwuYWN0b3IudjEuVXNlck'
    'xpbmtSBWxpbmtzEjMKEmRlZmF1bHRfdmlzaWJpbGl0eRgJIAEoCUgGUhJkZWZhdWx0X3Zpc2li'
    'aWxpdHmIAQESRQobbWFudWFsbHlfYXBwcm92ZXNfZm9sbG93ZXJzGAogASgISAdSG21hbnVhbG'
    'x5X2FwcHJvdmVzX2ZvbGxvd2Vyc4gBARIzChJtZXNzYWdlX3Blcm1pc3Npb24YCyABKAlICFIS'
    'bWVzc2FnZV9wZXJtaXNzaW9uiAEBEi8KEGF1dG9fZXhwaXJlX2RheXMYDCABKAVICVIQYXV0b1'
    '9leHBpcmVfZGF5c4gBAUIPCg1fZGlzcGxheV9uYW1lQgcKBV9ub3RlQgkKB19hdmF0YXJCCQoH'
    'X2hlYWRlckIJCgdfcmVnaW9uQgsKCV90aW1lem9uZUIVChNfZGVmYXVsdF92aXNpYmlsaXR5Qh'
    '4KHF9tYW51YWxseV9hcHByb3Zlc19mb2xsb3dlcnNCFQoTX21lc3NhZ2VfcGVybWlzc2lvbkIT'
    'ChFfYXV0b19leHBpcmVfZGF5cw==');

@$core.Deprecated('Use actorListDescriptor instead')
const ActorList$json = {
  '1': 'ActorList',
  '2': [
    {
      '1': 'items',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.actor.v1.Actor',
      '10': 'items'
    },
    {'1': 'total', '3': 2, '4': 1, '5': 3, '10': 'total'},
  ],
};

/// Descriptor for `ActorList`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List actorListDescriptor = $convert.base64Decode(
    'CglBY3Rvckxpc3QSNwoFaXRlbXMYASADKAsyIS5wZWVyc190b3VjaC5tb2RlbC5hY3Rvci52MS'
    '5BY3RvclIFaXRlbXMSFAoFdG90YWwYAiABKANSBXRvdGFs');
