// This is a generated file - do not edit.
//
// Generated from domain/agent/agent.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

class TurnStatus extends $pb.ProtobufEnum {
  static const TurnStatus TURN_STATUS_UNSPECIFIED =
      TurnStatus._(0, _omitEnumNames ? '' : 'TURN_STATUS_UNSPECIFIED');
  static const TurnStatus TURN_STATUS_RUNNING =
      TurnStatus._(1, _omitEnumNames ? '' : 'TURN_STATUS_RUNNING');
  static const TurnStatus TURN_STATUS_COMPLETED =
      TurnStatus._(2, _omitEnumNames ? '' : 'TURN_STATUS_COMPLETED');
  static const TurnStatus TURN_STATUS_FAILED =
      TurnStatus._(3, _omitEnumNames ? '' : 'TURN_STATUS_FAILED');
  static const TurnStatus TURN_STATUS_INTERRUPTED =
      TurnStatus._(4, _omitEnumNames ? '' : 'TURN_STATUS_INTERRUPTED');

  static const $core.List<TurnStatus> values = <TurnStatus>[
    TURN_STATUS_UNSPECIFIED,
    TURN_STATUS_RUNNING,
    TURN_STATUS_COMPLETED,
    TURN_STATUS_FAILED,
    TURN_STATUS_INTERRUPTED,
  ];

  static final $core.List<TurnStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static TurnStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const TurnStatus._(super.value, super.name);
}

class FailoverReason extends $pb.ProtobufEnum {
  static const FailoverReason FAILOVER_REASON_UNSPECIFIED =
      FailoverReason._(0, _omitEnumNames ? '' : 'FAILOVER_REASON_UNSPECIFIED');
  static const FailoverReason FAILOVER_REASON_AUTH =
      FailoverReason._(1, _omitEnumNames ? '' : 'FAILOVER_REASON_AUTH');
  static const FailoverReason FAILOVER_REASON_AUTH_PERMANENT = FailoverReason._(
      2, _omitEnumNames ? '' : 'FAILOVER_REASON_AUTH_PERMANENT');
  static const FailoverReason FAILOVER_REASON_BILLING =
      FailoverReason._(3, _omitEnumNames ? '' : 'FAILOVER_REASON_BILLING');
  static const FailoverReason FAILOVER_REASON_RATE_LIMIT =
      FailoverReason._(4, _omitEnumNames ? '' : 'FAILOVER_REASON_RATE_LIMIT');
  static const FailoverReason FAILOVER_REASON_OVERLOADED =
      FailoverReason._(5, _omitEnumNames ? '' : 'FAILOVER_REASON_OVERLOADED');
  static const FailoverReason FAILOVER_REASON_SERVER_ERROR =
      FailoverReason._(6, _omitEnumNames ? '' : 'FAILOVER_REASON_SERVER_ERROR');
  static const FailoverReason FAILOVER_REASON_TIMEOUT =
      FailoverReason._(7, _omitEnumNames ? '' : 'FAILOVER_REASON_TIMEOUT');
  static const FailoverReason FAILOVER_REASON_CONTEXT_OVERFLOW =
      FailoverReason._(
          8, _omitEnumNames ? '' : 'FAILOVER_REASON_CONTEXT_OVERFLOW');
  static const FailoverReason FAILOVER_REASON_PAYLOAD_TOO_LARGE =
      FailoverReason._(
          9, _omitEnumNames ? '' : 'FAILOVER_REASON_PAYLOAD_TOO_LARGE');
  static const FailoverReason FAILOVER_REASON_MODEL_NOT_FOUND =
      FailoverReason._(
          10, _omitEnumNames ? '' : 'FAILOVER_REASON_MODEL_NOT_FOUND');
  static const FailoverReason FAILOVER_REASON_FORMAT_ERROR = FailoverReason._(
      11, _omitEnumNames ? '' : 'FAILOVER_REASON_FORMAT_ERROR');
  static const FailoverReason FAILOVER_REASON_THINKING_SIGNATURE =
      FailoverReason._(
          12, _omitEnumNames ? '' : 'FAILOVER_REASON_THINKING_SIGNATURE');
  static const FailoverReason FAILOVER_REASON_LONG_CONTEXT_TIER =
      FailoverReason._(
          13, _omitEnumNames ? '' : 'FAILOVER_REASON_LONG_CONTEXT_TIER');
  static const FailoverReason FAILOVER_REASON_UNKNOWN =
      FailoverReason._(14, _omitEnumNames ? '' : 'FAILOVER_REASON_UNKNOWN');

