// This is a generated file - do not edit.
//
// Generated from domain/error/error.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

class ErrorCode extends $pb.ProtobufEnum {
  static const ErrorCode ERROR_CODE_UNSPECIFIED =
      ErrorCode._(0, _omitEnumNames ? '' : 'ERROR_CODE_UNSPECIFIED');
  static const ErrorCode ERROR_CODE_UNDEFINED =
      ErrorCode._(1, _omitEnumNames ? '' : 'ERROR_CODE_UNDEFINED');
  static const ErrorCode ERROR_CODE_WELL_KNOWN_INVALID_RESOURCE_FORMAT =
      ErrorCode._(
          10001,
          _omitEnumNames
              ? ''
              : 'ERROR_CODE_WELL_KNOWN_INVALID_RESOURCE_FORMAT');
  static const ErrorCode ERROR_CODE_WELL_KNOWN_UNSUPPORTED_PREFIX_TYPE =
      ErrorCode._(
          10002,
          _omitEnumNames
              ? ''
              : 'ERROR_CODE_WELL_KNOWN_UNSUPPORTED_PREFIX_TYPE');
  static const ErrorCode ERROR_CODE_ACTOR_INVALID_NAME =
      ErrorCode._(10003, _omitEnumNames ? '' : 'ERROR_CODE_ACTOR_INVALID_NAME');
  static const ErrorCode ERROR_CODE_ACTOR_INVALID_EMAIL = ErrorCode._(
      10004, _omitEnumNames ? '' : 'ERROR_CODE_ACTOR_INVALID_EMAIL');
  static const ErrorCode ERROR_CODE_ACTOR_INVALID_PASSWORD = ErrorCode._(
      10005, _omitEnumNames ? '' : 'ERROR_CODE_ACTOR_INVALID_PASSWORD');
  static const ErrorCode ERROR_CODE_ACTOR_EXISTS =
      ErrorCode._(10006, _omitEnumNames ? '' : 'ERROR_CODE_ACTOR_EXISTS');
  static const ErrorCode ERROR_CODE_ACTOR_INVALID_PASSPORT = ErrorCode._(
      10007, _omitEnumNames ? '' : 'ERROR_CODE_ACTOR_INVALID_PASSPORT');
  static const ErrorCode ERROR_CODE_ACTOR_NOT_FOUND =
      ErrorCode._(10008, _omitEnumNames ? '' : 'ERROR_CODE_ACTOR_NOT_FOUND');
  static const ErrorCode ERROR_CODE_ACTOR_INVALID_CREDENTIALS = ErrorCode._(
      10009, _omitEnumNames ? '' : 'ERROR_CODE_ACTOR_INVALID_CREDENTIALS');
  static const ErrorCode ERROR_CODE_PEER_ADDR_EXISTS =
      ErrorCode._(10010, _omitEnumNames ? '' : 'ERROR_CODE_PEER_ADDR_EXISTS');
  static const ErrorCode ERROR_CODE_UNAUTHORIZED =
      ErrorCode._(20001, _omitEnumNames ? '' : 'ERROR_CODE_UNAUTHORIZED');
  static const ErrorCode ERROR_CODE_INVALID_REQUEST =
      ErrorCode._(20002, _omitEnumNames ? '' : 'ERROR_CODE_INVALID_REQUEST');
  static const ErrorCode ERROR_CODE_INVALID_QUERY_PARAMETERS = ErrorCode._(
      20003, _omitEnumNames ? '' : 'ERROR_CODE_INVALID_QUERY_PARAMETERS');
  static const ErrorCode ERROR_CODE_INVALID_REQUEST_BODY = ErrorCode._(
      20004, _omitEnumNames ? '' : 'ERROR_CODE_INVALID_REQUEST_BODY');
  static const ErrorCode ERROR_CODE_INVALID_PROTOBUF =
      ErrorCode._(20005, _omitEnumNames ? '' : 'ERROR_CODE_INVALID_PROTOBUF');
  static const ErrorCode ERROR_CODE_FAILED_TO_READ_BODY = ErrorCode._(
      20006, _omitEnumNames ? '' : 'ERROR_CODE_FAILED_TO_READ_BODY');
  static const ErrorCode ERROR_CODE_METHOD_NOT_ALLOWED =
      ErrorCode._(20007, _omitEnumNames ? '' : 'ERROR_CODE_METHOD_NOT_ALLOWED');
  static const ErrorCode ERROR_CODE_INTERNAL_SERVER_ERROR = ErrorCode._(
      20008, _omitEnumNames ? '' : 'ERROR_CODE_INTERNAL_SERVER_ERROR');
  static const ErrorCode ERROR_CODE_POST_ID_REQUIRED =
      ErrorCode._(30001, _omitEnumNames ? '' : 'ERROR_CODE_POST_ID_REQUIRED');
  static const ErrorCode ERROR_CODE_POST_NOT_FOUND =
      ErrorCode._(30002, _omitEnumNames ? '' : 'ERROR_CODE_POST_NOT_FOUND');
  static const ErrorCode ERROR_CODE_USER_ID_REQUIRED =
      ErrorCode._(30003, _omitEnumNames ? '' : 'ERROR_CODE_USER_ID_REQUIRED');
  static const ErrorCode ERROR_CODE_CREATE_POST_FAILED =
      ErrorCode._(30004, _omitEnumNames ? '' : 'ERROR_CODE_CREATE_POST_FAILED');
  static const ErrorCode ERROR_CODE_UPDATE_POST_FAILED =
      ErrorCode._(30005, _omitEnumNames ? '' : 'ERROR_CODE_UPDATE_POST_FAILED');
  static const ErrorCode ERROR_CODE_DELETE_POST_FAILED =
      ErrorCode._(30006, _omitEnumNames ? '' : 'ERROR_CODE_DELETE_POST_FAILED');
  static const ErrorCode ERROR_CODE_LIKE_POST_FAILED =
      ErrorCode._(30007, _omitEnumNames ? '' : 'ERROR_CODE_LIKE_POST_FAILED');
  static const ErrorCode ERROR_CODE_UNLIKE_POST_FAILED =
      ErrorCode._(30008, _omitEnumNames ? '' : 'ERROR_CODE_UNLIKE_POST_FAILED');
  static const ErrorCode ERROR_CODE_GET_POST_FAILED =
      ErrorCode._(30009, _omitEnumNames ? '' : 'ERROR_CODE_GET_POST_FAILED');
  static const ErrorCode ERROR_CODE_LIST_POSTS_FAILED =
      ErrorCode._(30010, _omitEnumNames ? '' : 'ERROR_CODE_LIST_POSTS_FAILED');
  static const ErrorCode ERROR_CODE_REPOST_FAILED =
      ErrorCode._(30011, _omitEnumNames ? '' : 'ERROR_CODE_REPOST_FAILED');
  static const ErrorCode ERROR_CODE_GET_LIKERS_FAILED =
      ErrorCode._(30012, _omitEnumNames ? '' : 'ERROR_CODE_GET_LIKERS_FAILED');
  static const ErrorCode ERROR_CODE_GET_TIMELINE_FAILED = ErrorCode._(
      30013, _omitEnumNames ? '' : 'ERROR_CODE_GET_TIMELINE_FAILED');
  static const ErrorCode ERROR_CODE_COMMENT_ID_REQUIRED = ErrorCode._(
      30014, _omitEnumNames ? '' : 'ERROR_CODE_COMMENT_ID_REQUIRED');
  static const ErrorCode ERROR_CODE_CREATE_COMMENT_FAILED = ErrorCode._(
      30015, _omitEnumNames ? '' : 'ERROR_CODE_CREATE_COMMENT_FAILED');
  static const ErrorCode ERROR_CODE_GET_COMMENTS_FAILED = ErrorCode._(
      30016, _omitEnumNames ? '' : 'ERROR_CODE_GET_COMMENTS_FAILED');
  static const ErrorCode ERROR_CODE_DELETE_COMMENT_FAILED = ErrorCode._(
      30017, _omitEnumNames ? '' : 'ERROR_CODE_DELETE_COMMENT_FAILED');

