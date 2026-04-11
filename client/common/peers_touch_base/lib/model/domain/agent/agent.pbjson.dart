// This is a generated file - do not edit.
//
// Generated from domain/agent/agent.proto.

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

@$core.Deprecated('Use turnStatusDescriptor instead')
const TurnStatus$json = {
  '1': 'TurnStatus',
  '2': [
    {'1': 'TURN_STATUS_UNSPECIFIED', '2': 0},
    {'1': 'TURN_STATUS_RUNNING', '2': 1},
    {'1': 'TURN_STATUS_COMPLETED', '2': 2},
    {'1': 'TURN_STATUS_FAILED', '2': 3},
    {'1': 'TURN_STATUS_INTERRUPTED', '2': 4},
  ],
};

/// Descriptor for `TurnStatus`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List turnStatusDescriptor = $convert.base64Decode(
    'CgpUdXJuU3RhdHVzEhsKF1RVUk5fU1RBVFVTX1VOU1BFQ0lGSUVEEAASFwoTVFVSTl9TVEFUVV'
    'NfUlVOTklORxABEhkKFVRVUk5fU1RBVFVTX0NPTVBMRVRFRBACEhYKElRVUk5fU1RBVFVTX0ZB'
    'SUxFRBADEhsKF1RVUk5fU1RBVFVTX0lOVEVSUlVQVEVEEAQ=');

@$core.Deprecated('Use failoverReasonDescriptor instead')
const FailoverReason$json = {
  '1': 'FailoverReason',
  '2': [
    {'1': 'FAILOVER_REASON_UNSPECIFIED', '2': 0},
    {'1': 'FAILOVER_REASON_AUTH', '2': 1},
    {'1': 'FAILOVER_REASON_AUTH_PERMANENT', '2': 2},
    {'1': 'FAILOVER_REASON_BILLING', '2': 3},
    {'1': 'FAILOVER_REASON_RATE_LIMIT', '2': 4},
    {'1': 'FAILOVER_REASON_OVERLOADED', '2': 5},
    {'1': 'FAILOVER_REASON_SERVER_ERROR', '2': 6},
    {'1': 'FAILOVER_REASON_TIMEOUT', '2': 7},
    {'1': 'FAILOVER_REASON_CONTEXT_OVERFLOW', '2': 8},
    {'1': 'FAILOVER_REASON_PAYLOAD_TOO_LARGE', '2': 9},
    {'1': 'FAILOVER_REASON_MODEL_NOT_FOUND', '2': 10},
    {'1': 'FAILOVER_REASON_FORMAT_ERROR', '2': 11},
    {'1': 'FAILOVER_REASON_THINKING_SIGNATURE', '2': 12},
    {'1': 'FAILOVER_REASON_LONG_CONTEXT_TIER', '2': 13},
    {'1': 'FAILOVER_REASON_UNKNOWN', '2': 14},
  ],
};

/// Descriptor for `FailoverReason`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List failoverReasonDescriptor = $convert.base64Decode(
    'Cg5GYWlsb3ZlclJlYXNvbhIfChtGQUlMT1ZFUl9SRUFTT05fVU5TUEVDSUZJRUQQABIYChRGQU'
    'lMT1ZFUl9SRUFTT05fQVVUSBABEiIKHkZBSUxPVkVSX1JFQVNPTl9BVVRIX1BFUk1BTkVOVBAC'
    'EhsKF0ZBSUxPVkVSX1JFQVNPTl9CSUxMSU5HEAMSHgoaRkFJTE9WRVJfUkVBU09OX1JBVEVfTE'
    'lNSVQQBBIeChpGQUlMT1ZFUl9SRUFTT05fT1ZFUkxPQURFRBAFEiAKHEZBSUxPVkVSX1JFQVNP'
    'Tl9TRVJWRVJfRVJST1IQBhIbChdGQUlMT1ZFUl9SRUFTT05fVElNRU9VVBAHEiQKIEZBSUxPVk'
    'VSX1JFQVNPTl9DT05URVhUX09WRVJGTE9XEAgSJQohRkFJTE9WRVJfUkVBU09OX1BBWUxPQURf'
    'VE9PX0xBUkdFEAkSIwofRkFJTE9WRVJfUkVBU09OX01PREVMX05PVF9GT1VORBAKEiAKHEZBSU'
    'xPVkVSX1JFQVNPTl9GT1JNQVRfRVJST1IQCxImCiJGQUlMT1ZFUl9SRUFTT05fVEhJTktJTkdf'
    'U0lHTkFUVVJFEAwSJQohRkFJTE9WRVJfUkVBU09OX0xPTkdfQ09OVEVYVF9USUVSEA0SGwoXRk'
    'FJTE9WRVJfUkVBU09OX1VOS05PV04QDg==');