  static const $core.List<FailoverReason> values = <FailoverReason>[
    FAILOVER_REASON_UNSPECIFIED,
    FAILOVER_REASON_AUTH,
    FAILOVER_REASON_AUTH_PERMANENT,
    FAILOVER_REASON_BILLING,
    FAILOVER_REASON_RATE_LIMIT,
    FAILOVER_REASON_OVERLOADED,
    FAILOVER_REASON_SERVER_ERROR,
    FAILOVER_REASON_TIMEOUT,
    FAILOVER_REASON_CONTEXT_OVERFLOW,
    FAILOVER_REASON_PAYLOAD_TOO_LARGE,
    FAILOVER_REASON_MODEL_NOT_FOUND,
    FAILOVER_REASON_FORMAT_ERROR,
    FAILOVER_REASON_THINKING_SIGNATURE,
    FAILOVER_REASON_LONG_CONTEXT_TIER,
    FAILOVER_REASON_UNKNOWN,
  ];

  static final $core.List<FailoverReason?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 14);
  static FailoverReason? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const FailoverReason._(super.value, super.name);
}

class DelegationStatus extends $pb.ProtobufEnum {
  static const DelegationStatus DELEGATION_STATUS_UNSPECIFIED =
      DelegationStatus._(
          0, _omitEnumNames ? '' : 'DELEGATION_STATUS_UNSPECIFIED');
  static const DelegationStatus DELEGATION_STATUS_COMPLETED =
      DelegationStatus._(
          1, _omitEnumNames ? '' : 'DELEGATION_STATUS_COMPLETED');
  static const DelegationStatus DELEGATION_STATUS_FAILED =
      DelegationStatus._(2, _omitEnumNames ? '' : 'DELEGATION_STATUS_FAILED');
  static const DelegationStatus DELEGATION_STATUS_TIMEOUT =
      DelegationStatus._(3, _omitEnumNames ? '' : 'DELEGATION_STATUS_TIMEOUT');

  static const $core.List<DelegationStatus> values = <DelegationStatus>[
    DELEGATION_STATUS_UNSPECIFIED,
    DELEGATION_STATUS_COMPLETED,
    DELEGATION_STATUS_FAILED,
    DELEGATION_STATUS_TIMEOUT,
  ];

  static final $core.List<DelegationStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static DelegationStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const DelegationStatus._(super.value, super.name);
}

class MessageRole extends $pb.ProtobufEnum {
  static const MessageRole MESSAGE_ROLE_UNSPECIFIED =
      MessageRole._(0, _omitEnumNames ? '' : 'MESSAGE_ROLE_UNSPECIFIED');
  static const MessageRole MESSAGE_ROLE_SYSTEM =
      MessageRole._(1, _omitEnumNames ? '' : 'MESSAGE_ROLE_SYSTEM');
  static const MessageRole MESSAGE_ROLE_USER =
      MessageRole._(2, _omitEnumNames ? '' : 'MESSAGE_ROLE_USER');
  static const MessageRole MESSAGE_ROLE_ASSISTANT =
      MessageRole._(3, _omitEnumNames ? '' : 'MESSAGE_ROLE_ASSISTANT');
  static const MessageRole MESSAGE_ROLE_TOOL =
      MessageRole._(4, _omitEnumNames ? '' : 'MESSAGE_ROLE_TOOL');

  static const $core.List<MessageRole> values = <MessageRole>[
    MESSAGE_ROLE_UNSPECIFIED,
    MESSAGE_ROLE_SYSTEM,
    MESSAGE_ROLE_USER,
    MESSAGE_ROLE_ASSISTANT,
    MESSAGE_ROLE_TOOL,
  ];

  static final $core.List<MessageRole?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static MessageRole? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const MessageRole._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
