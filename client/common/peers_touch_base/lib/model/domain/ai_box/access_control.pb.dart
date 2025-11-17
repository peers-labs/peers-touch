// This is a generated file - do not edit.
//
// Generated from domain/ai_box/access_control.proto.

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

class AccessControl extends $pb.GeneratedMessage {
  factory AccessControl({
    $core.String? userId,
    $core.Iterable<$core.String>? roles,
    $core.Iterable<$core.MapEntry<$core.String, $core.bool>>? permissions,
    $fixnum.Int64? grantedAt,
    $fixnum.Int64? expiresAt,
  }) {
    final result = create();
    if (userId != null) result.userId = userId;
    if (roles != null) result.roles.addAll(roles);
    if (permissions != null) result.permissions.addEntries(permissions);
    if (grantedAt != null) result.grantedAt = grantedAt;
    if (expiresAt != null) result.expiresAt = expiresAt;
    return result;
  }

  AccessControl._();

  factory AccessControl.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory AccessControl.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AccessControl',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'userId')
    ..pPS(2, _omitFieldNames ? '' : 'roles')
    ..m<$core.String, $core.bool>(3, _omitFieldNames ? '' : 'permissions',
        entryClassName: 'AccessControl.PermissionsEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OB,
        packageName: const $pb.PackageName('peers_touch.model.ai_box.v1'))
    ..aInt64(4, _omitFieldNames ? '' : 'grantedAt')
    ..aInt64(5, _omitFieldNames ? '' : 'expiresAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AccessControl clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AccessControl copyWith(void Function(AccessControl) updates) =>
      super.copyWith((message) => updates(message as AccessControl))
          as AccessControl;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AccessControl create() => AccessControl._();
  @$core.override
  AccessControl createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static AccessControl getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AccessControl>(create);
  static AccessControl? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get userId => $_getSZ(0);
  @$pb.TagNumber(1)
  set userId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUserId() => $_has(0);
  @$pb.TagNumber(1)
  void clearUserId() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get roles => $_getList(1);

  @$pb.TagNumber(3)
  $pb.PbMap<$core.String, $core.bool> get permissions => $_getMap(2);

  @$pb.TagNumber(4)
  $fixnum.Int64 get grantedAt => $_getI64(3);
  @$pb.TagNumber(4)
  set grantedAt($fixnum.Int64 value) => $_setInt64(3, value);
  @$pb.TagNumber(4)
  $core.bool hasGrantedAt() => $_has(3);
  @$pb.TagNumber(4)
  void clearGrantedAt() => $_clearField(4);

  @$pb.TagNumber(5)
  $fixnum.Int64 get expiresAt => $_getI64(4);
  @$pb.TagNumber(5)
  set expiresAt($fixnum.Int64 value) => $_setInt64(4, value);
  @$pb.TagNumber(5)
  $core.bool hasExpiresAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearExpiresAt() => $_clearField(5);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
