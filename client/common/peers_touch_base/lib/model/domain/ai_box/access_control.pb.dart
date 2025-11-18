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

/// 访问控制
class AccessControl extends $pb.GeneratedMessage {
  factory AccessControl({
    $core.String? id,
    $core.String? userId,
    $core.String? providerId,
    $core.String? modelName,
    $core.bool? allowed,
    $fixnum.Int64? createdAt,
    $fixnum.Int64? updatedAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (userId != null) result.userId = userId;
    if (providerId != null) result.providerId = providerId;
    if (modelName != null) result.modelName = modelName;
    if (allowed != null) result.allowed = allowed;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
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
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'userId')
    ..aOS(3, _omitFieldNames ? '' : 'providerId')
    ..aOS(4, _omitFieldNames ? '' : 'modelName')
    ..aOB(5, _omitFieldNames ? '' : 'allowed')
    ..aInt64(6, _omitFieldNames ? '' : 'createdAt')
    ..aInt64(7, _omitFieldNames ? '' : 'updatedAt')
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
  $core.String get providerId => $_getSZ(2);
  @$pb.TagNumber(3)
  set providerId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasProviderId() => $_has(2);
  @$pb.TagNumber(3)
  void clearProviderId() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get modelName => $_getSZ(3);
  @$pb.TagNumber(4)
  set modelName($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasModelName() => $_has(3);
  @$pb.TagNumber(4)
  void clearModelName() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.bool get allowed => $_getBF(4);
  @$pb.TagNumber(5)
  set allowed($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasAllowed() => $_has(4);
  @$pb.TagNumber(5)
  void clearAllowed() => $_clearField(5);

  @$pb.TagNumber(6)
  $fixnum.Int64 get createdAt => $_getI64(5);
  @$pb.TagNumber(6)
  set createdAt($fixnum.Int64 value) => $_setInt64(5, value);
  @$pb.TagNumber(6)
  $core.bool hasCreatedAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearCreatedAt() => $_clearField(6);

  @$pb.TagNumber(7)
  $fixnum.Int64 get updatedAt => $_getI64(6);
  @$pb.TagNumber(7)
  set updatedAt($fixnum.Int64 value) => $_setInt64(6, value);
  @$pb.TagNumber(7)
  $core.bool hasUpdatedAt() => $_has(6);
  @$pb.TagNumber(7)
  void clearUpdatedAt() => $_clearField(7);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
