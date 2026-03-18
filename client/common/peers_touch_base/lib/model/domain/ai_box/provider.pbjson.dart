// This is a generated file - do not edit.
//
// Generated from domain/ai_box/provider.proto.

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

@$core.Deprecated('Use createProviderRequestDescriptor instead')
const CreateProviderRequest$json = {
  '1': 'CreateProviderRequest',
  '2': [
    {'1': 'name', '3': 1, '4': 1, '5': 9, '10': 'name'},
    {'1': 'description', '3': 2, '4': 1, '5': 9, '10': 'description'},
    {'1': 'logo', '3': 3, '4': 1, '5': 9, '10': 'logo'},
    {'1': 'key_vaults', '3': 4, '4': 1, '5': 9, '10': 'keyVaults'},
    {'1': 'settings_json', '3': 5, '4': 1, '5': 9, '10': 'settingsJson'},
    {'1': 'config_json', '3': 6, '4': 1, '5': 9, '10': 'configJson'},
  ],
};

/// Descriptor for `CreateProviderRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createProviderRequestDescriptor = $convert.base64Decode(
    'ChVDcmVhdGVQcm92aWRlclJlcXVlc3QSEgoEbmFtZRgBIAEoCVIEbmFtZRIgCgtkZXNjcmlwdG'
    'lvbhgCIAEoCVILZGVzY3JpcHRpb24SEgoEbG9nbxgDIAEoCVIEbG9nbxIdCgprZXlfdmF1bHRz'
    'GAQgASgJUglrZXlWYXVsdHMSIwoNc2V0dGluZ3NfanNvbhgFIAEoCVIMc2V0dGluZ3NKc29uEh'
    '8KC2NvbmZpZ19qc29uGAYgASgJUgpjb25maWdKc29u');

@$core.Deprecated('Use createProviderResponseDescriptor instead')
const CreateProviderResponse$json = {
  '1': 'CreateProviderResponse',
  '2': [
    {
      '1': 'provider',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.ai_box.v1.Provider',
      '10': 'provider'
    },
  ],
};

/// Descriptor for `CreateProviderResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createProviderResponseDescriptor =
    $convert.base64Decode(
        'ChZDcmVhdGVQcm92aWRlclJlc3BvbnNlEkEKCHByb3ZpZGVyGAEgASgLMiUucGVlcnNfdG91Y2'
        'gubW9kZWwuYWlfYm94LnYxLlByb3ZpZGVyUghwcm92aWRlcg==');

@$core.Deprecated('Use updateProviderRequestDescriptor instead')
const UpdateProviderRequest$json = {
  '1': 'UpdateProviderRequest',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '9': 0, '10': 'name', '17': true},
    {
      '1': 'description',
      '3': 3,
      '4': 1,
      '5': 9,
      '9': 1,
      '10': 'description',
      '17': true
    },
    {'1': 'logo', '3': 4, '4': 1, '5': 9, '9': 2, '10': 'logo', '17': true},
    {
      '1': 'enabled',
      '3': 5,
      '4': 1,
      '5': 8,
      '9': 3,
      '10': 'enabled',
      '17': true
    },
    {
      '1': 'key_vaults',
      '3': 6,
      '4': 1,
      '5': 9,
      '9': 4,
      '10': 'keyVaults',
      '17': true
    },
    {
      '1': 'settings_json',
      '3': 7,
      '4': 1,
      '5': 9,
      '9': 5,
      '10': 'settingsJson',
      '17': true
    },
    {
      '1': 'config_json',
      '3': 8,
      '4': 1,
      '5': 9,
      '9': 6,
      '10': 'configJson',
      '17': true
    },
  ],
  '8': [
    {'1': '_name'},
    {'1': '_description'},
    {'1': '_logo'},
    {'1': '_enabled'},
    {'1': '_key_vaults'},
    {'1': '_settings_json'},
    {'1': '_config_json'},
  ],
};

/// Descriptor for `UpdateProviderRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateProviderRequestDescriptor = $convert.base64Decode(
    'ChVVcGRhdGVQcm92aWRlclJlcXVlc3QSDgoCaWQYASABKAlSAmlkEhcKBG5hbWUYAiABKAlIAF'
    'IEbmFtZYgBARIlCgtkZXNjcmlwdGlvbhgDIAEoCUgBUgtkZXNjcmlwdGlvbogBARIXCgRsb2dv'
    'GAQgASgJSAJSBGxvZ2+IAQESHQoHZW5hYmxlZBgFIAEoCEgDUgdlbmFibGVkiAEBEiIKCmtleV'
    '92YXVsdHMYBiABKAlIBFIJa2V5VmF1bHRziAEBEigKDXNldHRpbmdzX2pzb24YByABKAlIBVIM'
    'c2V0dGluZ3NKc29uiAEBEiQKC2NvbmZpZ19qc29uGAggASgJSAZSCmNvbmZpZ0pzb26IAQFCBw'
    'oFX25hbWVCDgoMX2Rlc2NyaXB0aW9uQgcKBV9sb2dvQgoKCF9lbmFibGVkQg0KC19rZXlfdmF1'
    'bHRzQhAKDl9zZXR0aW5nc19qc29uQg4KDF9jb25maWdfanNvbg==');

@$core.Deprecated('Use updateProviderResponseDescriptor instead')
const UpdateProviderResponse$json = {
  '1': 'UpdateProviderResponse',
  '2': [
    {
      '1': 'provider',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.ai_box.v1.Provider',
      '10': 'provider'
    },
  ],
};