@$core.Deprecated('Use delegationStatusDescriptor instead')
const DelegationStatus$json = {
  '1': 'DelegationStatus',
  '2': [
    {'1': 'DELEGATION_STATUS_UNSPECIFIED', '2': 0},
    {'1': 'DELEGATION_STATUS_COMPLETED', '2': 1},
    {'1': 'DELEGATION_STATUS_FAILED', '2': 2},
    {'1': 'DELEGATION_STATUS_TIMEOUT', '2': 3},
  ],
};

/// Descriptor for `DelegationStatus`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List delegationStatusDescriptor = $convert.base64Decode(
    'ChBEZWxlZ2F0aW9uU3RhdHVzEiEKHURFTEVHQVRJT05fU1RBVFVTX1VOU1BFQ0lGSUVEEAASHw'
    'obREVMRUdBVElPTl9TVEFUVVNfQ09NUExFVEVEEAESHAoYREVMRUdBVElPTl9TVEFUVVNfRkFJ'
    'TEVEEAISHQoZREVMRUdBVElPTl9TVEFUVVNfVElNRU9VVBAD');

@$core.Deprecated('Use messageRoleDescriptor instead')
const MessageRole$json = {
  '1': 'MessageRole',
  '2': [
    {'1': 'MESSAGE_ROLE_UNSPECIFIED', '2': 0},
    {'1': 'MESSAGE_ROLE_SYSTEM', '2': 1},
    {'1': 'MESSAGE_ROLE_USER', '2': 2},
    {'1': 'MESSAGE_ROLE_ASSISTANT', '2': 3},
    {'1': 'MESSAGE_ROLE_TOOL', '2': 4},
  ],
};

/// Descriptor for `MessageRole`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List messageRoleDescriptor = $convert.base64Decode(
    'CgtNZXNzYWdlUm9sZRIcChhNRVNTQUdFX1JPTEVfVU5TUEVDSUZJRUQQABIXChNNRVNTQUdFX1'
    'JPTEVfU1lTVEVNEAESFQoRTUVTU0FHRV9ST0xFX1VTRVIQAhIaChZNRVNTQUdFX1JPTEVfQVNT'
    'SVNUQU5UEAMSFQoRTUVTU0FHRV9ST0xFX1RPT0wQBA==');

@$core.Deprecated('Use turnDescriptor instead')
const Turn$json = {
  '1': 'Turn',
  '2': [
    {'1': 'turn_id', '3': 1, '4': 1, '5': 9, '10': 'turnId'},
    {'1': 'conversation_id', '3': 2, '4': 1, '5': 9, '10': 'conversationId'},
    {'1': 'agent_id', '3': 3, '4': 1, '5': 9, '10': 'agentId'},
    {'1': 'user_input', '3': 4, '4': 1, '5': 9, '10': 'userInput'},
    {'1': 'final_response', '3': 5, '4': 1, '5': 9, '10': 'finalResponse'},
    {'1': 'tool_iterations', '3': 6, '4': 1, '5': 5, '10': 'toolIterations'},
    {
      '1': 'status',
      '3': 7,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.agent.v1.TurnStatus',
      '10': 'status'
    },
    {
      '1': 'started_at',
      '3': 8,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'startedAt'
    },
    {
      '1': 'ended_at',
      '3': 9,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'endedAt'
    },
  ],
};

