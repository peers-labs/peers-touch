// This is a generated file - do not edit.
//
// Generated from domain/actor/actor.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class Actor extends $pb.GeneratedMessage {
  factory Actor({
    $core.String? id,
    $core.String? username,
    $core.String? displayName,
    $core.String? email,
    $core.String? inbox,
    $core.String? outbox,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? endpoints,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (username != null) result.username = username;
    if (displayName != null) result.displayName = displayName;
    if (email != null) result.email = email;
    if (inbox != null) result.inbox = inbox;
    if (outbox != null) result.outbox = outbox;
    if (endpoints != null) result.endpoints.addEntries(endpoints);
    return result;
  }

  Actor._();

  factory Actor.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Actor.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Actor',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.actor.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'username')
    ..aOS(3, _omitFieldNames ? '' : 'displayName')
    ..aOS(4, _omitFieldNames ? '' : 'email')
    ..aOS(5, _omitFieldNames ? '' : 'inbox')
    ..aOS(6, _omitFieldNames ? '' : 'outbox')
    ..m<$core.String, $core.String>(7, _omitFieldNames ? '' : 'endpoints',
        entryClassName: 'Actor.EndpointsEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.model.actor.v1'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Actor clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Actor copyWith(void Function(Actor) updates) =>
      super.copyWith((message) => updates(message as Actor)) as Actor;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Actor create() => Actor._();
  @$core.override
  Actor createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Actor getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Actor>(create);
  static Actor? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

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
  $core.String get email => $_getSZ(3);
  @$pb.TagNumber(4)
  set email($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasEmail() => $_has(3);
  @$pb.TagNumber(4)
  void clearEmail() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get inbox => $_getSZ(4);
  @$pb.TagNumber(5)
  set inbox($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasInbox() => $_has(4);
  @$pb.TagNumber(5)
  void clearInbox() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get outbox => $_getSZ(5);
  @$pb.TagNumber(6)
  set outbox($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasOutbox() => $_has(5);
  @$pb.TagNumber(6)
  void clearOutbox() => $_clearField(6);

  @$pb.TagNumber(7)
  $pb.PbMap<$core.String, $core.String> get endpoints => $_getMap(6);
}

class ActorList extends $pb.GeneratedMessage {
  factory ActorList({
    $core.Iterable<Actor>? items,
    $fixnum.Int64? total,
  }) {
    final result = create();
    if (items != null) result.items.addAll(items);
    if (total != null) result.total = total;
    return result;
  }

  ActorList._();

  factory ActorList.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ActorList.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ActorList',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.actor.v1'),
      createEmptyInstance: create)
    ..pPM<Actor>(1, _omitFieldNames ? '' : 'items', subBuilder: Actor.create)
    ..aInt64(2, _omitFieldNames ? '' : 'total')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorList clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorList copyWith(void Function(ActorList) updates) =>
      super.copyWith((message) => updates(message as ActorList)) as ActorList;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ActorList create() => ActorList._();
  @$core.override
  ActorList createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ActorList getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<ActorList>(create);
  static ActorList? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Actor> get items => $_getList(0);

  @$pb.TagNumber(2)
  $fixnum.Int64 get total => $_getI64(1);
  @$pb.TagNumber(2)
  set total($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTotal() => $_has(1);
  @$pb.TagNumber(2)
  void clearTotal() => $_clearField(2);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
