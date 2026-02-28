// This is a generated file - do not edit.
//
// Generated from domain/ai_box/provider.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart'
    as $0;

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

  @$pb.TagNumber(7)
  $core.String get schemaJson => $_getSZ(6);
  @$pb.TagNumber(7)
  set schemaJson($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasSchemaJson() => $_has(6);
  @$pb.TagNumber(7)
  void clearSchemaJson() => $_clearField(7);
}

class CreateProviderRequest extends $pb.GeneratedMessage {
  factory CreateProviderRequest({
    $core.String? name,
    $core.String? description,
    $core.String? logo,
    $core.String? keyVaults,
    $core.String? settingsJson,
    $core.String? configJson,
  }) {
    final result = create();
    if (name != null) result.name = name;
    if (description != null) result.description = description;
    if (logo != null) result.logo = logo;
    if (keyVaults != null) result.keyVaults = keyVaults;
    if (settingsJson != null) result.settingsJson = settingsJson;
    if (configJson != null) result.configJson = configJson;
    return result;
  }

  CreateProviderRequest._();

  factory CreateProviderRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateProviderRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateProviderRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'name')
    ..aOS(2, _omitFieldNames ? '' : 'description')
    ..aOS(3, _omitFieldNames ? '' : 'logo')
    ..aOS(4, _omitFieldNames ? '' : 'keyVaults')
    ..aOS(5, _omitFieldNames ? '' : 'settingsJson')
    ..aOS(6, _omitFieldNames ? '' : 'configJson')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateProviderRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateProviderRequest copyWith(
          void Function(CreateProviderRequest) updates) =>
      super.copyWith((message) => updates(message as CreateProviderRequest))
          as CreateProviderRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateProviderRequest create() => CreateProviderRequest._();
  @$core.override
  CreateProviderRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateProviderRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateProviderRequest>(create);
  static CreateProviderRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get name => $_getSZ(0);
  @$pb.TagNumber(1)
  set name($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasName() => $_has(0);
  @$pb.TagNumber(1)
  void clearName() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get description => $_getSZ(1);
  @$pb.TagNumber(2)
  set description($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasDescription() => $_has(1);
  @$pb.TagNumber(2)
  void clearDescription() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get logo => $_getSZ(2);
  @$pb.TagNumber(3)
  set logo($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLogo() => $_has(2);
  @$pb.TagNumber(3)
  void clearLogo() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get keyVaults => $_getSZ(3);
  @$pb.TagNumber(4)
  set keyVaults($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasKeyVaults() => $_has(3);
  @$pb.TagNumber(4)
  void clearKeyVaults() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get settingsJson => $_getSZ(4);
  @$pb.TagNumber(5)
  set settingsJson($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasSettingsJson() => $_has(4);
  @$pb.TagNumber(5)
  void clearSettingsJson() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get configJson => $_getSZ(5);
  @$pb.TagNumber(6)
  set configJson($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasConfigJson() => $_has(5);
  @$pb.TagNumber(6)
  void clearConfigJson() => $_clearField(6);
}

class CreateProviderResponse extends $pb.GeneratedMessage {
  factory CreateProviderResponse({
    Provider? provider,
  }) {
    final result = create();
    if (provider != null) result.provider = provider;
    return result;
  }

  CreateProviderResponse._();

  factory CreateProviderResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateProviderResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateProviderResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOM<Provider>(1, _omitFieldNames ? '' : 'provider',
        subBuilder: Provider.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateProviderResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateProviderResponse copyWith(
          void Function(CreateProviderResponse) updates) =>
      super.copyWith((message) => updates(message as CreateProviderResponse))
          as CreateProviderResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateProviderResponse create() => CreateProviderResponse._();
  @$core.override
  CreateProviderResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateProviderResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateProviderResponse>(create);
  static CreateProviderResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Provider get provider => $_getN(0);
  @$pb.TagNumber(1)
  set provider(Provider value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasProvider() => $_has(0);
  @$pb.TagNumber(1)
  void clearProvider() => $_clearField(1);
  @$pb.TagNumber(1)
  Provider ensureProvider() => $_ensure(0);
}

class UpdateProviderRequest extends $pb.GeneratedMessage {
  factory UpdateProviderRequest({
    $core.String? id,
    $core.String? name,
    $core.String? description,
    $core.String? logo,
    $core.bool? enabled,
    $core.String? keyVaults,
    $core.String? settingsJson,
    $core.String? configJson,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (name != null) result.name = name;
    if (description != null) result.description = description;
    if (logo != null) result.logo = logo;
    if (enabled != null) result.enabled = enabled;
    if (keyVaults != null) result.keyVaults = keyVaults;
    if (settingsJson != null) result.settingsJson = settingsJson;
    if (configJson != null) result.configJson = configJson;
    return result;
  }

  UpdateProviderRequest._();

  factory UpdateProviderRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateProviderRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateProviderRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'description')
    ..aOS(4, _omitFieldNames ? '' : 'logo')
    ..aOB(5, _omitFieldNames ? '' : 'enabled')
    ..aOS(6, _omitFieldNames ? '' : 'keyVaults')
    ..aOS(7, _omitFieldNames ? '' : 'settingsJson')
    ..aOS(8, _omitFieldNames ? '' : 'configJson')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateProviderRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateProviderRequest copyWith(
          void Function(UpdateProviderRequest) updates) =>
      super.copyWith((message) => updates(message as UpdateProviderRequest))
          as UpdateProviderRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateProviderRequest create() => UpdateProviderRequest._();
  @$core.override
  UpdateProviderRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateProviderRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateProviderRequest>(create);
  static UpdateProviderRequest? _defaultInstance;

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
  $core.bool get enabled => $_getBF(4);
  @$pb.TagNumber(5)
  set enabled($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasEnabled() => $_has(4);
  @$pb.TagNumber(5)
  void clearEnabled() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get keyVaults => $_getSZ(5);
  @$pb.TagNumber(6)
  set keyVaults($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasKeyVaults() => $_has(5);
  @$pb.TagNumber(6)
  void clearKeyVaults() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get settingsJson => $_getSZ(6);
  @$pb.TagNumber(7)
  set settingsJson($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasSettingsJson() => $_has(6);
  @$pb.TagNumber(7)
  void clearSettingsJson() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get configJson => $_getSZ(7);
  @$pb.TagNumber(8)
  set configJson($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasConfigJson() => $_has(7);
  @$pb.TagNumber(8)
  void clearConfigJson() => $_clearField(8);
}

class UpdateProviderResponse extends $pb.GeneratedMessage {
  factory UpdateProviderResponse({
    Provider? provider,
  }) {
    final result = create();
    if (provider != null) result.provider = provider;
    return result;
  }

  UpdateProviderResponse._();

  factory UpdateProviderResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateProviderResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateProviderResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOM<Provider>(1, _omitFieldNames ? '' : 'provider',
        subBuilder: Provider.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateProviderResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateProviderResponse copyWith(
          void Function(UpdateProviderResponse) updates) =>
      super.copyWith((message) => updates(message as UpdateProviderResponse))
          as UpdateProviderResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateProviderResponse create() => UpdateProviderResponse._();
  @$core.override
  UpdateProviderResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateProviderResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateProviderResponse>(create);
  static UpdateProviderResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Provider get provider => $_getN(0);
  @$pb.TagNumber(1)
  set provider(Provider value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasProvider() => $_has(0);
  @$pb.TagNumber(1)
  void clearProvider() => $_clearField(1);
  @$pb.TagNumber(1)
  Provider ensureProvider() => $_ensure(0);
}

class DeleteProviderRequest extends $pb.GeneratedMessage {
  factory DeleteProviderRequest({
    $core.String? id,
  }) {
    final result = create();
    if (id != null) result.id = id;
    return result;
  }

  DeleteProviderRequest._();

  factory DeleteProviderRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory DeleteProviderRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeleteProviderRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteProviderRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteProviderRequest copyWith(
          void Function(DeleteProviderRequest) updates) =>
      super.copyWith((message) => updates(message as DeleteProviderRequest))
          as DeleteProviderRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static DeleteProviderRequest create() => DeleteProviderRequest._();
  @$core.override
  DeleteProviderRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static DeleteProviderRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeleteProviderRequest>(create);
  static DeleteProviderRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);
}

class DeleteProviderResponse extends $pb.GeneratedMessage {
  factory DeleteProviderResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  DeleteProviderResponse._();

  factory DeleteProviderResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory DeleteProviderResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeleteProviderResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteProviderResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteProviderResponse copyWith(
          void Function(DeleteProviderResponse) updates) =>
      super.copyWith((message) => updates(message as DeleteProviderResponse))
          as DeleteProviderResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static DeleteProviderResponse create() => DeleteProviderResponse._();
  @$core.override
  DeleteProviderResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static DeleteProviderResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeleteProviderResponse>(create);
  static DeleteProviderResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

class GetProviderRequest extends $pb.GeneratedMessage {
  factory GetProviderRequest({
    $core.String? id,
  }) {
    final result = create();
    if (id != null) result.id = id;
    return result;
  }

  GetProviderRequest._();

  factory GetProviderRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetProviderRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetProviderRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetProviderRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetProviderRequest copyWith(void Function(GetProviderRequest) updates) =>
      super.copyWith((message) => updates(message as GetProviderRequest))
          as GetProviderRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetProviderRequest create() => GetProviderRequest._();
  @$core.override
  GetProviderRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetProviderRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetProviderRequest>(create);
  static GetProviderRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);
}

class GetProviderResponse extends $pb.GeneratedMessage {
  factory GetProviderResponse({
    Provider? provider,
  }) {
    final result = create();
    if (provider != null) result.provider = provider;
    return result;
  }

  GetProviderResponse._();

  factory GetProviderResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetProviderResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetProviderResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOM<Provider>(1, _omitFieldNames ? '' : 'provider',
        subBuilder: Provider.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetProviderResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetProviderResponse copyWith(void Function(GetProviderResponse) updates) =>
      super.copyWith((message) => updates(message as GetProviderResponse))
          as GetProviderResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetProviderResponse create() => GetProviderResponse._();
  @$core.override
  GetProviderResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetProviderResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetProviderResponse>(create);
  static GetProviderResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Provider get provider => $_getN(0);
  @$pb.TagNumber(1)
  set provider(Provider value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasProvider() => $_has(0);
  @$pb.TagNumber(1)
  void clearProvider() => $_clearField(1);
  @$pb.TagNumber(1)
  Provider ensureProvider() => $_ensure(0);
}

class ListProvidersRequest extends $pb.GeneratedMessage {
  factory ListProvidersRequest({
    $core.int? pageNumber,
    $core.int? pageSize,
    $core.bool? enabledOnly,
  }) {
    final result = create();
    if (pageNumber != null) result.pageNumber = pageNumber;
    if (pageSize != null) result.pageSize = pageSize;
    if (enabledOnly != null) result.enabledOnly = enabledOnly;
    return result;
  }

  ListProvidersRequest._();

  factory ListProvidersRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListProvidersRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListProvidersRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'pageNumber')
    ..aI(2, _omitFieldNames ? '' : 'pageSize')
    ..aOB(3, _omitFieldNames ? '' : 'enabledOnly')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListProvidersRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListProvidersRequest copyWith(void Function(ListProvidersRequest) updates) =>
      super.copyWith((message) => updates(message as ListProvidersRequest))
          as ListProvidersRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListProvidersRequest create() => ListProvidersRequest._();
  @$core.override
  ListProvidersRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListProvidersRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListProvidersRequest>(create);
  static ListProvidersRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get pageNumber => $_getIZ(0);
  @$pb.TagNumber(1)
  set pageNumber($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPageNumber() => $_has(0);
  @$pb.TagNumber(1)
  void clearPageNumber() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get pageSize => $_getIZ(1);
  @$pb.TagNumber(2)
  set pageSize($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPageSize() => $_has(1);
  @$pb.TagNumber(2)
  void clearPageSize() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.bool get enabledOnly => $_getBF(2);
  @$pb.TagNumber(3)
  set enabledOnly($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasEnabledOnly() => $_has(2);
  @$pb.TagNumber(3)
  void clearEnabledOnly() => $_clearField(3);
}

class ListProvidersResponse extends $pb.GeneratedMessage {
  factory ListProvidersResponse({
    $core.Iterable<Provider>? providers,
    $fixnum.Int64? total,
    $core.int? pageNumber,
    $core.int? pageSize,
  }) {
    final result = create();
    if (providers != null) result.providers.addAll(providers);
    if (total != null) result.total = total;
    if (pageNumber != null) result.pageNumber = pageNumber;
    if (pageSize != null) result.pageSize = pageSize;
    return result;
  }

  ListProvidersResponse._();

  factory ListProvidersResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListProvidersResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListProvidersResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..pPM<Provider>(1, _omitFieldNames ? '' : 'providers',
        subBuilder: Provider.create)
    ..aInt64(2, _omitFieldNames ? '' : 'total')
    ..aI(3, _omitFieldNames ? '' : 'pageNumber')
    ..aI(4, _omitFieldNames ? '' : 'pageSize')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListProvidersResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListProvidersResponse copyWith(
          void Function(ListProvidersResponse) updates) =>
      super.copyWith((message) => updates(message as ListProvidersResponse))
          as ListProvidersResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListProvidersResponse create() => ListProvidersResponse._();
  @$core.override
  ListProvidersResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListProvidersResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListProvidersResponse>(create);
  static ListProvidersResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Provider> get providers => $_getList(0);

  @$pb.TagNumber(2)
  $fixnum.Int64 get total => $_getI64(1);
  @$pb.TagNumber(2)
  set total($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTotal() => $_has(1);
  @$pb.TagNumber(2)
  void clearTotal() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get pageNumber => $_getIZ(2);
  @$pb.TagNumber(3)
  set pageNumber($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPageNumber() => $_has(2);
  @$pb.TagNumber(3)
  void clearPageNumber() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get pageSize => $_getIZ(3);
  @$pb.TagNumber(4)
  set pageSize($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasPageSize() => $_has(3);
  @$pb.TagNumber(4)
  void clearPageSize() => $_clearField(4);
}

class TestProviderRequest extends $pb.GeneratedMessage {
  factory TestProviderRequest({
    $core.String? id,
  }) {
    final result = create();
    if (id != null) result.id = id;
    return result;
  }

  TestProviderRequest._();

  factory TestProviderRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory TestProviderRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TestProviderRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TestProviderRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TestProviderRequest copyWith(void Function(TestProviderRequest) updates) =>
      super.copyWith((message) => updates(message as TestProviderRequest))
          as TestProviderRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static TestProviderRequest create() => TestProviderRequest._();
  @$core.override
  TestProviderRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static TestProviderRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<TestProviderRequest>(create);
  static TestProviderRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);
}

class TestProviderResponse extends $pb.GeneratedMessage {
  factory TestProviderResponse({
    $core.bool? ok,
    $core.String? message,
  }) {
    final result = create();
    if (ok != null) result.ok = ok;
    if (message != null) result.message = message;
    return result;
  }

  TestProviderResponse._();

  factory TestProviderResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory TestProviderResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TestProviderResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'ok')
    ..aOS(2, _omitFieldNames ? '' : 'message')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TestProviderResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TestProviderResponse copyWith(void Function(TestProviderResponse) updates) =>
      super.copyWith((message) => updates(message as TestProviderResponse))
          as TestProviderResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static TestProviderResponse create() => TestProviderResponse._();
  @$core.override
  TestProviderResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static TestProviderResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<TestProviderResponse>(create);
  static TestProviderResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get ok => $_getBF(0);
  @$pb.TagNumber(1)
  set ok($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasOk() => $_has(0);
  @$pb.TagNumber(1)
  void clearOk() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get message => $_getSZ(1);
  @$pb.TagNumber(2)
  set message($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasMessage() => $_has(1);
  @$pb.TagNumber(2)
  void clearMessage() => $_clearField(2);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