/// Descriptor for `Turn`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List turnDescriptor = $convert.base64Decode(
    'CgRUdXJuEhcKB3R1cm5faWQYASABKAlSBnR1cm5JZBInCg9jb252ZXJzYXRpb25faWQYAiABKA'
    'lSDmNvbnZlcnNhdGlvbklkEhkKCGFnZW50X2lkGAMgASgJUgdhZ2VudElkEh0KCnVzZXJfaW5w'
    'dXQYBCABKAlSCXVzZXJJbnB1dBIlCg5maW5hbF9yZXNwb25zZRgFIAEoCVINZmluYWxSZXNwb2'
    '5zZRInCg90b29sX2l0ZXJhdGlvbnMYBiABKAVSDnRvb2xJdGVyYXRpb25zEj4KBnN0YXR1cxgH'
    'IAEoDjImLnBlZXJzX3RvdWNoLm1vZGVsLmFnZW50LnYxLlR1cm5TdGF0dXNSBnN0YXR1cxI5Cg'
    'pzdGFydGVkX2F0GAggASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJc3RhcnRlZEF0'
    'EjUKCGVuZGVkX2F0GAkgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIHZW5kZWRBdA'
    '==');

@$core.Deprecated('Use toolCallRecordDescriptor instead')
const ToolCallRecord$json = {
  '1': 'ToolCallRecord',
  '2': [
    {'1': 'tool_name', '3': 1, '4': 1, '5': 9, '10': 'toolName'},
    {'1': 'arguments', '3': 2, '4': 1, '5': 9, '10': 'arguments'},
    {'1': 'result', '3': 3, '4': 1, '5': 9, '10': 'result'},
    {'1': 'duration_ms', '3': 4, '4': 1, '5': 3, '10': 'durationMs'},
  ],
};

/// Descriptor for `ToolCallRecord`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List toolCallRecordDescriptor = $convert.base64Decode(
    'Cg5Ub29sQ2FsbFJlY29yZBIbCgl0b29sX25hbWUYASABKAlSCHRvb2xOYW1lEhwKCWFyZ3VtZW'
    '50cxgCIAEoCVIJYXJndW1lbnRzEhYKBnJlc3VsdBgDIAEoCVIGcmVzdWx0Eh8KC2R1cmF0aW9u'
    'X21zGAQgASgDUgpkdXJhdGlvbk1z');

@$core.Deprecated('Use providerCallRecordDescriptor instead')
const ProviderCallRecord$json = {
  '1': 'ProviderCallRecord',
  '2': [
    {'1': 'provider', '3': 1, '4': 1, '5': 9, '10': 'provider'},
    {'1': 'model', '3': 2, '4': 1, '5': 9, '10': 'model'},
    {'1': 'input_tokens', '3': 3, '4': 1, '5': 5, '10': 'inputTokens'},
    {'1': 'output_tokens', '3': 4, '4': 1, '5': 5, '10': 'outputTokens'},
    {'1': 'latency_ms', '3': 5, '4': 1, '5': 3, '10': 'latencyMs'},
    {'1': 'cache_hit', '3': 6, '4': 1, '5': 8, '10': 'cacheHit'},
    {'1': 'credential_id', '3': 7, '4': 1, '5': 9, '10': 'credentialId'},
  ],
};

/// Descriptor for `ProviderCallRecord`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List providerCallRecordDescriptor = $convert.base64Decode(
    'ChJQcm92aWRlckNhbGxSZWNvcmQSGgoIcHJvdmlkZXIYASABKAlSCHByb3ZpZGVyEhQKBW1vZG'
    'VsGAIgASgJUgVtb2RlbBIhCgxpbnB1dF90b2tlbnMYAyABKAVSC2lucHV0VG9rZW5zEiMKDW91'
    'dHB1dF90b2tlbnMYBCABKAVSDG91dHB1dFRva2VucxIdCgpsYXRlbmN5X21zGAUgASgDUglsYX'
    'RlbmN5TXMSGwoJY2FjaGVfaGl0GAYgASgIUghjYWNoZUhpdBIjCg1jcmVkZW50aWFsX2lkGAcg'
    'ASgJUgxjcmVkZW50aWFsSWQ=');

