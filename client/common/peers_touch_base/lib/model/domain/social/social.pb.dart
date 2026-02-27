// This is a generated file - do not edit.
//
// Generated from domain/social/social.proto.

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

/// Timeline
class GetTimelineRequest extends $pb.GeneratedMessage {
  factory GetTimelineRequest({
    $core.String? userDid,
    $fixnum.Int64? beforeTs,
    $core.int? limit,
  }) {
    final result = create();
    if (userDid != null) result.userDid = userDid;
    if (beforeTs != null) result.beforeTs = beforeTs;
    if (limit != null) result.limit = limit;
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
    ..aOS(1, _omitFieldNames ? '' : 'userDid')
    ..aInt64(2, _omitFieldNames ? '' : 'beforeTs')
    ..aI(3, _omitFieldNames ? '' : 'limit')
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
  $core.String get userDid => $_getSZ(0);
  @$pb.TagNumber(1)
  set userDid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUserDid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUserDid() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get beforeTs => $_getI64(1);
  @$pb.TagNumber(2)
  set beforeTs($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasBeforeTs() => $_has(1);
  @$pb.TagNumber(2)
  void clearBeforeTs() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);
}

class Post extends $pb.GeneratedMessage {
  factory Post({
    $fixnum.Int64? id,
    $core.String? authorDid,
    $core.String? content,
    $core.Iterable<$core.String>? mediaUrls,
    $fixnum.Int64? likeCount,
    $fixnum.Int64? repostCount,
    $fixnum.Int64? commentCount,
    $core.bool? likedByMe,
    $core.bool? repostedByMe,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (authorDid != null) result.authorDid = authorDid;
    if (content != null) result.content = content;
    if (mediaUrls != null) result.mediaUrls.addAll(mediaUrls);
    if (likeCount != null) result.likeCount = likeCount;
    if (repostCount != null) result.repostCount = repostCount;
    if (commentCount != null) result.commentCount = commentCount;
    if (likedByMe != null) result.likedByMe = likedByMe;
    if (repostedByMe != null) result.repostedByMe = repostedByMe;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  Post._();

  factory Post.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Post.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Post',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'id', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..aOS(2, _omitFieldNames ? '' : 'authorDid')
    ..aOS(3, _omitFieldNames ? '' : 'content')
    ..pPS(4, _omitFieldNames ? '' : 'mediaUrls')
    ..aInt64(5, _omitFieldNames ? '' : 'likeCount')
    ..aInt64(6, _omitFieldNames ? '' : 'repostCount')
    ..aInt64(7, _omitFieldNames ? '' : 'commentCount')
    ..aOB(8, _omitFieldNames ? '' : 'likedByMe')
    ..aOB(9, _omitFieldNames ? '' : 'repostedByMe')
    ..aOM<$0.Timestamp>(10, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(11, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
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

  @$pb.TagNumber(1)
  $fixnum.Int64 get id => $_getI64(0);
  @$pb.TagNumber(1)
  set id($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get authorDid => $_getSZ(1);
  @$pb.TagNumber(2)
  set authorDid($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasAuthorDid() => $_has(1);
  @$pb.TagNumber(2)
  void clearAuthorDid() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get content => $_getSZ(2);
  @$pb.TagNumber(3)
  set content($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasContent() => $_has(2);
  @$pb.TagNumber(3)
  void clearContent() => $_clearField(3);

  @$pb.TagNumber(4)
  $pb.PbList<$core.String> get mediaUrls => $_getList(3);

  @$pb.TagNumber(5)
  $fixnum.Int64 get likeCount => $_getI64(4);
  @$pb.TagNumber(5)
  set likeCount($fixnum.Int64 value) => $_setInt64(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLikeCount() => $_has(4);
  @$pb.TagNumber(5)
  void clearLikeCount() => $_clearField(5);

  @$pb.TagNumber(6)
  $fixnum.Int64 get repostCount => $_getI64(5);
  @$pb.TagNumber(6)
  set repostCount($fixnum.Int64 value) => $_setInt64(5, value);
  @$pb.TagNumber(6)
  $core.bool hasRepostCount() => $_has(5);
  @$pb.TagNumber(6)
  void clearRepostCount() => $_clearField(6);

  @$pb.TagNumber(7)
  $fixnum.Int64 get commentCount => $_getI64(6);
  @$pb.TagNumber(7)
  set commentCount($fixnum.Int64 value) => $_setInt64(6, value);
  @$pb.TagNumber(7)
  $core.bool hasCommentCount() => $_has(6);
  @$pb.TagNumber(7)
  void clearCommentCount() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.bool get likedByMe => $_getBF(7);
  @$pb.TagNumber(8)
  set likedByMe($core.bool value) => $_setBool(7, value);
  @$pb.TagNumber(8)
  $core.bool hasLikedByMe() => $_has(7);
  @$pb.TagNumber(8)
  void clearLikedByMe() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.bool get repostedByMe => $_getBF(8);
  @$pb.TagNumber(9)
  set repostedByMe($core.bool value) => $_setBool(8, value);
  @$pb.TagNumber(9)
  $core.bool hasRepostedByMe() => $_has(8);
  @$pb.TagNumber(9)
  void clearRepostedByMe() => $_clearField(9);

  @$pb.TagNumber(10)
  $0.Timestamp get createdAt => $_getN(9);
  @$pb.TagNumber(10)
  set createdAt($0.Timestamp value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasCreatedAt() => $_has(9);
  @$pb.TagNumber(10)
  void clearCreatedAt() => $_clearField(10);
  @$pb.TagNumber(10)
  $0.Timestamp ensureCreatedAt() => $_ensure(9);

  @$pb.TagNumber(11)
  $0.Timestamp get updatedAt => $_getN(10);
  @$pb.TagNumber(11)
  set updatedAt($0.Timestamp value) => $_setField(11, value);
  @$pb.TagNumber(11)
  $core.bool hasUpdatedAt() => $_has(10);
  @$pb.TagNumber(11)
  void clearUpdatedAt() => $_clearField(11);
  @$pb.TagNumber(11)
  $0.Timestamp ensureUpdatedAt() => $_ensure(10);
}

class GetTimelineResponse extends $pb.GeneratedMessage {
  factory GetTimelineResponse({
    $core.Iterable<Post>? posts,
    $core.bool? hasMore,
  }) {
    final result = create();
    if (posts != null) result.posts.addAll(posts);
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
    ..aOB(2, _omitFieldNames ? '' : 'hasMore')
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
  $core.bool get hasMore => $_getBF(1);
  @$pb.TagNumber(2)
  set hasMore($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasHasMore() => $_has(1);
  @$pb.TagNumber(2)
  void clearHasMore() => $_clearField(2);
}

/// Post operations
class CreatePostRequest extends $pb.GeneratedMessage {
  factory CreatePostRequest({
    $core.String? content,
    $core.Iterable<$core.String>? mediaUrls,
  }) {
    final result = create();
    if (content != null) result.content = content;
    if (mediaUrls != null) result.mediaUrls.addAll(mediaUrls);
    return result;
  }

  CreatePostRequest._();

  factory CreatePostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreatePostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreatePostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'content')
    ..pPS(2, _omitFieldNames ? '' : 'mediaUrls')
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

  @$pb.TagNumber(1)
  $core.String get content => $_getSZ(0);
  @$pb.TagNumber(1)
  set content($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasContent() => $_has(0);
  @$pb.TagNumber(1)
  void clearContent() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get mediaUrls => $_getList(1);
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

class GetPostRequest extends $pb.GeneratedMessage {
  factory GetPostRequest({
    $fixnum.Int64? postId,
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
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'postId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
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
  $fixnum.Int64 get postId => $_getI64(0);
  @$pb.TagNumber(1)
  set postId($fixnum.Int64 value) => $_setInt64(0, value);
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

class UpdatePostRequest extends $pb.GeneratedMessage {
  factory UpdatePostRequest({
    $fixnum.Int64? postId,
    $core.String? content,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    if (content != null) result.content = content;
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
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'postId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..aOS(2, _omitFieldNames ? '' : 'content')
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
  $fixnum.Int64 get postId => $_getI64(0);
  @$pb.TagNumber(1)
  set postId($fixnum.Int64 value) => $_setInt64(0, value);
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
    $fixnum.Int64? postId,
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
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'postId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
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
  $fixnum.Int64 get postId => $_getI64(0);
  @$pb.TagNumber(1)
  set postId($fixnum.Int64 value) => $_setInt64(0, value);
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

class GetUserPostsRequest extends $pb.GeneratedMessage {
  factory GetUserPostsRequest({
    $core.String? userDid,
    $fixnum.Int64? beforeTs,
    $core.int? limit,
  }) {
    final result = create();
    if (userDid != null) result.userDid = userDid;
    if (beforeTs != null) result.beforeTs = beforeTs;
    if (limit != null) result.limit = limit;
    return result;
  }

  GetUserPostsRequest._();

  factory GetUserPostsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserPostsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserPostsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'userDid')
    ..aInt64(2, _omitFieldNames ? '' : 'beforeTs')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserPostsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserPostsRequest copyWith(void Function(GetUserPostsRequest) updates) =>
      super.copyWith((message) => updates(message as GetUserPostsRequest))
          as GetUserPostsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserPostsRequest create() => GetUserPostsRequest._();
  @$core.override
  GetUserPostsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUserPostsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserPostsRequest>(create);
  static GetUserPostsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get userDid => $_getSZ(0);
  @$pb.TagNumber(1)
  set userDid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUserDid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUserDid() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get beforeTs => $_getI64(1);
  @$pb.TagNumber(2)
  set beforeTs($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasBeforeTs() => $_has(1);
  @$pb.TagNumber(2)
  void clearBeforeTs() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);
}

class GetUserPostsResponse extends $pb.GeneratedMessage {
  factory GetUserPostsResponse({
    $core.Iterable<Post>? posts,
    $core.bool? hasMore,
  }) {
    final result = create();
    if (posts != null) result.posts.addAll(posts);
    if (hasMore != null) result.hasMore = hasMore;
    return result;
  }

  GetUserPostsResponse._();

  factory GetUserPostsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetUserPostsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetUserPostsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..pPM<Post>(1, _omitFieldNames ? '' : 'posts', subBuilder: Post.create)
    ..aOB(2, _omitFieldNames ? '' : 'hasMore')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserPostsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetUserPostsResponse copyWith(void Function(GetUserPostsResponse) updates) =>
      super.copyWith((message) => updates(message as GetUserPostsResponse))
          as GetUserPostsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetUserPostsResponse create() => GetUserPostsResponse._();
  @$core.override
  GetUserPostsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetUserPostsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetUserPostsResponse>(create);
  static GetUserPostsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Post> get posts => $_getList(0);

  @$pb.TagNumber(2)
  $core.bool get hasMore => $_getBF(1);
  @$pb.TagNumber(2)
  set hasMore($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasHasMore() => $_has(1);
  @$pb.TagNumber(2)
  void clearHasMore() => $_clearField(2);
}

/// Like operations
class LikePostRequest extends $pb.GeneratedMessage {
  factory LikePostRequest({
    $fixnum.Int64? postId,
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
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'postId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
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
  $fixnum.Int64 get postId => $_getI64(0);
  @$pb.TagNumber(1)
  set postId($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);
}

class LikePostResponse extends $pb.GeneratedMessage {
  factory LikePostResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
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
}

class UnlikePostRequest extends $pb.GeneratedMessage {
  factory UnlikePostRequest({
    $fixnum.Int64? postId,
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
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'postId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
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
  $fixnum.Int64 get postId => $_getI64(0);
  @$pb.TagNumber(1)
  set postId($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);
}

class UnlikePostResponse extends $pb.GeneratedMessage {
  factory UnlikePostResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
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
}

class GetPostLikersRequest extends $pb.GeneratedMessage {
  factory GetPostLikersRequest({
    $fixnum.Int64? postId,
    $core.int? limit,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
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
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'postId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..aI(2, _omitFieldNames ? '' : 'limit')
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
  $fixnum.Int64 get postId => $_getI64(0);
  @$pb.TagNumber(1)
  set postId($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);
}

class UserInfo extends $pb.GeneratedMessage {
  factory UserInfo({
    $core.String? did,
    $core.String? handle,
    $core.String? displayName,
    $core.String? avatarUrl,
  }) {
    final result = create();
    if (did != null) result.did = did;
    if (handle != null) result.handle = handle;
    if (displayName != null) result.displayName = displayName;
    if (avatarUrl != null) result.avatarUrl = avatarUrl;
    return result;
  }

  UserInfo._();

  factory UserInfo.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UserInfo.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UserInfo',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'did')
    ..aOS(2, _omitFieldNames ? '' : 'handle')
    ..aOS(3, _omitFieldNames ? '' : 'displayName')
    ..aOS(4, _omitFieldNames ? '' : 'avatarUrl')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UserInfo clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UserInfo copyWith(void Function(UserInfo) updates) =>
      super.copyWith((message) => updates(message as UserInfo)) as UserInfo;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UserInfo create() => UserInfo._();
  @$core.override
  UserInfo createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UserInfo getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<UserInfo>(create);
  static UserInfo? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get did => $_getSZ(0);
  @$pb.TagNumber(1)
  set did($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasDid() => $_has(0);
  @$pb.TagNumber(1)
  void clearDid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get handle => $_getSZ(1);
  @$pb.TagNumber(2)
  set handle($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasHandle() => $_has(1);
  @$pb.TagNumber(2)
  void clearHandle() => $_clearField(2);

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
}

class GetPostLikersResponse extends $pb.GeneratedMessage {
  factory GetPostLikersResponse({
    $core.Iterable<UserInfo>? users,
  }) {
    final result = create();
    if (users != null) result.users.addAll(users);
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
    ..pPM<UserInfo>(1, _omitFieldNames ? '' : 'users',
        subBuilder: UserInfo.create)
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
  $pb.PbList<UserInfo> get users => $_getList(0);
}

/// Repost
class RepostPostRequest extends $pb.GeneratedMessage {
  factory RepostPostRequest({
    $fixnum.Int64? postId,
    $core.String? comment,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    if (comment != null) result.comment = comment;
    return result;
  }

  RepostPostRequest._();

  factory RepostPostRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RepostPostRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RepostPostRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'postId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..aOS(2, _omitFieldNames ? '' : 'comment')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RepostPostRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RepostPostRequest copyWith(void Function(RepostPostRequest) updates) =>
      super.copyWith((message) => updates(message as RepostPostRequest))
          as RepostPostRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RepostPostRequest create() => RepostPostRequest._();
  @$core.override
  RepostPostRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RepostPostRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RepostPostRequest>(create);
  static RepostPostRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $fixnum.Int64 get postId => $_getI64(0);
  @$pb.TagNumber(1)
  set postId($fixnum.Int64 value) => $_setInt64(0, value);
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

class RepostPostResponse extends $pb.GeneratedMessage {
  factory RepostPostResponse({
    Post? repost,
  }) {
    final result = create();
    if (repost != null) result.repost = repost;
    return result;
  }

  RepostPostResponse._();

  factory RepostPostResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RepostPostResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RepostPostResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOM<Post>(1, _omitFieldNames ? '' : 'repost', subBuilder: Post.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RepostPostResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RepostPostResponse copyWith(void Function(RepostPostResponse) updates) =>
      super.copyWith((message) => updates(message as RepostPostResponse))
          as RepostPostResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RepostPostResponse create() => RepostPostResponse._();
  @$core.override
  RepostPostResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RepostPostResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RepostPostResponse>(create);
  static RepostPostResponse? _defaultInstance;

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

/// Comments
class GetPostCommentsRequest extends $pb.GeneratedMessage {
  factory GetPostCommentsRequest({
    $fixnum.Int64? postId,
    $core.int? limit,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    if (limit != null) result.limit = limit;
    return result;
  }

  GetPostCommentsRequest._();

  factory GetPostCommentsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetPostCommentsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPostCommentsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'postId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPostCommentsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPostCommentsRequest copyWith(
          void Function(GetPostCommentsRequest) updates) =>
      super.copyWith((message) => updates(message as GetPostCommentsRequest))
          as GetPostCommentsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetPostCommentsRequest create() => GetPostCommentsRequest._();
  @$core.override
  GetPostCommentsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetPostCommentsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPostCommentsRequest>(create);
  static GetPostCommentsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $fixnum.Int64 get postId => $_getI64(0);
  @$pb.TagNumber(1)
  set postId($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);
}

class Comment extends $pb.GeneratedMessage {
  factory Comment({
    $fixnum.Int64? id,
    $fixnum.Int64? postId,
    $core.String? authorDid,
    $core.String? content,
    $fixnum.Int64? likeCount,
    $0.Timestamp? createdAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (postId != null) result.postId = postId;
    if (authorDid != null) result.authorDid = authorDid;
    if (content != null) result.content = content;
    if (likeCount != null) result.likeCount = likeCount;
    if (createdAt != null) result.createdAt = createdAt;
    return result;
  }

  Comment._();

  factory Comment.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Comment.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Comment',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'id', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..a<$fixnum.Int64>(2, _omitFieldNames ? '' : 'postId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..aOS(3, _omitFieldNames ? '' : 'authorDid')
    ..aOS(4, _omitFieldNames ? '' : 'content')
    ..aInt64(5, _omitFieldNames ? '' : 'likeCount')
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Comment clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Comment copyWith(void Function(Comment) updates) =>
      super.copyWith((message) => updates(message as Comment)) as Comment;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Comment create() => Comment._();
  @$core.override
  Comment createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Comment getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Comment>(create);
  static Comment? _defaultInstance;

  @$pb.TagNumber(1)
  $fixnum.Int64 get id => $_getI64(0);
  @$pb.TagNumber(1)
  set id($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get postId => $_getI64(1);
  @$pb.TagNumber(2)
  set postId($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPostId() => $_has(1);
  @$pb.TagNumber(2)
  void clearPostId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get authorDid => $_getSZ(2);
  @$pb.TagNumber(3)
  set authorDid($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasAuthorDid() => $_has(2);
  @$pb.TagNumber(3)
  void clearAuthorDid() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get content => $_getSZ(3);
  @$pb.TagNumber(4)
  set content($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasContent() => $_has(3);
  @$pb.TagNumber(4)
  void clearContent() => $_clearField(4);

  @$pb.TagNumber(5)
  $fixnum.Int64 get likeCount => $_getI64(4);
  @$pb.TagNumber(5)
  set likeCount($fixnum.Int64 value) => $_setInt64(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLikeCount() => $_has(4);
  @$pb.TagNumber(5)
  void clearLikeCount() => $_clearField(5);

  @$pb.TagNumber(6)
  $0.Timestamp get createdAt => $_getN(5);
  @$pb.TagNumber(6)
  set createdAt($0.Timestamp value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasCreatedAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearCreatedAt() => $_clearField(6);
  @$pb.TagNumber(6)
  $0.Timestamp ensureCreatedAt() => $_ensure(5);
}

class GetPostCommentsResponse extends $pb.GeneratedMessage {
  factory GetPostCommentsResponse({
    $core.Iterable<Comment>? comments,
    $core.bool? hasMore,
  }) {
    final result = create();
    if (comments != null) result.comments.addAll(comments);
    if (hasMore != null) result.hasMore = hasMore;
    return result;
  }

  GetPostCommentsResponse._();

  factory GetPostCommentsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetPostCommentsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPostCommentsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..pPM<Comment>(1, _omitFieldNames ? '' : 'comments',
        subBuilder: Comment.create)
    ..aOB(2, _omitFieldNames ? '' : 'hasMore')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPostCommentsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPostCommentsResponse copyWith(
          void Function(GetPostCommentsResponse) updates) =>
      super.copyWith((message) => updates(message as GetPostCommentsResponse))
          as GetPostCommentsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetPostCommentsResponse create() => GetPostCommentsResponse._();
  @$core.override
  GetPostCommentsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetPostCommentsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPostCommentsResponse>(create);
  static GetPostCommentsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Comment> get comments => $_getList(0);

  @$pb.TagNumber(2)
  $core.bool get hasMore => $_getBF(1);
  @$pb.TagNumber(2)
  set hasMore($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasHasMore() => $_has(1);
  @$pb.TagNumber(2)
  void clearHasMore() => $_clearField(2);
}

class CreateCommentRequest extends $pb.GeneratedMessage {
  factory CreateCommentRequest({
    $fixnum.Int64? postId,
    $core.String? content,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    if (content != null) result.content = content;
    return result;
  }

  CreateCommentRequest._();

  factory CreateCommentRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateCommentRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateCommentRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'postId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..aOS(2, _omitFieldNames ? '' : 'content')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateCommentRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateCommentRequest copyWith(void Function(CreateCommentRequest) updates) =>
      super.copyWith((message) => updates(message as CreateCommentRequest))
          as CreateCommentRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateCommentRequest create() => CreateCommentRequest._();
  @$core.override
  CreateCommentRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateCommentRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateCommentRequest>(create);
  static CreateCommentRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $fixnum.Int64 get postId => $_getI64(0);
  @$pb.TagNumber(1)
  set postId($fixnum.Int64 value) => $_setInt64(0, value);
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
}

class CreateCommentResponse extends $pb.GeneratedMessage {
  factory CreateCommentResponse({
    Comment? comment,
  }) {
    final result = create();
    if (comment != null) result.comment = comment;
    return result;
  }

  CreateCommentResponse._();

  factory CreateCommentResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateCommentResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateCommentResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOM<Comment>(1, _omitFieldNames ? '' : 'comment',
        subBuilder: Comment.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateCommentResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateCommentResponse copyWith(
          void Function(CreateCommentResponse) updates) =>
      super.copyWith((message) => updates(message as CreateCommentResponse))
          as CreateCommentResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateCommentResponse create() => CreateCommentResponse._();
  @$core.override
  CreateCommentResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateCommentResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateCommentResponse>(create);
  static CreateCommentResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Comment get comment => $_getN(0);
  @$pb.TagNumber(1)
  set comment(Comment value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasComment() => $_has(0);
  @$pb.TagNumber(1)
  void clearComment() => $_clearField(1);
  @$pb.TagNumber(1)
  Comment ensureComment() => $_ensure(0);
}

class DeleteCommentRequest extends $pb.GeneratedMessage {
  factory DeleteCommentRequest({
    $fixnum.Int64? commentId,
  }) {
    final result = create();
    if (commentId != null) result.commentId = commentId;
    return result;
  }

  DeleteCommentRequest._();

  factory DeleteCommentRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory DeleteCommentRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeleteCommentRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..a<$fixnum.Int64>(
        1, _omitFieldNames ? '' : 'commentId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteCommentRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteCommentRequest copyWith(void Function(DeleteCommentRequest) updates) =>
      super.copyWith((message) => updates(message as DeleteCommentRequest))
          as DeleteCommentRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static DeleteCommentRequest create() => DeleteCommentRequest._();
  @$core.override
  DeleteCommentRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static DeleteCommentRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeleteCommentRequest>(create);
  static DeleteCommentRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $fixnum.Int64 get commentId => $_getI64(0);
  @$pb.TagNumber(1)
  set commentId($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasCommentId() => $_has(0);
  @$pb.TagNumber(1)
  void clearCommentId() => $_clearField(1);
}

class DeleteCommentResponse extends $pb.GeneratedMessage {
  factory DeleteCommentResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  DeleteCommentResponse._();

  factory DeleteCommentResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory DeleteCommentResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeleteCommentResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteCommentResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteCommentResponse copyWith(
          void Function(DeleteCommentResponse) updates) =>
      super.copyWith((message) => updates(message as DeleteCommentResponse))
          as DeleteCommentResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static DeleteCommentResponse create() => DeleteCommentResponse._();
  @$core.override
  DeleteCommentResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static DeleteCommentResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeleteCommentResponse>(create);
  static DeleteCommentResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

/// Follow operations
class FollowRequest extends $pb.GeneratedMessage {
  factory FollowRequest({
    $core.String? targetDid,
  }) {
    final result = create();
    if (targetDid != null) result.targetDid = targetDid;
    return result;
  }

  FollowRequest._();

  factory FollowRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory FollowRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FollowRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'targetDid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowRequest copyWith(void Function(FollowRequest) updates) =>
      super.copyWith((message) => updates(message as FollowRequest))
          as FollowRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static FollowRequest create() => FollowRequest._();
  @$core.override
  FollowRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static FollowRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<FollowRequest>(create);
  static FollowRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get targetDid => $_getSZ(0);
  @$pb.TagNumber(1)
  set targetDid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTargetDid() => $_has(0);
  @$pb.TagNumber(1)
  void clearTargetDid() => $_clearField(1);
}

class FollowResponse extends $pb.GeneratedMessage {
  factory FollowResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  FollowResponse._();

  factory FollowResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory FollowResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FollowResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowResponse copyWith(void Function(FollowResponse) updates) =>
      super.copyWith((message) => updates(message as FollowResponse))
          as FollowResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static FollowResponse create() => FollowResponse._();
  @$core.override
  FollowResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static FollowResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<FollowResponse>(create);
  static FollowResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

class UnfollowRequest extends $pb.GeneratedMessage {
  factory UnfollowRequest({
    $core.String? targetDid,
  }) {
    final result = create();
    if (targetDid != null) result.targetDid = targetDid;
    return result;
  }

  UnfollowRequest._();

  factory UnfollowRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UnfollowRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnfollowRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'targetDid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnfollowRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnfollowRequest copyWith(void Function(UnfollowRequest) updates) =>
      super.copyWith((message) => updates(message as UnfollowRequest))
          as UnfollowRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UnfollowRequest create() => UnfollowRequest._();
  @$core.override
  UnfollowRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UnfollowRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UnfollowRequest>(create);
  static UnfollowRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get targetDid => $_getSZ(0);
  @$pb.TagNumber(1)
  set targetDid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTargetDid() => $_has(0);
  @$pb.TagNumber(1)
  void clearTargetDid() => $_clearField(1);
}

class UnfollowResponse extends $pb.GeneratedMessage {
  factory UnfollowResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  UnfollowResponse._();

  factory UnfollowResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UnfollowResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnfollowResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnfollowResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnfollowResponse copyWith(void Function(UnfollowResponse) updates) =>
      super.copyWith((message) => updates(message as UnfollowResponse))
          as UnfollowResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UnfollowResponse create() => UnfollowResponse._();
  @$core.override
  UnfollowResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UnfollowResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UnfollowResponse>(create);
  static UnfollowResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

class GetFollowersRequest extends $pb.GeneratedMessage {
  factory GetFollowersRequest({
    $core.String? userDid,
    $core.int? limit,
    $core.String? cursor,
  }) {
    final result = create();
    if (userDid != null) result.userDid = userDid;
    if (limit != null) result.limit = limit;
    if (cursor != null) result.cursor = cursor;
    return result;
  }

  GetFollowersRequest._();

  factory GetFollowersRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetFollowersRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetFollowersRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'userDid')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'cursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowersRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowersRequest copyWith(void Function(GetFollowersRequest) updates) =>
      super.copyWith((message) => updates(message as GetFollowersRequest))
          as GetFollowersRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetFollowersRequest create() => GetFollowersRequest._();
  @$core.override
  GetFollowersRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetFollowersRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetFollowersRequest>(create);
  static GetFollowersRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get userDid => $_getSZ(0);
  @$pb.TagNumber(1)
  set userDid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUserDid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUserDid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get cursor => $_getSZ(2);
  @$pb.TagNumber(3)
  set cursor($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCursor() => $_has(2);
  @$pb.TagNumber(3)
  void clearCursor() => $_clearField(3);
}

class GetFollowersResponse extends $pb.GeneratedMessage {
  factory GetFollowersResponse({
    $core.Iterable<UserInfo>? users,
    $core.String? nextCursor,
  }) {
    final result = create();
    if (users != null) result.users.addAll(users);
    if (nextCursor != null) result.nextCursor = nextCursor;
    return result;
  }

  GetFollowersResponse._();

  factory GetFollowersResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetFollowersResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetFollowersResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..pPM<UserInfo>(1, _omitFieldNames ? '' : 'users',
        subBuilder: UserInfo.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowersResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowersResponse copyWith(void Function(GetFollowersResponse) updates) =>
      super.copyWith((message) => updates(message as GetFollowersResponse))
          as GetFollowersResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetFollowersResponse create() => GetFollowersResponse._();
  @$core.override
  GetFollowersResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetFollowersResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetFollowersResponse>(create);
  static GetFollowersResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<UserInfo> get users => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextCursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextCursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextCursor() => $_clearField(2);
}

class GetFollowingRequest extends $pb.GeneratedMessage {
  factory GetFollowingRequest({
    $core.String? userDid,
    $core.int? limit,
    $core.String? cursor,
  }) {
    final result = create();
    if (userDid != null) result.userDid = userDid;
    if (limit != null) result.limit = limit;
    if (cursor != null) result.cursor = cursor;
    return result;
  }

  GetFollowingRequest._();

  factory GetFollowingRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetFollowingRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetFollowingRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'userDid')
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'cursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowingRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowingRequest copyWith(void Function(GetFollowingRequest) updates) =>
      super.copyWith((message) => updates(message as GetFollowingRequest))
          as GetFollowingRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetFollowingRequest create() => GetFollowingRequest._();
  @$core.override
  GetFollowingRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetFollowingRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetFollowingRequest>(create);
  static GetFollowingRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get userDid => $_getSZ(0);
  @$pb.TagNumber(1)
  set userDid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUserDid() => $_has(0);
  @$pb.TagNumber(1)
  void clearUserDid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get cursor => $_getSZ(2);
  @$pb.TagNumber(3)
  set cursor($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCursor() => $_has(2);
  @$pb.TagNumber(3)
  void clearCursor() => $_clearField(3);
}

class GetFollowingResponse extends $pb.GeneratedMessage {
  factory GetFollowingResponse({
    $core.Iterable<UserInfo>? users,
    $core.String? nextCursor,
  }) {
    final result = create();
    if (users != null) result.users.addAll(users);
    if (nextCursor != null) result.nextCursor = nextCursor;
    return result;
  }

  GetFollowingResponse._();

  factory GetFollowingResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetFollowingResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetFollowingResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..pPM<UserInfo>(1, _omitFieldNames ? '' : 'users',
        subBuilder: UserInfo.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowingResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetFollowingResponse copyWith(void Function(GetFollowingResponse) updates) =>
      super.copyWith((message) => updates(message as GetFollowingResponse))
          as GetFollowingResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetFollowingResponse create() => GetFollowingResponse._();
  @$core.override
  GetFollowingResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetFollowingResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetFollowingResponse>(create);
  static GetFollowingResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<UserInfo> get users => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get nextCursor => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextCursor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextCursor() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextCursor() => $_clearField(2);
}

/// Relationship
class GetRelationshipRequest extends $pb.GeneratedMessage {
  factory GetRelationshipRequest({
    $core.String? targetDid,
  }) {
    final result = create();
    if (targetDid != null) result.targetDid = targetDid;
    return result;
  }

  GetRelationshipRequest._();

  factory GetRelationshipRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetRelationshipRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetRelationshipRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'targetDid')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipRequest copyWith(
          void Function(GetRelationshipRequest) updates) =>
      super.copyWith((message) => updates(message as GetRelationshipRequest))
          as GetRelationshipRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetRelationshipRequest create() => GetRelationshipRequest._();
  @$core.override
  GetRelationshipRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetRelationshipRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetRelationshipRequest>(create);
  static GetRelationshipRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get targetDid => $_getSZ(0);
  @$pb.TagNumber(1)
  set targetDid($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTargetDid() => $_has(0);
  @$pb.TagNumber(1)
  void clearTargetDid() => $_clearField(1);
}

class Relationship extends $pb.GeneratedMessage {
  factory Relationship({
    $core.bool? following,
    $core.bool? followedBy,
    $core.bool? blocking,
    $core.bool? blockedBy,
    $core.bool? muting,
  }) {
    final result = create();
    if (following != null) result.following = following;
    if (followedBy != null) result.followedBy = followedBy;
    if (blocking != null) result.blocking = blocking;
    if (blockedBy != null) result.blockedBy = blockedBy;
    if (muting != null) result.muting = muting;
    return result;
  }

  Relationship._();

  factory Relationship.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Relationship.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Relationship',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'following')
    ..aOB(2, _omitFieldNames ? '' : 'followedBy')
    ..aOB(3, _omitFieldNames ? '' : 'blocking')
    ..aOB(4, _omitFieldNames ? '' : 'blockedBy')
    ..aOB(5, _omitFieldNames ? '' : 'muting')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Relationship clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Relationship copyWith(void Function(Relationship) updates) =>
      super.copyWith((message) => updates(message as Relationship))
          as Relationship;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Relationship create() => Relationship._();
  @$core.override
  Relationship createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Relationship getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Relationship>(create);
  static Relationship? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get following => $_getBF(0);
  @$pb.TagNumber(1)
  set following($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasFollowing() => $_has(0);
  @$pb.TagNumber(1)
  void clearFollowing() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.bool get followedBy => $_getBF(1);
  @$pb.TagNumber(2)
  set followedBy($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasFollowedBy() => $_has(1);
  @$pb.TagNumber(2)
  void clearFollowedBy() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.bool get blocking => $_getBF(2);
  @$pb.TagNumber(3)
  set blocking($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasBlocking() => $_has(2);
  @$pb.TagNumber(3)
  void clearBlocking() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.bool get blockedBy => $_getBF(3);
  @$pb.TagNumber(4)
  set blockedBy($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasBlockedBy() => $_has(3);
  @$pb.TagNumber(4)
  void clearBlockedBy() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.bool get muting => $_getBF(4);
  @$pb.TagNumber(5)
  set muting($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasMuting() => $_has(4);
  @$pb.TagNumber(5)
  void clearMuting() => $_clearField(5);
}

class GetRelationshipResponse extends $pb.GeneratedMessage {
  factory GetRelationshipResponse({
    Relationship? relationship,
  }) {
    final result = create();
    if (relationship != null) result.relationship = relationship;
    return result;
  }

  GetRelationshipResponse._();

  factory GetRelationshipResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetRelationshipResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetRelationshipResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOM<Relationship>(1, _omitFieldNames ? '' : 'relationship',
        subBuilder: Relationship.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipResponse copyWith(
          void Function(GetRelationshipResponse) updates) =>
      super.copyWith((message) => updates(message as GetRelationshipResponse))
          as GetRelationshipResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetRelationshipResponse create() => GetRelationshipResponse._();
  @$core.override
  GetRelationshipResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetRelationshipResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetRelationshipResponse>(create);
  static GetRelationshipResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Relationship get relationship => $_getN(0);
  @$pb.TagNumber(1)
  set relationship(Relationship value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasRelationship() => $_has(0);
  @$pb.TagNumber(1)
  void clearRelationship() => $_clearField(1);
  @$pb.TagNumber(1)
  Relationship ensureRelationship() => $_ensure(0);
}

class GetRelationshipsRequest extends $pb.GeneratedMessage {
  factory GetRelationshipsRequest({
    $core.Iterable<$core.String>? targetDids,
  }) {
    final result = create();
    if (targetDids != null) result.targetDids.addAll(targetDids);
    return result;
  }

  GetRelationshipsRequest._();

  factory GetRelationshipsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetRelationshipsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetRelationshipsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..pPS(1, _omitFieldNames ? '' : 'targetDids')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipsRequest copyWith(
          void Function(GetRelationshipsRequest) updates) =>
      super.copyWith((message) => updates(message as GetRelationshipsRequest))
          as GetRelationshipsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetRelationshipsRequest create() => GetRelationshipsRequest._();
  @$core.override
  GetRelationshipsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetRelationshipsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetRelationshipsRequest>(create);
  static GetRelationshipsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$core.String> get targetDids => $_getList(0);
}

class GetRelationshipsResponse extends $pb.GeneratedMessage {
  factory GetRelationshipsResponse({
    $core.Iterable<$core.MapEntry<$core.String, Relationship>>? relationships,
  }) {
    final result = create();
    if (relationships != null) result.relationships.addEntries(relationships);
    return result;
  }

  GetRelationshipsResponse._();

  factory GetRelationshipsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetRelationshipsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetRelationshipsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..m<$core.String, Relationship>(1, _omitFieldNames ? '' : 'relationships',
        entryClassName: 'GetRelationshipsResponse.RelationshipsEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OM,
        valueCreator: Relationship.create,
        valueDefaultOrMaker: Relationship.getDefault,
        packageName: const $pb.PackageName('peers_touch.model.social.v1'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetRelationshipsResponse copyWith(
          void Function(GetRelationshipsResponse) updates) =>
      super.copyWith((message) => updates(message as GetRelationshipsResponse))
          as GetRelationshipsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetRelationshipsResponse create() => GetRelationshipsResponse._();
  @$core.override
  GetRelationshipsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetRelationshipsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetRelationshipsResponse>(create);
  static GetRelationshipsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbMap<$core.String, Relationship> get relationships => $_getMap(0);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
