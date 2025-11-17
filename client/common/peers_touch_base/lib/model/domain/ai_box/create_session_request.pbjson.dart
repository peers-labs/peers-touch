// This is a generated file - do not edit.
//
// Generated from domain/ai_box/create_session_request.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

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
      '6': '.peers_touch.model.ai_box.v1.CreateSessionRequest.MetaEntry',
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
    'Eh0KCm1vZGVsX25hbWUYBCABKAlSCW1vZGVsTmFtZRJPCgRtZXRhGAUgAygLMjsucGVlcnNfdG'
    '91Y2gubW9kZWwuYWlfYm94LnYxLkNyZWF0ZVNlc3Npb25SZXF1ZXN0Lk1ldGFFbnRyeVIEbWV0'
    'YRIfCgtjb25maWdfanNvbhgGIAEoCVIKY29uZmlnSnNvbho3CglNZXRhRW50cnkSEAoDa2V5GA'
    'EgASgJUgNrZXkSFAoFdmFsdWUYAiABKAlSBXZhbHVlOgI4AQ==');