@$core.Deprecated('Use turnTraceDescriptor instead')
const TurnTrace$json = {
  '1': 'TurnTrace',
  '2': [
    {'1': 'trace_id', '3': 1, '4': 1, '5': 9, '10': 'traceId'},
    {'1': 'turn_id', '3': 2, '4': 1, '5': 9, '10': 'turnId'},
    {
      '1': 'system_prompt_hash',
      '3': 3,
      '4': 1,
      '5': 9,
      '10': 'systemPromptHash'
    },
    {
      '1': 'memory_snapshot_hash',
      '3': 4,
      '4': 1,
      '5': 9,
      '10': 'memorySnapshotHash'
    },
    {'1': 'skill_index_hash', '3': 5, '4': 1, '5': 9, '10': 'skillIndexHash'},
    {'1': 'skills_loaded', '3': 6, '4': 3, '5': 9, '10': 'skillsLoaded'},
    {
      '1': 'tool_calls',
      '3': 7,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.ToolCallRecord',
      '10': 'toolCalls'
    },
    {
      '1': 'provider_calls',
      '3': 8,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.ProviderCallRecord',
      '10': 'providerCalls'
    },
    {'1': 'review_triggered', '3': 9, '4': 1, '5': 8, '10': 'reviewTriggered'},
    {
      '1': 'errors_classified',
      '3': 10,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.ClassifiedErrorEvent',
      '10': 'errorsClassified'
    },
    {
      '1': 'compression_event',
      '3': 11,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.CompressionEvent',
      '10': 'compressionEvent'
    },
    {
      '1': 'delegation_results',
      '3': 12,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.DelegationResult',
      '10': 'delegationResults'
    },
  ],
};

/// Descriptor for `TurnTrace`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List turnTraceDescriptor = $convert.base64Decode(
    'CglUdXJuVHJhY2USGQoIdHJhY2VfaWQYASABKAlSB3RyYWNlSWQSFwoHdHVybl9pZBgCIAEoCV'
    'IGdHVybklkEiwKEnN5c3RlbV9wcm9tcHRfaGFzaBgDIAEoCVIQc3lzdGVtUHJvbXB0SGFzaBIw'
    'ChRtZW1vcnlfc25hcHNob3RfaGFzaBgEIAEoCVISbWVtb3J5U25hcHNob3RIYXNoEigKEHNraW'
    'xsX2luZGV4X2hhc2gYBSABKAlSDnNraWxsSW5kZXhIYXNoEiMKDXNraWxsc19sb2FkZWQYBiAD'
    'KAlSDHNraWxsc0xvYWRlZBJJCgp0b29sX2NhbGxzGAcgAygLMioucGVlcnNfdG91Y2gubW9kZW'
    'wuYWdlbnQudjEuVG9vbENhbGxSZWNvcmRSCXRvb2xDYWxscxJVCg5wcm92aWRlcl9jYWxscxgI'
    'IAMoCzIuLnBlZXJzX3RvdWNoLm1vZGVsLmFnZW50LnYxLlByb3ZpZGVyQ2FsbFJlY29yZFINcH'
    'JvdmlkZXJDYWxscxIpChByZXZpZXdfdHJpZ2dlcmVkGAkgASgIUg9yZXZpZXdUcmlnZ2VyZWQS'
    'XQoRZXJyb3JzX2NsYXNzaWZpZWQYCiADKAsyMC5wZWVyc190b3VjaC5tb2RlbC5hZ2VudC52MS'
    '5DbGFzc2lmaWVkRXJyb3JFdmVudFIQZXJyb3JzQ2xhc3NpZmllZBJZChFjb21wcmVzc2lvbl9l'
    'dmVudBgLIAEoCzIsLnBlZXJzX3RvdWNoLm1vZGVsLmFnZW50LnYxLkNvbXByZXNzaW9uRXZlbn'
    'RSEGNvbXByZXNzaW9uRXZlbnQSWwoSZGVsZWdhdGlvbl9yZXN1bHRzGAwgAygLMiwucGVlcnNf'
    'dG91Y2gubW9kZWwuYWdlbnQudjEuRGVsZWdhdGlvblJlc3VsdFIRZGVsZWdhdGlvblJlc3VsdH'
    'M=');

