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

import 'package:protobuf/protobuf.dart' as $pb;

/// ModelProvider 定义了AI模型的提供商
class ModelProvider extends $pb.ProtobufEnum {
  static const ModelProvider MODEL_PROVIDER_UNSPECIFIED =
      ModelProvider._(0, _omitEnumNames ? '' : 'MODEL_PROVIDER_UNSPECIFIED');
  static const ModelProvider OPENAI =
      ModelProvider._(1, _omitEnumNames ? '' : 'OPENAI');
  static const ModelProvider GOOGLE =
      ModelProvider._(2, _omitEnumNames ? '' : 'GOOGLE');
  static const ModelProvider ANTHROPIC =
      ModelProvider._(3, _omitEnumNames ? '' : 'ANTHROPIC');
  static const ModelProvider MOONSHOT =
      ModelProvider._(4, _omitEnumNames ? '' : 'MOONSHOT');
  static const ModelProvider OLLAMA =
      ModelProvider._(5, _omitEnumNames ? '' : 'OLLAMA');
  static const ModelProvider CUSTOM =
      ModelProvider._(6, _omitEnumNames ? '' : 'CUSTOM');

  static const $core.List<ModelProvider> values = <ModelProvider>[
    MODEL_PROVIDER_UNSPECIFIED,
    OPENAI,
    GOOGLE,
    ANTHROPIC,
    MOONSHOT,
    OLLAMA,
    CUSTOM,
  ];

  static final $core.List<ModelProvider?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 6);
  static ModelProvider? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const ModelProvider._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
