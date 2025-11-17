// This is a generated file - do not edit.
//
// Generated from domain/ai_box/ai_box_message.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

/// This is a placeholder message.
class AiBoxMessage extends $pb.GeneratedMessage {
  factory AiBoxMessage() => create();

  AiBoxMessage._();

  factory AiBoxMessage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory AiBoxMessage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AiBoxMessage',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.ai_box.v1'),
      createEmptyInstance: create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AiBoxMessage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AiBoxMessage copyWith(void Function(AiBoxMessage) updates) =>
      super.copyWith((message) => updates(message as AiBoxMessage))
          as AiBoxMessage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AiBoxMessage create() => AiBoxMessage._();
  @$core.override
  AiBoxMessage createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static AiBoxMessage getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AiBoxMessage>(create);
  static AiBoxMessage? _defaultInstance;
}

const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