@$core.Deprecated('Use classifiedErrorEventDescriptor instead')
const ClassifiedErrorEvent$json = {
  '1': 'ClassifiedErrorEvent',
  '2': [
    {
      '1': 'reason',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.agent.v1.FailoverReason',
      '10': 'reason'
    },
    {'1': 'retryable', '3': 2, '4': 1, '5': 8, '10': 'retryable'},
    {'1': 'should_compress', '3': 3, '4': 1, '5': 8, '10': 'shouldCompress'},
    {
      '1': 'should_rotate_credential',
      '3': 4,
      '4': 1,
      '5': 8,
      '10': 'shouldRotateCredential'
    },
    {'1': 'should_fallback', '3': 5, '4': 1, '5': 8, '10': 'shouldFallback'},
    {'1': 'provider', '3': 6, '4': 1, '5': 9, '10': 'provider'},
    {'1': 'model', '3': 7, '4': 1, '5': 9, '10': 'model'},
    {'1': 'http_status', '3': 8, '4': 1, '5': 5, '10': 'httpStatus'},
    {'1': 'error_code', '3': 9, '4': 1, '5': 9, '10': 'errorCode'},
    {'1': 'error_message', '3': 10, '4': 1, '5': 9, '10': 'errorMessage'},
    {
      '1': 'classified_at',
      '3': 11,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'classifiedAt'
    },
  ],
};

/// Descriptor for `ClassifiedErrorEvent`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List classifiedErrorEventDescriptor = $convert.base64Decode(
    'ChRDbGFzc2lmaWVkRXJyb3JFdmVudBJCCgZyZWFzb24YASABKA4yKi5wZWVyc190b3VjaC5tb2'
    'RlbC5hZ2VudC52MS5GYWlsb3ZlclJlYXNvblIGcmVhc29uEhwKCXJldHJ5YWJsZRgCIAEoCFIJ'
    'cmV0cnlhYmxlEicKD3Nob3VsZF9jb21wcmVzcxgDIAEoCFIOc2hvdWxkQ29tcHJlc3MSOAoYc2'
    'hvdWxkX3JvdGF0ZV9jcmVkZW50aWFsGAQgASgIUhZzaG91bGRSb3RhdGVDcmVkZW50aWFsEicK'
    'D3Nob3VsZF9mYWxsYmFjaxgFIAEoCFIOc2hvdWxkRmFsbGJhY2sSGgoIcHJvdmlkZXIYBiABKA'
    'lSCHByb3ZpZGVyEhQKBW1vZGVsGAcgASgJUgVtb2RlbBIfCgtodHRwX3N0YXR1cxgIIAEoBVIK'
    'aHR0cFN0YXR1cxIdCgplcnJvcl9jb2RlGAkgASgJUgllcnJvckNvZGUSIwoNZXJyb3JfbWVzc2'
    'FnZRgKIAEoCVIMZXJyb3JNZXNzYWdlEj8KDWNsYXNzaWZpZWRfYXQYCyABKAsyGi5nb29nbGUu'
    'cHJvdG9idWYuVGltZXN0YW1wUgxjbGFzc2lmaWVkQXQ=');

@$core.Deprecated('Use compressionEventDescriptor instead')
const CompressionEvent$json = {
  '1': 'CompressionEvent',
  '2': [
    {'1': 'triggered', '3': 1, '4': 1, '5': 8, '10': 'triggered'},
    {'1': 'tokens_before', '3': 2, '4': 1, '5': 5, '10': 'tokensBefore'},
    {'1': 'tokens_after', '3': 3, '4': 1, '5': 5, '10': 'tokensAfter'},
    {
      '1': 'new_conversation_id',
      '3': 4,
      '4': 1,
      '5': 9,
      '10': 'newConversationId'
    },
  ],
};

/// Descriptor for `CompressionEvent`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List compressionEventDescriptor = $convert.base64Decode(
    'ChBDb21wcmVzc2lvbkV2ZW50EhwKCXRyaWdnZXJlZBgBIAEoCFIJdHJpZ2dlcmVkEiMKDXRva2'
    'Vuc19iZWZvcmUYAiABKAVSDHRva2Vuc0JlZm9yZRIhCgx0b2tlbnNfYWZ0ZXIYAyABKAVSC3Rv'
    'a2Vuc0FmdGVyEi4KE25ld19jb252ZXJzYXRpb25faWQYBCABKAlSEW5ld0NvbnZlcnNhdGlvbk'
    'lk');

