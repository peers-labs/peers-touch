// This is a generated file - do not edit.
//
// Generated from domain/applet/applet.proto.

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

@$core.Deprecated('Use appletInfoDescriptor instead')
const AppletInfo$json = {
  '1': 'AppletInfo',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'description', '3': 3, '4': 1, '5': 9, '10': 'description'},
    {'1': 'icon_url', '3': 4, '4': 1, '5': 9, '10': 'iconUrl'},
    {'1': 'developer_id', '3': 5, '4': 1, '5': 9, '10': 'developerId'},
    {'1': 'download_count', '3': 6, '4': 1, '5': 3, '10': 'downloadCount'},
    {'1': 'latest_version', '3': 7, '4': 1, '5': 9, '10': 'latestVersion'},
    {'1': 'updated_at', '3': 8, '4': 1, '5': 3, '10': 'updatedAt'},
  ],
};

/// Descriptor for `AppletInfo`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List appletInfoDescriptor = $convert.base64Decode(
    'CgpBcHBsZXRJbmZvEg4KAmlkGAEgASgJUgJpZBISCgRuYW1lGAIgASgJUgRuYW1lEiAKC2Rlc2'
    'NyaXB0aW9uGAMgASgJUgtkZXNjcmlwdGlvbhIZCghpY29uX3VybBgEIAEoCVIHaWNvblVybBIh'
    'CgxkZXZlbG9wZXJfaWQYBSABKAlSC2RldmVsb3BlcklkEiUKDmRvd25sb2FkX2NvdW50GAYgAS'
    'gDUg1kb3dubG9hZENvdW50EiUKDmxhdGVzdF92ZXJzaW9uGAcgASgJUg1sYXRlc3RWZXJzaW9u'
    'Eh0KCnVwZGF0ZWRfYXQYCCABKANSCXVwZGF0ZWRBdA==');

@$core.Deprecated('Use appletVersionInfoDescriptor instead')
const AppletVersionInfo$json = {
  '1': 'AppletVersionInfo',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'applet_id', '3': 2, '4': 1, '5': 9, '10': 'appletId'},
    {'1': 'version', '3': 3, '4': 1, '5': 9, '10': 'version'},
    {'1': 'bundle_url', '3': 4, '4': 1, '5': 9, '10': 'bundleUrl'},
    {'1': 'bundle_hash', '3': 5, '4': 1, '5': 9, '10': 'bundleHash'},
    {'1': 'bundle_size', '3': 6, '4': 1, '5': 3, '10': 'bundleSize'},
    {'1': 'min_sdk_version', '3': 7, '4': 1, '5': 9, '10': 'minSdkVersion'},
    {'1': 'changelog', '3': 8, '4': 1, '5': 9, '10': 'changelog'},
    {'1': 'created_at', '3': 9, '4': 1, '5': 3, '10': 'createdAt'},
  ],
};

/// Descriptor for `AppletVersionInfo`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List appletVersionInfoDescriptor = $convert.base64Decode(
    'ChFBcHBsZXRWZXJzaW9uSW5mbxIOCgJpZBgBIAEoCVICaWQSGwoJYXBwbGV0X2lkGAIgASgJUg'
    'hhcHBsZXRJZBIYCgd2ZXJzaW9uGAMgASgJUgd2ZXJzaW9uEh0KCmJ1bmRsZV91cmwYBCABKAlS'
    'CWJ1bmRsZVVybBIfCgtidW5kbGVfaGFzaBgFIAEoCVIKYnVuZGxlSGFzaBIfCgtidW5kbGVfc2'
    'l6ZRgGIAEoA1IKYnVuZGxlU2l6ZRImCg9taW5fc2RrX3ZlcnNpb24YByABKAlSDW1pblNka1Zl'
    'cnNpb24SHAoJY2hhbmdlbG9nGAggASgJUgljaGFuZ2Vsb2cSHQoKY3JlYXRlZF9hdBgJIAEoA1'
    'IJY3JlYXRlZEF0');

@$core.Deprecated('Use listAppletsRequestDescriptor instead')
const ListAppletsRequest$json = {
  '1': 'ListAppletsRequest',
  '2': [
    {'1': 'limit', '3': 1, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'offset', '3': 2, '4': 1, '5': 5, '10': 'offset'},
    {'1': 'search_keyword', '3': 3, '4': 1, '5': 9, '10': 'searchKeyword'},
  ],
};

/// Descriptor for `ListAppletsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listAppletsRequestDescriptor = $convert.base64Decode(
    'ChJMaXN0QXBwbGV0c1JlcXVlc3QSFAoFbGltaXQYASABKAVSBWxpbWl0EhYKBm9mZnNldBgCIA'
    'EoBVIGb2Zmc2V0EiUKDnNlYXJjaF9rZXl3b3JkGAMgASgJUg1zZWFyY2hLZXl3b3Jk');

