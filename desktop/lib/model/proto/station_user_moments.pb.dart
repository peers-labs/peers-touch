//
//  Generated code. Do not modify.
//  source: station_user_moments.proto
//
// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_final_fields
// ignore_for_file: unnecessary_import, unnecessary_this, unused_import

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

import 'google/protobuf/timestamp.pb.dart' as $0;
import 'station_user_moments.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'station_user_moments.pbenum.dart';

/// Moment represents a single post/share from a family member
class Moment extends $pb.GeneratedMessage {
  factory Moment({
    $core.String? id,
    $core.String? authorId,
    $core.String? authorName,
    $core.String? content,
    $core.Iterable<MediaAttachment>? media,
    MomentType? type,
    $core.Iterable<$core.String>? tags,
    Location? location,
    Privacy? privacy,
    $core.int? likesCount,
    $core.int? commentsCount,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final $result = create();
    if (id != null) {
      $result.id = id;
    }
    if (authorId != null) {
      $result.authorId = authorId;
    }
    if (authorName != null) {
      $result.authorName = authorName;
    }
    if (content != null) {
      $result.content = content;
    }
    if (media != null) {
      $result.media.addAll(media);
    }
    if (type != null) {
      $result.type = type;
    }
    if (tags != null) {
      $result.tags.addAll(tags);
    }
    if (location != null) {
      $result.location = location;
    }
    if (privacy != null) {
      $result.privacy = privacy;
    }
    if (likesCount != null) {
      $result.likesCount = likesCount;
    }
    if (commentsCount != null) {
      $result.commentsCount = commentsCount;
    }
    if (createdAt != null) {
      $result.createdAt = createdAt;
    }
    if (updatedAt != null) {
      $result.updatedAt = updatedAt;
    }
    return $result;
  }
  Moment._() : super();
  factory Moment.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory Moment.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'Moment', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'authorId')
    ..aOS(3, _omitFieldNames ? '' : 'authorName')
    ..aOS(4, _omitFieldNames ? '' : 'content')
    ..pc<MediaAttachment>(5, _omitFieldNames ? '' : 'media', $pb.PbFieldType.PM, subBuilder: MediaAttachment.create)
    ..e<MomentType>(6, _omitFieldNames ? '' : 'type', $pb.PbFieldType.OE, defaultOrMaker: MomentType.MOMENT_TYPE_UNSPECIFIED, valueOf: MomentType.valueOf, enumValues: MomentType.values)
    ..pPS(7, _omitFieldNames ? '' : 'tags')
    ..aOM<Location>(8, _omitFieldNames ? '' : 'location', subBuilder: Location.create)
    ..e<Privacy>(9, _omitFieldNames ? '' : 'privacy', $pb.PbFieldType.OE, defaultOrMaker: Privacy.PRIVACY_UNSPECIFIED, valueOf: Privacy.valueOf, enumValues: Privacy.values)
    ..a<$core.int>(10, _omitFieldNames ? '' : 'likesCount', $pb.PbFieldType.O3)
    ..a<$core.int>(11, _omitFieldNames ? '' : 'commentsCount', $pb.PbFieldType.O3)
    ..aOM<$0.Timestamp>(12, _omitFieldNames ? '' : 'createdAt', subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(13, _omitFieldNames ? '' : 'updatedAt', subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  Moment clone() => Moment()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  Moment copyWith(void Function(Moment) updates) => super.copyWith((message) => updates(message as Moment)) as Moment;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Moment create() => Moment._();
  Moment createEmptyInstance() => create();
  static $pb.PbList<Moment> createRepeated() => $pb.PbList<Moment>();
  @$core.pragma('dart2js:noInline')
  static Moment getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Moment>(create);
  static Moment? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String v) { $_setString(0, v); }
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get authorId => $_getSZ(1);
  @$pb.TagNumber(2)
  set authorId($core.String v) { $_setString(1, v); }
  @$pb.TagNumber(2)
  $core.bool hasAuthorId() => $_has(1);
  @$pb.TagNumber(2)
  void clearAuthorId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get authorName => $_getSZ(2);
  @$pb.TagNumber(3)
  set authorName($core.String v) { $_setString(2, v); }
  @$pb.TagNumber(3)
  $core.bool hasAuthorName() => $_has(2);
  @$pb.TagNumber(3)
  void clearAuthorName() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get content => $_getSZ(3);
  @$pb.TagNumber(4)
  set content($core.String v) { $_setString(3, v); }
  @$pb.TagNumber(4)
  $core.bool hasContent() => $_has(3);
  @$pb.TagNumber(4)
  void clearContent() => $_clearField(4);

  @$pb.TagNumber(5)
  $pb.PbList<MediaAttachment> get media => $_getList(4);

  @$pb.TagNumber(6)
  MomentType get type => $_getN(5);
  @$pb.TagNumber(6)
  set type(MomentType v) { $_setField(6, v); }
  @$pb.TagNumber(6)
  $core.bool hasType() => $_has(5);
  @$pb.TagNumber(6)
  void clearType() => $_clearField(6);

  @$pb.TagNumber(7)
  $pb.PbList<$core.String> get tags => $_getList(6);

  @$pb.TagNumber(8)
  Location get location => $_getN(7);
  @$pb.TagNumber(8)
  set location(Location v) { $_setField(8, v); }
  @$pb.TagNumber(8)
  $core.bool hasLocation() => $_has(7);
  @$pb.TagNumber(8)
  void clearLocation() => $_clearField(8);
  @$pb.TagNumber(8)
  Location ensureLocation() => $_ensure(7);

  @$pb.TagNumber(9)
  Privacy get privacy => $_getN(8);
  @$pb.TagNumber(9)
  set privacy(Privacy v) { $_setField(9, v); }
  @$pb.TagNumber(9)
  $core.bool hasPrivacy() => $_has(8);
  @$pb.TagNumber(9)
  void clearPrivacy() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.int get likesCount => $_getIZ(9);
  @$pb.TagNumber(10)
  set likesCount($core.int v) { $_setSignedInt32(9, v); }
  @$pb.TagNumber(10)
  $core.bool hasLikesCount() => $_has(9);
  @$pb.TagNumber(10)
  void clearLikesCount() => $_clearField(10);

  @$pb.TagNumber(11)
  $core.int get commentsCount => $_getIZ(10);
  @$pb.TagNumber(11)
  set commentsCount($core.int v) { $_setSignedInt32(10, v); }
  @$pb.TagNumber(11)
  $core.bool hasCommentsCount() => $_has(10);
  @$pb.TagNumber(11)
  void clearCommentsCount() => $_clearField(11);

  @$pb.TagNumber(12)
  $0.Timestamp get createdAt => $_getN(11);
  @$pb.TagNumber(12)
  set createdAt($0.Timestamp v) { $_setField(12, v); }
  @$pb.TagNumber(12)
  $core.bool hasCreatedAt() => $_has(11);
  @$pb.TagNumber(12)
  void clearCreatedAt() => $_clearField(12);
  @$pb.TagNumber(12)
  $0.Timestamp ensureCreatedAt() => $_ensure(11);

  @$pb.TagNumber(13)
  $0.Timestamp get updatedAt => $_getN(12);
  @$pb.TagNumber(13)
  set updatedAt($0.Timestamp v) { $_setField(13, v); }
  @$pb.TagNumber(13)
  $core.bool hasUpdatedAt() => $_has(12);
  @$pb.TagNumber(13)
  void clearUpdatedAt() => $_clearField(13);
  @$pb.TagNumber(13)
  $0.Timestamp ensureUpdatedAt() => $_ensure(12);
}

/// MediaAttachment represents photos, videos, or other media
class MediaAttachment extends $pb.GeneratedMessage {
  factory MediaAttachment({
    $core.String? id,
    MediaType? type,
    $core.String? url,
    $core.String? thumbnailUrl,
    $core.String? caption,
    $fixnum.Int64? fileSize,
    $core.String? mimeType,
    $core.int? width,
    $core.int? height,
    $core.int? duration,
  }) {
    final $result = create();
    if (id != null) {
      $result.id = id;
    }
    if (type != null) {
      $result.type = type;
    }
    if (url != null) {
      $result.url = url;
    }
    if (thumbnailUrl != null) {
      $result.thumbnailUrl = thumbnailUrl;
    }
    if (caption != null) {
      $result.caption = caption;
    }
    if (fileSize != null) {
      $result.fileSize = fileSize;
    }
    if (mimeType != null) {
      $result.mimeType = mimeType;
    }
    if (width != null) {
      $result.width = width;
    }
    if (height != null) {
      $result.height = height;
    }
    if (duration != null) {
      $result.duration = duration;
    }
    return $result;
  }
  MediaAttachment._() : super();
  factory MediaAttachment.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory MediaAttachment.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'MediaAttachment', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..e<MediaType>(2, _omitFieldNames ? '' : 'type', $pb.PbFieldType.OE, defaultOrMaker: MediaType.MEDIA_TYPE_UNSPECIFIED, valueOf: MediaType.valueOf, enumValues: MediaType.values)
    ..aOS(3, _omitFieldNames ? '' : 'url')
    ..aOS(4, _omitFieldNames ? '' : 'thumbnailUrl')
    ..aOS(5, _omitFieldNames ? '' : 'caption')
    ..aInt64(6, _omitFieldNames ? '' : 'fileSize')
    ..aOS(7, _omitFieldNames ? '' : 'mimeType')
    ..a<$core.int>(8, _omitFieldNames ? '' : 'width', $pb.PbFieldType.O3)
    ..a<$core.int>(9, _omitFieldNames ? '' : 'height', $pb.PbFieldType.O3)
    ..a<$core.int>(10, _omitFieldNames ? '' : 'duration', $pb.PbFieldType.O3)
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  MediaAttachment clone() => MediaAttachment()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  MediaAttachment copyWith(void Function(MediaAttachment) updates) => super.copyWith((message) => updates(message as MediaAttachment)) as MediaAttachment;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MediaAttachment create() => MediaAttachment._();
  MediaAttachment createEmptyInstance() => create();
  static $pb.PbList<MediaAttachment> createRepeated() => $pb.PbList<MediaAttachment>();
  @$core.pragma('dart2js:noInline')
  static MediaAttachment getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<MediaAttachment>(create);
  static MediaAttachment? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String v) { $_setString(0, v); }
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  MediaType get type => $_getN(1);
  @$pb.TagNumber(2)
  set type(MediaType v) { $_setField(2, v); }
  @$pb.TagNumber(2)
  $core.bool hasType() => $_has(1);
  @$pb.TagNumber(2)
  void clearType() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get url => $_getSZ(2);
  @$pb.TagNumber(3)
  set url($core.String v) { $_setString(2, v); }
  @$pb.TagNumber(3)
  $core.bool hasUrl() => $_has(2);
  @$pb.TagNumber(3)
  void clearUrl() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get thumbnailUrl => $_getSZ(3);
  @$pb.TagNumber(4)
  set thumbnailUrl($core.String v) { $_setString(3, v); }
  @$pb.TagNumber(4)
  $core.bool hasThumbnailUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearThumbnailUrl() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get caption => $_getSZ(4);
  @$pb.TagNumber(5)
  set caption($core.String v) { $_setString(4, v); }
  @$pb.TagNumber(5)
  $core.bool hasCaption() => $_has(4);
  @$pb.TagNumber(5)
  void clearCaption() => $_clearField(5);

