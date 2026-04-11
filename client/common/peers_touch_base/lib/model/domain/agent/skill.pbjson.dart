// This is a generated file - do not edit.
//
// Generated from domain/agent/skill.proto.

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

@$core.Deprecated('Use skillManifestDescriptor instead')
const SkillManifest$json = {
  '1': 'SkillManifest',
  '2': [
    {'1': 'skill_id', '3': 1, '4': 1, '5': 9, '10': 'skillId'},
    {'1': 'agent_id', '3': 2, '4': 1, '5': 9, '10': 'agentId'},
    {'1': 'name', '3': 3, '4': 1, '5': 9, '10': 'name'},
    {'1': 'description', '3': 4, '4': 1, '5': 9, '10': 'description'},
    {'1': 'category', '3': 5, '4': 1, '5': 9, '10': 'category'},
    {'1': 'platforms', '3': 6, '4': 3, '5': 9, '10': 'platforms'},
    {
      '1': 'conditions',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.SkillConditions',
      '10': 'conditions'
    },
    {'1': 'content', '3': 8, '4': 1, '5': 9, '10': 'content'},
    {'1': 'source', '3': 9, '4': 1, '5': 9, '10': 'source'},
    {'1': 'trust_level', '3': 10, '4': 1, '5': 9, '10': 'trustLevel'},
    {'1': 'scan_verdict', '3': 11, '4': 1, '5': 9, '10': 'scanVerdict'},
    {'1': 'version', '3': 12, '4': 1, '5': 5, '10': 'version'},
    {
      '1': 'created_at',
      '3': 13,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'createdAt'
    },
    {
      '1': 'updated_at',
      '3': 14,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'updatedAt'
    },
  ],
};

/// Descriptor for `SkillManifest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List skillManifestDescriptor = $convert.base64Decode(
    'Cg1Ta2lsbE1hbmlmZXN0EhkKCHNraWxsX2lkGAEgASgJUgdza2lsbElkEhkKCGFnZW50X2lkGA'
    'IgASgJUgdhZ2VudElkEhIKBG5hbWUYAyABKAlSBG5hbWUSIAoLZGVzY3JpcHRpb24YBCABKAlS'
    'C2Rlc2NyaXB0aW9uEhoKCGNhdGVnb3J5GAUgASgJUghjYXRlZ29yeRIcCglwbGF0Zm9ybXMYBi'
    'ADKAlSCXBsYXRmb3JtcxJLCgpjb25kaXRpb25zGAcgASgLMisucGVlcnNfdG91Y2gubW9kZWwu'
    'YWdlbnQudjEuU2tpbGxDb25kaXRpb25zUgpjb25kaXRpb25zEhgKB2NvbnRlbnQYCCABKAlSB2'
    'NvbnRlbnQSFgoGc291cmNlGAkgASgJUgZzb3VyY2USHwoLdHJ1c3RfbGV2ZWwYCiABKAlSCnRy'
    'dXN0TGV2ZWwSIQoMc2Nhbl92ZXJkaWN0GAsgASgJUgtzY2FuVmVyZGljdBIYCgd2ZXJzaW9uGA'
    'wgASgFUgd2ZXJzaW9uEjkKCmNyZWF0ZWRfYXQYDSABKAsyGi5nb29nbGUucHJvdG9idWYuVGlt'
    'ZXN0YW1wUgljcmVhdGVkQXQSOQoKdXBkYXRlZF9hdBgOIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi'
    '5UaW1lc3RhbXBSCXVwZGF0ZWRBdA==');

@$core.Deprecated('Use skillConditionsDescriptor instead')
const SkillConditions$json = {
  '1': 'SkillConditions',
  '2': [
    {
      '1': 'fallback_for_toolsets',
      '3': 1,
      '4': 3,
      '5': 9,
      '10': 'fallbackForToolsets'
    },
    {'1': 'requires_tools', '3': 2, '4': 3, '5': 9, '10': 'requiresTools'},
  ],
};