@$core.Deprecated('Use listAppletsResponseDescriptor instead')
const ListAppletsResponse$json = {
  '1': 'ListAppletsResponse',
  '2': [
    {
      '1': 'applets',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.domain.applet.AppletInfo',
      '10': 'applets'
    },
    {'1': 'total_count', '3': 2, '4': 1, '5': 3, '10': 'totalCount'},
  ],
};

/// Descriptor for `ListAppletsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listAppletsResponseDescriptor = $convert.base64Decode(
    'ChNMaXN0QXBwbGV0c1Jlc3BvbnNlEj8KB2FwcGxldHMYASADKAsyJS5wZWVyc190b3VjaC5kb2'
    '1haW4uYXBwbGV0LkFwcGxldEluZm9SB2FwcGxldHMSHwoLdG90YWxfY291bnQYAiABKANSCnRv'
    'dGFsQ291bnQ=');

@$core.Deprecated('Use getAppletDetailsRequestDescriptor instead')
const GetAppletDetailsRequest$json = {
  '1': 'GetAppletDetailsRequest',
  '2': [
    {'1': 'applet_id', '3': 1, '4': 1, '5': 9, '10': 'appletId'},
  ],
};

/// Descriptor for `GetAppletDetailsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getAppletDetailsRequestDescriptor =
    $convert.base64Decode(
        'ChdHZXRBcHBsZXREZXRhaWxzUmVxdWVzdBIbCglhcHBsZXRfaWQYASABKAlSCGFwcGxldElk');

@$core.Deprecated('Use getAppletDetailsResponseDescriptor instead')
const GetAppletDetailsResponse$json = {
  '1': 'GetAppletDetailsResponse',
  '2': [
    {
      '1': 'info',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.domain.applet.AppletInfo',
      '10': 'info'
    },
    {
      '1': 'latest_version',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.peers_touch.domain.applet.AppletVersionInfo',
      '10': 'latestVersion'
    },
  ],
};

/// Descriptor for `GetAppletDetailsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getAppletDetailsResponseDescriptor = $convert.base64Decode(
    'ChhHZXRBcHBsZXREZXRhaWxzUmVzcG9uc2USOQoEaW5mbxgBIAEoCzIlLnBlZXJzX3RvdWNoLm'
    'RvbWFpbi5hcHBsZXQuQXBwbGV0SW5mb1IEaW5mbxJTCg5sYXRlc3RfdmVyc2lvbhgCIAEoCzIs'
    'LnBlZXJzX3RvdWNoLmRvbWFpbi5hcHBsZXQuQXBwbGV0VmVyc2lvbkluZm9SDWxhdGVzdFZlcn'
    'Npb24=');

@$core.Deprecated('Use publishAppletRequestDescriptor instead')
const PublishAppletRequest$json = {
  '1': 'PublishAppletRequest',
  '2': [
    {'1': 'name', '3': 1, '4': 1, '5': 9, '10': 'name'},
    {'1': 'description', '3': 2, '4': 1, '5': 9, '10': 'description'},
    {'1': 'version', '3': 3, '4': 1, '5': 9, '10': 'version'},
    {'1': 'min_sdk_version', '3': 4, '4': 1, '5': 9, '10': 'minSdkVersion'},
    {'1': 'changelog', '3': 5, '4': 1, '5': 9, '10': 'changelog'},
  ],
};

/// Descriptor for `PublishAppletRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List publishAppletRequestDescriptor = $convert.base64Decode(
    'ChRQdWJsaXNoQXBwbGV0UmVxdWVzdBISCgRuYW1lGAEgASgJUgRuYW1lEiAKC2Rlc2NyaXB0aW'
    '9uGAIgASgJUgtkZXNjcmlwdGlvbhIYCgd2ZXJzaW9uGAMgASgJUgd2ZXJzaW9uEiYKD21pbl9z'
    'ZGtfdmVyc2lvbhgEIAEoCVINbWluU2RrVmVyc2lvbhIcCgljaGFuZ2Vsb2cYBSABKAlSCWNoYW'
    '5nZWxvZw==');

@$core.Deprecated('Use publishAppletResponseDescriptor instead')
const PublishAppletResponse$json = {
  '1': 'PublishAppletResponse',
  '2': [
    {'1': 'applet_id', '3': 1, '4': 1, '5': 9, '10': 'appletId'},
    {'1': 'version_id', '3': 2, '4': 1, '5': 9, '10': 'versionId'},
    {'1': 'is_new_applet', '3': 3, '4': 1, '5': 8, '10': 'isNewApplet'},
  ],
};

/// Descriptor for `PublishAppletResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List publishAppletResponseDescriptor = $convert.base64Decode(
    'ChVQdWJsaXNoQXBwbGV0UmVzcG9uc2USGwoJYXBwbGV0X2lkGAEgASgJUghhcHBsZXRJZBIdCg'
    'p2ZXJzaW9uX2lkGAIgASgJUgl2ZXJzaW9uSWQSIgoNaXNfbmV3X2FwcGxldBgDIAEoCFILaXNO'
    'ZXdBcHBsZXQ=');
