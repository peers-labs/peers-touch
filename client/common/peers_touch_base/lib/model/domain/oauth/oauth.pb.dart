// This is a generated file - do not edit.
//
// Generated from domain/oauth/oauth.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import '../../google/protobuf/timestamp.pb.dart' as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class OAuthClient extends $pb.GeneratedMessage {
  factory OAuthClient({
    $core.String? id,
    $core.String? name,
    $core.String? clientId,
    $core.String? clientSecretHash,
    $core.String? redirectUri,
    $core.String? scopes,
    $0.Timestamp? createdAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (name != null) result.name = name;
    if (clientId != null) result.clientId = clientId;
    if (clientSecretHash != null) result.clientSecretHash = clientSecretHash;
    if (redirectUri != null) result.redirectUri = redirectUri;
    if (scopes != null) result.scopes = scopes;
    if (createdAt != null) result.createdAt = createdAt;
    return result;
  }

  OAuthClient._();

  factory OAuthClient.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory OAuthClient.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'OAuthClient',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.oauth.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'clientId')
    ..aOS(4, _omitFieldNames ? '' : 'clientSecretHash')
    ..aOS(5, _omitFieldNames ? '' : 'redirectUri')
    ..aOS(6, _omitFieldNames ? '' : 'scopes')
    ..aOM<$0.Timestamp>(7, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OAuthClient clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OAuthClient copyWith(void Function(OAuthClient) updates) =>
      super.copyWith((message) => updates(message as OAuthClient))
          as OAuthClient;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static OAuthClient create() => OAuthClient._();
  @$core.override
  OAuthClient createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static OAuthClient getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<OAuthClient>(create);
  static OAuthClient? _defaultInstance;

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
  $core.String get clientSecretHash => $_getSZ(3);
  @$pb.TagNumber(4)
  set clientSecretHash($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasClientSecretHash() => $_has(3);
  @$pb.TagNumber(4)
  void clearClientSecretHash() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get redirectUri => $_getSZ(4);
  @$pb.TagNumber(5)
  set redirectUri($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasRedirectUri() => $_has(4);
  @$pb.TagNumber(5)
  void clearRedirectUri() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get scopes => $_getSZ(5);
  @$pb.TagNumber(6)
  set scopes($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasScopes() => $_has(5);
  @$pb.TagNumber(6)
  void clearScopes() => $_clearField(6);

  @$pb.TagNumber(7)
  $0.Timestamp get createdAt => $_getN(6);
  @$pb.TagNumber(7)
  set createdAt($0.Timestamp value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasCreatedAt() => $_has(6);
  @$pb.TagNumber(7)
  void clearCreatedAt() => $_clearField(7);
  @$pb.TagNumber(7)
  $0.Timestamp ensureCreatedAt() => $_ensure(6);
}

class OAuthAuthCode extends $pb.GeneratedMessage {
  factory OAuthAuthCode({
    $core.String? codeHash,
    $core.String? clientId,
    $core.String? userId,
    $core.String? scopes,
    $0.Timestamp? expiresAt,
    $core.bool? used,
  }) {
    final result = create();
    if (codeHash != null) result.codeHash = codeHash;
    if (clientId != null) result.clientId = clientId;
    if (userId != null) result.userId = userId;
    if (scopes != null) result.scopes = scopes;
    if (expiresAt != null) result.expiresAt = expiresAt;
    if (used != null) result.used = used;
    return result;
  }

  OAuthAuthCode._();

  factory OAuthAuthCode.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory OAuthAuthCode.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'OAuthAuthCode',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.oauth.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'codeHash')
    ..aOS(2, _omitFieldNames ? '' : 'clientId')
    ..aOS(3, _omitFieldNames ? '' : 'userId')
    ..aOS(4, _omitFieldNames ? '' : 'scopes')
    ..aOM<$0.Timestamp>(5, _omitFieldNames ? '' : 'expiresAt',
        subBuilder: $0.Timestamp.create)
    ..aOB(6, _omitFieldNames ? '' : 'used')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OAuthAuthCode clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OAuthAuthCode copyWith(void Function(OAuthAuthCode) updates) =>
      super.copyWith((message) => updates(message as OAuthAuthCode))
          as OAuthAuthCode;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static OAuthAuthCode create() => OAuthAuthCode._();
  @$core.override
  OAuthAuthCode createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static OAuthAuthCode getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<OAuthAuthCode>(create);
  static OAuthAuthCode? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get codeHash => $_getSZ(0);
  @$pb.TagNumber(1)
  set codeHash($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasCodeHash() => $_has(0);
  @$pb.TagNumber(1)
  void clearCodeHash() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get clientId => $_getSZ(1);
  @$pb.TagNumber(2)
  set clientId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasClientId() => $_has(1);
  @$pb.TagNumber(2)
  void clearClientId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get userId => $_getSZ(2);
  @$pb.TagNumber(3)
  set userId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasUserId() => $_has(2);
  @$pb.TagNumber(3)
  void clearUserId() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get scopes => $_getSZ(3);
  @$pb.TagNumber(4)
  set scopes($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasScopes() => $_has(3);
  @$pb.TagNumber(4)
  void clearScopes() => $_clearField(4);

  @$pb.TagNumber(5)
  $0.Timestamp get expiresAt => $_getN(4);
  @$pb.TagNumber(5)
  set expiresAt($0.Timestamp value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasExpiresAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearExpiresAt() => $_clearField(5);
  @$pb.TagNumber(5)
  $0.Timestamp ensureExpiresAt() => $_ensure(4);

  @$pb.TagNumber(6)
  $core.bool get used => $_getBF(5);
  @$pb.TagNumber(6)
  set used($core.bool value) => $_setBool(5, value);
  @$pb.TagNumber(6)
  $core.bool hasUsed() => $_has(5);
  @$pb.TagNumber(6)
  void clearUsed() => $_clearField(6);
}

class OAuthToken extends $pb.GeneratedMessage {
  factory OAuthToken({
    $core.String? accessTokenHash,
    $core.String? refreshTokenHash,
    $core.String? tokenType,
    $core.String? scope,
    $core.String? userId,
    $core.String? clientId,
    $0.Timestamp? createdAt,
    $0.Timestamp? expiresAt,
  }) {
    final result = create();
    if (accessTokenHash != null) result.accessTokenHash = accessTokenHash;
    if (refreshTokenHash != null) result.refreshTokenHash = refreshTokenHash;
    if (tokenType != null) result.tokenType = tokenType;
    if (scope != null) result.scope = scope;
    if (userId != null) result.userId = userId;
    if (clientId != null) result.clientId = clientId;
    if (createdAt != null) result.createdAt = createdAt;
    if (expiresAt != null) result.expiresAt = expiresAt;
    return result;
  }

  OAuthToken._();

  factory OAuthToken.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory OAuthToken.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'OAuthToken',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.oauth.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'accessTokenHash')
    ..aOS(2, _omitFieldNames ? '' : 'refreshTokenHash')
    ..aOS(3, _omitFieldNames ? '' : 'tokenType')
    ..aOS(4, _omitFieldNames ? '' : 'scope')
    ..aOS(5, _omitFieldNames ? '' : 'userId')
    ..aOS(6, _omitFieldNames ? '' : 'clientId')
    ..aOM<$0.Timestamp>(7, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(8, _omitFieldNames ? '' : 'expiresAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OAuthToken clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OAuthToken copyWith(void Function(OAuthToken) updates) =>
      super.copyWith((message) => updates(message as OAuthToken)) as OAuthToken;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static OAuthToken create() => OAuthToken._();
  @$core.override
  OAuthToken createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static OAuthToken getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<OAuthToken>(create);
  static OAuthToken? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get accessTokenHash => $_getSZ(0);
  @$pb.TagNumber(1)
  set accessTokenHash($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAccessTokenHash() => $_has(0);
  @$pb.TagNumber(1)
  void clearAccessTokenHash() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get refreshTokenHash => $_getSZ(1);
  @$pb.TagNumber(2)
  set refreshTokenHash($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasRefreshTokenHash() => $_has(1);
  @$pb.TagNumber(2)
  void clearRefreshTokenHash() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get tokenType => $_getSZ(2);
  @$pb.TagNumber(3)
  set tokenType($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTokenType() => $_has(2);
  @$pb.TagNumber(3)
  void clearTokenType() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get scope => $_getSZ(3);
  @$pb.TagNumber(4)
  set scope($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasScope() => $_has(3);
  @$pb.TagNumber(4)
  void clearScope() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get userId => $_getSZ(4);
  @$pb.TagNumber(5)
  set userId($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasUserId() => $_has(4);
  @$pb.TagNumber(5)
  void clearUserId() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get clientId => $_getSZ(5);
  @$pb.TagNumber(6)
  set clientId($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasClientId() => $_has(5);
  @$pb.TagNumber(6)
  void clearClientId() => $_clearField(6);

  @$pb.TagNumber(7)
  $0.Timestamp get createdAt => $_getN(6);
  @$pb.TagNumber(7)
  set createdAt($0.Timestamp value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasCreatedAt() => $_has(6);
  @$pb.TagNumber(7)
  void clearCreatedAt() => $_clearField(7);
  @$pb.TagNumber(7)
  $0.Timestamp ensureCreatedAt() => $_ensure(6);

  @$pb.TagNumber(8)
  $0.Timestamp get expiresAt => $_getN(7);
  @$pb.TagNumber(8)
  set expiresAt($0.Timestamp value) => $_setField(8, value);
  @$pb.TagNumber(8)
  $core.bool hasExpiresAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearExpiresAt() => $_clearField(8);
  @$pb.TagNumber(8)
  $0.Timestamp ensureExpiresAt() => $_ensure(7);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
