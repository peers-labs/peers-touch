// This is a generated file - do not edit.
//
// Generated from domain/ai_box/provider.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use providerTypeDescriptor instead')
const ProviderType$json = {
  '1': 'ProviderType',
  '2': [
    {'1': 'openai', '2': 0},
    {'1': 'ollama', '2': 1},
    {'1': 'deepseek', '2': 2},
    {'1': 'custom', '2': 1001},
  ],
};

/// Descriptor for `ProviderType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List providerTypeDescriptor = $convert.base64Decode(
    'CgxQcm92aWRlclR5cGUSCgoGb3BlbmFpEAASCgoGb2xsYW1hEAESDAoIZGVlcHNlZWsQAhILCg'
    'ZjdXN0b20Q6Qc=');

@$core.Deprecated('Use providerDescriptor instead')
const Provider$json = {
  '1': 'Provider',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'peers_user_id', '3': 3, '4': 1, '5': 9, '10': 'peersUserId'},
    {'1': 'sort', '3': 4, '4': 1, '5': 5, '10': 'sort'},
    {'1': 'enabled', '3': 5, '4': 1, '5': 8, '10': 'enabled'},
    {'1': 'check_model', '3': 6, '4': 1, '5': 9, '10': 'checkModel'},
    {'1': 'logo', '3': 7, '4': 1, '5': 9, '10': 'logo'},
    {'1': 'description', '3': 8, '4': 1, '5': 9, '10': 'description'},
    {'1': 'key_vaults', '3': 9, '4': 1, '5': 9, '10': 'keyVaults'},
    {'1': 'source_type', '3': 10, '4': 1, '5': 9, '10': 'sourceType'},
    {'1': 'settings_json', '3': 11, '4': 1, '5': 9, '10': 'settingsJson'},
    {'1': 'config_json', '3': 12, '4': 1, '5': 9, '10': 'configJson'},
    {
      '1': 'accessed_at',
      '3': 13,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'accessedAt'
    },
    {
      '1': 'created_at',
      '3': 14,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'updated_at',
      '3': 15,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
  ],
};

/// Descriptor for `Provider`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List providerDescriptor = $convert.base64Decode(
    'CghQcm92aWRlchIOCgJpZBgBIAEoCVICaWQSEgoEbmFtZRgCIAEoCVIEbmFtZRIiCg1wZWVyc1'
    '91c2VyX2lkGAMgASgJUgtwZWVyc1VzZXJJZBISCgRzb3J0GAQgASgFUgRzb3J0EhgKB2VuYWJs'
    'ZWQYBSABKAhSB2VuYWJsZWQSHwoLY2hlY2tfbW9kZWwYBiABKAlSCmNoZWNrTW9kZWwSEgoEbG'
    '9nbxgHIAEoCVIEbG9nbxIgCgtkZXNjcmlwdGlvbhgIIAEoCVILZGVzY3JpcHRpb24SHQoKa2V5'
    'X3ZhdWx0cxgJIAEoCVIJa2V5VmF1bHRzEh8KC3NvdXJjZV90eXBlGAogASgJUgpzb3VyY2VUeX'
    'BlEiMKDXNldHRpbmdzX2pzb24YCyABKAlSDHNldHRpbmdzSnNvbhIfCgtjb25maWdfanNvbhgM'
    'IAEoCVIKY29uZmlnSnNvbhI7CgthY2Nlc3NlZF9hdBgNIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi'
    '5UaW1lc3RhbXBSCmFjY2Vzc2VkQXQSOQoKY3JlYXRlZF9hdBgOIAEoCzIaLmdvb2dsZS5wcm90'
    'b2J1Zi5UaW1lc3RhbXBSCWNyZWF0ZWRBdBI5Cgp1cGRhdGVkX2F0GA8gASgLMhouZ29vZ2xlLn'
    'Byb3RvYnVmLlRpbWVzdGFtcFIJdXBkYXRlZEF0');

@$core.Deprecated('Use providerViewDescriptor instead')
const ProviderView$json = {
  '1': 'ProviderView',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'description', '3': 3, '4': 1, '5': 9, '10': 'description'},
    {'1': 'logo', '3': 4, '4': 1, '5': 9, '10': 'logo'},
    {'1': 'source_type', '3': 5, '4': 1, '5': 9, '10': 'sourceType'},
    {'1': 'enabled', '3': 6, '4': 1, '5': 8, '10': 'enabled'},
    {'1': 'display_status', '3': 7, '4': 1, '5': 9, '10': 'displayStatus'},
  ],
};

/// Descriptor for `ProviderView`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List providerViewDescriptor = $convert.base64Decode(
    'CgxQcm92aWRlclZpZXcSDgoCaWQYASABKAlSAmlkEhIKBG5hbWUYAiABKAlSBG5hbWUSIAoLZG'
    'VzY3JpcHRpb24YAyABKAlSC2Rlc2NyaXB0aW9uEhIKBGxvZ28YBCABKAlSBGxvZ28SHwoLc291'
    'cmNlX3R5cGUYBSABKAlSCnNvdXJjZVR5cGUSGAoHZW5hYmxlZBgGIAEoCFIHZW5hYmxlZBIlCg'
    '5kaXNwbGF5X3N0YXR1cxgHIAEoCVINZGlzcGxheVN0YXR1cw==');

@$core.Deprecated('Use providerInfoDescriptor instead')
const ProviderInfo$json = {
  '1': 'ProviderInfo',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'description', '3': 3, '4': 1, '5': 9, '10': 'description'},
    {'1': 'logo', '3': 4, '4': 1, '5': 9, '10': 'logo'},
    {'1': 'source_type', '3': 5, '4': 1, '5': 9, '10': 'sourceType'},
    {'1': 'enabled', '3': 6, '4': 1, '5': 8, '10': 'enabled'},
    {'1': 'schema_json', '3': 7, '4': 1, '5': 9, '10': 'schemaJson'},
  ],
};

/// Descriptor for `ProviderInfo`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List providerInfoDescriptor = $convert.base64Decode(
    'CgxQcm92aWRlckluZm8SDgoCaWQYASABKAlSAmlkEhIKBG5hbWUYAiABKAlSBG5hbWUSIAoLZG'
    'VzY3JpcHRpb24YAyABKAlSC2Rlc2NyaXB0aW9uEhIKBGxvZ28YBCABKAlSBGxvZ28SHwoLc291'
    'cmNlX3R5cGUYBSABKAlSCnNvdXJjZVR5cGUSGAoHZW5hYmxlZBgGIAEoCFIHZW5hYmxlZBIfCg'
    'tzY2hlbWFfanNvbhgHIAEoCVIKc2NoZW1hSnNvbg==');
