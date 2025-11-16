// This is a generated file - do not edit.
//
// Generated from domain/ai_box/ai-box.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use aiProviderDescriptor instead')
const AiProvider$json = {
  '1': 'AiProvider',
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
    {'1': 'settings', '3': 11, '4': 1, '5': 9, '10': 'settings'},
    {'1': 'config', '3': 12, '4': 1, '5': 9, '10': 'config'},
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

/// Descriptor for `AiProvider`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List aiProviderDescriptor = $convert.base64Decode(
    'CgpBaVByb3ZpZGVyEg4KAmlkGAEgASgJUgJpZBISCgRuYW1lGAIgASgJUgRuYW1lEiIKDXBlZX'
    'JzX3VzZXJfaWQYAyABKAlSC3BlZXJzVXNlcklkEhIKBHNvcnQYBCABKAVSBHNvcnQSGAoHZW5h'
    'YmxlZBgFIAEoCFIHZW5hYmxlZBIfCgtjaGVja19tb2RlbBgGIAEoCVIKY2hlY2tNb2RlbBISCg'
    'Rsb2dvGAcgASgJUgRsb2dvEiAKC2Rlc2NyaXB0aW9uGAggASgJUgtkZXNjcmlwdGlvbhIdCgpr'
    'ZXlfdmF1bHRzGAkgASgJUglrZXlWYXVsdHMSHwoLc291cmNlX3R5cGUYCiABKAlSCnNvdXJjZV'
    'R5cGUSGgoIc2V0dGluZ3MYCyABKAlSCHNldHRpbmdzEhYKBmNvbmZpZxgMIAEoCVIGY29uZmln'
    'EjsKC2FjY2Vzc2VkX2F0GA0gASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIKYWNjZX'
    'NzZWRBdBI5CgpjcmVhdGVkX2F0GA4gASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJ'
    'Y3JlYXRlZEF0EjkKCnVwZGF0ZWRfYXQYDyABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW'
    '1wUgl1cGRhdGVkQXQ=');

@$core.Deprecated('Use providerConfigDescriptor instead')
const ProviderConfig$json = {
  '1': 'ProviderConfig',
  '2': [
    {'1': 'api_key', '3': 1, '4': 1, '5': 9, '10': 'apiKey'},
    {'1': 'endpoint', '3': 2, '4': 1, '5': 9, '10': 'endpoint'},
    {'1': 'proxy_url', '3': 3, '4': 1, '5': 9, '10': 'proxyUrl'},
    {'1': 'timeout_seconds', '3': 4, '4': 1, '5': 5, '10': 'timeoutSeconds'},
    {'1': 'max_retries', '3': 5, '4': 1, '5': 5, '10': 'maxRetries'},
  ],
};

/// Descriptor for `ProviderConfig`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List providerConfigDescriptor = $convert.base64Decode(
    'Cg5Qcm92aWRlckNvbmZpZxIXCgdhcGlfa2V5GAEgASgJUgZhcGlLZXkSGgoIZW5kcG9pbnQYAi'
    'ABKAlSCGVuZHBvaW50EhsKCXByb3h5X3VybBgDIAEoCVIIcHJveHlVcmwSJwoPdGltZW91dF9z'
    'ZWNvbmRzGAQgASgFUg50aW1lb3V0U2Vjb25kcxIfCgttYXhfcmV0cmllcxgFIAEoBVIKbWF4Um'
    'V0cmllcw==');

@$core.Deprecated('Use modelCapabilityDescriptor instead')
const ModelCapability$json = {
  '1': 'ModelCapability',
  '2': [
    {'1': 'model_name', '3': 1, '4': 1, '5': 9, '10': 'modelName'},
    {
      '1': 'supports_streaming',
      '3': 2,
      '4': 1,
      '5': 8,
      '10': 'supportsStreaming'
    },
    {'1': 'max_tokens', '3': 3, '4': 1, '5': 5, '10': 'maxTokens'},
    {'1': 'description', '3': 4, '4': 1, '5': 9, '10': 'description'},
  ],
};

/// Descriptor for `ModelCapability`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List modelCapabilityDescriptor = $convert.base64Decode(
    'Cg9Nb2RlbENhcGFiaWxpdHkSHQoKbW9kZWxfbmFtZRgBIAEoCVIJbW9kZWxOYW1lEi0KEnN1cH'
    'BvcnRzX3N0cmVhbWluZxgCIAEoCFIRc3VwcG9ydHNTdHJlYW1pbmcSHQoKbWF4X3Rva2VucxgD'
    'IAEoBVIJbWF4VG9rZW5zEiAKC2Rlc2NyaXB0aW9uGAQgASgJUgtkZXNjcmlwdGlvbg==');