@$core.Deprecated('Use delegationResultDescriptor instead')
const DelegationResult$json = {
  '1': 'DelegationResult',
  '2': [
    {'1': 'task_id', '3': 1, '4': 1, '5': 9, '10': 'taskId'},
    {'1': 'parent_turn_id', '3': 2, '4': 1, '5': 9, '10': 'parentTurnId'},
    {'1': 'task_description', '3': 3, '4': 1, '5': 9, '10': 'taskDescription'},
    {'1': 'child_toolset', '3': 4, '4': 3, '5': 9, '10': 'childToolset'},
    {
      '1': 'status',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.agent.v1.DelegationStatus',
      '10': 'status'
    },
    {'1': 'result_summary', '3': 6, '4': 1, '5': 9, '10': 'resultSummary'},
    {'1': 'tool_iterations', '3': 7, '4': 1, '5': 5, '10': 'toolIterations'},
    {
      '1': 'started_at',
      '3': 8,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'startedAt'
    },
    {
      '1': 'ended_at',
      '3': 9,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'endedAt'
    },
  ],
};

/// Descriptor for `DelegationResult`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List delegationResultDescriptor = $convert.base64Decode(
    'ChBEZWxlZ2F0aW9uUmVzdWx0EhcKB3Rhc2tfaWQYASABKAlSBnRhc2tJZBIkCg5wYXJlbnRfdH'
    'Vybl9pZBgCIAEoCVIMcGFyZW50VHVybklkEikKEHRhc2tfZGVzY3JpcHRpb24YAyABKAlSD3Rh'
    'c2tEZXNjcmlwdGlvbhIjCg1jaGlsZF90b29sc2V0GAQgAygJUgxjaGlsZFRvb2xzZXQSRAoGc3'
    'RhdHVzGAUgASgOMiwucGVlcnNfdG91Y2gubW9kZWwuYWdlbnQudjEuRGVsZWdhdGlvblN0YXR1'
    'c1IGc3RhdHVzEiUKDnJlc3VsdF9zdW1tYXJ5GAYgASgJUg1yZXN1bHRTdW1tYXJ5EicKD3Rvb2'
    'xfaXRlcmF0aW9ucxgHIAEoBVIOdG9vbEl0ZXJhdGlvbnMSOQoKc3RhcnRlZF9hdBgIIAEoCzIa'
    'Lmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSCXN0YXJ0ZWRBdBI1CghlbmRlZF9hdBgJIAEoCz'
    'IaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXBSB2VuZGVkQXQ=');

