// This is a generated file - do not edit.
//
// Generated from identity.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

import 'google/protobuf/timestamp.pb.dart' as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

/// IdentityID represents a unique identifier for an identity in the network.
class IdentityID extends $pb.GeneratedMessage {
  factory IdentityID({
    $core.String? value,
  }) {
    final result = create();
    if (value != null) result.value = value;
    return result;
  }

  IdentityID._();

  factory IdentityID.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory IdentityID.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'IdentityID',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'value')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  IdentityID clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  IdentityID copyWith(void Function(IdentityID) updates) =>
      super.copyWith((message) => updates(message as IdentityID)) as IdentityID;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static IdentityID create() => IdentityID._();
  @$core.override
  IdentityID createEmptyInstance() => create();
  static $pb.PbList<IdentityID> createRepeated() => $pb.PbList<IdentityID>();
  @$core.pragma('dart2js:noInline')
  static IdentityID getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<IdentityID>(create);
  static IdentityID? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get value => $_getSZ(0);
  @$pb.TagNumber(1)
  set value($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasValue() => $_has(0);
  @$pb.TagNumber(1)
  void clearValue() => $_clearField(1);
}

/// IdentityMeta contains metadata associated with an identity.
class IdentityMeta extends $pb.GeneratedMessage {
  factory IdentityMeta({
    IdentityID? id,
    $core.List<$core.int>? publicKey,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? attributes,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
    $0.Timestamp? expiresAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (publicKey != null) result.publicKey = publicKey;
    if (attributes != null) result.attributes.addEntries(attributes);
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    if (expiresAt != null) result.expiresAt = expiresAt;
    return result;
  }

  IdentityMeta._();

  factory IdentityMeta.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory IdentityMeta.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'IdentityMeta',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<IdentityID>(1, _omitFieldNames ? '' : 'id',
        subBuilder: IdentityID.create)
    ..a<$core.List<$core.int>>(
        2, _omitFieldNames ? '' : 'publicKey', $pb.PbFieldType.OY)
    ..m<$core.String, $core.String>(3, _omitFieldNames ? '' : 'attributes',
        entryClassName: 'IdentityMeta.AttributesEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..aOM<$0.Timestamp>(4, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(5, _omitFieldNames ? '' : 'updatedAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'expiresAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  IdentityMeta clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  IdentityMeta copyWith(void Function(IdentityMeta) updates) =>
      super.copyWith((message) => updates(message as IdentityMeta))
          as IdentityMeta;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static IdentityMeta create() => IdentityMeta._();
  @$core.override
  IdentityMeta createEmptyInstance() => create();
  static $pb.PbList<IdentityMeta> createRepeated() =>
      $pb.PbList<IdentityMeta>();
  @$core.pragma('dart2js:noInline')
  static IdentityMeta getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<IdentityMeta>(create);
  static IdentityMeta? _defaultInstance;

  @$pb.TagNumber(1)
  IdentityID get id => $_getN(0);
  @$pb.TagNumber(1)
  set id(IdentityID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);
  @$pb.TagNumber(1)
  IdentityID ensureId() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.List<$core.int> get publicKey => $_getN(1);
  @$pb.TagNumber(2)
  set publicKey($core.List<$core.int> value) => $_setBytes(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPublicKey() => $_has(1);
  @$pb.TagNumber(2)
  void clearPublicKey() => $_clearField(2);

  @$pb.TagNumber(3)
  $pb.PbMap<$core.String, $core.String> get attributes => $_getMap(2);

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

  @$pb.TagNumber(5)
  $0.Timestamp get updatedAt => $_getN(4);
  @$pb.TagNumber(5)
  set updatedAt($0.Timestamp value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasUpdatedAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearUpdatedAt() => $_clearField(5);
  @$pb.TagNumber(5)
  $0.Timestamp ensureUpdatedAt() => $_ensure(4);

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
}

/// Signature represents a cryptographic signature with metadata.
class Signature extends $pb.GeneratedMessage {
  factory Signature({
    $core.List<$core.int>? data,
    $core.String? keyId,
    $core.String? algorithm,
    $0.Timestamp? timestamp,
  }) {
    final result = create();
    if (data != null) result.data = data;
    if (keyId != null) result.keyId = keyId;
    if (algorithm != null) result.algorithm = algorithm;
    if (timestamp != null) result.timestamp = timestamp;
    return result;
  }

  Signature._();

  factory Signature.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Signature.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Signature',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..a<$core.List<$core.int>>(
        1, _omitFieldNames ? '' : 'data', $pb.PbFieldType.OY)
    ..aOS(2, _omitFieldNames ? '' : 'keyId')
    ..aOS(3, _omitFieldNames ? '' : 'algorithm')
    ..aOM<$0.Timestamp>(4, _omitFieldNames ? '' : 'timestamp',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Signature clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Signature copyWith(void Function(Signature) updates) =>
      super.copyWith((message) => updates(message as Signature)) as Signature;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Signature create() => Signature._();
  @$core.override
  Signature createEmptyInstance() => create();
  static $pb.PbList<Signature> createRepeated() => $pb.PbList<Signature>();
  @$core.pragma('dart2js:noInline')
  static Signature getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Signature>(create);
  static Signature? _defaultInstance;

  @$pb.TagNumber(1)
  $core.List<$core.int> get data => $_getN(0);
  @$pb.TagNumber(1)
  set data($core.List<$core.int> value) => $_setBytes(0, value);
  @$pb.TagNumber(1)
  $core.bool hasData() => $_has(0);
  @$pb.TagNumber(1)
  void clearData() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get keyId => $_getSZ(1);
  @$pb.TagNumber(2)
  set keyId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasKeyId() => $_has(1);
  @$pb.TagNumber(2)
  void clearKeyId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get algorithm => $_getSZ(2);
  @$pb.TagNumber(3)
  set algorithm($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasAlgorithm() => $_has(2);
  @$pb.TagNumber(3)
  void clearAlgorithm() => $_clearField(3);

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

/// Credential represents a verifiable claim or capability.
class Credential extends $pb.GeneratedMessage {
  factory Credential({
    $core.String? id,
    IdentityID? issuer,
    IdentityID? subject,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? claims,
    $0.Timestamp? issuedAt,
    $0.Timestamp? expiresAt,
    Signature? signature,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (issuer != null) result.issuer = issuer;
    if (subject != null) result.subject = subject;
    if (claims != null) result.claims.addEntries(claims);
    if (issuedAt != null) result.issuedAt = issuedAt;
    if (expiresAt != null) result.expiresAt = expiresAt;
    if (signature != null) result.signature = signature;
    return result;
  }

  Credential._();

  factory Credential.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Credential.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Credential',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOM<IdentityID>(2, _omitFieldNames ? '' : 'issuer',
        subBuilder: IdentityID.create)
    ..aOM<IdentityID>(3, _omitFieldNames ? '' : 'subject',
        subBuilder: IdentityID.create)
    ..m<$core.String, $core.String>(4, _omitFieldNames ? '' : 'claims',
        entryClassName: 'Credential.ClaimsEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..aOM<$0.Timestamp>(5, _omitFieldNames ? '' : 'issuedAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'expiresAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<Signature>(7, _omitFieldNames ? '' : 'signature',
        subBuilder: Signature.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Credential clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Credential copyWith(void Function(Credential) updates) =>
      super.copyWith((message) => updates(message as Credential)) as Credential;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Credential create() => Credential._();
  @$core.override
  Credential createEmptyInstance() => create();
  static $pb.PbList<Credential> createRepeated() => $pb.PbList<Credential>();
  @$core.pragma('dart2js:noInline')
  static Credential getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Credential>(create);
  static Credential? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  IdentityID get issuer => $_getN(1);
  @$pb.TagNumber(2)
  set issuer(IdentityID value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasIssuer() => $_has(1);
  @$pb.TagNumber(2)
  void clearIssuer() => $_clearField(2);
  @$pb.TagNumber(2)
  IdentityID ensureIssuer() => $_ensure(1);

  @$pb.TagNumber(3)
  IdentityID get subject => $_getN(2);
  @$pb.TagNumber(3)
  set subject(IdentityID value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSubject() => $_has(2);
  @$pb.TagNumber(3)
  void clearSubject() => $_clearField(3);
  @$pb.TagNumber(3)
  IdentityID ensureSubject() => $_ensure(2);

  @$pb.TagNumber(4)
  $pb.PbMap<$core.String, $core.String> get claims => $_getMap(3);

  @$pb.TagNumber(5)
  $0.Timestamp get issuedAt => $_getN(4);
  @$pb.TagNumber(5)
  set issuedAt($0.Timestamp value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasIssuedAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearIssuedAt() => $_clearField(5);
  @$pb.TagNumber(5)
  $0.Timestamp ensureIssuedAt() => $_ensure(4);

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
  Signature get signature => $_getN(6);
  @$pb.TagNumber(7)
  set signature(Signature value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasSignature() => $_has(6);
  @$pb.TagNumber(7)
  void clearSignature() => $_clearField(7);
  @$pb.TagNumber(7)
  Signature ensureSignature() => $_ensure(6);
}

/// IdentityCreateRequest represents a request to create a new identity.
class IdentityCreateRequest extends $pb.GeneratedMessage {
  factory IdentityCreateRequest({
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? attributes,
  }) {
    final result = create();
    if (attributes != null) result.attributes.addEntries(attributes);
    return result;
  }

  IdentityCreateRequest._();

  factory IdentityCreateRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory IdentityCreateRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'IdentityCreateRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..m<$core.String, $core.String>(1, _omitFieldNames ? '' : 'attributes',
        entryClassName: 'IdentityCreateRequest.AttributesEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  IdentityCreateRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  IdentityCreateRequest copyWith(
          void Function(IdentityCreateRequest) updates) =>
      super.copyWith((message) => updates(message as IdentityCreateRequest))
          as IdentityCreateRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static IdentityCreateRequest create() => IdentityCreateRequest._();
  @$core.override
  IdentityCreateRequest createEmptyInstance() => create();
  static $pb.PbList<IdentityCreateRequest> createRepeated() =>
      $pb.PbList<IdentityCreateRequest>();
  @$core.pragma('dart2js:noInline')
  static IdentityCreateRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<IdentityCreateRequest>(create);
  static IdentityCreateRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbMap<$core.String, $core.String> get attributes => $_getMap(0);
}

/// IdentityUpdateRequest represents a request to update identity metadata.
class IdentityUpdateRequest extends $pb.GeneratedMessage {
  factory IdentityUpdateRequest({
    IdentityID? id,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? attributes,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (attributes != null) result.attributes.addEntries(attributes);
    return result;
  }

  IdentityUpdateRequest._();

  factory IdentityUpdateRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory IdentityUpdateRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'IdentityUpdateRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<IdentityID>(1, _omitFieldNames ? '' : 'id',
        subBuilder: IdentityID.create)
    ..m<$core.String, $core.String>(2, _omitFieldNames ? '' : 'attributes',
        entryClassName: 'IdentityUpdateRequest.AttributesEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  IdentityUpdateRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  IdentityUpdateRequest copyWith(
          void Function(IdentityUpdateRequest) updates) =>
      super.copyWith((message) => updates(message as IdentityUpdateRequest))
          as IdentityUpdateRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static IdentityUpdateRequest create() => IdentityUpdateRequest._();
  @$core.override
  IdentityUpdateRequest createEmptyInstance() => create();
  static $pb.PbList<IdentityUpdateRequest> createRepeated() =>
      $pb.PbList<IdentityUpdateRequest>();
  @$core.pragma('dart2js:noInline')
  static IdentityUpdateRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<IdentityUpdateRequest>(create);
  static IdentityUpdateRequest? _defaultInstance;

  @$pb.TagNumber(1)
  IdentityID get id => $_getN(0);
  @$pb.TagNumber(1)
  set id(IdentityID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);
  @$pb.TagNumber(1)
  IdentityID ensureId() => $_ensure(0);

  @$pb.TagNumber(2)
  $pb.PbMap<$core.String, $core.String> get attributes => $_getMap(1);
}

/// IdentityResolveRequest represents a request to resolve identity metadata.
class IdentityResolveRequest extends $pb.GeneratedMessage {
  factory IdentityResolveRequest({
    $core.Iterable<IdentityID>? ids,
  }) {
    final result = create();
    if (ids != null) result.ids.addAll(ids);
    return result;
  }

  IdentityResolveRequest._();

  factory IdentityResolveRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory IdentityResolveRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'IdentityResolveRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..pPM<IdentityID>(1, _omitFieldNames ? '' : 'ids',
        subBuilder: IdentityID.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  IdentityResolveRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  IdentityResolveRequest copyWith(
          void Function(IdentityResolveRequest) updates) =>
      super.copyWith((message) => updates(message as IdentityResolveRequest))
          as IdentityResolveRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static IdentityResolveRequest create() => IdentityResolveRequest._();
  @$core.override
  IdentityResolveRequest createEmptyInstance() => create();
  static $pb.PbList<IdentityResolveRequest> createRepeated() =>
      $pb.PbList<IdentityResolveRequest>();
  @$core.pragma('dart2js:noInline')
  static IdentityResolveRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<IdentityResolveRequest>(create);
  static IdentityResolveRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<IdentityID> get ids => $_getList(0);
}

/// IdentityResolveResponse represents the response to identity resolution.
class IdentityResolveResponse extends $pb.GeneratedMessage {
  factory IdentityResolveResponse({
    $core.Iterable<$core.MapEntry<$core.String, IdentityMeta>>? identities,
  }) {
    final result = create();
    if (identities != null) result.identities.addEntries(identities);
    return result;
  }

  IdentityResolveResponse._();

  factory IdentityResolveResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory IdentityResolveResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'IdentityResolveResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..m<$core.String, IdentityMeta>(1, _omitFieldNames ? '' : 'identities',
        entryClassName: 'IdentityResolveResponse.IdentitiesEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OM,
        valueCreator: IdentityMeta.create,
        valueDefaultOrMaker: IdentityMeta.getDefault,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  IdentityResolveResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  IdentityResolveResponse copyWith(
          void Function(IdentityResolveResponse) updates) =>
      super.copyWith((message) => updates(message as IdentityResolveResponse))
          as IdentityResolveResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static IdentityResolveResponse create() => IdentityResolveResponse._();
  @$core.override
  IdentityResolveResponse createEmptyInstance() => create();
  static $pb.PbList<IdentityResolveResponse> createRepeated() =>
      $pb.PbList<IdentityResolveResponse>();
  @$core.pragma('dart2js:noInline')
  static IdentityResolveResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<IdentityResolveResponse>(create);
  static IdentityResolveResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbMap<$core.String, IdentityMeta> get identities => $_getMap(0);
}

/// SignRequest represents a request to sign data.
class SignRequest extends $pb.GeneratedMessage {
  factory SignRequest({
    $core.List<$core.int>? payload,
  }) {
    final result = create();
    if (payload != null) result.payload = payload;
    return result;
  }

  SignRequest._();

  factory SignRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SignRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SignRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..a<$core.List<$core.int>>(
        1, _omitFieldNames ? '' : 'payload', $pb.PbFieldType.OY)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SignRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SignRequest copyWith(void Function(SignRequest) updates) =>
      super.copyWith((message) => updates(message as SignRequest))
          as SignRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SignRequest create() => SignRequest._();
  @$core.override
  SignRequest createEmptyInstance() => create();
  static $pb.PbList<SignRequest> createRepeated() => $pb.PbList<SignRequest>();
  @$core.pragma('dart2js:noInline')
  static SignRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SignRequest>(create);
  static SignRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.List<$core.int> get payload => $_getN(0);
  @$pb.TagNumber(1)
  set payload($core.List<$core.int> value) => $_setBytes(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPayload() => $_has(0);
  @$pb.TagNumber(1)
  void clearPayload() => $_clearField(1);
}

/// SignResponse represents the response to a sign request.
class SignResponse extends $pb.GeneratedMessage {
  factory SignResponse({
    Signature? signature,
  }) {
    final result = create();
    if (signature != null) result.signature = signature;
    return result;
  }

  SignResponse._();

  factory SignResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SignResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SignResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<Signature>(1, _omitFieldNames ? '' : 'signature',
        subBuilder: Signature.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SignResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SignResponse copyWith(void Function(SignResponse) updates) =>
      super.copyWith((message) => updates(message as SignResponse))
          as SignResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SignResponse create() => SignResponse._();
  @$core.override
  SignResponse createEmptyInstance() => create();
  static $pb.PbList<SignResponse> createRepeated() =>
      $pb.PbList<SignResponse>();
  @$core.pragma('dart2js:noInline')
  static SignResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SignResponse>(create);
  static SignResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Signature get signature => $_getN(0);
  @$pb.TagNumber(1)
  set signature(Signature value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasSignature() => $_has(0);
  @$pb.TagNumber(1)
  void clearSignature() => $_clearField(1);
  @$pb.TagNumber(1)
  Signature ensureSignature() => $_ensure(0);
}

/// VerifyRequest represents a request to verify a signature.
class VerifyRequest extends $pb.GeneratedMessage {
  factory VerifyRequest({
    $core.List<$core.int>? payload,
    Signature? signature,
    IdentityID? identityId,
  }) {
    final result = create();
    if (payload != null) result.payload = payload;
    if (signature != null) result.signature = signature;
    if (identityId != null) result.identityId = identityId;
    return result;
  }

  VerifyRequest._();

  factory VerifyRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory VerifyRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'VerifyRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..a<$core.List<$core.int>>(
        1, _omitFieldNames ? '' : 'payload', $pb.PbFieldType.OY)
    ..aOM<Signature>(2, _omitFieldNames ? '' : 'signature',
        subBuilder: Signature.create)
    ..aOM<IdentityID>(3, _omitFieldNames ? '' : 'identityId',
        subBuilder: IdentityID.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VerifyRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VerifyRequest copyWith(void Function(VerifyRequest) updates) =>
      super.copyWith((message) => updates(message as VerifyRequest))
          as VerifyRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static VerifyRequest create() => VerifyRequest._();
  @$core.override
  VerifyRequest createEmptyInstance() => create();
  static $pb.PbList<VerifyRequest> createRepeated() =>
      $pb.PbList<VerifyRequest>();
  @$core.pragma('dart2js:noInline')
  static VerifyRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<VerifyRequest>(create);
  static VerifyRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.List<$core.int> get payload => $_getN(0);
  @$pb.TagNumber(1)
  set payload($core.List<$core.int> value) => $_setBytes(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPayload() => $_has(0);
  @$pb.TagNumber(1)
  void clearPayload() => $_clearField(1);

  @$pb.TagNumber(2)
  Signature get signature => $_getN(1);
  @$pb.TagNumber(2)
  set signature(Signature value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasSignature() => $_has(1);
  @$pb.TagNumber(2)
  void clearSignature() => $_clearField(2);
  @$pb.TagNumber(2)
  Signature ensureSignature() => $_ensure(1);

  @$pb.TagNumber(3)
  IdentityID get identityId => $_getN(2);
  @$pb.TagNumber(3)
  set identityId(IdentityID value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasIdentityId() => $_has(2);
  @$pb.TagNumber(3)
  void clearIdentityId() => $_clearField(3);
  @$pb.TagNumber(3)
  IdentityID ensureIdentityId() => $_ensure(2);
}

/// VerifyResponse represents the response to a verify request.
class VerifyResponse extends $pb.GeneratedMessage {
  factory VerifyResponse({
    $core.bool? valid,
    $core.String? errorMessage,
  }) {
    final result = create();
    if (valid != null) result.valid = valid;
    if (errorMessage != null) result.errorMessage = errorMessage;
    return result;
  }

  VerifyResponse._();

  factory VerifyResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory VerifyResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'VerifyResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'valid')
    ..aOS(2, _omitFieldNames ? '' : 'errorMessage')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VerifyResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VerifyResponse copyWith(void Function(VerifyResponse) updates) =>
      super.copyWith((message) => updates(message as VerifyResponse))
          as VerifyResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static VerifyResponse create() => VerifyResponse._();
  @$core.override
  VerifyResponse createEmptyInstance() => create();
  static $pb.PbList<VerifyResponse> createRepeated() =>
      $pb.PbList<VerifyResponse>();
  @$core.pragma('dart2js:noInline')
  static VerifyResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<VerifyResponse>(create);
  static VerifyResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get valid => $_getBF(0);
  @$pb.TagNumber(1)
  set valid($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasValid() => $_has(0);
  @$pb.TagNumber(1)
  void clearValid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get errorMessage => $_getSZ(1);
  @$pb.TagNumber(2)
  set errorMessage($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasErrorMessage() => $_has(1);
  @$pb.TagNumber(2)
  void clearErrorMessage() => $_clearField(2);
}

/// CredentialIssueRequest represents a request to issue a credential.
class CredentialIssueRequest extends $pb.GeneratedMessage {
  factory CredentialIssueRequest({
    IdentityID? subject,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? claims,
    $fixnum.Int64? ttlSeconds,
  }) {
    final result = create();
    if (subject != null) result.subject = subject;
    if (claims != null) result.claims.addEntries(claims);
    if (ttlSeconds != null) result.ttlSeconds = ttlSeconds;
    return result;
  }

  CredentialIssueRequest._();

  factory CredentialIssueRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CredentialIssueRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CredentialIssueRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<IdentityID>(1, _omitFieldNames ? '' : 'subject',
        subBuilder: IdentityID.create)
    ..m<$core.String, $core.String>(2, _omitFieldNames ? '' : 'claims',
        entryClassName: 'CredentialIssueRequest.ClaimsEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.v2'))
    ..aInt64(3, _omitFieldNames ? '' : 'ttlSeconds')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CredentialIssueRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CredentialIssueRequest copyWith(
          void Function(CredentialIssueRequest) updates) =>
      super.copyWith((message) => updates(message as CredentialIssueRequest))
          as CredentialIssueRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CredentialIssueRequest create() => CredentialIssueRequest._();
  @$core.override
  CredentialIssueRequest createEmptyInstance() => create();
  static $pb.PbList<CredentialIssueRequest> createRepeated() =>
      $pb.PbList<CredentialIssueRequest>();
  @$core.pragma('dart2js:noInline')
  static CredentialIssueRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CredentialIssueRequest>(create);
  static CredentialIssueRequest? _defaultInstance;

  @$pb.TagNumber(1)
  IdentityID get subject => $_getN(0);
  @$pb.TagNumber(1)
  set subject(IdentityID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasSubject() => $_has(0);
  @$pb.TagNumber(1)
  void clearSubject() => $_clearField(1);
  @$pb.TagNumber(1)
  IdentityID ensureSubject() => $_ensure(0);

  @$pb.TagNumber(2)
  $pb.PbMap<$core.String, $core.String> get claims => $_getMap(1);

  @$pb.TagNumber(3)
  $fixnum.Int64 get ttlSeconds => $_getI64(2);
  @$pb.TagNumber(3)
  set ttlSeconds($fixnum.Int64 value) => $_setInt64(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTtlSeconds() => $_has(2);
  @$pb.TagNumber(3)
  void clearTtlSeconds() => $_clearField(3);
}

/// CredentialVerifyRequest represents a request to verify a credential.
class CredentialVerifyRequest extends $pb.GeneratedMessage {
  factory CredentialVerifyRequest({
    Credential? credential,
  }) {
    final result = create();
    if (credential != null) result.credential = credential;
    return result;
  }

  CredentialVerifyRequest._();

  factory CredentialVerifyRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CredentialVerifyRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CredentialVerifyRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<Credential>(1, _omitFieldNames ? '' : 'credential',
        subBuilder: Credential.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CredentialVerifyRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CredentialVerifyRequest copyWith(
          void Function(CredentialVerifyRequest) updates) =>
      super.copyWith((message) => updates(message as CredentialVerifyRequest))
          as CredentialVerifyRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CredentialVerifyRequest create() => CredentialVerifyRequest._();
  @$core.override
  CredentialVerifyRequest createEmptyInstance() => create();
  static $pb.PbList<CredentialVerifyRequest> createRepeated() =>
      $pb.PbList<CredentialVerifyRequest>();
  @$core.pragma('dart2js:noInline')
  static CredentialVerifyRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CredentialVerifyRequest>(create);
  static CredentialVerifyRequest? _defaultInstance;

  @$pb.TagNumber(1)
  Credential get credential => $_getN(0);
  @$pb.TagNumber(1)
  set credential(Credential value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasCredential() => $_has(0);
  @$pb.TagNumber(1)
  void clearCredential() => $_clearField(1);
  @$pb.TagNumber(1)
  Credential ensureCredential() => $_ensure(0);
}

/// CredentialVerifyResponse represents the response to credential verification.
class CredentialVerifyResponse extends $pb.GeneratedMessage {
  factory CredentialVerifyResponse({
    $core.bool? valid,
    $core.String? errorMessage,
  }) {
    final result = create();
    if (valid != null) result.valid = valid;
    if (errorMessage != null) result.errorMessage = errorMessage;
    return result;
  }

  CredentialVerifyResponse._();

  factory CredentialVerifyResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CredentialVerifyResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CredentialVerifyResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'valid')
    ..aOS(2, _omitFieldNames ? '' : 'errorMessage')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CredentialVerifyResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CredentialVerifyResponse copyWith(
          void Function(CredentialVerifyResponse) updates) =>
      super.copyWith((message) => updates(message as CredentialVerifyResponse))
          as CredentialVerifyResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CredentialVerifyResponse create() => CredentialVerifyResponse._();
  @$core.override
  CredentialVerifyResponse createEmptyInstance() => create();
  static $pb.PbList<CredentialVerifyResponse> createRepeated() =>
      $pb.PbList<CredentialVerifyResponse>();
  @$core.pragma('dart2js:noInline')
  static CredentialVerifyResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CredentialVerifyResponse>(create);
  static CredentialVerifyResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get valid => $_getBF(0);
  @$pb.TagNumber(1)
  set valid($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasValid() => $_has(0);
  @$pb.TagNumber(1)
  void clearValid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get errorMessage => $_getSZ(1);
  @$pb.TagNumber(2)
  set errorMessage($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasErrorMessage() => $_has(1);
  @$pb.TagNumber(2)
  void clearErrorMessage() => $_clearField(2);
}

/// CredentialListRequest represents a request to list credentials.
class CredentialListRequest extends $pb.GeneratedMessage {
  factory CredentialListRequest({
    IdentityID? subject,
  }) {
    final result = create();
    if (subject != null) result.subject = subject;
    return result;
  }

  CredentialListRequest._();

  factory CredentialListRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CredentialListRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CredentialListRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..aOM<IdentityID>(1, _omitFieldNames ? '' : 'subject',
        subBuilder: IdentityID.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CredentialListRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CredentialListRequest copyWith(
          void Function(CredentialListRequest) updates) =>
      super.copyWith((message) => updates(message as CredentialListRequest))
          as CredentialListRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CredentialListRequest create() => CredentialListRequest._();
  @$core.override
  CredentialListRequest createEmptyInstance() => create();
  static $pb.PbList<CredentialListRequest> createRepeated() =>
      $pb.PbList<CredentialListRequest>();
  @$core.pragma('dart2js:noInline')
  static CredentialListRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CredentialListRequest>(create);
  static CredentialListRequest? _defaultInstance;

  @$pb.TagNumber(1)
  IdentityID get subject => $_getN(0);
  @$pb.TagNumber(1)
  set subject(IdentityID value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasSubject() => $_has(0);
  @$pb.TagNumber(1)
  void clearSubject() => $_clearField(1);
  @$pb.TagNumber(1)
  IdentityID ensureSubject() => $_ensure(0);
}

/// CredentialListResponse represents the response to credential listing.
class CredentialListResponse extends $pb.GeneratedMessage {
  factory CredentialListResponse({
    $core.Iterable<Credential>? credentials,
  }) {
    final result = create();
    if (credentials != null) result.credentials.addAll(credentials);
    return result;
  }

  CredentialListResponse._();

  factory CredentialListResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CredentialListResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CredentialListResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'peers_touch.v2'),
      createEmptyInstance: create)
    ..pPM<Credential>(1, _omitFieldNames ? '' : 'credentials',
        subBuilder: Credential.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CredentialListResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CredentialListResponse copyWith(
          void Function(CredentialListResponse) updates) =>
      super.copyWith((message) => updates(message as CredentialListResponse))
          as CredentialListResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CredentialListResponse create() => CredentialListResponse._();
  @$core.override
  CredentialListResponse createEmptyInstance() => create();
  static $pb.PbList<CredentialListResponse> createRepeated() =>
      $pb.PbList<CredentialListResponse>();
  @$core.pragma('dart2js:noInline')
  static CredentialListResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CredentialListResponse>(create);
  static CredentialListResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Credential> get credentials => $_getList(0);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