  static const $core.List<ErrorCode> values = <ErrorCode>[
    ERROR_CODE_UNSPECIFIED,
    ERROR_CODE_UNDEFINED,
    ERROR_CODE_WELL_KNOWN_INVALID_RESOURCE_FORMAT,
    ERROR_CODE_WELL_KNOWN_UNSUPPORTED_PREFIX_TYPE,
    ERROR_CODE_ACTOR_INVALID_NAME,
    ERROR_CODE_ACTOR_INVALID_EMAIL,
    ERROR_CODE_ACTOR_INVALID_PASSWORD,
    ERROR_CODE_ACTOR_EXISTS,
    ERROR_CODE_ACTOR_INVALID_PASSPORT,
    ERROR_CODE_ACTOR_NOT_FOUND,
    ERROR_CODE_ACTOR_INVALID_CREDENTIALS,
    ERROR_CODE_PEER_ADDR_EXISTS,
    ERROR_CODE_UNAUTHORIZED,
    ERROR_CODE_INVALID_REQUEST,
    ERROR_CODE_INVALID_QUERY_PARAMETERS,
    ERROR_CODE_INVALID_REQUEST_BODY,
    ERROR_CODE_INVALID_PROTOBUF,
    ERROR_CODE_FAILED_TO_READ_BODY,
    ERROR_CODE_METHOD_NOT_ALLOWED,
    ERROR_CODE_INTERNAL_SERVER_ERROR,
    ERROR_CODE_POST_ID_REQUIRED,
    ERROR_CODE_POST_NOT_FOUND,
    ERROR_CODE_USER_ID_REQUIRED,
    ERROR_CODE_CREATE_POST_FAILED,
    ERROR_CODE_UPDATE_POST_FAILED,
    ERROR_CODE_DELETE_POST_FAILED,
    ERROR_CODE_LIKE_POST_FAILED,
    ERROR_CODE_UNLIKE_POST_FAILED,
    ERROR_CODE_GET_POST_FAILED,
    ERROR_CODE_LIST_POSTS_FAILED,
    ERROR_CODE_REPOST_FAILED,
    ERROR_CODE_GET_LIKERS_FAILED,
    ERROR_CODE_GET_TIMELINE_FAILED,
    ERROR_CODE_COMMENT_ID_REQUIRED,
    ERROR_CODE_CREATE_COMMENT_FAILED,
    ERROR_CODE_GET_COMMENTS_FAILED,
    ERROR_CODE_DELETE_COMMENT_FAILED,
  ];

  static final $core.Map<$core.int, ErrorCode> _byValue =
      $pb.ProtobufEnum.initByValue(values);
  static ErrorCode? valueOf($core.int value) => _byValue[value];

  const ErrorCode._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
