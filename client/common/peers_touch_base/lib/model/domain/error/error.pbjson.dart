// This is a generated file - do not edit.
//
// Generated from domain/error/error.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports
// ignore_for_file: unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use errorCodeDescriptor instead')
const ErrorCode$json = {
  '1': 'ErrorCode',
  '2': [
    {'1': 'ERROR_CODE_UNSPECIFIED', '2': 0},
    {'1': 'ERROR_CODE_UNDEFINED', '2': 1},
    {'1': 'ERROR_CODE_WELL_KNOWN_INVALID_RESOURCE_FORMAT', '2': 10001},
    {'1': 'ERROR_CODE_WELL_KNOWN_UNSUPPORTED_PREFIX_TYPE', '2': 10002},
    {'1': 'ERROR_CODE_ACTOR_INVALID_NAME', '2': 10003},
    {'1': 'ERROR_CODE_ACTOR_INVALID_EMAIL', '2': 10004},
    {'1': 'ERROR_CODE_ACTOR_INVALID_PASSWORD', '2': 10005},
    {'1': 'ERROR_CODE_ACTOR_EXISTS', '2': 10006},
    {'1': 'ERROR_CODE_ACTOR_INVALID_PASSPORT', '2': 10007},
    {'1': 'ERROR_CODE_ACTOR_NOT_FOUND', '2': 10008},
    {'1': 'ERROR_CODE_ACTOR_INVALID_CREDENTIALS', '2': 10009},
    {'1': 'ERROR_CODE_PEER_ADDR_EXISTS', '2': 10010},
    {'1': 'ERROR_CODE_UNAUTHORIZED', '2': 20001},
    {'1': 'ERROR_CODE_INVALID_REQUEST', '2': 20002},
    {'1': 'ERROR_CODE_INVALID_QUERY_PARAMETERS', '2': 20003},
    {'1': 'ERROR_CODE_INVALID_REQUEST_BODY', '2': 20004},
    {'1': 'ERROR_CODE_INVALID_PROTOBUF', '2': 20005},
    {'1': 'ERROR_CODE_FAILED_TO_READ_BODY', '2': 20006},
    {'1': 'ERROR_CODE_METHOD_NOT_ALLOWED', '2': 20007},
    {'1': 'ERROR_CODE_INTERNAL_SERVER_ERROR', '2': 20008},
    {'1': 'ERROR_CODE_POST_ID_REQUIRED', '2': 30001},
    {'1': 'ERROR_CODE_POST_NOT_FOUND', '2': 30002},
    {'1': 'ERROR_CODE_USER_ID_REQUIRED', '2': 30003},
    {'1': 'ERROR_CODE_CREATE_POST_FAILED', '2': 30004},
    {'1': 'ERROR_CODE_UPDATE_POST_FAILED', '2': 30005},
    {'1': 'ERROR_CODE_DELETE_POST_FAILED', '2': 30006},
    {'1': 'ERROR_CODE_LIKE_POST_FAILED', '2': 30007},
    {'1': 'ERROR_CODE_UNLIKE_POST_FAILED', '2': 30008},
    {'1': 'ERROR_CODE_GET_POST_FAILED', '2': 30009},
    {'1': 'ERROR_CODE_LIST_POSTS_FAILED', '2': 30010},
    {'1': 'ERROR_CODE_REPOST_FAILED', '2': 30011},
    {'1': 'ERROR_CODE_GET_LIKERS_FAILED', '2': 30012},
    {'1': 'ERROR_CODE_GET_TIMELINE_FAILED', '2': 30013},
    {'1': 'ERROR_CODE_COMMENT_ID_REQUIRED', '2': 30014},
    {'1': 'ERROR_CODE_CREATE_COMMENT_FAILED', '2': 30015},
    {'1': 'ERROR_CODE_GET_COMMENTS_FAILED', '2': 30016},
    {'1': 'ERROR_CODE_DELETE_COMMENT_FAILED', '2': 30017},
  ],
};

