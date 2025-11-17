// This is a generated file - do not edit.
//
// Generated from domain/ai_box/ai_box.proto.

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

/// AiProvider: AI 服务提供商
class AiProvider extends $pb.GeneratedMessage {
  factory AiProvider({
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
    $core.String? settings,
    $core.String? config,
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
    if (settings != null) result.settings = settings;
    if (config != null) result.config = config;
    if (accessedAt != null) result.accessedAt = accessedAt;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  AiProvider._();

  factory AiProvider.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory AiProvider.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AiProvider',
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
    ..aOS(11, _omitFieldNames ? '' : 'settings')
    ..aOS(12, _omitFieldNames ? '' : 'config')
    ..aOM<$0.Timestamp>(13, _omitFieldNames ? '' : 'accessedAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(14, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(15, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AiProvider clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AiProvider copyWith(void Function(AiProvider) updates) =>
      super.copyWith((message) => updates(message as AiProvider)) as AiProvider;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AiProvider create() => AiProvider._();
  @$core.override
  AiProvider createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static AiProvider getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AiProvider>(create);
  static AiProvider? _defaultInstance;

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
  $core.String get settings => $_getSZ(10);
  @$pb.TagNumber(11)
  set settings($core.String value) => $_setString(10, value);
  @$pb.TagNumber(11)
  $core.bool hasSettings() => $_has(10);
  @$pb.TagNumber(11)
  void clearSettings() => $_clearField(11);

  @$pb.TagNumber(12)
  $core.String get config => $_getSZ(11);
  @$pb.TagNumber(12)
  set config($core.String value) => $_setString(11, value);
  @$pb.TagNumber(12)
  $core.bool hasConfig() => $_has(11);
  @$pb.TagNumber(12)
  void clearConfig() => $_clearField(12);

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

/// ProviderConfig: 服务提供商的通用配置
class ProviderConfig extends $pb.GeneratedMessage {
  factory ProviderConfig({
    $core.String? apiKey,
    $core.String? endpoint,
    $core.String? proxyUrl,
    $core.int? timeoutSeconds,
    $core.int? maxRetries,
  }) {
    final result = create();
    if (apiKey != null) result.apiKey = apiKey;
    if (endpoint != null) result.endpoint = endpoint;
    if (proxyUrl != null) result.proxyUrl = proxyUrl;
    if (timeoutSeconds != null) result.timeoutSeconds = timeoutSeconds;
    if (maxRetries != null) result.maxRetries = maxRetries;
    return result;
  }

  ProviderConfig._();

  factory ProviderConfig.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ProviderConfig.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ProviderConfig',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'apiKey')
    ..aOS(2, _omitFieldNames ? '' : 'endpoint')
    ..aOS(3, _omitFieldNames ? '' : 'proxyUrl')
    ..aI(4, _omitFieldNames ? '' : 'timeoutSeconds')
    ..aI(5, _omitFieldNames ? '' : 'maxRetries')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProviderConfig clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProviderConfig copyWith(void Function(ProviderConfig) updates) =>
      super.copyWith((message) => updates(message as ProviderConfig))
          as ProviderConfig;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ProviderConfig create() => ProviderConfig._();
  @$core.override
  ProviderConfig createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ProviderConfig getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ProviderConfig>(create);
  static ProviderConfig? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get apiKey => $_getSZ(0);
  @$pb.TagNumber(1)
  set apiKey($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasApiKey() => $_has(0);
  @$pb.TagNumber(1)
  void clearApiKey() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get endpoint => $_getSZ(1);
  @$pb.TagNumber(2)
  set endpoint($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEndpoint() => $_has(1);
  @$pb.TagNumber(2)
  void clearEndpoint() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get proxyUrl => $_getSZ(2);
  @$pb.TagNumber(3)
  set proxyUrl($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasProxyUrl() => $_has(2);
  @$pb.TagNumber(3)
  void clearProxyUrl() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get timeoutSeconds => $_getIZ(3);
  @$pb.TagNumber(4)
  set timeoutSeconds($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasTimeoutSeconds() => $_has(3);
  @$pb.TagNumber(4)
  void clearTimeoutSeconds() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.int get maxRetries => $_getIZ(4);
  @$pb.TagNumber(5)
  set maxRetries($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasMaxRetries() => $_has(4);
  @$pb.TagNumber(5)
  void clearMaxRetries() => $_clearField(5);
}

/// ModelCapability: AI 模型能力描述
class ModelCapability extends $pb.GeneratedMessage {
  factory ModelCapability({
    $core.String? modelName,
    $core.bool? supportsStreaming,
    $core.int? maxTokens,
    $core.String? description,
  }) {
    final result = create();
    if (modelName != null) result.modelName = modelName;
    if (supportsStreaming != null) result.supportsStreaming = supportsStreaming;
    if (maxTokens != null) result.maxTokens = maxTokens;
    if (description != null) result.description = description;
    return result;
  }

  ModelCapability._();

  factory ModelCapability.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ModelCapability.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ModelCapability',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'modelName')
    ..aOB(2, _omitFieldNames ? '' : 'supportsStreaming')
    ..aI(3, _omitFieldNames ? '' : 'maxTokens')
    ..aOS(4, _omitFieldNames ? '' : 'description')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ModelCapability clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ModelCapability copyWith(void Function(ModelCapability) updates) =>
      super.copyWith((message) => updates(message as ModelCapability))
          as ModelCapability;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ModelCapability create() => ModelCapability._();
  @$core.override
  ModelCapability createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ModelCapability getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ModelCapability>(create);
  static ModelCapability? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get modelName => $_getSZ(0);
  @$pb.TagNumber(1)
  set modelName($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasModelName() => $_has(0);
  @$pb.TagNumber(1)
  void clearModelName() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.bool get supportsStreaming => $_getBF(1);
  @$pb.TagNumber(2)
  set supportsStreaming($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSupportsStreaming() => $_has(1);
  @$pb.TagNumber(2)
  void clearSupportsStreaming() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get maxTokens => $_getIZ(2);
  @$pb.TagNumber(3)
  set maxTokens($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasMaxTokens() => $_has(2);
  @$pb.TagNumber(3)
  void clearMaxTokens() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get description => $_getSZ(3);
  @$pb.TagNumber(4)
  set description($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasDescription() => $_has(3);
  @$pb.TagNumber(4)
  void clearDescription() => $_clearField(4);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
