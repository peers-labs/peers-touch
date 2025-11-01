// This is a generated file - do not edit.
//
// Generated from ai_model_capabilities.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use modelProviderDescriptor instead')
const ModelProvider$json = {
  '1': 'ModelProvider',
  '2': [
    {'1': 'MODEL_PROVIDER_UNSPECIFIED', '2': 0},
    {'1': 'OPENAI', '2': 1},
    {'1': 'GOOGLE', '2': 2},
    {'1': 'ANTHROPIC', '2': 3},
    {'1': 'MOONSHOT', '2': 4},
    {'1': 'OLLAMA', '2': 5},
    {'1': 'CUSTOM', '2': 6},
  ],
};

/// Descriptor for `ModelProvider`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List modelProviderDescriptor = $convert.base64Decode(
    'Cg1Nb2RlbFByb3ZpZGVyEh4KGk1PREVMX1BST1ZJREVSX1VOU1BFQ0lGSUVEEAASCgoGT1BFTk'
    'FJEAESCgoGR09PR0xFEAISDQoJQU5USFJPUElDEAMSDAoITU9PTlNIT1QQBBIKCgZPTExBTUEQ'
    'BRIKCgZDVVNUT00QBg==');

@$core.Deprecated('Use modelCapabilityDescriptor instead')
const ModelCapability$json = {
  '1': 'ModelCapability',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'display_name', '3': 2, '4': 1, '5': 9, '10': 'displayName'},
    {
      '1': 'provider',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.v1.ModelProvider',
      '10': 'provider'
    },
    {'1': 'vision_supported', '3': 4, '4': 1, '5': 8, '10': 'visionSupported'},
    {
      '1': 'file_upload_supported',
      '3': 5,
      '4': 1,
      '5': 8,
      '10': 'fileUploadSupported'
    },
    {'1': 'tts_supported', '3': 6, '4': 1, '5': 8, '10': 'ttsSupported'},
    {'1': 'stt_supported', '3': 7, '4': 1, '5': 8, '10': 'sttSupported'},
    {
      '1': 'tool_calling_supported',
      '3': 8,
      '4': 1,
      '5': 8,
      '10': 'toolCallingSupported'
    },
    {
      '1': 'web_search_supported',
      '3': 9,
      '4': 1,
      '5': 8,
      '10': 'webSearchSupported'
    },
    {'1': 'max_vision_input', '3': 10, '4': 1, '5': 5, '10': 'maxVisionInput'},
    {
      '1': 'max_context_window',
      '3': 11,
      '4': 1,
      '5': 3,
      '10': 'maxContextWindow'
    },
  ],
};

/// Descriptor for `ModelCapability`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List modelCapabilityDescriptor = $convert.base64Decode(
    'Cg9Nb2RlbENhcGFiaWxpdHkSDgoCaWQYASABKAlSAmlkEiEKDGRpc3BsYXlfbmFtZRgCIAEoCV'
    'ILZGlzcGxheU5hbWUSOQoIcHJvdmlkZXIYAyABKA4yHS5wZWVyc190b3VjaC52MS5Nb2RlbFBy'
    'b3ZpZGVyUghwcm92aWRlchIpChB2aXNpb25fc3VwcG9ydGVkGAQgASgIUg92aXNpb25TdXBwb3'
    'J0ZWQSMgoVZmlsZV91cGxvYWRfc3VwcG9ydGVkGAUgASgIUhNmaWxlVXBsb2FkU3VwcG9ydGVk'
    'EiMKDXR0c19zdXBwb3J0ZWQYBiABKAhSDHR0c1N1cHBvcnRlZBIjCg1zdHRfc3VwcG9ydGVkGA'
    'cgASgIUgxzdHRTdXBwb3J0ZWQSNAoWdG9vbF9jYWxsaW5nX3N1cHBvcnRlZBgIIAEoCFIUdG9v'
    'bENhbGxpbmdTdXBwb3J0ZWQSMAoUd2ViX3NlYXJjaF9zdXBwb3J0ZWQYCSABKAhSEndlYlNlYX'
    'JjaFN1cHBvcnRlZBIoChBtYXhfdmlzaW9uX2lucHV0GAogASgFUg5tYXhWaXNpb25JbnB1dBIs'
    'ChJtYXhfY29udGV4dF93aW5kb3cYCyABKANSEG1heENvbnRleHRXaW5kb3c=');

@$core.Deprecated('Use modelProviderCapabilitiesResponseDescriptor instead')
const ModelProviderCapabilitiesResponse$json = {
  '1': 'ModelProviderCapabilitiesResponse',
  '2': [
    {
      '1': 'capabilities',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.v1.ModelCapability',
      '10': 'capabilities'
    },
  ],
};

/// Descriptor for `ModelProviderCapabilitiesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List modelProviderCapabilitiesResponseDescriptor =
    $convert.base64Decode(
        'CiFNb2RlbFByb3ZpZGVyQ2FwYWJpbGl0aWVzUmVzcG9uc2USQwoMY2FwYWJpbGl0aWVzGAEgAy'
        'gLMh8ucGVlcnNfdG91Y2gudjEuTW9kZWxDYXBhYmlsaXR5UgxjYXBhYmlsaXRpZXM=');