/// Descriptor for `SkillConditions`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List skillConditionsDescriptor = $convert.base64Decode(
    'Cg9Ta2lsbENvbmRpdGlvbnMSMgoVZmFsbGJhY2tfZm9yX3Rvb2xzZXRzGAEgAygJUhNmYWxsYm'
    'Fja0ZvclRvb2xzZXRzEiUKDnJlcXVpcmVzX3Rvb2xzGAIgAygJUg1yZXF1aXJlc1Rvb2xz');

@$core.Deprecated('Use skillFindingDescriptor instead')
const SkillFinding$json = {
  '1': 'SkillFinding',
  '2': [
    {'1': 'pattern_id', '3': 1, '4': 1, '5': 9, '10': 'patternId'},
    {'1': 'severity', '3': 2, '4': 1, '5': 9, '10': 'severity'},
    {'1': 'category', '3': 3, '4': 1, '5': 9, '10': 'category'},
    {'1': 'file', '3': 4, '4': 1, '5': 9, '10': 'file'},
    {'1': 'line', '3': 5, '4': 1, '5': 5, '10': 'line'},
    {'1': 'match', '3': 6, '4': 1, '5': 9, '10': 'match'},
    {'1': 'description', '3': 7, '4': 1, '5': 9, '10': 'description'},
  ],
};

/// Descriptor for `SkillFinding`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List skillFindingDescriptor = $convert.base64Decode(
    'CgxTa2lsbEZpbmRpbmcSHQoKcGF0dGVybl9pZBgBIAEoCVIJcGF0dGVybklkEhoKCHNldmVyaX'
    'R5GAIgASgJUghzZXZlcml0eRIaCghjYXRlZ29yeRgDIAEoCVIIY2F0ZWdvcnkSEgoEZmlsZRgE'
    'IAEoCVIEZmlsZRISCgRsaW5lGAUgASgFUgRsaW5lEhQKBW1hdGNoGAYgASgJUgVtYXRjaBIgCg'
    'tkZXNjcmlwdGlvbhgHIAEoCVILZGVzY3JpcHRpb24=');

@$core.Deprecated('Use skillScanResultDescriptor instead')
const SkillScanResult$json = {
  '1': 'SkillScanResult',
  '2': [
    {'1': 'skill_name', '3': 1, '4': 1, '5': 9, '10': 'skillName'},
    {'1': 'source', '3': 2, '4': 1, '5': 9, '10': 'source'},
    {'1': 'trust_level', '3': 3, '4': 1, '5': 9, '10': 'trustLevel'},
    {'1': 'verdict', '3': 4, '4': 1, '5': 9, '10': 'verdict'},
    {
      '1': 'findings',
      '3': 5,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.SkillFinding',
      '10': 'findings'
    },
    {
      '1': 'scanned_at',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.google.protobuf.Timestamp',
      '10': 'scannedAt'
    },
    {'1': 'summary', '3': 7, '4': 1, '5': 9, '10': 'summary'},
  ],
};

/// Descriptor for `SkillScanResult`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List skillScanResultDescriptor = $convert.base64Decode(
    'Cg9Ta2lsbFNjYW5SZXN1bHQSHQoKc2tpbGxfbmFtZRgBIAEoCVIJc2tpbGxOYW1lEhYKBnNvdX'
    'JjZRgCIAEoCVIGc291cmNlEh8KC3RydXN0X2xldmVsGAMgASgJUgp0cnVzdExldmVsEhgKB3Zl'
    'cmRpY3QYBCABKAlSB3ZlcmRpY3QSRAoIZmluZGluZ3MYBSADKAsyKC5wZWVyc190b3VjaC5tb2'
    'RlbC5hZ2VudC52MS5Ta2lsbEZpbmRpbmdSCGZpbmRpbmdzEjkKCnNjYW5uZWRfYXQYBiABKAsy'
    'Gi5nb29nbGUucHJvdG9idWYuVGltZXN0YW1wUglzY2FubmVkQXQSGAoHc3VtbWFyeRgHIAEoCV'
    'IHc3VtbWFyeQ==');

