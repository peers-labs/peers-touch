// This is a generated file - do not edit.
//
// Generated from domain/ai_chat/session_messages.proto.

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

@$core.Deprecated('Use createSessionRequestDescriptor instead')
const CreateSessionRequest$json = {
  '1': 'CreateSessionRequest',
  '2': [
    {'1': 'title', '3': 1, '4': 1, '5': 9, '10': 'title'},
    {'1': 'description', '3': 2, '4': 1, '5': 9, '10': 'description'},
    {'1': 'provider_id', '3': 3, '4': 1, '5': 9, '10': 'providerId'},
    {'1': 'model_name', '3': 4, '4': 1, '5': 9, '10': 'modelName'},
    {
      '1': 'meta',
      '3': 5,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.ai_chat.v1.CreateSessionRequest.MetaEntry',
      '10': 'meta'
    },
    {'1': 'config_json', '3': 6, '4': 1, '5': 9, '10': 'configJson'},
  ],
  '3': [CreateSessionRequest_MetaEntry$json],
};

@$core.Deprecated('Use createSessionRequestDescriptor instead')
const CreateSessionRequest_MetaEntry$json = {
  '1': 'MetaEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `CreateSessionRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createSessionRequestDescriptor = $convert.base64Decode(
    'ChRDcmVhdGVTZXNzaW9uUmVxdWVzdBIUCgV0aXRsZRgBIAEoCVIFdGl0bGUSIAoLZGVzY3JpcH'
    'Rpb24YAiABKAlSC2Rlc2NyaXB0aW9uEh8KC3Byb3ZpZGVyX2lkGAMgASgJUgpwcm92aWRlcklk'
    'Eh0KCm1vZGVsX25hbWUYBCABKAlSCW1vZGVsTmFtZRJQCgRtZXRhGAUgAygLMjwucGVlcnNfdG'
    '91Y2gubW9kZWwuYWlfY2hhdC52MS5DcmVhdGVTZXNzaW9uUmVxdWVzdC5NZXRhRW50cnlSBG1l'
    'dGESHwoLY29uZmlnX2pzb24YBiABKAlSCmNvbmZpZ0pzb24aNwoJTWV0YUVudHJ5EhAKA2tleR'
    'gBIAEoCVIDa2V5EhQKBXZhbHVlGAIgASgJUgV2YWx1ZToCOAE=');

@$core.Deprecated('Use createSessionResponseDescriptor instead')
const CreateSessionResponse$json = {
  '1': 'CreateSessionResponse',
  '2': [
    {
      '1': 'session',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.ai_chat.v1.ChatSession',
      '10': 'session'
    },
  ],
};

/// Descriptor for `CreateSessionResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createSessionResponseDescriptor = $convert.base64Decode(
    'ChVDcmVhdGVTZXNzaW9uUmVzcG9uc2USQwoHc2Vzc2lvbhgBIAEoCzIpLnBlZXJzX3RvdWNoLm'
    '1vZGVsLmFpX2NoYXQudjEuQ2hhdFNlc3Npb25SB3Nlc3Npb24=');

@$core.Deprecated('Use getSessionRequestDescriptor instead')
const GetSessionRequest$json = {
  '1': 'GetSessionRequest',
  '2': [
    {'1': 'session_id', '3': 1, '4': 1, '5': 9, '10': 'sessionId'},
  ],
};

/// Descriptor for `GetSessionRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getSessionRequestDescriptor = $convert.base64Decode(
    'ChFHZXRTZXNzaW9uUmVxdWVzdBIdCgpzZXNzaW9uX2lkGAEgASgJUglzZXNzaW9uSWQ=');

@$core.Deprecated('Use getSessionResponseDescriptor instead')
const GetSessionResponse$json = {
  '1': 'GetSessionResponse',
  '2': [
    {
      '1': 'session',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.ai_chat.v1.ChatSession',
      '10': 'session'
    },
  ],
};

/// Descriptor for `GetSessionResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getSessionResponseDescriptor = $convert.base64Decode(
    'ChJHZXRTZXNzaW9uUmVzcG9uc2USQwoHc2Vzc2lvbhgBIAEoCzIpLnBlZXJzX3RvdWNoLm1vZG'
    'VsLmFpX2NoYXQudjEuQ2hhdFNlc3Npb25SB3Nlc3Npb24=');

@$core.Deprecated('Use updateSessionRequestDescriptor instead')
const UpdateSessionRequest$json = {
  '1': 'UpdateSessionRequest',
  '2': [
    {'1': 'session_id', '3': 1, '4': 1, '5': 9, '10': 'sessionId'},
    {'1': 'title', '3': 2, '4': 1, '5': 9, '9': 0, '10': 'title', '17': true},
    {
      '1': 'description',
      '3': 3,
      '4': 1,
      '5': 9,
      '9': 1,
      '10': 'description',
      '17': true
    },
    {'1': 'pinned', '3': 4, '4': 1, '5': 8, '9': 2, '10': 'pinned', '17': true},
    {
      '1': 'model_name',
      '3': 5,
      '4': 1,
      '5': 9,
      '9': 3,
      '10': 'modelName',
      '17': true
    },
    {
      '1': 'provider_id',
      '3': 6,
      '4': 1,
      '5': 9,
      '9': 4,
      '10': 'providerId',
      '17': true
    },
    {
      '1': 'config_json',
      '3': 7,
      '4': 1,
      '5': 9,
      '9': 5,
      '10': 'configJson',
      '17': true
    },
  ],
  '8': [
    {'1': '_title'},
    {'1': '_description'},
    {'1': '_pinned'},
    {'1': '_model_name'},
    {'1': '_provider_id'},
    {'1': '_config_json'},
  ],
};

