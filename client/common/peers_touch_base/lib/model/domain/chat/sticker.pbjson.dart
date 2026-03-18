// This is a generated file - do not edit.
//
// Generated from domain/chat/sticker.proto.

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

@$core.Deprecated('Use stickerPackDescriptor instead')
const StickerPack$json = {
  '1': 'StickerPack',
  '2': [
    {'1': 'ulid', '3': 1, '4': 1, '5': 9, '10': 'ulid'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'author', '3': 3, '4': 1, '5': 9, '10': 'author'},
    {'1': 'description', '3': 4, '4': 1, '5': 9, '10': 'description'},
    {'1': 'cover_url', '3': 5, '4': 1, '5': 9, '10': 'coverUrl'},
    {
      '1': 'stickers',
      '3': 6,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.Sticker',
      '10': 'stickers'
    },
    {'1': 'is_official', '3': 7, '4': 1, '5': 8, '10': 'isOfficial'},
    {'1': 'is_animated', '3': 8, '4': 1, '5': 8, '10': 'isAnimated'},
    {'1': 'sticker_count', '3': 9, '4': 1, '5': 5, '10': 'stickerCount'},
    {'1': 'download_count', '3': 10, '4': 1, '5': 5, '10': 'downloadCount'},
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
  ],
};

/// Descriptor for `StickerPack`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List stickerPackDescriptor = $convert.base64Decode(
    'CgtTdGlja2VyUGFjaxISCgR1bGlkGAEgASgJUgR1bGlkEhIKBG5hbWUYAiABKAlSBG5hbWUSFg'
    'oGYXV0aG9yGAMgASgJUgZhdXRob3ISIAoLZGVzY3JpcHRpb24YBCABKAlSC2Rlc2NyaXB0aW9u'
    'EhsKCWNvdmVyX3VybBgFIAEoCVIIY292ZXJVcmwSPgoIc3RpY2tlcnMYBiADKAsyIi5wZWVyc1'
    '90b3VjaC5tb2RlbC5jaGF0LnYxLlN0aWNrZXJSCHN0aWNrZXJzEh8KC2lzX29mZmljaWFsGAcg'
    'ASgIUgppc09mZmljaWFsEh8KC2lzX2FuaW1hdGVkGAggASgIUgppc0FuaW1hdGVkEiMKDXN0aW'
    'NrZXJfY291bnQYCSABKAVSDHN0aWNrZXJDb3VudBIlCg5kb3dubG9hZF9jb3VudBgKIAEoBVIN'
    'ZG93bmxvYWRDb3VudBI5CgpjcmVhdGVkX2F0GAsgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbW'
    'VzdGFtcFIJY3JlYXRlZEF0EjkKCnVwZGF0ZWRfYXQYDCABKAsyGi5nb29nbGUucHJvdG9idWYu'
    'VGltZXN0YW1wUgl1cGRhdGVkQXQ=');

@$core.Deprecated('Use stickerDescriptor instead')
const Sticker$json = {
  '1': 'Sticker',
  '2': [
    {'1': 'ulid', '3': 1, '4': 1, '5': 9, '10': 'ulid'},
    {'1': 'pack_ulid', '3': 2, '4': 1, '5': 9, '10': 'packUlid'},
    {'1': 'emoji', '3': 3, '4': 1, '5': 9, '10': 'emoji'},
    {'1': 'url', '3': 4, '4': 1, '5': 9, '10': 'url'},
    {'1': 'thumbnail_url', '3': 5, '4': 1, '5': 9, '10': 'thumbnailUrl'},
    {'1': 'width', '3': 6, '4': 1, '5': 5, '10': 'width'},
    {'1': 'height', '3': 7, '4': 1, '5': 5, '10': 'height'},
    {'1': 'file_type', '3': 8, '4': 1, '5': 9, '10': 'fileType'},
    {'1': 'file_size', '3': 9, '4': 1, '5': 3, '10': 'fileSize'},
  ],
};