  @$pb.TagNumber(6)
  $fixnum.Int64 get fileSize => $_getI64(5);
  @$pb.TagNumber(6)
  set fileSize($fixnum.Int64 v) { $_setInt64(5, v); }
  @$pb.TagNumber(6)
  $core.bool hasFileSize() => $_has(5);
  @$pb.TagNumber(6)
  void clearFileSize() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get mimeType => $_getSZ(6);
  @$pb.TagNumber(7)
  set mimeType($core.String v) { $_setString(6, v); }
  @$pb.TagNumber(7)
  $core.bool hasMimeType() => $_has(6);
  @$pb.TagNumber(7)
  void clearMimeType() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.int get width => $_getIZ(7);
  @$pb.TagNumber(8)
  set width($core.int v) { $_setSignedInt32(7, v); }
  @$pb.TagNumber(8)
  $core.bool hasWidth() => $_has(7);
  @$pb.TagNumber(8)
  void clearWidth() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.int get height => $_getIZ(8);
  @$pb.TagNumber(9)
  set height($core.int v) { $_setSignedInt32(8, v); }
  @$pb.TagNumber(9)
  $core.bool hasHeight() => $_has(8);
  @$pb.TagNumber(9)
  void clearHeight() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.int get duration => $_getIZ(9);
  @$pb.TagNumber(10)
  set duration($core.int v) { $_setSignedInt32(9, v); }
  @$pb.TagNumber(10)
  $core.bool hasDuration() => $_has(9);
  @$pb.TagNumber(10)
  void clearDuration() => $_clearField(10);
}