/// Descriptor for `UpdateProviderResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateProviderResponseDescriptor =
    $convert.base64Decode(
        'ChZVcGRhdGVQcm92aWRlclJlc3BvbnNlEkEKCHByb3ZpZGVyGAEgASgLMiUucGVlcnNfdG91Y2'
        'gubW9kZWwuYWlfYm94LnYxLlByb3ZpZGVyUghwcm92aWRlcg==');

@$core.Deprecated('Use deleteProviderRequestDescriptor instead')
const DeleteProviderRequest$json = {
  '1': 'DeleteProviderRequest',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
  ],
};

/// Descriptor for `DeleteProviderRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteProviderRequestDescriptor = $convert
    .base64Decode('ChVEZWxldGVQcm92aWRlclJlcXVlc3QSDgoCaWQYASABKAlSAmlk');

@$core.Deprecated('Use deleteProviderResponseDescriptor instead')
const DeleteProviderResponse$json = {
  '1': 'DeleteProviderResponse',
  '2': [
    {'1': 'success', '3': 1, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `DeleteProviderResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteProviderResponseDescriptor =
    $convert.base64Decode(
        'ChZEZWxldGVQcm92aWRlclJlc3BvbnNlEhgKB3N1Y2Nlc3MYASABKAhSB3N1Y2Nlc3M=');

@$core.Deprecated('Use getProviderRequestDescriptor instead')
const GetProviderRequest$json = {
  '1': 'GetProviderRequest',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
  ],
};

/// Descriptor for `GetProviderRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getProviderRequestDescriptor =
    $convert.base64Decode('ChJHZXRQcm92aWRlclJlcXVlc3QSDgoCaWQYASABKAlSAmlk');

@$core.Deprecated('Use getProviderResponseDescriptor instead')
const GetProviderResponse$json = {
  '1': 'GetProviderResponse',
  '2': [
    {
      '1': 'provider',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.ai_box.v1.Provider',
      '10': 'provider'
    },
  ],
};

/// Descriptor for `GetProviderResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getProviderResponseDescriptor = $convert.base64Decode(
    'ChNHZXRQcm92aWRlclJlc3BvbnNlEkEKCHByb3ZpZGVyGAEgASgLMiUucGVlcnNfdG91Y2gubW'
    '9kZWwuYWlfYm94LnYxLlByb3ZpZGVyUghwcm92aWRlcg==');

@$core.Deprecated('Use listProvidersRequestDescriptor instead')
const ListProvidersRequest$json = {
  '1': 'ListProvidersRequest',
  '2': [
    {'1': 'page_number', '3': 1, '4': 1, '5': 5, '10': 'pageNumber'},
    {'1': 'page_size', '3': 2, '4': 1, '5': 5, '10': 'pageSize'},
    {'1': 'enabled_only', '3': 3, '4': 1, '5': 8, '10': 'enabledOnly'},
  ],
};

/// Descriptor for `ListProvidersRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listProvidersRequestDescriptor = $convert.base64Decode(
    'ChRMaXN0UHJvdmlkZXJzUmVxdWVzdBIfCgtwYWdlX251bWJlchgBIAEoBVIKcGFnZU51bWJlch'
    'IbCglwYWdlX3NpemUYAiABKAVSCHBhZ2VTaXplEiEKDGVuYWJsZWRfb25seRgDIAEoCFILZW5h'
    'YmxlZE9ubHk=');

@$core.Deprecated('Use listProvidersResponseDescriptor instead')
const ListProvidersResponse$json = {
  '1': 'ListProvidersResponse',
  '2': [
    {
      '1': 'providers',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.ai_box.v1.Provider',
      '10': 'providers'
    },
    {'1': 'total', '3': 2, '4': 1, '5': 3, '10': 'total'},
    {'1': 'page_number', '3': 3, '4': 1, '5': 5, '10': 'pageNumber'},
    {'1': 'page_size', '3': 4, '4': 1, '5': 5, '10': 'pageSize'},
  ],
};

/// Descriptor for `ListProvidersResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listProvidersResponseDescriptor = $convert.base64Decode(
    'ChVMaXN0UHJvdmlkZXJzUmVzcG9uc2USQwoJcHJvdmlkZXJzGAEgAygLMiUucGVlcnNfdG91Y2'
    'gubW9kZWwuYWlfYm94LnYxLlByb3ZpZGVyUglwcm92aWRlcnMSFAoFdG90YWwYAiABKANSBXRv'
    'dGFsEh8KC3BhZ2VfbnVtYmVyGAMgASgFUgpwYWdlTnVtYmVyEhsKCXBhZ2Vfc2l6ZRgEIAEoBV'
    'IIcGFnZVNpemU=');

@$core.Deprecated('Use testProviderRequestDescriptor instead')
const TestProviderRequest$json = {
  '1': 'TestProviderRequest',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
  ],
};

/// Descriptor for `TestProviderRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List testProviderRequestDescriptor = $convert
    .base64Decode('ChNUZXN0UHJvdmlkZXJSZXF1ZXN0Eg4KAmlkGAEgASgJUgJpZA==');

@$core.Deprecated('Use testProviderResponseDescriptor instead')
const TestProviderResponse$json = {
  '1': 'TestProviderResponse',
  '2': [
    {'1': 'ok', '3': 1, '4': 1, '5': 8, '10': 'ok'},
    {'1': 'message', '3': 2, '4': 1, '5': 9, '10': 'message'},
  ],
};

/// Descriptor for `TestProviderResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List testProviderResponseDescriptor = $convert.base64Decode(
    'ChRUZXN0UHJvdmlkZXJSZXNwb25zZRIOCgJvaxgBIAEoCFICb2sSGAoHbWVzc2FnZRgCIAEoCV'
    'IHbWVzc2FnZQ==');