/// Descriptor for `Sticker`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List stickerDescriptor = $convert.base64Decode(
    'CgdTdGlja2VyEhIKBHVsaWQYASABKAlSBHVsaWQSGwoJcGFja191bGlkGAIgASgJUghwYWNrVW'
    'xpZBIUCgVlbW9qaRgDIAEoCVIFZW1vamkSEAoDdXJsGAQgASgJUgN1cmwSIwoNdGh1bWJuYWls'
    'X3VybBgFIAEoCVIMdGh1bWJuYWlsVXJsEhQKBXdpZHRoGAYgASgFUgV3aWR0aBIWCgZoZWlnaH'
    'QYByABKAVSBmhlaWdodBIbCglmaWxlX3R5cGUYCCABKAlSCGZpbGVUeXBlEhsKCWZpbGVfc2l6'
    'ZRgJIAEoA1IIZmlsZVNpemU=');

@$core.Deprecated('Use userStickerCollectionDescriptor instead')
const UserStickerCollection$json = {
  '1': 'UserStickerCollection',
  '2': [
    {'1': 'actor_did', '3': 1, '4': 1, '5': 9, '10': 'actorDid'},
    {
      '1': 'collected_pack_ulids',
      '3': 2,
      '4': 3,
      '5': 9,
      '10': 'collectedPackUlids'
    },
    {
      '1': 'recent_stickers',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.RecentSticker',
      '10': 'recentStickers'
    },
  ],
};

/// Descriptor for `UserStickerCollection`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List userStickerCollectionDescriptor = $convert.base64Decode(
    'ChVVc2VyU3RpY2tlckNvbGxlY3Rpb24SGwoJYWN0b3JfZGlkGAEgASgJUghhY3RvckRpZBIwCh'
    'Rjb2xsZWN0ZWRfcGFja191bGlkcxgCIAMoCVISY29sbGVjdGVkUGFja1VsaWRzElEKD3JlY2Vu'
    'dF9zdGlja2VycxgDIAMoCzIoLnBlZXJzX3RvdWNoLm1vZGVsLmNoYXQudjEuUmVjZW50U3RpY2'
    'tlclIOcmVjZW50U3RpY2tlcnM=');

@$core.Deprecated('Use recentStickerDescriptor instead')
const RecentSticker$json = {
  '1': 'RecentSticker',
  '2': [
    {'1': 'sticker_ulid', '3': 1, '4': 1, '5': 9, '10': 'stickerUlid'},
    {
      '1': 'used_at',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'usedAt'
    },
    {'1': 'use_count', '3': 3, '4': 1, '5': 5, '10': 'useCount'},
  ],
};

/// Descriptor for `RecentSticker`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List recentStickerDescriptor = $convert.base64Decode(
    'Cg1SZWNlbnRTdGlja2VyEiEKDHN0aWNrZXJfdWxpZBgBIAEoCVILc3RpY2tlclVsaWQSMwoHdX'
    'NlZF9hdBgCIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSBnVzZWRBdBIbCgl1c2Vf'
    'Y291bnQYAyABKAVSCHVzZUNvdW50');

@$core.Deprecated('Use listOfficialStickerPacksRequestDescriptor instead')
const ListOfficialStickerPacksRequest$json = {
  '1': 'ListOfficialStickerPacksRequest',
  '2': [
    {'1': 'limit', '3': 1, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'offset', '3': 2, '4': 1, '5': 5, '10': 'offset'},
    {'1': 'keyword', '3': 3, '4': 1, '5': 9, '10': 'keyword'},
  ],
};

/// Descriptor for `ListOfficialStickerPacksRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listOfficialStickerPacksRequestDescriptor =
    $convert.base64Decode(
        'Ch9MaXN0T2ZmaWNpYWxTdGlja2VyUGFja3NSZXF1ZXN0EhQKBWxpbWl0GAEgASgFUgVsaW1pdB'
        'IWCgZvZmZzZXQYAiABKAVSBm9mZnNldBIYCgdrZXl3b3JkGAMgASgJUgdrZXl3b3Jk');