/// Location information for moments
class Location extends $pb.GeneratedMessage {
  factory Location({
    $core.double? latitude,
    $core.double? longitude,
    $core.String? address,
    $core.String? city,
    $core.String? country,
  }) {
    final $result = create();
    if (latitude != null) {
      $result.latitude = latitude;
    }
    if (longitude != null) {
      $result.longitude = longitude;
    }
    if (address != null) {
      $result.address = address;
    }
    if (city != null) {
      $result.city = city;
    }
    if (country != null) {
      $result.country = country;
    }
    return $result;
  }
  Location._() : super();
  factory Location.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory Location.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'Location', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..a<$core.double>(1, _omitFieldNames ? '' : 'latitude', $pb.PbFieldType.OD)
    ..a<$core.double>(2, _omitFieldNames ? '' : 'longitude', $pb.PbFieldType.OD)
    ..aOS(3, _omitFieldNames ? '' : 'address')
    ..aOS(4, _omitFieldNames ? '' : 'city')
    ..aOS(5, _omitFieldNames ? '' : 'country')
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  Location clone() => Location()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  Location copyWith(void Function(Location) updates) => super.copyWith((message) => updates(message as Location)) as Location;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Location create() => Location._();
  Location createEmptyInstance() => create();
  static $pb.PbList<Location> createRepeated() => $pb.PbList<Location>();
  @$core.pragma('dart2js:noInline')
  static Location getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Location>(create);
  static Location? _defaultInstance;

  @$pb.TagNumber(1)
  $core.double get latitude => $_getN(0);
  @$pb.TagNumber(1)
  set latitude($core.double v) { $_setDouble(0, v); }
  @$pb.TagNumber(1)
  $core.bool hasLatitude() => $_has(0);
  @$pb.TagNumber(1)
  void clearLatitude() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.double get longitude => $_getN(1);
  @$pb.TagNumber(2)
  set longitude($core.double v) { $_setDouble(1, v); }
  @$pb.TagNumber(2)
  $core.bool hasLongitude() => $_has(1);
  @$pb.TagNumber(2)
  void clearLongitude() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get address => $_getSZ(2);
  @$pb.TagNumber(3)
  set address($core.String v) { $_setString(2, v); }
  @$pb.TagNumber(3)
  $core.bool hasAddress() => $_has(2);
  @$pb.TagNumber(3)
  void clearAddress() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get city => $_getSZ(3);
  @$pb.TagNumber(4)
  set city($core.String v) { $_setString(3, v); }
  @$pb.TagNumber(4)
  $core.bool hasCity() => $_has(3);
  @$pb.TagNumber(4)
  void clearCity() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get country => $_getSZ(4);
  @$pb.TagNumber(5)
  set country($core.String v) { $_setString(4, v); }
  @$pb.TagNumber(5)
  $core.bool hasCountry() => $_has(4);
  @$pb.TagNumber(5)
  void clearCountry() => $_clearField(5);
}

