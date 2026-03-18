// This is a generated file - do not edit.
//
// Generated from domain/chat/announcement.proto.

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

@$core.Deprecated('Use groupAnnouncementDescriptor instead')
const GroupAnnouncement$json = {
  '1': 'GroupAnnouncement',
  '2': [
    {'1': 'ulid', '3': 1, '4': 1, '5': 9, '10': 'ulid'},
    {'1': 'group_ulid', '3': 2, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'author_did', '3': 3, '4': 1, '5': 9, '10': 'authorDid'},
    {'1': 'title', '3': 4, '4': 1, '5': 9, '10': 'title'},
    {'1': 'content', '3': 5, '4': 1, '5': 9, '10': 'content'},
    {'1': 'is_pinned', '3': 6, '4': 1, '5': 8, '10': 'isPinned'},
    {'1': 'read_count', '3': 7, '4': 1, '5': 5, '10': 'readCount'},
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
    {
      '1': 'deleted_at',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'deletedAt'
    },
  ],
};

/// Descriptor for `GroupAnnouncement`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List groupAnnouncementDescriptor = $convert.base64Decode(
    'ChFHcm91cEFubm91bmNlbWVudBISCgR1bGlkGAEgASgJUgR1bGlkEh0KCmdyb3VwX3VsaWQYAi'
    'ABKAlSCWdyb3VwVWxpZBIdCgphdXRob3JfZGlkGAMgASgJUglhdXRob3JEaWQSFAoFdGl0bGUY'
    'BCABKAlSBXRpdGxlEhgKB2NvbnRlbnQYBSABKAlSB2NvbnRlbnQSGwoJaXNfcGlubmVkGAYgAS'
    'gIUghpc1Bpbm5lZBIdCgpyZWFkX2NvdW50GAcgASgFUglyZWFkQ291bnQSOQoKY3JlYXRlZF9h'
    'dBgIIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCWNyZWF0ZWRBdBI5Cgp1cGRhdG'
    'VkX2F0GAkgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJdXBkYXRlZEF0EjkKCmRl'
    'bGV0ZWRfYXQYCiABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUglkZWxldGVkQXQ=');

@$core.Deprecated('Use announcementReadRecordDescriptor instead')
const AnnouncementReadRecord$json = {
  '1': 'AnnouncementReadRecord',
  '2': [
    {
      '1': 'announcement_ulid',
      '3': 1,
      '4': 1,
      '5': 9,
      '10': 'announcementUlid'
    },
    {'1': 'reader_did', '3': 2, '4': 1, '5': 9, '10': 'readerDid'},
    {
      '1': 'read_at',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'readAt'
    },
  ],
};

/// Descriptor for `AnnouncementReadRecord`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List announcementReadRecordDescriptor = $convert.base64Decode(
    'ChZBbm5vdW5jZW1lbnRSZWFkUmVjb3JkEisKEWFubm91bmNlbWVudF91bGlkGAEgASgJUhBhbm'
    '5vdW5jZW1lbnRVbGlkEh0KCnJlYWRlcl9kaWQYAiABKAlSCXJlYWRlckRpZBIzCgdyZWFkX2F0'
    'GAMgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIGcmVhZEF0');

@$core.Deprecated('Use createAnnouncementRequestDescriptor instead')
const CreateAnnouncementRequest$json = {
  '1': 'CreateAnnouncementRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'title', '3': 2, '4': 1, '5': 9, '10': 'title'},
    {'1': 'content', '3': 3, '4': 1, '5': 9, '10': 'content'},
    {'1': 'is_pinned', '3': 4, '4': 1, '5': 8, '10': 'isPinned'},
  ],
};

/// Descriptor for `CreateAnnouncementRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createAnnouncementRequestDescriptor = $convert.base64Decode(
    'ChlDcmVhdGVBbm5vdW5jZW1lbnRSZXF1ZXN0Eh0KCmdyb3VwX3VsaWQYASABKAlSCWdyb3VwVW'
    'xpZBIUCgV0aXRsZRgCIAEoCVIFdGl0bGUSGAoHY29udGVudBgDIAEoCVIHY29udGVudBIbCglp'
    'c19waW5uZWQYBCABKAhSCGlzUGlubmVk');

