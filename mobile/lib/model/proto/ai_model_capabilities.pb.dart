// This is a generated file - do not edit.
//
// Generated from ai_model_capabilities.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

import 'ai_model_capabilities.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'ai_model_capabilities.pbenum.dart';

/// ModelCapability 定义了单个AI模型所支持的各种能力
class ModelCapability extends $pb.GeneratedMessage {
  factory ModelCapability({
    $core.String? id,
    $core.String? displayName,
    ModelProvider? provider,
    $core.bool? visionSupported,
    $core.bool? fileUploadSupported,
    $core.bool? ttsSupported,
    $core.bool? sttSupported,
    $core.bool? toolCallingSupported,
    $core.bool? webSearchSupported,
    $core.int? maxVisionInput,
    $fixnum.Int64? maxContextWindow,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (displayName != null) result.displayName = displayName;
    if (provider != null) result.provider = provider;
    if (visionSupported != null) result.visionSupported = visionSupported;
    if (fileUploadSupported != null)
      result.fileUploadSupported = fileUploadSupported;
    if (ttsSupported != null) result.ttsSupported = ttsSupported;
    if (sttSupported != null) result.sttSupported = sttSupported;
    if (toolCallingSupported != null)
      result.toolCallingSupported = toolCallingSupported;
    if (webSearchSupported != null)
      result.webSearchSupported = webSearchSupported;
    if (maxVisionInput != null) result.maxVisionInput = maxVisionInput;
    if (maxContextWindow != null) result.maxContextWindow = maxContextWindow;
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
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'displayName')
    ..aE<ModelProvider>(3, _omitFieldNames ? '' : 'provider',
        enumValues: ModelProvider.values)
    ..aOB(4, _omitFieldNames ? '' : 'visionSupported')
    ..aOB(5, _omitFieldNames ? '' : 'fileUploadSupported')
    ..aOB(6, _omitFieldNames ? '' : 'ttsSupported')
    ..aOB(7, _omitFieldNames ? '' : 'sttSupported')
    ..aOB(8, _omitFieldNames ? '' : 'toolCallingSupported')
    ..aOB(9, _omitFieldNames ? '' : 'webSearchSupported')
    ..aI(10, _omitFieldNames ? '' : 'maxVisionInput')
    ..aInt64(11, _omitFieldNames ? '' : 'maxContextWindow')
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
  static $pb.PbList<ModelCapability> createRepeated() =>
      $pb.PbList<ModelCapability>();
  @$core.pragma('dart2js:noInline')
  static ModelCapability getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ModelCapability>(create);
  static ModelCapability? _defaultInstance;

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
  ModelProvider get provider => $_getN(2);
  @$pb.TagNumber(3)
  set provider(ModelProvider value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasProvider() => $_has(2);
  @$pb.TagNumber(3)
  void clearProvider() => $_clearField(3);

  /// --- 多模态能力标识 ---
  @$pb.TagNumber(4)
  $core.bool get visionSupported => $_getBF(3);
  @$pb.TagNumber(4)
  set visionSupported($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasVisionSupported() => $_has(3);
  @$pb.TagNumber(4)
  void clearVisionSupported() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.bool get fileUploadSupported => $_getBF(4);
  @$pb.TagNumber(5)
  set fileUploadSupported($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasFileUploadSupported() => $_has(4);
  @$pb.TagNumber(5)
  void clearFileUploadSupported() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.bool get ttsSupported => $_getBF(5);
  @$pb.TagNumber(6)
  set ttsSupported($core.bool value) => $_setBool(5, value);
  @$pb.TagNumber(6)
  $core.bool hasTtsSupported() => $_has(5);
  @$pb.TagNumber(6)
  void clearTtsSupported() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.bool get sttSupported => $_getBF(6);
  @$pb.TagNumber(7)
  set sttSupported($core.bool value) => $_setBool(6, value);
  @$pb.TagNumber(7)
  $core.bool hasSttSupported() => $_has(6);
  @$pb.TagNumber(7)
  void clearSttSupported() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.bool get toolCallingSupported => $_getBF(7);
  @$pb.TagNumber(8)
  set toolCallingSupported($core.bool value) => $_setBool(7, value);
  @$pb.TagNumber(8)
  $core.bool hasToolCallingSupported() => $_has(7);
  @$pb.TagNumber(8)
  void clearToolCallingSupported() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.bool get webSearchSupported => $_getBF(8);
  @$pb.TagNumber(9)
  set webSearchSupported($core.bool value) => $_setBool(8, value);
  @$pb.TagNumber(9)
  $core.bool hasWebSearchSupported() => $_has(8);
  @$pb.TagNumber(9)
  void clearWebSearchSupported() => $_clearField(9);

  /// --- 能力相关参数 ---
  @$pb.TagNumber(10)
  $core.int get maxVisionInput => $_getIZ(9);
  @$pb.TagNumber(10)
  set maxVisionInput($core.int value) => $_setSignedInt32(9, value);
  @$pb.TagNumber(10)
  $core.bool hasMaxVisionInput() => $_has(9);
  @$pb.TagNumber(10)
  void clearMaxVisionInput() => $_clearField(10);

  @$pb.TagNumber(11)
  $fixnum.Int64 get maxContextWindow => $_getI64(10);
  @$pb.TagNumber(11)
  set maxContextWindow($fixnum.Int64 value) => $_setInt64(10, value);
  @$pb.TagNumber(11)
  $core.bool hasMaxContextWindow() => $_has(10);
  @$pb.TagNumber(11)
  void clearMaxContextWindow() => $_clearField(11);
}

/// ModelProviderCapabilitiesResponse 用于后端返回给前端的所有可用模型及其能力
class ModelProviderCapabilitiesResponse extends $pb.GeneratedMessage {
  factory ModelProviderCapabilitiesResponse({
    $core.Iterable<ModelCapability>? capabilities,
  }) {
    final result = create();
    if (capabilities != null) result.capabilities.addAll(capabilities);
    return result;
  }

  ModelProviderCapabilitiesResponse._();

  factory ModelProviderCapabilitiesResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ModelProviderCapabilitiesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ModelProviderCapabilitiesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v1'),
      createEmptyInstance: create)
    ..pPM<ModelCapability>(1, _omitFieldNames ? '' : 'capabilities',
        subBuilder: ModelCapability.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ModelProviderCapabilitiesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ModelProviderCapabilitiesResponse copyWith(
          void Function(ModelProviderCapabilitiesResponse) updates) =>
      super.copyWith((message) =>
              updates(message as ModelProviderCapabilitiesResponse))
          as ModelProviderCapabilitiesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ModelProviderCapabilitiesResponse create() =>
      ModelProviderCapabilitiesResponse._();
  @$core.override
  ModelProviderCapabilitiesResponse createEmptyInstance() => create();
  static $pb.PbList<ModelProviderCapabilitiesResponse> createRepeated() =>
      $pb.PbList<ModelProviderCapabilitiesResponse>();
  @$core.pragma('dart2js:noInline')
  static ModelProviderCapabilitiesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ModelProviderCapabilitiesResponse>(
          create);
  static ModelProviderCapabilitiesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<ModelCapability> get capabilities => $_getList(0);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
