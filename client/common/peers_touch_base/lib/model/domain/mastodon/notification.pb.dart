// This is a generated file - do not edit.
//
// Generated from domain/mastodon/notification.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import '../../google/protobuf/timestamp.pb.dart' as $0;
import 'account.pb.dart' as $1;
import 'status.pb.dart' as $2;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class MastodonNotification extends $pb.GeneratedMessage {
  factory MastodonNotification({
    $core.String? id,
    $core.String? type,
    $0.Timestamp? createdAt,
    $1.MastodonAccount? account,
    $2.MastodonStatus? status,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (type != null) result.type = type;
    if (createdAt != null) result.createdAt = createdAt;
    if (account != null) result.account = account;
    if (status != null) result.status = status;
    return result;
  }

  MastodonNotification._();

  factory MastodonNotification.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MastodonNotification.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MastodonNotification',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.mastodon.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'type')
    ..aOM<$0.Timestamp>(3, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$1.MastodonAccount>(4, _omitFieldNames ? '' : 'account',
        subBuilder: $1.MastodonAccount.create)
    ..aOM<$2.MastodonStatus>(5, _omitFieldNames ? '' : 'status',
        subBuilder: $2.MastodonStatus.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastodonNotification clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastodonNotification copyWith(void Function(MastodonNotification) updates) =>
      super.copyWith((message) => updates(message as MastodonNotification))
          as MastodonNotification;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MastodonNotification create() => MastodonNotification._();
  @$core.override
  MastodonNotification createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MastodonNotification getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MastodonNotification>(create);
  static MastodonNotification? _defaultInstance;

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
  $0.Timestamp get createdAt => $_getN(2);
  @$pb.TagNumber(3)
  set createdAt($0.Timestamp value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasCreatedAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearCreatedAt() => $_clearField(3);
  @$pb.TagNumber(3)
  $0.Timestamp ensureCreatedAt() => $_ensure(2);

  @$pb.TagNumber(4)
  $1.MastodonAccount get account => $_getN(3);
  @$pb.TagNumber(4)
  set account($1.MastodonAccount value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasAccount() => $_has(3);
  @$pb.TagNumber(4)
  void clearAccount() => $_clearField(4);
  @$pb.TagNumber(4)
  $1.MastodonAccount ensureAccount() => $_ensure(3);

  @$pb.TagNumber(5)
  $2.MastodonStatus get status => $_getN(4);
  @$pb.TagNumber(5)
  set status($2.MastodonStatus value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasStatus() => $_has(4);
  @$pb.TagNumber(5)
  void clearStatus() => $_clearField(5);
  @$pb.TagNumber(5)
  $2.MastodonStatus ensureStatus() => $_ensure(4);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
