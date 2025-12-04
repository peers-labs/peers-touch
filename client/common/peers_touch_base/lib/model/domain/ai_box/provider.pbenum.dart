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

import 'package:protobuf/protobuf.dart' as $pb;

/// Provider类型映射
class ProviderType extends $pb.ProtobufEnum {
  static const ProviderType openai =
      ProviderType._(0, _omitEnumNames ? '' : 'openai');
  static const ProviderType ollama =
      ProviderType._(1, _omitEnumNames ? '' : 'ollama');
  static const ProviderType deepseek =
      ProviderType._(2, _omitEnumNames ? '' : 'deepseek');
  static const ProviderType custom =
      ProviderType._(1001, _omitEnumNames ? '' : 'custom');

  static const $core.List<ProviderType> values = <ProviderType>[
    openai,
    ollama,
    deepseek,
    custom,
  ];

  static final $core.Map<$core.int, ProviderType> _byValue =
      $pb.ProtobufEnum.initByValue(values);
  static ProviderType? valueOf($core.int value) => _byValue[value];

  const ProviderType._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
