// This is a generated file - do not edit.
//
// Generated from common.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import 'common.pbenum.dart';
import 'google/protobuf/timestamp.pb.dart' as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'common.pbenum.dart';

/// Error represents a standardized error response.
class Error extends $pb.GeneratedMessage {
  factory Error({
    $core.String? code,
    $core.String? message,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? details,
    $0.Timestamp? timestamp,
  }) {
    final result = create();
    if (code != null) result.code = code;
    if (message != null) result.message = message;
    if (details != null) result.details.addEntries(details);
    if (timestamp != null) result.timestamp = timestamp;
    return result;
  }

  Error._();

  factory Error.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Error.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Error',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'code')
    ..aOS(2, _omitFieldNames ? '' : 'message')
    ..m<$core.String, $core.String>(3, _omitFieldNames ? '' : 'details',
        entryClassName: 'Error.DetailsEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..aOM<$0.Timestamp>(4, _omitFieldNames ? '' : 'timestamp',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Error clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Error copyWith(void Function(Error) updates) =>
      super.copyWith((message) => updates(message as Error)) as Error;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Error create() => Error._();
  @$core.override
  Error createEmptyInstance() => create();
  static $pb.PbList<Error> createRepeated() => $pb.PbList<Error>();
  @$core.pragma('dart2js:noInline')
  static Error getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Error>(create);
  static Error? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get code => $_getSZ(0);
  @$pb.TagNumber(1)
  set code($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasCode() => $_has(0);
  @$pb.TagNumber(1)
  void clearCode() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get message => $_getSZ(1);
  @$pb.TagNumber(2)
  set message($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasMessage() => $_has(1);
  @$pb.TagNumber(2)
  void clearMessage() => $_clearField(2);

  @$pb.TagNumber(3)
  $pb.PbMap<$core.String, $core.String> get details => $_getMap(2);

  @$pb.TagNumber(4)
  $0.Timestamp get timestamp => $_getN(3);
  @$pb.TagNumber(4)
  set timestamp($0.Timestamp value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasTimestamp() => $_has(3);
  @$pb.TagNumber(4)
  void clearTimestamp() => $_clearField(4);
  @$pb.TagNumber(4)
  $0.Timestamp ensureTimestamp() => $_ensure(3);
}

/// Result represents a generic result wrapper.
class Result extends $pb.GeneratedMessage {
  factory Result({
    $core.bool? success,
    Error? error,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? metadata,
  }) {
    final result = create();
    if (success != null) result.success = success;
    if (error != null) result.error = error;
    if (metadata != null) result.metadata.addEntries(metadata);
    return result;
  }

  Result._();

  factory Result.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Result.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Result',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..aOM<Error>(2, _omitFieldNames ? '' : 'error', subBuilder: Error.create)
    ..m<$core.String, $core.String>(3, _omitFieldNames ? '' : 'metadata',
        entryClassName: 'Result.MetadataEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Result clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Result copyWith(void Function(Result) updates) =>
      super.copyWith((message) => updates(message as Result)) as Result;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Result create() => Result._();
  @$core.override
  Result createEmptyInstance() => create();
  static $pb.PbList<Result> createRepeated() => $pb.PbList<Result>();
  @$core.pragma('dart2js:noInline')
  static Result getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Result>(create);
  static Result? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);

  @$pb.TagNumber(2)
  Error get error => $_getN(1);
  @$pb.TagNumber(2)
  set error(Error value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasError() => $_has(1);
  @$pb.TagNumber(2)
  void clearError() => $_clearField(2);
  @$pb.TagNumber(2)
  Error ensureError() => $_ensure(1);

  @$pb.TagNumber(3)
  $pb.PbMap<$core.String, $core.String> get metadata => $_getMap(2);
}

/// Pagination represents pagination information.
class Pagination extends $pb.GeneratedMessage {
  factory Pagination({
    $core.int? page,
    $core.int? pageSize,
    $core.int? totalCount,
    $core.bool? hasNext,
    $core.bool? hasPrev,
    $core.String? nextToken,
    $core.String? prevToken,
  }) {
    final result = create();
    if (page != null) result.page = page;
    if (pageSize != null) result.pageSize = pageSize;
    if (totalCount != null) result.totalCount = totalCount;
    if (hasNext != null) result.hasNext = hasNext;
    if (hasPrev != null) result.hasPrev = hasPrev;
    if (nextToken != null) result.nextToken = nextToken;
    if (prevToken != null) result.prevToken = prevToken;
    return result;
  }

  Pagination._();

  factory Pagination.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Pagination.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Pagination',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'page')
    ..aI(2, _omitFieldNames ? '' : 'pageSize')
    ..aI(3, _omitFieldNames ? '' : 'totalCount')
    ..aOB(4, _omitFieldNames ? '' : 'hasNext')
    ..aOB(5, _omitFieldNames ? '' : 'hasPrev')
    ..aOS(6, _omitFieldNames ? '' : 'nextToken')
    ..aOS(7, _omitFieldNames ? '' : 'prevToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Pagination clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Pagination copyWith(void Function(Pagination) updates) =>
      super.copyWith((message) => updates(message as Pagination)) as Pagination;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Pagination create() => Pagination._();
  @$core.override
  Pagination createEmptyInstance() => create();
  static $pb.PbList<Pagination> createRepeated() => $pb.PbList<Pagination>();
  @$core.pragma('dart2js:noInline')
  static Pagination getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Pagination>(create);
  static Pagination? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get page => $_getIZ(0);
  @$pb.TagNumber(1)
  set page($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPage() => $_has(0);
  @$pb.TagNumber(1)
  void clearPage() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get pageSize => $_getIZ(1);
  @$pb.TagNumber(2)
  set pageSize($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPageSize() => $_has(1);
  @$pb.TagNumber(2)
  void clearPageSize() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get totalCount => $_getIZ(2);
  @$pb.TagNumber(3)
  set totalCount($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTotalCount() => $_has(2);
  @$pb.TagNumber(3)
  void clearTotalCount() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.bool get hasNext => $_getBF(3);
  @$pb.TagNumber(4)
  set hasNext($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasHasNext() => $_has(3);
  @$pb.TagNumber(4)
  void clearHasNext() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.bool get hasPrev => $_getBF(4);
  @$pb.TagNumber(5)
  set hasPrev($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasHasPrev() => $_has(4);
  @$pb.TagNumber(5)
  void clearHasPrev() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get nextToken => $_getSZ(5);
  @$pb.TagNumber(6)
  set nextToken($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasNextToken() => $_has(5);
  @$pb.TagNumber(6)
  void clearNextToken() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get prevToken => $_getSZ(6);
  @$pb.TagNumber(7)
  set prevToken($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasPrevToken() => $_has(6);
  @$pb.TagNumber(7)
  void clearPrevToken() => $_clearField(7);
}

/// HealthCheck represents a health check result.
class HealthCheck extends $pb.GeneratedMessage {
  factory HealthCheck({
    $core.String? component,
    HealthStatus? status,
    $core.String? message,
    $0.Timestamp? checkedAt,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? details,
  }) {
    final result = create();
    if (component != null) result.component = component;
    if (status != null) result.status = status;
    if (message != null) result.message = message;
    if (checkedAt != null) result.checkedAt = checkedAt;
    if (details != null) result.details.addEntries(details);
    return result;
  }

  HealthCheck._();

  factory HealthCheck.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory HealthCheck.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'HealthCheck',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'component')
    ..aE<HealthStatus>(2, _omitFieldNames ? '' : 'status',
        enumValues: HealthStatus.values)
    ..aOS(3, _omitFieldNames ? '' : 'message')
    ..aOM<$0.Timestamp>(4, _omitFieldNames ? '' : 'checkedAt',
        subBuilder: $0.Timestamp.create)
    ..m<$core.String, $core.String>(5, _omitFieldNames ? '' : 'details',
        entryClassName: 'HealthCheck.DetailsEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  HealthCheck clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  HealthCheck copyWith(void Function(HealthCheck) updates) =>
      super.copyWith((message) => updates(message as HealthCheck))
          as HealthCheck;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static HealthCheck create() => HealthCheck._();
  @$core.override
  HealthCheck createEmptyInstance() => create();
  static $pb.PbList<HealthCheck> createRepeated() => $pb.PbList<HealthCheck>();
  @$core.pragma('dart2js:noInline')
  static HealthCheck getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<HealthCheck>(create);
  static HealthCheck? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get component => $_getSZ(0);
  @$pb.TagNumber(1)
  set component($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasComponent() => $_has(0);
  @$pb.TagNumber(1)
  void clearComponent() => $_clearField(1);

  @$pb.TagNumber(2)
  HealthStatus get status => $_getN(1);
  @$pb.TagNumber(2)
  set status(HealthStatus value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasStatus() => $_has(1);
  @$pb.TagNumber(2)
  void clearStatus() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get message => $_getSZ(2);
  @$pb.TagNumber(3)
  set message($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasMessage() => $_has(2);
  @$pb.TagNumber(3)
  void clearMessage() => $_clearField(3);

  @$pb.TagNumber(4)
  $0.Timestamp get checkedAt => $_getN(3);
  @$pb.TagNumber(4)
  set checkedAt($0.Timestamp value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasCheckedAt() => $_has(3);
  @$pb.TagNumber(4)
  void clearCheckedAt() => $_clearField(4);
  @$pb.TagNumber(4)
  $0.Timestamp ensureCheckedAt() => $_ensure(3);

  @$pb.TagNumber(5)
  $pb.PbMap<$core.String, $core.String> get details => $_getMap(4);
}

/// Metrics represents performance metrics.
class Metrics extends $pb.GeneratedMessage {
  factory Metrics({
    $core.Iterable<$core.MapEntry<$core.String, $core.double>>? counters,
    $core.Iterable<$core.MapEntry<$core.String, $core.double>>? gauges,
    $core.Iterable<$core.MapEntry<$core.String, $core.double>>? histograms,
    $0.Timestamp? collectedAt,
  }) {
    final result = create();
    if (counters != null) result.counters.addEntries(counters);
    if (gauges != null) result.gauges.addEntries(gauges);
    if (histograms != null) result.histograms.addEntries(histograms);
    if (collectedAt != null) result.collectedAt = collectedAt;
    return result;
  }

  Metrics._();

  factory Metrics.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Metrics.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Metrics',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..m<$core.String, $core.double>(1, _omitFieldNames ? '' : 'counters',
        entryClassName: 'Metrics.CountersEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OD,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..m<$core.String, $core.double>(2, _omitFieldNames ? '' : 'gauges',
        entryClassName: 'Metrics.GaugesEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OD,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..m<$core.String, $core.double>(3, _omitFieldNames ? '' : 'histograms',
        entryClassName: 'Metrics.HistogramsEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OD,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..aOM<$0.Timestamp>(4, _omitFieldNames ? '' : 'collectedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Metrics clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Metrics copyWith(void Function(Metrics) updates) =>
      super.copyWith((message) => updates(message as Metrics)) as Metrics;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Metrics create() => Metrics._();
  @$core.override
  Metrics createEmptyInstance() => create();
  static $pb.PbList<Metrics> createRepeated() => $pb.PbList<Metrics>();
  @$core.pragma('dart2js:noInline')
  static Metrics getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Metrics>(create);
  static Metrics? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbMap<$core.String, $core.double> get counters => $_getMap(0);

  @$pb.TagNumber(2)
  $pb.PbMap<$core.String, $core.double> get gauges => $_getMap(1);

  @$pb.TagNumber(3)
  $pb.PbMap<$core.String, $core.double> get histograms => $_getMap(2);

  @$pb.TagNumber(4)
  $0.Timestamp get collectedAt => $_getN(3);
  @$pb.TagNumber(4)
  set collectedAt($0.Timestamp value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasCollectedAt() => $_has(3);
  @$pb.TagNumber(4)
  void clearCollectedAt() => $_clearField(4);
  @$pb.TagNumber(4)
  $0.Timestamp ensureCollectedAt() => $_ensure(3);
}

/// Event represents a system event.
class Event extends $pb.GeneratedMessage {
  factory Event({
    $core.String? id,
    $core.String? type,
    $core.String? source,
    $core.List<$core.int>? payload,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? attributes,
    $0.Timestamp? occurredAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (type != null) result.type = type;
    if (source != null) result.source = source;
    if (payload != null) result.payload = payload;
    if (attributes != null) result.attributes.addEntries(attributes);
    if (occurredAt != null) result.occurredAt = occurredAt;
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
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'type')
    ..aOS(3, _omitFieldNames ? '' : 'source')
    ..a<$core.List<$core.int>>(
        4, _omitFieldNames ? '' : 'payload', $pb.PbFieldType.OY)
    ..m<$core.String, $core.String>(5, _omitFieldNames ? '' : 'attributes',
        entryClassName: 'Event.AttributesEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'occurredAt',
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
  static $pb.PbList<Event> createRepeated() => $pb.PbList<Event>();
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
  $core.String get source => $_getSZ(2);
  @$pb.TagNumber(3)
  set source($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSource() => $_has(2);
  @$pb.TagNumber(3)
  void clearSource() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.List<$core.int> get payload => $_getN(3);
  @$pb.TagNumber(4)
  set payload($core.List<$core.int> value) => $_setBytes(3, value);
  @$pb.TagNumber(4)
  $core.bool hasPayload() => $_has(3);
  @$pb.TagNumber(4)
  void clearPayload() => $_clearField(4);

  @$pb.TagNumber(5)
  $pb.PbMap<$core.String, $core.String> get attributes => $_getMap(4);

  @$pb.TagNumber(6)
  $0.Timestamp get occurredAt => $_getN(5);
  @$pb.TagNumber(6)
  set occurredAt($0.Timestamp value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasOccurredAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearOccurredAt() => $_clearField(6);
  @$pb.TagNumber(6)
  $0.Timestamp ensureOccurredAt() => $_ensure(5);
}

/// Configuration represents a configuration entry.
class Configuration extends $pb.GeneratedMessage {
  factory Configuration({
    $core.String? key,
    $core.String? value,
    $core.String? type,
    $core.String? description,
    $core.bool? isSecret,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (key != null) result.key = key;
    if (value != null) result.value = value;
    if (type != null) result.type = type;
    if (description != null) result.description = description;
    if (isSecret != null) result.isSecret = isSecret;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  Configuration._();

  factory Configuration.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Configuration.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Configuration',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'key')
    ..aOS(2, _omitFieldNames ? '' : 'value')
    ..aOS(3, _omitFieldNames ? '' : 'type')
    ..aOS(4, _omitFieldNames ? '' : 'description')
    ..aOB(5, _omitFieldNames ? '' : 'isSecret')
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Configuration clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Configuration copyWith(void Function(Configuration) updates) =>
      super.copyWith((message) => updates(message as Configuration))
          as Configuration;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Configuration create() => Configuration._();
  @$core.override
  Configuration createEmptyInstance() => create();
  static $pb.PbList<Configuration> createRepeated() =>
      $pb.PbList<Configuration>();
  @$core.pragma('dart2js:noInline')
  static Configuration getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Configuration>(create);
  static Configuration? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get key => $_getSZ(0);
  @$pb.TagNumber(1)
  set key($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasKey() => $_has(0);
  @$pb.TagNumber(1)
  void clearKey() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get value => $_getSZ(1);
  @$pb.TagNumber(2)
  set value($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasValue() => $_has(1);
  @$pb.TagNumber(2)
  void clearValue() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get type => $_getSZ(2);
  @$pb.TagNumber(3)
  set type($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasType() => $_has(2);
  @$pb.TagNumber(3)
  void clearType() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get description => $_getSZ(3);
  @$pb.TagNumber(4)
  set description($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasDescription() => $_has(3);
  @$pb.TagNumber(4)
  void clearDescription() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.bool get isSecret => $_getBF(4);
  @$pb.TagNumber(5)
  set isSecret($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasIsSecret() => $_has(4);
  @$pb.TagNumber(5)
  void clearIsSecret() => $_clearField(5);

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
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