/// Comment on a moment
class Comment extends $pb.GeneratedMessage {
  factory Comment({
    $core.String? id,
    $core.String? momentId,
    $core.String? authorId,
    $core.String? authorName,
    $core.String? content,
    $core.String? parentCommentId,
    $core.int? likesCount,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final $result = create();
    if (id != null) {
      $result.id = id;
    }
    if (momentId != null) {
      $result.momentId = momentId;
    }
    if (authorId != null) {
      $result.authorId = authorId;
    }
    if (authorName != null) {
      $result.authorName = authorName;
    }
    if (content != null) {
      $result.content = content;
    }
    if (parentCommentId != null) {
      $result.parentCommentId = parentCommentId;
    }
    if (likesCount != null) {
      $result.likesCount = likesCount;
    }
    if (createdAt != null) {
      $result.createdAt = createdAt;
    }
    if (updatedAt != null) {
      $result.updatedAt = updatedAt;
    }
    return $result;
  }
  Comment._() : super();
  factory Comment.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory Comment.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'Comment', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'momentId')
    ..aOS(3, _omitFieldNames ? '' : 'authorId')
    ..aOS(4, _omitFieldNames ? '' : 'authorName')
    ..aOS(5, _omitFieldNames ? '' : 'content')
    ..aOS(6, _omitFieldNames ? '' : 'parentCommentId')
    ..a<$core.int>(7, _omitFieldNames ? '' : 'likesCount', $pb.PbFieldType.O3)
    ..aOM<$0.Timestamp>(8, _omitFieldNames ? '' : 'createdAt', subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(9, _omitFieldNames ? '' : 'updatedAt', subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  Comment clone() => Comment()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  Comment copyWith(void Function(Comment) updates) => super.copyWith((message) => updates(message as Comment)) as Comment;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Comment create() => Comment._();
  Comment createEmptyInstance() => create();
  static $pb.PbList<Comment> createRepeated() => $pb.PbList<Comment>();
  @$core.pragma('dart2js:noInline')
  static Comment getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Comment>(create);
  static Comment? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String v) { $_setString(0, v); }
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get momentId => $_getSZ(1);
  @$pb.TagNumber(2)
  set momentId($core.String v) { $_setString(1, v); }
  @$pb.TagNumber(2)
  $core.bool hasMomentId() => $_has(1);
  @$pb.TagNumber(2)
  void clearMomentId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get authorId => $_getSZ(2);
  @$pb.TagNumber(3)
  set authorId($core.String v) { $_setString(2, v); }
  @$pb.TagNumber(3)
  $core.bool hasAuthorId() => $_has(2);
  @$pb.TagNumber(3)
  void clearAuthorId() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get authorName => $_getSZ(3);
  @$pb.TagNumber(4)
  set authorName($core.String v) { $_setString(3, v); }
  @$pb.TagNumber(4)
  $core.bool hasAuthorName() => $_has(3);
  @$pb.TagNumber(4)
  void clearAuthorName() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get content => $_getSZ(4);
  @$pb.TagNumber(5)
  set content($core.String v) { $_setString(4, v); }
  @$pb.TagNumber(5)
  $core.bool hasContent() => $_has(4);
  @$pb.TagNumber(5)
  void clearContent() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get parentCommentId => $_getSZ(5);
  @$pb.TagNumber(6)
  set parentCommentId($core.String v) { $_setString(5, v); }
  @$pb.TagNumber(6)
  $core.bool hasParentCommentId() => $_has(5);
  @$pb.TagNumber(6)
  void clearParentCommentId() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.int get likesCount => $_getIZ(6);
  @$pb.TagNumber(7)
  set likesCount($core.int v) { $_setSignedInt32(6, v); }
  @$pb.TagNumber(7)
  $core.bool hasLikesCount() => $_has(6);
  @$pb.TagNumber(7)
  void clearLikesCount() => $_clearField(7);

  @$pb.TagNumber(8)
  $0.Timestamp get createdAt => $_getN(7);
  @$pb.TagNumber(8)
  set createdAt($0.Timestamp v) { $_setField(8, v); }
  @$pb.TagNumber(8)
  $core.bool hasCreatedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearCreatedAt() => $_clearField(8);
  @$pb.TagNumber(8)
  $0.Timestamp ensureCreatedAt() => $_ensure(7);

  @$pb.TagNumber(9)
  $0.Timestamp get updatedAt => $_getN(8);
  @$pb.TagNumber(9)
  set updatedAt($0.Timestamp v) { $_setField(9, v); }
  @$pb.TagNumber(9)
  $core.bool hasUpdatedAt() => $_has(8);
  @$pb.TagNumber(9)
  void clearUpdatedAt() => $_clearField(9);
  @$pb.TagNumber(9)
  $0.Timestamp ensureUpdatedAt() => $_ensure(8);
}

/// Like/reaction on moments or comments
class Like extends $pb.GeneratedMessage {
  factory Like({
    $core.String? id,
    $core.String? userId,
    $core.String? targetId,
    LikeTargetType? targetType,
    ReactionType? reaction,
    $0.Timestamp? createdAt,
  }) {
    final $result = create();
    if (id != null) {
      $result.id = id;
    }
    if (userId != null) {
      $result.userId = userId;
    }
    if (targetId != null) {
      $result.targetId = targetId;
    }
    if (targetType != null) {
      $result.targetType = targetType;
    }
    if (reaction != null) {
      $result.reaction = reaction;
    }
    if (createdAt != null) {
      $result.createdAt = createdAt;
    }
    return $result;
  }
  Like._() : super();
  factory Like.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory Like.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'Like', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'userId')
    ..aOS(3, _omitFieldNames ? '' : 'targetId')
    ..e<LikeTargetType>(4, _omitFieldNames ? '' : 'targetType', $pb.PbFieldType.OE, defaultOrMaker: LikeTargetType.LIKE_TARGET_TYPE_UNSPECIFIED, valueOf: LikeTargetType.valueOf, enumValues: LikeTargetType.values)
    ..e<ReactionType>(5, _omitFieldNames ? '' : 'reaction', $pb.PbFieldType.OE, defaultOrMaker: ReactionType.REACTION_TYPE_UNSPECIFIED, valueOf: ReactionType.valueOf, enumValues: ReactionType.values)
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'createdAt', subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  Like clone() => Like()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  Like copyWith(void Function(Like) updates) => super.copyWith((message) => updates(message as Like)) as Like;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Like create() => Like._();
  Like createEmptyInstance() => create();
  static $pb.PbList<Like> createRepeated() => $pb.PbList<Like>();
  @$core.pragma('dart2js:noInline')
  static Like getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Like>(create);
  static Like? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String v) { $_setString(0, v); }
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get userId => $_getSZ(1);
  @$pb.TagNumber(2)
  set userId($core.String v) { $_setString(1, v); }
  @$pb.TagNumber(2)
  $core.bool hasUserId() => $_has(1);
  @$pb.TagNumber(2)
  void clearUserId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get targetId => $_getSZ(2);
  @$pb.TagNumber(3)
  set targetId($core.String v) { $_setString(2, v); }
  @$pb.TagNumber(3)
  $core.bool hasTargetId() => $_has(2);
  @$pb.TagNumber(3)
  void clearTargetId() => $_clearField(3);

  @$pb.TagNumber(4)
  LikeTargetType get targetType => $_getN(3);
  @$pb.TagNumber(4)
  set targetType(LikeTargetType v) { $_setField(4, v); }
  @$pb.TagNumber(4)
  $core.bool hasTargetType() => $_has(3);
  @$pb.TagNumber(4)
  void clearTargetType() => $_clearField(4);

  @$pb.TagNumber(5)
  ReactionType get reaction => $_getN(4);
  @$pb.TagNumber(5)
  set reaction(ReactionType v) { $_setField(5, v); }
  @$pb.TagNumber(5)
  $core.bool hasReaction() => $_has(4);
  @$pb.TagNumber(5)
  void clearReaction() => $_clearField(5);

  @$pb.TagNumber(6)
  $0.Timestamp get createdAt => $_getN(5);
  @$pb.TagNumber(6)
  set createdAt($0.Timestamp v) { $_setField(6, v); }
  @$pb.TagNumber(6)
  $core.bool hasCreatedAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearCreatedAt() => $_clearField(6);
  @$pb.TagNumber(6)
  $0.Timestamp ensureCreatedAt() => $_ensure(5);
}

