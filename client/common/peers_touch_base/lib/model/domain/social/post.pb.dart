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

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart'
    as $0;

import '../activity/activity.pb.dart' as $1;
import 'post.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'post.pbenum.dart';

enum Post_Content {
  textPost,
  imagePost,
  videoPost,
  linkPost,
  pollPost,
  repostPost,
  locationPost,
  notSet
}

class Post extends $pb.GeneratedMessage {
  factory Post({
    $core.String? id,
    $core.String? authorId,
    PostType? type,
    PostVisibility? visibility,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
    $core.bool? isDeleted,
    PostStats? stats,
    PostAuthor? author,
    PostInteraction? interaction,
    TextPost? textPost,
    ImagePost? imagePost,
    VideoPost? videoPost,
    LinkPost? linkPost,
    PollPost? pollPost,
    RepostPost? repostPost,
    LocationPost? locationPost,
    $core.String? replyToPostId,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (authorId != null) result.authorId = authorId;
    if (type != null) result.type = type;
    if (visibility != null) result.visibility = visibility;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    if (isDeleted != null) result.isDeleted = isDeleted;
    if (stats != null) result.stats = stats;
    if (author != null) result.author = author;
    if (interaction != null) result.interaction = interaction;
    if (textPost != null) result.textPost = textPost;
    if (imagePost != null) result.imagePost = imagePost;
    if (videoPost != null) result.videoPost = videoPost;
    if (linkPost != null) result.linkPost = linkPost;
    if (pollPost != null) result.pollPost = pollPost;
    if (repostPost != null) result.repostPost = repostPost;
    if (locationPost != null) result.locationPost = locationPost;
    if (replyToPostId != null) result.replyToPostId = replyToPostId;
    return result;
  }

  Post._();

  factory Post.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Post.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static const $core.Map<$core.int, Post_Content> _Post_ContentByTag = {
    30: Post_Content.textPost,
    31: Post_Content.imagePost,
    32: Post_Content.videoPost,
    33: Post_Content.linkPost,
    34: Post_Content.pollPost,
    35: Post_Content.repostPost,
    36: Post_Content.locationPost,
    0: Post_Content.notSet
  };
  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Post',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..oo(0, [30, 31, 32, 33, 34, 35, 36])
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'authorId')
    ..aE<PostType>(3, _omitFieldNames ? '' : 'type',
        enumValues: PostType.values)
    ..aE<PostVisibility>(4, _omitFieldNames ? '' : 'visibility',
        enumValues: PostVisibility.values)
    ..aOM<$0.Timestamp>(5, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..aOB(7, _omitFieldNames ? '' : 'isDeleted')
    ..aOM<PostStats>(10, _omitFieldNames ? '' : 'stats',
        subBuilder: PostStats.create)
    ..aOM<PostAuthor>(20, _omitFieldNames ? '' : 'author',
        subBuilder: PostAuthor.create)
    ..aOM<PostInteraction>(21, _omitFieldNames ? '' : 'interaction',
        subBuilder: PostInteraction.create)
    ..aOM<TextPost>(30, _omitFieldNames ? '' : 'textPost',
        subBuilder: TextPost.create)
    ..aOM<ImagePost>(31, _omitFieldNames ? '' : 'imagePost',
        subBuilder: ImagePost.create)
    ..aOM<VideoPost>(32, _omitFieldNames ? '' : 'videoPost',
        subBuilder: VideoPost.create)
    ..aOM<LinkPost>(33, _omitFieldNames ? '' : 'linkPost',
        subBuilder: LinkPost.create)
    ..aOM<PollPost>(34, _omitFieldNames ? '' : 'pollPost',
        subBuilder: PollPost.create)
    ..aOM<RepostPost>(35, _omitFieldNames ? '' : 'repostPost',
        subBuilder: RepostPost.create)
    ..aOM<LocationPost>(36, _omitFieldNames ? '' : 'locationPost',
        subBuilder: LocationPost.create)
    ..aOS(40, _omitFieldNames ? '' : 'replyToPostId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Post clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Post copyWith(void Function(Post) updates) =>
      super.copyWith((message) => updates(message as Post)) as Post;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Post create() => Post._();
  @$core.override
  Post createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Post getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Post>(create);
  static Post? _defaultInstance;

  @$pb.TagNumber(30)
  @$pb.TagNumber(31)
  @$pb.TagNumber(32)
  @$pb.TagNumber(33)
  @$pb.TagNumber(34)
  @$pb.TagNumber(35)
  @$pb.TagNumber(36)
  Post_Content whichContent() => _Post_ContentByTag[$_whichOneof(0)]!;
  @$pb.TagNumber(30)
  @$pb.TagNumber(31)
  @$pb.TagNumber(32)
  @$pb.TagNumber(33)
  @$pb.TagNumber(34)
  @$pb.TagNumber(35)
  @$pb.TagNumber(36)
  void clearContent() => $_clearField($_whichOneof(0));

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get authorId => $_getSZ(1);
  @$pb.TagNumber(2)
  set authorId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasAuthorId() => $_has(1);
  @$pb.TagNumber(2)
  void clearAuthorId() => $_clearField(2);

  @$pb.TagNumber(3)
  PostType get type => $_getN(2);
  @$pb.TagNumber(3)
  set type(PostType value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasType() => $_has(2);
  @$pb.TagNumber(3)
  void clearType() => $_clearField(3);

  @$pb.TagNumber(4)
  PostVisibility get visibility => $_getN(3);
  @$pb.TagNumber(4)
  set visibility(PostVisibility value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasVisibility() => $_has(3);
  @$pb.TagNumber(4)
  void clearVisibility() => $_clearField(4);

  @$pb.TagNumber(5)
  $0.Timestamp get createdAt => $_getN(4);
  @$pb.TagNumber(5)
  set createdAt($0.Timestamp value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasCreatedAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearCreatedAt() => $_clearField(5);
  @$pb.TagNumber(5)
  $0.Timestamp ensureCreatedAt() => $_ensure(4);

  @$pb.TagNumber(6)
  $0.Timestamp get updatedAt => $_getN(5);
  @$pb.TagNumber(6)
  set updatedAt($0.Timestamp value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasUpdatedAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearUpdatedAt() => $_clearField(6);
  @$pb.TagNumber(6)
  $0.Timestamp ensureUpdatedAt() => $_ensure(5);

  @$pb.TagNumber(7)
  $core.bool get isDeleted => $_getBF(6);
  @$pb.TagNumber(7)
  set isDeleted($core.bool value) => $_setBool(6, value);
  @$pb.TagNumber(7)
  $core.bool hasIsDeleted() => $_has(6);
  @$pb.TagNumber(7)
  void clearIsDeleted() => $_clearField(7);

  @$pb.TagNumber(10)
  PostStats get stats => $_getN(7);
  @$pb.TagNumber(10)
  set stats(PostStats value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasStats() => $_has(7);
  @$pb.TagNumber(10)
  void clearStats() => $_clearField(10);
  @$pb.TagNumber(10)
  PostStats ensureStats() => $_ensure(7);

  @$pb.TagNumber(20)
  PostAuthor get author => $_getN(8);
  @$pb.TagNumber(20)
  set author(PostAuthor value) => $_setField(20, value);
  @$pb.TagNumber(20)
  $core.bool hasAuthor() => $_has(8);
  @$pb.TagNumber(20)
  void clearAuthor() => $_clearField(20);
  @$pb.TagNumber(20)
  PostAuthor ensureAuthor() => $_ensure(8);

  @$pb.TagNumber(21)
  PostInteraction get interaction => $_getN(9);
  @$pb.TagNumber(21)
  set interaction(PostInteraction value) => $_setField(21, value);
  @$pb.TagNumber(21)
  $core.bool hasInteraction() => $_has(9);
  @$pb.TagNumber(21)
  void clearInteraction() => $_clearField(21);
  @$pb.TagNumber(21)
  PostInteraction ensureInteraction() => $_ensure(9);

  @$pb.TagNumber(30)
  TextPost get textPost => $_getN(10);
  @$pb.TagNumber(30)
  set textPost(TextPost value) => $_setField(30, value);
  @$pb.TagNumber(30)
  $core.bool hasTextPost() => $_has(10);
  @$pb.TagNumber(30)
  void clearTextPost() => $_clearField(30);
  @$pb.TagNumber(30)
  TextPost ensureTextPost() => $_ensure(10);

  @$pb.TagNumber(31)
  ImagePost get imagePost => $_getN(11);
  @$pb.TagNumber(31)
  set imagePost(ImagePost value) => $_setField(31, value);
  @$pb.TagNumber(31)
  $core.bool hasImagePost() => $_has(11);
  @$pb.TagNumber(31)
  void clearImagePost() => $_clearField(31);
  @$pb.TagNumber(31)
  ImagePost ensureImagePost() => $_ensure(11);

  @$pb.TagNumber(32)
  VideoPost get videoPost => $_getN(12);
  @$pb.TagNumber(32)
  set videoPost(VideoPost value) => $_setField(32, value);
  @$pb.TagNumber(32)
  $core.bool hasVideoPost() => $_has(12);
  @$pb.TagNumber(32)
  void clearVideoPost() => $_clearField(32);
  @$pb.TagNumber(32)
  VideoPost ensureVideoPost() => $_ensure(12);

  @$pb.TagNumber(33)
  LinkPost get linkPost => $_getN(13);
  @$pb.TagNumber(33)
  set linkPost(LinkPost value) => $_setField(33, value);
  @$pb.TagNumber(33)
  $core.bool hasLinkPost() => $_has(13);
  @$pb.TagNumber(33)
  void clearLinkPost() => $_clearField(33);
  @$pb.TagNumber(33)
  LinkPost ensureLinkPost() => $_ensure(13);

  @$pb.TagNumber(34)
  PollPost get pollPost => $_getN(14);
  @$pb.TagNumber(34)
  set pollPost(PollPost value) => $_setField(34, value);
  @$pb.TagNumber(34)
  $core.bool hasPollPost() => $_has(14);
  @$pb.TagNumber(34)
  void clearPollPost() => $_clearField(34);
  @$pb.TagNumber(34)
  PollPost ensurePollPost() => $_ensure(14);

  @$pb.TagNumber(35)
  RepostPost get repostPost => $_getN(15);
  @$pb.TagNumber(35)
  set repostPost(RepostPost value) => $_setField(35, value);
  @$pb.TagNumber(35)
  $core.bool hasRepostPost() => $_has(15);
  @$pb.TagNumber(35)
  void clearRepostPost() => $_clearField(35);
  @$pb.TagNumber(35)
  RepostPost ensureRepostPost() => $_ensure(15);

  @$pb.TagNumber(36)
  LocationPost get locationPost => $_getN(16);
  @$pb.TagNumber(36)
  set locationPost(LocationPost value) => $_setField(36, value);
  @$pb.TagNumber(36)
  $core.bool hasLocationPost() => $_has(16);
  @$pb.TagNumber(36)
  void clearLocationPost() => $_clearField(36);
  @$pb.TagNumber(36)
  LocationPost ensureLocationPost() => $_ensure(16);

  @$pb.TagNumber(40)
  $core.String get replyToPostId => $_getSZ(17);
  @$pb.TagNumber(40)
  set replyToPostId($core.String value) => $_setString(17, value);
  @$pb.TagNumber(40)
  $core.bool hasReplyToPostId() => $_has(17);
  @$pb.TagNumber(40)
  void clearReplyToPostId() => $_clearField(40);
}

class PostStats extends $pb.GeneratedMessage {
  factory PostStats({
    $fixnum.Int64? likesCount,
    $fixnum.Int64? commentsCount,
    $fixnum.Int64? repostsCount,
    $fixnum.Int64? viewsCount,
  }) {
    final result = create();
    if (likesCount != null) result.likesCount = likesCount;
    if (commentsCount != null) result.commentsCount = commentsCount;
    if (repostsCount != null) result.repostsCount = repostsCount;
    if (viewsCount != null) result.viewsCount = viewsCount;
    return result;
  }

  PostStats._();

  factory PostStats.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostStats.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostStats',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aInt64(1, _omitFieldNames ? '' : 'likesCount')
    ..aInt64(2, _omitFieldNames ? '' : 'commentsCount')
    ..aInt64(3, _omitFieldNames ? '' : 'repostsCount')
    ..aInt64(4, _omitFieldNames ? '' : 'viewsCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostStats clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostStats copyWith(void Function(PostStats) updates) =>
      super.copyWith((message) => updates(message as PostStats)) as PostStats;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostStats create() => PostStats._();
  @$core.override
  PostStats createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostStats getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<PostStats>(create);
  static PostStats? _defaultInstance;

  @$pb.TagNumber(1)
  $fixnum.Int64 get likesCount => $_getI64(0);
  @$pb.TagNumber(1)
  set likesCount($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasLikesCount() => $_has(0);
  @$pb.TagNumber(1)
  void clearLikesCount() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get commentsCount => $_getI64(1);
  @$pb.TagNumber(2)
  set commentsCount($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCommentsCount() => $_has(1);
  @$pb.TagNumber(2)
  void clearCommentsCount() => $_clearField(2);

  @$pb.TagNumber(3)
  $fixnum.Int64 get repostsCount => $_getI64(2);
  @$pb.TagNumber(3)
  set repostsCount($fixnum.Int64 value) => $_setInt64(2, value);
  @$pb.TagNumber(3)
  $core.bool hasRepostsCount() => $_has(2);
  @$pb.TagNumber(3)
  void clearRepostsCount() => $_clearField(3);

  @$pb.TagNumber(4)
  $fixnum.Int64 get viewsCount => $_getI64(3);
  @$pb.TagNumber(4)
  set viewsCount($fixnum.Int64 value) => $_setInt64(3, value);
  @$pb.TagNumber(4)
  $core.bool hasViewsCount() => $_has(3);
  @$pb.TagNumber(4)
  void clearViewsCount() => $_clearField(4);
}

class PostAuthor extends $pb.GeneratedMessage {
  factory PostAuthor({
    $core.String? id,
    $core.String? username,
    $core.String? displayName,
    $core.String? avatarUrl,
    $core.bool? isFollowing,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (username != null) result.username = username;
    if (displayName != null) result.displayName = displayName;
    if (avatarUrl != null) result.avatarUrl = avatarUrl;
    if (isFollowing != null) result.isFollowing = isFollowing;
    return result;
  }

  PostAuthor._();

  factory PostAuthor.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostAuthor.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostAuthor',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'username')
    ..aOS(3, _omitFieldNames ? '' : 'displayName')
    ..aOS(4, _omitFieldNames ? '' : 'avatarUrl')
    ..aOB(5, _omitFieldNames ? '' : 'isFollowing')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostAuthor clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostAuthor copyWith(void Function(PostAuthor) updates) =>
      super.copyWith((message) => updates(message as PostAuthor)) as PostAuthor;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostAuthor create() => PostAuthor._();
  @$core.override
  PostAuthor createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostAuthor getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostAuthor>(create);
  static PostAuthor? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get username => $_getSZ(1);
  @$pb.TagNumber(2)
  set username($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUsername() => $_has(1);
  @$pb.TagNumber(2)
  void clearUsername() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get displayName => $_getSZ(2);
  @$pb.TagNumber(3)
  set displayName($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDisplayName() => $_has(2);
  @$pb.TagNumber(3)
  void clearDisplayName() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get avatarUrl => $_getSZ(3);
  @$pb.TagNumber(4)
  set avatarUrl($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasAvatarUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearAvatarUrl() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.bool get isFollowing => $_getBF(4);
  @$pb.TagNumber(5)
  set isFollowing($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasIsFollowing() => $_has(4);
  @$pb.TagNumber(5)
  void clearIsFollowing() => $_clearField(5);
}

class PostInteraction extends $pb.GeneratedMessage {
  factory PostInteraction({
    $core.bool? isLiked,
    $core.bool? isReposted,
    $core.bool? isBookmarked,
  }) {
    final result = create();
    if (isLiked != null) result.isLiked = isLiked;
    if (isReposted != null) result.isReposted = isReposted;
    if (isBookmarked != null) result.isBookmarked = isBookmarked;
    return result;
  }

  PostInteraction._();

  factory PostInteraction.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostInteraction.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostInteraction',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'isLiked')
    ..aOB(2, _omitFieldNames ? '' : 'isReposted')
    ..aOB(3, _omitFieldNames ? '' : 'isBookmarked')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostInteraction clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostInteraction copyWith(void Function(PostInteraction) updates) =>
      super.copyWith((message) => updates(message as PostInteraction))
          as PostInteraction;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostInteraction create() => PostInteraction._();
  @$core.override
  PostInteraction createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostInteraction getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostInteraction>(create);
  static PostInteraction? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get isLiked => $_getBF(0);
  @$pb.TagNumber(1)
  set isLiked($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasIsLiked() => $_has(0);
  @$pb.TagNumber(1)
  void clearIsLiked() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.bool get isReposted => $_getBF(1);
  @$pb.TagNumber(2)
  set isReposted($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasIsReposted() => $_has(1);
  @$pb.TagNumber(2)
  void clearIsReposted() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.bool get isBookmarked => $_getBF(2);
  @$pb.TagNumber(3)
  set isBookmarked($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasIsBookmarked() => $_has(2);
  @$pb.TagNumber(3)
  void clearIsBookmarked() => $_clearField(3);
}

class TextPost extends $pb.GeneratedMessage {
  factory TextPost({
    $core.String? text,
    $core.Iterable<$core.String>? hashtags,
    $core.Iterable<$core.String>? mentions,
  }) {
    final result = create();
    if (text != null) result.text = text;
    if (hashtags != null) result.hashtags.addAll(hashtags);
    if (mentions != null) result.mentions.addAll(mentions);
    return result;
  }

  TextPost._();

  factory TextPost.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory TextPost.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TextPost',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'text')
    ..pPS(2, _omitFieldNames ? '' : 'hashtags')
    ..pPS(3, _omitFieldNames ? '' : 'mentions')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TextPost clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TextPost copyWith(void Function(TextPost) updates) =>
      super.copyWith((message) => updates(message as TextPost)) as TextPost;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static TextPost create() => TextPost._();
  @$core.override
  TextPost createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static TextPost getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<TextPost>(create);
  static TextPost? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get text => $_getSZ(0);
  @$pb.TagNumber(1)
  set text($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasText() => $_has(0);
  @$pb.TagNumber(1)
  void clearText() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get hashtags => $_getList(1);

  @$pb.TagNumber(3)
  $pb.PbList<$core.String> get mentions => $_getList(2);
}

class ImagePost extends $pb.GeneratedMessage {
  factory ImagePost({
    $core.String? text,
    $core.Iterable<ImageAttachment>? images,
    $core.Iterable<$core.String>? hashtags,
    $core.Iterable<$core.String>? mentions,
  }) {
    final result = create();
    if (text != null) result.text = text;
    if (images != null) result.images.addAll(images);
    if (hashtags != null) result.hashtags.addAll(hashtags);
    if (mentions != null) result.mentions.addAll(mentions);
    return result;
  }

  ImagePost._();

  factory ImagePost.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ImagePost.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ImagePost',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'text')
    ..pPM<ImageAttachment>(2, _omitFieldNames ? '' : 'images',
        subBuilder: ImageAttachment.create)
    ..pPS(3, _omitFieldNames ? '' : 'hashtags')
    ..pPS(4, _omitFieldNames ? '' : 'mentions')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ImagePost clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ImagePost copyWith(void Function(ImagePost) updates) =>
      super.copyWith((message) => updates(message as ImagePost)) as ImagePost;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ImagePost create() => ImagePost._();
  @$core.override
  ImagePost createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ImagePost getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<ImagePost>(create);
  static ImagePost? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get text => $_getSZ(0);
  @$pb.TagNumber(1)
  set text($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasText() => $_has(0);
  @$pb.TagNumber(1)
  void clearText() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<ImageAttachment> get images => $_getList(1);

  @$pb.TagNumber(3)
  $pb.PbList<$core.String> get hashtags => $_getList(2);

  @$pb.TagNumber(4)
  $pb.PbList<$core.String> get mentions => $_getList(3);
}

class VideoPost extends $pb.GeneratedMessage {
  factory VideoPost({
    $core.String? text,
    VideoAttachment? video,
    $core.Iterable<$core.String>? hashtags,
    $core.Iterable<$core.String>? mentions,
  }) {
    final result = create();
    if (text != null) result.text = text;
    if (video != null) result.video = video;
    if (hashtags != null) result.hashtags.addAll(hashtags);
    if (mentions != null) result.mentions.addAll(mentions);
    return result;
  }

  VideoPost._();

  factory VideoPost.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory VideoPost.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'VideoPost',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'text')
    ..aOM<VideoAttachment>(2, _omitFieldNames ? '' : 'video',
        subBuilder: VideoAttachment.create)
    ..pPS(3, _omitFieldNames ? '' : 'hashtags')
    ..pPS(4, _omitFieldNames ? '' : 'mentions')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VideoPost clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VideoPost copyWith(void Function(VideoPost) updates) =>
      super.copyWith((message) => updates(message as VideoPost)) as VideoPost;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static VideoPost create() => VideoPost._();
  @$core.override
  VideoPost createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static VideoPost getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<VideoPost>(create);
  static VideoPost? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get text => $_getSZ(0);
  @$pb.TagNumber(1)
  set text($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasText() => $_has(0);
  @$pb.TagNumber(1)
  void clearText() => $_clearField(1);

  @$pb.TagNumber(2)
  VideoAttachment get video => $_getN(1);
  @$pb.TagNumber(2)
  set video(VideoAttachment value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasVideo() => $_has(1);
  @$pb.TagNumber(2)
  void clearVideo() => $_clearField(2);
  @$pb.TagNumber(2)
  VideoAttachment ensureVideo() => $_ensure(1);

  @$pb.TagNumber(3)
  $pb.PbList<$core.String> get hashtags => $_getList(2);

  @$pb.TagNumber(4)
  $pb.PbList<$core.String> get mentions => $_getList(3);
}

class LinkPost extends $pb.GeneratedMessage {
  factory LinkPost({
    $core.String? text,
    LinkPreview? link,
    $core.Iterable<$core.String>? hashtags,
    $core.Iterable<$core.String>? mentions,
  }) {
    final result = create();
    if (text != null) result.text = text;
    if (link != null) result.link = link;
    if (hashtags != null) result.hashtags.addAll(hashtags);
    if (mentions != null) result.mentions.addAll(mentions);
    return result;
  }

  LinkPost._();

  factory LinkPost.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory LinkPost.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LinkPost',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'text')
    ..aOM<LinkPreview>(2, _omitFieldNames ? '' : 'link',
        subBuilder: LinkPreview.create)
    ..pPS(3, _omitFieldNames ? '' : 'hashtags')
    ..pPS(4, _omitFieldNames ? '' : 'mentions')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LinkPost clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LinkPost copyWith(void Function(LinkPost) updates) =>
      super.copyWith((message) => updates(message as LinkPost)) as LinkPost;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static LinkPost create() => LinkPost._();
  @$core.override
  LinkPost createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static LinkPost getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<LinkPost>(create);
  static LinkPost? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get text => $_getSZ(0);
  @$pb.TagNumber(1)
  set text($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasText() => $_has(0);
  @$pb.TagNumber(1)
  void clearText() => $_clearField(1);

  @$pb.TagNumber(2)
  LinkPreview get link => $_getN(1);
  @$pb.TagNumber(2)
  set link(LinkPreview value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasLink() => $_has(1);
  @$pb.TagNumber(2)
  void clearLink() => $_clearField(2);
  @$pb.TagNumber(2)
  LinkPreview ensureLink() => $_ensure(1);

  @$pb.TagNumber(3)
  $pb.PbList<$core.String> get hashtags => $_getList(2);

  @$pb.TagNumber(4)
  $pb.PbList<$core.String> get mentions => $_getList(3);
}

class PollPost extends $pb.GeneratedMessage {
  factory PollPost({
    $core.String? text,
    $1.Poll? poll,
    $core.Iterable<$core.String>? hashtags,
    $core.Iterable<$core.String>? mentions,
  }) {
    final result = create();
    if (text != null) result.text = text;
    if (poll != null) result.poll = poll;
    if (hashtags != null) result.hashtags.addAll(hashtags);
    if (mentions != null) result.mentions.addAll(mentions);
    return result;
  }

  PollPost._();

  factory PollPost.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PollPost.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PollPost',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'text')
    ..aOM<$1.Poll>(2, _omitFieldNames ? '' : 'poll', subBuilder: $1.Poll.create)
    ..pPS(3, _omitFieldNames ? '' : 'hashtags')
    ..pPS(4, _omitFieldNames ? '' : 'mentions')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PollPost clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PollPost copyWith(void Function(PollPost) updates) =>
      super.copyWith((message) => updates(message as PollPost)) as PollPost;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PollPost create() => PollPost._();
  @$core.override
  PollPost createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PollPost getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<PollPost>(create);
  static PollPost? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get text => $_getSZ(0);
  @$pb.TagNumber(1)
  set text($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasText() => $_has(0);
  @$pb.TagNumber(1)
  void clearText() => $_clearField(1);

  @$pb.TagNumber(2)
  $1.Poll get poll => $_getN(1);
  @$pb.TagNumber(2)
  set poll($1.Poll value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasPoll() => $_has(1);
  @$pb.TagNumber(2)
  void clearPoll() => $_clearField(2);
  @$pb.TagNumber(2)
  $1.Poll ensurePoll() => $_ensure(1);

  @$pb.TagNumber(3)
  $pb.PbList<$core.String> get hashtags => $_getList(2);

  @$pb.TagNumber(4)
  $pb.PbList<$core.String> get mentions => $_getList(3);
}

class RepostPost extends $pb.GeneratedMessage {
  factory RepostPost({
    $core.String? comment,
    $core.String? originalPostId,
    Post? originalPost,
  }) {
    final result = create();
    if (comment != null) result.comment = comment;
    if (originalPostId != null) result.originalPostId = originalPostId;
    if (originalPost != null) result.originalPost = originalPost;
    return result;
  }

  RepostPost._();

  factory RepostPost.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RepostPost.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RepostPost',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'comment')
    ..aOS(2, _omitFieldNames ? '' : 'originalPostId')
    ..aOM<Post>(3, _omitFieldNames ? '' : 'originalPost',
        subBuilder: Post.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RepostPost clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RepostPost copyWith(void Function(RepostPost) updates) =>
      super.copyWith((message) => updates(message as RepostPost)) as RepostPost;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RepostPost create() => RepostPost._();
  @$core.override
  RepostPost createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RepostPost getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RepostPost>(create);
  static RepostPost? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get comment => $_getSZ(0);
  @$pb.TagNumber(1)
  set comment($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasComment() => $_has(0);
  @$pb.TagNumber(1)
  void clearComment() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get originalPostId => $_getSZ(1);
  @$pb.TagNumber(2)
  set originalPostId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasOriginalPostId() => $_has(1);
  @$pb.TagNumber(2)
  void clearOriginalPostId() => $_clearField(2);

  @$pb.TagNumber(3)
  Post get originalPost => $_getN(2);
  @$pb.TagNumber(3)
  set originalPost(Post value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasOriginalPost() => $_has(2);
  @$pb.TagNumber(3)
  void clearOriginalPost() => $_clearField(3);
  @$pb.TagNumber(3)
  Post ensureOriginalPost() => $_ensure(2);
}

class LocationPost extends $pb.GeneratedMessage {
  factory LocationPost({
    $core.String? text,
    Location? location,
    $core.Iterable<ImageAttachment>? images,
    $core.Iterable<$core.String>? hashtags,
    $core.Iterable<$core.String>? mentions,
  }) {
    final result = create();
    if (text != null) result.text = text;
    if (location != null) result.location = location;
    if (images != null) result.images.addAll(images);
    if (hashtags != null) result.hashtags.addAll(hashtags);
    if (mentions != null) result.mentions.addAll(mentions);
    return result;
  }

  LocationPost._();

  factory LocationPost.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory LocationPost.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LocationPost',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'text')
    ..aOM<Location>(2, _omitFieldNames ? '' : 'location',
        subBuilder: Location.create)
    ..pPM<ImageAttachment>(3, _omitFieldNames ? '' : 'images',
        subBuilder: ImageAttachment.create)
    ..pPS(4, _omitFieldNames ? '' : 'hashtags')
    ..pPS(5, _omitFieldNames ? '' : 'mentions')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LocationPost clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LocationPost copyWith(void Function(LocationPost) updates) =>
      super.copyWith((message) => updates(message as LocationPost))
          as LocationPost;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static LocationPost create() => LocationPost._();
  @$core.override
  LocationPost createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static LocationPost getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<LocationPost>(create);
  static LocationPost? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get text => $_getSZ(0);
  @$pb.TagNumber(1)
  set text($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasText() => $_has(0);
  @$pb.TagNumber(1)
  void clearText() => $_clearField(1);

  @$pb.TagNumber(2)
  Location get location => $_getN(1);
  @$pb.TagNumber(2)
  set location(Location value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasLocation() => $_has(1);
  @$pb.TagNumber(2)
  void clearLocation() => $_clearField(2);
  @$pb.TagNumber(2)
  Location ensureLocation() => $_ensure(1);

  @$pb.TagNumber(3)
  $pb.PbList<ImageAttachment> get images => $_getList(2);

  @$pb.TagNumber(4)
  $pb.PbList<$core.String> get hashtags => $_getList(3);

  @$pb.TagNumber(5)
  $pb.PbList<$core.String> get mentions => $_getList(4);
}

class ImageAttachment extends $pb.GeneratedMessage {
  factory ImageAttachment({
    $core.String? id,
    $core.String? url,
    $core.String? thumbnailUrl,
    $fixnum.Int64? sizeBytes,
    $core.int? width,
    $core.int? height,
    $core.String? blurhash,
    $core.String? altText,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (url != null) result.url = url;
    if (thumbnailUrl != null) result.thumbnailUrl = thumbnailUrl;
    if (sizeBytes != null) result.sizeBytes = sizeBytes;
    if (width != null) result.width = width;
    if (height != null) result.height = height;
    if (blurhash != null) result.blurhash = blurhash;
    if (altText != null) result.altText = altText;
    return result;
  }

  ImageAttachment._();

  factory ImageAttachment.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ImageAttachment.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ImageAttachment',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'url')
    ..aOS(3, _omitFieldNames ? '' : 'thumbnailUrl')
    ..aInt64(4, _omitFieldNames ? '' : 'sizeBytes')
    ..aI(5, _omitFieldNames ? '' : 'width')
    ..aI(6, _omitFieldNames ? '' : 'height')
    ..aOS(7, _omitFieldNames ? '' : 'blurhash')
    ..aOS(8, _omitFieldNames ? '' : 'altText')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ImageAttachment clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ImageAttachment copyWith(void Function(ImageAttachment) updates) =>
      super.copyWith((message) => updates(message as ImageAttachment))
          as ImageAttachment;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ImageAttachment create() => ImageAttachment._();
  @$core.override
  ImageAttachment createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ImageAttachment getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ImageAttachment>(create);
  static ImageAttachment? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get url => $_getSZ(1);
  @$pb.TagNumber(2)
  set url($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUrl() => $_has(1);
  @$pb.TagNumber(2)
  void clearUrl() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get thumbnailUrl => $_getSZ(2);
  @$pb.TagNumber(3)
  set thumbnailUrl($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasThumbnailUrl() => $_has(2);
  @$pb.TagNumber(3)
  void clearThumbnailUrl() => $_clearField(3);

  @$pb.TagNumber(4)
  $fixnum.Int64 get sizeBytes => $_getI64(3);
  @$pb.TagNumber(4)
  set sizeBytes($fixnum.Int64 value) => $_setInt64(3, value);
  @$pb.TagNumber(4)
  $core.bool hasSizeBytes() => $_has(3);
  @$pb.TagNumber(4)
  void clearSizeBytes() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.int get width => $_getIZ(4);
  @$pb.TagNumber(5)
  set width($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasWidth() => $_has(4);
  @$pb.TagNumber(5)
  void clearWidth() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.int get height => $_getIZ(5);
  @$pb.TagNumber(6)
  set height($core.int value) => $_setSignedInt32(5, value);
  @$pb.TagNumber(6)
  $core.bool hasHeight() => $_has(5);
  @$pb.TagNumber(6)
  void clearHeight() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get blurhash => $_getSZ(6);
  @$pb.TagNumber(7)
  set blurhash($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasBlurhash() => $_has(6);
  @$pb.TagNumber(7)
  void clearBlurhash() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get altText => $_getSZ(7);
  @$pb.TagNumber(8)
  set altText($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasAltText() => $_has(7);
  @$pb.TagNumber(8)
  void clearAltText() => $_clearField(8);
}

class VideoAttachment extends $pb.GeneratedMessage {
  factory VideoAttachment({
    $core.String? id,
    $core.String? url,
    $core.String? thumbnailUrl,
    $fixnum.Int64? sizeBytes,
    $core.int? width,
    $core.int? height,
    $core.int? durationSeconds,
    $core.String? blurhash,
    VideoQuality? quality,
    $core.Iterable<VideoVariant>? variants,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (url != null) result.url = url;
    if (thumbnailUrl != null) result.thumbnailUrl = thumbnailUrl;
    if (sizeBytes != null) result.sizeBytes = sizeBytes;
    if (width != null) result.width = width;
    if (height != null) result.height = height;
    if (durationSeconds != null) result.durationSeconds = durationSeconds;
    if (blurhash != null) result.blurhash = blurhash;
    if (quality != null) result.quality = quality;
    if (variants != null) result.variants.addAll(variants);
    return result;
  }

  VideoAttachment._();

  factory VideoAttachment.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory VideoAttachment.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'VideoAttachment',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'url')
    ..aOS(3, _omitFieldNames ? '' : 'thumbnailUrl')
    ..aInt64(4, _omitFieldNames ? '' : 'sizeBytes')
    ..aI(5, _omitFieldNames ? '' : 'width')
    ..aI(6, _omitFieldNames ? '' : 'height')
    ..aI(7, _omitFieldNames ? '' : 'durationSeconds')
    ..aOS(8, _omitFieldNames ? '' : 'blurhash')
    ..aE<VideoQuality>(9, _omitFieldNames ? '' : 'quality',
        enumValues: VideoQuality.values)
    ..pPM<VideoVariant>(10, _omitFieldNames ? '' : 'variants',
        subBuilder: VideoVariant.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VideoAttachment clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VideoAttachment copyWith(void Function(VideoAttachment) updates) =>
      super.copyWith((message) => updates(message as VideoAttachment))
          as VideoAttachment;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static VideoAttachment create() => VideoAttachment._();
  @$core.override
  VideoAttachment createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static VideoAttachment getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<VideoAttachment>(create);
  static VideoAttachment? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get url => $_getSZ(1);
  @$pb.TagNumber(2)
  set url($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUrl() => $_has(1);
  @$pb.TagNumber(2)
  void clearUrl() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get thumbnailUrl => $_getSZ(2);
  @$pb.TagNumber(3)
  set thumbnailUrl($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasThumbnailUrl() => $_has(2);
  @$pb.TagNumber(3)
  void clearThumbnailUrl() => $_clearField(3);

  @$pb.TagNumber(4)
  $fixnum.Int64 get sizeBytes => $_getI64(3);
  @$pb.TagNumber(4)
  set sizeBytes($fixnum.Int64 value) => $_setInt64(3, value);
  @$pb.TagNumber(4)
  $core.bool hasSizeBytes() => $_has(3);
  @$pb.TagNumber(4)
  void clearSizeBytes() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.int get width => $_getIZ(4);
  @$pb.TagNumber(5)
  set width($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasWidth() => $_has(4);
  @$pb.TagNumber(5)
  void clearWidth() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.int get height => $_getIZ(5);
  @$pb.TagNumber(6)
  set height($core.int value) => $_setSignedInt32(5, value);
  @$pb.TagNumber(6)
  $core.bool hasHeight() => $_has(5);
  @$pb.TagNumber(6)
  void clearHeight() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.int get durationSeconds => $_getIZ(6);
  @$pb.TagNumber(7)
  set durationSeconds($core.int value) => $_setSignedInt32(6, value);
  @$pb.TagNumber(7)
  $core.bool hasDurationSeconds() => $_has(6);
  @$pb.TagNumber(7)
  void clearDurationSeconds() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get blurhash => $_getSZ(7);
  @$pb.TagNumber(8)
  set blurhash($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasBlurhash() => $_has(7);
  @$pb.TagNumber(8)
  void clearBlurhash() => $_clearField(8);

  @$pb.TagNumber(9)
  VideoQuality get quality => $_getN(8);
  @$pb.TagNumber(9)
  set quality(VideoQuality value) => $_setField(9, value);
  @$pb.TagNumber(9)
  $core.bool hasQuality() => $_has(8);
  @$pb.TagNumber(9)
  void clearQuality() => $_clearField(9);

  @$pb.TagNumber(10)
  $pb.PbList<VideoVariant> get variants => $_getList(9);
}

class VideoVariant extends $pb.GeneratedMessage {
  factory VideoVariant({
    $core.String? url,
    $core.int? bitrate,
    $core.String? codec,
    $core.int? width,
    $core.int? height,
  }) {
    final result = create();
    if (url != null) result.url = url;
    if (bitrate != null) result.bitrate = bitrate;
    if (codec != null) result.codec = codec;
    if (width != null) result.width = width;
    if (height != null) result.height = height;
    return result;
  }

  VideoVariant._();

  factory VideoVariant.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory VideoVariant.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'VideoVariant',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'url')
    ..aI(2, _omitFieldNames ? '' : 'bitrate')
    ..aOS(3, _omitFieldNames ? '' : 'codec')
    ..aI(4, _omitFieldNames ? '' : 'width')
    ..aI(5, _omitFieldNames ? '' : 'height')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VideoVariant clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VideoVariant copyWith(void Function(VideoVariant) updates) =>
      super.copyWith((message) => updates(message as VideoVariant))
          as VideoVariant;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static VideoVariant create() => VideoVariant._();
  @$core.override
  VideoVariant createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static VideoVariant getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<VideoVariant>(create);
  static VideoVariant? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get url => $_getSZ(0);
  @$pb.TagNumber(1)
  set url($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUrl() => $_has(0);
  @$pb.TagNumber(1)
  void clearUrl() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get bitrate => $_getIZ(1);
  @$pb.TagNumber(2)
  set bitrate($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasBitrate() => $_has(1);
  @$pb.TagNumber(2)
  void clearBitrate() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get codec => $_getSZ(2);
  @$pb.TagNumber(3)
  set codec($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCodec() => $_has(2);
  @$pb.TagNumber(3)
  void clearCodec() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get width => $_getIZ(3);
  @$pb.TagNumber(4)
  set width($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasWidth() => $_has(3);
  @$pb.TagNumber(4)
  void clearWidth() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.int get height => $_getIZ(4);
  @$pb.TagNumber(5)
  set height($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasHeight() => $_has(4);
  @$pb.TagNumber(5)
  void clearHeight() => $_clearField(5);
}

class LinkPreview extends $pb.GeneratedMessage {
  factory LinkPreview({
    $core.String? url,
    $core.String? title,
    $core.String? description,
    $core.String? imageUrl,
    $core.String? siteName,
    $core.String? faviconUrl,
  }) {
    final result = create();
    if (url != null) result.url = url;
    if (title != null) result.title = title;
    if (description != null) result.description = description;
    if (imageUrl != null) result.imageUrl = imageUrl;
    if (siteName != null) result.siteName = siteName;
    if (faviconUrl != null) result.faviconUrl = faviconUrl;
    return result;
  }

  LinkPreview._();

  factory LinkPreview.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory LinkPreview.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LinkPreview',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'url')
    ..aOS(2, _omitFieldNames ? '' : 'title')
    ..aOS(3, _omitFieldNames ? '' : 'description')
    ..aOS(4, _omitFieldNames ? '' : 'imageUrl')
    ..aOS(5, _omitFieldNames ? '' : 'siteName')
    ..aOS(6, _omitFieldNames ? '' : 'faviconUrl')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LinkPreview clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LinkPreview copyWith(void Function(LinkPreview) updates) =>
      super.copyWith((message) => updates(message as LinkPreview))
          as LinkPreview;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static LinkPreview create() => LinkPreview._();
  @$core.override
  LinkPreview createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static LinkPreview getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<LinkPreview>(create);
  static LinkPreview? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get url => $_getSZ(0);
  @$pb.TagNumber(1)
  set url($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUrl() => $_has(0);
  @$pb.TagNumber(1)
  void clearUrl() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get title => $_getSZ(1);
  @$pb.TagNumber(2)
  set title($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTitle() => $_has(1);
  @$pb.TagNumber(2)
  void clearTitle() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get description => $_getSZ(2);
  @$pb.TagNumber(3)
  set description($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDescription() => $_has(2);
  @$pb.TagNumber(3)
  void clearDescription() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get imageUrl => $_getSZ(3);
  @$pb.TagNumber(4)
  set imageUrl($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasImageUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearImageUrl() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get siteName => $_getSZ(4);
  @$pb.TagNumber(5)
  set siteName($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasSiteName() => $_has(4);
  @$pb.TagNumber(5)
  void clearSiteName() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get faviconUrl => $_getSZ(5);
  @$pb.TagNumber(6)
  set faviconUrl($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasFaviconUrl() => $_has(5);
  @$pb.TagNumber(6)
  void clearFaviconUrl() => $_clearField(6);
}

class Location extends $pb.GeneratedMessage {
  factory Location({
    $core.String? name,
    $core.double? latitude,
    $core.double? longitude,
    $core.String? address,
    $core.String? placeId,
  }) {
    final result = create();
    if (name != null) result.name = name;
    if (latitude != null) result.latitude = latitude;
    if (longitude != null) result.longitude = longitude;
    if (address != null) result.address = address;
    if (placeId != null) result.placeId = placeId;
    return result;
  }

  Location._();

  factory Location.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Location.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Location',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'name')
    ..aD(2, _omitFieldNames ? '' : 'latitude')
    ..aD(3, _omitFieldNames ? '' : 'longitude')
    ..aOS(4, _omitFieldNames ? '' : 'address')
    ..aOS(5, _omitFieldNames ? '' : 'placeId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Location clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Location copyWith(void Function(Location) updates) =>
      super.copyWith((message) => updates(message as Location)) as Location;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Location create() => Location._();
  @$core.override
  Location createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Location getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Location>(create);
  static Location? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get name => $_getSZ(0);
  @$pb.TagNumber(1)
  set name($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasName() => $_has(0);
  @$pb.TagNumber(1)
  void clearName() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.double get latitude => $_getN(1);
  @$pb.TagNumber(2)
  set latitude($core.double value) => $_setDouble(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLatitude() => $_has(1);
  @$pb.TagNumber(2)
  void clearLatitude() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.double get longitude => $_getN(2);
  @$pb.TagNumber(3)
  set longitude($core.double value) => $_setDouble(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLongitude() => $_has(2);
  @$pb.TagNumber(3)
  void clearLongitude() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get address => $_getSZ(3);
  @$pb.TagNumber(4)
  set address($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasAddress() => $_has(3);
  @$pb.TagNumber(4)
  void clearAddress() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get placeId => $_getSZ(4);
  @$pb.TagNumber(5)
  set placeId($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasPlaceId() => $_has(4);
  @$pb.TagNumber(5)
  void clearPlaceId() => $_clearField(5);
}

enum CreatePostRequest_Content {
  text,
  image,
  video,
  link,
  poll,
  repost,
  location,
  notSet
}

class CreatePostRequest extends $pb.GeneratedMessage {
  factory CreatePostRequest({
    PostType? type,
    PostVisibility? visibility,
    $core.String? replyToPostId,
    CreateTextPostRequest? text,
    CreateImagePostRequest? image,
    CreateVideoPostRequest? video,
    CreateLinkPostRequest? link,
    CreatePollPostRequest? poll,
    CreateRepostRequest? repost,
    CreateLocationPostRequest? location,
  }) {
    final result = create();
    if (type != null) result.type = type;
    if (visibility != null) result.visibility = visibility;
    if (replyToPostId != null) result.replyToPostId = replyToPostId;
    if (text != null) result.text = text;
    if (image != null) result.image = image;
    if (video != null) result.video = video;
    if (link != null) result.link = link;
    if (poll != null) result.poll = poll;
    if (repost != null) result.repost = repost;
    if (location != null) result.location = location;
    return result;
  }

  CreatePostRequest._();

  factory CreatePostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreatePostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static const $core.Map<$core.int, CreatePostRequest_Content>
      _CreatePostRequest_ContentByTag = {
    10: CreatePostRequest_Content.text,
    11: CreatePostRequest_Content.image,
    12: CreatePostRequest_Content.video,
    13: CreatePostRequest_Content.link,
    14: CreatePostRequest_Content.poll,
    15: CreatePostRequest_Content.repost,
    16: CreatePostRequest_Content.location,
    0: CreatePostRequest_Content.notSet
  };
  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreatePostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..oo(0, [10, 11, 12, 13, 14, 15, 16])
    ..aE<PostType>(1, _omitFieldNames ? '' : 'type',
        enumValues: PostType.values)
    ..aE<PostVisibility>(2, _omitFieldNames ? '' : 'visibility',
        enumValues: PostVisibility.values)
    ..aOS(3, _omitFieldNames ? '' : 'replyToPostId')
    ..aOM<CreateTextPostRequest>(10, _omitFieldNames ? '' : 'text',
        subBuilder: CreateTextPostRequest.create)
    ..aOM<CreateImagePostRequest>(11, _omitFieldNames ? '' : 'image',
        subBuilder: CreateImagePostRequest.create)
    ..aOM<CreateVideoPostRequest>(12, _omitFieldNames ? '' : 'video',
        subBuilder: CreateVideoPostRequest.create)
    ..aOM<CreateLinkPostRequest>(13, _omitFieldNames ? '' : 'link',
        subBuilder: CreateLinkPostRequest.create)
    ..aOM<CreatePollPostRequest>(14, _omitFieldNames ? '' : 'poll',
        subBuilder: CreatePollPostRequest.create)
    ..aOM<CreateRepostRequest>(15, _omitFieldNames ? '' : 'repost',
        subBuilder: CreateRepostRequest.create)
    ..aOM<CreateLocationPostRequest>(16, _omitFieldNames ? '' : 'location',
        subBuilder: CreateLocationPostRequest.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreatePostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreatePostRequest copyWith(void Function(CreatePostRequest) updates) =>
      super.copyWith((message) => updates(message as CreatePostRequest))
          as CreatePostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreatePostRequest create() => CreatePostRequest._();
  @$core.override
  CreatePostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreatePostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreatePostRequest>(create);
  static CreatePostRequest? _defaultInstance;

  @$pb.TagNumber(10)
  @$pb.TagNumber(11)
  @$pb.TagNumber(12)
  @$pb.TagNumber(13)
  @$pb.TagNumber(14)
  @$pb.TagNumber(15)
  @$pb.TagNumber(16)
  CreatePostRequest_Content whichContent() =>
      _CreatePostRequest_ContentByTag[$_whichOneof(0)]!;
  @$pb.TagNumber(10)
  @$pb.TagNumber(11)
  @$pb.TagNumber(12)
  @$pb.TagNumber(13)
  @$pb.TagNumber(14)
  @$pb.TagNumber(15)
  @$pb.TagNumber(16)
  void clearContent() => $_clearField($_whichOneof(0));

  @$pb.TagNumber(1)
  PostType get type => $_getN(0);
  @$pb.TagNumber(1)
  set type(PostType value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasType() => $_has(0);
  @$pb.TagNumber(1)
  void clearType() => $_clearField(1);

  @$pb.TagNumber(2)
  PostVisibility get visibility => $_getN(1);
  @$pb.TagNumber(2)
  set visibility(PostVisibility value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasVisibility() => $_has(1);
  @$pb.TagNumber(2)
  void clearVisibility() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get replyToPostId => $_getSZ(2);
  @$pb.TagNumber(3)
  set replyToPostId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasReplyToPostId() => $_has(2);
  @$pb.TagNumber(3)
  void clearReplyToPostId() => $_clearField(3);

  @$pb.TagNumber(10)
  CreateTextPostRequest get text => $_getN(3);
  @$pb.TagNumber(10)
  set text(CreateTextPostRequest value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasText() => $_has(3);
  @$pb.TagNumber(10)
  void clearText() => $_clearField(10);
  @$pb.TagNumber(10)
  CreateTextPostRequest ensureText() => $_ensure(3);

  @$pb.TagNumber(11)
  CreateImagePostRequest get image => $_getN(4);
  @$pb.TagNumber(11)
  set image(CreateImagePostRequest value) => $_setField(11, value);
  @$pb.TagNumber(11)
  $core.bool hasImage() => $_has(4);
  @$pb.TagNumber(11)
  void clearImage() => $_clearField(11);
  @$pb.TagNumber(11)
  CreateImagePostRequest ensureImage() => $_ensure(4);

  @$pb.TagNumber(12)
  CreateVideoPostRequest get video => $_getN(5);
  @$pb.TagNumber(12)
  set video(CreateVideoPostRequest value) => $_setField(12, value);
  @$pb.TagNumber(12)
  $core.bool hasVideo() => $_has(5);
  @$pb.TagNumber(12)
  void clearVideo() => $_clearField(12);
  @$pb.TagNumber(12)
  CreateVideoPostRequest ensureVideo() => $_ensure(5);

  @$pb.TagNumber(13)
  CreateLinkPostRequest get link => $_getN(6);
  @$pb.TagNumber(13)
  set link(CreateLinkPostRequest value) => $_setField(13, value);
  @$pb.TagNumber(13)
  $core.bool hasLink() => $_has(6);
  @$pb.TagNumber(13)
  void clearLink() => $_clearField(13);
  @$pb.TagNumber(13)
  CreateLinkPostRequest ensureLink() => $_ensure(6);

  @$pb.TagNumber(14)
  CreatePollPostRequest get poll => $_getN(7);
  @$pb.TagNumber(14)
  set poll(CreatePollPostRequest value) => $_setField(14, value);
  @$pb.TagNumber(14)
  $core.bool hasPoll() => $_has(7);
  @$pb.TagNumber(14)
  void clearPoll() => $_clearField(14);
  @$pb.TagNumber(14)
  CreatePollPostRequest ensurePoll() => $_ensure(7);

  @$pb.TagNumber(15)
  CreateRepostRequest get repost => $_getN(8);
  @$pb.TagNumber(15)
  set repost(CreateRepostRequest value) => $_setField(15, value);
  @$pb.TagNumber(15)
  $core.bool hasRepost() => $_has(8);
  @$pb.TagNumber(15)
  void clearRepost() => $_clearField(15);
  @$pb.TagNumber(15)
  CreateRepostRequest ensureRepost() => $_ensure(8);

  @$pb.TagNumber(16)
  CreateLocationPostRequest get location => $_getN(9);
  @$pb.TagNumber(16)
  set location(CreateLocationPostRequest value) => $_setField(16, value);
  @$pb.TagNumber(16)
  $core.bool hasLocation() => $_has(9);
  @$pb.TagNumber(16)
  void clearLocation() => $_clearField(16);
  @$pb.TagNumber(16)
  CreateLocationPostRequest ensureLocation() => $_ensure(9);
}

class CreateTextPostRequest extends $pb.GeneratedMessage {
  factory CreateTextPostRequest({
    $core.String? text,
  }) {
    final result = create();
    if (text != null) result.text = text;
    return result;
  }

  CreateTextPostRequest._();

  factory CreateTextPostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateTextPostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateTextPostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'text')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateTextPostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateTextPostRequest copyWith(
          void Function(CreateTextPostRequest) updates) =>
      super.copyWith((message) => updates(message as CreateTextPostRequest))
          as CreateTextPostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateTextPostRequest create() => CreateTextPostRequest._();
  @$core.override
  CreateTextPostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateTextPostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateTextPostRequest>(create);
  static CreateTextPostRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get text => $_getSZ(0);
  @$pb.TagNumber(1)
  set text($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasText() => $_has(0);
  @$pb.TagNumber(1)
  void clearText() => $_clearField(1);
}

class CreateImagePostRequest extends $pb.GeneratedMessage {
  factory CreateImagePostRequest({
    $core.String? text,
    $core.Iterable<$core.String>? imageIds,
  }) {
    final result = create();
    if (text != null) result.text = text;
    if (imageIds != null) result.imageIds.addAll(imageIds);
    return result;
  }

  CreateImagePostRequest._();

  factory CreateImagePostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateImagePostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateImagePostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'text')
    ..pPS(2, _omitFieldNames ? '' : 'imageIds')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateImagePostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateImagePostRequest copyWith(
          void Function(CreateImagePostRequest) updates) =>
      super.copyWith((message) => updates(message as CreateImagePostRequest))
          as CreateImagePostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateImagePostRequest create() => CreateImagePostRequest._();
  @$core.override
  CreateImagePostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateImagePostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateImagePostRequest>(create);
  static CreateImagePostRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get text => $_getSZ(0);
  @$pb.TagNumber(1)
  set text($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasText() => $_has(0);
  @$pb.TagNumber(1)
  void clearText() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get imageIds => $_getList(1);
}

class CreateVideoPostRequest extends $pb.GeneratedMessage {
  factory CreateVideoPostRequest({
    $core.String? text,
    $core.String? videoId,
  }) {
    final result = create();
    if (text != null) result.text = text;
    if (videoId != null) result.videoId = videoId;
    return result;
  }

  CreateVideoPostRequest._();

  factory CreateVideoPostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateVideoPostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateVideoPostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'text')
    ..aOS(2, _omitFieldNames ? '' : 'videoId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateVideoPostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateVideoPostRequest copyWith(
          void Function(CreateVideoPostRequest) updates) =>
      super.copyWith((message) => updates(message as CreateVideoPostRequest))
          as CreateVideoPostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateVideoPostRequest create() => CreateVideoPostRequest._();
  @$core.override
  CreateVideoPostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateVideoPostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateVideoPostRequest>(create);
  static CreateVideoPostRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get text => $_getSZ(0);
  @$pb.TagNumber(1)
  set text($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasText() => $_has(0);
  @$pb.TagNumber(1)
  void clearText() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get videoId => $_getSZ(1);
  @$pb.TagNumber(2)
  set videoId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasVideoId() => $_has(1);
  @$pb.TagNumber(2)
  void clearVideoId() => $_clearField(2);
}

class CreateLinkPostRequest extends $pb.GeneratedMessage {
  factory CreateLinkPostRequest({
    $core.String? text,
    $core.String? url,
  }) {
    final result = create();
    if (text != null) result.text = text;
    if (url != null) result.url = url;
    return result;
  }

  CreateLinkPostRequest._();

  factory CreateLinkPostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateLinkPostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateLinkPostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'text')
    ..aOS(2, _omitFieldNames ? '' : 'url')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateLinkPostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateLinkPostRequest copyWith(
          void Function(CreateLinkPostRequest) updates) =>
      super.copyWith((message) => updates(message as CreateLinkPostRequest))
          as CreateLinkPostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateLinkPostRequest create() => CreateLinkPostRequest._();
  @$core.override
  CreateLinkPostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateLinkPostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateLinkPostRequest>(create);
  static CreateLinkPostRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get text => $_getSZ(0);
  @$pb.TagNumber(1)
  set text($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasText() => $_has(0);
  @$pb.TagNumber(1)
  void clearText() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get url => $_getSZ(1);
  @$pb.TagNumber(2)
  set url($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUrl() => $_has(1);
  @$pb.TagNumber(2)
  void clearUrl() => $_clearField(2);
}

class CreatePollPostRequest extends $pb.GeneratedMessage {
  factory CreatePollPostRequest({
    $core.String? text,
    $core.String? question,
    $core.Iterable<$core.String>? options,
    $core.int? durationHours,
    $core.bool? multipleChoice,
  }) {
    final result = create();
    if (text != null) result.text = text;
    if (question != null) result.question = question;
    if (options != null) result.options.addAll(options);
    if (durationHours != null) result.durationHours = durationHours;
    if (multipleChoice != null) result.multipleChoice = multipleChoice;
    return result;
  }

  CreatePollPostRequest._();

  factory CreatePollPostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreatePollPostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreatePollPostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'text')
    ..aOS(2, _omitFieldNames ? '' : 'question')
    ..pPS(3, _omitFieldNames ? '' : 'options')
    ..aI(4, _omitFieldNames ? '' : 'durationHours')
    ..aOB(5, _omitFieldNames ? '' : 'multipleChoice')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreatePollPostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreatePollPostRequest copyWith(
          void Function(CreatePollPostRequest) updates) =>
      super.copyWith((message) => updates(message as CreatePollPostRequest))
          as CreatePollPostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreatePollPostRequest create() => CreatePollPostRequest._();
  @$core.override
  CreatePollPostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreatePollPostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreatePollPostRequest>(create);
  static CreatePollPostRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get text => $_getSZ(0);
  @$pb.TagNumber(1)
  set text($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasText() => $_has(0);
  @$pb.TagNumber(1)
  void clearText() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get question => $_getSZ(1);
  @$pb.TagNumber(2)
  set question($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasQuestion() => $_has(1);
  @$pb.TagNumber(2)
  void clearQuestion() => $_clearField(2);

  @$pb.TagNumber(3)
  $pb.PbList<$core.String> get options => $_getList(2);

  @$pb.TagNumber(4)
  $core.int get durationHours => $_getIZ(3);
  @$pb.TagNumber(4)
  set durationHours($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasDurationHours() => $_has(3);
  @$pb.TagNumber(4)
  void clearDurationHours() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.bool get multipleChoice => $_getBF(4);
  @$pb.TagNumber(5)
  set multipleChoice($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasMultipleChoice() => $_has(4);
  @$pb.TagNumber(5)
  void clearMultipleChoice() => $_clearField(5);
}

class CreateRepostRequest extends $pb.GeneratedMessage {
  factory CreateRepostRequest({
    $core.String? originalPostId,
    $core.String? comment,
  }) {
    final result = create();
    if (originalPostId != null) result.originalPostId = originalPostId;
    if (comment != null) result.comment = comment;
    return result;
  }

  CreateRepostRequest._();

  factory CreateRepostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateRepostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateRepostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'originalPostId')
    ..aOS(2, _omitFieldNames ? '' : 'comment')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateRepostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateRepostRequest copyWith(void Function(CreateRepostRequest) updates) =>
      super.copyWith((message) => updates(message as CreateRepostRequest))
          as CreateRepostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateRepostRequest create() => CreateRepostRequest._();
  @$core.override
  CreateRepostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateRepostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateRepostRequest>(create);
  static CreateRepostRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get originalPostId => $_getSZ(0);
  @$pb.TagNumber(1)
  set originalPostId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasOriginalPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearOriginalPostId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get comment => $_getSZ(1);
  @$pb.TagNumber(2)
  set comment($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasComment() => $_has(1);
  @$pb.TagNumber(2)
  void clearComment() => $_clearField(2);
}

class CreateLocationPostRequest extends $pb.GeneratedMessage {
  factory CreateLocationPostRequest({
    $core.String? text,
    $core.Iterable<$core.String>? imageIds,
    Location? location,
  }) {
    final result = create();
    if (text != null) result.text = text;
    if (imageIds != null) result.imageIds.addAll(imageIds);
    if (location != null) result.location = location;
    return result;
  }

  CreateLocationPostRequest._();

  factory CreateLocationPostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateLocationPostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateLocationPostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'text')
    ..pPS(2, _omitFieldNames ? '' : 'imageIds')
    ..aOM<Location>(3, _omitFieldNames ? '' : 'location',
        subBuilder: Location.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateLocationPostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateLocationPostRequest copyWith(
          void Function(CreateLocationPostRequest) updates) =>
      super.copyWith((message) => updates(message as CreateLocationPostRequest))
          as CreateLocationPostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateLocationPostRequest create() => CreateLocationPostRequest._();
  @$core.override
  CreateLocationPostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateLocationPostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateLocationPostRequest>(create);
  static CreateLocationPostRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get text => $_getSZ(0);
  @$pb.TagNumber(1)
  set text($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasText() => $_has(0);
  @$pb.TagNumber(1)
  void clearText() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get imageIds => $_getList(1);

  @$pb.TagNumber(3)
  Location get location => $_getN(2);
  @$pb.TagNumber(3)
  set location(Location value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasLocation() => $_has(2);
  @$pb.TagNumber(3)
  void clearLocation() => $_clearField(3);
  @$pb.TagNumber(3)
  Location ensureLocation() => $_ensure(2);
}

class CreatePostResponse extends $pb.GeneratedMessage {
  factory CreatePostResponse({
    Post? post,
  }) {
    final result = create();
    if (post != null) result.post = post;
    return result;
  }

  CreatePostResponse._();

  factory CreatePostResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreatePostResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreatePostResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOM<Post>(1, _omitFieldNames ? '' : 'post', subBuilder: Post.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreatePostResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreatePostResponse copyWith(void Function(CreatePostResponse) updates) =>
      super.copyWith((message) => updates(message as CreatePostResponse))
          as CreatePostResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreatePostResponse create() => CreatePostResponse._();
  @$core.override
  CreatePostResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreatePostResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreatePostResponse>(create);
  static CreatePostResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Post get post => $_getN(0);
  @$pb.TagNumber(1)
  set post(Post value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPost() => $_has(0);
  @$pb.TagNumber(1)
  void clearPost() => $_clearField(1);
  @$pb.TagNumber(1)
  Post ensurePost() => $_ensure(0);
}

class UpdatePostRequest extends $pb.GeneratedMessage {
  factory UpdatePostRequest({
    $core.String? postId,
    $core.String? content,
    PostVisibility? visibility,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    if (content != null) result.content = content;
    if (visibility != null) result.visibility = visibility;
    return result;
  }

  UpdatePostRequest._();

  factory UpdatePostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdatePostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdatePostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'postId')
    ..aOS(2, _omitFieldNames ? '' : 'content')
    ..aE<PostVisibility>(3, _omitFieldNames ? '' : 'visibility',
        enumValues: PostVisibility.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdatePostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdatePostRequest copyWith(void Function(UpdatePostRequest) updates) =>
      super.copyWith((message) => updates(message as UpdatePostRequest))
          as UpdatePostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdatePostRequest create() => UpdatePostRequest._();
  @$core.override
  UpdatePostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdatePostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdatePostRequest>(create);
  static UpdatePostRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get postId => $_getSZ(0);
  @$pb.TagNumber(1)
  set postId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get content => $_getSZ(1);
  @$pb.TagNumber(2)
  set content($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasContent() => $_has(1);
  @$pb.TagNumber(2)
  void clearContent() => $_clearField(2);

  @$pb.TagNumber(3)
  PostVisibility get visibility => $_getN(2);
  @$pb.TagNumber(3)
  set visibility(PostVisibility value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasVisibility() => $_has(2);
  @$pb.TagNumber(3)
  void clearVisibility() => $_clearField(3);
}

class UpdatePostResponse extends $pb.GeneratedMessage {
  factory UpdatePostResponse({
    Post? post,
  }) {
    final result = create();
    if (post != null) result.post = post;
    return result;
  }

  UpdatePostResponse._();

  factory UpdatePostResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdatePostResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdatePostResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOM<Post>(1, _omitFieldNames ? '' : 'post', subBuilder: Post.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdatePostResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdatePostResponse copyWith(void Function(UpdatePostResponse) updates) =>
      super.copyWith((message) => updates(message as UpdatePostResponse))
          as UpdatePostResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdatePostResponse create() => UpdatePostResponse._();
  @$core.override
  UpdatePostResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdatePostResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdatePostResponse>(create);
  static UpdatePostResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Post get post => $_getN(0);
  @$pb.TagNumber(1)
  set post(Post value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPost() => $_has(0);
  @$pb.TagNumber(1)
  void clearPost() => $_clearField(1);
  @$pb.TagNumber(1)
  Post ensurePost() => $_ensure(0);
}

class DeletePostRequest extends $pb.GeneratedMessage {
  factory DeletePostRequest({
    $core.String? postId,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    return result;
  }

  DeletePostRequest._();

  factory DeletePostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory DeletePostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeletePostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'postId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeletePostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeletePostRequest copyWith(void Function(DeletePostRequest) updates) =>
      super.copyWith((message) => updates(message as DeletePostRequest))
          as DeletePostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static DeletePostRequest create() => DeletePostRequest._();
  @$core.override
  DeletePostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static DeletePostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeletePostRequest>(create);
  static DeletePostRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get postId => $_getSZ(0);
  @$pb.TagNumber(1)
  set postId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);
}

class DeletePostResponse extends $pb.GeneratedMessage {
  factory DeletePostResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  DeletePostResponse._();

  factory DeletePostResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory DeletePostResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeletePostResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeletePostResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeletePostResponse copyWith(void Function(DeletePostResponse) updates) =>
      super.copyWith((message) => updates(message as DeletePostResponse))
          as DeletePostResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static DeletePostResponse create() => DeletePostResponse._();
  @$core.override
  DeletePostResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static DeletePostResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeletePostResponse>(create);
  static DeletePostResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

class GetPostRequest extends $pb.GeneratedMessage {
  factory GetPostRequest({
    $core.String? postId,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    return result;
  }

  GetPostRequest._();

  factory GetPostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetPostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'postId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPostRequest copyWith(void Function(GetPostRequest) updates) =>
      super.copyWith((message) => updates(message as GetPostRequest))
          as GetPostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetPostRequest create() => GetPostRequest._();
  @$core.override
  GetPostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetPostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPostRequest>(create);
  static GetPostRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get postId => $_getSZ(0);
  @$pb.TagNumber(1)
  set postId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);
}

class GetPostResponse extends $pb.GeneratedMessage {
  factory GetPostResponse({
    Post? post,
  }) {
    final result = create();
    if (post != null) result.post = post;
    return result;
  }

  GetPostResponse._();

  factory GetPostResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetPostResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPostResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOM<Post>(1, _omitFieldNames ? '' : 'post', subBuilder: Post.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPostResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPostResponse copyWith(void Function(GetPostResponse) updates) =>
      super.copyWith((message) => updates(message as GetPostResponse))
          as GetPostResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetPostResponse create() => GetPostResponse._();
  @$core.override
  GetPostResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetPostResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPostResponse>(create);
  static GetPostResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Post get post => $_getN(0);
  @$pb.TagNumber(1)
  set post(Post value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPost() => $_has(0);
  @$pb.TagNumber(1)
  void clearPost() => $_clearField(1);
  @$pb.TagNumber(1)
  Post ensurePost() => $_ensure(0);
}

class ListPostsRequest extends $pb.GeneratedMessage {
  factory ListPostsRequest({
    $core.String? cursor,
    $core.int? limit,
    PostFilter? filter,
  }) {
    final result = create();
    if (cursor != null) result.cursor = cursor;
    if (limit != null) result.limit = limit;
    if (filter != null) result.filter = filter;
    return result;
  }

  ListPostsRequest._();

  factory ListPostsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListPostsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPostsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'cursor')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOM<PostFilter>(3, _omitFieldNames ? '' : 'filter',
        subBuilder: PostFilter.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPostsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPostsRequest copyWith(void Function(ListPostsRequest) updates) =>
      super.copyWith((message) => updates(message as ListPostsRequest))
          as ListPostsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListPostsRequest create() => ListPostsRequest._();
  @$core.override
  ListPostsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListPostsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPostsRequest>(create);
  static ListPostsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get cursor => $_getSZ(0);
  @$pb.TagNumber(1)
  set cursor($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasCursor() => $_has(0);
  @$pb.TagNumber(1)
  void clearCursor() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  @$pb.TagNumber(3)
  PostFilter get filter => $_getN(2);
  @$pb.TagNumber(3)
  set filter(PostFilter value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasFilter() => $_has(2);
  @$pb.TagNumber(3)
  void clearFilter() => $_clearField(3);
  @$pb.TagNumber(3)
  PostFilter ensureFilter() => $_ensure(2);
}

class ListPostsResponse extends $pb.GeneratedMessage {
  factory ListPostsResponse({
    $core.Iterable<Post>? posts,
    $core.String? nextCursor,
    $core.bool? hasMore,
  }) {
    final result = create();
    if (posts != null) result.posts.addAll(posts);
    if (nextCursor != null) result.nextCursor = nextCursor;
    if (hasMore != null) result.hasMore = hasMore;
    return result;
  }

  ListPostsResponse._();

  factory ListPostsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListPostsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPostsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..pPM<Post>(1, _omitFieldNames ? '' : 'posts', subBuilder: Post.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..aOB(3, _omitFieldNames ? '' : 'hasMore')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPostsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPostsResponse copyWith(void Function(ListPostsResponse) updates) =>
      super.copyWith((message) => updates(message as ListPostsResponse))
          as ListPostsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListPostsResponse create() => ListPostsResponse._();
  @$core.override
  ListPostsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListPostsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPostsResponse>(create);
  static ListPostsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Post> get posts => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextCursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextCursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextCursor() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.bool get hasMore => $_getBF(2);
  @$pb.TagNumber(3)
  set hasMore($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasHasMore() => $_has(2);
  @$pb.TagNumber(3)
  void clearHasMore() => $_clearField(3);
}

class PostFilter extends $pb.GeneratedMessage {
  factory PostFilter({
    $core.String? authorId,
    $core.Iterable<PostVisibility>? visibility,
    $core.bool? excludeReplies,
    $core.bool? excludeReposts,
  }) {
    final result = create();
    if (authorId != null) result.authorId = authorId;
    if (visibility != null) result.visibility.addAll(visibility);
    if (excludeReplies != null) result.excludeReplies = excludeReplies;
    if (excludeReposts != null) result.excludeReposts = excludeReposts;
    return result;
  }

  PostFilter._();

  factory PostFilter.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostFilter.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostFilter',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'authorId')
    ..pc<PostVisibility>(
        2, _omitFieldNames ? '' : 'visibility', $pb.PbFieldType.KE,
        valueOf: PostVisibility.valueOf,
        enumValues: PostVisibility.values,
        defaultEnumValue: PostVisibility.PUBLIC)
    ..aOB(3, _omitFieldNames ? '' : 'excludeReplies')
    ..aOB(4, _omitFieldNames ? '' : 'excludeReposts')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostFilter clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostFilter copyWith(void Function(PostFilter) updates) =>
      super.copyWith((message) => updates(message as PostFilter)) as PostFilter;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostFilter create() => PostFilter._();
  @$core.override
  PostFilter createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostFilter getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostFilter>(create);
  static PostFilter? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get authorId => $_getSZ(0);
  @$pb.TagNumber(1)
  set authorId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAuthorId() => $_has(0);
  @$pb.TagNumber(1)
  void clearAuthorId() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<PostVisibility> get visibility => $_getList(1);

  @$pb.TagNumber(3)
  $core.bool get excludeReplies => $_getBF(2);
  @$pb.TagNumber(3)
  set excludeReplies($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasExcludeReplies() => $_has(2);
  @$pb.TagNumber(3)
  void clearExcludeReplies() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.bool get excludeReposts => $_getBF(3);
  @$pb.TagNumber(4)
  set excludeReposts($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasExcludeReposts() => $_has(3);
  @$pb.TagNumber(4)
  void clearExcludeReposts() => $_clearField(4);
}

class GetTimelineRequest extends $pb.GeneratedMessage {
  factory GetTimelineRequest({
    TimelineType? type,
    $core.String? cursor,
    $core.int? limit,
    $core.String? userId,
  }) {
    final result = create();
    if (type != null) result.type = type;
    if (cursor != null) result.cursor = cursor;
    if (limit != null) result.limit = limit;
    if (userId != null) result.userId = userId;
    return result;
  }

  GetTimelineRequest._();

  factory GetTimelineRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetTimelineRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTimelineRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aE<TimelineType>(1, _omitFieldNames ? '' : 'type',
        enumValues: TimelineType.values)
    ..aOS(2, _omitFieldNames ? '' : 'cursor')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..aOS(4, _omitFieldNames ? '' : 'userId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTimelineRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTimelineRequest copyWith(void Function(GetTimelineRequest) updates) =>
      super.copyWith((message) => updates(message as GetTimelineRequest))
          as GetTimelineRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetTimelineRequest create() => GetTimelineRequest._();
  @$core.override
  GetTimelineRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetTimelineRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetTimelineRequest>(create);
  static GetTimelineRequest? _defaultInstance;

  @$pb.TagNumber(1)
  TimelineType get type => $_getN(0);
  @$pb.TagNumber(1)
  set type(TimelineType value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasType() => $_has(0);
  @$pb.TagNumber(1)
  void clearType() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get cursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set cursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearCursor() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get userId => $_getSZ(3);
  @$pb.TagNumber(4)
  set userId($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasUserId() => $_has(3);
  @$pb.TagNumber(4)
  void clearUserId() => $_clearField(4);
}

class GetTimelineResponse extends $pb.GeneratedMessage {
  factory GetTimelineResponse({
    $core.Iterable<Post>? posts,
    $core.String? nextCursor,
    $core.bool? hasMore,
  }) {
    final result = create();
    if (posts != null) result.posts.addAll(posts);
    if (nextCursor != null) result.nextCursor = nextCursor;
    if (hasMore != null) result.hasMore = hasMore;
    return result;
  }

  GetTimelineResponse._();

  factory GetTimelineResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetTimelineResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTimelineResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..pPM<Post>(1, _omitFieldNames ? '' : 'posts', subBuilder: Post.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..aOB(3, _omitFieldNames ? '' : 'hasMore')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTimelineResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTimelineResponse copyWith(void Function(GetTimelineResponse) updates) =>
      super.copyWith((message) => updates(message as GetTimelineResponse))
          as GetTimelineResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetTimelineResponse create() => GetTimelineResponse._();
  @$core.override
  GetTimelineResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetTimelineResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetTimelineResponse>(create);
  static GetTimelineResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Post> get posts => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextCursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextCursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextCursor() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.bool get hasMore => $_getBF(2);
  @$pb.TagNumber(3)
  set hasMore($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasHasMore() => $_has(2);
  @$pb.TagNumber(3)
  void clearHasMore() => $_clearField(3);
}

class LikePostRequest extends $pb.GeneratedMessage {
  factory LikePostRequest({
    $core.String? postId,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    return result;
  }

  LikePostRequest._();

  factory LikePostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory LikePostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LikePostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'postId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LikePostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LikePostRequest copyWith(void Function(LikePostRequest) updates) =>
      super.copyWith((message) => updates(message as LikePostRequest))
          as LikePostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static LikePostRequest create() => LikePostRequest._();
  @$core.override
  LikePostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static LikePostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<LikePostRequest>(create);
  static LikePostRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get postId => $_getSZ(0);
  @$pb.TagNumber(1)
  set postId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);
}

class LikePostResponse extends $pb.GeneratedMessage {
  factory LikePostResponse({
    $core.bool? success,
    $fixnum.Int64? newLikesCount,
  }) {
    final result = create();
    if (success != null) result.success = success;
    if (newLikesCount != null) result.newLikesCount = newLikesCount;
    return result;
  }

  LikePostResponse._();

  factory LikePostResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory LikePostResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LikePostResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..aInt64(2, _omitFieldNames ? '' : 'newLikesCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LikePostResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LikePostResponse copyWith(void Function(LikePostResponse) updates) =>
      super.copyWith((message) => updates(message as LikePostResponse))
          as LikePostResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static LikePostResponse create() => LikePostResponse._();
  @$core.override
  LikePostResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static LikePostResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<LikePostResponse>(create);
  static LikePostResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get newLikesCount => $_getI64(1);
  @$pb.TagNumber(2)
  set newLikesCount($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNewLikesCount() => $_has(1);
  @$pb.TagNumber(2)
  void clearNewLikesCount() => $_clearField(2);
}

class UnlikePostRequest extends $pb.GeneratedMessage {
  factory UnlikePostRequest({
    $core.String? postId,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    return result;
  }

  UnlikePostRequest._();

  factory UnlikePostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UnlikePostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnlikePostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'postId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnlikePostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnlikePostRequest copyWith(void Function(UnlikePostRequest) updates) =>
      super.copyWith((message) => updates(message as UnlikePostRequest))
          as UnlikePostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UnlikePostRequest create() => UnlikePostRequest._();
  @$core.override
  UnlikePostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UnlikePostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UnlikePostRequest>(create);
  static UnlikePostRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get postId => $_getSZ(0);
  @$pb.TagNumber(1)
  set postId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);
}

class UnlikePostResponse extends $pb.GeneratedMessage {
  factory UnlikePostResponse({
    $core.bool? success,
    $fixnum.Int64? newLikesCount,
  }) {
    final result = create();
    if (success != null) result.success = success;
    if (newLikesCount != null) result.newLikesCount = newLikesCount;
    return result;
  }

  UnlikePostResponse._();

  factory UnlikePostResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UnlikePostResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnlikePostResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..aInt64(2, _omitFieldNames ? '' : 'newLikesCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnlikePostResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnlikePostResponse copyWith(void Function(UnlikePostResponse) updates) =>
      super.copyWith((message) => updates(message as UnlikePostResponse))
          as UnlikePostResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UnlikePostResponse create() => UnlikePostResponse._();
  @$core.override
  UnlikePostResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UnlikePostResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UnlikePostResponse>(create);
  static UnlikePostResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get newLikesCount => $_getI64(1);
  @$pb.TagNumber(2)
  set newLikesCount($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNewLikesCount() => $_has(1);
  @$pb.TagNumber(2)
  void clearNewLikesCount() => $_clearField(2);
}

class RepostRequest extends $pb.GeneratedMessage {
  factory RepostRequest({
    $core.String? postId,
    $core.String? comment,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    if (comment != null) result.comment = comment;
    return result;
  }

  RepostRequest._();

  factory RepostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RepostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RepostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'postId')
    ..aOS(2, _omitFieldNames ? '' : 'comment')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RepostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RepostRequest copyWith(void Function(RepostRequest) updates) =>
      super.copyWith((message) => updates(message as RepostRequest))
          as RepostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RepostRequest create() => RepostRequest._();
  @$core.override
  RepostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RepostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RepostRequest>(create);
  static RepostRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get postId => $_getSZ(0);
  @$pb.TagNumber(1)
  set postId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get comment => $_getSZ(1);
  @$pb.TagNumber(2)
  set comment($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasComment() => $_has(1);
  @$pb.TagNumber(2)
  void clearComment() => $_clearField(2);
}

class RepostResponse extends $pb.GeneratedMessage {
  factory RepostResponse({
    Post? repost,
  }) {
    final result = create();
    if (repost != null) result.repost = repost;
    return result;
  }

  RepostResponse._();

  factory RepostResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RepostResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RepostResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOM<Post>(1, _omitFieldNames ? '' : 'repost', subBuilder: Post.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RepostResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RepostResponse copyWith(void Function(RepostResponse) updates) =>
      super.copyWith((message) => updates(message as RepostResponse))
          as RepostResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RepostResponse create() => RepostResponse._();
  @$core.override
  RepostResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RepostResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RepostResponse>(create);
  static RepostResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Post get repost => $_getN(0);
  @$pb.TagNumber(1)
  set repost(Post value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasRepost() => $_has(0);
  @$pb.TagNumber(1)
  void clearRepost() => $_clearField(1);
  @$pb.TagNumber(1)
  Post ensureRepost() => $_ensure(0);
}

class GetPostLikersRequest extends $pb.GeneratedMessage {
  factory GetPostLikersRequest({
    $core.String? postId,
    $core.String? cursor,
    $core.int? limit,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    if (cursor != null) result.cursor = cursor;
    if (limit != null) result.limit = limit;
    return result;
  }

  GetPostLikersRequest._();

  factory GetPostLikersRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetPostLikersRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPostLikersRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'postId')
    ..aOS(2, _omitFieldNames ? '' : 'cursor')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPostLikersRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPostLikersRequest copyWith(void Function(GetPostLikersRequest) updates) =>
      super.copyWith((message) => updates(message as GetPostLikersRequest))
          as GetPostLikersRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetPostLikersRequest create() => GetPostLikersRequest._();
  @$core.override
  GetPostLikersRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetPostLikersRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPostLikersRequest>(create);
  static GetPostLikersRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get postId => $_getSZ(0);
  @$pb.TagNumber(1)
  set postId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get cursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set cursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearCursor() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);
}

class GetPostLikersResponse extends $pb.GeneratedMessage {
  factory GetPostLikersResponse({
    $core.Iterable<PostAuthor>? users,
    $core.String? nextCursor,
    $core.bool? hasMore,
  }) {
    final result = create();
    if (users != null) result.users.addAll(users);
    if (nextCursor != null) result.nextCursor = nextCursor;
    if (hasMore != null) result.hasMore = hasMore;
    return result;
  }

  GetPostLikersResponse._();

  factory GetPostLikersResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetPostLikersResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPostLikersResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..pPM<PostAuthor>(1, _omitFieldNames ? '' : 'users',
        subBuilder: PostAuthor.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..aOB(3, _omitFieldNames ? '' : 'hasMore')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPostLikersResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPostLikersResponse copyWith(
          void Function(GetPostLikersResponse) updates) =>
      super.copyWith((message) => updates(message as GetPostLikersResponse))
          as GetPostLikersResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetPostLikersResponse create() => GetPostLikersResponse._();
  @$core.override
  GetPostLikersResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetPostLikersResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPostLikersResponse>(create);
  static GetPostLikersResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<PostAuthor> get users => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextCursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextCursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextCursor() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.bool get hasMore => $_getBF(2);
  @$pb.TagNumber(3)
  set hasMore($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasHasMore() => $_has(2);
  @$pb.TagNumber(3)
  void clearHasMore() => $_clearField(3);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
