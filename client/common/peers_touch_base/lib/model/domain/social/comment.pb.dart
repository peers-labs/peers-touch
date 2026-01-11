// This is a generated file - do not edit.
//
// Generated from domain/social/comment.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;
import 'package:protobuf/well_known_types/google/protobuf/timestamp.pb.dart'
    as $0;

import 'comment.pbenum.dart';
import 'post.pb.dart' as $1;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'comment.pbenum.dart';

class Comment extends $pb.GeneratedMessage {
  factory Comment({
    $core.String? id,
    $core.String? postId,
    $core.String? authorId,
    $core.String? content,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
    $core.bool? isDeleted,
    $1.PostAuthor? author,
    $fixnum.Int64? likesCount,
    $core.bool? isLiked,
    $core.String? replyToCommentId,
    $fixnum.Int64? repliesCount,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (postId != null) result.postId = postId;
    if (authorId != null) result.authorId = authorId;
    if (content != null) result.content = content;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    if (isDeleted != null) result.isDeleted = isDeleted;
    if (author != null) result.author = author;
    if (likesCount != null) result.likesCount = likesCount;
    if (isLiked != null) result.isLiked = isLiked;
    if (replyToCommentId != null) result.replyToCommentId = replyToCommentId;
    if (repliesCount != null) result.repliesCount = repliesCount;
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
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'postId')
    ..aOS(3, _omitFieldNames ? '' : 'authorId')
    ..aOS(4, _omitFieldNames ? '' : 'content')
    ..aOM<$0.Timestamp>(5, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..aOB(7, _omitFieldNames ? '' : 'isDeleted')
    ..aOM<$1.PostAuthor>(10, _omitFieldNames ? '' : 'author',
        subBuilder: $1.PostAuthor.create)
    ..aInt64(11, _omitFieldNames ? '' : 'likesCount')
    ..aOB(12, _omitFieldNames ? '' : 'isLiked')
    ..aOS(20, _omitFieldNames ? '' : 'replyToCommentId')
    ..aInt64(21, _omitFieldNames ? '' : 'repliesCount')
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
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get postId => $_getSZ(1);
  @$pb.TagNumber(2)
  set postId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPostId() => $_has(1);
  @$pb.TagNumber(2)
  void clearPostId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get authorId => $_getSZ(2);
  @$pb.TagNumber(3)
  set authorId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasAuthorId() => $_has(2);
  @$pb.TagNumber(3)
  void clearAuthorId() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get content => $_getSZ(3);
  @$pb.TagNumber(4)
  set content($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasContent() => $_has(3);
  @$pb.TagNumber(4)
  void clearContent() => $_clearField(4);

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
  $1.PostAuthor get author => $_getN(7);
  @$pb.TagNumber(10)
  set author($1.PostAuthor value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasAuthor() => $_has(7);
  @$pb.TagNumber(10)
  void clearAuthor() => $_clearField(10);
  @$pb.TagNumber(10)
  $1.PostAuthor ensureAuthor() => $_ensure(7);

  @$pb.TagNumber(11)
  $fixnum.Int64 get likesCount => $_getI64(8);
  @$pb.TagNumber(11)
  set likesCount($fixnum.Int64 value) => $_setInt64(8, value);
  @$pb.TagNumber(11)
  $core.bool hasLikesCount() => $_has(8);
  @$pb.TagNumber(11)
  void clearLikesCount() => $_clearField(11);

  @$pb.TagNumber(12)
  $core.bool get isLiked => $_getBF(9);
  @$pb.TagNumber(12)
  set isLiked($core.bool value) => $_setBool(9, value);
  @$pb.TagNumber(12)
  $core.bool hasIsLiked() => $_has(9);
  @$pb.TagNumber(12)
  void clearIsLiked() => $_clearField(12);

  @$pb.TagNumber(20)
  $core.String get replyToCommentId => $_getSZ(10);
  @$pb.TagNumber(20)
  set replyToCommentId($core.String value) => $_setString(10, value);
  @$pb.TagNumber(20)
  $core.bool hasReplyToCommentId() => $_has(10);
  @$pb.TagNumber(20)
  void clearReplyToCommentId() => $_clearField(20);

  @$pb.TagNumber(21)
  $fixnum.Int64 get repliesCount => $_getI64(11);
  @$pb.TagNumber(21)
  set repliesCount($fixnum.Int64 value) => $_setInt64(11, value);
  @$pb.TagNumber(21)
  $core.bool hasRepliesCount() => $_has(11);
  @$pb.TagNumber(21)
  void clearRepliesCount() => $_clearField(21);
}

class CreateCommentRequest extends $pb.GeneratedMessage {
  factory CreateCommentRequest({
    $core.String? postId,
    $core.String? content,
    $core.String? replyToCommentId,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    if (content != null) result.content = content;
    if (replyToCommentId != null) result.replyToCommentId = replyToCommentId;
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
    ..aOS(1, _omitFieldNames ? '' : 'postId')
    ..aOS(2, _omitFieldNames ? '' : 'content')
    ..aOS(3, _omitFieldNames ? '' : 'replyToCommentId')
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
  $core.String get replyToCommentId => $_getSZ(2);
  @$pb.TagNumber(3)
  set replyToCommentId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasReplyToCommentId() => $_has(2);
  @$pb.TagNumber(3)
  void clearReplyToCommentId() => $_clearField(3);
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

class UpdateCommentRequest extends $pb.GeneratedMessage {
  factory UpdateCommentRequest({
    $core.String? commentId,
    $core.String? content,
  }) {
    final result = create();
    if (commentId != null) result.commentId = commentId;
    if (content != null) result.content = content;
    return result;
  }

  UpdateCommentRequest._();

  factory UpdateCommentRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateCommentRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateCommentRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'commentId')
    ..aOS(2, _omitFieldNames ? '' : 'content')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateCommentRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateCommentRequest copyWith(void Function(UpdateCommentRequest) updates) =>
      super.copyWith((message) => updates(message as UpdateCommentRequest))
          as UpdateCommentRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateCommentRequest create() => UpdateCommentRequest._();
  @$core.override
  UpdateCommentRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateCommentRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateCommentRequest>(create);
  static UpdateCommentRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get commentId => $_getSZ(0);
  @$pb.TagNumber(1)
  set commentId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasCommentId() => $_has(0);
  @$pb.TagNumber(1)
  void clearCommentId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get content => $_getSZ(1);
  @$pb.TagNumber(2)
  set content($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasContent() => $_has(1);
  @$pb.TagNumber(2)
  void clearContent() => $_clearField(2);
}

class UpdateCommentResponse extends $pb.GeneratedMessage {
  factory UpdateCommentResponse({
    Comment? comment,
  }) {
    final result = create();
    if (comment != null) result.comment = comment;
    return result;
  }

  UpdateCommentResponse._();

  factory UpdateCommentResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateCommentResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateCommentResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOM<Comment>(1, _omitFieldNames ? '' : 'comment',
        subBuilder: Comment.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateCommentResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateCommentResponse copyWith(
          void Function(UpdateCommentResponse) updates) =>
      super.copyWith((message) => updates(message as UpdateCommentResponse))
          as UpdateCommentResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateCommentResponse create() => UpdateCommentResponse._();
  @$core.override
  UpdateCommentResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateCommentResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateCommentResponse>(create);
  static UpdateCommentResponse? _defaultInstance;

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
    $core.String? commentId,
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
    ..aOS(1, _omitFieldNames ? '' : 'commentId')
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
  $core.String get commentId => $_getSZ(0);
  @$pb.TagNumber(1)
  set commentId($core.String value) => $_setString(0, value);
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

class GetCommentsRequest extends $pb.GeneratedMessage {
  factory GetCommentsRequest({
    $core.String? postId,
    $core.String? cursor,
    $core.int? limit,
    CommentSort? sort,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    if (cursor != null) result.cursor = cursor;
    if (limit != null) result.limit = limit;
    if (sort != null) result.sort = sort;
    return result;
  }

  GetCommentsRequest._();

  factory GetCommentsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetCommentsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetCommentsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'postId')
    ..aOS(2, _omitFieldNames ? '' : 'cursor')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..aE<CommentSort>(4, _omitFieldNames ? '' : 'sort',
        enumValues: CommentSort.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetCommentsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetCommentsRequest copyWith(void Function(GetCommentsRequest) updates) =>
      super.copyWith((message) => updates(message as GetCommentsRequest))
          as GetCommentsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetCommentsRequest create() => GetCommentsRequest._();
  @$core.override
  GetCommentsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetCommentsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetCommentsRequest>(create);
  static GetCommentsRequest? _defaultInstance;

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

  @$pb.TagNumber(4)
  CommentSort get sort => $_getN(3);
  @$pb.TagNumber(4)
  set sort(CommentSort value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSort() => $_has(3);
  @$pb.TagNumber(4)
  void clearSort() => $_clearField(4);
}

class GetCommentsResponse extends $pb.GeneratedMessage {
  factory GetCommentsResponse({
    $core.Iterable<Comment>? comments,
    $core.String? nextCursor,
    $core.bool? hasMore,
  }) {
    final result = create();
    if (comments != null) result.comments.addAll(comments);
    if (nextCursor != null) result.nextCursor = nextCursor;
    if (hasMore != null) result.hasMore = hasMore;
    return result;
  }

  GetCommentsResponse._();

  factory GetCommentsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetCommentsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetCommentsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..pPM<Comment>(1, _omitFieldNames ? '' : 'comments',
        subBuilder: Comment.create)
    ..aOS(2, _omitFieldNames ? '' : 'nextCursor')
    ..aOB(3, _omitFieldNames ? '' : 'hasMore')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetCommentsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetCommentsResponse copyWith(void Function(GetCommentsResponse) updates) =>
      super.copyWith((message) => updates(message as GetCommentsResponse))
          as GetCommentsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetCommentsResponse create() => GetCommentsResponse._();
  @$core.override
  GetCommentsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetCommentsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetCommentsResponse>(create);
  static GetCommentsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Comment> get comments => $_getList(0);

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

class LikeCommentRequest extends $pb.GeneratedMessage {
  factory LikeCommentRequest({
    $core.String? commentId,
  }) {
    final result = create();
    if (commentId != null) result.commentId = commentId;
    return result;
  }

  LikeCommentRequest._();

  factory LikeCommentRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory LikeCommentRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LikeCommentRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'commentId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LikeCommentRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LikeCommentRequest copyWith(void Function(LikeCommentRequest) updates) =>
      super.copyWith((message) => updates(message as LikeCommentRequest))
          as LikeCommentRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static LikeCommentRequest create() => LikeCommentRequest._();
  @$core.override
  LikeCommentRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static LikeCommentRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<LikeCommentRequest>(create);
  static LikeCommentRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get commentId => $_getSZ(0);
  @$pb.TagNumber(1)
  set commentId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasCommentId() => $_has(0);
  @$pb.TagNumber(1)
  void clearCommentId() => $_clearField(1);
}

class LikeCommentResponse extends $pb.GeneratedMessage {
  factory LikeCommentResponse({
    $core.bool? success,
    $fixnum.Int64? newLikesCount,
  }) {
    final result = create();
    if (success != null) result.success = success;
    if (newLikesCount != null) result.newLikesCount = newLikesCount;
    return result;
  }

  LikeCommentResponse._();

  factory LikeCommentResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory LikeCommentResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LikeCommentResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..aInt64(2, _omitFieldNames ? '' : 'newLikesCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LikeCommentResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LikeCommentResponse copyWith(void Function(LikeCommentResponse) updates) =>
      super.copyWith((message) => updates(message as LikeCommentResponse))
          as LikeCommentResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static LikeCommentResponse create() => LikeCommentResponse._();
  @$core.override
  LikeCommentResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static LikeCommentResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<LikeCommentResponse>(create);
  static LikeCommentResponse? _defaultInstance;

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

class UnlikeCommentRequest extends $pb.GeneratedMessage {
  factory UnlikeCommentRequest({
    $core.String? commentId,
  }) {
    final result = create();
    if (commentId != null) result.commentId = commentId;
    return result;
  }

  UnlikeCommentRequest._();

  factory UnlikeCommentRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UnlikeCommentRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnlikeCommentRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'commentId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnlikeCommentRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnlikeCommentRequest copyWith(void Function(UnlikeCommentRequest) updates) =>
      super.copyWith((message) => updates(message as UnlikeCommentRequest))
          as UnlikeCommentRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UnlikeCommentRequest create() => UnlikeCommentRequest._();
  @$core.override
  UnlikeCommentRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UnlikeCommentRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UnlikeCommentRequest>(create);
  static UnlikeCommentRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get commentId => $_getSZ(0);
  @$pb.TagNumber(1)
  set commentId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasCommentId() => $_has(0);
  @$pb.TagNumber(1)
  void clearCommentId() => $_clearField(1);
}

class UnlikeCommentResponse extends $pb.GeneratedMessage {
  factory UnlikeCommentResponse({
    $core.bool? success,
    $fixnum.Int64? newLikesCount,
  }) {
    final result = create();
    if (success != null) result.success = success;
    if (newLikesCount != null) result.newLikesCount = newLikesCount;
    return result;
  }

  UnlikeCommentResponse._();

  factory UnlikeCommentResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UnlikeCommentResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnlikeCommentResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..aInt64(2, _omitFieldNames ? '' : 'newLikesCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnlikeCommentResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnlikeCommentResponse copyWith(
          void Function(UnlikeCommentResponse) updates) =>
      super.copyWith((message) => updates(message as UnlikeCommentResponse))
          as UnlikeCommentResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UnlikeCommentResponse create() => UnlikeCommentResponse._();
  @$core.override
  UnlikeCommentResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UnlikeCommentResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UnlikeCommentResponse>(create);
  static UnlikeCommentResponse? _defaultInstance;

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

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
