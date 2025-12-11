// This is a generated file - do not edit.
//
// Generated from domain/post/post.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import '../../google/protobuf/timestamp.pb.dart' as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class Attachment extends $pb.GeneratedMessage {
  factory Attachment({
    $core.String? mediaId,
    $core.String? url,
    $core.String? mediaType,
    $core.String? alt,
  }) {
    final result = create();
    if (mediaId != null) result.mediaId = mediaId;
    if (url != null) result.url = url;
    if (mediaType != null) result.mediaType = mediaType;
    if (alt != null) result.alt = alt;
    return result;
  }

  Attachment._();

  factory Attachment.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Attachment.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Attachment',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.post.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'mediaId')
    ..aOS(2, _omitFieldNames ? '' : 'url')
    ..aOS(3, _omitFieldNames ? '' : 'mediaType')
    ..aOS(4, _omitFieldNames ? '' : 'alt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Attachment clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Attachment copyWith(void Function(Attachment) updates) =>
      super.copyWith((message) => updates(message as Attachment)) as Attachment;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Attachment create() => Attachment._();
  @$core.override
  Attachment createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Attachment getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Attachment>(create);
  static Attachment? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get mediaId => $_getSZ(0);
  @$pb.TagNumber(1)
  set mediaId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasMediaId() => $_has(0);
  @$pb.TagNumber(1)
  void clearMediaId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get url => $_getSZ(1);
  @$pb.TagNumber(2)
  set url($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUrl() => $_has(1);
  @$pb.TagNumber(2)
  void clearUrl() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get mediaType => $_getSZ(2);
  @$pb.TagNumber(3)
  set mediaType($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasMediaType() => $_has(2);
  @$pb.TagNumber(3)
  void clearMediaType() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get alt => $_getSZ(3);
  @$pb.TagNumber(4)
  set alt($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasAlt() => $_has(3);
  @$pb.TagNumber(4)
  void clearAlt() => $_clearField(4);
}

class PollOption extends $pb.GeneratedMessage {
  factory PollOption({
    $core.String? text,
  }) {
    final result = create();
    if (text != null) result.text = text;
    return result;
  }

  PollOption._();

  factory PollOption.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PollOption.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PollOption',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.post.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'text')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PollOption clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PollOption copyWith(void Function(PollOption) updates) =>
      super.copyWith((message) => updates(message as PollOption)) as PollOption;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PollOption create() => PollOption._();
  @$core.override
  PollOption createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PollOption getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PollOption>(create);
  static PollOption? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get text => $_getSZ(0);
  @$pb.TagNumber(1)
  set text($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasText() => $_has(0);
  @$pb.TagNumber(1)
  void clearText() => $_clearField(1);
}

class Poll extends $pb.GeneratedMessage {
  factory Poll({
    $core.Iterable<PollOption>? options,
    $core.int? expiresIn,
    $core.bool? multiple,
    $core.bool? hideTotals,
  }) {
    final result = create();
    if (options != null) result.options.addAll(options);
    if (expiresIn != null) result.expiresIn = expiresIn;
    if (multiple != null) result.multiple = multiple;
    if (hideTotals != null) result.hideTotals = hideTotals;
    return result;
  }

  Poll._();

  factory Poll.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Poll.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Poll',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.post.v1'),
      createEmptyInstance: create)
    ..pPM<PollOption>(1, _omitFieldNames ? '' : 'options',
        subBuilder: PollOption.create)
    ..aI(2, _omitFieldNames ? '' : 'expiresIn')
    ..aOB(3, _omitFieldNames ? '' : 'multiple')
    ..aOB(4, _omitFieldNames ? '' : 'hideTotals')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Poll clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Poll copyWith(void Function(Poll) updates) =>
      super.copyWith((message) => updates(message as Poll)) as Poll;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Poll create() => Poll._();
  @$core.override
  Poll createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Poll getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Poll>(create);
  static Poll? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<PollOption> get options => $_getList(0);

  @$pb.TagNumber(2)
  $core.int get expiresIn => $_getIZ(1);
  @$pb.TagNumber(2)
  set expiresIn($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasExpiresIn() => $_has(1);
  @$pb.TagNumber(2)
  void clearExpiresIn() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.bool get multiple => $_getBF(2);
  @$pb.TagNumber(3)
  set multiple($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasMultiple() => $_has(2);
  @$pb.TagNumber(3)
  void clearMultiple() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.bool get hideTotals => $_getBF(3);
  @$pb.TagNumber(4)
  set hideTotals($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasHideTotals() => $_has(3);
  @$pb.TagNumber(4)
  void clearHideTotals() => $_clearField(4);
}

class PostInput extends $pb.GeneratedMessage {
  factory PostInput({
    $core.String? text,
    $core.Iterable<Attachment>? attachments,
    $core.Iterable<$core.String>? tags,
    $core.String? visibility,
    $core.Iterable<$core.String>? audience,
    $core.String? cw,
    $core.bool? sensitive,
    $core.String? replyTo,
    Poll? poll,
    $0.Timestamp? clientTime,
  }) {
    final result = create();
    if (text != null) result.text = text;
    if (attachments != null) result.attachments.addAll(attachments);
    if (tags != null) result.tags.addAll(tags);
    if (visibility != null) result.visibility = visibility;
    if (audience != null) result.audience.addAll(audience);
    if (cw != null) result.cw = cw;
    if (sensitive != null) result.sensitive = sensitive;
    if (replyTo != null) result.replyTo = replyTo;
    if (poll != null) result.poll = poll;
    if (clientTime != null) result.clientTime = clientTime;
    return result;
  }

  PostInput._();

  factory PostInput.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostInput.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostInput',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.post.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'text')
    ..pPM<Attachment>(2, _omitFieldNames ? '' : 'attachments',
        subBuilder: Attachment.create)
    ..pPS(3, _omitFieldNames ? '' : 'tags')
    ..aOS(4, _omitFieldNames ? '' : 'visibility')
    ..pPS(5, _omitFieldNames ? '' : 'audience')
    ..aOS(6, _omitFieldNames ? '' : 'cw')
    ..aOB(7, _omitFieldNames ? '' : 'sensitive')
    ..aOS(8, _omitFieldNames ? '' : 'replyTo')
    ..aOM<Poll>(9, _omitFieldNames ? '' : 'poll', subBuilder: Poll.create)
    ..aOM<$0.Timestamp>(10, _omitFieldNames ? '' : 'clientTime',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostInput clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostInput copyWith(void Function(PostInput) updates) =>
      super.copyWith((message) => updates(message as PostInput)) as PostInput;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostInput create() => PostInput._();
  @$core.override
  PostInput createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostInput getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<PostInput>(create);
  static PostInput? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get text => $_getSZ(0);
  @$pb.TagNumber(1)
  set text($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasText() => $_has(0);
  @$pb.TagNumber(1)
  void clearText() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<Attachment> get attachments => $_getList(1);

  @$pb.TagNumber(3)
  $pb.PbList<$core.String> get tags => $_getList(2);

  @$pb.TagNumber(4)
  $core.String get visibility => $_getSZ(3);
  @$pb.TagNumber(4)
  set visibility($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasVisibility() => $_has(3);
  @$pb.TagNumber(4)
  void clearVisibility() => $_clearField(4);

  @$pb.TagNumber(5)
  $pb.PbList<$core.String> get audience => $_getList(4);

  @$pb.TagNumber(6)
  $core.String get cw => $_getSZ(5);
  @$pb.TagNumber(6)
  set cw($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasCw() => $_has(5);
  @$pb.TagNumber(6)
  void clearCw() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.bool get sensitive => $_getBF(6);
  @$pb.TagNumber(7)
  set sensitive($core.bool value) => $_setBool(6, value);
  @$pb.TagNumber(7)
  $core.bool hasSensitive() => $_has(6);
  @$pb.TagNumber(7)
  void clearSensitive() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get replyTo => $_getSZ(7);
  @$pb.TagNumber(8)
  set replyTo($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasReplyTo() => $_has(7);
  @$pb.TagNumber(8)
  void clearReplyTo() => $_clearField(8);

  @$pb.TagNumber(9)
  Poll get poll => $_getN(8);
  @$pb.TagNumber(9)
  set poll(Poll value) => $_setField(9, value);
  @$pb.TagNumber(9)
  $core.bool hasPoll() => $_has(8);
  @$pb.TagNumber(9)
  void clearPoll() => $_clearField(9);
  @$pb.TagNumber(9)
  Poll ensurePoll() => $_ensure(8);

  @$pb.TagNumber(10)
  $0.Timestamp get clientTime => $_getN(9);
  @$pb.TagNumber(10)
  set clientTime($0.Timestamp value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasClientTime() => $_has(9);
  @$pb.TagNumber(10)
  void clearClientTime() => $_clearField(10);
  @$pb.TagNumber(10)
  $0.Timestamp ensureClientTime() => $_ensure(9);
}

class PostResponse extends $pb.GeneratedMessage {
  factory PostResponse({
    $core.String? postId,
    $core.String? activityId,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    if (activityId != null) result.activityId = activityId;
    return result;
  }

  PostResponse._();

  factory PostResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.post.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'postId')
    ..aOS(2, _omitFieldNames ? '' : 'activityId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostResponse copyWith(void Function(PostResponse) updates) =>
      super.copyWith((message) => updates(message as PostResponse))
          as PostResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostResponse create() => PostResponse._();
  @$core.override
  PostResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostResponse>(create);
  static PostResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get postId => $_getSZ(0);
  @$pb.TagNumber(1)
  set postId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get activityId => $_getSZ(1);
  @$pb.TagNumber(2)
  set activityId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasActivityId() => $_has(1);
  @$pb.TagNumber(2)
  void clearActivityId() => $_clearField(2);
}

class MediaUploadResponse extends $pb.GeneratedMessage {
  factory MediaUploadResponse({
    $core.String? mediaId,
    $core.String? url,
    $core.String? mediaType,
    $core.String? alt,
  }) {
    final result = create();
    if (mediaId != null) result.mediaId = mediaId;
    if (url != null) result.url = url;
    if (mediaType != null) result.mediaType = mediaType;
    if (alt != null) result.alt = alt;
    return result;
  }

  MediaUploadResponse._();

  factory MediaUploadResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MediaUploadResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MediaUploadResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.post.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'mediaId')
    ..aOS(2, _omitFieldNames ? '' : 'url')
    ..aOS(3, _omitFieldNames ? '' : 'mediaType')
    ..aOS(4, _omitFieldNames ? '' : 'alt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MediaUploadResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MediaUploadResponse copyWith(void Function(MediaUploadResponse) updates) =>
      super.copyWith((message) => updates(message as MediaUploadResponse))
          as MediaUploadResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MediaUploadResponse create() => MediaUploadResponse._();
  @$core.override
  MediaUploadResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MediaUploadResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MediaUploadResponse>(create);
  static MediaUploadResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get mediaId => $_getSZ(0);
  @$pb.TagNumber(1)
  set mediaId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasMediaId() => $_has(0);
  @$pb.TagNumber(1)
  void clearMediaId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get url => $_getSZ(1);
  @$pb.TagNumber(2)
  set url($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUrl() => $_has(1);
  @$pb.TagNumber(2)
  void clearUrl() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get mediaType => $_getSZ(2);
  @$pb.TagNumber(3)
  set mediaType($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasMediaType() => $_has(2);
  @$pb.TagNumber(3)
  void clearMediaType() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get alt => $_getSZ(3);
  @$pb.TagNumber(4)
  set alt($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasAlt() => $_has(3);
  @$pb.TagNumber(4)
  void clearAlt() => $_clearField(4);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