/// Family member profile
class FamilyMember extends $pb.GeneratedMessage {
  factory FamilyMember({
    $core.String? id,
    $core.String? name,
    $core.String? email,
    $core.String? avatarUrl,
    $core.String? bio,
    FamilyRole? role,
    $core.bool? isActive,
    $0.Timestamp? joinedAt,
    $0.Timestamp? lastSeen,
  }) {
    final $result = create();
    if (id != null) {
      $result.id = id;
    }
    if (name != null) {
      $result.name = name;
    }
    if (email != null) {
      $result.email = email;
    }
    if (avatarUrl != null) {
      $result.avatarUrl = avatarUrl;
    }
    if (bio != null) {
      $result.bio = bio;
    }
    if (role != null) {
      $result.role = role;
    }
    if (isActive != null) {
      $result.isActive = isActive;
    }
    if (joinedAt != null) {
      $result.joinedAt = joinedAt;
    }
    if (lastSeen != null) {
      $result.lastSeen = lastSeen;
    }
    return $result;
  }
  FamilyMember._() : super();
  factory FamilyMember.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory FamilyMember.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'FamilyMember', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'email')
    ..aOS(4, _omitFieldNames ? '' : 'avatarUrl')
    ..aOS(5, _omitFieldNames ? '' : 'bio')
    ..e<FamilyRole>(6, _omitFieldNames ? '' : 'role', $pb.PbFieldType.OE, defaultOrMaker: FamilyRole.FAMILY_ROLE_UNSPECIFIED, valueOf: FamilyRole.valueOf, enumValues: FamilyRole.values)
    ..aOB(7, _omitFieldNames ? '' : 'isActive')
    ..aOM<$0.Timestamp>(8, _omitFieldNames ? '' : 'joinedAt', subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(9, _omitFieldNames ? '' : 'lastSeen', subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  FamilyMember clone() => FamilyMember()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  FamilyMember copyWith(void Function(FamilyMember) updates) => super.copyWith((message) => updates(message as FamilyMember)) as FamilyMember;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static FamilyMember create() => FamilyMember._();
  FamilyMember createEmptyInstance() => create();
  static $pb.PbList<FamilyMember> createRepeated() => $pb.PbList<FamilyMember>();
  @$core.pragma('dart2js:noInline')
  static FamilyMember getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<FamilyMember>(create);
  static FamilyMember? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String v) { $_setString(0, v); }
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String v) { $_setString(1, v); }
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get email => $_getSZ(2);
  @$pb.TagNumber(3)
  set email($core.String v) { $_setString(2, v); }
  @$pb.TagNumber(3)
  $core.bool hasEmail() => $_has(2);
  @$pb.TagNumber(3)
  void clearEmail() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get avatarUrl => $_getSZ(3);
  @$pb.TagNumber(4)
  set avatarUrl($core.String v) { $_setString(3, v); }
  @$pb.TagNumber(4)
  $core.bool hasAvatarUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearAvatarUrl() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get bio => $_getSZ(4);
  @$pb.TagNumber(5)
  set bio($core.String v) { $_setString(4, v); }
  @$pb.TagNumber(5)
  $core.bool hasBio() => $_has(4);
  @$pb.TagNumber(5)
  void clearBio() => $_clearField(5);

  @$pb.TagNumber(6)
  FamilyRole get role => $_getN(5);
  @$pb.TagNumber(6)
  set role(FamilyRole v) { $_setField(6, v); }
  @$pb.TagNumber(6)
  $core.bool hasRole() => $_has(5);
  @$pb.TagNumber(6)
  void clearRole() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.bool get isActive => $_getBF(6);
  @$pb.TagNumber(7)
  set isActive($core.bool v) { $_setBool(6, v); }
  @$pb.TagNumber(7)
  $core.bool hasIsActive() => $_has(6);
  @$pb.TagNumber(7)
  void clearIsActive() => $_clearField(7);

  @$pb.TagNumber(8)
  $0.Timestamp get joinedAt => $_getN(7);
  @$pb.TagNumber(8)
  set joinedAt($0.Timestamp v) { $_setField(8, v); }
  @$pb.TagNumber(8)
  $core.bool hasJoinedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearJoinedAt() => $_clearField(8);
  @$pb.TagNumber(8)
  $0.Timestamp ensureJoinedAt() => $_ensure(7);

  @$pb.TagNumber(9)
  $0.Timestamp get lastSeen => $_getN(8);
  @$pb.TagNumber(9)
  set lastSeen($0.Timestamp v) { $_setField(9, v); }
  @$pb.TagNumber(9)
  $core.bool hasLastSeen() => $_has(8);
  @$pb.TagNumber(9)
  void clearLastSeen() => $_clearField(9);
  @$pb.TagNumber(9)
  $0.Timestamp ensureLastSeen() => $_ensure(8);
}

/// Family group/circle
class Family extends $pb.GeneratedMessage {
  factory Family({
    $core.String? id,
    $core.String? name,
    $core.String? description,
    $core.Iterable<$core.String>? memberIds,
    $core.String? adminId,
    $core.String? inviteCode,
    $core.bool? isPrivate,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final $result = create();
    if (id != null) {
      $result.id = id;
    }
    if (name != null) {
      $result.name = name;
    }
    if (description != null) {
      $result.description = description;
    }
    if (memberIds != null) {
      $result.memberIds.addAll(memberIds);
    }
    if (adminId != null) {
      $result.adminId = adminId;
    }
    if (inviteCode != null) {
      $result.inviteCode = inviteCode;
    }
    if (isPrivate != null) {
      $result.isPrivate = isPrivate;
    }
    if (createdAt != null) {
      $result.createdAt = createdAt;
    }
    if (updatedAt != null) {
      $result.updatedAt = updatedAt;
    }
    return $result;
  }
  Family._() : super();
  factory Family.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory Family.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'Family', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'description')
    ..pPS(4, _omitFieldNames ? '' : 'memberIds')
    ..aOS(5, _omitFieldNames ? '' : 'adminId')
    ..aOS(6, _omitFieldNames ? '' : 'inviteCode')
    ..aOB(7, _omitFieldNames ? '' : 'isPrivate')
    ..aOM<$0.Timestamp>(8, _omitFieldNames ? '' : 'createdAt', subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(9, _omitFieldNames ? '' : 'updatedAt', subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  Family clone() => Family()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  Family copyWith(void Function(Family) updates) => super.copyWith((message) => updates(message as Family)) as Family;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Family create() => Family._();
  Family createEmptyInstance() => create();
  static $pb.PbList<Family> createRepeated() => $pb.PbList<Family>();
  @$core.pragma('dart2js:noInline')
  static Family getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Family>(create);
  static Family? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String v) { $_setString(0, v); }
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String v) { $_setString(1, v); }
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get description => $_getSZ(2);
  @$pb.TagNumber(3)
  set description($core.String v) { $_setString(2, v); }
  @$pb.TagNumber(3)
  $core.bool hasDescription() => $_has(2);
  @$pb.TagNumber(3)
  void clearDescription() => $_clearField(3);

