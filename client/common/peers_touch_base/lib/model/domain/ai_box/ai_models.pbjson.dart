// This is a generated file - do not edit.
//
// Generated from domain/ai_box/ai_models.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use aiModelDescriptor instead')
const AiModel$json = {
  '1': 'AiModel',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'display_name', '3': 2, '4': 1, '5': 9, '10': 'displayName'},
    {'1': 'description', '3': 3, '4': 1, '5': 9, '10': 'description'},
    {'1': 'organization', '3': 4, '4': 1, '5': 9, '10': 'organization'},
    {'1': 'enabled', '3': 5, '4': 1, '5': 8, '10': 'enabled'},
    {'1': 'provider_id', '3': 6, '4': 1, '5': 9, '10': 'providerId'},
    {'1': 'type', '3': 7, '4': 1, '5': 9, '10': 'type'},
    {'1': 'sort', '3': 8, '4': 1, '5': 5, '10': 'sort'},
    {'1': 'user_id', '3': 9, '4': 1, '5': 9, '10': 'userId'},
    {'1': 'pricing_json', '3': 10, '4': 1, '5': 9, '10': 'pricingJson'},
    {'1': 'parameters_json', '3': 11, '4': 1, '5': 9, '10': 'parametersJson'},
    {'1': 'config_json', '3': 12, '4': 1, '5': 9, '10': 'configJson'},
    {'1': 'abilities_json', '3': 13, '4': 1, '5': 9, '10': 'abilitiesJson'},
    {
      '1': 'context_window_tokens',
      '3': 14,
      '4': 1,
      '5': 5,
      '10': 'contextWindowTokens'
    },
    {'1': 'source', '3': 15, '4': 1, '5': 9, '10': 'source'},
    {'1': 'released_at', '3': 16, '4': 1, '5': 9, '10': 'releasedAt'},
    {
      '1': 'accessed_at',
      '3': 17,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'accessedAt'
    },
    {
      '1': 'created_at',
      '3': 18,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'updated_at',
      '3': 19,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
  ],
};

/// Descriptor for `AiModel`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List aiModelDescriptor = $convert.base64Decode(
    'CgdBaU1vZGVsEg4KAmlkGAEgASgJUgJpZBIhCgxkaXNwbGF5X25hbWUYAiABKAlSC2Rpc3BsYX'
    'lOYW1lEiAKC2Rlc2NyaXB0aW9uGAMgASgJUgtkZXNjcmlwdGlvbhIiCgxvcmdhbml6YXRpb24Y'
    'BCABKAlSDG9yZ2FuaXphdGlvbhIYCgdlbmFibGVkGAUgASgIUgdlbmFibGVkEh8KC3Byb3ZpZG'
    'VyX2lkGAYgASgJUgpwcm92aWRlcklkEhIKBHR5cGUYByABKAlSBHR5cGUSEgoEc29ydBgIIAEo'
    'BVIEc29ydBIXCgd1c2VyX2lkGAkgASgJUgZ1c2VySWQSIQoMcHJpY2luZ19qc29uGAogASgJUg'
    'twcmljaW5nSnNvbhInCg9wYXJhbWV0ZXJzX2pzb24YCyABKAlSDnBhcmFtZXRlcnNKc29uEh8K'
    'C2NvbmZpZ19qc29uGAwgASgJUgpjb25maWdKc29uEiUKDmFiaWxpdGllc19qc29uGA0gASgJUg'
    '1hYmlsaXRpZXNKc29uEjIKFWNvbnRleHRfd2luZG93X3Rva2VucxgOIAEoBVITY29udGV4dFdp'
    'bmRvd1Rva2VucxIWCgZzb3VyY2UYDyABKAlSBnNvdXJjZRIfCgtyZWxlYXNlZF9hdBgQIAEoCV'
    'IKcmVsZWFzZWRBdBI7CgthY2Nlc3NlZF9hdBgRIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1l'
    'c3RhbXBSCmFjY2Vzc2VkQXQSOQoKY3JlYXRlZF9hdBgSIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi'
    '5UaW1lc3RhbXBSCWNyZWF0ZWRBdBI5Cgp1cGRhdGVkX2F0GBMgASgLMhouZ29vZ2xlLnByb3Rv'
    'YnVmLlRpbWVzdGFtcFIJdXBkYXRlZEF0');

