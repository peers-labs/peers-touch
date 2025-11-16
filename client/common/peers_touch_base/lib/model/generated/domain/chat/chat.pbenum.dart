// This is a generated file - do not edit.
//
// Generated from domain/chat/chat.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

class Friend_FriendshipStatus extends $pb.ProtobufEnum {
  static const Friend_FriendshipStatus PENDING =
      Friend_FriendshipStatus._(0, _omitEnumNames ? '' : 'PENDING');
  static const Friend_FriendshipStatus ACCEPTED =
      Friend_FriendshipStatus._(1, _omitEnumNames ? '' : 'ACCEPTED');
  static const Friend_FriendshipStatus BLOCKED =
      Friend_FriendshipStatus._(2, _omitEnumNames ? '' : 'BLOCKED');

  static const $core.List<Friend_FriendshipStatus> values =
      <Friend_FriendshipStatus>[
    PENDING,
    ACCEPTED,
    BLOCKED,
  ];

  static final $core.List<Friend_FriendshipStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static Friend_FriendshipStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const Friend_FriendshipStatus._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