  @$pb.TagNumber(4)
  $pb.PbList<$core.String> get memberIds => $_getList(3);

  @$pb.TagNumber(5)
  $core.String get adminId => $_getSZ(4);
  @$pb.TagNumber(5)
  set adminId($core.String v) { $_setString(4, v); }
  @$pb.TagNumber(5)
  $core.bool hasAdminId() => $_has(4);
  @$pb.TagNumber(5)
  void clearAdminId() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get inviteCode => $_getSZ(5);
  @$pb.TagNumber(6)
  set inviteCode($core.String v) { $_setString(5, v); }
  @$pb.TagNumber(6)
  $core.bool hasInviteCode() => $_has(5);
  @$pb.TagNumber(6)
  void clearInviteCode() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.bool get isPrivate => $_getBF(6);
  @$pb.TagNumber(7)
  set isPrivate($core.bool v) { $_setBool(6, v); }
  @$pb.TagNumber(7)
  $core.bool hasIsPrivate() => $_has(6);
  @$pb.TagNumber(7)
  void clearIsPrivate() => $_clearField(7);

  @$pb.TagNumber(8)
  $0.Timestamp get createdAt => $_getN(7);
  @$pb.TagNumber(8)
  set createdAt($0.Timestamp v) { $_setField(8, v); }
  @$pb.TagNumber(8)
  $core.bool hasCreatedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearCreatedAt() => $_clearField(8);
  @$pb.TagNumber(8)
  $0.Timestamp ensureCreatedAt() => $_ensure(7);

  @$pb.TagNumber(9)
  $0.Timestamp get updatedAt => $_getN(8);
  @$pb.TagNumber(9)
  set updatedAt($0.Timestamp v) { $_setField(9, v); }
  @$pb.TagNumber(9)
  $core.bool hasUpdatedAt() => $_has(8);
  @$pb.TagNumber(9)
  void clearUpdatedAt() => $_clearField(9);
  @$pb.TagNumber(9)
  $0.Timestamp ensureUpdatedAt() => $_ensure(8);
}

/// Request/Response messages for API
class CreateMomentRequest extends $pb.GeneratedMessage {
  factory CreateMomentRequest({
    Moment? moment,
  }) {
    final $result = create();
    if (moment != null) {
      $result.moment = moment;
    }
    return $result;
  }
  CreateMomentRequest._() : super();
  factory CreateMomentRequest.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory CreateMomentRequest.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'CreateMomentRequest', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..aOM<Moment>(1, _omitFieldNames ? '' : 'moment', subBuilder: Moment.create)
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  CreateMomentRequest clone() => CreateMomentRequest()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  CreateMomentRequest copyWith(void Function(CreateMomentRequest) updates) => super.copyWith((message) => updates(message as CreateMomentRequest)) as CreateMomentRequest;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateMomentRequest create() => CreateMomentRequest._();
  CreateMomentRequest createEmptyInstance() => create();
  static $pb.PbList<CreateMomentRequest> createRepeated() => $pb.PbList<CreateMomentRequest>();
  @$core.pragma('dart2js:noInline')
  static CreateMomentRequest getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<CreateMomentRequest>(create);
  static CreateMomentRequest? _defaultInstance;

  @$pb.TagNumber(1)
  Moment get moment => $_getN(0);
  @$pb.TagNumber(1)
  set moment(Moment v) { $_setField(1, v); }
  @$pb.TagNumber(1)
  $core.bool hasMoment() => $_has(0);
  @$pb.TagNumber(1)
  void clearMoment() => $_clearField(1);
  @$pb.TagNumber(1)
  Moment ensureMoment() => $_ensure(0);
}

class CreateMomentResponse extends $pb.GeneratedMessage {
  factory CreateMomentResponse({
    Moment? moment,
  }) {
    final $result = create();
    if (moment != null) {
      $result.moment = moment;
    }
    return $result;
  }
  CreateMomentResponse._() : super();
  factory CreateMomentResponse.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory CreateMomentResponse.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'CreateMomentResponse', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..aOM<Moment>(1, _omitFieldNames ? '' : 'moment', subBuilder: Moment.create)
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  CreateMomentResponse clone() => CreateMomentResponse()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  CreateMomentResponse copyWith(void Function(CreateMomentResponse) updates) => super.copyWith((message) => updates(message as CreateMomentResponse)) as CreateMomentResponse;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateMomentResponse create() => CreateMomentResponse._();
  CreateMomentResponse createEmptyInstance() => create();
  static $pb.PbList<CreateMomentResponse> createRepeated() => $pb.PbList<CreateMomentResponse>();
  @$core.pragma('dart2js:noInline')
  static CreateMomentResponse getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<CreateMomentResponse>(create);
  static CreateMomentResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Moment get moment => $_getN(0);
  @$pb.TagNumber(1)
  set moment(Moment v) { $_setField(1, v); }
  @$pb.TagNumber(1)
  $core.bool hasMoment() => $_has(0);
  @$pb.TagNumber(1)
  void clearMoment() => $_clearField(1);
  @$pb.TagNumber(1)
  Moment ensureMoment() => $_ensure(0);
}

