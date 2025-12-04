// This is a generated file - do not edit.
//
// Generated from domain/actor/actor_register.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

/// ActorSignRequest: 用于注册 Actor 的最小必要参数
class ActorSignRequest extends $pb.GeneratedMessage {
  factory ActorSignRequest({
    $core.String? name,
    $core.String? email,
    $core.String? password,
    $core.String? namespace,
    $core.String? accountType,
  }) {
    final result = create();
    if (name != null) result.name = name;
    if (email != null) result.email = email;
    if (password != null) result.password = password;
    if (namespace != null) result.namespace = namespace;
    if (accountType != null) result.accountType = accountType;
    return result;
  }

  ActorSignRequest._();

  factory ActorSignRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ActorSignRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ActorSignRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.actor.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'name')
    ..aOS(2, _omitFieldNames ? '' : 'email')
    ..aOS(3, _omitFieldNames ? '' : 'password')
    ..aOS(10, _omitFieldNames ? '' : 'namespace')
    ..aOS(11, _omitFieldNames ? '' : 'accountType')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorSignRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorSignRequest copyWith(void Function(ActorSignRequest) updates) =>
      super.copyWith((message) => updates(message as ActorSignRequest))
          as ActorSignRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ActorSignRequest create() => ActorSignRequest._();
  @$core.override
  ActorSignRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ActorSignRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ActorSignRequest>(create);
  static ActorSignRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get name => $_getSZ(0);
  @$pb.TagNumber(1)
  set name($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasName() => $_has(0);
  @$pb.TagNumber(1)
  void clearName() => $_clearField(1);

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

  /// 可选扩展
  @$pb.TagNumber(10)
  $core.String get namespace => $_getSZ(3);
  @$pb.TagNumber(10)
  set namespace($core.String value) => $_setString(3, value);
  @$pb.TagNumber(10)
  $core.bool hasNamespace() => $_has(3);
  @$pb.TagNumber(10)
  void clearNamespace() => $_clearField(10);

  @$pb.TagNumber(11)
  $core.String get accountType => $_getSZ(4);
  @$pb.TagNumber(11)
  set accountType($core.String value) => $_setString(4, value);
  @$pb.TagNumber(11)
  $core.bool hasAccountType() => $_has(4);
  @$pb.TagNumber(11)
  void clearAccountType() => $_clearField(11);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
