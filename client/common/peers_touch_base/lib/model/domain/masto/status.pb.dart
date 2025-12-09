// This is a generated file - do not edit.
//
// Generated from domain/masto/status.proto.

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

class MastoMediaAttachment extends $pb.GeneratedMessage {
  factory MastoMediaAttachment({
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

  MastoMediaAttachment._();

  factory MastoMediaAttachment.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MastoMediaAttachment.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MastoMediaAttachment',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.masto.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'type')
    ..aOS(3, _omitFieldNames ? '' : 'url')
    ..aOS(4, _omitFieldNames ? '' : 'previewUrl')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastoMediaAttachment clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastoMediaAttachment copyWith(void Function(MastoMediaAttachment) updates) =>
      super.copyWith((message) => updates(message as MastoMediaAttachment))
          as MastoMediaAttachment;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MastoMediaAttachment create() => MastoMediaAttachment._();
  @$core.override
  MastoMediaAttachment createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MastoMediaAttachment getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MastoMediaAttachment>(create);
  static MastoMediaAttachment? _defaultInstance;

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

class MastoStatus extends $pb.GeneratedMessage {
  factory MastoStatus({
    $core.String? id,
    $core.String? uri,
    $0.Timestamp? createdAt,
    $core.String? content,
    $core.String? visibility,
    $fixnum.Int64? reblogsCount,
    $fixnum.Int64? favouritesCount,
    $core.String? inReplyToId,
    $core.String? reblogId,
    $1.MastoAccount? account,
    $core.Iterable<MastoMediaAttachment>? mediaAttachments,
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

  MastoStatus._();

  factory MastoStatus.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MastoStatus.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MastoStatus',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.masto.v1'),
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
    ..aOM<$1.MastoAccount>(10, _omitFieldNames ? '' : 'account',
        subBuilder: $1.MastoAccount.create)
    ..pPM<MastoMediaAttachment>(11, _omitFieldNames ? '' : 'mediaAttachments',
        subBuilder: MastoMediaAttachment.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastoStatus clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastoStatus copyWith(void Function(MastoStatus) updates) =>
      super.copyWith((message) => updates(message as MastoStatus))
          as MastoStatus;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MastoStatus create() => MastoStatus._();
  @$core.override
  MastoStatus createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MastoStatus getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MastoStatus>(create);
  static MastoStatus? _defaultInstance;

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
  $1.MastoAccount get account => $_getN(9);
  @$pb.TagNumber(10)
  set account($1.MastoAccount value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasAccount() => $_has(9);
  @$pb.TagNumber(10)
  void clearAccount() => $_clearField(10);
  @$pb.TagNumber(10)
  $1.MastoAccount ensureAccount() => $_ensure(9);

  @$pb.TagNumber(11)
  $pb.PbList<MastoMediaAttachment> get mediaAttachments => $_getList(10);
}

class MastoTimelinePage extends $pb.GeneratedMessage {
  factory MastoTimelinePage({
    $core.Iterable<MastoStatus>? items,
    $core.String? maxId,
    $core.String? sinceId,
  }) {
    final result = create();
    if (items != null) result.items.addAll(items);
    if (maxId != null) result.maxId = maxId;
    if (sinceId != null) result.sinceId = sinceId;
    return result;
  }

  MastoTimelinePage._();

  factory MastoTimelinePage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MastoTimelinePage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MastoTimelinePage',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.masto.v1'),
      createEmptyInstance: create)
    ..pPM<MastoStatus>(1, _omitFieldNames ? '' : 'items',
        subBuilder: MastoStatus.create)
    ..aOS(2, _omitFieldNames ? '' : 'maxId')
    ..aOS(3, _omitFieldNames ? '' : 'sinceId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastoTimelinePage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MastoTimelinePage copyWith(void Function(MastoTimelinePage) updates) =>
      super.copyWith((message) => updates(message as MastoTimelinePage))
          as MastoTimelinePage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MastoTimelinePage create() => MastoTimelinePage._();
  @$core.override
  MastoTimelinePage createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MastoTimelinePage getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MastoTimelinePage>(create);
  static MastoTimelinePage? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<MastoStatus> get items => $_getList(0);

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

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