class GetMomentsRequest extends $pb.GeneratedMessage {
  factory GetMomentsRequest({
    $core.String? familyId,
    $core.int? pageSize,
    $core.String? pageToken,
    MomentType? typeFilter,
    $core.String? authorFilter,
  }) {
    final $result = create();
    if (familyId != null) {
      $result.familyId = familyId;
    }
    if (pageSize != null) {
      $result.pageSize = pageSize;
    }
    if (pageToken != null) {
      $result.pageToken = pageToken;
    }
    if (typeFilter != null) {
      $result.typeFilter = typeFilter;
    }
    if (authorFilter != null) {
      $result.authorFilter = authorFilter;
    }
    return $result;
  }
  GetMomentsRequest._() : super();
  factory GetMomentsRequest.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory GetMomentsRequest.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'GetMomentsRequest', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'familyId')
    ..a<$core.int>(2, _omitFieldNames ? '' : 'pageSize', $pb.PbFieldType.O3)
    ..aOS(3, _omitFieldNames ? '' : 'pageToken')
    ..e<MomentType>(4, _omitFieldNames ? '' : 'typeFilter', $pb.PbFieldType.OE, defaultOrMaker: MomentType.MOMENT_TYPE_UNSPECIFIED, valueOf: MomentType.valueOf, enumValues: MomentType.values)
    ..aOS(5, _omitFieldNames ? '' : 'authorFilter')
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  GetMomentsRequest clone() => GetMomentsRequest()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  GetMomentsRequest copyWith(void Function(GetMomentsRequest) updates) => super.copyWith((message) => updates(message as GetMomentsRequest)) as GetMomentsRequest;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetMomentsRequest create() => GetMomentsRequest._();
  GetMomentsRequest createEmptyInstance() => create();
  static $pb.PbList<GetMomentsRequest> createRepeated() => $pb.PbList<GetMomentsRequest>();
  @$core.pragma('dart2js:noInline')
  static GetMomentsRequest getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<GetMomentsRequest>(create);
  static GetMomentsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get familyId => $_getSZ(0);
  @$pb.TagNumber(1)
  set familyId($core.String v) { $_setString(0, v); }
  @$pb.TagNumber(1)
  $core.bool hasFamilyId() => $_has(0);
  @$pb.TagNumber(1)
  void clearFamilyId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get pageSize => $_getIZ(1);
  @$pb.TagNumber(2)
  set pageSize($core.int v) { $_setSignedInt32(1, v); }
  @$pb.TagNumber(2)
  $core.bool hasPageSize() => $_has(1);
  @$pb.TagNumber(2)
  void clearPageSize() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get pageToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set pageToken($core.String v) { $_setString(2, v); }
  @$pb.TagNumber(3)
  $core.bool hasPageToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearPageToken() => $_clearField(3);

  @$pb.TagNumber(4)
  MomentType get typeFilter => $_getN(3);
  @$pb.TagNumber(4)
  set typeFilter(MomentType v) { $_setField(4, v); }
  @$pb.TagNumber(4)
  $core.bool hasTypeFilter() => $_has(3);
  @$pb.TagNumber(4)
  void clearTypeFilter() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get authorFilter => $_getSZ(4);
  @$pb.TagNumber(5)
  set authorFilter($core.String v) { $_setString(4, v); }
  @$pb.TagNumber(5)
  $core.bool hasAuthorFilter() => $_has(4);
  @$pb.TagNumber(5)
  void clearAuthorFilter() => $_clearField(5);
}

class GetMomentsResponse extends $pb.GeneratedMessage {
  factory GetMomentsResponse({
    $core.Iterable<Moment>? moments,
    $core.String? nextPageToken,
    $core.int? totalCount,
  }) {
    final $result = create();
    if (moments != null) {
      $result.moments.addAll(moments);
    }
    if (nextPageToken != null) {
      $result.nextPageToken = nextPageToken;
    }
    if (totalCount != null) {
      $result.totalCount = totalCount;
    }
    return $result;
  }
  GetMomentsResponse._() : super();
  factory GetMomentsResponse.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory GetMomentsResponse.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'GetMomentsResponse', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..pc<Moment>(1, _omitFieldNames ? '' : 'moments', $pb.PbFieldType.PM, subBuilder: Moment.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextPageToken')
    ..a<$core.int>(3, _omitFieldNames ? '' : 'totalCount', $pb.PbFieldType.O3)
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  GetMomentsResponse clone() => GetMomentsResponse()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  GetMomentsResponse copyWith(void Function(GetMomentsResponse) updates) => super.copyWith((message) => updates(message as GetMomentsResponse)) as GetMomentsResponse;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetMomentsResponse create() => GetMomentsResponse._();
  GetMomentsResponse createEmptyInstance() => create();
  static $pb.PbList<GetMomentsResponse> createRepeated() => $pb.PbList<GetMomentsResponse>();
  @$core.pragma('dart2js:noInline')
  static GetMomentsResponse getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<GetMomentsResponse>(create);
  static GetMomentsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Moment> get moments => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextPageToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextPageToken($core.String v) { $_setString(1, v); }
  @$pb.TagNumber(2)
  $core.bool hasNextPageToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextPageToken() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get totalCount => $_getIZ(2);
  @$pb.TagNumber(3)
  set totalCount($core.int v) { $_setSignedInt32(2, v); }
  @$pb.TagNumber(3)
  $core.bool hasTotalCount() => $_has(2);
  @$pb.TagNumber(3)
  void clearTotalCount() => $_clearField(3);
}

class AddCommentRequest extends $pb.GeneratedMessage {
  factory AddCommentRequest({
    Comment? comment,
  }) {
    final $result = create();
    if (comment != null) {
      $result.comment = comment;
    }
    return $result;
  }
  AddCommentRequest._() : super();
  factory AddCommentRequest.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory AddCommentRequest.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'AddCommentRequest', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..aOM<Comment>(1, _omitFieldNames ? '' : 'comment', subBuilder: Comment.create)
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  AddCommentRequest clone() => AddCommentRequest()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  AddCommentRequest copyWith(void Function(AddCommentRequest) updates) => super.copyWith((message) => updates(message as AddCommentRequest)) as AddCommentRequest;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AddCommentRequest create() => AddCommentRequest._();
  AddCommentRequest createEmptyInstance() => create();
  static $pb.PbList<AddCommentRequest> createRepeated() => $pb.PbList<AddCommentRequest>();
  @$core.pragma('dart2js:noInline')
  static AddCommentRequest getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<AddCommentRequest>(create);
  static AddCommentRequest? _defaultInstance;

