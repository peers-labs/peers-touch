// This is a generated file - do not edit.
//
// Generated from domain/chat/sticker.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart'
    as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

/// 贴纸包
class StickerPack extends $pb.GeneratedMessage {
  factory StickerPack({
    $core.String? ulid,
    $core.String? name,
    $core.String? author,
    $core.String? description,
    $core.String? coverUrl,
    $core.Iterable<Sticker>? stickers,
    $core.bool? isOfficial,
    $core.bool? isAnimated,
    $core.int? stickerCount,
    $core.int? downloadCount,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (ulid != null) result.ulid = ulid;
    if (name != null) result.name = name;
    if (author != null) result.author = author;
    if (description != null) result.description = description;
    if (coverUrl != null) result.coverUrl = coverUrl;
    if (stickers != null) result.stickers.addAll(stickers);
    if (isOfficial != null) result.isOfficial = isOfficial;
    if (isAnimated != null) result.isAnimated = isAnimated;
    if (stickerCount != null) result.stickerCount = stickerCount;
    if (downloadCount != null) result.downloadCount = downloadCount;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  StickerPack._();

  factory StickerPack.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory StickerPack.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'StickerPack',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'ulid')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'author')
    ..aOS(4, _omitFieldNames ? '' : 'description')
    ..aOS(5, _omitFieldNames ? '' : 'coverUrl')
    ..pPM<Sticker>(6, _omitFieldNames ? '' : 'stickers',
        subBuilder: Sticker.create)
    ..aOB(7, _omitFieldNames ? '' : 'isOfficial')
    ..aOB(8, _omitFieldNames ? '' : 'isAnimated')
    ..aI(9, _omitFieldNames ? '' : 'stickerCount')
    ..aI(10, _omitFieldNames ? '' : 'downloadCount')
    ..aOM<$0.Timestamp>(11, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(12, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StickerPack clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StickerPack copyWith(void Function(StickerPack) updates) =>
      super.copyWith((message) => updates(message as StickerPack))
          as StickerPack;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static StickerPack create() => StickerPack._();
  @$core.override
  StickerPack createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static StickerPack getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<StickerPack>(create);
  static StickerPack? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get ulid => $_getSZ(0);
  @$pb.TagNumber(1)
  set ulid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get author => $_getSZ(2);
  @$pb.TagNumber(3)
  set author($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasAuthor() => $_has(2);
  @$pb.TagNumber(3)
  void clearAuthor() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get description => $_getSZ(3);
  @$pb.TagNumber(4)
  set description($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasDescription() => $_has(3);
  @$pb.TagNumber(4)
  void clearDescription() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get coverUrl => $_getSZ(4);
  @$pb.TagNumber(5)
  set coverUrl($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasCoverUrl() => $_has(4);
  @$pb.TagNumber(5)
  void clearCoverUrl() => $_clearField(5);

  @$pb.TagNumber(6)
  $pb.PbList<Sticker> get stickers => $_getList(5);

  @$pb.TagNumber(7)
  $core.bool get isOfficial => $_getBF(6);
  @$pb.TagNumber(7)
  set isOfficial($core.bool value) => $_setBool(6, value);
  @$pb.TagNumber(7)
  $core.bool hasIsOfficial() => $_has(6);
  @$pb.TagNumber(7)
  void clearIsOfficial() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.bool get isAnimated => $_getBF(7);
  @$pb.TagNumber(8)
  set isAnimated($core.bool value) => $_setBool(7, value);
  @$pb.TagNumber(8)
  $core.bool hasIsAnimated() => $_has(7);
  @$pb.TagNumber(8)
  void clearIsAnimated() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.int get stickerCount => $_getIZ(8);
  @$pb.TagNumber(9)
  set stickerCount($core.int value) => $_setSignedInt32(8, value);
  @$pb.TagNumber(9)
  $core.bool hasStickerCount() => $_has(8);
  @$pb.TagNumber(9)
  void clearStickerCount() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.int get downloadCount => $_getIZ(9);
  @$pb.TagNumber(10)
  set downloadCount($core.int value) => $_setSignedInt32(9, value);
  @$pb.TagNumber(10)
  $core.bool hasDownloadCount() => $_has(9);
  @$pb.TagNumber(10)
  void clearDownloadCount() => $_clearField(10);

  @$pb.TagNumber(11)
  $0.Timestamp get createdAt => $_getN(10);
  @$pb.TagNumber(11)
  set createdAt($0.Timestamp value) => $_setField(11, value);
  @$pb.TagNumber(11)
  $core.bool hasCreatedAt() => $_has(10);
  @$pb.TagNumber(11)
  void clearCreatedAt() => $_clearField(11);
  @$pb.TagNumber(11)
  $0.Timestamp ensureCreatedAt() => $_ensure(10);

  @$pb.TagNumber(12)
  $0.Timestamp get updatedAt => $_getN(11);
  @$pb.TagNumber(12)
  set updatedAt($0.Timestamp value) => $_setField(12, value);
  @$pb.TagNumber(12)
  $core.bool hasUpdatedAt() => $_has(11);
  @$pb.TagNumber(12)
  void clearUpdatedAt() => $_clearField(12);
  @$pb.TagNumber(12)
  $0.Timestamp ensureUpdatedAt() => $_ensure(11);
}

/// 单个贴纸
class Sticker extends $pb.GeneratedMessage {
  factory Sticker({
    $core.String? ulid,
    $core.String? packUlid,
    $core.String? emoji,
    $core.String? url,
    $core.String? thumbnailUrl,
    $core.int? width,
    $core.int? height,
    $core.String? fileType,
    $fixnum.Int64? fileSize,
  }) {
    final result = create();
    if (ulid != null) result.ulid = ulid;
    if (packUlid != null) result.packUlid = packUlid;
    if (emoji != null) result.emoji = emoji;
    if (url != null) result.url = url;
    if (thumbnailUrl != null) result.thumbnailUrl = thumbnailUrl;
    if (width != null) result.width = width;
    if (height != null) result.height = height;
    if (fileType != null) result.fileType = fileType;
    if (fileSize != null) result.fileSize = fileSize;
    return result;
  }

  Sticker._();

  factory Sticker.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Sticker.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Sticker',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'ulid')
    ..aOS(2, _omitFieldNames ? '' : 'packUlid')
    ..aOS(3, _omitFieldNames ? '' : 'emoji')
    ..aOS(4, _omitFieldNames ? '' : 'url')
    ..aOS(5, _omitFieldNames ? '' : 'thumbnailUrl')
    ..aI(6, _omitFieldNames ? '' : 'width')
    ..aI(7, _omitFieldNames ? '' : 'height')
    ..aOS(8, _omitFieldNames ? '' : 'fileType')
    ..aInt64(9, _omitFieldNames ? '' : 'fileSize')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Sticker clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Sticker copyWith(void Function(Sticker) updates) =>
      super.copyWith((message) => updates(message as Sticker)) as Sticker;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Sticker create() => Sticker._();
  @$core.override
  Sticker createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Sticker getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Sticker>(create);
  static Sticker? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get ulid => $_getSZ(0);
  @$pb.TagNumber(1)
  set ulid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get packUlid => $_getSZ(1);
  @$pb.TagNumber(2)
  set packUlid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPackUlid() => $_has(1);
  @$pb.TagNumber(2)
  void clearPackUlid() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get emoji => $_getSZ(2);
  @$pb.TagNumber(3)
  set emoji($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasEmoji() => $_has(2);
  @$pb.TagNumber(3)
  void clearEmoji() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get url => $_getSZ(3);
  @$pb.TagNumber(4)
  set url($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearUrl() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get thumbnailUrl => $_getSZ(4);
  @$pb.TagNumber(5)
  set thumbnailUrl($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasThumbnailUrl() => $_has(4);
  @$pb.TagNumber(5)
  void clearThumbnailUrl() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.int get width => $_getIZ(5);
  @$pb.TagNumber(6)
  set width($core.int value) => $_setSignedInt32(5, value);
  @$pb.TagNumber(6)
  $core.bool hasWidth() => $_has(5);
  @$pb.TagNumber(6)
  void clearWidth() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.int get height => $_getIZ(6);
  @$pb.TagNumber(7)
  set height($core.int value) => $_setSignedInt32(6, value);
  @$pb.TagNumber(7)
  $core.bool hasHeight() => $_has(6);
  @$pb.TagNumber(7)
  void clearHeight() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get fileType => $_getSZ(7);
  @$pb.TagNumber(8)
  set fileType($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasFileType() => $_has(7);
  @$pb.TagNumber(8)
  void clearFileType() => $_clearField(8);

  @$pb.TagNumber(9)
  $fixnum.Int64 get fileSize => $_getI64(8);
  @$pb.TagNumber(9)
  set fileSize($fixnum.Int64 value) => $_setInt64(8, value);
  @$pb.TagNumber(9)
  $core.bool hasFileSize() => $_has(8);
  @$pb.TagNumber(9)
  void clearFileSize() => $_clearField(9);
}

/// 用户贴纸收藏
class UserStickerCollection extends $pb.GeneratedMessage {
  factory UserStickerCollection({
    $core.String? actorDid,
    $core.Iterable<$core.String>? collectedPackUlids,
    $core.Iterable<RecentSticker>? recentStickers,
  }) {
    final result = create();
    if (actorDid != null) result.actorDid = actorDid;
    if (collectedPackUlids != null)
      result.collectedPackUlids.addAll(collectedPackUlids);
    if (recentStickers != null) result.recentStickers.addAll(recentStickers);
    return result;
  }

  UserStickerCollection._();

  factory UserStickerCollection.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UserStickerCollection.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UserStickerCollection',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'actorDid')
    ..pPS(2, _omitFieldNames ? '' : 'collectedPackUlids')
    ..pPM<RecentSticker>(3, _omitFieldNames ? '' : 'recentStickers',
        subBuilder: RecentSticker.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UserStickerCollection clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UserStickerCollection copyWith(
          void Function(UserStickerCollection) updates) =>
      super.copyWith((message) => updates(message as UserStickerCollection))
          as UserStickerCollection;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UserStickerCollection create() => UserStickerCollection._();
  @$core.override
  UserStickerCollection createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UserStickerCollection getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UserStickerCollection>(create);
  static UserStickerCollection? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get actorDid => $_getSZ(0);
  @$pb.TagNumber(1)
  set actorDid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasActorDid() => $_has(0);
  @$pb.TagNumber(1)
  void clearActorDid() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get collectedPackUlids => $_getList(1);

  @$pb.TagNumber(3)
  $pb.PbList<RecentSticker> get recentStickers => $_getList(2);
}

/// 最近使用的贴纸
class RecentSticker extends $pb.GeneratedMessage {
  factory RecentSticker({
    $core.String? stickerUlid,
    $0.Timestamp? usedAt,
    $core.int? useCount,
  }) {
    final result = create();
    if (stickerUlid != null) result.stickerUlid = stickerUlid;
    if (usedAt != null) result.usedAt = usedAt;
    if (useCount != null) result.useCount = useCount;
    return result;
  }

  RecentSticker._();

  factory RecentSticker.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RecentSticker.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RecentSticker',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'stickerUlid')
    ..aOM<$0.Timestamp>(2, _omitFieldNames ? '' : 'usedAt',
        subBuilder: $0.Timestamp.create)
    ..aI(3, _omitFieldNames ? '' : 'useCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecentSticker clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecentSticker copyWith(void Function(RecentSticker) updates) =>
      super.copyWith((message) => updates(message as RecentSticker))
          as RecentSticker;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RecentSticker create() => RecentSticker._();
  @$core.override
  RecentSticker createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RecentSticker getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RecentSticker>(create);
  static RecentSticker? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get stickerUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set stickerUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasStickerUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearStickerUlid() => $_clearField(1);

  @$pb.TagNumber(2)
  $0.Timestamp get usedAt => $_getN(1);
  @$pb.TagNumber(2)
  set usedAt($0.Timestamp value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasUsedAt() => $_has(1);
  @$pb.TagNumber(2)
  void clearUsedAt() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.Timestamp ensureUsedAt() => $_ensure(1);

  @$pb.TagNumber(3)
  $core.int get useCount => $_getIZ(2);
  @$pb.TagNumber(3)
  set useCount($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasUseCount() => $_has(2);
  @$pb.TagNumber(3)
  void clearUseCount() => $_clearField(3);
}

/// 获取官方贴纸包列表
class ListOfficialStickerPacksRequest extends $pb.GeneratedMessage {
  factory ListOfficialStickerPacksRequest({
    $core.int? limit,
    $core.int? offset,
    $core.String? keyword,
  }) {
    final result = create();
    if (limit != null) result.limit = limit;
    if (offset != null) result.offset = offset;
    if (keyword != null) result.keyword = keyword;
    return result;
  }

  ListOfficialStickerPacksRequest._();

  factory ListOfficialStickerPacksRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListOfficialStickerPacksRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListOfficialStickerPacksRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'limit')
    ..aI(2, _omitFieldNames ? '' : 'offset')
    ..aOS(3, _omitFieldNames ? '' : 'keyword')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListOfficialStickerPacksRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListOfficialStickerPacksRequest copyWith(
          void Function(ListOfficialStickerPacksRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListOfficialStickerPacksRequest))
          as ListOfficialStickerPacksRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListOfficialStickerPacksRequest create() =>
      ListOfficialStickerPacksRequest._();
  @$core.override
  ListOfficialStickerPacksRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListOfficialStickerPacksRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListOfficialStickerPacksRequest>(
          create);
  static ListOfficialStickerPacksRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get limit => $_getIZ(0);
  @$pb.TagNumber(1)
  set limit($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasLimit() => $_has(0);
  @$pb.TagNumber(1)
  void clearLimit() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get offset => $_getIZ(1);
  @$pb.TagNumber(2)
  set offset($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasOffset() => $_has(1);
  @$pb.TagNumber(2)
  void clearOffset() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get keyword => $_getSZ(2);
  @$pb.TagNumber(3)
  set keyword($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasKeyword() => $_has(2);
  @$pb.TagNumber(3)
  void clearKeyword() => $_clearField(3);
}

class ListOfficialStickerPacksResponse extends $pb.GeneratedMessage {
  factory ListOfficialStickerPacksResponse({
    $core.Iterable<StickerPack>? packs,
    $core.int? total,
  }) {
    final result = create();
    if (packs != null) result.packs.addAll(packs);
    if (total != null) result.total = total;
    return result;
  }

  ListOfficialStickerPacksResponse._();

  factory ListOfficialStickerPacksResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListOfficialStickerPacksResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListOfficialStickerPacksResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..pPM<StickerPack>(1, _omitFieldNames ? '' : 'packs',
        subBuilder: StickerPack.create)
    ..aI(2, _omitFieldNames ? '' : 'total')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListOfficialStickerPacksResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListOfficialStickerPacksResponse copyWith(
          void Function(ListOfficialStickerPacksResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListOfficialStickerPacksResponse))
          as ListOfficialStickerPacksResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListOfficialStickerPacksResponse create() =>
      ListOfficialStickerPacksResponse._();
  @$core.override
  ListOfficialStickerPacksResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListOfficialStickerPacksResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListOfficialStickerPacksResponse>(
          create);
  static ListOfficialStickerPacksResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<StickerPack> get packs => $_getList(0);

  @$pb.TagNumber(2)
  $core.int get total => $_getIZ(1);
  @$pb.TagNumber(2)
  set total($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTotal() => $_has(1);
  @$pb.TagNumber(2)
  void clearTotal() => $_clearField(2);
}

/// 获取贴纸包详情
class GetStickerPackRequest extends $pb.GeneratedMessage {
  factory GetStickerPackRequest({
    $core.String? packUlid,
  }) {
    final result = create();
    if (packUlid != null) result.packUlid = packUlid;
    return result;
  }

  GetStickerPackRequest._();

  factory GetStickerPackRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetStickerPackRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetStickerPackRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'packUlid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetStickerPackRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetStickerPackRequest copyWith(
          void Function(GetStickerPackRequest) updates) =>
      super.copyWith((message) => updates(message as GetStickerPackRequest))
          as GetStickerPackRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetStickerPackRequest create() => GetStickerPackRequest._();
  @$core.override
  GetStickerPackRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetStickerPackRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetStickerPackRequest>(create);
  static GetStickerPackRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get packUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set packUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPackUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearPackUlid() => $_clearField(1);
}

class GetStickerPackResponse extends $pb.GeneratedMessage {
  factory GetStickerPackResponse({
    StickerPack? pack,
    $core.bool? isCollected,
  }) {
    final result = create();
    if (pack != null) result.pack = pack;
    if (isCollected != null) result.isCollected = isCollected;
    return result;
  }

  GetStickerPackResponse._();

  factory GetStickerPackResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetStickerPackResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetStickerPackResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOM<StickerPack>(1, _omitFieldNames ? '' : 'pack',
        subBuilder: StickerPack.create)
    ..aOB(2, _omitFieldNames ? '' : 'isCollected')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetStickerPackResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetStickerPackResponse copyWith(
          void Function(GetStickerPackResponse) updates) =>
      super.copyWith((message) => updates(message as GetStickerPackResponse))
          as GetStickerPackResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetStickerPackResponse create() => GetStickerPackResponse._();
  @$core.override
  GetStickerPackResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetStickerPackResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetStickerPackResponse>(create);
  static GetStickerPackResponse? _defaultInstance;

  @$pb.TagNumber(1)
  StickerPack get pack => $_getN(0);
  @$pb.TagNumber(1)
  set pack(StickerPack value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPack() => $_has(0);
  @$pb.TagNumber(1)
  void clearPack() => $_clearField(1);
  @$pb.TagNumber(1)
  StickerPack ensurePack() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.bool get isCollected => $_getBF(1);
  @$pb.TagNumber(2)
  set isCollected($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasIsCollected() => $_has(1);
  @$pb.TagNumber(2)
  void clearIsCollected() => $_clearField(2);
}

/// 收藏贴纸包
class CollectStickerPackRequest extends $pb.GeneratedMessage {
  factory CollectStickerPackRequest({
    $core.String? packUlid,
  }) {
    final result = create();
    if (packUlid != null) result.packUlid = packUlid;
    return result;
  }

  CollectStickerPackRequest._();

  factory CollectStickerPackRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CollectStickerPackRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CollectStickerPackRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'packUlid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CollectStickerPackRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CollectStickerPackRequest copyWith(
          void Function(CollectStickerPackRequest) updates) =>
      super.copyWith((message) => updates(message as CollectStickerPackRequest))
          as CollectStickerPackRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CollectStickerPackRequest create() => CollectStickerPackRequest._();
  @$core.override
  CollectStickerPackRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CollectStickerPackRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CollectStickerPackRequest>(create);
  static CollectStickerPackRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get packUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set packUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPackUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearPackUlid() => $_clearField(1);
}

class CollectStickerPackResponse extends $pb.GeneratedMessage {
  factory CollectStickerPackResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  CollectStickerPackResponse._();

  factory CollectStickerPackResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CollectStickerPackResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CollectStickerPackResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CollectStickerPackResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CollectStickerPackResponse copyWith(
          void Function(CollectStickerPackResponse) updates) =>
      super.copyWith(
              (message) => updates(message as CollectStickerPackResponse))
          as CollectStickerPackResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CollectStickerPackResponse create() => CollectStickerPackResponse._();
  @$core.override
  CollectStickerPackResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CollectStickerPackResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CollectStickerPackResponse>(create);
  static CollectStickerPackResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

/// 取消收藏贴纸包
class UncollectStickerPackRequest extends $pb.GeneratedMessage {
  factory UncollectStickerPackRequest({
    $core.String? packUlid,
  }) {
    final result = create();
    if (packUlid != null) result.packUlid = packUlid;
    return result;
  }

  UncollectStickerPackRequest._();

  factory UncollectStickerPackRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UncollectStickerPackRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UncollectStickerPackRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'packUlid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UncollectStickerPackRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UncollectStickerPackRequest copyWith(
          void Function(UncollectStickerPackRequest) updates) =>
      super.copyWith(
              (message) => updates(message as UncollectStickerPackRequest))
          as UncollectStickerPackRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UncollectStickerPackRequest create() =>
      UncollectStickerPackRequest._();
  @$core.override
  UncollectStickerPackRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UncollectStickerPackRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UncollectStickerPackRequest>(create);
  static UncollectStickerPackRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get packUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set packUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPackUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearPackUlid() => $_clearField(1);
}

class UncollectStickerPackResponse extends $pb.GeneratedMessage {
  factory UncollectStickerPackResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  UncollectStickerPackResponse._();

  factory UncollectStickerPackResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UncollectStickerPackResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UncollectStickerPackResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UncollectStickerPackResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UncollectStickerPackResponse copyWith(
          void Function(UncollectStickerPackResponse) updates) =>
      super.copyWith(
              (message) => updates(message as UncollectStickerPackResponse))
          as UncollectStickerPackResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UncollectStickerPackResponse create() =>
      UncollectStickerPackResponse._();
  @$core.override
  UncollectStickerPackResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UncollectStickerPackResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UncollectStickerPackResponse>(create);
  static UncollectStickerPackResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

/// 获取我的贴纸包
class GetMyStickerPacksRequest extends $pb.GeneratedMessage {
  factory GetMyStickerPacksRequest({
    $core.bool? includeRecent,
  }) {
    final result = create();
    if (includeRecent != null) result.includeRecent = includeRecent;
    return result;
  }

  GetMyStickerPacksRequest._();

  factory GetMyStickerPacksRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetMyStickerPacksRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyStickerPacksRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'includeRecent')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyStickerPacksRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyStickerPacksRequest copyWith(
          void Function(GetMyStickerPacksRequest) updates) =>
      super.copyWith((message) => updates(message as GetMyStickerPacksRequest))
          as GetMyStickerPacksRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetMyStickerPacksRequest create() => GetMyStickerPacksRequest._();
  @$core.override
  GetMyStickerPacksRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetMyStickerPacksRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyStickerPacksRequest>(create);
  static GetMyStickerPacksRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get includeRecent => $_getBF(0);
  @$pb.TagNumber(1)
  set includeRecent($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasIncludeRecent() => $_has(0);
  @$pb.TagNumber(1)
  void clearIncludeRecent() => $_clearField(1);
}

class GetMyStickerPacksResponse extends $pb.GeneratedMessage {
  factory GetMyStickerPacksResponse({
    $core.Iterable<StickerPack>? packs,
    $core.Iterable<RecentSticker>? recentStickers,
  }) {
    final result = create();
    if (packs != null) result.packs.addAll(packs);
    if (recentStickers != null) result.recentStickers.addAll(recentStickers);
    return result;
  }

  GetMyStickerPacksResponse._();

  factory GetMyStickerPacksResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetMyStickerPacksResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyStickerPacksResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..pPM<StickerPack>(1, _omitFieldNames ? '' : 'packs',
        subBuilder: StickerPack.create)
    ..pPM<RecentSticker>(2, _omitFieldNames ? '' : 'recentStickers',
        subBuilder: RecentSticker.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyStickerPacksResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyStickerPacksResponse copyWith(
          void Function(GetMyStickerPacksResponse) updates) =>
      super.copyWith((message) => updates(message as GetMyStickerPacksResponse))
          as GetMyStickerPacksResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetMyStickerPacksResponse create() => GetMyStickerPacksResponse._();
  @$core.override
  GetMyStickerPacksResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetMyStickerPacksResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyStickerPacksResponse>(create);
  static GetMyStickerPacksResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<StickerPack> get packs => $_getList(0);

  @$pb.TagNumber(2)
  $pb.PbList<RecentSticker> get recentStickers => $_getList(1);
}

/// 记录贴纸使用
class RecordStickerUsageRequest extends $pb.GeneratedMessage {
  factory RecordStickerUsageRequest({
    $core.String? stickerUlid,
  }) {
    final result = create();
    if (stickerUlid != null) result.stickerUlid = stickerUlid;
    return result;
  }

  RecordStickerUsageRequest._();

  factory RecordStickerUsageRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RecordStickerUsageRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RecordStickerUsageRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'stickerUlid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecordStickerUsageRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecordStickerUsageRequest copyWith(
          void Function(RecordStickerUsageRequest) updates) =>
      super.copyWith((message) => updates(message as RecordStickerUsageRequest))
          as RecordStickerUsageRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RecordStickerUsageRequest create() => RecordStickerUsageRequest._();
  @$core.override
  RecordStickerUsageRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RecordStickerUsageRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RecordStickerUsageRequest>(create);
  static RecordStickerUsageRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get stickerUlid => $_getSZ(0);
  @$pb.TagNumber(1)
  set stickerUlid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasStickerUlid() => $_has(0);
  @$pb.TagNumber(1)
  void clearStickerUlid() => $_clearField(1);
}

class RecordStickerUsageResponse extends $pb.GeneratedMessage {
  factory RecordStickerUsageResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  RecordStickerUsageResponse._();

  factory RecordStickerUsageResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RecordStickerUsageResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RecordStickerUsageResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecordStickerUsageResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecordStickerUsageResponse copyWith(
          void Function(RecordStickerUsageResponse) updates) =>
      super.copyWith(
              (message) => updates(message as RecordStickerUsageResponse))
          as RecordStickerUsageResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RecordStickerUsageResponse create() => RecordStickerUsageResponse._();
  @$core.override
  RecordStickerUsageResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RecordStickerUsageResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RecordStickerUsageResponse>(create);
  static RecordStickerUsageResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

/// 搜索贴纸（通过emoji或关键词）
class SearchStickersRequest extends $pb.GeneratedMessage {
  factory SearchStickersRequest({
    $core.String? query,
    $core.int? limit,
  }) {
    final result = create();
    if (query != null) result.query = query;
    if (limit != null) result.limit = limit;
    return result;
  }

  SearchStickersRequest._();

  factory SearchStickersRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SearchStickersRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SearchStickersRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'query')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchStickersRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchStickersRequest copyWith(
          void Function(SearchStickersRequest) updates) =>
      super.copyWith((message) => updates(message as SearchStickersRequest))
          as SearchStickersRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SearchStickersRequest create() => SearchStickersRequest._();
  @$core.override
  SearchStickersRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SearchStickersRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SearchStickersRequest>(create);
  static SearchStickersRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get query => $_getSZ(0);
  @$pb.TagNumber(1)
  set query($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasQuery() => $_has(0);
  @$pb.TagNumber(1)
  void clearQuery() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);
}

class SearchStickersResponse extends $pb.GeneratedMessage {
  factory SearchStickersResponse({
    $core.Iterable<Sticker>? stickers,
  }) {
    final result = create();
    if (stickers != null) result.stickers.addAll(stickers);
    return result;
  }

  SearchStickersResponse._();

  factory SearchStickersResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SearchStickersResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SearchStickersResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..pPM<Sticker>(1, _omitFieldNames ? '' : 'stickers',
        subBuilder: Sticker.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchStickersResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchStickersResponse copyWith(
          void Function(SearchStickersResponse) updates) =>
      super.copyWith((message) => updates(message as SearchStickersResponse))
          as SearchStickersResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SearchStickersResponse create() => SearchStickersResponse._();
  @$core.override
  SearchStickersResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SearchStickersResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SearchStickersResponse>(create);
  static SearchStickersResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Sticker> get stickers => $_getList(0);
}

/// 上传自定义贴纸包（预留）
class CreateStickerPackRequest extends $pb.GeneratedMessage {
  factory CreateStickerPackRequest({
    $core.String? name,
    $core.String? description,
    $core.Iterable<CreateStickerItem>? stickers,
  }) {
    final result = create();
    if (name != null) result.name = name;
    if (description != null) result.description = description;
    if (stickers != null) result.stickers.addAll(stickers);
    return result;
  }

  CreateStickerPackRequest._();

  factory CreateStickerPackRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateStickerPackRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateStickerPackRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'name')
    ..aOS(2, _omitFieldNames ? '' : 'description')
    ..pPM<CreateStickerItem>(3, _omitFieldNames ? '' : 'stickers',
        subBuilder: CreateStickerItem.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateStickerPackRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateStickerPackRequest copyWith(
          void Function(CreateStickerPackRequest) updates) =>
      super.copyWith((message) => updates(message as CreateStickerPackRequest))
          as CreateStickerPackRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateStickerPackRequest create() => CreateStickerPackRequest._();
  @$core.override
  CreateStickerPackRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateStickerPackRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateStickerPackRequest>(create);
  static CreateStickerPackRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get name => $_getSZ(0);
  @$pb.TagNumber(1)
  set name($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasName() => $_has(0);
  @$pb.TagNumber(1)
  void clearName() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get description => $_getSZ(1);
  @$pb.TagNumber(2)
  set description($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasDescription() => $_has(1);
  @$pb.TagNumber(2)
  void clearDescription() => $_clearField(2);

  @$pb.TagNumber(3)
  $pb.PbList<CreateStickerItem> get stickers => $_getList(2);
}

class CreateStickerItem extends $pb.GeneratedMessage {
  factory CreateStickerItem({
    $core.String? emoji,
    $core.List<$core.int>? imageData,
    $core.String? fileType,
  }) {
    final result = create();
    if (emoji != null) result.emoji = emoji;
    if (imageData != null) result.imageData = imageData;
    if (fileType != null) result.fileType = fileType;
    return result;
  }

  CreateStickerItem._();

  factory CreateStickerItem.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateStickerItem.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateStickerItem',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'emoji')
    ..a<$core.List<$core.int>>(
        2, _omitFieldNames ? '' : 'imageData', $pb.PbFieldType.OY)
    ..aOS(3, _omitFieldNames ? '' : 'fileType')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateStickerItem clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateStickerItem copyWith(void Function(CreateStickerItem) updates) =>
      super.copyWith((message) => updates(message as CreateStickerItem))
          as CreateStickerItem;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateStickerItem create() => CreateStickerItem._();
  @$core.override
  CreateStickerItem createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateStickerItem getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateStickerItem>(create);
  static CreateStickerItem? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get emoji => $_getSZ(0);
  @$pb.TagNumber(1)
  set emoji($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasEmoji() => $_has(0);
  @$pb.TagNumber(1)
  void clearEmoji() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.List<$core.int> get imageData => $_getN(1);
  @$pb.TagNumber(2)
  set imageData($core.List<$core.int> value) => $_setBytes(1, value);
  @$pb.TagNumber(2)
  $core.bool hasImageData() => $_has(1);
  @$pb.TagNumber(2)
  void clearImageData() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get fileType => $_getSZ(2);
  @$pb.TagNumber(3)
  set fileType($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasFileType() => $_has(2);
  @$pb.TagNumber(3)
  void clearFileType() => $_clearField(3);
}

class CreateStickerPackResponse extends $pb.GeneratedMessage {
  factory CreateStickerPackResponse({
    StickerPack? pack,
  }) {
    final result = create();
    if (pack != null) result.pack = pack;
    return result;
  }

  CreateStickerPackResponse._();

  factory CreateStickerPackResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateStickerPackResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateStickerPackResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.chat.v1'),
      createEmptyInstance: create)
    ..aOM<StickerPack>(1, _omitFieldNames ? '' : 'pack',
        subBuilder: StickerPack.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateStickerPackResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateStickerPackResponse copyWith(
          void Function(CreateStickerPackResponse) updates) =>
      super.copyWith((message) => updates(message as CreateStickerPackResponse))
          as CreateStickerPackResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateStickerPackResponse create() => CreateStickerPackResponse._();
  @$core.override
  CreateStickerPackResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateStickerPackResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateStickerPackResponse>(create);
  static CreateStickerPackResponse? _defaultInstance;

  @$pb.TagNumber(1)
  StickerPack get pack => $_getN(0);
  @$pb.TagNumber(1)
  set pack(StickerPack value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPack() => $_has(0);
  @$pb.TagNumber(1)
  void clearPack() => $_clearField(1);
  @$pb.TagNumber(1)
  StickerPack ensurePack() => $_ensure(0);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
