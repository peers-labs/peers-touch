// This is a generated file - do not edit.
//
// Generated from domain/actor/preferences.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class ActorPreferences extends $pb.GeneratedMessage {
  factory ActorPreferences({
    $core.String? theme,
    $core.String? locale,
    $core.bool? telemetry,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>?
        endpointOverrides,
    $core.Iterable<$core.MapEntry<$core.String, $core.bool>>? featureFlags,
    $core.int? schemaVersion,
  }) {
    final result = create();
    if (theme != null) result.theme = theme;
    if (locale != null) result.locale = locale;
    if (telemetry != null) result.telemetry = telemetry;
    if (endpointOverrides != null)
      result.endpointOverrides.addEntries(endpointOverrides);
    if (featureFlags != null) result.featureFlags.addEntries(featureFlags);
    if (schemaVersion != null) result.schemaVersion = schemaVersion;
    return result;
  }

  ActorPreferences._();

  factory ActorPreferences.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ActorPreferences.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ActorPreferences',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers.actor'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'theme')
    ..aOS(2, _omitFieldNames ? '' : 'locale')
    ..aOB(3, _omitFieldNames ? '' : 'telemetry')
    ..m<$core.String, $core.String>(
        4, _omitFieldNames ? '' : 'endpointOverrides',
        entryClassName: 'ActorPreferences.EndpointOverridesEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers.actor'))
    ..m<$core.String, $core.bool>(5, _omitFieldNames ? '' : 'featureFlags',
        entryClassName: 'ActorPreferences.FeatureFlagsEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OB,
        packageName: const $pb.PackageName('peers.actor'))
    ..aI(6, _omitFieldNames ? '' : 'schemaVersion')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorPreferences clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorPreferences copyWith(void Function(ActorPreferences) updates) =>
      super.copyWith((message) => updates(message as ActorPreferences))
          as ActorPreferences;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ActorPreferences create() => ActorPreferences._();
  @$core.override
  ActorPreferences createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ActorPreferences getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ActorPreferences>(create);
  static ActorPreferences? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get theme => $_getSZ(0);
  @$pb.TagNumber(1)
  set theme($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTheme() => $_has(0);
  @$pb.TagNumber(1)
  void clearTheme() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get locale => $_getSZ(1);
  @$pb.TagNumber(2)
  set locale($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLocale() => $_has(1);
  @$pb.TagNumber(2)
  void clearLocale() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.bool get telemetry => $_getBF(2);
  @$pb.TagNumber(3)
  set telemetry($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTelemetry() => $_has(2);
  @$pb.TagNumber(3)
  void clearTelemetry() => $_clearField(3);

  @$pb.TagNumber(4)
  $pb.PbMap<$core.String, $core.String> get endpointOverrides => $_getMap(3);

  @$pb.TagNumber(5)
  $pb.PbMap<$core.String, $core.bool> get featureFlags => $_getMap(4);

  @$pb.TagNumber(6)
  $core.int get schemaVersion => $_getIZ(5);
  @$pb.TagNumber(6)
  set schemaVersion($core.int value) => $_setSignedInt32(5, value);
  @$pb.TagNumber(6)
  $core.bool hasSchemaVersion() => $_has(5);
  @$pb.TagNumber(6)
  void clearSchemaVersion() => $_clearField(6);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
