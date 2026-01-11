// This is a generated file - do not edit.
//
// Generated from domain/social/media.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

class MediaUploadType extends $pb.ProtobufEnum {
  static const MediaUploadType MEDIA_IMAGE =
      MediaUploadType._(0, _omitEnumNames ? '' : 'MEDIA_IMAGE');
  static const MediaUploadType MEDIA_VIDEO =
      MediaUploadType._(1, _omitEnumNames ? '' : 'MEDIA_VIDEO');
  static const MediaUploadType MEDIA_AUDIO =
      MediaUploadType._(2, _omitEnumNames ? '' : 'MEDIA_AUDIO');

  static const $core.List<MediaUploadType> values = <MediaUploadType>[
    MEDIA_IMAGE,
    MEDIA_VIDEO,
    MEDIA_AUDIO,
  ];

  static final $core.List<MediaUploadType?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static MediaUploadType? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const MediaUploadType._(super.value, super.name);
}

class MediaProcessingStatus extends $pb.ProtobufEnum {
  static const MediaProcessingStatus PENDING =
      MediaProcessingStatus._(0, _omitEnumNames ? '' : 'PENDING');
  static const MediaProcessingStatus PROCESSING =
      MediaProcessingStatus._(1, _omitEnumNames ? '' : 'PROCESSING');
  static const MediaProcessingStatus READY =
      MediaProcessingStatus._(2, _omitEnumNames ? '' : 'READY');
  static const MediaProcessingStatus FAILED =
      MediaProcessingStatus._(3, _omitEnumNames ? '' : 'FAILED');

  static const $core.List<MediaProcessingStatus> values =
      <MediaProcessingStatus>[
    PENDING,
    PROCESSING,
    READY,
    FAILED,
  ];

  static final $core.List<MediaProcessingStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static MediaProcessingStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const MediaProcessingStatus._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
