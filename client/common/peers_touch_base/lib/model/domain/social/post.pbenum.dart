// This is a generated file - do not edit.
//
// Generated from domain/social/post.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

class PostType extends $pb.ProtobufEnum {
  static const PostType TEXT = PostType._(0, _omitEnumNames ? '' : 'TEXT');
  static const PostType IMAGE = PostType._(1, _omitEnumNames ? '' : 'IMAGE');
  static const PostType VIDEO = PostType._(2, _omitEnumNames ? '' : 'VIDEO');
  static const PostType LINK = PostType._(3, _omitEnumNames ? '' : 'LINK');
  static const PostType POLL = PostType._(4, _omitEnumNames ? '' : 'POLL');
  static const PostType REPOST = PostType._(5, _omitEnumNames ? '' : 'REPOST');
  static const PostType LOCATION =
      PostType._(6, _omitEnumNames ? '' : 'LOCATION');

  static const $core.List<PostType> values = <PostType>[
    TEXT,
    IMAGE,
    VIDEO,
    LINK,
    POLL,
    REPOST,
    LOCATION,
  ];

  static final $core.List<PostType?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 6);
  static PostType? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const PostType._(super.value, super.name);
}

class PostVisibility extends $pb.ProtobufEnum {
  static const PostVisibility PUBLIC =
      PostVisibility._(0, _omitEnumNames ? '' : 'PUBLIC');
  static const PostVisibility FOLLOWERS_ONLY =
      PostVisibility._(1, _omitEnumNames ? '' : 'FOLLOWERS_ONLY');
  static const PostVisibility PRIVATE =
      PostVisibility._(2, _omitEnumNames ? '' : 'PRIVATE');

  static const $core.List<PostVisibility> values = <PostVisibility>[
    PUBLIC,
    FOLLOWERS_ONLY,
    PRIVATE,
  ];

  static final $core.List<PostVisibility?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static PostVisibility? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const PostVisibility._(super.value, super.name);
}

class VideoQuality extends $pb.ProtobufEnum {
  static const VideoQuality AUTO =
      VideoQuality._(0, _omitEnumNames ? '' : 'AUTO');
  static const VideoQuality LOW =
      VideoQuality._(1, _omitEnumNames ? '' : 'LOW');
  static const VideoQuality MEDIUM =
      VideoQuality._(2, _omitEnumNames ? '' : 'MEDIUM');
  static const VideoQuality HIGH =
      VideoQuality._(3, _omitEnumNames ? '' : 'HIGH');
  static const VideoQuality HD = VideoQuality._(4, _omitEnumNames ? '' : 'HD');

  static const $core.List<VideoQuality> values = <VideoQuality>[
    AUTO,
    LOW,
    MEDIUM,
    HIGH,
    HD,
  ];

  static final $core.List<VideoQuality?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static VideoQuality? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const VideoQuality._(super.value, super.name);
}

class TimelineType extends $pb.ProtobufEnum {
  static const TimelineType TIMELINE_HOME =
      TimelineType._(0, _omitEnumNames ? '' : 'TIMELINE_HOME');
  static const TimelineType TIMELINE_USER =
      TimelineType._(1, _omitEnumNames ? '' : 'TIMELINE_USER');
  static const TimelineType TIMELINE_PUBLIC =
      TimelineType._(2, _omitEnumNames ? '' : 'TIMELINE_PUBLIC');

  static const $core.List<TimelineType> values = <TimelineType>[
    TIMELINE_HOME,
    TIMELINE_USER,
    TIMELINE_PUBLIC,
  ];

  static final $core.List<TimelineType?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static TimelineType? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const TimelineType._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
