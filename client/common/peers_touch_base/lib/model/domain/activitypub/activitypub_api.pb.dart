// This is a generated file - do not edit.
//
// Generated from domain/activitypub/activitypub_api.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart'
    as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

/// Actor Signup & Login
class ActorSignupRequest extends $pb.GeneratedMessage {
  factory ActorSignupRequest({
    $core.String? handle,
    $core.String? email,
    $core.String? password,
    $core.String? displayName,
  }) {
    final result = create();
    if (handle != null) result.handle = handle;
    if (email != null) result.email = email;
    if (password != null) result.password = password;
    if (displayName != null) result.displayName = displayName;
    return result;
  }

  ActorSignupRequest._();

  factory ActorSignupRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ActorSignupRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ActorSignupRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'handle')
    ..aOS(2, _omitFieldNames ? '' : 'email')
    ..aOS(3, _omitFieldNames ? '' : 'password')
    ..aOS(4, _omitFieldNames ? '' : 'displayName')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorSignupRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorSignupRequest copyWith(void Function(ActorSignupRequest) updates) =>
      super.copyWith((message) => updates(message as ActorSignupRequest))
          as ActorSignupRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ActorSignupRequest create() => ActorSignupRequest._();
  @$core.override
  ActorSignupRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ActorSignupRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ActorSignupRequest>(create);
  static ActorSignupRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get handle => $_getSZ(0);
  @$pb.TagNumber(1)
  set handle($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasHandle() => $_has(0);
  @$pb.TagNumber(1)
  void clearHandle() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get email => $_getSZ(1);
  @$pb.TagNumber(2)
  set email($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEmail() => $_has(1);
  @$pb.TagNumber(2)
  void clearEmail() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get password => $_getSZ(2);
  @$pb.TagNumber(3)
  set password($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPassword() => $_has(2);
  @$pb.TagNumber(3)
  void clearPassword() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get displayName => $_getSZ(3);
  @$pb.TagNumber(4)
  set displayName($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasDisplayName() => $_has(3);
  @$pb.TagNumber(4)
  void clearDisplayName() => $_clearField(4);
}

class ActorSignupResponse extends $pb.GeneratedMessage {
  factory ActorSignupResponse({
    $core.String? actorId,
    $core.String? handle,
    $core.String? token,
  }) {
    final result = create();
    if (actorId != null) result.actorId = actorId;
    if (handle != null) result.handle = handle;
    if (token != null) result.token = token;
    return result;
  }

  ActorSignupResponse._();

  factory ActorSignupResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ActorSignupResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ActorSignupResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'actorId')
    ..aOS(2, _omitFieldNames ? '' : 'handle')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorSignupResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorSignupResponse copyWith(void Function(ActorSignupResponse) updates) =>
      super.copyWith((message) => updates(message as ActorSignupResponse))
          as ActorSignupResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ActorSignupResponse create() => ActorSignupResponse._();
  @$core.override
  ActorSignupResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ActorSignupResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ActorSignupResponse>(create);
  static ActorSignupResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get actorId => $_getSZ(0);
  @$pb.TagNumber(1)
  set actorId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasActorId() => $_has(0);
  @$pb.TagNumber(1)
  void clearActorId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get handle => $_getSZ(1);
  @$pb.TagNumber(2)
  set handle($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasHandle() => $_has(1);
  @$pb.TagNumber(2)
  void clearHandle() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(3)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearToken() => $_clearField(3);
}

class ActorLoginRequest extends $pb.GeneratedMessage {
  factory ActorLoginRequest({
    $core.String? identifier,
    $core.String? password,
  }) {
    final result = create();
    if (identifier != null) result.identifier = identifier;
    if (password != null) result.password = password;
    return result;
  }

  ActorLoginRequest._();

  factory ActorLoginRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ActorLoginRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ActorLoginRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'identifier')
    ..aOS(2, _omitFieldNames ? '' : 'password')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorLoginRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorLoginRequest copyWith(void Function(ActorLoginRequest) updates) =>
      super.copyWith((message) => updates(message as ActorLoginRequest))
          as ActorLoginRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ActorLoginRequest create() => ActorLoginRequest._();
  @$core.override
  ActorLoginRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ActorLoginRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ActorLoginRequest>(create);
  static ActorLoginRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get identifier => $_getSZ(0);
  @$pb.TagNumber(1)
  set identifier($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasIdentifier() => $_has(0);
  @$pb.TagNumber(1)
  void clearIdentifier() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get password => $_getSZ(1);
  @$pb.TagNumber(2)
  set password($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPassword() => $_has(1);
  @$pb.TagNumber(2)
  void clearPassword() => $_clearField(2);
}

class ActorLoginResponse extends $pb.GeneratedMessage {
  factory ActorLoginResponse({
    $core.String? actorId,
    $core.String? handle,
    $core.String? token,
  }) {
    final result = create();
    if (actorId != null) result.actorId = actorId;
    if (handle != null) result.handle = handle;
    if (token != null) result.token = token;
    return result;
  }

  ActorLoginResponse._();

  factory ActorLoginResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ActorLoginResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ActorLoginResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'actorId')
    ..aOS(2, _omitFieldNames ? '' : 'handle')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorLoginResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorLoginResponse copyWith(void Function(ActorLoginResponse) updates) =>
      super.copyWith((message) => updates(message as ActorLoginResponse))
          as ActorLoginResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ActorLoginResponse create() => ActorLoginResponse._();
  @$core.override
  ActorLoginResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ActorLoginResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ActorLoginResponse>(create);
  static ActorLoginResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get actorId => $_getSZ(0);
  @$pb.TagNumber(1)
  set actorId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasActorId() => $_has(0);
  @$pb.TagNumber(1)
  void clearActorId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get handle => $_getSZ(1);
  @$pb.TagNumber(2)
  set handle($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasHandle() => $_has(1);
  @$pb.TagNumber(2)
  void clearHandle() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(3)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearToken() => $_clearField(3);
}

/// Actor Profile
class GetActorProfileRequest extends $pb.GeneratedMessage {
  factory GetActorProfileRequest({
    $core.String? actorId,
  }) {
    final result = create();
    if (actorId != null) result.actorId = actorId;
    return result;
  }

  GetActorProfileRequest._();

  factory GetActorProfileRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetActorProfileRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetActorProfileRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'actorId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetActorProfileRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetActorProfileRequest copyWith(
          void Function(GetActorProfileRequest) updates) =>
      super.copyWith((message) => updates(message as GetActorProfileRequest))
          as GetActorProfileRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetActorProfileRequest create() => GetActorProfileRequest._();
  @$core.override
  GetActorProfileRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetActorProfileRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetActorProfileRequest>(create);
  static GetActorProfileRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get actorId => $_getSZ(0);
  @$pb.TagNumber(1)
  set actorId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasActorId() => $_has(0);
  @$pb.TagNumber(1)
  void clearActorId() => $_clearField(1);
}

class ActorProfile extends $pb.GeneratedMessage {
  factory ActorProfile({
    $core.String? id,
    $core.String? handle,
    $core.String? displayName,
    $core.String? summary,
    $core.String? avatarUrl,
    $core.String? headerUrl,
    $fixnum.Int64? followersCount,
    $fixnum.Int64? followingCount,
    $fixnum.Int64? postsCount,
    $0.Timestamp? createdAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (handle != null) result.handle = handle;
    if (displayName != null) result.displayName = displayName;
    if (summary != null) result.summary = summary;
    if (avatarUrl != null) result.avatarUrl = avatarUrl;
    if (headerUrl != null) result.headerUrl = headerUrl;
    if (followersCount != null) result.followersCount = followersCount;
    if (followingCount != null) result.followingCount = followingCount;
    if (postsCount != null) result.postsCount = postsCount;
    if (createdAt != null) result.createdAt = createdAt;
    return result;
  }

  ActorProfile._();

  factory ActorProfile.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ActorProfile.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ActorProfile',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'handle')
    ..aOS(3, _omitFieldNames ? '' : 'displayName')
    ..aOS(4, _omitFieldNames ? '' : 'summary')
    ..aOS(5, _omitFieldNames ? '' : 'avatarUrl')
    ..aOS(6, _omitFieldNames ? '' : 'headerUrl')
    ..aInt64(7, _omitFieldNames ? '' : 'followersCount')
    ..aInt64(8, _omitFieldNames ? '' : 'followingCount')
    ..aInt64(9, _omitFieldNames ? '' : 'postsCount')
    ..aOM<$0.Timestamp>(10, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorProfile clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorProfile copyWith(void Function(ActorProfile) updates) =>
      super.copyWith((message) => updates(message as ActorProfile))
          as ActorProfile;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ActorProfile create() => ActorProfile._();
  @$core.override
  ActorProfile createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ActorProfile getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ActorProfile>(create);
  static ActorProfile? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get handle => $_getSZ(1);
  @$pb.TagNumber(2)
  set handle($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasHandle() => $_has(1);
  @$pb.TagNumber(2)
  void clearHandle() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get displayName => $_getSZ(2);
  @$pb.TagNumber(3)
  set displayName($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDisplayName() => $_has(2);
  @$pb.TagNumber(3)
  void clearDisplayName() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get summary => $_getSZ(3);
  @$pb.TagNumber(4)
  set summary($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasSummary() => $_has(3);
  @$pb.TagNumber(4)
  void clearSummary() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get avatarUrl => $_getSZ(4);
  @$pb.TagNumber(5)
  set avatarUrl($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasAvatarUrl() => $_has(4);
  @$pb.TagNumber(5)
  void clearAvatarUrl() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get headerUrl => $_getSZ(5);
  @$pb.TagNumber(6)
  set headerUrl($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasHeaderUrl() => $_has(5);
  @$pb.TagNumber(6)
  void clearHeaderUrl() => $_clearField(6);

  @$pb.TagNumber(7)
  $fixnum.Int64 get followersCount => $_getI64(6);
  @$pb.TagNumber(7)
  set followersCount($fixnum.Int64 value) => $_setInt64(6, value);
  @$pb.TagNumber(7)
  $core.bool hasFollowersCount() => $_has(6);
  @$pb.TagNumber(7)
  void clearFollowersCount() => $_clearField(7);

  @$pb.TagNumber(8)
  $fixnum.Int64 get followingCount => $_getI64(7);
  @$pb.TagNumber(8)
  set followingCount($fixnum.Int64 value) => $_setInt64(7, value);
  @$pb.TagNumber(8)
  $core.bool hasFollowingCount() => $_has(7);
  @$pb.TagNumber(8)
  void clearFollowingCount() => $_clearField(8);

  @$pb.TagNumber(9)
  $fixnum.Int64 get postsCount => $_getI64(8);
  @$pb.TagNumber(9)
  set postsCount($fixnum.Int64 value) => $_setInt64(8, value);
  @$pb.TagNumber(9)
  $core.bool hasPostsCount() => $_has(8);
  @$pb.TagNumber(9)
  void clearPostsCount() => $_clearField(9);

  @$pb.TagNumber(10)
  $0.Timestamp get createdAt => $_getN(9);
  @$pb.TagNumber(10)
  set createdAt($0.Timestamp value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasCreatedAt() => $_has(9);
  @$pb.TagNumber(10)
  void clearCreatedAt() => $_clearField(10);
  @$pb.TagNumber(10)
  $0.Timestamp ensureCreatedAt() => $_ensure(9);
}

class GetActorProfileResponse extends $pb.GeneratedMessage {
  factory GetActorProfileResponse({
    ActorProfile? profile,
  }) {
    final result = create();
    if (profile != null) result.profile = profile;
    return result;
  }

  GetActorProfileResponse._();

  factory GetActorProfileResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetActorProfileResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetActorProfileResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOM<ActorProfile>(1, _omitFieldNames ? '' : 'profile',
        subBuilder: ActorProfile.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetActorProfileResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetActorProfileResponse copyWith(
          void Function(GetActorProfileResponse) updates) =>
      super.copyWith((message) => updates(message as GetActorProfileResponse))
          as GetActorProfileResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetActorProfileResponse create() => GetActorProfileResponse._();
  @$core.override
  GetActorProfileResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetActorProfileResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetActorProfileResponse>(create);
  static GetActorProfileResponse? _defaultInstance;

  @$pb.TagNumber(1)
  ActorProfile get profile => $_getN(0);
  @$pb.TagNumber(1)
  set profile(ActorProfile value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasProfile() => $_has(0);
  @$pb.TagNumber(1)
  void clearProfile() => $_clearField(1);
  @$pb.TagNumber(1)
  ActorProfile ensureProfile() => $_ensure(0);
}

class UpdateActorProfileRequest extends $pb.GeneratedMessage {
  factory UpdateActorProfileRequest({
    $core.String? displayName,
    $core.String? summary,
    $core.String? avatarUrl,
    $core.String? headerUrl,
  }) {
    final result = create();
    if (displayName != null) result.displayName = displayName;
    if (summary != null) result.summary = summary;
    if (avatarUrl != null) result.avatarUrl = avatarUrl;
    if (headerUrl != null) result.headerUrl = headerUrl;
    return result;
  }

  UpdateActorProfileRequest._();

  factory UpdateActorProfileRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateActorProfileRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateActorProfileRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'displayName')
    ..aOS(2, _omitFieldNames ? '' : 'summary')
    ..aOS(3, _omitFieldNames ? '' : 'avatarUrl')
    ..aOS(4, _omitFieldNames ? '' : 'headerUrl')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateActorProfileRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateActorProfileRequest copyWith(
          void Function(UpdateActorProfileRequest) updates) =>
      super.copyWith((message) => updates(message as UpdateActorProfileRequest))
          as UpdateActorProfileRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateActorProfileRequest create() => UpdateActorProfileRequest._();
  @$core.override
  UpdateActorProfileRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateActorProfileRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateActorProfileRequest>(create);
  static UpdateActorProfileRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get displayName => $_getSZ(0);
  @$pb.TagNumber(1)
  set displayName($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasDisplayName() => $_has(0);
  @$pb.TagNumber(1)
  void clearDisplayName() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get summary => $_getSZ(1);
  @$pb.TagNumber(2)
  set summary($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSummary() => $_has(1);
  @$pb.TagNumber(2)
  void clearSummary() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get avatarUrl => $_getSZ(2);
  @$pb.TagNumber(3)
  set avatarUrl($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasAvatarUrl() => $_has(2);
  @$pb.TagNumber(3)
  void clearAvatarUrl() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get headerUrl => $_getSZ(3);
  @$pb.TagNumber(4)
  set headerUrl($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasHeaderUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearHeaderUrl() => $_clearField(4);
}

class UpdateActorProfileResponse extends $pb.GeneratedMessage {
  factory UpdateActorProfileResponse({
    ActorProfile? profile,
  }) {
    final result = create();
    if (profile != null) result.profile = profile;
    return result;
  }

  UpdateActorProfileResponse._();

  factory UpdateActorProfileResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateActorProfileResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateActorProfileResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOM<ActorProfile>(1, _omitFieldNames ? '' : 'profile',
        subBuilder: ActorProfile.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateActorProfileResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateActorProfileResponse copyWith(
          void Function(UpdateActorProfileResponse) updates) =>
      super.copyWith(
              (message) => updates(message as UpdateActorProfileResponse))
          as UpdateActorProfileResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateActorProfileResponse create() => UpdateActorProfileResponse._();
  @$core.override
  UpdateActorProfileResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateActorProfileResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateActorProfileResponse>(create);
  static UpdateActorProfileResponse? _defaultInstance;

  @$pb.TagNumber(1)
  ActorProfile get profile => $_getN(0);
  @$pb.TagNumber(1)
  set profile(ActorProfile value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasProfile() => $_has(0);
  @$pb.TagNumber(1)
  void clearProfile() => $_clearField(1);
  @$pb.TagNumber(1)
  ActorProfile ensureProfile() => $_ensure(0);
}

class GetActorBasicInfoRequest extends $pb.GeneratedMessage {
  factory GetActorBasicInfoRequest({
    $core.String? actorId,
  }) {
    final result = create();
    if (actorId != null) result.actorId = actorId;
    return result;
  }

  GetActorBasicInfoRequest._();

  factory GetActorBasicInfoRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetActorBasicInfoRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetActorBasicInfoRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'actorId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetActorBasicInfoRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetActorBasicInfoRequest copyWith(
          void Function(GetActorBasicInfoRequest) updates) =>
      super.copyWith((message) => updates(message as GetActorBasicInfoRequest))
          as GetActorBasicInfoRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetActorBasicInfoRequest create() => GetActorBasicInfoRequest._();
  @$core.override
  GetActorBasicInfoRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetActorBasicInfoRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetActorBasicInfoRequest>(create);
  static GetActorBasicInfoRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get actorId => $_getSZ(0);
  @$pb.TagNumber(1)
  set actorId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasActorId() => $_has(0);
  @$pb.TagNumber(1)
  void clearActorId() => $_clearField(1);
}

class ActorBasicInfo extends $pb.GeneratedMessage {
  factory ActorBasicInfo({
    $core.String? id,
    $core.String? handle,
    $core.String? displayName,
    $core.String? avatarUrl,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (handle != null) result.handle = handle;
    if (displayName != null) result.displayName = displayName;
    if (avatarUrl != null) result.avatarUrl = avatarUrl;
    return result;
  }

  ActorBasicInfo._();

  factory ActorBasicInfo.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ActorBasicInfo.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ActorBasicInfo',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'handle')
    ..aOS(3, _omitFieldNames ? '' : 'displayName')
    ..aOS(4, _omitFieldNames ? '' : 'avatarUrl')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorBasicInfo clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorBasicInfo copyWith(void Function(ActorBasicInfo) updates) =>
      super.copyWith((message) => updates(message as ActorBasicInfo))
          as ActorBasicInfo;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ActorBasicInfo create() => ActorBasicInfo._();
  @$core.override
  ActorBasicInfo createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ActorBasicInfo getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ActorBasicInfo>(create);
  static ActorBasicInfo? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get handle => $_getSZ(1);
  @$pb.TagNumber(2)
  set handle($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasHandle() => $_has(1);
  @$pb.TagNumber(2)
  void clearHandle() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get displayName => $_getSZ(2);
  @$pb.TagNumber(3)
  set displayName($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDisplayName() => $_has(2);
  @$pb.TagNumber(3)
  void clearDisplayName() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get avatarUrl => $_getSZ(3);
  @$pb.TagNumber(4)
  set avatarUrl($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasAvatarUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearAvatarUrl() => $_clearField(4);
}

class GetActorBasicInfoResponse extends $pb.GeneratedMessage {
  factory GetActorBasicInfoResponse({
    ActorBasicInfo? info,
  }) {
    final result = create();
    if (info != null) result.info = info;
    return result;
  }

  GetActorBasicInfoResponse._();

  factory GetActorBasicInfoResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetActorBasicInfoResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetActorBasicInfoResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOM<ActorBasicInfo>(1, _omitFieldNames ? '' : 'info',
        subBuilder: ActorBasicInfo.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetActorBasicInfoResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetActorBasicInfoResponse copyWith(
          void Function(GetActorBasicInfoResponse) updates) =>
      super.copyWith((message) => updates(message as GetActorBasicInfoResponse))
          as GetActorBasicInfoResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetActorBasicInfoResponse create() => GetActorBasicInfoResponse._();
  @$core.override
  GetActorBasicInfoResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetActorBasicInfoResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetActorBasicInfoResponse>(create);
  static GetActorBasicInfoResponse? _defaultInstance;

  @$pb.TagNumber(1)
  ActorBasicInfo get info => $_getN(0);
  @$pb.TagNumber(1)
  set info(ActorBasicInfo value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasInfo() => $_has(0);
  @$pb.TagNumber(1)
  void clearInfo() => $_clearField(1);
  @$pb.TagNumber(1)
  ActorBasicInfo ensureInfo() => $_ensure(0);
}

/// Actor Lists
class ListActorsRequest extends $pb.GeneratedMessage {
  factory ListActorsRequest({
    $core.int? limit,
    $core.String? cursor,
  }) {
    final result = create();
    if (limit != null) result.limit = limit;
    if (cursor != null) result.cursor = cursor;
    return result;
  }

  ListActorsRequest._();

  factory ListActorsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListActorsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListActorsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'limit')
    ..aOS(2, _omitFieldNames ? '' : 'cursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListActorsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListActorsRequest copyWith(void Function(ListActorsRequest) updates) =>
      super.copyWith((message) => updates(message as ListActorsRequest))
          as ListActorsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListActorsRequest create() => ListActorsRequest._();
  @$core.override
  ListActorsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListActorsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListActorsRequest>(create);
  static ListActorsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get limit => $_getIZ(0);
  @$pb.TagNumber(1)
  set limit($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasLimit() => $_has(0);
  @$pb.TagNumber(1)
  void clearLimit() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get cursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set cursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearCursor() => $_clearField(2);
}

class ListActorsResponse extends $pb.GeneratedMessage {
  factory ListActorsResponse({
    $core.Iterable<ActorProfile>? actors,
    $core.String? nextCursor,
  }) {
    final result = create();
    if (actors != null) result.actors.addAll(actors);
    if (nextCursor != null) result.nextCursor = nextCursor;
    return result;
  }

  ListActorsResponse._();

  factory ListActorsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListActorsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListActorsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..pPM<ActorProfile>(1, _omitFieldNames ? '' : 'actors',
        subBuilder: ActorProfile.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListActorsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListActorsResponse copyWith(void Function(ListActorsResponse) updates) =>
      super.copyWith((message) => updates(message as ListActorsResponse))
          as ListActorsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListActorsResponse create() => ListActorsResponse._();
  @$core.override
  ListActorsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListActorsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListActorsResponse>(create);
  static ListActorsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<ActorProfile> get actors => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextCursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextCursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextCursor() => $_clearField(2);
}

class SearchActorsRequest extends $pb.GeneratedMessage {
  factory SearchActorsRequest({
    $core.String? query,
    $core.int? limit,
  }) {
    final result = create();
    if (query != null) result.query = query;
    if (limit != null) result.limit = limit;
    return result;
  }

  SearchActorsRequest._();

  factory SearchActorsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SearchActorsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SearchActorsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'query')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchActorsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchActorsRequest copyWith(void Function(SearchActorsRequest) updates) =>
      super.copyWith((message) => updates(message as SearchActorsRequest))
          as SearchActorsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SearchActorsRequest create() => SearchActorsRequest._();
  @$core.override
  SearchActorsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SearchActorsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SearchActorsRequest>(create);
  static SearchActorsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get query => $_getSZ(0);
  @$pb.TagNumber(1)
  set query($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasQuery() => $_has(0);
  @$pb.TagNumber(1)
  void clearQuery() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);
}

class SearchActorsResponse extends $pb.GeneratedMessage {
  factory SearchActorsResponse({
    $core.Iterable<ActorProfile>? actors,
  }) {
    final result = create();
    if (actors != null) result.actors.addAll(actors);
    return result;
  }

  SearchActorsResponse._();

  factory SearchActorsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SearchActorsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SearchActorsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..pPM<ActorProfile>(1, _omitFieldNames ? '' : 'actors',
        subBuilder: ActorProfile.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchActorsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchActorsResponse copyWith(void Function(SearchActorsResponse) updates) =>
      super.copyWith((message) => updates(message as SearchActorsResponse))
          as SearchActorsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SearchActorsResponse create() => SearchActorsResponse._();
  @$core.override
  SearchActorsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SearchActorsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SearchActorsResponse>(create);
  static SearchActorsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<ActorProfile> get actors => $_getList(0);
}

class GetUserActorRequest extends $pb.GeneratedMessage {
  factory GetUserActorRequest({
    $core.String? username,
  }) {
    final result = create();
    if (username != null) result.username = username;
    return result;
  }

  GetUserActorRequest._();

  factory GetUserActorRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserActorRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserActorRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'username')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserActorRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserActorRequest copyWith(void Function(GetUserActorRequest) updates) =>
      super.copyWith((message) => updates(message as GetUserActorRequest))
          as GetUserActorRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserActorRequest create() => GetUserActorRequest._();
  @$core.override
  GetUserActorRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUserActorRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserActorRequest>(create);
  static GetUserActorRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get username => $_getSZ(0);
  @$pb.TagNumber(1)
  set username($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUsername() => $_has(0);
  @$pb.TagNumber(1)
  void clearUsername() => $_clearField(1);
}

class GetUserActorResponse extends $pb.GeneratedMessage {
  factory GetUserActorResponse({
    ActorProfile? actor,
  }) {
    final result = create();
    if (actor != null) result.actor = actor;
    return result;
  }

  GetUserActorResponse._();

  factory GetUserActorResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserActorResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserActorResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOM<ActorProfile>(1, _omitFieldNames ? '' : 'actor',
        subBuilder: ActorProfile.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserActorResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserActorResponse copyWith(void Function(GetUserActorResponse) updates) =>
      super.copyWith((message) => updates(message as GetUserActorResponse))
          as GetUserActorResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserActorResponse create() => GetUserActorResponse._();
  @$core.override
  GetUserActorResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUserActorResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserActorResponse>(create);
  static GetUserActorResponse? _defaultInstance;

  @$pb.TagNumber(1)
  ActorProfile get actor => $_getN(0);
  @$pb.TagNumber(1)
  set actor(ActorProfile value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasActor() => $_has(0);
  @$pb.TagNumber(1)
  void clearActor() => $_clearField(1);
  @$pb.TagNumber(1)
  ActorProfile ensureActor() => $_ensure(0);
}

/// ActivityPub Protocol - Inbox/Outbox
class GetUserInboxRequest extends $pb.GeneratedMessage {
  factory GetUserInboxRequest({
    $core.String? username,
    $core.int? limit,
    $core.String? maxId,
  }) {
    final result = create();
    if (username != null) result.username = username;
    if (limit != null) result.limit = limit;
    if (maxId != null) result.maxId = maxId;
    return result;
  }

  GetUserInboxRequest._();

  factory GetUserInboxRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserInboxRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserInboxRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'username')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'maxId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserInboxRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserInboxRequest copyWith(void Function(GetUserInboxRequest) updates) =>
      super.copyWith((message) => updates(message as GetUserInboxRequest))
          as GetUserInboxRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserInboxRequest create() => GetUserInboxRequest._();
  @$core.override
  GetUserInboxRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUserInboxRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserInboxRequest>(create);
  static GetUserInboxRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get username => $_getSZ(0);
  @$pb.TagNumber(1)
  set username($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUsername() => $_has(0);
  @$pb.TagNumber(1)
  void clearUsername() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get maxId => $_getSZ(2);
  @$pb.TagNumber(3)
  set maxId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasMaxId() => $_has(2);
  @$pb.TagNumber(3)
  void clearMaxId() => $_clearField(3);
}

class Activity extends $pb.GeneratedMessage {
  factory Activity({
    $core.String? id,
    $core.String? type,
    $core.String? actor,
    $core.List<$core.int>? object,
    $0.Timestamp? published,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (type != null) result.type = type;
    if (actor != null) result.actor = actor;
    if (object != null) result.object = object;
    if (published != null) result.published = published;
    return result;
  }

  Activity._();

  factory Activity.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Activity.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Activity',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'type')
    ..aOS(3, _omitFieldNames ? '' : 'actor')
    ..a<$core.List<$core.int>>(
        4, _omitFieldNames ? '' : 'object', $pb.PbFieldType.OY)
    ..aOM<$0.Timestamp>(5, _omitFieldNames ? '' : 'published',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Activity clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Activity copyWith(void Function(Activity) updates) =>
      super.copyWith((message) => updates(message as Activity)) as Activity;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Activity create() => Activity._();
  @$core.override
  Activity createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Activity getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Activity>(create);
  static Activity? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get type => $_getSZ(1);
  @$pb.TagNumber(2)
  set type($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasType() => $_has(1);
  @$pb.TagNumber(2)
  void clearType() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get actor => $_getSZ(2);
  @$pb.TagNumber(3)
  set actor($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasActor() => $_has(2);
  @$pb.TagNumber(3)
  void clearActor() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.List<$core.int> get object => $_getN(3);
  @$pb.TagNumber(4)
  set object($core.List<$core.int> value) => $_setBytes(3, value);
  @$pb.TagNumber(4)
  $core.bool hasObject() => $_has(3);
  @$pb.TagNumber(4)
  void clearObject() => $_clearField(4);

  @$pb.TagNumber(5)
  $0.Timestamp get published => $_getN(4);
  @$pb.TagNumber(5)
  set published($0.Timestamp value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasPublished() => $_has(4);
  @$pb.TagNumber(5)
  void clearPublished() => $_clearField(5);
  @$pb.TagNumber(5)
  $0.Timestamp ensurePublished() => $_ensure(4);
}

class GetUserInboxResponse extends $pb.GeneratedMessage {
  factory GetUserInboxResponse({
    $core.Iterable<Activity>? activities,
    $core.String? nextMaxId,
  }) {
    final result = create();
    if (activities != null) result.activities.addAll(activities);
    if (nextMaxId != null) result.nextMaxId = nextMaxId;
    return result;
  }

  GetUserInboxResponse._();

  factory GetUserInboxResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserInboxResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserInboxResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..pPM<Activity>(1, _omitFieldNames ? '' : 'activities',
        subBuilder: Activity.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextMaxId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserInboxResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserInboxResponse copyWith(void Function(GetUserInboxResponse) updates) =>
      super.copyWith((message) => updates(message as GetUserInboxResponse))
          as GetUserInboxResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserInboxResponse create() => GetUserInboxResponse._();
  @$core.override
  GetUserInboxResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUserInboxResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserInboxResponse>(create);
  static GetUserInboxResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Activity> get activities => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextMaxId => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextMaxId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextMaxId() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextMaxId() => $_clearField(2);
}

class PostUserInboxRequest extends $pb.GeneratedMessage {
  factory PostUserInboxRequest({
    $core.String? username,
    $core.List<$core.int>? activity,
  }) {
    final result = create();
    if (username != null) result.username = username;
    if (activity != null) result.activity = activity;
    return result;
  }

  PostUserInboxRequest._();

  factory PostUserInboxRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostUserInboxRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostUserInboxRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'username')
    ..a<$core.List<$core.int>>(
        2, _omitFieldNames ? '' : 'activity', $pb.PbFieldType.OY)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostUserInboxRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostUserInboxRequest copyWith(void Function(PostUserInboxRequest) updates) =>
      super.copyWith((message) => updates(message as PostUserInboxRequest))
          as PostUserInboxRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostUserInboxRequest create() => PostUserInboxRequest._();
  @$core.override
  PostUserInboxRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostUserInboxRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostUserInboxRequest>(create);
  static PostUserInboxRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get username => $_getSZ(0);
  @$pb.TagNumber(1)
  set username($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUsername() => $_has(0);
  @$pb.TagNumber(1)
  void clearUsername() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.List<$core.int> get activity => $_getN(1);
  @$pb.TagNumber(2)
  set activity($core.List<$core.int> value) => $_setBytes(1, value);
  @$pb.TagNumber(2)
  $core.bool hasActivity() => $_has(1);
  @$pb.TagNumber(2)
  void clearActivity() => $_clearField(2);
}

class PostUserInboxResponse extends $pb.GeneratedMessage {
  factory PostUserInboxResponse({
    $core.bool? accepted,
  }) {
    final result = create();
    if (accepted != null) result.accepted = accepted;
    return result;
  }

  PostUserInboxResponse._();

  factory PostUserInboxResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostUserInboxResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostUserInboxResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'accepted')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostUserInboxResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostUserInboxResponse copyWith(
          void Function(PostUserInboxResponse) updates) =>
      super.copyWith((message) => updates(message as PostUserInboxResponse))
          as PostUserInboxResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostUserInboxResponse create() => PostUserInboxResponse._();
  @$core.override
  PostUserInboxResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostUserInboxResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostUserInboxResponse>(create);
  static PostUserInboxResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get accepted => $_getBF(0);
  @$pb.TagNumber(1)
  set accepted($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAccepted() => $_has(0);
  @$pb.TagNumber(1)
  void clearAccepted() => $_clearField(1);
}

class GetUserOutboxRequest extends $pb.GeneratedMessage {
  factory GetUserOutboxRequest({
    $core.String? username,
    $core.int? limit,
    $core.String? maxId,
  }) {
    final result = create();
    if (username != null) result.username = username;
    if (limit != null) result.limit = limit;
    if (maxId != null) result.maxId = maxId;
    return result;
  }

  GetUserOutboxRequest._();

  factory GetUserOutboxRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserOutboxRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserOutboxRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'username')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'maxId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserOutboxRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserOutboxRequest copyWith(void Function(GetUserOutboxRequest) updates) =>
      super.copyWith((message) => updates(message as GetUserOutboxRequest))
          as GetUserOutboxRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserOutboxRequest create() => GetUserOutboxRequest._();
  @$core.override
  GetUserOutboxRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUserOutboxRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserOutboxRequest>(create);
  static GetUserOutboxRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get username => $_getSZ(0);
  @$pb.TagNumber(1)
  set username($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUsername() => $_has(0);
  @$pb.TagNumber(1)
  void clearUsername() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get maxId => $_getSZ(2);
  @$pb.TagNumber(3)
  set maxId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasMaxId() => $_has(2);
  @$pb.TagNumber(3)
  void clearMaxId() => $_clearField(3);
}

class GetUserOutboxResponse extends $pb.GeneratedMessage {
  factory GetUserOutboxResponse({
    $core.Iterable<Activity>? activities,
    $core.String? nextMaxId,
  }) {
    final result = create();
    if (activities != null) result.activities.addAll(activities);
    if (nextMaxId != null) result.nextMaxId = nextMaxId;
    return result;
  }

  GetUserOutboxResponse._();

  factory GetUserOutboxResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserOutboxResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserOutboxResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..pPM<Activity>(1, _omitFieldNames ? '' : 'activities',
        subBuilder: Activity.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextMaxId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserOutboxResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserOutboxResponse copyWith(
          void Function(GetUserOutboxResponse) updates) =>
      super.copyWith((message) => updates(message as GetUserOutboxResponse))
          as GetUserOutboxResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserOutboxResponse create() => GetUserOutboxResponse._();
  @$core.override
  GetUserOutboxResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUserOutboxResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserOutboxResponse>(create);
  static GetUserOutboxResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Activity> get activities => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextMaxId => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextMaxId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextMaxId() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextMaxId() => $_clearField(2);
}

class PostUserOutboxRequest extends $pb.GeneratedMessage {
  factory PostUserOutboxRequest({
    $core.String? username,
    $core.List<$core.int>? activity,
  }) {
    final result = create();
    if (username != null) result.username = username;
    if (activity != null) result.activity = activity;
    return result;
  }

  PostUserOutboxRequest._();

  factory PostUserOutboxRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostUserOutboxRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostUserOutboxRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'username')
    ..a<$core.List<$core.int>>(
        2, _omitFieldNames ? '' : 'activity', $pb.PbFieldType.OY)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostUserOutboxRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostUserOutboxRequest copyWith(
          void Function(PostUserOutboxRequest) updates) =>
      super.copyWith((message) => updates(message as PostUserOutboxRequest))
          as PostUserOutboxRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostUserOutboxRequest create() => PostUserOutboxRequest._();
  @$core.override
  PostUserOutboxRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostUserOutboxRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostUserOutboxRequest>(create);
  static PostUserOutboxRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get username => $_getSZ(0);
  @$pb.TagNumber(1)
  set username($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUsername() => $_has(0);
  @$pb.TagNumber(1)
  void clearUsername() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.List<$core.int> get activity => $_getN(1);
  @$pb.TagNumber(2)
  set activity($core.List<$core.int> value) => $_setBytes(1, value);
  @$pb.TagNumber(2)
  $core.bool hasActivity() => $_has(1);
  @$pb.TagNumber(2)
  void clearActivity() => $_clearField(2);
}

class PostUserOutboxResponse extends $pb.GeneratedMessage {
  factory PostUserOutboxResponse({
    $core.String? activityId,
  }) {
    final result = create();
    if (activityId != null) result.activityId = activityId;
    return result;
  }

  PostUserOutboxResponse._();

  factory PostUserOutboxResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostUserOutboxResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostUserOutboxResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'activityId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostUserOutboxResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostUserOutboxResponse copyWith(
          void Function(PostUserOutboxResponse) updates) =>
      super.copyWith((message) => updates(message as PostUserOutboxResponse))
          as PostUserOutboxResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostUserOutboxResponse create() => PostUserOutboxResponse._();
  @$core.override
  PostUserOutboxResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostUserOutboxResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostUserOutboxResponse>(create);
  static PostUserOutboxResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get activityId => $_getSZ(0);
  @$pb.TagNumber(1)
  set activityId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasActivityId() => $_has(0);
  @$pb.TagNumber(1)
  void clearActivityId() => $_clearField(1);
}

/// Collections
class GetUserFollowersRequest extends $pb.GeneratedMessage {
  factory GetUserFollowersRequest({
    $core.String? username,
    $core.int? limit,
    $core.String? cursor,
  }) {
    final result = create();
    if (username != null) result.username = username;
    if (limit != null) result.limit = limit;
    if (cursor != null) result.cursor = cursor;
    return result;
  }

  GetUserFollowersRequest._();

  factory GetUserFollowersRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserFollowersRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserFollowersRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'username')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'cursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserFollowersRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserFollowersRequest copyWith(
          void Function(GetUserFollowersRequest) updates) =>
      super.copyWith((message) => updates(message as GetUserFollowersRequest))
          as GetUserFollowersRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserFollowersRequest create() => GetUserFollowersRequest._();
  @$core.override
  GetUserFollowersRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUserFollowersRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserFollowersRequest>(create);
  static GetUserFollowersRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get username => $_getSZ(0);
  @$pb.TagNumber(1)
  set username($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUsername() => $_has(0);
  @$pb.TagNumber(1)
  void clearUsername() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get cursor => $_getSZ(2);
  @$pb.TagNumber(3)
  set cursor($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCursor() => $_has(2);
  @$pb.TagNumber(3)
  void clearCursor() => $_clearField(3);
}

class GetUserFollowersResponse extends $pb.GeneratedMessage {
  factory GetUserFollowersResponse({
    $core.Iterable<$core.String>? followers,
    $core.String? nextCursor,
  }) {
    final result = create();
    if (followers != null) result.followers.addAll(followers);
    if (nextCursor != null) result.nextCursor = nextCursor;
    return result;
  }

  GetUserFollowersResponse._();

  factory GetUserFollowersResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserFollowersResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserFollowersResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..pPS(1, _omitFieldNames ? '' : 'followers')
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserFollowersResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserFollowersResponse copyWith(
          void Function(GetUserFollowersResponse) updates) =>
      super.copyWith((message) => updates(message as GetUserFollowersResponse))
          as GetUserFollowersResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserFollowersResponse create() => GetUserFollowersResponse._();
  @$core.override
  GetUserFollowersResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUserFollowersResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserFollowersResponse>(create);
  static GetUserFollowersResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$core.String> get followers => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextCursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextCursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextCursor() => $_clearField(2);
}

class GetUserFollowingRequest extends $pb.GeneratedMessage {
  factory GetUserFollowingRequest({
    $core.String? username,
    $core.int? limit,
    $core.String? cursor,
  }) {
    final result = create();
    if (username != null) result.username = username;
    if (limit != null) result.limit = limit;
    if (cursor != null) result.cursor = cursor;
    return result;
  }

  GetUserFollowingRequest._();

  factory GetUserFollowingRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserFollowingRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserFollowingRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'username')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'cursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserFollowingRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserFollowingRequest copyWith(
          void Function(GetUserFollowingRequest) updates) =>
      super.copyWith((message) => updates(message as GetUserFollowingRequest))
          as GetUserFollowingRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserFollowingRequest create() => GetUserFollowingRequest._();
  @$core.override
  GetUserFollowingRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUserFollowingRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserFollowingRequest>(create);
  static GetUserFollowingRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get username => $_getSZ(0);
  @$pb.TagNumber(1)
  set username($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUsername() => $_has(0);
  @$pb.TagNumber(1)
  void clearUsername() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get cursor => $_getSZ(2);
  @$pb.TagNumber(3)
  set cursor($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCursor() => $_has(2);
  @$pb.TagNumber(3)
  void clearCursor() => $_clearField(3);
}

class GetUserFollowingResponse extends $pb.GeneratedMessage {
  factory GetUserFollowingResponse({
    $core.Iterable<$core.String>? following,
    $core.String? nextCursor,
  }) {
    final result = create();
    if (following != null) result.following.addAll(following);
    if (nextCursor != null) result.nextCursor = nextCursor;
    return result;
  }

  GetUserFollowingResponse._();

  factory GetUserFollowingResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserFollowingResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserFollowingResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..pPS(1, _omitFieldNames ? '' : 'following')
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserFollowingResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserFollowingResponse copyWith(
          void Function(GetUserFollowingResponse) updates) =>
      super.copyWith((message) => updates(message as GetUserFollowingResponse))
          as GetUserFollowingResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserFollowingResponse create() => GetUserFollowingResponse._();
  @$core.override
  GetUserFollowingResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUserFollowingResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserFollowingResponse>(create);
  static GetUserFollowingResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$core.String> get following => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextCursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextCursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextCursor() => $_clearField(2);
}

class GetUserLikedRequest extends $pb.GeneratedMessage {
  factory GetUserLikedRequest({
    $core.String? username,
    $core.int? limit,
    $core.String? cursor,
  }) {
    final result = create();
    if (username != null) result.username = username;
    if (limit != null) result.limit = limit;
    if (cursor != null) result.cursor = cursor;
    return result;
  }

  GetUserLikedRequest._();

  factory GetUserLikedRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserLikedRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserLikedRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'username')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'cursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserLikedRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserLikedRequest copyWith(void Function(GetUserLikedRequest) updates) =>
      super.copyWith((message) => updates(message as GetUserLikedRequest))
          as GetUserLikedRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserLikedRequest create() => GetUserLikedRequest._();
  @$core.override
  GetUserLikedRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUserLikedRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserLikedRequest>(create);
  static GetUserLikedRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get username => $_getSZ(0);
  @$pb.TagNumber(1)
  set username($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUsername() => $_has(0);
  @$pb.TagNumber(1)
  void clearUsername() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get cursor => $_getSZ(2);
  @$pb.TagNumber(3)
  set cursor($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCursor() => $_has(2);
  @$pb.TagNumber(3)
  void clearCursor() => $_clearField(3);
}

class GetUserLikedResponse extends $pb.GeneratedMessage {
  factory GetUserLikedResponse({
    $core.Iterable<$core.String>? liked,
    $core.String? nextCursor,
  }) {
    final result = create();
    if (liked != null) result.liked.addAll(liked);
    if (nextCursor != null) result.nextCursor = nextCursor;
    return result;
  }

  GetUserLikedResponse._();

  factory GetUserLikedResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserLikedResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserLikedResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..pPS(1, _omitFieldNames ? '' : 'liked')
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserLikedResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserLikedResponse copyWith(void Function(GetUserLikedResponse) updates) =>
      super.copyWith((message) => updates(message as GetUserLikedResponse))
          as GetUserLikedResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserLikedResponse create() => GetUserLikedResponse._();
  @$core.override
  GetUserLikedResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUserLikedResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserLikedResponse>(create);
  static GetUserLikedResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$core.String> get liked => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextCursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextCursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextCursor() => $_clearField(2);
}

/// Shared Inbox
class GetSharedInboxRequest extends $pb.GeneratedMessage {
  factory GetSharedInboxRequest({
    $core.int? limit,
    $core.String? maxId,
  }) {
    final result = create();
    if (limit != null) result.limit = limit;
    if (maxId != null) result.maxId = maxId;
    return result;
  }

  GetSharedInboxRequest._();

  factory GetSharedInboxRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetSharedInboxRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetSharedInboxRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'limit')
    ..aOS(2, _omitFieldNames ? '' : 'maxId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSharedInboxRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSharedInboxRequest copyWith(
          void Function(GetSharedInboxRequest) updates) =>
      super.copyWith((message) => updates(message as GetSharedInboxRequest))
          as GetSharedInboxRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetSharedInboxRequest create() => GetSharedInboxRequest._();
  @$core.override
  GetSharedInboxRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetSharedInboxRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetSharedInboxRequest>(create);
  static GetSharedInboxRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get limit => $_getIZ(0);
  @$pb.TagNumber(1)
  set limit($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasLimit() => $_has(0);
  @$pb.TagNumber(1)
  void clearLimit() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get maxId => $_getSZ(1);
  @$pb.TagNumber(2)
  set maxId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasMaxId() => $_has(1);
  @$pb.TagNumber(2)
  void clearMaxId() => $_clearField(2);
}

class GetSharedInboxResponse extends $pb.GeneratedMessage {
  factory GetSharedInboxResponse({
    $core.Iterable<Activity>? activities,
    $core.String? nextMaxId,
  }) {
    final result = create();
    if (activities != null) result.activities.addAll(activities);
    if (nextMaxId != null) result.nextMaxId = nextMaxId;
    return result;
  }

  GetSharedInboxResponse._();

  factory GetSharedInboxResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetSharedInboxResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetSharedInboxResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..pPM<Activity>(1, _omitFieldNames ? '' : 'activities',
        subBuilder: Activity.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextMaxId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSharedInboxResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSharedInboxResponse copyWith(
          void Function(GetSharedInboxResponse) updates) =>
      super.copyWith((message) => updates(message as GetSharedInboxResponse))
          as GetSharedInboxResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetSharedInboxResponse create() => GetSharedInboxResponse._();
  @$core.override
  GetSharedInboxResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetSharedInboxResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetSharedInboxResponse>(create);
  static GetSharedInboxResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Activity> get activities => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextMaxId => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextMaxId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextMaxId() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextMaxId() => $_clearField(2);
}

class PostSharedInboxRequest extends $pb.GeneratedMessage {
  factory PostSharedInboxRequest({
    $core.List<$core.int>? activity,
  }) {
    final result = create();
    if (activity != null) result.activity = activity;
    return result;
  }

  PostSharedInboxRequest._();

  factory PostSharedInboxRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostSharedInboxRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostSharedInboxRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..a<$core.List<$core.int>>(
        1, _omitFieldNames ? '' : 'activity', $pb.PbFieldType.OY)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostSharedInboxRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostSharedInboxRequest copyWith(
          void Function(PostSharedInboxRequest) updates) =>
      super.copyWith((message) => updates(message as PostSharedInboxRequest))
          as PostSharedInboxRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostSharedInboxRequest create() => PostSharedInboxRequest._();
  @$core.override
  PostSharedInboxRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostSharedInboxRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostSharedInboxRequest>(create);
  static PostSharedInboxRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.List<$core.int> get activity => $_getN(0);
  @$pb.TagNumber(1)
  set activity($core.List<$core.int> value) => $_setBytes(0, value);
  @$pb.TagNumber(1)
  $core.bool hasActivity() => $_has(0);
  @$pb.TagNumber(1)
  void clearActivity() => $_clearField(1);
}

class PostSharedInboxResponse extends $pb.GeneratedMessage {
  factory PostSharedInboxResponse({
    $core.bool? accepted,
  }) {
    final result = create();
    if (accepted != null) result.accepted = accepted;
    return result;
  }

  PostSharedInboxResponse._();

  factory PostSharedInboxResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostSharedInboxResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostSharedInboxResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'accepted')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostSharedInboxResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostSharedInboxResponse copyWith(
          void Function(PostSharedInboxResponse) updates) =>
      super.copyWith((message) => updates(message as PostSharedInboxResponse))
          as PostSharedInboxResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostSharedInboxResponse create() => PostSharedInboxResponse._();
  @$core.override
  PostSharedInboxResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostSharedInboxResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostSharedInboxResponse>(create);
  static PostSharedInboxResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get accepted => $_getBF(0);
  @$pb.TagNumber(1)
  set accepted($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAccepted() => $_has(0);
  @$pb.TagNumber(1)
  void clearAccepted() => $_clearField(1);
}

/// Object Replies
class GetObjectRepliesRequest extends $pb.GeneratedMessage {
  factory GetObjectRepliesRequest({
    $core.String? objectId,
    $core.int? limit,
    $core.String? cursor,
  }) {
    final result = create();
    if (objectId != null) result.objectId = objectId;
    if (limit != null) result.limit = limit;
    if (cursor != null) result.cursor = cursor;
    return result;
  }

  GetObjectRepliesRequest._();

  factory GetObjectRepliesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetObjectRepliesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetObjectRepliesRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'objectId')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'cursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetObjectRepliesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetObjectRepliesRequest copyWith(
          void Function(GetObjectRepliesRequest) updates) =>
      super.copyWith((message) => updates(message as GetObjectRepliesRequest))
          as GetObjectRepliesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetObjectRepliesRequest create() => GetObjectRepliesRequest._();
  @$core.override
  GetObjectRepliesRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetObjectRepliesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetObjectRepliesRequest>(create);
  static GetObjectRepliesRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get objectId => $_getSZ(0);
  @$pb.TagNumber(1)
  set objectId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasObjectId() => $_has(0);
  @$pb.TagNumber(1)
  void clearObjectId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get cursor => $_getSZ(2);
  @$pb.TagNumber(3)
  set cursor($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCursor() => $_has(2);
  @$pb.TagNumber(3)
  void clearCursor() => $_clearField(3);
}

class GetObjectRepliesResponse extends $pb.GeneratedMessage {
  factory GetObjectRepliesResponse({
    $core.Iterable<Activity>? replies,
    $core.String? nextCursor,
  }) {
    final result = create();
    if (replies != null) result.replies.addAll(replies);
    if (nextCursor != null) result.nextCursor = nextCursor;
    return result;
  }

  GetObjectRepliesResponse._();

  factory GetObjectRepliesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetObjectRepliesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetObjectRepliesResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..pPM<Activity>(1, _omitFieldNames ? '' : 'replies',
        subBuilder: Activity.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetObjectRepliesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetObjectRepliesResponse copyWith(
          void Function(GetObjectRepliesResponse) updates) =>
      super.copyWith((message) => updates(message as GetObjectRepliesResponse))
          as GetObjectRepliesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetObjectRepliesResponse create() => GetObjectRepliesResponse._();
  @$core.override
  GetObjectRepliesResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetObjectRepliesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetObjectRepliesResponse>(create);
  static GetObjectRepliesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Activity> get replies => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextCursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextCursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextCursor() => $_clearField(2);
}

/// Create Activity
class CreateActivityRequest extends $pb.GeneratedMessage {
  factory CreateActivityRequest({
    $core.String? type,
    $core.List<$core.int>? object,
  }) {
    final result = create();
    if (type != null) result.type = type;
    if (object != null) result.object = object;
    return result;
  }

  CreateActivityRequest._();

  factory CreateActivityRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateActivityRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateActivityRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'type')
    ..a<$core.List<$core.int>>(
        2, _omitFieldNames ? '' : 'object', $pb.PbFieldType.OY)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateActivityRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateActivityRequest copyWith(
          void Function(CreateActivityRequest) updates) =>
      super.copyWith((message) => updates(message as CreateActivityRequest))
          as CreateActivityRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateActivityRequest create() => CreateActivityRequest._();
  @$core.override
  CreateActivityRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateActivityRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateActivityRequest>(create);
  static CreateActivityRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get type => $_getSZ(0);
  @$pb.TagNumber(1)
  set type($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasType() => $_has(0);
  @$pb.TagNumber(1)
  void clearType() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.List<$core.int> get object => $_getN(1);
  @$pb.TagNumber(2)
  set object($core.List<$core.int> value) => $_setBytes(1, value);
  @$pb.TagNumber(2)
  $core.bool hasObject() => $_has(1);
  @$pb.TagNumber(2)
  void clearObject() => $_clearField(2);
}

class CreateActivityResponse extends $pb.GeneratedMessage {
  factory CreateActivityResponse({
    $core.String? activityId,
  }) {
    final result = create();
    if (activityId != null) result.activityId = activityId;
    return result;
  }

  CreateActivityResponse._();

  factory CreateActivityResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateActivityResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateActivityResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'activityId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateActivityResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateActivityResponse copyWith(
          void Function(CreateActivityResponse) updates) =>
      super.copyWith((message) => updates(message as CreateActivityResponse))
          as CreateActivityResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateActivityResponse create() => CreateActivityResponse._();
  @$core.override
  CreateActivityResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateActivityResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateActivityResponse>(create);
  static CreateActivityResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get activityId => $_getSZ(0);
  @$pb.TagNumber(1)
  set activityId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasActivityId() => $_has(0);
  @$pb.TagNumber(1)
  void clearActivityId() => $_clearField(1);
}

/// NodeInfo
class NodeInfoRequest extends $pb.GeneratedMessage {
  factory NodeInfoRequest() => create();

  NodeInfoRequest._();

  factory NodeInfoRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory NodeInfoRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'NodeInfoRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  NodeInfoRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  NodeInfoRequest copyWith(void Function(NodeInfoRequest) updates) =>
      super.copyWith((message) => updates(message as NodeInfoRequest))
          as NodeInfoRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static NodeInfoRequest create() => NodeInfoRequest._();
  @$core.override
  NodeInfoRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static NodeInfoRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<NodeInfoRequest>(create);
  static NodeInfoRequest? _defaultInstance;
}

class NodeInfoResponse extends $pb.GeneratedMessage {
  factory NodeInfoResponse({
    $core.String? version,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? software,
    $core.Iterable<$core.MapEntry<$core.String, $fixnum.Int64>>? usage,
  }) {
    final result = create();
    if (version != null) result.version = version;
    if (software != null) result.software.addEntries(software);
    if (usage != null) result.usage.addEntries(usage);
    return result;
  }

  NodeInfoResponse._();

  factory NodeInfoResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory NodeInfoResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'NodeInfoResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'version')
    ..m<$core.String, $core.String>(2, _omitFieldNames ? '' : 'software',
        entryClassName: 'NodeInfoResponse.SoftwareEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.model.activitypub.v1'))
    ..m<$core.String, $fixnum.Int64>(3, _omitFieldNames ? '' : 'usage',
        entryClassName: 'NodeInfoResponse.UsageEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.O6,
        packageName: const $pb.PackageName('peers_touch.model.activitypub.v1'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  NodeInfoResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  NodeInfoResponse copyWith(void Function(NodeInfoResponse) updates) =>
      super.copyWith((message) => updates(message as NodeInfoResponse))
          as NodeInfoResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static NodeInfoResponse create() => NodeInfoResponse._();
  @$core.override
  NodeInfoResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static NodeInfoResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<NodeInfoResponse>(create);
  static NodeInfoResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get version => $_getSZ(0);
  @$pb.TagNumber(1)
  set version($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasVersion() => $_has(0);
  @$pb.TagNumber(1)
  void clearVersion() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbMap<$core.String, $core.String> get software => $_getMap(1);

  @$pb.TagNumber(3)
  $pb.PbMap<$core.String, $fixnum.Int64> get usage => $_getMap(2);
}

/// Events Pull (for EventsPull function)
class EventsPullRequest extends $pb.GeneratedMessage {
  factory EventsPullRequest({
    $fixnum.Int64? sinceTs,
    $core.int? limit,
  }) {
    final result = create();
    if (sinceTs != null) result.sinceTs = sinceTs;
    if (limit != null) result.limit = limit;
    return result;
  }

  EventsPullRequest._();

  factory EventsPullRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory EventsPullRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'EventsPullRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aInt64(1, _omitFieldNames ? '' : 'sinceTs')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  EventsPullRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  EventsPullRequest copyWith(void Function(EventsPullRequest) updates) =>
      super.copyWith((message) => updates(message as EventsPullRequest))
          as EventsPullRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static EventsPullRequest create() => EventsPullRequest._();
  @$core.override
  EventsPullRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static EventsPullRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<EventsPullRequest>(create);
  static EventsPullRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $fixnum.Int64 get sinceTs => $_getI64(0);
  @$pb.TagNumber(1)
  set sinceTs($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSinceTs() => $_has(0);
  @$pb.TagNumber(1)
  void clearSinceTs() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);
}

class Event extends $pb.GeneratedMessage {
  factory Event({
    $core.String? id,
    $core.String? type,
    $core.List<$core.int>? data,
    $0.Timestamp? timestamp,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (type != null) result.type = type;
    if (data != null) result.data = data;
    if (timestamp != null) result.timestamp = timestamp;
    return result;
  }

  Event._();

  factory Event.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Event.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Event',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'type')
    ..a<$core.List<$core.int>>(
        3, _omitFieldNames ? '' : 'data', $pb.PbFieldType.OY)
    ..aOM<$0.Timestamp>(4, _omitFieldNames ? '' : 'timestamp',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Event clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Event copyWith(void Function(Event) updates) =>
      super.copyWith((message) => updates(message as Event)) as Event;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Event create() => Event._();
  @$core.override
  Event createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Event getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Event>(create);
  static Event? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get type => $_getSZ(1);
  @$pb.TagNumber(2)
  set type($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasType() => $_has(1);
  @$pb.TagNumber(2)
  void clearType() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.List<$core.int> get data => $_getN(2);
  @$pb.TagNumber(3)
  set data($core.List<$core.int> value) => $_setBytes(2, value);
  @$pb.TagNumber(3)
  $core.bool hasData() => $_has(2);
  @$pb.TagNumber(3)
  void clearData() => $_clearField(3);

  @$pb.TagNumber(4)
  $0.Timestamp get timestamp => $_getN(3);
  @$pb.TagNumber(4)
  set timestamp($0.Timestamp value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasTimestamp() => $_has(3);
  @$pb.TagNumber(4)
  void clearTimestamp() => $_clearField(4);
  @$pb.TagNumber(4)
  $0.Timestamp ensureTimestamp() => $_ensure(3);
}

class EventsPullResponse extends $pb.GeneratedMessage {
  factory EventsPullResponse({
    $core.Iterable<Event>? events,
  }) {
    final result = create();
    if (events != null) result.events.addAll(events);
    return result;
  }

  EventsPullResponse._();

  factory EventsPullResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory EventsPullResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'EventsPullResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..pPM<Event>(1, _omitFieldNames ? '' : 'events', subBuilder: Event.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  EventsPullResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  EventsPullResponse copyWith(void Function(EventsPullResponse) updates) =>
      super.copyWith((message) => updates(message as EventsPullResponse))
          as EventsPullResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static EventsPullResponse create() => EventsPullResponse._();
  @$core.override
  EventsPullResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static EventsPullResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<EventsPullResponse>(create);
  static EventsPullResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Event> get events => $_getList(0);
}

/// Public Profile (HTML rendering - may keep native)
class PublicProfileRequest extends $pb.GeneratedMessage {
  factory PublicProfileRequest({
    $core.String? username,
  }) {
    final result = create();
    if (username != null) result.username = username;
    return result;
  }

  PublicProfileRequest._();

  factory PublicProfileRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PublicProfileRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PublicProfileRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'username')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublicProfileRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublicProfileRequest copyWith(void Function(PublicProfileRequest) updates) =>
      super.copyWith((message) => updates(message as PublicProfileRequest))
          as PublicProfileRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PublicProfileRequest create() => PublicProfileRequest._();
  @$core.override
  PublicProfileRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PublicProfileRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PublicProfileRequest>(create);
  static PublicProfileRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get username => $_getSZ(0);
  @$pb.TagNumber(1)
  set username($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUsername() => $_has(0);
  @$pb.TagNumber(1)
  void clearUsername() => $_clearField(1);
}

class PublicProfileResponse extends $pb.GeneratedMessage {
  factory PublicProfileResponse({
    $core.String? html,
  }) {
    final result = create();
    if (html != null) result.html = html;
    return result;
  }

  PublicProfileResponse._();

  factory PublicProfileResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PublicProfileResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PublicProfileResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.activitypub.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'html')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublicProfileResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublicProfileResponse copyWith(
          void Function(PublicProfileResponse) updates) =>
      super.copyWith((message) => updates(message as PublicProfileResponse))
          as PublicProfileResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PublicProfileResponse create() => PublicProfileResponse._();
  @$core.override
  PublicProfileResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PublicProfileResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PublicProfileResponse>(create);
  static PublicProfileResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get html => $_getSZ(0);
  @$pb.TagNumber(1)
  set html($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasHtml() => $_has(0);
  @$pb.TagNumber(1)
  void clearHtml() => $_clearField(1);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
