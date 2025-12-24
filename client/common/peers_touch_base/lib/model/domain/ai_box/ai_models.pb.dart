// This is a generated file - do not edit.
//
// Generated from domain/ai_box/ai_models.proto.

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

/// =================================================
/// 1. AiModel (Domain Model)
/// 核心领域模型，与数据库 ai_models 表结构对齐。
/// =================================================
class AiModel extends $pb.GeneratedMessage {
  factory AiModel({
    $core.String? id,
    $core.String? displayName,
    $core.String? description,
    $core.String? organization,
    $core.bool? enabled,
    $core.String? providerId,
    $core.String? type,
    $core.int? sort,
    $core.String? userId,
    $core.String? pricingJson,
    $core.String? parametersJson,
    $core.String? configJson,
    $core.String? abilitiesJson,
    $core.int? contextWindowTokens,
    $core.String? source,
    $core.String? releasedAt,
    $0.Timestamp? accessedAt,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (displayName != null) result.displayName = displayName;
    if (description != null) result.description = description;
    if (organization != null) result.organization = organization;
    if (enabled != null) result.enabled = enabled;
    if (providerId != null) result.providerId = providerId;
    if (type != null) result.type = type;
    if (sort != null) result.sort = sort;
    if (userId != null) result.userId = userId;
    if (pricingJson != null) result.pricingJson = pricingJson;
    if (parametersJson != null) result.parametersJson = parametersJson;
    if (configJson != null) result.configJson = configJson;
    if (abilitiesJson != null) result.abilitiesJson = abilitiesJson;
    if (contextWindowTokens != null)
      result.contextWindowTokens = contextWindowTokens;
    if (source != null) result.source = source;
    if (releasedAt != null) result.releasedAt = releasedAt;
    if (accessedAt != null) result.accessedAt = accessedAt;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  AiModel._();

  factory AiModel.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory AiModel.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AiModel',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'displayName')
    ..aOS(3, _omitFieldNames ? '' : 'description')
    ..aOS(4, _omitFieldNames ? '' : 'organization')
    ..aOB(5, _omitFieldNames ? '' : 'enabled')
    ..aOS(6, _omitFieldNames ? '' : 'providerId')
    ..aOS(7, _omitFieldNames ? '' : 'type')
    ..aI(8, _omitFieldNames ? '' : 'sort')
    ..aOS(9, _omitFieldNames ? '' : 'userId')
    ..aOS(10, _omitFieldNames ? '' : 'pricingJson')
    ..aOS(11, _omitFieldNames ? '' : 'parametersJson')
    ..aOS(12, _omitFieldNames ? '' : 'configJson')
    ..aOS(13, _omitFieldNames ? '' : 'abilitiesJson')
    ..aI(14, _omitFieldNames ? '' : 'contextWindowTokens')
    ..aOS(15, _omitFieldNames ? '' : 'source')
    ..aOS(16, _omitFieldNames ? '' : 'releasedAt')
    ..aOM<$0.Timestamp>(17, _omitFieldNames ? '' : 'accessedAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(18, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(19, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AiModel clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AiModel copyWith(void Function(AiModel) updates) =>
      super.copyWith((message) => updates(message as AiModel)) as AiModel;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AiModel create() => AiModel._();
  @$core.override
  AiModel createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static AiModel getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<AiModel>(create);
  static AiModel? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get displayName => $_getSZ(1);
  @$pb.TagNumber(2)
  set displayName($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasDisplayName() => $_has(1);
  @$pb.TagNumber(2)
  void clearDisplayName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get description => $_getSZ(2);
  @$pb.TagNumber(3)
  set description($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDescription() => $_has(2);
  @$pb.TagNumber(3)
  void clearDescription() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get organization => $_getSZ(3);
  @$pb.TagNumber(4)
  set organization($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasOrganization() => $_has(3);
  @$pb.TagNumber(4)
  void clearOrganization() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.bool get enabled => $_getBF(4);
  @$pb.TagNumber(5)
  set enabled($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasEnabled() => $_has(4);
  @$pb.TagNumber(5)
  void clearEnabled() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get providerId => $_getSZ(5);
  @$pb.TagNumber(6)
  set providerId($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasProviderId() => $_has(5);
  @$pb.TagNumber(6)
  void clearProviderId() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get type => $_getSZ(6);
  @$pb.TagNumber(7)
  set type($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasType() => $_has(6);
  @$pb.TagNumber(7)
  void clearType() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.int get sort => $_getIZ(7);
  @$pb.TagNumber(8)
  set sort($core.int value) => $_setSignedInt32(7, value);
  @$pb.TagNumber(8)
  $core.bool hasSort() => $_has(7);
  @$pb.TagNumber(8)
  void clearSort() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.String get userId => $_getSZ(8);
  @$pb.TagNumber(9)
  set userId($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasUserId() => $_has(8);
  @$pb.TagNumber(9)
  void clearUserId() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.String get pricingJson => $_getSZ(9);
  @$pb.TagNumber(10)
  set pricingJson($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasPricingJson() => $_has(9);
  @$pb.TagNumber(10)
  void clearPricingJson() => $_clearField(10);

  @$pb.TagNumber(11)
  $core.String get parametersJson => $_getSZ(10);
  @$pb.TagNumber(11)
  set parametersJson($core.String value) => $_setString(10, value);
  @$pb.TagNumber(11)
  $core.bool hasParametersJson() => $_has(10);
  @$pb.TagNumber(11)
  void clearParametersJson() => $_clearField(11);

  @$pb.TagNumber(12)
  $core.String get configJson => $_getSZ(11);
  @$pb.TagNumber(12)
  set configJson($core.String value) => $_setString(11, value);
  @$pb.TagNumber(12)
  $core.bool hasConfigJson() => $_has(11);
  @$pb.TagNumber(12)
  void clearConfigJson() => $_clearField(12);

  @$pb.TagNumber(13)
  $core.String get abilitiesJson => $_getSZ(12);
  @$pb.TagNumber(13)
  set abilitiesJson($core.String value) => $_setString(12, value);
  @$pb.TagNumber(13)
  $core.bool hasAbilitiesJson() => $_has(12);
  @$pb.TagNumber(13)
  void clearAbilitiesJson() => $_clearField(13);

  @$pb.TagNumber(14)
  $core.int get contextWindowTokens => $_getIZ(13);
  @$pb.TagNumber(14)
  set contextWindowTokens($core.int value) => $_setSignedInt32(13, value);
  @$pb.TagNumber(14)
  $core.bool hasContextWindowTokens() => $_has(13);
  @$pb.TagNumber(14)
  void clearContextWindowTokens() => $_clearField(14);

  @$pb.TagNumber(15)
  $core.String get source => $_getSZ(14);
  @$pb.TagNumber(15)
  set source($core.String value) => $_setString(14, value);
  @$pb.TagNumber(15)
  $core.bool hasSource() => $_has(14);
  @$pb.TagNumber(15)
  void clearSource() => $_clearField(15);

  @$pb.TagNumber(16)
  $core.String get releasedAt => $_getSZ(15);
  @$pb.TagNumber(16)
  set releasedAt($core.String value) => $_setString(15, value);
  @$pb.TagNumber(16)
  $core.bool hasReleasedAt() => $_has(15);
  @$pb.TagNumber(16)
  void clearReleasedAt() => $_clearField(16);

  @$pb.TagNumber(17)
  $0.Timestamp get accessedAt => $_getN(16);
  @$pb.TagNumber(17)
  set accessedAt($0.Timestamp value) => $_setField(17, value);
  @$pb.TagNumber(17)
  $core.bool hasAccessedAt() => $_has(16);
  @$pb.TagNumber(17)
  void clearAccessedAt() => $_clearField(17);
  @$pb.TagNumber(17)
  $0.Timestamp ensureAccessedAt() => $_ensure(16);

  @$pb.TagNumber(18)
  $0.Timestamp get createdAt => $_getN(17);
  @$pb.TagNumber(18)
  set createdAt($0.Timestamp value) => $_setField(18, value);
  @$pb.TagNumber(18)
  $core.bool hasCreatedAt() => $_has(17);
  @$pb.TagNumber(18)
  void clearCreatedAt() => $_clearField(18);
  @$pb.TagNumber(18)
  $0.Timestamp ensureCreatedAt() => $_ensure(17);

  @$pb.TagNumber(19)
  $0.Timestamp get updatedAt => $_getN(18);
  @$pb.TagNumber(19)
  set updatedAt($0.Timestamp value) => $_setField(19, value);
  @$pb.TagNumber(19)
  $core.bool hasUpdatedAt() => $_has(18);
  @$pb.TagNumber(19)
  void clearUpdatedAt() => $_clearField(19);
  @$pb.TagNumber(19)
  $0.Timestamp ensureUpdatedAt() => $_ensure(18);
}

/// =================================================
/// 2. AiModelView (View Model)
/// 用于UI展示的轻量级模型，例如在模型选择下拉列表中。
/// =================================================
class AiModelView extends $pb.GeneratedMessage {
  factory AiModelView({
    $core.String? id,
    $core.String? displayName,
    $core.String? description,
    $core.String? organization,
    $core.String? providerId,
    $core.String? type,
    $core.int? contextWindowTokens,
    $core.bool? enabled,
    $core.String? abilitiesJson,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (displayName != null) result.displayName = displayName;
    if (description != null) result.description = description;
    if (organization != null) result.organization = organization;
    if (providerId != null) result.providerId = providerId;
    if (type != null) result.type = type;
    if (contextWindowTokens != null)
      result.contextWindowTokens = contextWindowTokens;
    if (enabled != null) result.enabled = enabled;
    if (abilitiesJson != null) result.abilitiesJson = abilitiesJson;
    return result;
  }

  AiModelView._();

  factory AiModelView.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory AiModelView.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AiModelView',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'displayName')
    ..aOS(3, _omitFieldNames ? '' : 'description')
    ..aOS(4, _omitFieldNames ? '' : 'organization')
    ..aOS(5, _omitFieldNames ? '' : 'providerId')
    ..aOS(6, _omitFieldNames ? '' : 'type')
    ..aI(7, _omitFieldNames ? '' : 'contextWindowTokens')
    ..aOB(8, _omitFieldNames ? '' : 'enabled')
    ..aOS(9, _omitFieldNames ? '' : 'abilitiesJson')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AiModelView clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AiModelView copyWith(void Function(AiModelView) updates) =>
      super.copyWith((message) => updates(message as AiModelView))
          as AiModelView;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AiModelView create() => AiModelView._();
  @$core.override
  AiModelView createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static AiModelView getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AiModelView>(create);
  static AiModelView? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get displayName => $_getSZ(1);
  @$pb.TagNumber(2)
  set displayName($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasDisplayName() => $_has(1);
  @$pb.TagNumber(2)
  void clearDisplayName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get description => $_getSZ(2);
  @$pb.TagNumber(3)
  set description($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDescription() => $_has(2);
  @$pb.TagNumber(3)
  void clearDescription() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get organization => $_getSZ(3);
  @$pb.TagNumber(4)
  set organization($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasOrganization() => $_has(3);
  @$pb.TagNumber(4)
  void clearOrganization() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get providerId => $_getSZ(4);
  @$pb.TagNumber(5)
  set providerId($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasProviderId() => $_has(4);
  @$pb.TagNumber(5)
  void clearProviderId() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get type => $_getSZ(5);
  @$pb.TagNumber(6)
  set type($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasType() => $_has(5);
  @$pb.TagNumber(6)
  void clearType() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.int get contextWindowTokens => $_getIZ(6);
  @$pb.TagNumber(7)
  set contextWindowTokens($core.int value) => $_setSignedInt32(6, value);
  @$pb.TagNumber(7)
  $core.bool hasContextWindowTokens() => $_has(6);
  @$pb.TagNumber(7)
  void clearContextWindowTokens() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.bool get enabled => $_getBF(7);
  @$pb.TagNumber(8)
  set enabled($core.bool value) => $_setBool(7, value);
  @$pb.TagNumber(8)
  $core.bool hasEnabled() => $_has(7);
  @$pb.TagNumber(8)
  void clearEnabled() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.String get abilitiesJson => $_getSZ(8);
  @$pb.TagNumber(9)
  set abilitiesJson($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasAbilitiesJson() => $_has(8);
  @$pb.TagNumber(9)
  void clearAbilitiesJson() => $_clearField(9);
}

/// =================================================
/// 3. AiModelInfo (API Model / DTO)
/// 用于客户端-服务端通信，隐藏敏感或内部信息。
/// =================================================
class AiModelInfo extends $pb.GeneratedMessage {
  factory AiModelInfo({
    $core.String? id,
    $core.String? displayName,
    $core.String? description,
    $core.String? organization,
    $core.String? providerId,
    $core.String? type,
    $core.int? contextWindowTokens,
    $core.bool? enabled,
    $core.String? abilitiesJson,
    $core.String? pricingJson,
    $core.String? parametersSchemaJson,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (displayName != null) result.displayName = displayName;
    if (description != null) result.description = description;
    if (organization != null) result.organization = organization;
    if (providerId != null) result.providerId = providerId;
    if (type != null) result.type = type;
    if (contextWindowTokens != null)
      result.contextWindowTokens = contextWindowTokens;
    if (enabled != null) result.enabled = enabled;
    if (abilitiesJson != null) result.abilitiesJson = abilitiesJson;
    if (pricingJson != null) result.pricingJson = pricingJson;
    if (parametersSchemaJson != null)
      result.parametersSchemaJson = parametersSchemaJson;
    return result;
  }

  AiModelInfo._();

  factory AiModelInfo.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory AiModelInfo.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AiModelInfo',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'displayName')
    ..aOS(3, _omitFieldNames ? '' : 'description')
    ..aOS(4, _omitFieldNames ? '' : 'organization')
    ..aOS(5, _omitFieldNames ? '' : 'providerId')
    ..aOS(6, _omitFieldNames ? '' : 'type')
    ..aI(7, _omitFieldNames ? '' : 'contextWindowTokens')
    ..aOB(8, _omitFieldNames ? '' : 'enabled')
    ..aOS(9, _omitFieldNames ? '' : 'abilitiesJson')
    ..aOS(10, _omitFieldNames ? '' : 'pricingJson')
    ..aOS(11, _omitFieldNames ? '' : 'parametersSchemaJson')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AiModelInfo clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AiModelInfo copyWith(void Function(AiModelInfo) updates) =>
      super.copyWith((message) => updates(message as AiModelInfo))
          as AiModelInfo;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AiModelInfo create() => AiModelInfo._();
  @$core.override
  AiModelInfo createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static AiModelInfo getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AiModelInfo>(create);
  static AiModelInfo? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get displayName => $_getSZ(1);
  @$pb.TagNumber(2)
  set displayName($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasDisplayName() => $_has(1);
  @$pb.TagNumber(2)
  void clearDisplayName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get description => $_getSZ(2);
  @$pb.TagNumber(3)
  set description($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDescription() => $_has(2);
  @$pb.TagNumber(3)
  void clearDescription() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get organization => $_getSZ(3);
  @$pb.TagNumber(4)
  set organization($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasOrganization() => $_has(3);
  @$pb.TagNumber(4)
  void clearOrganization() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get providerId => $_getSZ(4);
  @$pb.TagNumber(5)
  set providerId($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasProviderId() => $_has(4);
  @$pb.TagNumber(5)
  void clearProviderId() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get type => $_getSZ(5);
  @$pb.TagNumber(6)
  set type($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasType() => $_has(5);
  @$pb.TagNumber(6)
  void clearType() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.int get contextWindowTokens => $_getIZ(6);
  @$pb.TagNumber(7)
  set contextWindowTokens($core.int value) => $_setSignedInt32(6, value);
  @$pb.TagNumber(7)
  $core.bool hasContextWindowTokens() => $_has(6);
  @$pb.TagNumber(7)
  void clearContextWindowTokens() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.bool get enabled => $_getBF(7);
  @$pb.TagNumber(8)
  set enabled($core.bool value) => $_setBool(7, value);
  @$pb.TagNumber(8)
  $core.bool hasEnabled() => $_has(7);
  @$pb.TagNumber(8)
  void clearEnabled() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.String get abilitiesJson => $_getSZ(8);
  @$pb.TagNumber(9)
  set abilitiesJson($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasAbilitiesJson() => $_has(8);
  @$pb.TagNumber(9)
  void clearAbilitiesJson() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.String get pricingJson => $_getSZ(9);
  @$pb.TagNumber(10)
  set pricingJson($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasPricingJson() => $_has(9);
  @$pb.TagNumber(10)
  void clearPricingJson() => $_clearField(10);

  /// 为模型特定参数提供JSON Schema，用于动态生成设置UI
  @$pb.TagNumber(11)
  $core.String get parametersSchemaJson => $_getSZ(10);
  @$pb.TagNumber(11)
  set parametersSchemaJson($core.String value) => $_setString(10, value);
  @$pb.TagNumber(11)
  $core.bool hasParametersSchemaJson() => $_has(10);
  @$pb.TagNumber(11)
  void clearParametersSchemaJson() => $_clearField(11);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
