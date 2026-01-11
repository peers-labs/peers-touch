// This is a generated file - do not edit.
//
// Generated from domain/social/comment.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

class CommentSort extends $pb.ProtobufEnum {
  static const CommentSort NEWEST =
      CommentSort._(0, _omitEnumNames ? '' : 'NEWEST');
  static const CommentSort OLDEST =
      CommentSort._(1, _omitEnumNames ? '' : 'OLDEST');
  static const CommentSort MOST_LIKED =
      CommentSort._(2, _omitEnumNames ? '' : 'MOST_LIKED');

  static const $core.List<CommentSort> values = <CommentSort>[
    NEWEST,
    OLDEST,
    MOST_LIKED,
  ];

  static final $core.List<CommentSort?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static CommentSort? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const CommentSort._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
