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
    'eVIJZW5kcG9pbnRzGjwKDkVuZHBvaW50c0VudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbH'
    'VlGAIgASgJUgV2YWx1ZToCOAE=');

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