@$core.Deprecated('Use listOfficialStickerPacksResponseDescriptor instead')
const ListOfficialStickerPacksResponse$json = {
  '1': 'ListOfficialStickerPacksResponse',
  '2': [
    {
      '1': 'packs',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.StickerPack',
      '10': 'packs'
    },
    {'1': 'total', '3': 2, '4': 1, '5': 5, '10': 'total'},
  ],
};

/// Descriptor for `ListOfficialStickerPacksResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listOfficialStickerPacksResponseDescriptor =
    $convert.base64Decode(
        'CiBMaXN0T2ZmaWNpYWxTdGlja2VyUGFja3NSZXNwb25zZRI8CgVwYWNrcxgBIAMoCzImLnBlZX'
        'JzX3RvdWNoLm1vZGVsLmNoYXQudjEuU3RpY2tlclBhY2tSBXBhY2tzEhQKBXRvdGFsGAIgASgF'
        'UgV0b3RhbA==');

@$core.Deprecated('Use getStickerPackRequestDescriptor instead')
const GetStickerPackRequest$json = {
  '1': 'GetStickerPackRequest',
  '2': [
    {'1': 'pack_ulid', '3': 1, '4': 1, '5': 9, '10': 'packUlid'},
  ],
};

/// Descriptor for `GetStickerPackRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getStickerPackRequestDescriptor = $convert.base64Decode(
    'ChVHZXRTdGlja2VyUGFja1JlcXVlc3QSGwoJcGFja191bGlkGAEgASgJUghwYWNrVWxpZA==');

@$core.Deprecated('Use getStickerPackResponseDescriptor instead')
const GetStickerPackResponse$json = {
  '1': 'GetStickerPackResponse',
  '2': [
    {
      '1': 'pack',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.StickerPack',
      '10': 'pack'
    },
    {'1': 'is_collected', '3': 2, '4': 1, '5': 8, '10': 'isCollected'},
  ],
};

/// Descriptor for `GetStickerPackResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getStickerPackResponseDescriptor = $convert.base64Decode(
    'ChZHZXRTdGlja2VyUGFja1Jlc3BvbnNlEjoKBHBhY2sYASABKAsyJi5wZWVyc190b3VjaC5tb2'
    'RlbC5jaGF0LnYxLlN0aWNrZXJQYWNrUgRwYWNrEiEKDGlzX2NvbGxlY3RlZBgCIAEoCFILaXND'
    'b2xsZWN0ZWQ=');

@$core.Deprecated('Use collectStickerPackRequestDescriptor instead')
const CollectStickerPackRequest$json = {
  '1': 'CollectStickerPackRequest',
  '2': [
    {'1': 'pack_ulid', '3': 1, '4': 1, '5': 9, '10': 'packUlid'},
  ],
};

/// Descriptor for `CollectStickerPackRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List collectStickerPackRequestDescriptor =
    $convert.base64Decode(
        'ChlDb2xsZWN0U3RpY2tlclBhY2tSZXF1ZXN0EhsKCXBhY2tfdWxpZBgBIAEoCVIIcGFja1VsaW'
        'Q=');

