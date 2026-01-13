// This is a generated file - do not edit.
//
// Generated from domain/actor/preferences.proto.

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

@$core.Deprecated('Use actorPreferencesDescriptor instead')
const ActorPreferences$json = {
  '1': 'ActorPreferences',
  '2': [
    {'1': 'theme', '3': 1, '4': 1, '5': 9, '10': 'theme'},
    {'1': 'locale', '3': 2, '4': 1, '5': 9, '10': 'locale'},
    {'1': 'telemetry', '3': 3, '4': 1, '5': 8, '10': 'telemetry'},
    {
      '1': 'endpoint_overrides',
      '3': 4,
      '4': 3,
      '5': 11,
      '6': '.peers.actor.ActorPreferences.EndpointOverridesEntry',
      '10': 'endpointOverrides'
    },
    {
      '1': 'feature_flags',
      '3': 5,
      '4': 3,
      '5': 11,
      '6': '.peers.actor.ActorPreferences.FeatureFlagsEntry',
      '10': 'featureFlags'
    },
    {'1': 'schema_version', '3': 6, '4': 1, '5': 5, '10': 'schemaVersion'},
  ],
  '3': [
    ActorPreferences_EndpointOverridesEntry$json,
    ActorPreferences_FeatureFlagsEntry$json
  ],
};

@$core.Deprecated('Use actorPreferencesDescriptor instead')
const ActorPreferences_EndpointOverridesEntry$json = {
  '1': 'EndpointOverridesEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

@$core.Deprecated('Use actorPreferencesDescriptor instead')
const ActorPreferences_FeatureFlagsEntry$json = {
  '1': 'FeatureFlagsEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 8, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `ActorPreferences`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List actorPreferencesDescriptor = $convert.base64Decode(
    'ChBBY3RvclByZWZlcmVuY2VzEhQKBXRoZW1lGAEgASgJUgV0aGVtZRIWCgZsb2NhbGUYAiABKA'
    'lSBmxvY2FsZRIcCgl0ZWxlbWV0cnkYAyABKAhSCXRlbGVtZXRyeRJjChJlbmRwb2ludF9vdmVy'
    'cmlkZXMYBCADKAsyNC5wZWVycy5hY3Rvci5BY3RvclByZWZlcmVuY2VzLkVuZHBvaW50T3Zlcn'
    'JpZGVzRW50cnlSEWVuZHBvaW50T3ZlcnJpZGVzElQKDWZlYXR1cmVfZmxhZ3MYBSADKAsyLy5w'
    'ZWVycy5hY3Rvci5BY3RvclByZWZlcmVuY2VzLkZlYXR1cmVGbGFnc0VudHJ5UgxmZWF0dXJlRm'
    'xhZ3MSJQoOc2NoZW1hX3ZlcnNpb24YBiABKAVSDXNjaGVtYVZlcnNpb24aRAoWRW5kcG9pbnRP'
    'dmVycmlkZXNFbnRyeRIQCgNrZXkYASABKAlSA2tleRIUCgV2YWx1ZRgCIAEoCVIFdmFsdWU6Aj'
    'gBGj8KEUZlYXR1cmVGbGFnc0VudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZhbHVlGAIgASgI'
    'UgV2YWx1ZToCOAE=');