@$core.Deprecated('Use listSkillsRequestDescriptor instead')
const ListSkillsRequest$json = {
  '1': 'ListSkillsRequest',
  '2': [
    {'1': 'agent_id', '3': 1, '4': 1, '5': 9, '10': 'agentId'},
    {'1': 'category', '3': 2, '4': 1, '5': 9, '10': 'category'},
  ],
};

/// Descriptor for `ListSkillsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listSkillsRequestDescriptor = $convert.base64Decode(
    'ChFMaXN0U2tpbGxzUmVxdWVzdBIZCghhZ2VudF9pZBgBIAEoCVIHYWdlbnRJZBIaCghjYXRlZ2'
    '9yeRgCIAEoCVIIY2F0ZWdvcnk=');

@$core.Deprecated('Use listSkillsResponseDescriptor instead')
const ListSkillsResponse$json = {
  '1': 'ListSkillsResponse',
  '2': [
    {
      '1': 'skills',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.SkillManifest',
      '10': 'skills'
    },
  ],
};

/// Descriptor for `ListSkillsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listSkillsResponseDescriptor = $convert.base64Decode(
    'ChJMaXN0U2tpbGxzUmVzcG9uc2USQQoGc2tpbGxzGAEgAygLMikucGVlcnNfdG91Y2gubW9kZW'
    'wuYWdlbnQudjEuU2tpbGxNYW5pZmVzdFIGc2tpbGxz');

@$core.Deprecated('Use getSkillRequestDescriptor instead')
const GetSkillRequest$json = {
  '1': 'GetSkillRequest',
  '2': [
    {'1': 'skill_id', '3': 1, '4': 1, '5': 9, '10': 'skillId'},
    {'1': 'file_path', '3': 2, '4': 1, '5': 9, '10': 'filePath'},
  ],
};

/// Descriptor for `GetSkillRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getSkillRequestDescriptor = $convert.base64Decode(
    'Cg9HZXRTa2lsbFJlcXVlc3QSGQoIc2tpbGxfaWQYASABKAlSB3NraWxsSWQSGwoJZmlsZV9wYX'
    'RoGAIgASgJUghmaWxlUGF0aA==');

@$core.Deprecated('Use getSkillResponseDescriptor instead')
const GetSkillResponse$json = {
  '1': 'GetSkillResponse',
  '2': [
    {
      '1': 'skill',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.SkillManifest',
      '10': 'skill'
    },
    {'1': 'file_content', '3': 2, '4': 1, '5': 9, '10': 'fileContent'},
  ],
};

/// Descriptor for `GetSkillResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getSkillResponseDescriptor = $convert.base64Decode(
    'ChBHZXRTa2lsbFJlc3BvbnNlEj8KBXNraWxsGAEgASgLMikucGVlcnNfdG91Y2gubW9kZWwuYW'
    'dlbnQudjEuU2tpbGxNYW5pZmVzdFIFc2tpbGwSIQoMZmlsZV9jb250ZW50GAIgASgJUgtmaWxl'
    'Q29udGVudA==');

@$core.Deprecated('Use installSkillRequestDescriptor instead')
const InstallSkillRequest$json = {
  '1': 'InstallSkillRequest',
  '2': [
    {'1': 'agent_id', '3': 1, '4': 1, '5': 9, '10': 'agentId'},
    {'1': 'source', '3': 2, '4': 1, '5': 9, '10': 'source'},
    {'1': 'name', '3': 3, '4': 1, '5': 9, '10': 'name'},
    {'1': 'content', '3': 4, '4': 1, '5': 9, '10': 'content'},
    {'1': 'trust_level', '3': 5, '4': 1, '5': 9, '10': 'trustLevel'},
  ],
};