/// Descriptor for `ErrorCode`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List errorCodeDescriptor = $convert.base64Decode(
    'CglFcnJvckNvZGUSGgoWRVJST1JfQ09ERV9VTlNQRUNJRklFRBAAEhgKFEVSUk9SX0NPREVfVU'
    '5ERUZJTkVEEAESMgotRVJST1JfQ09ERV9XRUxMX0tOT1dOX0lOVkFMSURfUkVTT1VSQ0VfRk9S'
    'TUFUEJFOEjIKLUVSUk9SX0NPREVfV0VMTF9LTk9XTl9VTlNVUFBPUlRFRF9QUkVGSVhfVFlQRR'
    'CSThIiCh1FUlJPUl9DT0RFX0FDVE9SX0lOVkFMSURfTkFNRRCTThIjCh5FUlJPUl9DT0RFX0FD'
    'VE9SX0lOVkFMSURfRU1BSUwQlE4SJgohRVJST1JfQ09ERV9BQ1RPUl9JTlZBTElEX1BBU1NXT1'
    'JEEJVOEhwKF0VSUk9SX0NPREVfQUNUT1JfRVhJU1RTEJZOEiYKIUVSUk9SX0NPREVfQUNUT1Jf'
    'SU5WQUxJRF9QQVNTUE9SVBCXThIfChpFUlJPUl9DT0RFX0FDVE9SX05PVF9GT1VORBCYThIpCi'
    'RFUlJPUl9DT0RFX0FDVE9SX0lOVkFMSURfQ1JFREVOVElBTFMQmU4SIAobRVJST1JfQ09ERV9Q'
    'RUVSX0FERFJfRVhJU1RTEJpOEh0KF0VSUk9SX0NPREVfVU5BVVRIT1JJWkVEEKGcARIgChpFUl'
    'JPUl9DT0RFX0lOVkFMSURfUkVRVUVTVBCinAESKQojRVJST1JfQ09ERV9JTlZBTElEX1FVRVJZ'
    'X1BBUkFNRVRFUlMQo5wBEiUKH0VSUk9SX0NPREVfSU5WQUxJRF9SRVFVRVNUX0JPRFkQpJwBEi'
    'EKG0VSUk9SX0NPREVfSU5WQUxJRF9QUk9UT0JVRhClnAESJAoeRVJST1JfQ09ERV9GQUlMRURf'
    'VE9fUkVBRF9CT0RZEKacARIjCh1FUlJPUl9DT0RFX01FVEhPRF9OT1RfQUxMT1dFRBCnnAESJg'
    'ogRVJST1JfQ09ERV9JTlRFUk5BTF9TRVJWRVJfRVJST1IQqJwBEiEKG0VSUk9SX0NPREVfUE9T'
    'VF9JRF9SRVFVSVJFRBCx6gESHwoZRVJST1JfQ09ERV9QT1NUX05PVF9GT1VORBCy6gESIQobRV'
    'JST1JfQ09ERV9VU0VSX0lEX1JFUVVJUkVEELPqARIjCh1FUlJPUl9DT0RFX0NSRUFURV9QT1NU'
    'X0ZBSUxFRBC06gESIwodRVJST1JfQ09ERV9VUERBVEVfUE9TVF9GQUlMRUQQteoBEiMKHUVSUk'
    '9SX0NPREVfREVMRVRFX1BPU1RfRkFJTEVEELbqARIhChtFUlJPUl9DT0RFX0xJS0VfUE9TVF9G'
    'QUlMRUQQt+oBEiMKHUVSUk9SX0NPREVfVU5MSUtFX1BPU1RfRkFJTEVEELjqARIgChpFUlJPUl'
    '9DT0RFX0dFVF9QT1NUX0ZBSUxFRBC56gESIgocRVJST1JfQ09ERV9MSVNUX1BPU1RTX0ZBSUxF'
    'RBC66gESHgoYRVJST1JfQ09ERV9SRVBPU1RfRkFJTEVEELvqARIiChxFUlJPUl9DT0RFX0dFVF'
    '9MSUtFUlNfRkFJTEVEELzqARIkCh5FUlJPUl9DT0RFX0dFVF9USU1FTElORV9GQUlMRUQQveoB'
    'EiQKHkVSUk9SX0NPREVfQ09NTUVOVF9JRF9SRVFVSVJFRBC+6gESJgogRVJST1JfQ09ERV9DUk'
    'VBVEVfQ09NTUVOVF9GQUlMRUQQv+oBEiQKHkVSUk9SX0NPREVfR0VUX0NPTU1FTlRTX0ZBSUxF'
    'RBDA6gESJgogRVJST1JfQ09ERV9ERUxFVEVfQ09NTUVOVF9GQUlMRUQQweoB');

@$core.Deprecated('Use errorResponseDescriptor instead')
const ErrorResponse$json = {
  '1': 'ErrorResponse',
  '2': [
    {
      '1': 'code',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.peers_touch.model.error.v1.ErrorCode',
      '10': 'code'
    },
    {'1': 'message', '3': 2, '4': 1, '5': 9, '10': 'message'},
    {
      '1': 'details',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.peers_touch.model.error.v1.ErrorResponse.DetailsEntry',
      '10': 'details'
    },
  ],
  '3': [ErrorResponse_DetailsEntry$json],
};

@$core.Deprecated('Use errorResponseDescriptor instead')
const ErrorResponse_DetailsEntry$json = {
  '1': 'DetailsEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `ErrorResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List errorResponseDescriptor = $convert.base64Decode(
    'Cg1FcnJvclJlc3BvbnNlEjkKBGNvZGUYASABKA4yJS5wZWVyc190b3VjaC5tb2RlbC5lcnJvci'
    '52MS5FcnJvckNvZGVSBGNvZGUSGAoHbWVzc2FnZRgCIAEoCVIHbWVzc2FnZRJQCgdkZXRhaWxz'
    'GAMgAygLMjYucGVlcnNfdG91Y2gubW9kZWwuZXJyb3IudjEuRXJyb3JSZXNwb25zZS5EZXRhaW'
    'xzRW50cnlSB2RldGFpbHMaOgoMRGV0YWlsc0VudHJ5EhAKA2tleRgBIAEoCVIDa2V5EhQKBXZh'
    'bHVlGAIgASgJUgV2YWx1ZToCOAE=');
