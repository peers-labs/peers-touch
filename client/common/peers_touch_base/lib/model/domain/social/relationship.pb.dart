// This is a generated file - do not edit.
//
// Generated from domain/social/relationship.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart'
    as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class FollowRequest extends $pb.GeneratedMessage {
  factory FollowRequest({
    $core.String? targetActorId,
  }) {
    final result = create();
    if (targetActorId != null) result.targetActorId = targetActorId;
    return result;
  }

  FollowRequest._();

  factory FollowRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory FollowRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FollowRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'targetActorId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowRequest copyWith(void Function(FollowRequest) updates) =>
      super.copyWith((message) => updates(message as FollowRequest))
          as FollowRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static FollowRequest create() => FollowRequest._();
  @$core.override
  FollowRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static FollowRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<FollowRequest>(create);
  static FollowRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get targetActorId => $_getSZ(0);
  @$pb.TagNumber(1)
  set targetActorId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTargetActorId() => $_has(0);
  @$pb.TagNumber(1)
  void clearTargetActorId() => $_clearField(1);
}

class FollowResponse extends $pb.GeneratedMessage {
  factory FollowResponse({
    $core.bool? success,
    Relationship? relationship,
  }) {
    final result = create();
    if (success != null) result.success = success;
    if (relationship != null) result.relationship = relationship;
    return result;
  }

  FollowResponse._();

  factory FollowResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory FollowResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FollowResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..aOM<Relationship>(2, _omitFieldNames ? '' : 'relationship',
        subBuilder: Relationship.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowResponse copyWith(void Function(FollowResponse) updates) =>
      super.copyWith((message) => updates(message as FollowResponse))
          as FollowResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static FollowResponse create() => FollowResponse._();
  @$core.override
  FollowResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static FollowResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<FollowResponse>(create);
  static FollowResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);

  @$pb.TagNumber(2)
  Relationship get relationship => $_getN(1);
  @$pb.TagNumber(2)
  set relationship(Relationship value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasRelationship() => $_has(1);
  @$pb.TagNumber(2)
  void clearRelationship() => $_clearField(2);
  @$pb.TagNumber(2)
  Relationship ensureRelationship() => $_ensure(1);
}

class UnfollowRequest extends $pb.GeneratedMessage {
  factory UnfollowRequest({
    $core.String? targetActorId,
  }) {
    final result = create();
    if (targetActorId != null) result.targetActorId = targetActorId;
    return result;
  }

  UnfollowRequest._();

  factory UnfollowRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UnfollowRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnfollowRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'targetActorId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnfollowRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnfollowRequest copyWith(void Function(UnfollowRequest) updates) =>
      super.copyWith((message) => updates(message as UnfollowRequest))
          as UnfollowRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UnfollowRequest create() => UnfollowRequest._();
  @$core.override
  UnfollowRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UnfollowRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UnfollowRequest>(create);
  static UnfollowRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get targetActorId => $_getSZ(0);
  @$pb.TagNumber(1)
  set targetActorId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTargetActorId() => $_has(0);
  @$pb.TagNumber(1)
  void clearTargetActorId() => $_clearField(1);
}

class UnfollowResponse extends $pb.GeneratedMessage {
  factory UnfollowResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  UnfollowResponse._();

  factory UnfollowResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UnfollowResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnfollowResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnfollowResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnfollowResponse copyWith(void Function(UnfollowResponse) updates) =>
      super.copyWith((message) => updates(message as UnfollowResponse))
          as UnfollowResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UnfollowResponse create() => UnfollowResponse._();
  @$core.override
  UnfollowResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UnfollowResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UnfollowResponse>(create);
  static UnfollowResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

class GetRelationshipRequest extends $pb.GeneratedMessage {
  factory GetRelationshipRequest({
    $core.String? targetActorId,
  }) {
    final result = create();
    if (targetActorId != null) result.targetActorId = targetActorId;
    return result;
  }

  GetRelationshipRequest._();

  factory GetRelationshipRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetRelationshipRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetRelationshipRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'targetActorId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipRequest copyWith(
          void Function(GetRelationshipRequest) updates) =>
      super.copyWith((message) => updates(message as GetRelationshipRequest))
          as GetRelationshipRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetRelationshipRequest create() => GetRelationshipRequest._();
  @$core.override
  GetRelationshipRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetRelationshipRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetRelationshipRequest>(create);
  static GetRelationshipRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get targetActorId => $_getSZ(0);
  @$pb.TagNumber(1)
  set targetActorId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTargetActorId() => $_has(0);
  @$pb.TagNumber(1)
  void clearTargetActorId() => $_clearField(1);
}

class GetRelationshipResponse extends $pb.GeneratedMessage {
  factory GetRelationshipResponse({
    Relationship? relationship,
  }) {
    final result = create();
    if (relationship != null) result.relationship = relationship;
    return result;
  }

