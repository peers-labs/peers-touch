// This is a generated file - do not edit.
//
// Generated from domain/agent/memory.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart'
    as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class MemoryItem extends $pb.GeneratedMessage {
  factory MemoryItem({
    $core.String? memoryId,
    $core.String? agentId,
    $core.String? target,
    $core.String? content,
    $core.String? sourceTurnId,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (memoryId != null) result.memoryId = memoryId;
    if (agentId != null) result.agentId = agentId;
    if (target != null) result.target = target;
    if (content != null) result.content = content;
    if (sourceTurnId != null) result.sourceTurnId = sourceTurnId;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  MemoryItem._();

  factory MemoryItem.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MemoryItem.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MemoryItem',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'memoryId')
    ..aOS(2, _omitFieldNames ? '' : 'agentId')
    ..aOS(3, _omitFieldNames ? '' : 'target')
    ..aOS(4, _omitFieldNames ? '' : 'content')
    ..aOS(5, _omitFieldNames ? '' : 'sourceTurnId')
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(7, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MemoryItem clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MemoryItem copyWith(void Function(MemoryItem) updates) =>
      super.copyWith((message) => updates(message as MemoryItem)) as MemoryItem;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MemoryItem create() => MemoryItem._();
  @$core.override
  MemoryItem createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MemoryItem getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MemoryItem>(create);
  static MemoryItem? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get memoryId => $_getSZ(0);
  @$pb.TagNumber(1)
  set memoryId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasMemoryId() => $_has(0);
  @$pb.TagNumber(1)
  void clearMemoryId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get agentId => $_getSZ(1);
  @$pb.TagNumber(2)
  set agentId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasAgentId() => $_has(1);
  @$pb.TagNumber(2)
  void clearAgentId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get target => $_getSZ(2);
  @$pb.TagNumber(3)
  set target($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTarget() => $_has(2);
  @$pb.TagNumber(3)
  void clearTarget() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get content => $_getSZ(3);
  @$pb.TagNumber(4)
  set content($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasContent() => $_has(3);
  @$pb.TagNumber(4)
  void clearContent() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get sourceTurnId => $_getSZ(4);
  @$pb.TagNumber(5)
  set sourceTurnId($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasSourceTurnId() => $_has(4);
  @$pb.TagNumber(5)
  void clearSourceTurnId() => $_clearField(5);

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

  @$pb.TagNumber(7)
  $0.Timestamp get updatedAt => $_getN(6);
  @$pb.TagNumber(7)
  set updatedAt($0.Timestamp value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasUpdatedAt() => $_has(6);
  @$pb.TagNumber(7)
  void clearUpdatedAt() => $_clearField(7);
  @$pb.TagNumber(7)
  $0.Timestamp ensureUpdatedAt() => $_ensure(6);
}

class MemorySnapshot extends $pb.GeneratedMessage {
  factory MemorySnapshot({
    $core.String? agentId,
    $core.String? memoryContent,
    $core.String? userContent,
    $0.Timestamp? capturedAt,
  }) {
    final result = create();
    if (agentId != null) result.agentId = agentId;
    if (memoryContent != null) result.memoryContent = memoryContent;
    if (userContent != null) result.userContent = userContent;
    if (capturedAt != null) result.capturedAt = capturedAt;
    return result;
  }

  MemorySnapshot._();

  factory MemorySnapshot.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory MemorySnapshot.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MemorySnapshot',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'agentId')
    ..aOS(2, _omitFieldNames ? '' : 'memoryContent')
    ..aOS(3, _omitFieldNames ? '' : 'userContent')
    ..aOM<$0.Timestamp>(4, _omitFieldNames ? '' : 'capturedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MemorySnapshot clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MemorySnapshot copyWith(void Function(MemorySnapshot) updates) =>
      super.copyWith((message) => updates(message as MemorySnapshot))
          as MemorySnapshot;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static MemorySnapshot create() => MemorySnapshot._();
  @$core.override
  MemorySnapshot createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static MemorySnapshot getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MemorySnapshot>(create);
  static MemorySnapshot? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get agentId => $_getSZ(0);
  @$pb.TagNumber(1)
  set agentId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAgentId() => $_has(0);
  @$pb.TagNumber(1)
  void clearAgentId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get memoryContent => $_getSZ(1);
  @$pb.TagNumber(2)
  set memoryContent($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasMemoryContent() => $_has(1);
  @$pb.TagNumber(2)
  void clearMemoryContent() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get userContent => $_getSZ(2);
  @$pb.TagNumber(3)
  set userContent($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasUserContent() => $_has(2);
  @$pb.TagNumber(3)
  void clearUserContent() => $_clearField(3);

  @$pb.TagNumber(4)
  $0.Timestamp get capturedAt => $_getN(3);
  @$pb.TagNumber(4)
  set capturedAt($0.Timestamp value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasCapturedAt() => $_has(3);
  @$pb.TagNumber(4)
  void clearCapturedAt() => $_clearField(4);
  @$pb.TagNumber(4)
  $0.Timestamp ensureCapturedAt() => $_ensure(3);
}

class ListMemoriesRequest extends $pb.GeneratedMessage {
  factory ListMemoriesRequest({
    $core.String? agentId,
    $core.String? target,
  }) {
    final result = create();
    if (agentId != null) result.agentId = agentId;
    if (target != null) result.target = target;
    return result;
  }

  ListMemoriesRequest._();

  factory ListMemoriesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListMemoriesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMemoriesRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'agentId')
    ..aOS(2, _omitFieldNames ? '' : 'target')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMemoriesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMemoriesRequest copyWith(void Function(ListMemoriesRequest) updates) =>
      super.copyWith((message) => updates(message as ListMemoriesRequest))
          as ListMemoriesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListMemoriesRequest create() => ListMemoriesRequest._();
  @$core.override
  ListMemoriesRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListMemoriesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMemoriesRequest>(create);
  static ListMemoriesRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get agentId => $_getSZ(0);
  @$pb.TagNumber(1)
  set agentId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAgentId() => $_has(0);
  @$pb.TagNumber(1)
  void clearAgentId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get target => $_getSZ(1);
  @$pb.TagNumber(2)
  set target($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTarget() => $_has(1);
  @$pb.TagNumber(2)
  void clearTarget() => $_clearField(2);
}

class ListMemoriesResponse extends $pb.GeneratedMessage {
  factory ListMemoriesResponse({
    $core.Iterable<MemoryItem>? items,
  }) {
    final result = create();
    if (items != null) result.items.addAll(items);
    return result;
  }

  ListMemoriesResponse._();

  factory ListMemoriesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListMemoriesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMemoriesResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..pPM<MemoryItem>(1, _omitFieldNames ? '' : 'items',
        subBuilder: MemoryItem.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMemoriesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMemoriesResponse copyWith(void Function(ListMemoriesResponse) updates) =>
      super.copyWith((message) => updates(message as ListMemoriesResponse))
          as ListMemoriesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListMemoriesResponse create() => ListMemoriesResponse._();
  @$core.override
  ListMemoriesResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListMemoriesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMemoriesResponse>(create);
  static ListMemoriesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<MemoryItem> get items => $_getList(0);
}

class GetMemorySnapshotRequest extends $pb.GeneratedMessage {
  factory GetMemorySnapshotRequest({
    $core.String? agentId,
  }) {
    final result = create();
    if (agentId != null) result.agentId = agentId;
    return result;
  }

  GetMemorySnapshotRequest._();

  factory GetMemorySnapshotRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetMemorySnapshotRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMemorySnapshotRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'agentId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMemorySnapshotRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMemorySnapshotRequest copyWith(
          void Function(GetMemorySnapshotRequest) updates) =>
      super.copyWith((message) => updates(message as GetMemorySnapshotRequest))
          as GetMemorySnapshotRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetMemorySnapshotRequest create() => GetMemorySnapshotRequest._();
  @$core.override
  GetMemorySnapshotRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetMemorySnapshotRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMemorySnapshotRequest>(create);
  static GetMemorySnapshotRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get agentId => $_getSZ(0);
  @$pb.TagNumber(1)
  set agentId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAgentId() => $_has(0);
  @$pb.TagNumber(1)
  void clearAgentId() => $_clearField(1);
}

class GetMemorySnapshotResponse extends $pb.GeneratedMessage {
  factory GetMemorySnapshotResponse({
    MemorySnapshot? snapshot,
  }) {
    final result = create();
    if (snapshot != null) result.snapshot = snapshot;
    return result;
  }

  GetMemorySnapshotResponse._();

  factory GetMemorySnapshotResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetMemorySnapshotResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMemorySnapshotResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOM<MemorySnapshot>(1, _omitFieldNames ? '' : 'snapshot',
        subBuilder: MemorySnapshot.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMemorySnapshotResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMemorySnapshotResponse copyWith(
          void Function(GetMemorySnapshotResponse) updates) =>
      super.copyWith((message) => updates(message as GetMemorySnapshotResponse))
          as GetMemorySnapshotResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetMemorySnapshotResponse create() => GetMemorySnapshotResponse._();
  @$core.override
  GetMemorySnapshotResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetMemorySnapshotResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMemorySnapshotResponse>(create);
  static GetMemorySnapshotResponse? _defaultInstance;

  @$pb.TagNumber(1)
  MemorySnapshot get snapshot => $_getN(0);
  @$pb.TagNumber(1)
  set snapshot(MemorySnapshot value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasSnapshot() => $_has(0);
  @$pb.TagNumber(1)
  void clearSnapshot() => $_clearField(1);
  @$pb.TagNumber(1)
  MemorySnapshot ensureSnapshot() => $_ensure(0);
}

class WriteMemoryRequest extends $pb.GeneratedMessage {
  factory WriteMemoryRequest({
    $core.String? agentId,
    $core.String? target,
    $core.String? action,
    $core.String? content,
    $core.String? oldContent,
    $core.String? sourceTurnId,
  }) {
    final result = create();
    if (agentId != null) result.agentId = agentId;
    if (target != null) result.target = target;
    if (action != null) result.action = action;
    if (content != null) result.content = content;
    if (oldContent != null) result.oldContent = oldContent;
    if (sourceTurnId != null) result.sourceTurnId = sourceTurnId;
    return result;
  }

  WriteMemoryRequest._();

  factory WriteMemoryRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory WriteMemoryRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'WriteMemoryRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'agentId')
    ..aOS(2, _omitFieldNames ? '' : 'target')
    ..aOS(3, _omitFieldNames ? '' : 'action')
    ..aOS(4, _omitFieldNames ? '' : 'content')
    ..aOS(5, _omitFieldNames ? '' : 'oldContent')
    ..aOS(6, _omitFieldNames ? '' : 'sourceTurnId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  WriteMemoryRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  WriteMemoryRequest copyWith(void Function(WriteMemoryRequest) updates) =>
      super.copyWith((message) => updates(message as WriteMemoryRequest))
          as WriteMemoryRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static WriteMemoryRequest create() => WriteMemoryRequest._();
  @$core.override
  WriteMemoryRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static WriteMemoryRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<WriteMemoryRequest>(create);
  static WriteMemoryRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get agentId => $_getSZ(0);
  @$pb.TagNumber(1)
  set agentId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAgentId() => $_has(0);
  @$pb.TagNumber(1)
  void clearAgentId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get target => $_getSZ(1);
  @$pb.TagNumber(2)
  set target($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTarget() => $_has(1);
  @$pb.TagNumber(2)
  void clearTarget() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get action => $_getSZ(2);
  @$pb.TagNumber(3)
  set action($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasAction() => $_has(2);
  @$pb.TagNumber(3)
  void clearAction() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get content => $_getSZ(3);
  @$pb.TagNumber(4)
  set content($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasContent() => $_has(3);
  @$pb.TagNumber(4)
  void clearContent() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get oldContent => $_getSZ(4);
  @$pb.TagNumber(5)
  set oldContent($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasOldContent() => $_has(4);
  @$pb.TagNumber(5)
  void clearOldContent() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get sourceTurnId => $_getSZ(5);
  @$pb.TagNumber(6)
  set sourceTurnId($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasSourceTurnId() => $_has(5);
  @$pb.TagNumber(6)
  void clearSourceTurnId() => $_clearField(6);
}

class WriteMemoryResponse extends $pb.GeneratedMessage {
  factory WriteMemoryResponse({
    MemoryItem? item,
    $core.bool? success,
    $core.String? message,
  }) {
    final result = create();
    if (item != null) result.item = item;
    if (success != null) result.success = success;
    if (message != null) result.message = message;
    return result;
  }

  WriteMemoryResponse._();

  factory WriteMemoryResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory WriteMemoryResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'WriteMemoryResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOM<MemoryItem>(1, _omitFieldNames ? '' : 'item',
        subBuilder: MemoryItem.create)
    ..aOB(2, _omitFieldNames ? '' : 'success')
    ..aOS(3, _omitFieldNames ? '' : 'message')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  WriteMemoryResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  WriteMemoryResponse copyWith(void Function(WriteMemoryResponse) updates) =>
      super.copyWith((message) => updates(message as WriteMemoryResponse))
          as WriteMemoryResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static WriteMemoryResponse create() => WriteMemoryResponse._();
  @$core.override
  WriteMemoryResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static WriteMemoryResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<WriteMemoryResponse>(create);
  static WriteMemoryResponse? _defaultInstance;

  @$pb.TagNumber(1)
  MemoryItem get item => $_getN(0);
  @$pb.TagNumber(1)
  set item(MemoryItem value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasItem() => $_has(0);
  @$pb.TagNumber(1)
  void clearItem() => $_clearField(1);
  @$pb.TagNumber(1)
  MemoryItem ensureItem() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.bool get success => $_getBF(1);
  @$pb.TagNumber(2)
  set success($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSuccess() => $_has(1);
  @$pb.TagNumber(2)
  void clearSuccess() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get message => $_getSZ(2);
  @$pb.TagNumber(3)
  set message($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasMessage() => $_has(2);
  @$pb.TagNumber(3)
  void clearMessage() => $_clearField(3);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
