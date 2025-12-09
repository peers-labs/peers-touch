// This is a generated file - do not edit.
//
// Generated from domain/mastodon/status.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

import '../../google/protobuf/timestamp.pb.dart' as $0;
import 'account.pb.dart' as $1;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class MastodonMediaAttachment extends $pb.GeneratedMessage {
  factory MastodonMediaAttachment({
    $core.String? id,
    $core.String? type,
    $core.String? url,
    $core.String? previewUrl,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (type != null) result.type = type;
    if (url != null) result.url = url;
    if (previewUrl != null) result.previewUrl = previewUrl;
    return result;
  }

  MastodonMediaAttachment._();

  factory MastodonMediaAttachment.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MastodonMediaAttachment.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MastodonMediaAttachment',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.mastodon.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'type')
    ..aOS(3, _omitFieldNames ? '' : 'url')
    ..aOS(4, _omitFieldNames ? '' : 'previewUrl')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastodonMediaAttachment clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastodonMediaAttachment copyWith(
          void Function(MastodonMediaAttachment) updates) =>
      super.copyWith((message) => updates(message as MastodonMediaAttachment))
          as MastodonMediaAttachment;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MastodonMediaAttachment create() => MastodonMediaAttachment._();
  @$core.override
  MastodonMediaAttachment createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MastodonMediaAttachment getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MastodonMediaAttachment>(create);
  static MastodonMediaAttachment? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get type => $_getSZ(1);
  @$pb.TagNumber(2)
  set type($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasType() => $_has(1);
  @$pb.TagNumber(2)
  void clearType() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get url => $_getSZ(2);
  @$pb.TagNumber(3)
  set url($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasUrl() => $_has(2);
  @$pb.TagNumber(3)
  void clearUrl() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get previewUrl => $_getSZ(3);
  @$pb.TagNumber(4)
  set previewUrl($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasPreviewUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearPreviewUrl() => $_clearField(4);
}

class MastodonStatus extends $pb.GeneratedMessage {
  factory MastodonStatus({
    $core.String? id,
    $core.String? uri,
    $0.Timestamp? createdAt,
    $core.String? content,
    $core.String? visibility,
    $fixnum.Int64? reblogsCount,
    $fixnum.Int64? favouritesCount,
    $core.String? inReplyToId,
    $core.String? reblogId,
    $1.MastodonAccount? account,
    $core.Iterable<MastodonMediaAttachment>? mediaAttachments,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (uri != null) result.uri = uri;
    if (createdAt != null) result.createdAt = createdAt;
    if (content != null) result.content = content;
    if (visibility != null) result.visibility = visibility;
    if (reblogsCount != null) result.reblogsCount = reblogsCount;
    if (favouritesCount != null) result.favouritesCount = favouritesCount;
    if (inReplyToId != null) result.inReplyToId = inReplyToId;
    if (reblogId != null) result.reblogId = reblogId;
    if (account != null) result.account = account;
    if (mediaAttachments != null)
      result.mediaAttachments.addAll(mediaAttachments);
    return result;
  }

  MastodonStatus._();

  factory MastodonStatus.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MastodonStatus.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MastodonStatus',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.mastodon.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'uri')
    ..aOM<$0.Timestamp>(3, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOS(4, _omitFieldNames ? '' : 'content')
    ..aOS(5, _omitFieldNames ? '' : 'visibility')
    ..aInt64(6, _omitFieldNames ? '' : 'reblogsCount')
    ..aInt64(7, _omitFieldNames ? '' : 'favouritesCount')
    ..aOS(8, _omitFieldNames ? '' : 'inReplyToId')
    ..aOS(9, _omitFieldNames ? '' : 'reblogId')
    ..aOM<$1.MastodonAccount>(10, _omitFieldNames ? '' : 'account',
        subBuilder: $1.MastodonAccount.create)
    ..pPM<MastodonMediaAttachment>(
        11, _omitFieldNames ? '' : 'mediaAttachments',
        subBuilder: MastodonMediaAttachment.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastodonStatus clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastodonStatus copyWith(void Function(MastodonStatus) updates) =>
      super.copyWith((message) => updates(message as MastodonStatus))
          as MastodonStatus;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MastodonStatus create() => MastodonStatus._();
  @$core.override
  MastodonStatus createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MastodonStatus getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MastodonStatus>(create);
  static MastodonStatus? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get uri => $_getSZ(1);
  @$pb.TagNumber(2)
  set uri($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUri() => $_has(1);
  @$pb.TagNumber(2)
  void clearUri() => $_clearField(2);

  @$pb.TagNumber(3)
  $0.Timestamp get createdAt => $_getN(2);
  @$pb.TagNumber(3)
  set createdAt($0.Timestamp value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasCreatedAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearCreatedAt() => $_clearField(3);
  @$pb.TagNumber(3)
  $0.Timestamp ensureCreatedAt() => $_ensure(2);

  @$pb.TagNumber(4)
  $core.String get content => $_getSZ(3);
  @$pb.TagNumber(4)
  set content($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasContent() => $_has(3);
  @$pb.TagNumber(4)
  void clearContent() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get visibility => $_getSZ(4);
  @$pb.TagNumber(5)
  set visibility($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasVisibility() => $_has(4);
  @$pb.TagNumber(5)
  void clearVisibility() => $_clearField(5);

  @$pb.TagNumber(6)
  $fixnum.Int64 get reblogsCount => $_getI64(5);
  @$pb.TagNumber(6)
  set reblogsCount($fixnum.Int64 value) => $_setInt64(5, value);
  @$pb.TagNumber(6)
  $core.bool hasReblogsCount() => $_has(5);
  @$pb.TagNumber(6)
  void clearReblogsCount() => $_clearField(6);

  @$pb.TagNumber(7)
  $fixnum.Int64 get favouritesCount => $_getI64(6);
  @$pb.TagNumber(7)
  set favouritesCount($fixnum.Int64 value) => $_setInt64(6, value);
  @$pb.TagNumber(7)
  $core.bool hasFavouritesCount() => $_has(6);
  @$pb.TagNumber(7)
  void clearFavouritesCount() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get inReplyToId => $_getSZ(7);
  @$pb.TagNumber(8)
  set inReplyToId($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasInReplyToId() => $_has(7);
  @$pb.TagNumber(8)
  void clearInReplyToId() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.String get reblogId => $_getSZ(8);
  @$pb.TagNumber(9)
  set reblogId($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasReblogId() => $_has(8);
  @$pb.TagNumber(9)
  void clearReblogId() => $_clearField(9);

  @$pb.TagNumber(10)
  $1.MastodonAccount get account => $_getN(9);
  @$pb.TagNumber(10)
  set account($1.MastodonAccount value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasAccount() => $_has(9);
  @$pb.TagNumber(10)
  void clearAccount() => $_clearField(10);
  @$pb.TagNumber(10)
  $1.MastodonAccount ensureAccount() => $_ensure(9);

  @$pb.TagNumber(11)
  $pb.PbList<MastodonMediaAttachment> get mediaAttachments => $_getList(10);
}

class MastodonTimelinePage extends $pb.GeneratedMessage {
  factory MastodonTimelinePage({
    $core.Iterable<MastodonStatus>? items,
    $core.String? maxId,
    $core.String? sinceId,
  }) {
    final result = create();
    if (items != null) result.items.addAll(items);
    if (maxId != null) result.maxId = maxId;
    if (sinceId != null) result.sinceId = sinceId;
    return result;
  }

  MastodonTimelinePage._();

  factory MastodonTimelinePage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MastodonTimelinePage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MastodonTimelinePage',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.mastodon.v1'),
      createEmptyInstance: create)
    ..pPM<MastodonStatus>(1, _omitFieldNames ? '' : 'items',
        subBuilder: MastodonStatus.create)
    ..aOS(2, _omitFieldNames ? '' : 'maxId')
    ..aOS(3, _omitFieldNames ? '' : 'sinceId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastodonTimelinePage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastodonTimelinePage copyWith(void Function(MastodonTimelinePage) updates) =>
      super.copyWith((message) => updates(message as MastodonTimelinePage))
          as MastodonTimelinePage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MastodonTimelinePage create() => MastodonTimelinePage._();
  @$core.override
  MastodonTimelinePage createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MastodonTimelinePage getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MastodonTimelinePage>(create);
  static MastodonTimelinePage? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<MastodonStatus> get items => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get maxId => $_getSZ(1);
  @$pb.TagNumber(2)
  set maxId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasMaxId() => $_has(1);
  @$pb.TagNumber(2)
  void clearMaxId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get sinceId => $_getSZ(2);
  @$pb.TagNumber(3)
  set sinceId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSinceId() => $_has(2);
  @$pb.TagNumber(3)
  void clearSinceId() => $_clearField(3);
}

class MastodonCreateStatusRequest extends $pb.GeneratedMessage {
  factory MastodonCreateStatusRequest({
    $core.String? status,
    $core.String? inReplyToId,
    $core.String? visibility,
    $core.Iterable<$core.String>? mediaIds,
  }) {
    final result = create();
    if (status != null) result.status = status;
    if (inReplyToId != null) result.inReplyToId = inReplyToId;
    if (visibility != null) result.visibility = visibility;
    if (mediaIds != null) result.mediaIds.addAll(mediaIds);
    return result;
  }

  MastodonCreateStatusRequest._();

  factory MastodonCreateStatusRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MastodonCreateStatusRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MastodonCreateStatusRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.mastodon.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'status')
    ..aOS(2, _omitFieldNames ? '' : 'inReplyToId')
    ..aOS(3, _omitFieldNames ? '' : 'visibility')
    ..pPS(4, _omitFieldNames ? '' : 'mediaIds')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastodonCreateStatusRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastodonCreateStatusRequest copyWith(
          void Function(MastodonCreateStatusRequest) updates) =>
      super.copyWith(
              (message) => updates(message as MastodonCreateStatusRequest))
          as MastodonCreateStatusRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MastodonCreateStatusRequest create() =>
      MastodonCreateStatusRequest._();
  @$core.override
  MastodonCreateStatusRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MastodonCreateStatusRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MastodonCreateStatusRequest>(create);
  static MastodonCreateStatusRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get status => $_getSZ(0);
  @$pb.TagNumber(1)
  set status($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasStatus() => $_has(0);
  @$pb.TagNumber(1)
  void clearStatus() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get inReplyToId => $_getSZ(1);
  @$pb.TagNumber(2)
  set inReplyToId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasInReplyToId() => $_has(1);
  @$pb.TagNumber(2)
  void clearInReplyToId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get visibility => $_getSZ(2);
  @$pb.TagNumber(3)
  set visibility($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasVisibility() => $_has(2);
  @$pb.TagNumber(3)
  void clearVisibility() => $_clearField(3);

  @$pb.TagNumber(4)
  $pb.PbList<$core.String> get mediaIds => $_getList(3);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