/// Descriptor for `UpdateSessionRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateSessionRequestDescriptor = $convert.base64Decode(
    'ChRVcGRhdGVTZXNzaW9uUmVxdWVzdBIdCgpzZXNzaW9uX2lkGAEgASgJUglzZXNzaW9uSWQSGQ'
    'oFdGl0bGUYAiABKAlIAFIFdGl0bGWIAQESJQoLZGVzY3JpcHRpb24YAyABKAlIAVILZGVzY3Jp'
    'cHRpb26IAQESGwoGcGlubmVkGAQgASgISAJSBnBpbm5lZIgBARIiCgptb2RlbF9uYW1lGAUgAS'
    'gJSANSCW1vZGVsTmFtZYgBARIkCgtwcm92aWRlcl9pZBgGIAEoCUgEUgpwcm92aWRlcklkiAEB'
    'EiQKC2NvbmZpZ19qc29uGAcgASgJSAVSCmNvbmZpZ0pzb26IAQFCCAoGX3RpdGxlQg4KDF9kZX'
    'NjcmlwdGlvbkIJCgdfcGlubmVkQg0KC19tb2RlbF9uYW1lQg4KDF9wcm92aWRlcl9pZEIOCgxf'
    'Y29uZmlnX2pzb24=');

@$core.Deprecated('Use updateSessionResponseDescriptor instead')
const UpdateSessionResponse$json = {
  '1': 'UpdateSessionResponse',
  '2': [
    {
      '1': 'session',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.ai_chat.v1.ChatSession',
      '10': 'session'
    },
  ],
};

/// Descriptor for `UpdateSessionResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateSessionResponseDescriptor = $convert.base64Decode(
    'ChVVcGRhdGVTZXNzaW9uUmVzcG9uc2USQwoHc2Vzc2lvbhgBIAEoCzIpLnBlZXJzX3RvdWNoLm'
    '1vZGVsLmFpX2NoYXQudjEuQ2hhdFNlc3Npb25SB3Nlc3Npb24=');

@$core.Deprecated('Use deleteSessionRequestDescriptor instead')
const DeleteSessionRequest$json = {
  '1': 'DeleteSessionRequest',
  '2': [
    {'1': 'session_id', '3': 1, '4': 1, '5': 9, '10': 'sessionId'},
  ],
};

/// Descriptor for `DeleteSessionRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteSessionRequestDescriptor = $convert.base64Decode(
    'ChREZWxldGVTZXNzaW9uUmVxdWVzdBIdCgpzZXNzaW9uX2lkGAEgASgJUglzZXNzaW9uSWQ=');

@$core.Deprecated('Use deleteSessionResponseDescriptor instead')
const DeleteSessionResponse$json = {
  '1': 'DeleteSessionResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `DeleteSessionResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteSessionResponseDescriptor =
    $convert.base64Decode(
        'ChVEZWxldGVTZXNzaW9uUmVzcG9uc2USGAoHc3VjY2VzcxgBIAEoCFIHc3VjY2Vzcw==');

@$core.Deprecated('Use listSessionsRequestDescriptor instead')
const ListSessionsRequest$json = {
  '1': 'ListSessionsRequest',
  '2': [
    {'1': 'page_size', '3': 1, '4': 1, '5': 5, '10': 'pageSize'},
    {'1': 'page_token', '3': 2, '4': 1, '5': 9, '10': 'pageToken'},
    {'1': 'filter', '3': 3, '4': 1, '5': 9, '10': 'filter'},
    {'1': 'order_by', '3': 4, '4': 1, '5': 9, '10': 'orderBy'},
  ],
};

/// Descriptor for `ListSessionsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listSessionsRequestDescriptor = $convert.base64Decode(
    'ChNMaXN0U2Vzc2lvbnNSZXF1ZXN0EhsKCXBhZ2Vfc2l6ZRgBIAEoBVIIcGFnZVNpemUSHQoKcG'
    'FnZV90b2tlbhgCIAEoCVIJcGFnZVRva2VuEhYKBmZpbHRlchgDIAEoCVIGZmlsdGVyEhkKCG9y'
    'ZGVyX2J5GAQgASgJUgdvcmRlckJ5');

@$core.Deprecated('Use listSessionsResponseDescriptor instead')
const ListSessionsResponse$json = {
  '1': 'ListSessionsResponse',
  '2': [
    {
      '1': 'sessions',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.ai_chat.v1.ChatSession',
      '10': 'sessions'
    },
    {'1': 'next_page_token', '3': 2, '4': 1, '5': 9, '10': 'nextPageToken'},
  ],
};

/// Descriptor for `ListSessionsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listSessionsResponseDescriptor = $convert.base64Decode(
    'ChRMaXN0U2Vzc2lvbnNSZXNwb25zZRJFCghzZXNzaW9ucxgBIAMoCzIpLnBlZXJzX3RvdWNoLm'
    '1vZGVsLmFpX2NoYXQudjEuQ2hhdFNlc3Npb25SCHNlc3Npb25zEiYKD25leHRfcGFnZV90b2tl'
    'bhgCIAEoCVINbmV4dFBhZ2VUb2tlbg==');
