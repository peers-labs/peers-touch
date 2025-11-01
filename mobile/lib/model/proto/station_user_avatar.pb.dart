// This is a generated file - do not edit.
//
// Generated from station_user_avatar.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

import 'google/protobuf/timestamp.pb.dart' as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

/// UserAvatar represents a user's profile avatar image
class UserAvatar extends $pb.GeneratedMessage {
  factory UserAvatar({
    $core.String? id,
    $core.String? userId,
    $core.String? filename,
    $core.String? url,
    $fixnum.Int64? size,
    $core.String? mimeType,
    $core.bool? isCurrent,
    $0.Timestamp? createdAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (userId != null) result.userId = userId;
    if (filename != null) result.filename = filename;
    if (url != null) result.url = url;
    if (size != null) result.size = size;
    if (mimeType != null) result.mimeType = mimeType;
    if (isCurrent != null) result.isCurrent = isCurrent;
    if (createdAt != null) result.createdAt = createdAt;
    return result;
  }

  UserAvatar._();

  factory UserAvatar.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UserAvatar.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UserAvatar',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v1.user'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'userId')
    ..aOS(3, _omitFieldNames ? '' : 'filename')
    ..aOS(4, _omitFieldNames ? '' : 'url')
    ..aInt64(5, _omitFieldNames ? '' : 'size')
    ..aOS(6, _omitFieldNames ? '' : 'mimeType')
    ..aOB(7, _omitFieldNames ? '' : 'isCurrent')
    ..aOM<$0.Timestamp>(8, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UserAvatar clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UserAvatar copyWith(void Function(UserAvatar) updates) =>
      super.copyWith((message) => updates(message as UserAvatar)) as UserAvatar;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UserAvatar create() => UserAvatar._();
  @$core.override
  UserAvatar createEmptyInstance() => create();
  static $pb.PbList<UserAvatar> createRepeated() => $pb.PbList<UserAvatar>();
  @$core.pragma('dart2js:noInline')
  static UserAvatar getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UserAvatar>(create);
  static UserAvatar? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get userId => $_getSZ(1);
  @$pb.TagNumber(2)
  set userId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUserId() => $_has(1);
  @$pb.TagNumber(2)
  void clearUserId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get filename => $_getSZ(2);
  @$pb.TagNumber(3)
  set filename($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasFilename() => $_has(2);
  @$pb.TagNumber(3)
  void clearFilename() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get url => $_getSZ(3);
  @$pb.TagNumber(4)
  set url($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearUrl() => $_clearField(4);

  @$pb.TagNumber(5)
  $fixnum.Int64 get size => $_getI64(4);
  @$pb.TagNumber(5)
  set size($fixnum.Int64 value) => $_setInt64(4, value);
  @$pb.TagNumber(5)
  $core.bool hasSize() => $_has(4);
  @$pb.TagNumber(5)
  void clearSize() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get mimeType => $_getSZ(5);
  @$pb.TagNumber(6)
  set mimeType($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasMimeType() => $_has(5);
  @$pb.TagNumber(6)
  void clearMimeType() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.bool get isCurrent => $_getBF(6);
  @$pb.TagNumber(7)
  set isCurrent($core.bool value) => $_setBool(6, value);
  @$pb.TagNumber(7)
  $core.bool hasIsCurrent() => $_has(6);
  @$pb.TagNumber(7)
  void clearIsCurrent() => $_clearField(7);

  @$pb.TagNumber(8)
  $0.Timestamp get createdAt => $_getN(7);
  @$pb.TagNumber(8)
  set createdAt($0.Timestamp value) => $_setField(8, value);
  @$pb.TagNumber(8)
  $core.bool hasCreatedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearCreatedAt() => $_clearField(8);
  @$pb.TagNumber(8)
  $0.Timestamp ensureCreatedAt() => $_ensure(7);
}

/// UploadAvatarRequest is the request for uploading a new avatar
/// In practice, this is implemented as a multipart form upload with 'user_id' and 'avatar' fields
class UploadAvatarRequest extends $pb.GeneratedMessage {
  factory UploadAvatarRequest({
    $core.String? userId,
  }) {
    final result = create();
    if (userId != null) result.userId = userId;
    return result;
  }

  UploadAvatarRequest._();

  factory UploadAvatarRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UploadAvatarRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UploadAvatarRequest',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v1.user'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'userId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UploadAvatarRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UploadAvatarRequest copyWith(void Function(UploadAvatarRequest) updates) =>
      super.copyWith((message) => updates(message as UploadAvatarRequest))
          as UploadAvatarRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UploadAvatarRequest create() => UploadAvatarRequest._();
  @$core.override
  UploadAvatarRequest createEmptyInstance() => create();
  static $pb.PbList<UploadAvatarRequest> createRepeated() =>
      $pb.PbList<UploadAvatarRequest>();
  @$core.pragma('dart2js:noInline')
  static UploadAvatarRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UploadAvatarRequest>(create);
  static UploadAvatarRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get userId => $_getSZ(0);
  @$pb.TagNumber(1)
  set userId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUserId() => $_has(0);
  @$pb.TagNumber(1)
  void clearUserId() => $_clearField(1);
}

/// UploadAvatarResponse is the response after uploading an avatar
class UploadAvatarResponse extends $pb.GeneratedMessage {
  factory UploadAvatarResponse({
    UserAvatar? avatar,
    $core.bool? success,
    $core.String? message,
  }) {
    final result = create();
    if (avatar != null) result.avatar = avatar;
    if (success != null) result.success = success;
    if (message != null) result.message = message;
    return result;
  }

  UploadAvatarResponse._();

  factory UploadAvatarResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UploadAvatarResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UploadAvatarResponse',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v1.user'),
      createEmptyInstance: create)
    ..aOM<UserAvatar>(1, _omitFieldNames ? '' : 'avatar',
        subBuilder: UserAvatar.create)
    ..aOB(2, _omitFieldNames ? '' : 'success')
    ..aOS(3, _omitFieldNames ? '' : 'message')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UploadAvatarResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UploadAvatarResponse copyWith(void Function(UploadAvatarResponse) updates) =>
      super.copyWith((message) => updates(message as UploadAvatarResponse))
          as UploadAvatarResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UploadAvatarResponse create() => UploadAvatarResponse._();
  @$core.override
  UploadAvatarResponse createEmptyInstance() => create();
  static $pb.PbList<UploadAvatarResponse> createRepeated() =>
      $pb.PbList<UploadAvatarResponse>();
  @$core.pragma('dart2js:noInline')
  static UploadAvatarResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UploadAvatarResponse>(create);
  static UploadAvatarResponse? _defaultInstance;

  @$pb.TagNumber(1)
  UserAvatar get avatar => $_getN(0);
  @$pb.TagNumber(1)
  set avatar(UserAvatar value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasAvatar() => $_has(0);
  @$pb.TagNumber(1)
  void clearAvatar() => $_clearField(1);
  @$pb.TagNumber(1)
  UserAvatar ensureAvatar() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.bool get success => $_getBF(1);
  @$pb.TagNumber(2)
  set success($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSuccess() => $_has(1);
  @$pb.TagNumber(2)
  void clearSuccess() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get message => $_getSZ(2);
  @$pb.TagNumber(3)
  set message($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasMessage() => $_has(2);
  @$pb.TagNumber(3)
  void clearMessage() => $_clearField(3);
}

/// GetUserAvatarsRequest is the request for retrieving a user's avatars
class GetUserAvatarsRequest extends $pb.GeneratedMessage {
  factory GetUserAvatarsRequest({
    $core.String? userId,
    $core.int? limit,
  }) {
    final result = create();
    if (userId != null) result.userId = userId;
    if (limit != null) result.limit = limit;
    return result;
  }

  GetUserAvatarsRequest._();

  factory GetUserAvatarsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserAvatarsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserAvatarsRequest',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v1.user'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'userId')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserAvatarsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserAvatarsRequest copyWith(
          void Function(GetUserAvatarsRequest) updates) =>
      super.copyWith((message) => updates(message as GetUserAvatarsRequest))
          as GetUserAvatarsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserAvatarsRequest create() => GetUserAvatarsRequest._();
  @$core.override
  GetUserAvatarsRequest createEmptyInstance() => create();
  static $pb.PbList<GetUserAvatarsRequest> createRepeated() =>
      $pb.PbList<GetUserAvatarsRequest>();
  @$core.pragma('dart2js:noInline')
  static GetUserAvatarsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserAvatarsRequest>(create);
  static GetUserAvatarsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get userId => $_getSZ(0);
  @$pb.TagNumber(1)
  set userId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUserId() => $_has(0);
  @$pb.TagNumber(1)
  void clearUserId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);
}

/// GetUserAvatarsResponse is the response containing user avatars
class GetUserAvatarsResponse extends $pb.GeneratedMessage {
  factory GetUserAvatarsResponse({
    $core.Iterable<UserAvatar>? avatars,
    $core.bool? success,
    $core.String? message,
  }) {
    final result = create();
    if (avatars != null) result.avatars.addAll(avatars);
    if (success != null) result.success = success;
    if (message != null) result.message = message;
    return result;
  }

  GetUserAvatarsResponse._();

  factory GetUserAvatarsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserAvatarsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserAvatarsResponse',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v1.user'),
      createEmptyInstance: create)
    ..pPM<UserAvatar>(1, _omitFieldNames ? '' : 'avatars',
        subBuilder: UserAvatar.create)
    ..aOB(2, _omitFieldNames ? '' : 'success')
    ..aOS(3, _omitFieldNames ? '' : 'message')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserAvatarsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserAvatarsResponse copyWith(
          void Function(GetUserAvatarsResponse) updates) =>
      super.copyWith((message) => updates(message as GetUserAvatarsResponse))
          as GetUserAvatarsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserAvatarsResponse create() => GetUserAvatarsResponse._();
  @$core.override
  GetUserAvatarsResponse createEmptyInstance() => create();
  static $pb.PbList<GetUserAvatarsResponse> createRepeated() =>
      $pb.PbList<GetUserAvatarsResponse>();
  @$core.pragma('dart2js:noInline')
  static GetUserAvatarsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserAvatarsResponse>(create);
  static GetUserAvatarsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<UserAvatar> get avatars => $_getList(0);

  @$pb.TagNumber(2)
  $core.bool get success => $_getBF(1);
  @$pb.TagNumber(2)
  set success($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSuccess() => $_has(1);
  @$pb.TagNumber(2)
  void clearSuccess() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get message => $_getSZ(2);
  @$pb.TagNumber(3)
  set message($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasMessage() => $_has(2);
  @$pb.TagNumber(3)
  void clearMessage() => $_clearField(3);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