/// Descriptor for `InstallSkillRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List installSkillRequestDescriptor = $convert.base64Decode(
    'ChNJbnN0YWxsU2tpbGxSZXF1ZXN0EhkKCGFnZW50X2lkGAEgASgJUgdhZ2VudElkEhYKBnNvdX'
    'JjZRgCIAEoCVIGc291cmNlEhIKBG5hbWUYAyABKAlSBG5hbWUSGAoHY29udGVudBgEIAEoCVIH'
    'Y29udGVudBIfCgt0cnVzdF9sZXZlbBgFIAEoCVIKdHJ1c3RMZXZlbA==');

@$core.Deprecated('Use installSkillResponseDescriptor instead')
const InstallSkillResponse$json = {
  '1': 'InstallSkillResponse',
  '2': [
    {'1': 'skill_id', '3': 1, '4': 1, '5': 9, '10': 'skillId'},
    {'1': 'verdict', '3': 2, '4': 1, '5': 9, '10': 'verdict'},
    {
      '1': 'scan_result',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.SkillScanResult',
      '10': 'scanResult'
    },
    {'1': 'installed', '3': 4, '4': 1, '5': 8, '10': 'installed'},
  ],
};

/// Descriptor for `InstallSkillResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List installSkillResponseDescriptor = $convert.base64Decode(
    'ChRJbnN0YWxsU2tpbGxSZXNwb25zZRIZCghza2lsbF9pZBgBIAEoCVIHc2tpbGxJZBIYCgd2ZX'
    'JkaWN0GAIgASgJUgd2ZXJkaWN0EkwKC3NjYW5fcmVzdWx0GAMgASgLMisucGVlcnNfdG91Y2gu'
    'bW9kZWwuYWdlbnQudjEuU2tpbGxTY2FuUmVzdWx0UgpzY2FuUmVzdWx0EhwKCWluc3RhbGxlZB'
    'gEIAEoCFIJaW5zdGFsbGVk');

@$core.Deprecated('Use patchSkillRequestDescriptor instead')
const PatchSkillRequest$json = {
  '1': 'PatchSkillRequest',
  '2': [
    {'1': 'skill_id', '3': 1, '4': 1, '5': 9, '10': 'skillId'},
    {'1': 'old_string', '3': 2, '4': 1, '5': 9, '10': 'oldString'},
    {'1': 'new_string', '3': 3, '4': 1, '5': 9, '10': 'newString'},
  ],
};

/// Descriptor for `PatchSkillRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List patchSkillRequestDescriptor = $convert.base64Decode(
    'ChFQYXRjaFNraWxsUmVxdWVzdBIZCghza2lsbF9pZBgBIAEoCVIHc2tpbGxJZBIdCgpvbGRfc3'
    'RyaW5nGAIgASgJUglvbGRTdHJpbmcSHQoKbmV3X3N0cmluZxgDIAEoCVIJbmV3U3RyaW5n');

@$core.Deprecated('Use patchSkillResponseDescriptor instead')
const PatchSkillResponse$json = {
  '1': 'PatchSkillResponse',
  '2': [
    {
      '1': 'skill',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.model.agent.v1.SkillManifest',
      '10': 'skill'
    },
    {'1': 'success', '3': 2, '4': 1, '5': 8, '10': 'success'},
  ],
};

/// Descriptor for `PatchSkillResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List patchSkillResponseDescriptor = $convert.base64Decode(
    'ChJQYXRjaFNraWxsUmVzcG9uc2USPwoFc2tpbGwYASABKAsyKS5wZWVyc190b3VjaC5tb2RlbC'
    '5hZ2VudC52MS5Ta2lsbE1hbmlmZXN0UgVza2lsbBIYCgdzdWNjZXNzGAIgASgIUgdzdWNjZXNz');
