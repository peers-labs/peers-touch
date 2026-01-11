// This is a generated file - do not edit.
//
// Generated from domain/actor/actor_status.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class OnlineActorsResponse extends $pb.GeneratedMessage {
  factory OnlineActorsResponse({
    $core.Iterable<OnlineActor>? actors,
  }) {
    final result = create();
    if (actors != null) result.actors.addAll(actors);
    return result;
  }

  OnlineActorsResponse._();

  factory OnlineActorsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory OnlineActorsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'OnlineActorsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.actor.v1'),
      createEmptyInstance: create)
    ..pPM<OnlineActor>(1, _omitFieldNames ? '' : 'actors',
        subBuilder: OnlineActor.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OnlineActorsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OnlineActorsResponse copyWith(void Function(OnlineActorsResponse) updates) =>
      super.copyWith((message) => updates(message as OnlineActorsResponse))
          as OnlineActorsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static OnlineActorsResponse create() => OnlineActorsResponse._();
  @$core.override
  OnlineActorsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static OnlineActorsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<OnlineActorsResponse>(create);
  static OnlineActorsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<OnlineActor> get actors => $_getList(0);
}

class OnlineActor extends $pb.GeneratedMessage {
  factory OnlineActor({
    $fixnum.Int64? id,
    $core.String? name,
    $core.String? preferredUsername,
    $core.String? avatarUrl,
    $core.int? status,
    $core.String? lastHeartbeat,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (name != null) result.name = name;
    if (preferredUsername != null) result.preferredUsername = preferredUsername;
    if (avatarUrl != null) result.avatarUrl = avatarUrl;
    if (status != null) result.status = status;
    if (lastHeartbeat != null) result.lastHeartbeat = lastHeartbeat;
    return result;
  }

  OnlineActor._();

  factory OnlineActor.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory OnlineActor.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'OnlineActor',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.actor.v1'),
      createEmptyInstance: create)
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'id', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'preferredUsername')
    ..aOS(4, _omitFieldNames ? '' : 'avatarUrl')
    ..aI(5, _omitFieldNames ? '' : 'status')
    ..aOS(6, _omitFieldNames ? '' : 'lastHeartbeat')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OnlineActor clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  OnlineActor copyWith(void Function(OnlineActor) updates) =>
      super.copyWith((message) => updates(message as OnlineActor))
          as OnlineActor;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static OnlineActor create() => OnlineActor._();
  @$core.override
  OnlineActor createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static OnlineActor getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<OnlineActor>(create);
  static OnlineActor? _defaultInstance;

  @$pb.TagNumber(1)
  $fixnum.Int64 get id => $_getI64(0);
  @$pb.TagNumber(1)
  set id($fixnum.Int64 value) => $_setInt64(0, value);
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
  $core.String get preferredUsername => $_getSZ(2);
  @$pb.TagNumber(3)
  set preferredUsername($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPreferredUsername() => $_has(2);
  @$pb.TagNumber(3)
  void clearPreferredUsername() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get avatarUrl => $_getSZ(3);
  @$pb.TagNumber(4)
  set avatarUrl($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasAvatarUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearAvatarUrl() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.int get status => $_getIZ(4);
  @$pb.TagNumber(5)
  set status($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasStatus() => $_has(4);
  @$pb.TagNumber(5)
  void clearStatus() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get lastHeartbeat => $_getSZ(5);
  @$pb.TagNumber(6)
  set lastHeartbeat($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasLastHeartbeat() => $_has(5);
  @$pb.TagNumber(6)
  void clearLastHeartbeat() => $_clearField(6);
}

class HeartbeatRequest extends $pb.GeneratedMessage {
  factory HeartbeatRequest() => create();

  HeartbeatRequest._();

  factory HeartbeatRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory HeartbeatRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'HeartbeatRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.actor.v1'),
      createEmptyInstance: create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  HeartbeatRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  HeartbeatRequest copyWith(void Function(HeartbeatRequest) updates) =>
      super.copyWith((message) => updates(message as HeartbeatRequest))
          as HeartbeatRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static HeartbeatRequest create() => HeartbeatRequest._();
  @$core.override
  HeartbeatRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static HeartbeatRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<HeartbeatRequest>(create);
  static HeartbeatRequest? _defaultInstance;
}

class HeartbeatResponse extends $pb.GeneratedMessage {
  factory HeartbeatResponse() => create();

  HeartbeatResponse._();

  factory HeartbeatResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory HeartbeatResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'HeartbeatResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.actor.v1'),
      createEmptyInstance: create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  HeartbeatResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  HeartbeatResponse copyWith(void Function(HeartbeatResponse) updates) =>
      super.copyWith((message) => updates(message as HeartbeatResponse))
          as HeartbeatResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static HeartbeatResponse create() => HeartbeatResponse._();
  @$core.override
  HeartbeatResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static HeartbeatResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<HeartbeatResponse>(create);
  static HeartbeatResponse? _defaultInstance;
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