@$core.Deprecated('Use createAnnouncementResponseDescriptor instead')
const CreateAnnouncementResponse$json = {
  '1': 'CreateAnnouncementResponse',
  '2': [
    {
      '1': 'announcement',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupAnnouncement',
      '10': 'announcement'
    },
  ],
};

/// Descriptor for `CreateAnnouncementResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createAnnouncementResponseDescriptor =
    $convert.base64Decode(
        'ChpDcmVhdGVBbm5vdW5jZW1lbnRSZXNwb25zZRJQCgxhbm5vdW5jZW1lbnQYASABKAsyLC5wZW'
        'Vyc190b3VjaC5tb2RlbC5jaGF0LnYxLkdyb3VwQW5ub3VuY2VtZW50Ugxhbm5vdW5jZW1lbnQ=');

@$core.Deprecated('Use listAnnouncementsRequestDescriptor instead')
const ListAnnouncementsRequest$json = {
  '1': 'ListAnnouncementsRequest',
  '2': [
    {'1': 'group_ulid', '3': 1, '4': 1, '5': 9, '10': 'groupUlid'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'offset', '3': 3, '4': 1, '5': 5, '10': 'offset'},
    {'1': 'pinned_only', '3': 4, '4': 1, '5': 8, '10': 'pinnedOnly'},
  ],
};

/// Descriptor for `ListAnnouncementsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listAnnouncementsRequestDescriptor = $convert.base64Decode(
    'ChhMaXN0QW5ub3VuY2VtZW50c1JlcXVlc3QSHQoKZ3JvdXBfdWxpZBgBIAEoCVIJZ3JvdXBVbG'
    'lkEhQKBWxpbWl0GAIgASgFUgVsaW1pdBIWCgZvZmZzZXQYAyABKAVSBm9mZnNldBIfCgtwaW5u'
    'ZWRfb25seRgEIAEoCFIKcGlubmVkT25seQ==');

@$core.Deprecated('Use listAnnouncementsResponseDescriptor instead')
const ListAnnouncementsResponse$json = {
  '1': 'ListAnnouncementsResponse',
  '2': [
    {
      '1': 'announcements',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupAnnouncement',
      '10': 'announcements'
    },
    {'1': 'total', '3': 2, '4': 1, '5': 5, '10': 'total'},
  ],
};

/// Descriptor for `ListAnnouncementsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listAnnouncementsResponseDescriptor = $convert.base64Decode(
    'ChlMaXN0QW5ub3VuY2VtZW50c1Jlc3BvbnNlElIKDWFubm91bmNlbWVudHMYASADKAsyLC5wZW'
    'Vyc190b3VjaC5tb2RlbC5jaGF0LnYxLkdyb3VwQW5ub3VuY2VtZW50Ug1hbm5vdW5jZW1lbnRz'
    'EhQKBXRvdGFsGAIgASgFUgV0b3RhbA==');

@$core.Deprecated('Use getAnnouncementRequestDescriptor instead')
const GetAnnouncementRequest$json = {
  '1': 'GetAnnouncementRequest',
  '2': [
    {
      '1': 'announcement_ulid',
      '3': 1,
      '4': 1,
      '5': 9,
      '10': 'announcementUlid'
    },
  ],
};

/// Descriptor for `GetAnnouncementRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getAnnouncementRequestDescriptor =
    $convert.base64Decode(
        'ChZHZXRBbm5vdW5jZW1lbnRSZXF1ZXN0EisKEWFubm91bmNlbWVudF91bGlkGAEgASgJUhBhbm'
        '5vdW5jZW1lbnRVbGlk');

