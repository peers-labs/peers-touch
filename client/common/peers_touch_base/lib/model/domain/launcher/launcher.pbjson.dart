// This is a generated file - do not edit.
//
// Generated from domain/launcher/launcher.proto.

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

@$core.Deprecated('Use getFeedRequestDescriptor instead')
const GetFeedRequest$json = {
  '1': 'GetFeedRequest',
  '2': [
    {'1': 'user_id', '3': 1, '4': 1, '5': 9, '10': 'userId'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `GetFeedRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getFeedRequestDescriptor = $convert.base64Decode(
    'Cg5HZXRGZWVkUmVxdWVzdBIXCgd1c2VyX2lkGAEgASgJUgZ1c2VySWQSFAoFbGltaXQYAiABKA'
    'VSBWxpbWl0');

@$core.Deprecated('Use feedItemDescriptor instead')
const FeedItem$json = {
  '1': 'FeedItem',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'type', '3': 2, '4': 1, '5': 9, '10': 'type'},
    {'1': 'title', '3': 3, '4': 1, '5': 9, '10': 'title'},
    {'1': 'subtitle', '3': 4, '4': 1, '5': 9, '10': 'subtitle'},
    {'1': 'image_url', '3': 5, '4': 1, '5': 9, '10': 'imageUrl'},
    {'1': 'timestamp', '3': 6, '4': 1, '5': 3, '10': 'timestamp'},
    {'1': 'source', '3': 7, '4': 1, '5': 9, '10': 'source'},
    {
      '1': 'metadata',
      '3': 8,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.domain.launcher.FeedItem.MetadataEntry',
      '10': 'metadata'
    },
  ],
  '3': [FeedItem_MetadataEntry$json],
};

@$core.Deprecated('Use feedItemDescriptor instead')
const FeedItem_MetadataEntry$json = {
  '1': 'MetadataEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `FeedItem`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List feedItemDescriptor = $convert.base64Decode(
    'CghGZWVkSXRlbRIOCgJpZBgBIAEoCVICaWQSEgoEdHlwZRgCIAEoCVIEdHlwZRIUCgV0aXRsZR'
    'gDIAEoCVIFdGl0bGUSGgoIc3VidGl0bGUYBCABKAlSCHN1YnRpdGxlEhsKCWltYWdlX3VybBgF'
    'IAEoCVIIaW1hZ2VVcmwSHAoJdGltZXN0YW1wGAYgASgDUgl0aW1lc3RhbXASFgoGc291cmNlGA'
    'cgASgJUgZzb3VyY2USTwoIbWV0YWRhdGEYCCADKAsyMy5wZWVyc190b3VjaC5kb21haW4ubGF1'
    'bmNoZXIuRmVlZEl0ZW0uTWV0YWRhdGFFbnRyeVIIbWV0YWRhdGEaOwoNTWV0YWRhdGFFbnRyeR'
    'IQCgNrZXkYASABKAlSA2tleRIUCgV2YWx1ZRgCIAEoCVIFdmFsdWU6AjgB');

@$core.Deprecated('Use getFeedResponseDescriptor instead')
const GetFeedResponse$json = {
  '1': 'GetFeedResponse',
  '2': [
    {
      '1': 'items',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.domain.launcher.FeedItem',
      '10': 'items'
    },
  ],
};

/// Descriptor for `GetFeedResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getFeedResponseDescriptor = $convert.base64Decode(
    'Cg9HZXRGZWVkUmVzcG9uc2USOwoFaXRlbXMYASADKAsyJS5wZWVyc190b3VjaC5kb21haW4ubG'
    'F1bmNoZXIuRmVlZEl0ZW1SBWl0ZW1z');

@$core.Deprecated('Use searchRequestDescriptor instead')
const SearchRequest$json = {
  '1': 'SearchRequest',
  '2': [
    {'1': 'query', '3': 1, '4': 1, '5': 9, '10': 'query'},
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
  ],
};

/// Descriptor for `SearchRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchRequestDescriptor = $convert.base64Decode(
    'Cg1TZWFyY2hSZXF1ZXN0EhQKBXF1ZXJ5GAEgASgJUgVxdWVyeRIUCgVsaW1pdBgCIAEoBVIFbG'
    'ltaXQ=');

@$core.Deprecated('Use searchResultDescriptor instead')
const SearchResult$json = {
  '1': 'SearchResult',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'type', '3': 2, '4': 1, '5': 9, '10': 'type'},
    {'1': 'title', '3': 3, '4': 1, '5': 9, '10': 'title'},
    {'1': 'subtitle', '3': 4, '4': 1, '5': 9, '10': 'subtitle'},
    {'1': 'image_url', '3': 5, '4': 1, '5': 9, '10': 'imageUrl'},
    {'1': 'action_url', '3': 6, '4': 1, '5': 9, '10': 'actionUrl'},
    {
      '1': 'metadata',
      '3': 7,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.domain.launcher.SearchResult.MetadataEntry',
      '10': 'metadata'
    },
  ],
  '3': [SearchResult_MetadataEntry$json],
};

@$core.Deprecated('Use searchResultDescriptor instead')
const SearchResult_MetadataEntry$json = {
  '1': 'MetadataEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `SearchResult`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchResultDescriptor = $convert.base64Decode(
    'CgxTZWFyY2hSZXN1bHQSDgoCaWQYASABKAlSAmlkEhIKBHR5cGUYAiABKAlSBHR5cGUSFAoFdG'
    'l0bGUYAyABKAlSBXRpdGxlEhoKCHN1YnRpdGxlGAQgASgJUghzdWJ0aXRsZRIbCglpbWFnZV91'
    'cmwYBSABKAlSCGltYWdlVXJsEh0KCmFjdGlvbl91cmwYBiABKAlSCWFjdGlvblVybBJTCghtZX'
    'RhZGF0YRgHIAMoCzI3LnBlZXJzX3RvdWNoLmRvbWFpbi5sYXVuY2hlci5TZWFyY2hSZXN1bHQu'
    'TWV0YWRhdGFFbnRyeVIIbWV0YWRhdGEaOwoNTWV0YWRhdGFFbnRyeRIQCgNrZXkYASABKAlSA2'
    'tleRIUCgV2YWx1ZRgCIAEoCVIFdmFsdWU6AjgB');

@$core.Deprecated('Use searchResponseDescriptor instead')
const SearchResponse$json = {
  '1': 'SearchResponse',
  '2': [
    {
      '1': 'results',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.domain.launcher.SearchResult',
      '10': 'results'
    },
    {'1': 'total', '3': 2, '4': 1, '5': 5, '10': 'total'},
  ],
};

/// Descriptor for `SearchResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchResponseDescriptor = $convert.base64Decode(
    'Cg5TZWFyY2hSZXNwb25zZRJDCgdyZXN1bHRzGAEgAygLMikucGVlcnNfdG91Y2guZG9tYWluLm'
    'xhdW5jaGVyLlNlYXJjaFJlc3VsdFIHcmVzdWx0cxIUCgV0b3RhbBgCIAEoBVIFdG90YWw=');
