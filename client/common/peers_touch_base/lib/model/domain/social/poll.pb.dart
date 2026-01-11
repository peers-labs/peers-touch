// This is a generated file - do not edit.
//
// Generated from domain/social/poll.proto.

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

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class VotePollRequest extends $pb.GeneratedMessage {
  factory VotePollRequest({
    $core.String? postId,
    $core.Iterable<$core.int>? optionIndices,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    if (optionIndices != null) result.optionIndices.addAll(optionIndices);
    return result;
  }

  VotePollRequest._();

  factory VotePollRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory VotePollRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'VotePollRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'postId')
    ..p<$core.int>(
        2, _omitFieldNames ? '' : 'optionIndices', $pb.PbFieldType.K3)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VotePollRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VotePollRequest copyWith(void Function(VotePollRequest) updates) =>
      super.copyWith((message) => updates(message as VotePollRequest))
          as VotePollRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static VotePollRequest create() => VotePollRequest._();
  @$core.override
  VotePollRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static VotePollRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<VotePollRequest>(create);
  static VotePollRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get postId => $_getSZ(0);
  @$pb.TagNumber(1)
  set postId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<$core.int> get optionIndices => $_getList(1);
}

class VotePollResponse extends $pb.GeneratedMessage {
  factory VotePollResponse({
    $core.bool? success,
    PollResult? result,
  }) {
    final result$ = create();
    if (success != null) result$.success = success;
    if (result != null) result$.result = result;
    return result$;
  }

  VotePollResponse._();

  factory VotePollResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory VotePollResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'VotePollResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..aOM<PollResult>(2, _omitFieldNames ? '' : 'result',
        subBuilder: PollResult.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VotePollResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VotePollResponse copyWith(void Function(VotePollResponse) updates) =>
      super.copyWith((message) => updates(message as VotePollResponse))
          as VotePollResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static VotePollResponse create() => VotePollResponse._();
  @$core.override
  VotePollResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static VotePollResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<VotePollResponse>(create);
  static VotePollResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);

  @$pb.TagNumber(2)
  PollResult get result => $_getN(1);
  @$pb.TagNumber(2)
  set result(PollResult value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasResult() => $_has(1);
  @$pb.TagNumber(2)
  void clearResult() => $_clearField(2);
  @$pb.TagNumber(2)
  PollResult ensureResult() => $_ensure(1);
}

class PollResult extends $pb.GeneratedMessage {
  factory PollResult({
    $core.String? postId,
    $fixnum.Int64? totalVotes,
    $core.Iterable<PollOptionResult>? options,
    $core.bool? hasVoted,
    $core.Iterable<$core.int>? userVotes,
    $0.Timestamp? expiresAt,
    $core.bool? isExpired,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    if (totalVotes != null) result.totalVotes = totalVotes;
    if (options != null) result.options.addAll(options);
    if (hasVoted != null) result.hasVoted = hasVoted;
    if (userVotes != null) result.userVotes.addAll(userVotes);
    if (expiresAt != null) result.expiresAt = expiresAt;
    if (isExpired != null) result.isExpired = isExpired;
    return result;
  }

  PollResult._();

  factory PollResult.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PollResult.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PollResult',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'postId')
    ..aInt64(2, _omitFieldNames ? '' : 'totalVotes')
    ..pPM<PollOptionResult>(3, _omitFieldNames ? '' : 'options',
        subBuilder: PollOptionResult.create)
    ..aOB(4, _omitFieldNames ? '' : 'hasVoted')
    ..p<$core.int>(5, _omitFieldNames ? '' : 'userVotes', $pb.PbFieldType.K3)
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'expiresAt',
        subBuilder: $0.Timestamp.create)
    ..aOB(7, _omitFieldNames ? '' : 'isExpired')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PollResult clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PollResult copyWith(void Function(PollResult) updates) =>
      super.copyWith((message) => updates(message as PollResult)) as PollResult;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PollResult create() => PollResult._();
  @$core.override
  PollResult createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PollResult getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PollResult>(create);
  static PollResult? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get postId => $_getSZ(0);
  @$pb.TagNumber(1)
  set postId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get totalVotes => $_getI64(1);
  @$pb.TagNumber(2)
  set totalVotes($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTotalVotes() => $_has(1);
  @$pb.TagNumber(2)
  void clearTotalVotes() => $_clearField(2);

  @$pb.TagNumber(3)
  $pb.PbList<PollOptionResult> get options => $_getList(2);

  @$pb.TagNumber(4)
  $core.bool get hasVoted => $_getBF(3);
  @$pb.TagNumber(4)
  set hasVoted($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasHasVoted() => $_has(3);
  @$pb.TagNumber(4)
  void clearHasVoted() => $_clearField(4);

  @$pb.TagNumber(5)
  $pb.PbList<$core.int> get userVotes => $_getList(4);

  @$pb.TagNumber(6)
  $0.Timestamp get expiresAt => $_getN(5);
  @$pb.TagNumber(6)
  set expiresAt($0.Timestamp value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasExpiresAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearExpiresAt() => $_clearField(6);
  @$pb.TagNumber(6)
  $0.Timestamp ensureExpiresAt() => $_ensure(5);

  @$pb.TagNumber(7)
  $core.bool get isExpired => $_getBF(6);
  @$pb.TagNumber(7)
  set isExpired($core.bool value) => $_setBool(6, value);
  @$pb.TagNumber(7)
  $core.bool hasIsExpired() => $_has(6);
  @$pb.TagNumber(7)
  void clearIsExpired() => $_clearField(7);
}

class PollOptionResult extends $pb.GeneratedMessage {
  factory PollOptionResult({
    $core.int? index,
    $core.String? text,
    $fixnum.Int64? votes,
    $core.double? percentage,
  }) {
    final result = create();
    if (index != null) result.index = index;
    if (text != null) result.text = text;
    if (votes != null) result.votes = votes;
    if (percentage != null) result.percentage = percentage;
    return result;
  }

  PollOptionResult._();

  factory PollOptionResult.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PollOptionResult.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PollOptionResult',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'index')
    ..aOS(2, _omitFieldNames ? '' : 'text')
    ..aInt64(3, _omitFieldNames ? '' : 'votes')
    ..aD(4, _omitFieldNames ? '' : 'percentage')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PollOptionResult clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PollOptionResult copyWith(void Function(PollOptionResult) updates) =>
      super.copyWith((message) => updates(message as PollOptionResult))
          as PollOptionResult;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PollOptionResult create() => PollOptionResult._();
  @$core.override
  PollOptionResult createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PollOptionResult getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PollOptionResult>(create);
  static PollOptionResult? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get index => $_getIZ(0);
  @$pb.TagNumber(1)
  set index($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasIndex() => $_has(0);
  @$pb.TagNumber(1)
  void clearIndex() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get text => $_getSZ(1);
  @$pb.TagNumber(2)
  set text($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasText() => $_has(1);
  @$pb.TagNumber(2)
  void clearText() => $_clearField(2);

  @$pb.TagNumber(3)
  $fixnum.Int64 get votes => $_getI64(2);
  @$pb.TagNumber(3)
  set votes($fixnum.Int64 value) => $_setInt64(2, value);
  @$pb.TagNumber(3)
  $core.bool hasVotes() => $_has(2);
  @$pb.TagNumber(3)
  void clearVotes() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.double get percentage => $_getN(3);
  @$pb.TagNumber(4)
  set percentage($core.double value) => $_setDouble(3, value);
  @$pb.TagNumber(4)
  $core.bool hasPercentage() => $_has(3);
  @$pb.TagNumber(4)
  void clearPercentage() => $_clearField(4);
}

class GetPollResultRequest extends $pb.GeneratedMessage {
  factory GetPollResultRequest({
    $core.String? postId,
  }) {
    final result = create();
    if (postId != null) result.postId = postId;
    return result;
  }

  GetPollResultRequest._();

  factory GetPollResultRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetPollResultRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPollResultRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'postId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPollResultRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPollResultRequest copyWith(void Function(GetPollResultRequest) updates) =>
      super.copyWith((message) => updates(message as GetPollResultRequest))
          as GetPollResultRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetPollResultRequest create() => GetPollResultRequest._();
  @$core.override
  GetPollResultRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetPollResultRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPollResultRequest>(create);
  static GetPollResultRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get postId => $_getSZ(0);
  @$pb.TagNumber(1)
  set postId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPostId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPostId() => $_clearField(1);
}

class GetPollResultResponse extends $pb.GeneratedMessage {
  factory GetPollResultResponse({
    PollResult? result,
  }) {
    final result$ = create();
    if (result != null) result$.result = result;
    return result$;
  }

  GetPollResultResponse._();

  factory GetPollResultResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetPollResultResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPollResultResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.social.v1'),
      createEmptyInstance: create)
    ..aOM<PollResult>(1, _omitFieldNames ? '' : 'result',
        subBuilder: PollResult.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPollResultResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPollResultResponse copyWith(
          void Function(GetPollResultResponse) updates) =>
      super.copyWith((message) => updates(message as GetPollResultResponse))
          as GetPollResultResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetPollResultResponse create() => GetPollResultResponse._();
  @$core.override
  GetPollResultResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetPollResultResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPollResultResponse>(create);
  static GetPollResultResponse? _defaultInstance;

  @$pb.TagNumber(1)
  PollResult get result => $_getN(0);
  @$pb.TagNumber(1)
  set result(PollResult value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasResult() => $_has(0);
  @$pb.TagNumber(1)
  void clearResult() => $_clearField(1);
  @$pb.TagNumber(1)
  PollResult ensureResult() => $_ensure(0);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