@$core.Deprecated('Use getAnnouncementResponseDescriptor instead')
const GetAnnouncementResponse$json = {
  '1': 'GetAnnouncementResponse',
  '2': [
    {
      '1': 'announcement',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupAnnouncement',
      '10': 'announcement'
    },
    {'1': 'is_read', '3': 2, '4': 1, '5': 8, '10': 'isRead'},
  ],
};

/// Descriptor for `GetAnnouncementResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getAnnouncementResponseDescriptor = $convert.base64Decode(
    'ChdHZXRBbm5vdW5jZW1lbnRSZXNwb25zZRJQCgxhbm5vdW5jZW1lbnQYASABKAsyLC5wZWVyc1'
    '90b3VjaC5tb2RlbC5jaGF0LnYxLkdyb3VwQW5ub3VuY2VtZW50Ugxhbm5vdW5jZW1lbnQSFwoH'
    'aXNfcmVhZBgCIAEoCFIGaXNSZWFk');

@$core.Deprecated('Use updateAnnouncementRequestDescriptor instead')
const UpdateAnnouncementRequest$json = {
  '1': 'UpdateAnnouncementRequest',
  '2': [
    {
      '1': 'announcement_ulid',
      '3': 1,
      '4': 1,
      '5': 9,
      '10': 'announcementUlid'
    },
    {'1': 'title', '3': 2, '4': 1, '5': 9, '9': 0, '10': 'title', '17': true},
    {
      '1': 'content',
      '3': 3,
      '4': 1,
      '5': 9,
      '9': 1,
      '10': 'content',
      '17': true
    },
    {
      '1': 'is_pinned',
      '3': 4,
      '4': 1,
      '5': 8,
      '9': 2,
      '10': 'isPinned',
      '17': true
    },
  ],
  '8': [
    {'1': '_title'},
    {'1': '_content'},
    {'1': '_is_pinned'},
  ],
};

/// Descriptor for `UpdateAnnouncementRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateAnnouncementRequestDescriptor = $convert.base64Decode(
    'ChlVcGRhdGVBbm5vdW5jZW1lbnRSZXF1ZXN0EisKEWFubm91bmNlbWVudF91bGlkGAEgASgJUh'
    'Bhbm5vdW5jZW1lbnRVbGlkEhkKBXRpdGxlGAIgASgJSABSBXRpdGxliAEBEh0KB2NvbnRlbnQY'
    'AyABKAlIAVIHY29udGVudIgBARIgCglpc19waW5uZWQYBCABKAhIAlIIaXNQaW5uZWSIAQFCCA'
    'oGX3RpdGxlQgoKCF9jb250ZW50QgwKCl9pc19waW5uZWQ=');

@$core.Deprecated('Use updateAnnouncementResponseDescriptor instead')
const UpdateAnnouncementResponse$json = {
  '1': 'UpdateAnnouncementResponse',
  '2': [
    {
      '1': 'announcement',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.GroupAnnouncement',
      '10': 'announcement'
    },
  ],
};

/// Descriptor for `UpdateAnnouncementResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateAnnouncementResponseDescriptor =
    $convert.base64Decode(
        'ChpVcGRhdGVBbm5vdW5jZW1lbnRSZXNwb25zZRJQCgxhbm5vdW5jZW1lbnQYASABKAsyLC5wZW'
        'Vyc190b3VjaC5tb2RlbC5jaGF0LnYxLkdyb3VwQW5ub3VuY2VtZW50Ugxhbm5vdW5jZW1lbnQ=');

@$core.Deprecated('Use deleteAnnouncementRequestDescriptor instead')
const DeleteAnnouncementRequest$json = {
  '1': 'DeleteAnnouncementRequest',
  '2': [
    {
      '1': 'announcement_ulid',
      '3': 1,
      '4': 1,
      '5': 9,
      '10': 'announcementUlid'
    },
  ],
};

/// Descriptor for `DeleteAnnouncementRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteAnnouncementRequestDescriptor =
    $convert.base64Decode(
        'ChlEZWxldGVBbm5vdW5jZW1lbnRSZXF1ZXN0EisKEWFubm91bmNlbWVudF91bGlkGAEgASgJUh'
        'Bhbm5vdW5jZW1lbnRVbGlk');