@$core.Deprecated('Use collectStickerPackResponseDescriptor instead')
const CollectStickerPackResponse$json = {
  '1': 'CollectStickerPackResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `CollectStickerPackResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List collectStickerPackResponseDescriptor =
    $convert.base64Decode(
        'ChpDb2xsZWN0U3RpY2tlclBhY2tSZXNwb25zZRIYCgdzdWNjZXNzGAEgASgIUgdzdWNjZXNz');

@$core.Deprecated('Use uncollectStickerPackRequestDescriptor instead')
const UncollectStickerPackRequest$json = {
  '1': 'UncollectStickerPackRequest',
  '2': [
    {'1': 'pack_ulid', '3': 1, '4': 1, '5': 9, '10': 'packUlid'},
  ],
};

/// Descriptor for `UncollectStickerPackRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List uncollectStickerPackRequestDescriptor =
    $convert.base64Decode(
        'ChtVbmNvbGxlY3RTdGlja2VyUGFja1JlcXVlc3QSGwoJcGFja191bGlkGAEgASgJUghwYWNrVW'
        'xpZA==');

@$core.Deprecated('Use uncollectStickerPackResponseDescriptor instead')
const UncollectStickerPackResponse$json = {
  '1': 'UncollectStickerPackResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `UncollectStickerPackResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List uncollectStickerPackResponseDescriptor =
    $convert.base64Decode(
        'ChxVbmNvbGxlY3RTdGlja2VyUGFja1Jlc3BvbnNlEhgKB3N1Y2Nlc3MYASABKAhSB3N1Y2Nlc3'
        'M=');

@$core.Deprecated('Use getMyStickerPacksRequestDescriptor instead')
const GetMyStickerPacksRequest$json = {
  '1': 'GetMyStickerPacksRequest',
  '2': [
    {'1': 'include_recent', '3': 1, '4': 1, '5': 8, '10': 'includeRecent'},
  ],
};

/// Descriptor for `GetMyStickerPacksRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyStickerPacksRequestDescriptor =
    $convert.base64Decode(
        'ChhHZXRNeVN0aWNrZXJQYWNrc1JlcXVlc3QSJQoOaW5jbHVkZV9yZWNlbnQYASABKAhSDWluY2'
        'x1ZGVSZWNlbnQ=');

@$core.Deprecated('Use getMyStickerPacksResponseDescriptor instead')
const GetMyStickerPacksResponse$json = {
  '1': 'GetMyStickerPacksResponse',
  '2': [
    {
      '1': 'packs',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.StickerPack',
      '10': 'packs'
    },
    {
      '1': 'recent_stickers',
      '3': 2,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.RecentSticker',
      '10': 'recentStickers'
    },
  ],
};

/// Descriptor for `GetMyStickerPacksResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyStickerPacksResponseDescriptor = $convert.base64Decode(
    'ChlHZXRNeVN0aWNrZXJQYWNrc1Jlc3BvbnNlEjwKBXBhY2tzGAEgAygLMiYucGVlcnNfdG91Y2'
    'gubW9kZWwuY2hhdC52MS5TdGlja2VyUGFja1IFcGFja3MSUQoPcmVjZW50X3N0aWNrZXJzGAIg'
    'AygLMigucGVlcnNfdG91Y2gubW9kZWwuY2hhdC52MS5SZWNlbnRTdGlja2VyUg5yZWNlbnRTdG'
    'lja2Vycw==');

@$core.Deprecated('Use recordStickerUsageRequestDescriptor instead')
const RecordStickerUsageRequest$json = {
  '1': 'RecordStickerUsageRequest',
  '2': [
    {'1': 'sticker_ulid', '3': 1, '4': 1, '5': 9, '10': 'stickerUlid'},
  ],
};

/// Descriptor for `RecordStickerUsageRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List recordStickerUsageRequestDescriptor =
    $convert.base64Decode(
        'ChlSZWNvcmRTdGlja2VyVXNhZ2VSZXF1ZXN0EiEKDHN0aWNrZXJfdWxpZBgBIAEoCVILc3RpY2'
        'tlclVsaWQ=');

@$core.Deprecated('Use recordStickerUsageResponseDescriptor instead')
const RecordStickerUsageResponse$json = {
  '1': 'RecordStickerUsageResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `RecordStickerUsageResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List recordStickerUsageResponseDescriptor =
    $convert.base64Decode(
        'ChpSZWNvcmRTdGlja2VyVXNhZ2VSZXNwb25zZRIYCgdzdWNjZXNzGAEgASgIUgdzdWNjZXNz');

@$core.Deprecated('Use searchStickersRequestDescriptor instead')
const SearchStickersRequest$json = {
  '1': 'SearchStickersRequest',
  '2': [
    {'1': 'query', '3': 1, '4': 1, '5': 9, '10': 'query'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `SearchStickersRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchStickersRequestDescriptor = $convert.base64Decode(
    'ChVTZWFyY2hTdGlja2Vyc1JlcXVlc3QSFAoFcXVlcnkYASABKAlSBXF1ZXJ5EhQKBWxpbWl0GA'
    'IgASgFUgVsaW1pdA==');

@$core.Deprecated('Use searchStickersResponseDescriptor instead')
const SearchStickersResponse$json = {
  '1': 'SearchStickersResponse',
  '2': [
    {
      '1': 'stickers',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.Sticker',
      '10': 'stickers'
    },
  ],
};

/// Descriptor for `SearchStickersResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchStickersResponseDescriptor =
    $convert.base64Decode(
        'ChZTZWFyY2hTdGlja2Vyc1Jlc3BvbnNlEj4KCHN0aWNrZXJzGAEgAygLMiIucGVlcnNfdG91Y2'
        'gubW9kZWwuY2hhdC52MS5TdGlja2VyUghzdGlja2Vycw==');

@$core.Deprecated('Use createStickerPackRequestDescriptor instead')
const CreateStickerPackRequest$json = {
  '1': 'CreateStickerPackRequest',
  '2': [
    {'1': 'name', '3': 1, '4': 1, '5': 9, '10': 'name'},
    {'1': 'description', '3': 2, '4': 1, '5': 9, '10': 'description'},
    {
      '1': 'stickers',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.CreateStickerItem',
      '10': 'stickers'
    },
  ],
};

/// Descriptor for `CreateStickerPackRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createStickerPackRequestDescriptor = $convert.base64Decode(
    'ChhDcmVhdGVTdGlja2VyUGFja1JlcXVlc3QSEgoEbmFtZRgBIAEoCVIEbmFtZRIgCgtkZXNjcm'
    'lwdGlvbhgCIAEoCVILZGVzY3JpcHRpb24SSAoIc3RpY2tlcnMYAyADKAsyLC5wZWVyc190b3Vj'
    'aC5tb2RlbC5jaGF0LnYxLkNyZWF0ZVN0aWNrZXJJdGVtUghzdGlja2Vycw==');

@$core.Deprecated('Use createStickerItemDescriptor instead')
const CreateStickerItem$json = {
  '1': 'CreateStickerItem',
  '2': [
    {'1': 'emoji', '3': 1, '4': 1, '5': 9, '10': 'emoji'},
    {'1': 'image_data', '3': 2, '4': 1, '5': 12, '10': 'imageData'},
    {'1': 'file_type', '3': 3, '4': 1, '5': 9, '10': 'fileType'},
  ],
};

/// Descriptor for `CreateStickerItem`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createStickerItemDescriptor = $convert.base64Decode(
    'ChFDcmVhdGVTdGlja2VySXRlbRIUCgVlbW9qaRgBIAEoCVIFZW1vamkSHQoKaW1hZ2VfZGF0YR'
    'gCIAEoDFIJaW1hZ2VEYXRhEhsKCWZpbGVfdHlwZRgDIAEoCVIIZmlsZVR5cGU=');

@$core.Deprecated('Use createStickerPackResponseDescriptor instead')
const CreateStickerPackResponse$json = {
  '1': 'CreateStickerPackResponse',
  '2': [
    {
      '1': 'pack',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.chat.v1.StickerPack',
      '10': 'pack'
    },
  ],
};

/// Descriptor for `CreateStickerPackResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createStickerPackResponseDescriptor =
    $convert.base64Decode(
        'ChlDcmVhdGVTdGlja2VyUGFja1Jlc3BvbnNlEjoKBHBhY2sYASABKAsyJi5wZWVyc190b3VjaC'
        '5tb2RlbC5jaGF0LnYxLlN0aWNrZXJQYWNrUgRwYWNr');
