// This is a generated file - do not edit.
//
// Generated from common.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

/// HealthStatus represents the health status of a component.
class HealthStatus extends $pb.ProtobufEnum {
  static const HealthStatus HEALTH_STATUS_UNKNOWN =
      HealthStatus._(0, _omitEnumNames ? '' : 'HEALTH_STATUS_UNKNOWN');
  static const HealthStatus HEALTH_STATUS_HEALTHY =
      HealthStatus._(1, _omitEnumNames ? '' : 'HEALTH_STATUS_HEALTHY');
  static const HealthStatus HEALTH_STATUS_DEGRADED =
      HealthStatus._(2, _omitEnumNames ? '' : 'HEALTH_STATUS_DEGRADED');
  static const HealthStatus HEALTH_STATUS_UNHEALTHY =
      HealthStatus._(3, _omitEnumNames ? '' : 'HEALTH_STATUS_UNHEALTHY');

  static const $core.List<HealthStatus> values = <HealthStatus>[
    HEALTH_STATUS_UNKNOWN,
    HEALTH_STATUS_HEALTHY,
    HEALTH_STATUS_DEGRADED,
    HEALTH_STATUS_UNHEALTHY,
  ];

  static final $core.List<HealthStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static HealthStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const HealthStatus._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
