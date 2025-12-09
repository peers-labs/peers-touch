// This is a generated file - do not edit.
//
// Generated from domain/mastodon/account.proto.

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

class MastodonAccount extends $pb.GeneratedMessage {
  factory MastodonAccount({
    $core.String? id,
    $core.String? username,
    $core.String? acct,
    $core.String? displayName,
    $core.String? note,
    $core.String? avatar,
    $core.String? header,
    $fixnum.Int64? followersCount,
    $fixnum.Int64? followingCount,
    $fixnum.Int64? statusesCount,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (username != null) result.username = username;
    if (acct != null) result.acct = acct;
    if (displayName != null) result.displayName = displayName;
    if (note != null) result.note = note;
    if (avatar != null) result.avatar = avatar;
    if (header != null) result.header = header;
    if (followersCount != null) result.followersCount = followersCount;
    if (followingCount != null) result.followingCount = followingCount;
    if (statusesCount != null) result.statusesCount = statusesCount;
    return result;
  }

  MastodonAccount._();

  factory MastodonAccount.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MastodonAccount.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MastodonAccount',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.mastodon.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'username')
    ..aOS(3, _omitFieldNames ? '' : 'acct')
    ..aOS(4, _omitFieldNames ? '' : 'displayName')
    ..aOS(5, _omitFieldNames ? '' : 'note')
    ..aOS(6, _omitFieldNames ? '' : 'avatar')
    ..aOS(7, _omitFieldNames ? '' : 'header')
    ..aInt64(8, _omitFieldNames ? '' : 'followersCount')
    ..aInt64(9, _omitFieldNames ? '' : 'followingCount')
    ..aInt64(10, _omitFieldNames ? '' : 'statusesCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastodonAccount clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastodonAccount copyWith(void Function(MastodonAccount) updates) =>
      super.copyWith((message) => updates(message as MastodonAccount))
          as MastodonAccount;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MastodonAccount create() => MastodonAccount._();
  @$core.override
  MastodonAccount createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MastodonAccount getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MastodonAccount>(create);
  static MastodonAccount? _defaultInstance;

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
  $core.String get acct => $_getSZ(2);
  @$pb.TagNumber(3)
  set acct($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasAcct() => $_has(2);
  @$pb.TagNumber(3)
  void clearAcct() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get displayName => $_getSZ(3);
  @$pb.TagNumber(4)
  set displayName($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasDisplayName() => $_has(3);
  @$pb.TagNumber(4)
  void clearDisplayName() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get note => $_getSZ(4);
  @$pb.TagNumber(5)
  set note($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasNote() => $_has(4);
  @$pb.TagNumber(5)
  void clearNote() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get avatar => $_getSZ(5);
  @$pb.TagNumber(6)
  set avatar($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasAvatar() => $_has(5);
  @$pb.TagNumber(6)
  void clearAvatar() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get header => $_getSZ(6);
  @$pb.TagNumber(7)
  set header($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasHeader() => $_has(6);
  @$pb.TagNumber(7)
  void clearHeader() => $_clearField(7);

  @$pb.TagNumber(8)
  $fixnum.Int64 get followersCount => $_getI64(7);
  @$pb.TagNumber(8)
  set followersCount($fixnum.Int64 value) => $_setInt64(7, value);
  @$pb.TagNumber(8)
  $core.bool hasFollowersCount() => $_has(7);
  @$pb.TagNumber(8)
  void clearFollowersCount() => $_clearField(8);

  @$pb.TagNumber(9)
  $fixnum.Int64 get followingCount => $_getI64(8);
  @$pb.TagNumber(9)
  set followingCount($fixnum.Int64 value) => $_setInt64(8, value);
  @$pb.TagNumber(9)
  $core.bool hasFollowingCount() => $_has(8);
  @$pb.TagNumber(9)
  void clearFollowingCount() => $_clearField(9);

  @$pb.TagNumber(10)
  $fixnum.Int64 get statusesCount => $_getI64(9);
  @$pb.TagNumber(10)
  set statusesCount($fixnum.Int64 value) => $_setInt64(9, value);
  @$pb.TagNumber(10)
  $core.bool hasStatusesCount() => $_has(9);
  @$pb.TagNumber(10)
  void clearStatusesCount() => $_clearField(10);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