@$core.Deprecated('Use conversationDescriptor instead')
const Conversation$json = {
  '1': 'Conversation',
  '2': [
    {'1': 'conversation_id', '3': 1, '4': 1, '5': 9, '10': 'conversationId'},
    {'1': 'agent_id', '3': 2, '4': 1, '5': 9, '10': 'agentId'},
    {'1': 'user_id', '3': 3, '4': 1, '5': 9, '10': 'userId'},
    {'1': 'title', '3': 4, '4': 1, '5': 9, '10': 'title'},
    {'1': 'description', '3': 5, '4': 1, '5': 9, '10': 'description'},
    {'1': 'provider_id', '3': 6, '4': 1, '5': 9, '10': 'providerId'},
    {'1': 'model_name', '3': 7, '4': 1, '5': 9, '10': 'modelName'},
    {'1': 'status', '3': 8, '4': 1, '5': 9, '10': 'status'},
    {'1': 'parent_id', '3': 9, '4': 1, '5': 9, '10': 'parentId'},
    {'1': 'config_json', '3': 10, '4': 1, '5': 9, '10': 'configJson'},
    {
      '1': 'meta',
      '3': 11,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.Conversation.MetaEntry',
      '10': 'meta'
    },
    {
      '1': 'created_at',
      '3': 12,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'updated_at',
      '3': 13,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
  ],
  '3': [Conversation_MetaEntry$json],
};

@$core.Deprecated('Use conversationDescriptor instead')
const Conversation_MetaEntry$json = {
  '1': 'MetaEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `Conversation`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List conversationDescriptor = $convert.base64Decode(
    'CgxDb252ZXJzYXRpb24SJwoPY29udmVyc2F0aW9uX2lkGAEgASgJUg5jb252ZXJzYXRpb25JZB'
    'IZCghhZ2VudF9pZBgCIAEoCVIHYWdlbnRJZBIXCgd1c2VyX2lkGAMgASgJUgZ1c2VySWQSFAoF'
    'dGl0bGUYBCABKAlSBXRpdGxlEiAKC2Rlc2NyaXB0aW9uGAUgASgJUgtkZXNjcmlwdGlvbhIfCg'
    'twcm92aWRlcl9pZBgGIAEoCVIKcHJvdmlkZXJJZBIdCgptb2RlbF9uYW1lGAcgASgJUgltb2Rl'
    'bE5hbWUSFgoGc3RhdHVzGAggASgJUgZzdGF0dXMSGwoJcGFyZW50X2lkGAkgASgJUghwYXJlbn'
    'RJZBIfCgtjb25maWdfanNvbhgKIAEoCVIKY29uZmlnSnNvbhJGCgRtZXRhGAsgAygLMjIucGVl'
    'cnNfdG91Y2gubW9kZWwuYWdlbnQudjEuQ29udmVyc2F0aW9uLk1ldGFFbnRyeVIEbWV0YRI5Cg'
    'pjcmVhdGVkX2F0GAwgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJY3JlYXRlZEF0'
    'EjkKCnVwZGF0ZWRfYXQYDSABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgl1cGRhdG'
    'VkQXQaNwoJTWV0YUVudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbHVlGAIgASgJUgV2YWx1'
    'ZToCOAE=');

@$core.Deprecated('Use agentMessageDescriptor instead')
const AgentMessage$json = {
  '1': 'AgentMessage',
  '2': [
    {'1': 'message_id', '3': 1, '4': 1, '5': 9, '10': 'messageId'},
    {'1': 'conversation_id', '3': 2, '4': 1, '5': 9, '10': 'conversationId'},
    {'1': 'turn_id', '3': 3, '4': 1, '5': 9, '10': 'turnId'},
    {'1': 'model_name', '3': 4, '4': 1, '5': 9, '10': 'modelName'},
    {
      '1': 'role',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.agent.v1.MessageRole',
      '10': 'role'
    },
    {'1': 'content', '3': 6, '4': 1, '5': 9, '10': 'content'},
    {'1': 'reasoning_json', '3': 7, '4': 1, '5': 9, '10': 'reasoningJson'},
    {'1': 'tool_calls_json', '3': 8, '4': 1, '5': 9, '10': 'toolCallsJson'},
    {'1': 'metadata_json', '3': 9, '4': 1, '5': 9, '10': 'metadataJson'},
    {'1': 'error_json', '3': 10, '4': 1, '5': 9, '10': 'errorJson'},
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

/// Descriptor for `AgentMessage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List agentMessageDescriptor = $convert.base64Decode(
    'CgxBZ2VudE1lc3NhZ2USHQoKbWVzc2FnZV9pZBgBIAEoCVIJbWVzc2FnZUlkEicKD2NvbnZlcn'
    'NhdGlvbl9pZBgCIAEoCVIOY29udmVyc2F0aW9uSWQSFwoHdHVybl9pZBgDIAEoCVIGdHVybklk'
    'Eh0KCm1vZGVsX25hbWUYBCABKAlSCW1vZGVsTmFtZRI7CgRyb2xlGAUgASgOMicucGVlcnNfdG'
    '91Y2gubW9kZWwuYWdlbnQudjEuTWVzc2FnZVJvbGVSBHJvbGUSGAoHY29udGVudBgGIAEoCVIH'
    'Y29udGVudBIlCg5yZWFzb25pbmdfanNvbhgHIAEoCVINcmVhc29uaW5nSnNvbhImCg90b29sX2'
    'NhbGxzX2pzb24YCCABKAlSDXRvb2xDYWxsc0pzb24SIwoNbWV0YWRhdGFfanNvbhgJIAEoCVIM'
    'bWV0YWRhdGFKc29uEh0KCmVycm9yX2pzb24YCiABKAlSCWVycm9ySnNvbhI5CgpjcmVhdGVkX2'
    'F0GAsgASgLMhouZ29vZ2xlLnByb3RvYnVmLlRpbWVzdGFtcFIJY3JlYXRlZEF0EjkKCnVwZGF0'
    'ZWRfYXQYDCABKAsyGi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUgl1cGRhdGVkQXQ=');

@$core.Deprecated('Use executeTurnRequestDescriptor instead')
const ExecuteTurnRequest$json = {
  '1': 'ExecuteTurnRequest',
  '2': [
    {'1': 'conversation_id', '3': 1, '4': 1, '5': 9, '10': 'conversationId'},
    {'1': 'agent_id', '3': 2, '4': 1, '5': 9, '10': 'agentId'},
    {'1': 'user_input', '3': 3, '4': 1, '5': 9, '10': 'userInput'},
    {'1': 'stream', '3': 4, '4': 1, '5': 8, '10': 'stream'},
    {
      '1': 'model_override',
      '3': 5,
      '4': 1,
      '5': 9,
      '9': 0,
      '10': 'modelOverride',
      '17': true
    },
    {
      '1': 'provider_override',
      '3': 6,
      '4': 1,
      '5': 9,
      '9': 1,
      '10': 'providerOverride',
      '17': true
    },
  ],
  '8': [
    {'1': '_model_override'},
    {'1': '_provider_override'},
  ],
};

/// Descriptor for `ExecuteTurnRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List executeTurnRequestDescriptor = $convert.base64Decode(
    'ChJFeGVjdXRlVHVyblJlcXVlc3QSJwoPY29udmVyc2F0aW9uX2lkGAEgASgJUg5jb252ZXJzYX'
    'Rpb25JZBIZCghhZ2VudF9pZBgCIAEoCVIHYWdlbnRJZBIdCgp1c2VyX2lucHV0GAMgASgJUgl1'
    'c2VySW5wdXQSFgoGc3RyZWFtGAQgASgIUgZzdHJlYW0SKgoObW9kZWxfb3ZlcnJpZGUYBSABKA'
    'lIAFINbW9kZWxPdmVycmlkZYgBARIwChFwcm92aWRlcl9vdmVycmlkZRgGIAEoCUgBUhBwcm92'
    'aWRlck92ZXJyaWRliAEBQhEKD19tb2RlbF9vdmVycmlkZUIUChJfcHJvdmlkZXJfb3ZlcnJpZG'
    'U=');

@$core.Deprecated('Use executeTurnResponseDescriptor instead')
const ExecuteTurnResponse$json = {
  '1': 'ExecuteTurnResponse',
  '2': [
    {
      '1': 'turn',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.Turn',
      '10': 'turn'
    },
    {
      '1': 'trace',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.TurnTrace',
      '10': 'trace'
    },
    {
      '1': 'response_message',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.AgentMessage',
      '10': 'responseMessage'
    },
  ],
};

/// Descriptor for `ExecuteTurnResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List executeTurnResponseDescriptor = $convert.base64Decode(
    'ChNFeGVjdXRlVHVyblJlc3BvbnNlEjQKBHR1cm4YASABKAsyIC5wZWVyc190b3VjaC5tb2RlbC'
    '5hZ2VudC52MS5UdXJuUgR0dXJuEjsKBXRyYWNlGAIgASgLMiUucGVlcnNfdG91Y2gubW9kZWwu'
    'YWdlbnQudjEuVHVyblRyYWNlUgV0cmFjZRJTChByZXNwb25zZV9tZXNzYWdlGAMgASgLMigucG'
    'VlcnNfdG91Y2gubW9kZWwuYWdlbnQudjEuQWdlbnRNZXNzYWdlUg9yZXNwb25zZU1lc3NhZ2U=');
