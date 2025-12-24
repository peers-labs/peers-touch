// This is a generated file - do not edit.
//
// Generated from domain/ai_box/chat.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

/// 角色枚举映射
class ChatRole extends $pb.ProtobufEnum {
  static const ChatRole CHAT_ROLE_UNSPECIFIED =
      ChatRole._(0, _omitEnumNames ? '' : 'CHAT_ROLE_UNSPECIFIED');
  static const ChatRole CHAT_ROLE_SYSTEM =
      ChatRole._(1, _omitEnumNames ? '' : 'CHAT_ROLE_SYSTEM');
  static const ChatRole CHAT_ROLE_USER =
      ChatRole._(2, _omitEnumNames ? '' : 'CHAT_ROLE_USER');
  static const ChatRole CHAT_ROLE_ASSISTANT =
      ChatRole._(3, _omitEnumNames ? '' : 'CHAT_ROLE_ASSISTANT');
  static const ChatRole CHAT_ROLE_TOOL =
      ChatRole._(4, _omitEnumNames ? '' : 'CHAT_ROLE_TOOL');

  static const $core.List<ChatRole> values = <ChatRole>[
    CHAT_ROLE_UNSPECIFIED,
    CHAT_ROLE_SYSTEM,
    CHAT_ROLE_USER,
    CHAT_ROLE_ASSISTANT,
    CHAT_ROLE_TOOL,
  ];

  static final $core.List<ChatRole?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static ChatRole? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const ChatRole._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
