// This is a generated file - do not edit.
//
// Generated from domain/agent/agent.proto.

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

import 'agent.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'agent.pbenum.dart';

class Turn extends $pb.GeneratedMessage {
  factory Turn({
    $core.String? turnId,
    $core.String? conversationId,
    $core.String? agentId,
    $core.String? userInput,
    $core.String? finalResponse,
    $core.int? toolIterations,
    TurnStatus? status,
    $0.Timestamp? startedAt,
    $0.Timestamp? endedAt,
  }) {
    final result = create();
    if (turnId != null) result.turnId = turnId;
    if (conversationId != null) result.conversationId = conversationId;
    if (agentId != null) result.agentId = agentId;
    if (userInput != null) result.userInput = userInput;
    if (finalResponse != null) result.finalResponse = finalResponse;
    if (toolIterations != null) result.toolIterations = toolIterations;
    if (status != null) result.status = status;
    if (startedAt != null) result.startedAt = startedAt;
    if (endedAt != null) result.endedAt = endedAt;
    return result;
  }

  Turn._();

  factory Turn.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Turn.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Turn',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'turnId')
    ..aOS(2, _omitFieldNames ? '' : 'conversationId')
    ..aOS(3, _omitFieldNames ? '' : 'agentId')
    ..aOS(4, _omitFieldNames ? '' : 'userInput')
    ..aOS(5, _omitFieldNames ? '' : 'finalResponse')
    ..aI(6, _omitFieldNames ? '' : 'toolIterations')
    ..aE<TurnStatus>(7, _omitFieldNames ? '' : 'status',
        enumValues: TurnStatus.values)
    ..aOM<$0.Timestamp>(8, _omitFieldNames ? '' : 'startedAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(9, _omitFieldNames ? '' : 'endedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Turn clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Turn copyWith(void Function(Turn) updates) =>
      super.copyWith((message) => updates(message as Turn)) as Turn;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Turn create() => Turn._();
  @$core.override
  Turn createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Turn getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Turn>(create);
  static Turn? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get turnId => $_getSZ(0);
  @$pb.TagNumber(1)
  set turnId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTurnId() => $_has(0);
  @$pb.TagNumber(1)
  void clearTurnId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get conversationId => $_getSZ(1);
  @$pb.TagNumber(2)
  set conversationId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasConversationId() => $_has(1);
  @$pb.TagNumber(2)
  void clearConversationId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get agentId => $_getSZ(2);
  @$pb.TagNumber(3)
  set agentId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasAgentId() => $_has(2);
  @$pb.TagNumber(3)
  void clearAgentId() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get userInput => $_getSZ(3);
  @$pb.TagNumber(4)
  set userInput($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasUserInput() => $_has(3);
  @$pb.TagNumber(4)
  void clearUserInput() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get finalResponse => $_getSZ(4);
  @$pb.TagNumber(5)
  set finalResponse($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasFinalResponse() => $_has(4);
  @$pb.TagNumber(5)
  void clearFinalResponse() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.int get toolIterations => $_getIZ(5);
  @$pb.TagNumber(6)
  set toolIterations($core.int value) => $_setSignedInt32(5, value);
  @$pb.TagNumber(6)
  $core.bool hasToolIterations() => $_has(5);
  @$pb.TagNumber(6)
  void clearToolIterations() => $_clearField(6);

  @$pb.TagNumber(7)
  TurnStatus get status => $_getN(6);
  @$pb.TagNumber(7)
  set status(TurnStatus value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasStatus() => $_has(6);
  @$pb.TagNumber(7)
  void clearStatus() => $_clearField(7);

  @$pb.TagNumber(8)
  $0.Timestamp get startedAt => $_getN(7);
  @$pb.TagNumber(8)
  set startedAt($0.Timestamp value) => $_setField(8, value);
  @$pb.TagNumber(8)
  $core.bool hasStartedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearStartedAt() => $_clearField(8);
  @$pb.TagNumber(8)
  $0.Timestamp ensureStartedAt() => $_ensure(7);

  @$pb.TagNumber(9)
  $0.Timestamp get endedAt => $_getN(8);
  @$pb.TagNumber(9)
  set endedAt($0.Timestamp value) => $_setField(9, value);
  @$pb.TagNumber(9)
  $core.bool hasEndedAt() => $_has(8);
  @$pb.TagNumber(9)
  void clearEndedAt() => $_clearField(9);
  @$pb.TagNumber(9)
  $0.Timestamp ensureEndedAt() => $_ensure(8);
}

class ToolCallRecord extends $pb.GeneratedMessage {
  factory ToolCallRecord({
    $core.String? toolName,
    $core.String? arguments,
    $core.String? result,
    $fixnum.Int64? durationMs,
  }) {
    final result$ = create();
    if (toolName != null) result$.toolName = toolName;
    if (arguments != null) result$.arguments = arguments;
    if (result != null) result$.result = result;
    if (durationMs != null) result$.durationMs = durationMs;
    return result$;
  }

  ToolCallRecord._();

  factory ToolCallRecord.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ToolCallRecord.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ToolCallRecord',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'toolName')
    ..aOS(2, _omitFieldNames ? '' : 'arguments')
    ..aOS(3, _omitFieldNames ? '' : 'result')
    ..aInt64(4, _omitFieldNames ? '' : 'durationMs')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ToolCallRecord clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ToolCallRecord copyWith(void Function(ToolCallRecord) updates) =>
      super.copyWith((message) => updates(message as ToolCallRecord))
          as ToolCallRecord;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ToolCallRecord create() => ToolCallRecord._();
  @$core.override
  ToolCallRecord createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ToolCallRecord getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ToolCallRecord>(create);
  static ToolCallRecord? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get toolName => $_getSZ(0);
  @$pb.TagNumber(1)
  set toolName($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasToolName() => $_has(0);
  @$pb.TagNumber(1)
  void clearToolName() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get arguments => $_getSZ(1);
  @$pb.TagNumber(2)
  set arguments($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasArguments() => $_has(1);
  @$pb.TagNumber(2)
  void clearArguments() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get result => $_getSZ(2);
  @$pb.TagNumber(3)
  set result($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasResult() => $_has(2);
  @$pb.TagNumber(3)
  void clearResult() => $_clearField(3);

  @$pb.TagNumber(4)
  $fixnum.Int64 get durationMs => $_getI64(3);
  @$pb.TagNumber(4)
  set durationMs($fixnum.Int64 value) => $_setInt64(3, value);
  @$pb.TagNumber(4)
  $core.bool hasDurationMs() => $_has(3);
  @$pb.TagNumber(4)
  void clearDurationMs() => $_clearField(4);
}

class ProviderCallRecord extends $pb.GeneratedMessage {
  factory ProviderCallRecord({
    $core.String? provider,
    $core.String? model,
    $core.int? inputTokens,
    $core.int? outputTokens,
    $fixnum.Int64? latencyMs,
    $core.bool? cacheHit,
    $core.String? credentialId,
  }) {
    final result = create();
    if (provider != null) result.provider = provider;
    if (model != null) result.model = model;
    if (inputTokens != null) result.inputTokens = inputTokens;
    if (outputTokens != null) result.outputTokens = outputTokens;
    if (latencyMs != null) result.latencyMs = latencyMs;
    if (cacheHit != null) result.cacheHit = cacheHit;
    if (credentialId != null) result.credentialId = credentialId;
    return result;
  }

  ProviderCallRecord._();

  factory ProviderCallRecord.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ProviderCallRecord.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ProviderCallRecord',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'provider')
    ..aOS(2, _omitFieldNames ? '' : 'model')
    ..aI(3, _omitFieldNames ? '' : 'inputTokens')
    ..aI(4, _omitFieldNames ? '' : 'outputTokens')
    ..aInt64(5, _omitFieldNames ? '' : 'latencyMs')
    ..aOB(6, _omitFieldNames ? '' : 'cacheHit')
    ..aOS(7, _omitFieldNames ? '' : 'credentialId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProviderCallRecord clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProviderCallRecord copyWith(void Function(ProviderCallRecord) updates) =>
      super.copyWith((message) => updates(message as ProviderCallRecord))
          as ProviderCallRecord;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ProviderCallRecord create() => ProviderCallRecord._();
  @$core.override
  ProviderCallRecord createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ProviderCallRecord getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ProviderCallRecord>(create);
  static ProviderCallRecord? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get provider => $_getSZ(0);
  @$pb.TagNumber(1)
  set provider($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasProvider() => $_has(0);
  @$pb.TagNumber(1)
  void clearProvider() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get model => $_getSZ(1);
  @$pb.TagNumber(2)
  set model($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasModel() => $_has(1);
  @$pb.TagNumber(2)
  void clearModel() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get inputTokens => $_getIZ(2);
  @$pb.TagNumber(3)
  set inputTokens($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasInputTokens() => $_has(2);
  @$pb.TagNumber(3)
  void clearInputTokens() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get outputTokens => $_getIZ(3);
  @$pb.TagNumber(4)
  set outputTokens($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasOutputTokens() => $_has(3);
  @$pb.TagNumber(4)
  void clearOutputTokens() => $_clearField(4);

  @$pb.TagNumber(5)
  $fixnum.Int64 get latencyMs => $_getI64(4);
  @$pb.TagNumber(5)
  set latencyMs($fixnum.Int64 value) => $_setInt64(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLatencyMs() => $_has(4);
  @$pb.TagNumber(5)
  void clearLatencyMs() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.bool get cacheHit => $_getBF(5);
  @$pb.TagNumber(6)
  set cacheHit($core.bool value) => $_setBool(5, value);
  @$pb.TagNumber(6)
  $core.bool hasCacheHit() => $_has(5);
  @$pb.TagNumber(6)
  void clearCacheHit() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get credentialId => $_getSZ(6);
  @$pb.TagNumber(7)
  set credentialId($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasCredentialId() => $_has(6);
  @$pb.TagNumber(7)
  void clearCredentialId() => $_clearField(7);
}

class TurnTrace extends $pb.GeneratedMessage {
  factory TurnTrace({
    $core.String? traceId,
    $core.String? turnId,
    $core.String? systemPromptHash,
    $core.String? memorySnapshotHash,
    $core.String? skillIndexHash,
    $core.Iterable<$core.String>? skillsLoaded,
    $core.Iterable<ToolCallRecord>? toolCalls,
    $core.Iterable<ProviderCallRecord>? providerCalls,
    $core.bool? reviewTriggered,
    $core.Iterable<ClassifiedErrorEvent>? errorsClassified,
    CompressionEvent? compressionEvent,
    $core.Iterable<DelegationResult>? delegationResults,
  }) {
    final result = create();
    if (traceId != null) result.traceId = traceId;
    if (turnId != null) result.turnId = turnId;
    if (systemPromptHash != null) result.systemPromptHash = systemPromptHash;
    if (memorySnapshotHash != null)
      result.memorySnapshotHash = memorySnapshotHash;
    if (skillIndexHash != null) result.skillIndexHash = skillIndexHash;
    if (skillsLoaded != null) result.skillsLoaded.addAll(skillsLoaded);
    if (toolCalls != null) result.toolCalls.addAll(toolCalls);
    if (providerCalls != null) result.providerCalls.addAll(providerCalls);
    if (reviewTriggered != null) result.reviewTriggered = reviewTriggered;
    if (errorsClassified != null)
      result.errorsClassified.addAll(errorsClassified);
    if (compressionEvent != null) result.compressionEvent = compressionEvent;
    if (delegationResults != null)
      result.delegationResults.addAll(delegationResults);
    return result;
  }

  TurnTrace._();

  factory TurnTrace.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory TurnTrace.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TurnTrace',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'traceId')
    ..aOS(2, _omitFieldNames ? '' : 'turnId')
    ..aOS(3, _omitFieldNames ? '' : 'systemPromptHash')
    ..aOS(4, _omitFieldNames ? '' : 'memorySnapshotHash')
    ..aOS(5, _omitFieldNames ? '' : 'skillIndexHash')
    ..pPS(6, _omitFieldNames ? '' : 'skillsLoaded')
    ..pPM<ToolCallRecord>(7, _omitFieldNames ? '' : 'toolCalls',
        subBuilder: ToolCallRecord.create)
    ..pPM<ProviderCallRecord>(8, _omitFieldNames ? '' : 'providerCalls',
        subBuilder: ProviderCallRecord.create)
    ..aOB(9, _omitFieldNames ? '' : 'reviewTriggered')
    ..pPM<ClassifiedErrorEvent>(10, _omitFieldNames ? '' : 'errorsClassified',
        subBuilder: ClassifiedErrorEvent.create)
    ..aOM<CompressionEvent>(11, _omitFieldNames ? '' : 'compressionEvent',
        subBuilder: CompressionEvent.create)
    ..pPM<DelegationResult>(12, _omitFieldNames ? '' : 'delegationResults',
        subBuilder: DelegationResult.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TurnTrace clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TurnTrace copyWith(void Function(TurnTrace) updates) =>
      super.copyWith((message) => updates(message as TurnTrace)) as TurnTrace;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static TurnTrace create() => TurnTrace._();
  @$core.override
  TurnTrace createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static TurnTrace getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<TurnTrace>(create);
  static TurnTrace? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get traceId => $_getSZ(0);
  @$pb.TagNumber(1)
  set traceId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTraceId() => $_has(0);
  @$pb.TagNumber(1)
  void clearTraceId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get turnId => $_getSZ(1);
  @$pb.TagNumber(2)
  set turnId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTurnId() => $_has(1);
  @$pb.TagNumber(2)
  void clearTurnId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get systemPromptHash => $_getSZ(2);
  @$pb.TagNumber(3)
  set systemPromptHash($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSystemPromptHash() => $_has(2);
  @$pb.TagNumber(3)
  void clearSystemPromptHash() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get memorySnapshotHash => $_getSZ(3);
  @$pb.TagNumber(4)
  set memorySnapshotHash($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasMemorySnapshotHash() => $_has(3);
  @$pb.TagNumber(4)
  void clearMemorySnapshotHash() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get skillIndexHash => $_getSZ(4);
  @$pb.TagNumber(5)
  set skillIndexHash($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasSkillIndexHash() => $_has(4);
  @$pb.TagNumber(5)
  void clearSkillIndexHash() => $_clearField(5);

  @$pb.TagNumber(6)
  $pb.PbList<$core.String> get skillsLoaded => $_getList(5);

  @$pb.TagNumber(7)
  $pb.PbList<ToolCallRecord> get toolCalls => $_getList(6);

  @$pb.TagNumber(8)
  $pb.PbList<ProviderCallRecord> get providerCalls => $_getList(7);

  @$pb.TagNumber(9)
  $core.bool get reviewTriggered => $_getBF(8);
  @$pb.TagNumber(9)
  set reviewTriggered($core.bool value) => $_setBool(8, value);
  @$pb.TagNumber(9)
  $core.bool hasReviewTriggered() => $_has(8);
  @$pb.TagNumber(9)
  void clearReviewTriggered() => $_clearField(9);

  @$pb.TagNumber(10)
  $pb.PbList<ClassifiedErrorEvent> get errorsClassified => $_getList(9);

  @$pb.TagNumber(11)
  CompressionEvent get compressionEvent => $_getN(10);
  @$pb.TagNumber(11)
  set compressionEvent(CompressionEvent value) => $_setField(11, value);
  @$pb.TagNumber(11)
  $core.bool hasCompressionEvent() => $_has(10);
  @$pb.TagNumber(11)
  void clearCompressionEvent() => $_clearField(11);
  @$pb.TagNumber(11)
  CompressionEvent ensureCompressionEvent() => $_ensure(10);

  @$pb.TagNumber(12)
  $pb.PbList<DelegationResult> get delegationResults => $_getList(11);
}

class ClassifiedErrorEvent extends $pb.GeneratedMessage {
  factory ClassifiedErrorEvent({
    FailoverReason? reason,
    $core.bool? retryable,
    $core.bool? shouldCompress,
    $core.bool? shouldRotateCredential,
    $core.bool? shouldFallback,
    $core.String? provider,
    $core.String? model,
    $core.int? httpStatus,
    $core.String? errorCode,
    $core.String? errorMessage,
    $0.Timestamp? classifiedAt,
  }) {
    final result = create();
    if (reason != null) result.reason = reason;
    if (retryable != null) result.retryable = retryable;
    if (shouldCompress != null) result.shouldCompress = shouldCompress;
    if (shouldRotateCredential != null)
      result.shouldRotateCredential = shouldRotateCredential;
    if (shouldFallback != null) result.shouldFallback = shouldFallback;
    if (provider != null) result.provider = provider;
    if (model != null) result.model = model;
    if (httpStatus != null) result.httpStatus = httpStatus;
    if (errorCode != null) result.errorCode = errorCode;
    if (errorMessage != null) result.errorMessage = errorMessage;
    if (classifiedAt != null) result.classifiedAt = classifiedAt;
    return result;
  }

  ClassifiedErrorEvent._();

  factory ClassifiedErrorEvent.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ClassifiedErrorEvent.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ClassifiedErrorEvent',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aE<FailoverReason>(1, _omitFieldNames ? '' : 'reason',
        enumValues: FailoverReason.values)
    ..aOB(2, _omitFieldNames ? '' : 'retryable')
    ..aOB(3, _omitFieldNames ? '' : 'shouldCompress')
    ..aOB(4, _omitFieldNames ? '' : 'shouldRotateCredential')
    ..aOB(5, _omitFieldNames ? '' : 'shouldFallback')
    ..aOS(6, _omitFieldNames ? '' : 'provider')
    ..aOS(7, _omitFieldNames ? '' : 'model')
    ..aI(8, _omitFieldNames ? '' : 'httpStatus')
    ..aOS(9, _omitFieldNames ? '' : 'errorCode')
    ..aOS(10, _omitFieldNames ? '' : 'errorMessage')
    ..aOM<$0.Timestamp>(11, _omitFieldNames ? '' : 'classifiedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ClassifiedErrorEvent clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ClassifiedErrorEvent copyWith(void Function(ClassifiedErrorEvent) updates) =>
      super.copyWith((message) => updates(message as ClassifiedErrorEvent))
          as ClassifiedErrorEvent;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ClassifiedErrorEvent create() => ClassifiedErrorEvent._();
  @$core.override
  ClassifiedErrorEvent createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ClassifiedErrorEvent getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ClassifiedErrorEvent>(create);
  static ClassifiedErrorEvent? _defaultInstance;

  @$pb.TagNumber(1)
  FailoverReason get reason => $_getN(0);
  @$pb.TagNumber(1)
  set reason(FailoverReason value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasReason() => $_has(0);
  @$pb.TagNumber(1)
  void clearReason() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.bool get retryable => $_getBF(1);
  @$pb.TagNumber(2)
  set retryable($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasRetryable() => $_has(1);
  @$pb.TagNumber(2)
  void clearRetryable() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.bool get shouldCompress => $_getBF(2);
  @$pb.TagNumber(3)
  set shouldCompress($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasShouldCompress() => $_has(2);
  @$pb.TagNumber(3)
  void clearShouldCompress() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.bool get shouldRotateCredential => $_getBF(3);
  @$pb.TagNumber(4)
  set shouldRotateCredential($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasShouldRotateCredential() => $_has(3);
  @$pb.TagNumber(4)
  void clearShouldRotateCredential() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.bool get shouldFallback => $_getBF(4);
  @$pb.TagNumber(5)
  set shouldFallback($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasShouldFallback() => $_has(4);
  @$pb.TagNumber(5)
  void clearShouldFallback() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get provider => $_getSZ(5);
  @$pb.TagNumber(6)
  set provider($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasProvider() => $_has(5);
  @$pb.TagNumber(6)
  void clearProvider() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get model => $_getSZ(6);
  @$pb.TagNumber(7)
  set model($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasModel() => $_has(6);
  @$pb.TagNumber(7)
  void clearModel() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.int get httpStatus => $_getIZ(7);
  @$pb.TagNumber(8)
  set httpStatus($core.int value) => $_setSignedInt32(7, value);
  @$pb.TagNumber(8)
  $core.bool hasHttpStatus() => $_has(7);
  @$pb.TagNumber(8)
  void clearHttpStatus() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.String get errorCode => $_getSZ(8);
  @$pb.TagNumber(9)
  set errorCode($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasErrorCode() => $_has(8);
  @$pb.TagNumber(9)
  void clearErrorCode() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.String get errorMessage => $_getSZ(9);
  @$pb.TagNumber(10)
  set errorMessage($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasErrorMessage() => $_has(9);
  @$pb.TagNumber(10)
  void clearErrorMessage() => $_clearField(10);

  @$pb.TagNumber(11)
  $0.Timestamp get classifiedAt => $_getN(10);
  @$pb.TagNumber(11)
  set classifiedAt($0.Timestamp value) => $_setField(11, value);
  @$pb.TagNumber(11)
  $core.bool hasClassifiedAt() => $_has(10);
  @$pb.TagNumber(11)
  void clearClassifiedAt() => $_clearField(11);
  @$pb.TagNumber(11)
  $0.Timestamp ensureClassifiedAt() => $_ensure(10);
}

class CompressionEvent extends $pb.GeneratedMessage {
  factory CompressionEvent({
    $core.bool? triggered,
    $core.int? tokensBefore,
    $core.int? tokensAfter,
    $core.String? newConversationId,
  }) {
    final result = create();
    if (triggered != null) result.triggered = triggered;
    if (tokensBefore != null) result.tokensBefore = tokensBefore;
    if (tokensAfter != null) result.tokensAfter = tokensAfter;
    if (newConversationId != null) result.newConversationId = newConversationId;
    return result;
  }

  CompressionEvent._();

  factory CompressionEvent.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CompressionEvent.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CompressionEvent',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'triggered')
    ..aI(2, _omitFieldNames ? '' : 'tokensBefore')
    ..aI(3, _omitFieldNames ? '' : 'tokensAfter')
    ..aOS(4, _omitFieldNames ? '' : 'newConversationId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CompressionEvent clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CompressionEvent copyWith(void Function(CompressionEvent) updates) =>
      super.copyWith((message) => updates(message as CompressionEvent))
          as CompressionEvent;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CompressionEvent create() => CompressionEvent._();
  @$core.override
  CompressionEvent createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CompressionEvent getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CompressionEvent>(create);
  static CompressionEvent? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get triggered => $_getBF(0);
  @$pb.TagNumber(1)
  set triggered($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTriggered() => $_has(0);
  @$pb.TagNumber(1)
  void clearTriggered() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get tokensBefore => $_getIZ(1);
  @$pb.TagNumber(2)
  set tokensBefore($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTokensBefore() => $_has(1);
  @$pb.TagNumber(2)
  void clearTokensBefore() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get tokensAfter => $_getIZ(2);
  @$pb.TagNumber(3)
  set tokensAfter($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTokensAfter() => $_has(2);
  @$pb.TagNumber(3)
  void clearTokensAfter() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get newConversationId => $_getSZ(3);
  @$pb.TagNumber(4)
  set newConversationId($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasNewConversationId() => $_has(3);
  @$pb.TagNumber(4)
  void clearNewConversationId() => $_clearField(4);
}

class DelegationResult extends $pb.GeneratedMessage {
  factory DelegationResult({
    $core.String? taskId,
    $core.String? parentTurnId,
    $core.String? taskDescription,
    $core.Iterable<$core.String>? childToolset,
    DelegationStatus? status,
    $core.String? resultSummary,
    $core.int? toolIterations,
    $0.Timestamp? startedAt,
    $0.Timestamp? endedAt,
  }) {
    final result = create();
    if (taskId != null) result.taskId = taskId;
    if (parentTurnId != null) result.parentTurnId = parentTurnId;
    if (taskDescription != null) result.taskDescription = taskDescription;
    if (childToolset != null) result.childToolset.addAll(childToolset);
    if (status != null) result.status = status;
    if (resultSummary != null) result.resultSummary = resultSummary;
    if (toolIterations != null) result.toolIterations = toolIterations;
    if (startedAt != null) result.startedAt = startedAt;
    if (endedAt != null) result.endedAt = endedAt;
    return result;
  }

  DelegationResult._();

  factory DelegationResult.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory DelegationResult.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DelegationResult',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'taskId')
    ..aOS(2, _omitFieldNames ? '' : 'parentTurnId')
    ..aOS(3, _omitFieldNames ? '' : 'taskDescription')
    ..pPS(4, _omitFieldNames ? '' : 'childToolset')
    ..aE<DelegationStatus>(5, _omitFieldNames ? '' : 'status',
        enumValues: DelegationStatus.values)
    ..aOS(6, _omitFieldNames ? '' : 'resultSummary')
    ..aI(7, _omitFieldNames ? '' : 'toolIterations')
    ..aOM<$0.Timestamp>(8, _omitFieldNames ? '' : 'startedAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(9, _omitFieldNames ? '' : 'endedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DelegationResult clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DelegationResult copyWith(void Function(DelegationResult) updates) =>
      super.copyWith((message) => updates(message as DelegationResult))
          as DelegationResult;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static DelegationResult create() => DelegationResult._();
  @$core.override
  DelegationResult createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static DelegationResult getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DelegationResult>(create);
  static DelegationResult? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get taskId => $_getSZ(0);
  @$pb.TagNumber(1)
  set taskId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTaskId() => $_has(0);
  @$pb.TagNumber(1)
  void clearTaskId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get parentTurnId => $_getSZ(1);
  @$pb.TagNumber(2)
  set parentTurnId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasParentTurnId() => $_has(1);
  @$pb.TagNumber(2)
  void clearParentTurnId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get taskDescription => $_getSZ(2);
  @$pb.TagNumber(3)
  set taskDescription($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTaskDescription() => $_has(2);
  @$pb.TagNumber(3)
  void clearTaskDescription() => $_clearField(3);

  @$pb.TagNumber(4)
  $pb.PbList<$core.String> get childToolset => $_getList(3);

  @$pb.TagNumber(5)
  DelegationStatus get status => $_getN(4);
  @$pb.TagNumber(5)
  set status(DelegationStatus value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasStatus() => $_has(4);
  @$pb.TagNumber(5)
  void clearStatus() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get resultSummary => $_getSZ(5);
  @$pb.TagNumber(6)
  set resultSummary($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasResultSummary() => $_has(5);
  @$pb.TagNumber(6)
  void clearResultSummary() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.int get toolIterations => $_getIZ(6);
  @$pb.TagNumber(7)
  set toolIterations($core.int value) => $_setSignedInt32(6, value);
  @$pb.TagNumber(7)
  $core.bool hasToolIterations() => $_has(6);
  @$pb.TagNumber(7)
  void clearToolIterations() => $_clearField(7);

  @$pb.TagNumber(8)
  $0.Timestamp get startedAt => $_getN(7);
  @$pb.TagNumber(8)
  set startedAt($0.Timestamp value) => $_setField(8, value);
  @$pb.TagNumber(8)
  $core.bool hasStartedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearStartedAt() => $_clearField(8);
  @$pb.TagNumber(8)
  $0.Timestamp ensureStartedAt() => $_ensure(7);

  @$pb.TagNumber(9)
  $0.Timestamp get endedAt => $_getN(8);
  @$pb.TagNumber(9)
  set endedAt($0.Timestamp value) => $_setField(9, value);
  @$pb.TagNumber(9)
  $core.bool hasEndedAt() => $_has(8);
  @$pb.TagNumber(9)
  void clearEndedAt() => $_clearField(9);
  @$pb.TagNumber(9)
  $0.Timestamp ensureEndedAt() => $_ensure(8);
}

class Conversation extends $pb.GeneratedMessage {
  factory Conversation({
    $core.String? conversationId,
    $core.String? agentId,
    $core.String? userId,
    $core.String? title,
    $core.String? description,
    $core.String? providerId,
    $core.String? modelName,
    $core.String? status,
    $core.String? parentId,
    $core.String? configJson,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? meta,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (conversationId != null) result.conversationId = conversationId;
    if (agentId != null) result.agentId = agentId;
    if (userId != null) result.userId = userId;
    if (title != null) result.title = title;
    if (description != null) result.description = description;
    if (providerId != null) result.providerId = providerId;
    if (modelName != null) result.modelName = modelName;
    if (status != null) result.status = status;
    if (parentId != null) result.parentId = parentId;
    if (configJson != null) result.configJson = configJson;
    if (meta != null) result.meta.addEntries(meta);
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  Conversation._();

  factory Conversation.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Conversation.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Conversation',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'conversationId')
    ..aOS(2, _omitFieldNames ? '' : 'agentId')
    ..aOS(3, _omitFieldNames ? '' : 'userId')
    ..aOS(4, _omitFieldNames ? '' : 'title')
    ..aOS(5, _omitFieldNames ? '' : 'description')
    ..aOS(6, _omitFieldNames ? '' : 'providerId')
    ..aOS(7, _omitFieldNames ? '' : 'modelName')
    ..aOS(8, _omitFieldNames ? '' : 'status')
    ..aOS(9, _omitFieldNames ? '' : 'parentId')
    ..aOS(10, _omitFieldNames ? '' : 'configJson')
    ..m<$core.String, $core.String>(11, _omitFieldNames ? '' : 'meta',
        entryClassName: 'Conversation.MetaEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.model.agent.v1'))
    ..aOM<$0.Timestamp>(12, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(13, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Conversation clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Conversation copyWith(void Function(Conversation) updates) =>
      super.copyWith((message) => updates(message as Conversation))
          as Conversation;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Conversation create() => Conversation._();
  @$core.override
  Conversation createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Conversation getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Conversation>(create);
  static Conversation? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get conversationId => $_getSZ(0);
  @$pb.TagNumber(1)
  set conversationId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConversationId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConversationId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get agentId => $_getSZ(1);
  @$pb.TagNumber(2)
  set agentId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasAgentId() => $_has(1);
  @$pb.TagNumber(2)
  void clearAgentId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get userId => $_getSZ(2);
  @$pb.TagNumber(3)
  set userId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasUserId() => $_has(2);
  @$pb.TagNumber(3)
  void clearUserId() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get title => $_getSZ(3);
  @$pb.TagNumber(4)
  set title($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasTitle() => $_has(3);
  @$pb.TagNumber(4)
  void clearTitle() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get description => $_getSZ(4);
  @$pb.TagNumber(5)
  set description($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasDescription() => $_has(4);
  @$pb.TagNumber(5)
  void clearDescription() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get providerId => $_getSZ(5);
  @$pb.TagNumber(6)
  set providerId($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasProviderId() => $_has(5);
  @$pb.TagNumber(6)
  void clearProviderId() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get modelName => $_getSZ(6);
  @$pb.TagNumber(7)
  set modelName($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasModelName() => $_has(6);
  @$pb.TagNumber(7)
  void clearModelName() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get status => $_getSZ(7);
  @$pb.TagNumber(8)
  set status($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasStatus() => $_has(7);
  @$pb.TagNumber(8)
  void clearStatus() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.String get parentId => $_getSZ(8);
  @$pb.TagNumber(9)
  set parentId($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasParentId() => $_has(8);
  @$pb.TagNumber(9)
  void clearParentId() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.String get configJson => $_getSZ(9);
  @$pb.TagNumber(10)
  set configJson($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasConfigJson() => $_has(9);
  @$pb.TagNumber(10)
  void clearConfigJson() => $_clearField(10);

  @$pb.TagNumber(11)
  $pb.PbMap<$core.String, $core.String> get meta => $_getMap(10);

  @$pb.TagNumber(12)
  $0.Timestamp get createdAt => $_getN(11);
  @$pb.TagNumber(12)
  set createdAt($0.Timestamp value) => $_setField(12, value);
  @$pb.TagNumber(12)
  $core.bool hasCreatedAt() => $_has(11);
  @$pb.TagNumber(12)
  void clearCreatedAt() => $_clearField(12);
  @$pb.TagNumber(12)
  $0.Timestamp ensureCreatedAt() => $_ensure(11);

  @$pb.TagNumber(13)
  $0.Timestamp get updatedAt => $_getN(12);
  @$pb.TagNumber(13)
  set updatedAt($0.Timestamp value) => $_setField(13, value);
  @$pb.TagNumber(13)
  $core.bool hasUpdatedAt() => $_has(12);
  @$pb.TagNumber(13)
  void clearUpdatedAt() => $_clearField(13);
  @$pb.TagNumber(13)
  $0.Timestamp ensureUpdatedAt() => $_ensure(12);
}

class AgentMessage extends $pb.GeneratedMessage {
  factory AgentMessage({
    $core.String? messageId,
    $core.String? conversationId,
    $core.String? turnId,
    $core.String? modelName,
    MessageRole? role,
    $core.String? content,
    $core.String? reasoningJson,
    $core.String? toolCallsJson,
    $core.String? metadataJson,
    $core.String? errorJson,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (messageId != null) result.messageId = messageId;
    if (conversationId != null) result.conversationId = conversationId;
    if (turnId != null) result.turnId = turnId;
    if (modelName != null) result.modelName = modelName;
    if (role != null) result.role = role;
    if (content != null) result.content = content;
    if (reasoningJson != null) result.reasoningJson = reasoningJson;
    if (toolCallsJson != null) result.toolCallsJson = toolCallsJson;
    if (metadataJson != null) result.metadataJson = metadataJson;
    if (errorJson != null) result.errorJson = errorJson;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  AgentMessage._();

  factory AgentMessage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory AgentMessage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AgentMessage',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'messageId')
    ..aOS(2, _omitFieldNames ? '' : 'conversationId')
    ..aOS(3, _omitFieldNames ? '' : 'turnId')
    ..aOS(4, _omitFieldNames ? '' : 'modelName')
    ..aE<MessageRole>(5, _omitFieldNames ? '' : 'role',
        enumValues: MessageRole.values)
    ..aOS(6, _omitFieldNames ? '' : 'content')
    ..aOS(7, _omitFieldNames ? '' : 'reasoningJson')
    ..aOS(8, _omitFieldNames ? '' : 'toolCallsJson')
    ..aOS(9, _omitFieldNames ? '' : 'metadataJson')
    ..aOS(10, _omitFieldNames ? '' : 'errorJson')
    ..aOM<$0.Timestamp>(11, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(12, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AgentMessage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AgentMessage copyWith(void Function(AgentMessage) updates) =>
      super.copyWith((message) => updates(message as AgentMessage))
          as AgentMessage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AgentMessage create() => AgentMessage._();
  @$core.override
  AgentMessage createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static AgentMessage getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AgentMessage>(create);
  static AgentMessage? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get messageId => $_getSZ(0);
  @$pb.TagNumber(1)
  set messageId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasMessageId() => $_has(0);
  @$pb.TagNumber(1)
  void clearMessageId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get conversationId => $_getSZ(1);
  @$pb.TagNumber(2)
  set conversationId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasConversationId() => $_has(1);
  @$pb.TagNumber(2)
  void clearConversationId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get turnId => $_getSZ(2);
  @$pb.TagNumber(3)
  set turnId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTurnId() => $_has(2);
  @$pb.TagNumber(3)
  void clearTurnId() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get modelName => $_getSZ(3);
  @$pb.TagNumber(4)
  set modelName($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasModelName() => $_has(3);
  @$pb.TagNumber(4)
  void clearModelName() => $_clearField(4);

  @$pb.TagNumber(5)
  MessageRole get role => $_getN(4);
  @$pb.TagNumber(5)
  set role(MessageRole value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasRole() => $_has(4);
  @$pb.TagNumber(5)
  void clearRole() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get content => $_getSZ(5);
  @$pb.TagNumber(6)
  set content($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasContent() => $_has(5);
  @$pb.TagNumber(6)
  void clearContent() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get reasoningJson => $_getSZ(6);
  @$pb.TagNumber(7)
  set reasoningJson($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasReasoningJson() => $_has(6);
  @$pb.TagNumber(7)
  void clearReasoningJson() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get toolCallsJson => $_getSZ(7);
  @$pb.TagNumber(8)
  set toolCallsJson($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasToolCallsJson() => $_has(7);
  @$pb.TagNumber(8)
  void clearToolCallsJson() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.String get metadataJson => $_getSZ(8);
  @$pb.TagNumber(9)
  set metadataJson($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasMetadataJson() => $_has(8);
  @$pb.TagNumber(9)
  void clearMetadataJson() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.String get errorJson => $_getSZ(9);
  @$pb.TagNumber(10)
  set errorJson($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasErrorJson() => $_has(9);
  @$pb.TagNumber(10)
  void clearErrorJson() => $_clearField(10);

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

class ExecuteTurnRequest extends $pb.GeneratedMessage {
  factory ExecuteTurnRequest({
    $core.String? conversationId,
    $core.String? agentId,
    $core.String? userInput,
    $core.bool? stream,
    $core.String? modelOverride,
    $core.String? providerOverride,
  }) {
    final result = create();
    if (conversationId != null) result.conversationId = conversationId;
    if (agentId != null) result.agentId = agentId;
    if (userInput != null) result.userInput = userInput;
    if (stream != null) result.stream = stream;
    if (modelOverride != null) result.modelOverride = modelOverride;
    if (providerOverride != null) result.providerOverride = providerOverride;
    return result;
  }

  ExecuteTurnRequest._();

  factory ExecuteTurnRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ExecuteTurnRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ExecuteTurnRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'conversationId')
    ..aOS(2, _omitFieldNames ? '' : 'agentId')
    ..aOS(3, _omitFieldNames ? '' : 'userInput')
    ..aOB(4, _omitFieldNames ? '' : 'stream')
    ..aOS(5, _omitFieldNames ? '' : 'modelOverride')
    ..aOS(6, _omitFieldNames ? '' : 'providerOverride')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ExecuteTurnRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ExecuteTurnRequest copyWith(void Function(ExecuteTurnRequest) updates) =>
      super.copyWith((message) => updates(message as ExecuteTurnRequest))
          as ExecuteTurnRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ExecuteTurnRequest create() => ExecuteTurnRequest._();
  @$core.override
  ExecuteTurnRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ExecuteTurnRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ExecuteTurnRequest>(create);
  static ExecuteTurnRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get conversationId => $_getSZ(0);
  @$pb.TagNumber(1)
  set conversationId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConversationId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConversationId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get agentId => $_getSZ(1);
  @$pb.TagNumber(2)
  set agentId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasAgentId() => $_has(1);
  @$pb.TagNumber(2)
  void clearAgentId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get userInput => $_getSZ(2);
  @$pb.TagNumber(3)
  set userInput($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasUserInput() => $_has(2);
  @$pb.TagNumber(3)
  void clearUserInput() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.bool get stream => $_getBF(3);
  @$pb.TagNumber(4)
  set stream($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasStream() => $_has(3);
  @$pb.TagNumber(4)
  void clearStream() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get modelOverride => $_getSZ(4);
  @$pb.TagNumber(5)
  set modelOverride($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasModelOverride() => $_has(4);
  @$pb.TagNumber(5)
  void clearModelOverride() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get providerOverride => $_getSZ(5);
  @$pb.TagNumber(6)
  set providerOverride($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasProviderOverride() => $_has(5);
  @$pb.TagNumber(6)
  void clearProviderOverride() => $_clearField(6);
}

class ExecuteTurnResponse extends $pb.GeneratedMessage {
  factory ExecuteTurnResponse({
    Turn? turn,
    TurnTrace? trace,
    AgentMessage? responseMessage,
  }) {
    final result = create();
    if (turn != null) result.turn = turn;
    if (trace != null) result.trace = trace;
    if (responseMessage != null) result.responseMessage = responseMessage;
    return result;
  }

  ExecuteTurnResponse._();

  factory ExecuteTurnResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ExecuteTurnResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ExecuteTurnResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOM<Turn>(1, _omitFieldNames ? '' : 'turn', subBuilder: Turn.create)
    ..aOM<TurnTrace>(2, _omitFieldNames ? '' : 'trace',
        subBuilder: TurnTrace.create)
    ..aOM<AgentMessage>(3, _omitFieldNames ? '' : 'responseMessage',
        subBuilder: AgentMessage.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ExecuteTurnResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ExecuteTurnResponse copyWith(void Function(ExecuteTurnResponse) updates) =>
      super.copyWith((message) => updates(message as ExecuteTurnResponse))
          as ExecuteTurnResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ExecuteTurnResponse create() => ExecuteTurnResponse._();
  @$core.override
  ExecuteTurnResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ExecuteTurnResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ExecuteTurnResponse>(create);
  static ExecuteTurnResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Turn get turn => $_getN(0);
  @$pb.TagNumber(1)
  set turn(Turn value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTurn() => $_has(0);
  @$pb.TagNumber(1)
  void clearTurn() => $_clearField(1);
  @$pb.TagNumber(1)
  Turn ensureTurn() => $_ensure(0);

  @$pb.TagNumber(2)
  TurnTrace get trace => $_getN(1);
  @$pb.TagNumber(2)
  set trace(TurnTrace value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasTrace() => $_has(1);
  @$pb.TagNumber(2)
  void clearTrace() => $_clearField(2);
  @$pb.TagNumber(2)
  TurnTrace ensureTrace() => $_ensure(1);

  @$pb.TagNumber(3)
  AgentMessage get responseMessage => $_getN(2);
  @$pb.TagNumber(3)
  set responseMessage(AgentMessage value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasResponseMessage() => $_has(2);
  @$pb.TagNumber(3)
  void clearResponseMessage() => $_clearField(3);
  @$pb.TagNumber(3)
  AgentMessage ensureResponseMessage() => $_ensure(2);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
