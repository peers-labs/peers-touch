// This is a generated file - do not edit.
//
// Generated from communication.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

/// MessageType represents the type of a message.
class MessageType extends $pb.ProtobufEnum {
  static const MessageType MESSAGE_TYPE_UNKNOWN =
      MessageType._(0, _omitEnumNames ? '' : 'MESSAGE_TYPE_UNKNOWN');
  static const MessageType MESSAGE_TYPE_TEXT =
      MessageType._(1, _omitEnumNames ? '' : 'MESSAGE_TYPE_TEXT');
  static const MessageType MESSAGE_TYPE_BINARY =
      MessageType._(2, _omitEnumNames ? '' : 'MESSAGE_TYPE_BINARY');
  static const MessageType MESSAGE_TYPE_JSON =
      MessageType._(3, _omitEnumNames ? '' : 'MESSAGE_TYPE_JSON');
  static const MessageType MESSAGE_TYPE_PROTOBUF =
      MessageType._(4, _omitEnumNames ? '' : 'MESSAGE_TYPE_PROTOBUF');
  static const MessageType MESSAGE_TYPE_CONTROL =
      MessageType._(5, _omitEnumNames ? '' : 'MESSAGE_TYPE_CONTROL');

  static const $core.List<MessageType> values = <MessageType>[
    MESSAGE_TYPE_UNKNOWN,
    MESSAGE_TYPE_TEXT,
    MESSAGE_TYPE_BINARY,
    MESSAGE_TYPE_JSON,
    MESSAGE_TYPE_PROTOBUF,
    MESSAGE_TYPE_CONTROL,
  ];

  static final $core.List<MessageType?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 5);
  static MessageType? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const MessageType._(super.value, super.name);
}

/// MessagePriority represents the priority of a message.
class MessagePriority extends $pb.ProtobufEnum {
  static const MessagePriority MESSAGE_PRIORITY_UNKNOWN =
      MessagePriority._(0, _omitEnumNames ? '' : 'MESSAGE_PRIORITY_UNKNOWN');
  static const MessagePriority MESSAGE_PRIORITY_LOW =
      MessagePriority._(1, _omitEnumNames ? '' : 'MESSAGE_PRIORITY_LOW');
  static const MessagePriority MESSAGE_PRIORITY_NORMAL =
      MessagePriority._(2, _omitEnumNames ? '' : 'MESSAGE_PRIORITY_NORMAL');
  static const MessagePriority MESSAGE_PRIORITY_HIGH =
      MessagePriority._(3, _omitEnumNames ? '' : 'MESSAGE_PRIORITY_HIGH');
  static const MessagePriority MESSAGE_PRIORITY_URGENT =
      MessagePriority._(4, _omitEnumNames ? '' : 'MESSAGE_PRIORITY_URGENT');

  static const $core.List<MessagePriority> values = <MessagePriority>[
    MESSAGE_PRIORITY_UNKNOWN,
    MESSAGE_PRIORITY_LOW,
    MESSAGE_PRIORITY_NORMAL,
    MESSAGE_PRIORITY_HIGH,
    MESSAGE_PRIORITY_URGENT,
  ];

  static final $core.List<MessagePriority?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static MessagePriority? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const MessagePriority._(super.value, super.name);
}

/// DeliveryMode represents the delivery mode for messages.
class DeliveryMode extends $pb.ProtobufEnum {
  static const DeliveryMode DELIVERY_MODE_UNKNOWN =
      DeliveryMode._(0, _omitEnumNames ? '' : 'DELIVERY_MODE_UNKNOWN');
  static const DeliveryMode DELIVERY_MODE_BEST_EFFORT =
      DeliveryMode._(1, _omitEnumNames ? '' : 'DELIVERY_MODE_BEST_EFFORT');
  static const DeliveryMode DELIVERY_MODE_AT_LEAST_ONCE =
      DeliveryMode._(2, _omitEnumNames ? '' : 'DELIVERY_MODE_AT_LEAST_ONCE');
  static const DeliveryMode DELIVERY_MODE_EXACTLY_ONCE =
      DeliveryMode._(3, _omitEnumNames ? '' : 'DELIVERY_MODE_EXACTLY_ONCE');

  static const $core.List<DeliveryMode> values = <DeliveryMode>[
    DELIVERY_MODE_UNKNOWN,
    DELIVERY_MODE_BEST_EFFORT,
    DELIVERY_MODE_AT_LEAST_ONCE,
    DELIVERY_MODE_EXACTLY_ONCE,
  ];

  static final $core.List<DeliveryMode?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static DeliveryMode? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const DeliveryMode._(super.value, super.name);
}

/// MessageStatus represents the status of a message.
class MessageStatus extends $pb.ProtobufEnum {
  static const MessageStatus MESSAGE_STATUS_UNKNOWN =
      MessageStatus._(0, _omitEnumNames ? '' : 'MESSAGE_STATUS_UNKNOWN');
  static const MessageStatus MESSAGE_STATUS_PENDING =
      MessageStatus._(1, _omitEnumNames ? '' : 'MESSAGE_STATUS_PENDING');
  static const MessageStatus MESSAGE_STATUS_SENT =
      MessageStatus._(2, _omitEnumNames ? '' : 'MESSAGE_STATUS_SENT');
  static const MessageStatus MESSAGE_STATUS_DELIVERED =
      MessageStatus._(3, _omitEnumNames ? '' : 'MESSAGE_STATUS_DELIVERED');
  static const MessageStatus MESSAGE_STATUS_ACKNOWLEDGED =
      MessageStatus._(4, _omitEnumNames ? '' : 'MESSAGE_STATUS_ACKNOWLEDGED');
  static const MessageStatus MESSAGE_STATUS_FAILED =
      MessageStatus._(5, _omitEnumNames ? '' : 'MESSAGE_STATUS_FAILED');

  static const $core.List<MessageStatus> values = <MessageStatus>[
    MESSAGE_STATUS_UNKNOWN,
    MESSAGE_STATUS_PENDING,
    MESSAGE_STATUS_SENT,
    MESSAGE_STATUS_DELIVERED,
    MESSAGE_STATUS_ACKNOWLEDGED,
    MESSAGE_STATUS_FAILED,
  ];

  static final $core.List<MessageStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 5);
  static MessageStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const MessageStatus._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
