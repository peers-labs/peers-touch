// This is a generated file - do not edit.
//
// Generated from domain/events/events.proto.

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

/// Event types
class Event extends $pb.GeneratedMessage {
  factory Event({
    $core.String? id,
    $core.String? type,
    $core.List<$core.int>? payload,
    $0.Timestamp? createdAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (type != null) result.type = type;
    if (payload != null) result.payload = payload;
    if (createdAt != null) result.createdAt = createdAt;
    return result;
  }

  Event._();

  factory Event.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Event.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Event',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.events.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'type')
    ..a<$core.List<$core.int>>(
        3, _omitFieldNames ? '' : 'payload', $pb.PbFieldType.OY)
    ..aOM<$0.Timestamp>(4, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Event clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Event copyWith(void Function(Event) updates) =>
      super.copyWith((message) => updates(message as Event)) as Event;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Event create() => Event._();
  @$core.override
  Event createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Event getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Event>(create);
  static Event? _defaultInstance;

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
  $core.List<$core.int> get payload => $_getN(2);
  @$pb.TagNumber(3)
  set payload($core.List<$core.int> value) => $_setBytes(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPayload() => $_has(2);
  @$pb.TagNumber(3)
  void clearPayload() => $_clearField(3);

  @$pb.TagNumber(4)
  $0.Timestamp get createdAt => $_getN(3);
  @$pb.TagNumber(4)
  set createdAt($0.Timestamp value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasCreatedAt() => $_has(3);
  @$pb.TagNumber(4)
  void clearCreatedAt() => $_clearField(4);
  @$pb.TagNumber(4)
  $0.Timestamp ensureCreatedAt() => $_ensure(3);
}

/// Pull events (long polling)
class PullEventsRequest extends $pb.GeneratedMessage {
  factory PullEventsRequest({
    $core.int? limit,
    $fixnum.Int64? sinceTs,
  }) {
    final result = create();
    if (limit != null) result.limit = limit;
    if (sinceTs != null) result.sinceTs = sinceTs;
    return result;
  }

  PullEventsRequest._();

  factory PullEventsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PullEventsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PullEventsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.events.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'limit')
    ..aInt64(2, _omitFieldNames ? '' : 'sinceTs')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PullEventsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PullEventsRequest copyWith(void Function(PullEventsRequest) updates) =>
      super.copyWith((message) => updates(message as PullEventsRequest))
          as PullEventsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PullEventsRequest create() => PullEventsRequest._();
  @$core.override
  PullEventsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PullEventsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PullEventsRequest>(create);
  static PullEventsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get limit => $_getIZ(0);
  @$pb.TagNumber(1)
  set limit($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasLimit() => $_has(0);
  @$pb.TagNumber(1)
  void clearLimit() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get sinceTs => $_getI64(1);
  @$pb.TagNumber(2)
  set sinceTs($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSinceTs() => $_has(1);
  @$pb.TagNumber(2)
  void clearSinceTs() => $_clearField(2);
}

class PullEventsResponse extends $pb.GeneratedMessage {
  factory PullEventsResponse({
    $core.Iterable<Event>? events,
  }) {
    final result = create();
    if (events != null) result.events.addAll(events);
    return result;
  }

  PullEventsResponse._();

  factory PullEventsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PullEventsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PullEventsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.events.v1'),
      createEmptyInstance: create)
    ..pPM<Event>(1, _omitFieldNames ? '' : 'events', subBuilder: Event.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PullEventsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PullEventsResponse copyWith(void Function(PullEventsResponse) updates) =>
      super.copyWith((message) => updates(message as PullEventsResponse))
          as PullEventsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PullEventsResponse create() => PullEventsResponse._();
  @$core.override
  PullEventsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PullEventsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PullEventsResponse>(create);
  static PullEventsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Event> get events => $_getList(0);
}

/// Acknowledge events
class AckEventsRequest extends $pb.GeneratedMessage {
  factory AckEventsRequest({
    $core.Iterable<$core.String>? eventIds,
  }) {
    final result = create();
    if (eventIds != null) result.eventIds.addAll(eventIds);
    return result;
  }

  AckEventsRequest._();

  factory AckEventsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory AckEventsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AckEventsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.events.v1'),
      createEmptyInstance: create)
    ..pPS(1, _omitFieldNames ? '' : 'eventIds')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AckEventsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AckEventsRequest copyWith(void Function(AckEventsRequest) updates) =>
      super.copyWith((message) => updates(message as AckEventsRequest))
          as AckEventsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AckEventsRequest create() => AckEventsRequest._();
  @$core.override
  AckEventsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static AckEventsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AckEventsRequest>(create);
  static AckEventsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$core.String> get eventIds => $_getList(0);
}

class AckEventsResponse extends $pb.GeneratedMessage {
  factory AckEventsResponse({
    $core.int? ackedCount,
  }) {
    final result = create();
    if (ackedCount != null) result.ackedCount = ackedCount;
    return result;
  }

  AckEventsResponse._();

  factory AckEventsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory AckEventsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AckEventsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.events.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'ackedCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AckEventsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AckEventsResponse copyWith(void Function(AckEventsResponse) updates) =>
      super.copyWith((message) => updates(message as AckEventsResponse))
          as AckEventsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AckEventsResponse create() => AckEventsResponse._();
  @$core.override
  AckEventsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static AckEventsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AckEventsResponse>(create);
  static AckEventsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get ackedCount => $_getIZ(0);
  @$pb.TagNumber(1)
  set ackedCount($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAckedCount() => $_has(0);
  @$pb.TagNumber(1)
  void clearAckedCount() => $_clearField(1);
}

/// Stats
class GetEventsStatsRequest extends $pb.GeneratedMessage {
  factory GetEventsStatsRequest() => create();

  GetEventsStatsRequest._();

  factory GetEventsStatsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetEventsStatsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetEventsStatsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.events.v1'),
      createEmptyInstance: create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetEventsStatsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetEventsStatsRequest copyWith(
          void Function(GetEventsStatsRequest) updates) =>
      super.copyWith((message) => updates(message as GetEventsStatsRequest))
          as GetEventsStatsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetEventsStatsRequest create() => GetEventsStatsRequest._();
  @$core.override
  GetEventsStatsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetEventsStatsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetEventsStatsRequest>(create);
  static GetEventsStatsRequest? _defaultInstance;
}

class GetEventsStatsResponse extends $pb.GeneratedMessage {
  factory GetEventsStatsResponse({
    $fixnum.Int64? pendingCount,
    $fixnum.Int64? totalDelivered,
    $fixnum.Int64? activeStreams,
  }) {
    final result = create();
    if (pendingCount != null) result.pendingCount = pendingCount;
    if (totalDelivered != null) result.totalDelivered = totalDelivered;
    if (activeStreams != null) result.activeStreams = activeStreams;
    return result;
  }

  GetEventsStatsResponse._();

  factory GetEventsStatsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetEventsStatsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetEventsStatsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.events.v1'),
      createEmptyInstance: create)
    ..aInt64(1, _omitFieldNames ? '' : 'pendingCount')
    ..aInt64(2, _omitFieldNames ? '' : 'totalDelivered')
    ..aInt64(3, _omitFieldNames ? '' : 'activeStreams')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetEventsStatsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetEventsStatsResponse copyWith(
          void Function(GetEventsStatsResponse) updates) =>
      super.copyWith((message) => updates(message as GetEventsStatsResponse))
          as GetEventsStatsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetEventsStatsResponse create() => GetEventsStatsResponse._();
  @$core.override
  GetEventsStatsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetEventsStatsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetEventsStatsResponse>(create);
  static GetEventsStatsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $fixnum.Int64 get pendingCount => $_getI64(0);
  @$pb.TagNumber(1)
  set pendingCount($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPendingCount() => $_has(0);
  @$pb.TagNumber(1)
  void clearPendingCount() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get totalDelivered => $_getI64(1);
  @$pb.TagNumber(2)
  set totalDelivered($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTotalDelivered() => $_has(1);
  @$pb.TagNumber(2)
  void clearTotalDelivered() => $_clearField(2);

  @$pb.TagNumber(3)
  $fixnum.Int64 get activeStreams => $_getI64(2);
  @$pb.TagNumber(3)
  set activeStreams($fixnum.Int64 value) => $_setInt64(2, value);
  @$pb.TagNumber(3)
  $core.bool hasActiveStreams() => $_has(2);
  @$pb.TagNumber(3)
  void clearActiveStreams() => $_clearField(3);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
