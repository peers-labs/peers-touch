// This is a generated file - do not edit.
//
// Generated from domain/core/core.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

/// Peer: 对等节点
class Peer extends $pb.GeneratedMessage {
  factory Peer({
    $core.String? peerId,
    $core.Iterable<$core.String>? multiaddrs,
  }) {
    final result = create();
    if (peerId != null) result.peerId = peerId;
    if (multiaddrs != null) result.multiaddrs.addAll(multiaddrs);
    return result;
  }

  Peer._();

  factory Peer.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Peer.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Peer',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.core.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'peerId')
    ..pPS(2, _omitFieldNames ? '' : 'multiaddrs')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Peer clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Peer copyWith(void Function(Peer) updates) =>
      super.copyWith((message) => updates(message as Peer)) as Peer;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Peer create() => Peer._();
  @$core.override
  Peer createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Peer getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Peer>(create);
  static Peer? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get peerId => $_getSZ(0);
  @$pb.TagNumber(1)
  set peerId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPeerId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPeerId() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get multiaddrs => $_getList(1);
}

/// Profile: 用户的详细资料
class Profile extends $pb.GeneratedMessage {
  factory Profile({
    $core.String? actorId,
    $core.String? bio,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? fields,
  }) {
    final result = create();
    if (actorId != null) result.actorId = actorId;
    if (bio != null) result.bio = bio;
    if (fields != null) result.fields.addEntries(fields);
    return result;
  }

  Profile._();

  factory Profile.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Profile.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Profile',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.core.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'actorId')
    ..aOS(2, _omitFieldNames ? '' : 'bio')
    ..m<$core.String, $core.String>(3, _omitFieldNames ? '' : 'fields',
        entryClassName: 'Profile.FieldsEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.model.core.v1'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Profile clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Profile copyWith(void Function(Profile) updates) =>
      super.copyWith((message) => updates(message as Profile)) as Profile;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Profile create() => Profile._();
  @$core.override
  Profile createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Profile getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Profile>(create);
  static Profile? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get actorId => $_getSZ(0);
  @$pb.TagNumber(1)
  set actorId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasActorId() => $_has(0);
  @$pb.TagNumber(1)
  void clearActorId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get bio => $_getSZ(1);
  @$pb.TagNumber(2)
  set bio($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasBio() => $_has(1);
  @$pb.TagNumber(2)
  void clearBio() => $_clearField(2);

  @$pb.TagNumber(3)
  $pb.PbMap<$core.String, $core.String> get fields => $_getMap(2);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