@$core.Deprecated('Use aiModelViewDescriptor instead')
const AiModelView$json = {
  '1': 'AiModelView',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'display_name', '3': 2, '4': 1, '5': 9, '10': 'displayName'},
    {'1': 'description', '3': 3, '4': 1, '5': 9, '10': 'description'},
    {'1': 'organization', '3': 4, '4': 1, '5': 9, '10': 'organization'},
    {'1': 'provider_id', '3': 5, '4': 1, '5': 9, '10': 'providerId'},
    {'1': 'type', '3': 6, '4': 1, '5': 9, '10': 'type'},
    {
      '1': 'context_window_tokens',
      '3': 7,
      '4': 1,
      '5': 5,
      '10': 'contextWindowTokens'
    },
    {'1': 'enabled', '3': 8, '4': 1, '5': 8, '10': 'enabled'},
    {'1': 'abilities_json', '3': 9, '4': 1, '5': 9, '10': 'abilitiesJson'},
  ],
};

/// Descriptor for `AiModelView`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List aiModelViewDescriptor = $convert.base64Decode(
    'CgtBaU1vZGVsVmlldxIOCgJpZBgBIAEoCVICaWQSIQoMZGlzcGxheV9uYW1lGAIgASgJUgtkaX'
    'NwbGF5TmFtZRIgCgtkZXNjcmlwdGlvbhgDIAEoCVILZGVzY3JpcHRpb24SIgoMb3JnYW5pemF0'
    'aW9uGAQgASgJUgxvcmdhbml6YXRpb24SHwoLcHJvdmlkZXJfaWQYBSABKAlSCnByb3ZpZGVySW'
    'QSEgoEdHlwZRgGIAEoCVIEdHlwZRIyChVjb250ZXh0X3dpbmRvd190b2tlbnMYByABKAVSE2Nv'
    'bnRleHRXaW5kb3dUb2tlbnMSGAoHZW5hYmxlZBgIIAEoCFIHZW5hYmxlZBIlCg5hYmlsaXRpZX'
    'NfanNvbhgJIAEoCVINYWJpbGl0aWVzSnNvbg==');

@$core.Deprecated('Use aiModelInfoDescriptor instead')
const AiModelInfo$json = {
  '1': 'AiModelInfo',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'display_name', '3': 2, '4': 1, '5': 9, '10': 'displayName'},
    {'1': 'description', '3': 3, '4': 1, '5': 9, '10': 'description'},
    {'1': 'organization', '3': 4, '4': 1, '5': 9, '10': 'organization'},
    {'1': 'provider_id', '3': 5, '4': 1, '5': 9, '10': 'providerId'},
    {'1': 'type', '3': 6, '4': 1, '5': 9, '10': 'type'},
    {
      '1': 'context_window_tokens',
      '3': 7,
      '4': 1,
      '5': 5,
      '10': 'contextWindowTokens'
    },
    {'1': 'enabled', '3': 8, '4': 1, '5': 8, '10': 'enabled'},
    {'1': 'abilities_json', '3': 9, '4': 1, '5': 9, '10': 'abilitiesJson'},
    {'1': 'pricing_json', '3': 10, '4': 1, '5': 9, '10': 'pricingJson'},
    {
      '1': 'parameters_schema_json',
      '3': 11,
      '4': 1,
      '5': 9,
      '10': 'parametersSchemaJson'
    },
  ],
};

/// Descriptor for `AiModelInfo`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List aiModelInfoDescriptor = $convert.base64Decode(
    'CgtBaU1vZGVsSW5mbxIOCgJpZBgBIAEoCVICaWQSIQoMZGlzcGxheV9uYW1lGAIgASgJUgtkaX'
    'NwbGF5TmFtZRIgCgtkZXNjcmlwdGlvbhgDIAEoCVILZGVzY3JpcHRpb24SIgoMb3JnYW5pemF0'
    'aW9uGAQgASgJUgxvcmdhbml6YXRpb24SHwoLcHJvdmlkZXJfaWQYBSABKAlSCnByb3ZpZGVySW'
    'QSEgoEdHlwZRgGIAEoCVIEdHlwZRIyChVjb250ZXh0X3dpbmRvd190b2tlbnMYByABKAVSE2Nv'
    'bnRleHRXaW5kb3dUb2tlbnMSGAoHZW5hYmxlZBgIIAEoCFIHZW5hYmxlZBIlCg5hYmlsaXRpZX'
    'NfanNvbhgJIAEoCVINYWJpbGl0aWVzSnNvbhIhCgxwcmljaW5nX2pzb24YCiABKAlSC3ByaWNp'
    'bmdKc29uEjQKFnBhcmFtZXRlcnNfc2NoZW1hX2pzb24YCyABKAlSFHBhcmFtZXRlcnNTY2hlbW'
    'FKc29u');
