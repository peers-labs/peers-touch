// This is a generated file - do not edit.
//
// Generated from domain/ai_box/provider.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import '../../google/protobuf/timestamp.pb.dart' as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'provider.pbenum.dart';

/// =================================================
/// 1. Provider (Domain Model)
/// 核心领域模型，与数据库结构对齐，是系统内部的权威表示。
/// =================================================
class Provider extends $pb.GeneratedMessage {
  factory Provider({
    $core.String? id,
    $core.String? name,
    $core.String? peersUserId,
    $core.int? sort,
    $core.bool? enabled,
    $core.String? checkModel,
    $core.String? logo,
    $core.String? description,
    $core.String? keyVaults,
    $core.String? sourceType,
    $core.String? settingsJson,
    $core.String? configJson,
    $0.Timestamp? accessedAt,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (name != null) result.name = name;
    if (peersUserId != null) result.peersUserId = peersUserId;
    if (sort != null) result.sort = sort;
    if (enabled != null) result.enabled = enabled;
    if (checkModel != null) result.checkModel = checkModel;
    if (logo != null) result.logo = logo;
    if (description != null) result.description = description;
    if (keyVaults != null) result.keyVaults = keyVaults;
    if (sourceType != null) result.sourceType = sourceType;
    if (settingsJson != null) result.settingsJson = settingsJson;
    if (configJson != null) result.configJson = configJson;
    if (accessedAt != null) result.accessedAt = accessedAt;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  Provider._();

  factory Provider.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Provider.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Provider',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'peersUserId')
    ..aI(4, _omitFieldNames ? '' : 'sort')
    ..aOB(5, _omitFieldNames ? '' : 'enabled')
    ..aOS(6, _omitFieldNames ? '' : 'checkModel')
    ..aOS(7, _omitFieldNames ? '' : 'logo')
    ..aOS(8, _omitFieldNames ? '' : 'description')
    ..aOS(9, _omitFieldNames ? '' : 'keyVaults')
    ..aOS(10, _omitFieldNames ? '' : 'sourceType')
    ..aOS(11, _omitFieldNames ? '' : 'settingsJson')
    ..aOS(12, _omitFieldNames ? '' : 'configJson')
    ..aOM<$0.Timestamp>(13, _omitFieldNames ? '' : 'accessedAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(14, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(15, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Provider clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Provider copyWith(void Function(Provider) updates) =>
      super.copyWith((message) => updates(message as Provider)) as Provider;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Provider create() => Provider._();
  @$core.override
  Provider createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Provider getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Provider>(create);
  static Provider? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
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
  $core.String get peersUserId => $_getSZ(2);
  @$pb.TagNumber(3)
  set peersUserId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPeersUserId() => $_has(2);
  @$pb.TagNumber(3)
  void clearPeersUserId() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get sort => $_getIZ(3);
  @$pb.TagNumber(4)
  set sort($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasSort() => $_has(3);
  @$pb.TagNumber(4)
  void clearSort() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.bool get enabled => $_getBF(4);
  @$pb.TagNumber(5)
  set enabled($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasEnabled() => $_has(4);
  @$pb.TagNumber(5)
  void clearEnabled() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get checkModel => $_getSZ(5);
  @$pb.TagNumber(6)
  set checkModel($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasCheckModel() => $_has(5);
  @$pb.TagNumber(6)
  void clearCheckModel() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get logo => $_getSZ(6);
  @$pb.TagNumber(7)
  set logo($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasLogo() => $_has(6);
  @$pb.TagNumber(7)
  void clearLogo() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get description => $_getSZ(7);
  @$pb.TagNumber(8)
  set description($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasDescription() => $_has(7);
  @$pb.TagNumber(8)
  void clearDescription() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.String get keyVaults => $_getSZ(8);
  @$pb.TagNumber(9)
  set keyVaults($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasKeyVaults() => $_has(8);
  @$pb.TagNumber(9)
  void clearKeyVaults() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.String get sourceType => $_getSZ(9);
  @$pb.TagNumber(10)
  set sourceType($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasSourceType() => $_has(9);
  @$pb.TagNumber(10)
  void clearSourceType() => $_clearField(10);

  @$pb.TagNumber(11)
  $core.String get settingsJson => $_getSZ(10);
  @$pb.TagNumber(11)
  set settingsJson($core.String value) => $_setString(10, value);
  @$pb.TagNumber(11)
  $core.bool hasSettingsJson() => $_has(10);
  @$pb.TagNumber(11)
  void clearSettingsJson() => $_clearField(11);

  @$pb.TagNumber(12)
  $core.String get configJson => $_getSZ(11);
  @$pb.TagNumber(12)
  set configJson($core.String value) => $_setString(11, value);
  @$pb.TagNumber(12)
  $core.bool hasConfigJson() => $_has(11);
  @$pb.TagNumber(12)
  void clearConfigJson() => $_clearField(12);

  @$pb.TagNumber(13)
  $0.Timestamp get accessedAt => $_getN(12);
  @$pb.TagNumber(13)
  set accessedAt($0.Timestamp value) => $_setField(13, value);
  @$pb.TagNumber(13)
  $core.bool hasAccessedAt() => $_has(12);
  @$pb.TagNumber(13)
  void clearAccessedAt() => $_clearField(13);
  @$pb.TagNumber(13)
  $0.Timestamp ensureAccessedAt() => $_ensure(12);

  @$pb.TagNumber(14)
  $0.Timestamp get createdAt => $_getN(13);
  @$pb.TagNumber(14)
  set createdAt($0.Timestamp value) => $_setField(14, value);
  @$pb.TagNumber(14)
  $core.bool hasCreatedAt() => $_has(13);
  @$pb.TagNumber(14)
  void clearCreatedAt() => $_clearField(14);
  @$pb.TagNumber(14)
  $0.Timestamp ensureCreatedAt() => $_ensure(13);

  @$pb.TagNumber(15)
  $0.Timestamp get updatedAt => $_getN(14);
  @$pb.TagNumber(15)
  set updatedAt($0.Timestamp value) => $_setField(15, value);
  @$pb.TagNumber(15)
  $core.bool hasUpdatedAt() => $_has(14);
  @$pb.TagNumber(15)
  void clearUpdatedAt() => $_clearField(15);
  @$pb.TagNumber(15)
  $0.Timestamp ensureUpdatedAt() => $_ensure(14);
}

/// =================================================
/// 2. ProviderView (View Model)
/// 用于UI展示的轻量级模型，仅包含渲染提供商列表或卡片所需的数据。
/// =================================================
class ProviderView extends $pb.GeneratedMessage {
  factory ProviderView({
    $core.String? id,
    $core.String? name,
    $core.String? description,
    $core.String? logo,
    $core.String? sourceType,
    $core.bool? enabled,
    $core.String? displayStatus,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (name != null) result.name = name;
    if (description != null) result.description = description;
    if (logo != null) result.logo = logo;
    if (sourceType != null) result.sourceType = sourceType;
    if (enabled != null) result.enabled = enabled;
    if (displayStatus != null) result.displayStatus = displayStatus;
    return result;
  }

  ProviderView._();

  factory ProviderView.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ProviderView.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ProviderView',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'description')
    ..aOS(4, _omitFieldNames ? '' : 'logo')
    ..aOS(5, _omitFieldNames ? '' : 'sourceType')
    ..aOB(6, _omitFieldNames ? '' : 'enabled')
    ..aOS(7, _omitFieldNames ? '' : 'displayStatus')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProviderView clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProviderView copyWith(void Function(ProviderView) updates) =>
      super.copyWith((message) => updates(message as ProviderView))
          as ProviderView;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ProviderView create() => ProviderView._();
  @$core.override
  ProviderView createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ProviderView getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ProviderView>(create);
  static ProviderView? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
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
  $core.String get description => $_getSZ(2);
  @$pb.TagNumber(3)
  set description($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDescription() => $_has(2);
  @$pb.TagNumber(3)
  void clearDescription() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get logo => $_getSZ(3);
  @$pb.TagNumber(4)
  set logo($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasLogo() => $_has(3);
  @$pb.TagNumber(4)
  void clearLogo() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get sourceType => $_getSZ(4);
  @$pb.TagNumber(5)
  set sourceType($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasSourceType() => $_has(4);
  @$pb.TagNumber(5)
  void clearSourceType() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.bool get enabled => $_getBF(5);
  @$pb.TagNumber(6)
  set enabled($core.bool value) => $_setBool(5, value);
  @$pb.TagNumber(6)
  $core.bool hasEnabled() => $_has(5);
  @$pb.TagNumber(6)
  void clearEnabled() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get displayStatus => $_getSZ(6);
  @$pb.TagNumber(7)
  set displayStatus($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasDisplayStatus() => $_has(6);
  @$pb.TagNumber(7)
  void clearDisplayStatus() => $_clearField(7);
}

/// =================================================
/// 3. ProviderInfo (API Model / DTO)
/// 用于客户端-服务端通信，隐藏了敏感信息和内部状态。
/// =================================================
class ProviderInfo extends $pb.GeneratedMessage {
  factory ProviderInfo({
    $core.String? id,
    $core.String? name,
    $core.String? description,
    $core.String? logo,
    $core.String? sourceType,
    $core.bool? enabled,
    $core.String? schemaJson,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (name != null) result.name = name;
    if (description != null) result.description = description;
    if (logo != null) result.logo = logo;
    if (sourceType != null) result.sourceType = sourceType;
    if (enabled != null) result.enabled = enabled;
    if (schemaJson != null) result.schemaJson = schemaJson;
    return result;
  }

  ProviderInfo._();

  factory ProviderInfo.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ProviderInfo.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ProviderInfo',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'description')
    ..aOS(4, _omitFieldNames ? '' : 'logo')
    ..aOS(5, _omitFieldNames ? '' : 'sourceType')
    ..aOB(6, _omitFieldNames ? '' : 'enabled')
    ..aOS(7, _omitFieldNames ? '' : 'schemaJson')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProviderInfo clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProviderInfo copyWith(void Function(ProviderInfo) updates) =>
      super.copyWith((message) => updates(message as ProviderInfo))
          as ProviderInfo;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ProviderInfo create() => ProviderInfo._();
  @$core.override
  ProviderInfo createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ProviderInfo getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ProviderInfo>(create);
  static ProviderInfo? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
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
  $core.String get description => $_getSZ(2);
  @$pb.TagNumber(3)
  set description($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDescription() => $_has(2);
  @$pb.TagNumber(3)
  void clearDescription() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get logo => $_getSZ(3);
  @$pb.TagNumber(4)
  set logo($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasLogo() => $_has(3);
  @$pb.TagNumber(4)
  void clearLogo() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get sourceType => $_getSZ(4);
  @$pb.TagNumber(5)
  set sourceType($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasSourceType() => $_has(4);
  @$pb.TagNumber(5)
  void clearSourceType() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.bool get enabled => $_getBF(5);
  @$pb.TagNumber(6)
  set enabled($core.bool value) => $_setBool(5, value);
  @$pb.TagNumber(6)
  $core.bool hasEnabled() => $_has(5);
  @$pb.TagNumber(6)
  void clearEnabled() => $_clearField(6);

  /// 提供给客户端用于动态生成配置表单的JSON Schema
  @$pb.TagNumber(7)
  $core.String get schemaJson => $_getSZ(6);
  @$pb.TagNumber(7)
  set schemaJson($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasSchemaJson() => $_has(6);
  @$pb.TagNumber(7)
  void clearSchemaJson() => $_clearField(7);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