  @$pb.TagNumber(1)
  Comment get comment => $_getN(0);
  @$pb.TagNumber(1)
  set comment(Comment v) { $_setField(1, v); }
  @$pb.TagNumber(1)
  $core.bool hasComment() => $_has(0);
  @$pb.TagNumber(1)
  void clearComment() => $_clearField(1);
  @$pb.TagNumber(1)
  Comment ensureComment() => $_ensure(0);
}

class AddCommentResponse extends $pb.GeneratedMessage {
  factory AddCommentResponse({
    Comment? comment,
  }) {
    final $result = create();
    if (comment != null) {
      $result.comment = comment;
    }
    return $result;
  }
  AddCommentResponse._() : super();
  factory AddCommentResponse.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory AddCommentResponse.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'AddCommentResponse', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..aOM<Comment>(1, _omitFieldNames ? '' : 'comment', subBuilder: Comment.create)
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  AddCommentResponse clone() => AddCommentResponse()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  AddCommentResponse copyWith(void Function(AddCommentResponse) updates) => super.copyWith((message) => updates(message as AddCommentResponse)) as AddCommentResponse;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AddCommentResponse create() => AddCommentResponse._();
  AddCommentResponse createEmptyInstance() => create();
  static $pb.PbList<AddCommentResponse> createRepeated() => $pb.PbList<AddCommentResponse>();
  @$core.pragma('dart2js:noInline')
  static AddCommentResponse getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<AddCommentResponse>(create);
  static AddCommentResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Comment get comment => $_getN(0);
  @$pb.TagNumber(1)
  set comment(Comment v) { $_setField(1, v); }
  @$pb.TagNumber(1)
  $core.bool hasComment() => $_has(0);
  @$pb.TagNumber(1)
  void clearComment() => $_clearField(1);
  @$pb.TagNumber(1)
  Comment ensureComment() => $_ensure(0);
}

class AddLikeRequest extends $pb.GeneratedMessage {
  factory AddLikeRequest({
    Like? like,
  }) {
    final $result = create();
    if (like != null) {
      $result.like = like;
    }
    return $result;
  }
  AddLikeRequest._() : super();
  factory AddLikeRequest.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory AddLikeRequest.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'AddLikeRequest', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..aOM<Like>(1, _omitFieldNames ? '' : 'like', subBuilder: Like.create)
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  AddLikeRequest clone() => AddLikeRequest()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  AddLikeRequest copyWith(void Function(AddLikeRequest) updates) => super.copyWith((message) => updates(message as AddLikeRequest)) as AddLikeRequest;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AddLikeRequest create() => AddLikeRequest._();
  AddLikeRequest createEmptyInstance() => create();
  static $pb.PbList<AddLikeRequest> createRepeated() => $pb.PbList<AddLikeRequest>();
  @$core.pragma('dart2js:noInline')
  static AddLikeRequest getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<AddLikeRequest>(create);
  static AddLikeRequest? _defaultInstance;

  @$pb.TagNumber(1)
  Like get like => $_getN(0);
  @$pb.TagNumber(1)
  set like(Like v) { $_setField(1, v); }
  @$pb.TagNumber(1)
  $core.bool hasLike() => $_has(0);
  @$pb.TagNumber(1)
  void clearLike() => $_clearField(1);
  @$pb.TagNumber(1)
  Like ensureLike() => $_ensure(0);
}

class AddLikeResponse extends $pb.GeneratedMessage {
  factory AddLikeResponse({
    Like? like,
  }) {
    final $result = create();
    if (like != null) {
      $result.like = like;
    }
    return $result;
  }
  AddLikeResponse._() : super();
  factory AddLikeResponse.fromBuffer($core.List<$core.int> i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromBuffer(i, r);
  factory AddLikeResponse.fromJson($core.String i, [$pb.ExtensionRegistry r = $pb.ExtensionRegistry.EMPTY]) => create()..mergeFromJson(i, r);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(_omitMessageNames ? '' : 'AddLikeResponse', package: const $pb.PackageName(_omitMessageNames ? '' : 'moments'), createEmptyInstance: create)
    ..aOM<Like>(1, _omitFieldNames ? '' : 'like', subBuilder: Like.create)
    ..hasRequiredFields = false
  ;

  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.deepCopy] instead. '
  'Will be removed in next major version')
  AddLikeResponse clone() => AddLikeResponse()..mergeFromMessage(this);
  @$core.Deprecated(
  'Using this can add significant overhead to your binary. '
  'Use [GeneratedMessageGenericExtensions.rebuild] instead. '
  'Will be removed in next major version')
  AddLikeResponse copyWith(void Function(AddLikeResponse) updates) => super.copyWith((message) => updates(message as AddLikeResponse)) as AddLikeResponse;

  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AddLikeResponse create() => AddLikeResponse._();
  AddLikeResponse createEmptyInstance() => create();
  static $pb.PbList<AddLikeResponse> createRepeated() => $pb.PbList<AddLikeResponse>();
  @$core.pragma('dart2js:noInline')
  static AddLikeResponse getDefault() => _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<AddLikeResponse>(create);
  static AddLikeResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Like get like => $_getN(0);
  @$pb.TagNumber(1)
  set like(Like v) { $_setField(1, v); }
  @$pb.TagNumber(1)
  $core.bool hasLike() => $_has(0);
  @$pb.TagNumber(1)
  void clearLike() => $_clearField(1);
  @$pb.TagNumber(1)
  Like ensureLike() => $_ensure(0);
}


const _omitFieldNames = $core.bool.fromEnvironment('protobuf.omit_field_names');
const _omitMessageNames = $core.bool.fromEnvironment('protobuf.omit_message_names');