  GetRelationshipResponse._();

  factory GetRelationshipResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetRelationshipResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetRelationshipResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOM<Relationship>(1, _omitFieldNames ? '' : 'relationship',
        subBuilder: Relationship.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipResponse copyWith(
          void Function(GetRelationshipResponse) updates) =>
      super.copyWith((message) => updates(message as GetRelationshipResponse))
          as GetRelationshipResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetRelationshipResponse create() => GetRelationshipResponse._();
  @$core.override
  GetRelationshipResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetRelationshipResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetRelationshipResponse>(create);
  static GetRelationshipResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Relationship get relationship => $_getN(0);
  @$pb.TagNumber(1)
  set relationship(Relationship value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasRelationship() => $_has(0);
  @$pb.TagNumber(1)
  void clearRelationship() => $_clearField(1);
  @$pb.TagNumber(1)
  Relationship ensureRelationship() => $_ensure(0);
}

class GetRelationshipsRequest extends $pb.GeneratedMessage {
  factory GetRelationshipsRequest({
    $core.Iterable<$core.String>? targetActorIds,
  }) {
    final result = create();
    if (targetActorIds != null) result.targetActorIds.addAll(targetActorIds);
    return result;
  }

  GetRelationshipsRequest._();

  factory GetRelationshipsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetRelationshipsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetRelationshipsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..pPS(1, _omitFieldNames ? '' : 'targetActorIds')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipsRequest copyWith(
          void Function(GetRelationshipsRequest) updates) =>
      super.copyWith((message) => updates(message as GetRelationshipsRequest))
          as GetRelationshipsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetRelationshipsRequest create() => GetRelationshipsRequest._();
  @$core.override
  GetRelationshipsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetRelationshipsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetRelationshipsRequest>(create);
  static GetRelationshipsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$core.String> get targetActorIds => $_getList(0);
}

class GetRelationshipsResponse extends $pb.GeneratedMessage {
  factory GetRelationshipsResponse({
    $core.Iterable<Relationship>? relationships,
  }) {
    final result = create();
    if (relationships != null) result.relationships.addAll(relationships);
    return result;
  }

  GetRelationshipsResponse._();

  factory GetRelationshipsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetRelationshipsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetRelationshipsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..pPM<Relationship>(1, _omitFieldNames ? '' : 'relationships',
        subBuilder: Relationship.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipsResponse copyWith(
          void Function(GetRelationshipsResponse) updates) =>
      super.copyWith((message) => updates(message as GetRelationshipsResponse))
          as GetRelationshipsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetRelationshipsResponse create() => GetRelationshipsResponse._();
  @$core.override
  GetRelationshipsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetRelationshipsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetRelationshipsResponse>(create);
  static GetRelationshipsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Relationship> get relationships => $_getList(0);
}

class Relationship extends $pb.GeneratedMessage {
  factory Relationship({
    $core.String? id,
    $core.String? targetActorId,
    $core.bool? following,
    $core.bool? followedBy,
    $0.Timestamp? followedAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (targetActorId != null) result.targetActorId = targetActorId;
    if (following != null) result.following = following;
    if (followedBy != null) result.followedBy = followedBy;
    if (followedAt != null) result.followedAt = followedAt;
    return result;
  }

  Relationship._();

  factory Relationship.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Relationship.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Relationship',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'targetActorId')
    ..aOB(3, _omitFieldNames ? '' : 'following')
    ..aOB(4, _omitFieldNames ? '' : 'followedBy')
    ..aOM<$0.Timestamp>(5, _omitFieldNames ? '' : 'followedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Relationship clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Relationship copyWith(void Function(Relationship) updates) =>
      super.copyWith((message) => updates(message as Relationship))
          as Relationship;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Relationship create() => Relationship._();
  @$core.override
  Relationship createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Relationship getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Relationship>(create);
  static Relationship? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get targetActorId => $_getSZ(1);
  @$pb.TagNumber(2)
  set targetActorId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTargetActorId() => $_has(1);
  @$pb.TagNumber(2)
  void clearTargetActorId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.bool get following => $_getBF(2);
  @$pb.TagNumber(3)
  set following($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasFollowing() => $_has(2);
  @$pb.TagNumber(3)
  void clearFollowing() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.bool get followedBy => $_getBF(3);
  @$pb.TagNumber(4)
  set followedBy($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasFollowedBy() => $_has(3);
  @$pb.TagNumber(4)
  void clearFollowedBy() => $_clearField(4);

  @$pb.TagNumber(5)
  $0.Timestamp get followedAt => $_getN(4);
  @$pb.TagNumber(5)
  set followedAt($0.Timestamp value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasFollowedAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearFollowedAt() => $_clearField(5);
  @$pb.TagNumber(5)
  $0.Timestamp ensureFollowedAt() => $_ensure(4);
}

class GetFollowersRequest extends $pb.GeneratedMessage {
  factory GetFollowersRequest({
    $core.String? actorId,
    $core.String? cursor,
    $core.int? limit,
  }) {
    final result = create();
    if (actorId != null) result.actorId = actorId;
    if (cursor != null) result.cursor = cursor;
    if (limit != null) result.limit = limit;
    return result;
  }

  GetFollowersRequest._();

  factory GetFollowersRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetFollowersRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetFollowersRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'actorId')
    ..aOS(2, _omitFieldNames ? '' : 'cursor')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowersRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowersRequest copyWith(void Function(GetFollowersRequest) updates) =>
      super.copyWith((message) => updates(message as GetFollowersRequest))
          as GetFollowersRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetFollowersRequest create() => GetFollowersRequest._();
  @$core.override
  GetFollowersRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetFollowersRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetFollowersRequest>(create);
  static GetFollowersRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get actorId => $_getSZ(0);
  @$pb.TagNumber(1)
  set actorId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasActorId() => $_has(0);
  @$pb.TagNumber(1)
  void clearActorId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get cursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set cursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearCursor() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);
}

class GetFollowersResponse extends $pb.GeneratedMessage {
  factory GetFollowersResponse({
    $core.Iterable<Follower>? followers,
    $core.String? nextCursor,
    $core.int? total,
  }) {
    final result = create();
    if (followers != null) result.followers.addAll(followers);
    if (nextCursor != null) result.nextCursor = nextCursor;
    if (total != null) result.total = total;
    return result;
  }

  GetFollowersResponse._();

  factory GetFollowersResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetFollowersResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetFollowersResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..pPM<Follower>(1, _omitFieldNames ? '' : 'followers',
        subBuilder: Follower.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..aI(3, _omitFieldNames ? '' : 'total')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowersResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowersResponse copyWith(void Function(GetFollowersResponse) updates) =>
      super.copyWith((message) => updates(message as GetFollowersResponse))
          as GetFollowersResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetFollowersResponse create() => GetFollowersResponse._();
  @$core.override
  GetFollowersResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetFollowersResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetFollowersResponse>(create);
  static GetFollowersResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Follower> get followers => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextCursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextCursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextCursor() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get total => $_getIZ(2);
  @$pb.TagNumber(3)
  set total($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTotal() => $_has(2);
  @$pb.TagNumber(3)
  void clearTotal() => $_clearField(3);
}

class GetFollowingRequest extends $pb.GeneratedMessage {
  factory GetFollowingRequest({
    $core.String? actorId,
    $core.String? cursor,
    $core.int? limit,
  }) {
    final result = create();
    if (actorId != null) result.actorId = actorId;
    if (cursor != null) result.cursor = cursor;
    if (limit != null) result.limit = limit;
    return result;
  }

  GetFollowingRequest._();

  factory GetFollowingRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetFollowingRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetFollowingRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'actorId')
    ..aOS(2, _omitFieldNames ? '' : 'cursor')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowingRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowingRequest copyWith(void Function(GetFollowingRequest) updates) =>
      super.copyWith((message) => updates(message as GetFollowingRequest))
          as GetFollowingRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetFollowingRequest create() => GetFollowingRequest._();
  @$core.override
  GetFollowingRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetFollowingRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetFollowingRequest>(create);
  static GetFollowingRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get actorId => $_getSZ(0);
  @$pb.TagNumber(1)
  set actorId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasActorId() => $_has(0);
  @$pb.TagNumber(1)
  void clearActorId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get cursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set cursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearCursor() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);
}

class GetFollowingResponse extends $pb.GeneratedMessage {
  factory GetFollowingResponse({
    $core.Iterable<Following>? following,
    $core.String? nextCursor,
    $core.int? total,
  }) {
    final result = create();
    if (following != null) result.following.addAll(following);
    if (nextCursor != null) result.nextCursor = nextCursor;
    if (total != null) result.total = total;
    return result;
  }

  GetFollowingResponse._();

  factory GetFollowingResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetFollowingResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetFollowingResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..pPM<Following>(1, _omitFieldNames ? '' : 'following',
        subBuilder: Following.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..aI(3, _omitFieldNames ? '' : 'total')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowingResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowingResponse copyWith(void Function(GetFollowingResponse) updates) =>
      super.copyWith((message) => updates(message as GetFollowingResponse))
          as GetFollowingResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetFollowingResponse create() => GetFollowingResponse._();
  @$core.override
  GetFollowingResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetFollowingResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetFollowingResponse>(create);
  static GetFollowingResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Following> get following => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextCursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextCursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextCursor() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get total => $_getIZ(2);
  @$pb.TagNumber(3)
  set total($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTotal() => $_has(2);
  @$pb.TagNumber(3)
  void clearTotal() => $_clearField(3);
}

class Follower extends $pb.GeneratedMessage {
  factory Follower({
    $core.String? actorId,
    $core.String? username,
    $core.String? displayName,
    $core.String? avatarUrl,
    $0.Timestamp? followedAt,
  }) {
    final result = create();
    if (actorId != null) result.actorId = actorId;
    if (username != null) result.username = username;
    if (displayName != null) result.displayName = displayName;
    if (avatarUrl != null) result.avatarUrl = avatarUrl;
    if (followedAt != null) result.followedAt = followedAt;
    return result;
  }

  Follower._();

  factory Follower.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Follower.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Follower',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'actorId')
    ..aOS(2, _omitFieldNames ? '' : 'username')
    ..aOS(3, _omitFieldNames ? '' : 'displayName')
    ..aOS(4, _omitFieldNames ? '' : 'avatarUrl')
    ..aOM<$0.Timestamp>(5, _omitFieldNames ? '' : 'followedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Follower clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Follower copyWith(void Function(Follower) updates) =>
      super.copyWith((message) => updates(message as Follower)) as Follower;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Follower create() => Follower._();
  @$core.override
  Follower createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Follower getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Follower>(create);
  static Follower? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get actorId => $_getSZ(0);
  @$pb.TagNumber(1)
  set actorId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasActorId() => $_has(0);
  @$pb.TagNumber(1)
  void clearActorId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get username => $_getSZ(1);
  @$pb.TagNumber(2)
  set username($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUsername() => $_has(1);
  @$pb.TagNumber(2)
  void clearUsername() => $_clearField(2);

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

  @$pb.TagNumber(5)
  $0.Timestamp get followedAt => $_getN(4);
  @$pb.TagNumber(5)
  set followedAt($0.Timestamp value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasFollowedAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearFollowedAt() => $_clearField(5);
  @$pb.TagNumber(5)
  $0.Timestamp ensureFollowedAt() => $_ensure(4);
}

class Following extends $pb.GeneratedMessage {
  factory Following({
    $core.String? actorId,
    $core.String? username,
    $core.String? displayName,
    $core.String? avatarUrl,
    $0.Timestamp? followedAt,
  }) {
    final result = create();
    if (actorId != null) result.actorId = actorId;
    if (username != null) result.username = username;
    if (displayName != null) result.displayName = displayName;
    if (avatarUrl != null) result.avatarUrl = avatarUrl;
    if (followedAt != null) result.followedAt = followedAt;
    return result;
  }

  Following._();

  factory Following.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Following.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Following',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'actorId')
    ..aOS(2, _omitFieldNames ? '' : 'username')
    ..aOS(3, _omitFieldNames ? '' : 'displayName')
    ..aOS(4, _omitFieldNames ? '' : 'avatarUrl')
    ..aOM<$0.Timestamp>(5, _omitFieldNames ? '' : 'followedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Following clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Following copyWith(void Function(Following) updates) =>
      super.copyWith((message) => updates(message as Following)) as Following;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Following create() => Following._();
  @$core.override
  Following createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Following getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Following>(create);
  static Following? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get actorId => $_getSZ(0);
  @$pb.TagNumber(1)
  set actorId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasActorId() => $_has(0);
  @$pb.TagNumber(1)
  void clearActorId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get username => $_getSZ(1);
  @$pb.TagNumber(2)
  set username($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUsername() => $_has(1);
  @$pb.TagNumber(2)
  void clearUsername() => $_clearField(2);

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

  @$pb.TagNumber(5)
  $0.Timestamp get followedAt => $_getN(4);
  @$pb.TagNumber(5)
  set followedAt($0.Timestamp value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasFollowedAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearFollowedAt() => $_clearField(5);
  @$pb.TagNumber(5)
  $0.Timestamp ensureFollowedAt() => $_ensure(4);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
