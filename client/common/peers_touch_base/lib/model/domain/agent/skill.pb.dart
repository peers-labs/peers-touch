// This is a generated file - do not edit.
//
// Generated from domain/agent/skill.proto.

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

class SkillManifest extends $pb.GeneratedMessage {
  factory SkillManifest({
    $core.String? skillId,
    $core.String? agentId,
    $core.String? name,
    $core.String? description,
    $core.String? category,
    $core.Iterable<$core.String>? platforms,
    SkillConditions? conditions,
    $core.String? content,
    $core.String? source,
    $core.String? trustLevel,
    $core.String? scanVerdict,
    $core.int? version,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (skillId != null) result.skillId = skillId;
    if (agentId != null) result.agentId = agentId;
    if (name != null) result.name = name;
    if (description != null) result.description = description;
    if (category != null) result.category = category;
    if (platforms != null) result.platforms.addAll(platforms);
    if (conditions != null) result.conditions = conditions;
    if (content != null) result.content = content;
    if (source != null) result.source = source;
    if (trustLevel != null) result.trustLevel = trustLevel;
    if (scanVerdict != null) result.scanVerdict = scanVerdict;
    if (version != null) result.version = version;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  SkillManifest._();

  factory SkillManifest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SkillManifest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SkillManifest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'skillId')
    ..aOS(2, _omitFieldNames ? '' : 'agentId')
    ..aOS(3, _omitFieldNames ? '' : 'name')
    ..aOS(4, _omitFieldNames ? '' : 'description')
    ..aOS(5, _omitFieldNames ? '' : 'category')
    ..pPS(6, _omitFieldNames ? '' : 'platforms')
    ..aOM<SkillConditions>(7, _omitFieldNames ? '' : 'conditions',
        subBuilder: SkillConditions.create)
    ..aOS(8, _omitFieldNames ? '' : 'content')
    ..aOS(9, _omitFieldNames ? '' : 'source')
    ..aOS(10, _omitFieldNames ? '' : 'trustLevel')
    ..aOS(11, _omitFieldNames ? '' : 'scanVerdict')
    ..aI(12, _omitFieldNames ? '' : 'version')
    ..aOM<$0.Timestamp>(13, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(14, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SkillManifest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SkillManifest copyWith(void Function(SkillManifest) updates) =>
      super.copyWith((message) => updates(message as SkillManifest))
          as SkillManifest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SkillManifest create() => SkillManifest._();
  @$core.override
  SkillManifest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SkillManifest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SkillManifest>(create);
  static SkillManifest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get skillId => $_getSZ(0);
  @$pb.TagNumber(1)
  set skillId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSkillId() => $_has(0);
  @$pb.TagNumber(1)
  void clearSkillId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get agentId => $_getSZ(1);
  @$pb.TagNumber(2)
  set agentId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasAgentId() => $_has(1);
  @$pb.TagNumber(2)
  void clearAgentId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get name => $_getSZ(2);
  @$pb.TagNumber(3)
  set name($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasName() => $_has(2);
  @$pb.TagNumber(3)
  void clearName() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get description => $_getSZ(3);
  @$pb.TagNumber(4)
  set description($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasDescription() => $_has(3);
  @$pb.TagNumber(4)
  void clearDescription() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get category => $_getSZ(4);
  @$pb.TagNumber(5)
  set category($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasCategory() => $_has(4);
  @$pb.TagNumber(5)
  void clearCategory() => $_clearField(5);

  @$pb.TagNumber(6)
  $pb.PbList<$core.String> get platforms => $_getList(5);

  @$pb.TagNumber(7)
  SkillConditions get conditions => $_getN(6);
  @$pb.TagNumber(7)
  set conditions(SkillConditions value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasConditions() => $_has(6);
  @$pb.TagNumber(7)
  void clearConditions() => $_clearField(7);
  @$pb.TagNumber(7)
  SkillConditions ensureConditions() => $_ensure(6);

  @$pb.TagNumber(8)
  $core.String get content => $_getSZ(7);
  @$pb.TagNumber(8)
  set content($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasContent() => $_has(7);
  @$pb.TagNumber(8)
  void clearContent() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.String get source => $_getSZ(8);
  @$pb.TagNumber(9)
  set source($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasSource() => $_has(8);
  @$pb.TagNumber(9)
  void clearSource() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.String get trustLevel => $_getSZ(9);
  @$pb.TagNumber(10)
  set trustLevel($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasTrustLevel() => $_has(9);
  @$pb.TagNumber(10)
  void clearTrustLevel() => $_clearField(10);

  @$pb.TagNumber(11)
  $core.String get scanVerdict => $_getSZ(10);
  @$pb.TagNumber(11)
  set scanVerdict($core.String value) => $_setString(10, value);
  @$pb.TagNumber(11)
  $core.bool hasScanVerdict() => $_has(10);
  @$pb.TagNumber(11)
  void clearScanVerdict() => $_clearField(11);

  @$pb.TagNumber(12)
  $core.int get version => $_getIZ(11);
  @$pb.TagNumber(12)
  set version($core.int value) => $_setSignedInt32(11, value);
  @$pb.TagNumber(12)
  $core.bool hasVersion() => $_has(11);
  @$pb.TagNumber(12)
  void clearVersion() => $_clearField(12);

  @$pb.TagNumber(13)
  $0.Timestamp get createdAt => $_getN(12);
  @$pb.TagNumber(13)
  set createdAt($0.Timestamp value) => $_setField(13, value);
  @$pb.TagNumber(13)
  $core.bool hasCreatedAt() => $_has(12);
  @$pb.TagNumber(13)
  void clearCreatedAt() => $_clearField(13);
  @$pb.TagNumber(13)
  $0.Timestamp ensureCreatedAt() => $_ensure(12);

  @$pb.TagNumber(14)
  $0.Timestamp get updatedAt => $_getN(13);
  @$pb.TagNumber(14)
  set updatedAt($0.Timestamp value) => $_setField(14, value);
  @$pb.TagNumber(14)
  $core.bool hasUpdatedAt() => $_has(13);
  @$pb.TagNumber(14)
  void clearUpdatedAt() => $_clearField(14);
  @$pb.TagNumber(14)
  $0.Timestamp ensureUpdatedAt() => $_ensure(13);
}

class SkillConditions extends $pb.GeneratedMessage {
  factory SkillConditions({
    $core.Iterable<$core.String>? fallbackForToolsets,
    $core.Iterable<$core.String>? requiresTools,
  }) {
    final result = create();
    if (fallbackForToolsets != null)
      result.fallbackForToolsets.addAll(fallbackForToolsets);
    if (requiresTools != null) result.requiresTools.addAll(requiresTools);
    return result;
  }

  SkillConditions._();

  factory SkillConditions.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SkillConditions.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SkillConditions',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..pPS(1, _omitFieldNames ? '' : 'fallbackForToolsets')
    ..pPS(2, _omitFieldNames ? '' : 'requiresTools')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SkillConditions clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SkillConditions copyWith(void Function(SkillConditions) updates) =>
      super.copyWith((message) => updates(message as SkillConditions))
          as SkillConditions;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SkillConditions create() => SkillConditions._();
  @$core.override
  SkillConditions createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SkillConditions getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SkillConditions>(create);
  static SkillConditions? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$core.String> get fallbackForToolsets => $_getList(0);

  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get requiresTools => $_getList(1);
}

class SkillFinding extends $pb.GeneratedMessage {
  factory SkillFinding({
    $core.String? patternId,
    $core.String? severity,
    $core.String? category,
    $core.String? file,
    $core.int? line,
    $core.String? match,
    $core.String? description,
  }) {
    final result = create();
    if (patternId != null) result.patternId = patternId;
    if (severity != null) result.severity = severity;
    if (category != null) result.category = category;
    if (file != null) result.file = file;
    if (line != null) result.line = line;
    if (match != null) result.match = match;
    if (description != null) result.description = description;
    return result;
  }

  SkillFinding._();

  factory SkillFinding.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SkillFinding.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SkillFinding',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'patternId')
    ..aOS(2, _omitFieldNames ? '' : 'severity')
    ..aOS(3, _omitFieldNames ? '' : 'category')
    ..aOS(4, _omitFieldNames ? '' : 'file')
    ..aI(5, _omitFieldNames ? '' : 'line')
    ..aOS(6, _omitFieldNames ? '' : 'match')
    ..aOS(7, _omitFieldNames ? '' : 'description')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SkillFinding clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SkillFinding copyWith(void Function(SkillFinding) updates) =>
      super.copyWith((message) => updates(message as SkillFinding))
          as SkillFinding;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SkillFinding create() => SkillFinding._();
  @$core.override
  SkillFinding createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SkillFinding getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SkillFinding>(create);
  static SkillFinding? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get patternId => $_getSZ(0);
  @$pb.TagNumber(1)
  set patternId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPatternId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPatternId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get severity => $_getSZ(1);
  @$pb.TagNumber(2)
  set severity($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSeverity() => $_has(1);
  @$pb.TagNumber(2)
  void clearSeverity() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get category => $_getSZ(2);
  @$pb.TagNumber(3)
  set category($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCategory() => $_has(2);
  @$pb.TagNumber(3)
  void clearCategory() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get file => $_getSZ(3);
  @$pb.TagNumber(4)
  set file($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasFile() => $_has(3);
  @$pb.TagNumber(4)
  void clearFile() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.int get line => $_getIZ(4);
  @$pb.TagNumber(5)
  set line($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLine() => $_has(4);
  @$pb.TagNumber(5)
  void clearLine() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get match => $_getSZ(5);
  @$pb.TagNumber(6)
  set match($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasMatch() => $_has(5);
  @$pb.TagNumber(6)
  void clearMatch() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get description => $_getSZ(6);
  @$pb.TagNumber(7)
  set description($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasDescription() => $_has(6);
  @$pb.TagNumber(7)
  void clearDescription() => $_clearField(7);
}

class SkillScanResult extends $pb.GeneratedMessage {
  factory SkillScanResult({
    $core.String? skillName,
    $core.String? source,
    $core.String? trustLevel,
    $core.String? verdict,
    $core.Iterable<SkillFinding>? findings,
    $0.Timestamp? scannedAt,
    $core.String? summary,
  }) {
    final result = create();
    if (skillName != null) result.skillName = skillName;
    if (source != null) result.source = source;
    if (trustLevel != null) result.trustLevel = trustLevel;
    if (verdict != null) result.verdict = verdict;
    if (findings != null) result.findings.addAll(findings);
    if (scannedAt != null) result.scannedAt = scannedAt;
    if (summary != null) result.summary = summary;
    return result;
  }

  SkillScanResult._();

  factory SkillScanResult.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SkillScanResult.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SkillScanResult',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'skillName')
    ..aOS(2, _omitFieldNames ? '' : 'source')
    ..aOS(3, _omitFieldNames ? '' : 'trustLevel')
    ..aOS(4, _omitFieldNames ? '' : 'verdict')
    ..pPM<SkillFinding>(5, _omitFieldNames ? '' : 'findings',
        subBuilder: SkillFinding.create)
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'scannedAt',
        subBuilder: $0.Timestamp.create)
    ..aOS(7, _omitFieldNames ? '' : 'summary')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SkillScanResult clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SkillScanResult copyWith(void Function(SkillScanResult) updates) =>
      super.copyWith((message) => updates(message as SkillScanResult))
          as SkillScanResult;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SkillScanResult create() => SkillScanResult._();
  @$core.override
  SkillScanResult createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SkillScanResult getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SkillScanResult>(create);
  static SkillScanResult? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get skillName => $_getSZ(0);
  @$pb.TagNumber(1)
  set skillName($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSkillName() => $_has(0);
  @$pb.TagNumber(1)
  void clearSkillName() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get source => $_getSZ(1);
  @$pb.TagNumber(2)
  set source($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSource() => $_has(1);
  @$pb.TagNumber(2)
  void clearSource() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get trustLevel => $_getSZ(2);
  @$pb.TagNumber(3)
  set trustLevel($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTrustLevel() => $_has(2);
  @$pb.TagNumber(3)
  void clearTrustLevel() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get verdict => $_getSZ(3);
  @$pb.TagNumber(4)
  set verdict($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasVerdict() => $_has(3);
  @$pb.TagNumber(4)
  void clearVerdict() => $_clearField(4);

  @$pb.TagNumber(5)
  $pb.PbList<SkillFinding> get findings => $_getList(4);

  @$pb.TagNumber(6)
  $0.Timestamp get scannedAt => $_getN(5);
  @$pb.TagNumber(6)
  set scannedAt($0.Timestamp value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasScannedAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearScannedAt() => $_clearField(6);
  @$pb.TagNumber(6)
  $0.Timestamp ensureScannedAt() => $_ensure(5);

  @$pb.TagNumber(7)
  $core.String get summary => $_getSZ(6);
  @$pb.TagNumber(7)
  set summary($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasSummary() => $_has(6);
  @$pb.TagNumber(7)
  void clearSummary() => $_clearField(7);
}

class ListSkillsRequest extends $pb.GeneratedMessage {
  factory ListSkillsRequest({
    $core.String? agentId,
    $core.String? category,
  }) {
    final result = create();
    if (agentId != null) result.agentId = agentId;
    if (category != null) result.category = category;
    return result;
  }

  ListSkillsRequest._();

  factory ListSkillsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListSkillsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListSkillsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'agentId')
    ..aOS(2, _omitFieldNames ? '' : 'category')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListSkillsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListSkillsRequest copyWith(void Function(ListSkillsRequest) updates) =>
      super.copyWith((message) => updates(message as ListSkillsRequest))
          as ListSkillsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListSkillsRequest create() => ListSkillsRequest._();
  @$core.override
  ListSkillsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListSkillsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListSkillsRequest>(create);
  static ListSkillsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get agentId => $_getSZ(0);
  @$pb.TagNumber(1)
  set agentId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAgentId() => $_has(0);
  @$pb.TagNumber(1)
  void clearAgentId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get category => $_getSZ(1);
  @$pb.TagNumber(2)
  set category($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCategory() => $_has(1);
  @$pb.TagNumber(2)
  void clearCategory() => $_clearField(2);
}

class ListSkillsResponse extends $pb.GeneratedMessage {
  factory ListSkillsResponse({
    $core.Iterable<SkillManifest>? skills,
  }) {
    final result = create();
    if (skills != null) result.skills.addAll(skills);
    return result;
  }

  ListSkillsResponse._();

  factory ListSkillsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListSkillsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListSkillsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..pPM<SkillManifest>(1, _omitFieldNames ? '' : 'skills',
        subBuilder: SkillManifest.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListSkillsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListSkillsResponse copyWith(void Function(ListSkillsResponse) updates) =>
      super.copyWith((message) => updates(message as ListSkillsResponse))
          as ListSkillsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListSkillsResponse create() => ListSkillsResponse._();
  @$core.override
  ListSkillsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListSkillsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListSkillsResponse>(create);
  static ListSkillsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<SkillManifest> get skills => $_getList(0);
}

class GetSkillRequest extends $pb.GeneratedMessage {
  factory GetSkillRequest({
    $core.String? skillId,
    $core.String? filePath,
  }) {
    final result = create();
    if (skillId != null) result.skillId = skillId;
    if (filePath != null) result.filePath = filePath;
    return result;
  }

  GetSkillRequest._();

  factory GetSkillRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetSkillRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetSkillRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'skillId')
    ..aOS(2, _omitFieldNames ? '' : 'filePath')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSkillRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSkillRequest copyWith(void Function(GetSkillRequest) updates) =>
      super.copyWith((message) => updates(message as GetSkillRequest))
          as GetSkillRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetSkillRequest create() => GetSkillRequest._();
  @$core.override
  GetSkillRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetSkillRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetSkillRequest>(create);
  static GetSkillRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get skillId => $_getSZ(0);
  @$pb.TagNumber(1)
  set skillId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSkillId() => $_has(0);
  @$pb.TagNumber(1)
  void clearSkillId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get filePath => $_getSZ(1);
  @$pb.TagNumber(2)
  set filePath($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasFilePath() => $_has(1);
  @$pb.TagNumber(2)
  void clearFilePath() => $_clearField(2);
}

class GetSkillResponse extends $pb.GeneratedMessage {
  factory GetSkillResponse({
    SkillManifest? skill,
    $core.String? fileContent,
  }) {
    final result = create();
    if (skill != null) result.skill = skill;
    if (fileContent != null) result.fileContent = fileContent;
    return result;
  }

  GetSkillResponse._();

  factory GetSkillResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetSkillResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetSkillResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOM<SkillManifest>(1, _omitFieldNames ? '' : 'skill',
        subBuilder: SkillManifest.create)
    ..aOS(2, _omitFieldNames ? '' : 'fileContent')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSkillResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSkillResponse copyWith(void Function(GetSkillResponse) updates) =>
      super.copyWith((message) => updates(message as GetSkillResponse))
          as GetSkillResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetSkillResponse create() => GetSkillResponse._();
  @$core.override
  GetSkillResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetSkillResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetSkillResponse>(create);
  static GetSkillResponse? _defaultInstance;

  @$pb.TagNumber(1)
  SkillManifest get skill => $_getN(0);
  @$pb.TagNumber(1)
  set skill(SkillManifest value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasSkill() => $_has(0);
  @$pb.TagNumber(1)
  void clearSkill() => $_clearField(1);
  @$pb.TagNumber(1)
  SkillManifest ensureSkill() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.String get fileContent => $_getSZ(1);
  @$pb.TagNumber(2)
  set fileContent($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasFileContent() => $_has(1);
  @$pb.TagNumber(2)
  void clearFileContent() => $_clearField(2);
}

class InstallSkillRequest extends $pb.GeneratedMessage {
  factory InstallSkillRequest({
    $core.String? agentId,
    $core.String? source,
    $core.String? name,
    $core.String? content,
    $core.String? trustLevel,
  }) {
    final result = create();
    if (agentId != null) result.agentId = agentId;
    if (source != null) result.source = source;
    if (name != null) result.name = name;
    if (content != null) result.content = content;
    if (trustLevel != null) result.trustLevel = trustLevel;
    return result;
  }

  InstallSkillRequest._();

  factory InstallSkillRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory InstallSkillRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'InstallSkillRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'agentId')
    ..aOS(2, _omitFieldNames ? '' : 'source')
    ..aOS(3, _omitFieldNames ? '' : 'name')
    ..aOS(4, _omitFieldNames ? '' : 'content')
    ..aOS(5, _omitFieldNames ? '' : 'trustLevel')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  InstallSkillRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  InstallSkillRequest copyWith(void Function(InstallSkillRequest) updates) =>
      super.copyWith((message) => updates(message as InstallSkillRequest))
          as InstallSkillRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static InstallSkillRequest create() => InstallSkillRequest._();
  @$core.override
  InstallSkillRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static InstallSkillRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<InstallSkillRequest>(create);
  static InstallSkillRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get agentId => $_getSZ(0);
  @$pb.TagNumber(1)
  set agentId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAgentId() => $_has(0);
  @$pb.TagNumber(1)
  void clearAgentId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get source => $_getSZ(1);
  @$pb.TagNumber(2)
  set source($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSource() => $_has(1);
  @$pb.TagNumber(2)
  void clearSource() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get name => $_getSZ(2);
  @$pb.TagNumber(3)
  set name($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasName() => $_has(2);
  @$pb.TagNumber(3)
  void clearName() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get content => $_getSZ(3);
  @$pb.TagNumber(4)
  set content($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasContent() => $_has(3);
  @$pb.TagNumber(4)
  void clearContent() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get trustLevel => $_getSZ(4);
  @$pb.TagNumber(5)
  set trustLevel($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasTrustLevel() => $_has(4);
  @$pb.TagNumber(5)
  void clearTrustLevel() => $_clearField(5);
}

class InstallSkillResponse extends $pb.GeneratedMessage {
  factory InstallSkillResponse({
    $core.String? skillId,
    $core.String? verdict,
    SkillScanResult? scanResult,
    $core.bool? installed,
  }) {
    final result = create();
    if (skillId != null) result.skillId = skillId;
    if (verdict != null) result.verdict = verdict;
    if (scanResult != null) result.scanResult = scanResult;
    if (installed != null) result.installed = installed;
    return result;
  }

  InstallSkillResponse._();

  factory InstallSkillResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory InstallSkillResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'InstallSkillResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'skillId')
    ..aOS(2, _omitFieldNames ? '' : 'verdict')
    ..aOM<SkillScanResult>(3, _omitFieldNames ? '' : 'scanResult',
        subBuilder: SkillScanResult.create)
    ..aOB(4, _omitFieldNames ? '' : 'installed')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  InstallSkillResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  InstallSkillResponse copyWith(void Function(InstallSkillResponse) updates) =>
      super.copyWith((message) => updates(message as InstallSkillResponse))
          as InstallSkillResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static InstallSkillResponse create() => InstallSkillResponse._();
  @$core.override
  InstallSkillResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static InstallSkillResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<InstallSkillResponse>(create);
  static InstallSkillResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get skillId => $_getSZ(0);
  @$pb.TagNumber(1)
  set skillId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSkillId() => $_has(0);
  @$pb.TagNumber(1)
  void clearSkillId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get verdict => $_getSZ(1);
  @$pb.TagNumber(2)
  set verdict($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasVerdict() => $_has(1);
  @$pb.TagNumber(2)
  void clearVerdict() => $_clearField(2);

  @$pb.TagNumber(3)
  SkillScanResult get scanResult => $_getN(2);
  @$pb.TagNumber(3)
  set scanResult(SkillScanResult value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasScanResult() => $_has(2);
  @$pb.TagNumber(3)
  void clearScanResult() => $_clearField(3);
  @$pb.TagNumber(3)
  SkillScanResult ensureScanResult() => $_ensure(2);

  @$pb.TagNumber(4)
  $core.bool get installed => $_getBF(3);
  @$pb.TagNumber(4)
  set installed($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasInstalled() => $_has(3);
  @$pb.TagNumber(4)
  void clearInstalled() => $_clearField(4);
}

class PatchSkillRequest extends $pb.GeneratedMessage {
  factory PatchSkillRequest({
    $core.String? skillId,
    $core.String? oldString,
    $core.String? newString,
  }) {
    final result = create();
    if (skillId != null) result.skillId = skillId;
    if (oldString != null) result.oldString = oldString;
    if (newString != null) result.newString = newString;
    return result;
  }

  PatchSkillRequest._();

  factory PatchSkillRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PatchSkillRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PatchSkillRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'skillId')
    ..aOS(2, _omitFieldNames ? '' : 'oldString')
    ..aOS(3, _omitFieldNames ? '' : 'newString')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PatchSkillRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PatchSkillRequest copyWith(void Function(PatchSkillRequest) updates) =>
      super.copyWith((message) => updates(message as PatchSkillRequest))
          as PatchSkillRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PatchSkillRequest create() => PatchSkillRequest._();
  @$core.override
  PatchSkillRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PatchSkillRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PatchSkillRequest>(create);
  static PatchSkillRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get skillId => $_getSZ(0);
  @$pb.TagNumber(1)
  set skillId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSkillId() => $_has(0);
  @$pb.TagNumber(1)
  void clearSkillId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get oldString => $_getSZ(1);
  @$pb.TagNumber(2)
  set oldString($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasOldString() => $_has(1);
  @$pb.TagNumber(2)
  void clearOldString() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get newString => $_getSZ(2);
  @$pb.TagNumber(3)
  set newString($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNewString() => $_has(2);
  @$pb.TagNumber(3)
  void clearNewString() => $_clearField(3);
}

class PatchSkillResponse extends $pb.GeneratedMessage {
  factory PatchSkillResponse({
    SkillManifest? skill,
    $core.bool? success,
  }) {
    final result = create();
    if (skill != null) result.skill = skill;
    if (success != null) result.success = success;
    return result;
  }

  PatchSkillResponse._();

  factory PatchSkillResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PatchSkillResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PatchSkillResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.agent.v1'),
      createEmptyInstance: create)
    ..aOM<SkillManifest>(1, _omitFieldNames ? '' : 'skill',
        subBuilder: SkillManifest.create)
    ..aOB(2, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PatchSkillResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PatchSkillResponse copyWith(void Function(PatchSkillResponse) updates) =>
      super.copyWith((message) => updates(message as PatchSkillResponse))
          as PatchSkillResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PatchSkillResponse create() => PatchSkillResponse._();
  @$core.override
  PatchSkillResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PatchSkillResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PatchSkillResponse>(create);
  static PatchSkillResponse? _defaultInstance;

  @$pb.TagNumber(1)
  SkillManifest get skill => $_getN(0);
  @$pb.TagNumber(1)
  set skill(SkillManifest value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasSkill() => $_has(0);
  @$pb.TagNumber(1)
  void clearSkill() => $_clearField(1);
  @$pb.TagNumber(1)
  SkillManifest ensureSkill() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.bool get success => $_getBF(1);
  @$pb.TagNumber(2)
  set success($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSuccess() => $_has(1);
  @$pb.TagNumber(2)
  void clearSuccess() => $_clearField(2);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
