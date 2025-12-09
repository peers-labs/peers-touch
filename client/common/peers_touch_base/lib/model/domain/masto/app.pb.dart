// This is a generated file - do not edit.
//
// Generated from domain/masto/app.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class MastoApp extends $pb.GeneratedMessage {
  factory MastoApp({
    $core.String? id,
    $core.String? name,
    $core.String? clientId,
    $core.String? clientSecret,
    $core.String? redirectUri,
    $core.String? website,
    $core.String? scopes,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (name != null) result.name = name;
    if (clientId != null) result.clientId = clientId;
    if (clientSecret != null) result.clientSecret = clientSecret;
    if (redirectUri != null) result.redirectUri = redirectUri;
    if (website != null) result.website = website;
    if (scopes != null) result.scopes = scopes;
    return result;
  }

  MastoApp._();

  factory MastoApp.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MastoApp.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MastoApp',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.masto.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'clientId')
    ..aOS(4, _omitFieldNames ? '' : 'clientSecret')
    ..aOS(5, _omitFieldNames ? '' : 'redirectUri')
    ..aOS(6, _omitFieldNames ? '' : 'website')
    ..aOS(7, _omitFieldNames ? '' : 'scopes')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastoApp clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastoApp copyWith(void Function(MastoApp) updates) =>
      super.copyWith((message) => updates(message as MastoApp)) as MastoApp;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MastoApp create() => MastoApp._();
  @$core.override
  MastoApp createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MastoApp getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<MastoApp>(create);
  static MastoApp? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get clientId => $_getSZ(2);
  @$pb.TagNumber(3)
  set clientId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasClientId() => $_has(2);
  @$pb.TagNumber(3)
  void clearClientId() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get clientSecret => $_getSZ(3);
  @$pb.TagNumber(4)
  set clientSecret($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasClientSecret() => $_has(3);
  @$pb.TagNumber(4)
  void clearClientSecret() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get redirectUri => $_getSZ(4);
  @$pb.TagNumber(5)
  set redirectUri($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasRedirectUri() => $_has(4);
  @$pb.TagNumber(5)
  void clearRedirectUri() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get website => $_getSZ(5);
  @$pb.TagNumber(6)
  set website($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasWebsite() => $_has(5);
  @$pb.TagNumber(6)
  void clearWebsite() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get scopes => $_getSZ(6);
  @$pb.TagNumber(7)
  set scopes($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasScopes() => $_has(6);
  @$pb.TagNumber(7)
  void clearScopes() => $_clearField(7);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