@$core.Deprecated('Use deleteAnnouncementResponseDescriptor instead')
const DeleteAnnouncementResponse$json = {
  '1': 'DeleteAnnouncementResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `DeleteAnnouncementResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteAnnouncementResponseDescriptor =
    $convert.base64Decode(
        'ChpEZWxldGVBbm5vdW5jZW1lbnRSZXNwb25zZRIYCgdzdWNjZXNzGAEgASgIUgdzdWNjZXNz');

@$core.Deprecated('Use markAnnouncementReadRequestDescriptor instead')
const MarkAnnouncementReadRequest$json = {
  '1': 'MarkAnnouncementReadRequest',
  '2': [
    {
      '1': 'announcement_ulid',
      '3': 1,
      '4': 1,
      '5': 9,
      '10': 'announcementUlid'
    },
  ],
};

/// Descriptor for `MarkAnnouncementReadRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markAnnouncementReadRequestDescriptor =
    $convert.base64Decode(
        'ChtNYXJrQW5ub3VuY2VtZW50UmVhZFJlcXVlc3QSKwoRYW5ub3VuY2VtZW50X3VsaWQYASABKA'
        'lSEGFubm91bmNlbWVudFVsaWQ=');

@$core.Deprecated('Use markAnnouncementReadResponseDescriptor instead')
const MarkAnnouncementReadResponse$json = {
  '1': 'MarkAnnouncementReadResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `MarkAnnouncementReadResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markAnnouncementReadResponseDescriptor =
    $convert.base64Decode(
        'ChxNYXJrQW5ub3VuY2VtZW50UmVhZFJlc3BvbnNlEhgKB3N1Y2Nlc3MYASABKAhSB3N1Y2Nlc3'
        'M=');

@$core.Deprecated('Use getAnnouncementReadersRequestDescriptor instead')
const GetAnnouncementReadersRequest$json = {
  '1': 'GetAnnouncementReadersRequest',
  '2': [
    {
      '1': 'announcement_ulid',
      '3': 1,
      '4': 1,
      '5': 9,
      '10': 'announcementUlid'
    },
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'offset', '3': 3, '4': 1, '5': 5, '10': 'offset'},
  ],
};

/// Descriptor for `GetAnnouncementReadersRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getAnnouncementReadersRequestDescriptor =
    $convert.base64Decode(
        'Ch1HZXRBbm5vdW5jZW1lbnRSZWFkZXJzUmVxdWVzdBIrChFhbm5vdW5jZW1lbnRfdWxpZBgBIA'
        'EoCVIQYW5ub3VuY2VtZW50VWxpZBIUCgVsaW1pdBgCIAEoBVIFbGltaXQSFgoGb2Zmc2V0GAMg'
        'ASgFUgZvZmZzZXQ=');

@$core.Deprecated('Use getAnnouncementReadersResponseDescriptor instead')
const GetAnnouncementReadersResponse$json = {
  '1': 'GetAnnouncementReadersResponse',
  '2': [
    {
      '1': 'readers',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.AnnouncementReadRecord',
      '10': 'readers'
    },
    {'1': 'total', '3': 2, '4': 1, '5': 5, '10': 'total'},
  ],
};

/// Descriptor for `GetAnnouncementReadersResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getAnnouncementReadersResponseDescriptor =
    $convert.base64Decode(
        'Ch5HZXRBbm5vdW5jZW1lbnRSZWFkZXJzUmVzcG9uc2USSwoHcmVhZGVycxgBIAMoCzIxLnBlZX'
        'JzX3RvdWNoLm1vZGVsLmNoYXQudjEuQW5ub3VuY2VtZW50UmVhZFJlY29yZFIHcmVhZGVycxIU'
        'CgV0b3RhbBgCIAEoBVIFdG90YWw=');
