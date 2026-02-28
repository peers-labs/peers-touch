// This is a generated file - do not edit.
//
// Generated from domain/peer/peer.proto.

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

class SetPeerAddrRequest extends $pb.GeneratedMessage {
  factory SetPeerAddrRequest({
    $core.Iterable<$core.String>? addresses,
  }) {
    final result = create();
    if (addresses != null) result.addresses.addAll(addresses);
    return result;
  }

  SetPeerAddrRequest._();

  factory SetPeerAddrRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SetPeerAddrRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SetPeerAddrRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..pPS(1, _omitFieldNames ? '' : 'addresses')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SetPeerAddrRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SetPeerAddrRequest copyWith(void Function(SetPeerAddrRequest) updates) =>
      super.copyWith((message) => updates(message as SetPeerAddrRequest))
          as SetPeerAddrRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SetPeerAddrRequest create() => SetPeerAddrRequest._();
  @$core.override
  SetPeerAddrRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SetPeerAddrRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SetPeerAddrRequest>(create);
  static SetPeerAddrRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$core.String> get addresses => $_getList(0);
}

class SetPeerAddrResponse extends $pb.GeneratedMessage {
  factory SetPeerAddrResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  SetPeerAddrResponse._();

  factory SetPeerAddrResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SetPeerAddrResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SetPeerAddrResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SetPeerAddrResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SetPeerAddrResponse copyWith(void Function(SetPeerAddrResponse) updates) =>
      super.copyWith((message) => updates(message as SetPeerAddrResponse))
          as SetPeerAddrResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SetPeerAddrResponse create() => SetPeerAddrResponse._();
  @$core.override
  SetPeerAddrResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SetPeerAddrResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SetPeerAddrResponse>(create);
  static SetPeerAddrResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

class GetMyPeerAddrRequest extends $pb.GeneratedMessage {
  factory GetMyPeerAddrRequest() => create();

  GetMyPeerAddrRequest._();

  factory GetMyPeerAddrRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetMyPeerAddrRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyPeerAddrRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyPeerAddrRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyPeerAddrRequest copyWith(void Function(GetMyPeerAddrRequest) updates) =>
      super.copyWith((message) => updates(message as GetMyPeerAddrRequest))
          as GetMyPeerAddrRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetMyPeerAddrRequest create() => GetMyPeerAddrRequest._();
  @$core.override
  GetMyPeerAddrRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetMyPeerAddrRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyPeerAddrRequest>(create);
  static GetMyPeerAddrRequest? _defaultInstance;
}

class PeerAddrInfo extends $pb.GeneratedMessage {
  factory PeerAddrInfo({
    $core.String? address,
    $core.String? protocol,
    $0.Timestamp? lastSeen,
  }) {
    final result = create();
    if (address != null) result.address = address;
    if (protocol != null) result.protocol = protocol;
    if (lastSeen != null) result.lastSeen = lastSeen;
    return result;
  }

  PeerAddrInfo._();

  factory PeerAddrInfo.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PeerAddrInfo.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PeerAddrInfo',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'address')
    ..aOS(2, _omitFieldNames ? '' : 'protocol')
    ..aOM<$0.Timestamp>(3, _omitFieldNames ? '' : 'lastSeen',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PeerAddrInfo clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PeerAddrInfo copyWith(void Function(PeerAddrInfo) updates) =>
      super.copyWith((message) => updates(message as PeerAddrInfo))
          as PeerAddrInfo;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PeerAddrInfo create() => PeerAddrInfo._();
  @$core.override
  PeerAddrInfo createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PeerAddrInfo getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PeerAddrInfo>(create);
  static PeerAddrInfo? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get address => $_getSZ(0);
  @$pb.TagNumber(1)
  set address($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAddress() => $_has(0);
  @$pb.TagNumber(1)
  void clearAddress() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get protocol => $_getSZ(1);
  @$pb.TagNumber(2)
  set protocol($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasProtocol() => $_has(1);
  @$pb.TagNumber(2)
  void clearProtocol() => $_clearField(2);

  @$pb.TagNumber(3)
  $0.Timestamp get lastSeen => $_getN(2);
  @$pb.TagNumber(3)
  set lastSeen($0.Timestamp value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasLastSeen() => $_has(2);
  @$pb.TagNumber(3)
  void clearLastSeen() => $_clearField(3);
  @$pb.TagNumber(3)
  $0.Timestamp ensureLastSeen() => $_ensure(2);
}

class GetMyPeerAddrResponse extends $pb.GeneratedMessage {
  factory GetMyPeerAddrResponse({
    $core.Iterable<PeerAddrInfo>? addresses,
  }) {
    final result = create();
    if (addresses != null) result.addresses.addAll(addresses);
    return result;
  }

  GetMyPeerAddrResponse._();

  factory GetMyPeerAddrResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetMyPeerAddrResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyPeerAddrResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..pPM<PeerAddrInfo>(1, _omitFieldNames ? '' : 'addresses',
        subBuilder: PeerAddrInfo.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyPeerAddrResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyPeerAddrResponse copyWith(
          void Function(GetMyPeerAddrResponse) updates) =>
      super.copyWith((message) => updates(message as GetMyPeerAddrResponse))
          as GetMyPeerAddrResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetMyPeerAddrResponse create() => GetMyPeerAddrResponse._();
  @$core.override
  GetMyPeerAddrResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetMyPeerAddrResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyPeerAddrResponse>(create);
  static GetMyPeerAddrResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<PeerAddrInfo> get addresses => $_getList(0);
}

class TouchHiRequest extends $pb.GeneratedMessage {
  factory TouchHiRequest({
    $core.String? targetPeerId,
    $core.String? message,
  }) {
    final result = create();
    if (targetPeerId != null) result.targetPeerId = targetPeerId;
    if (message != null) result.message = message;
    return result;
  }

  TouchHiRequest._();

  factory TouchHiRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory TouchHiRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TouchHiRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'targetPeerId')
    ..aOS(2, _omitFieldNames ? '' : 'message')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TouchHiRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TouchHiRequest copyWith(void Function(TouchHiRequest) updates) =>
      super.copyWith((message) => updates(message as TouchHiRequest))
          as TouchHiRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static TouchHiRequest create() => TouchHiRequest._();
  @$core.override
  TouchHiRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static TouchHiRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<TouchHiRequest>(create);
  static TouchHiRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get targetPeerId => $_getSZ(0);
  @$pb.TagNumber(1)
  set targetPeerId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTargetPeerId() => $_has(0);
  @$pb.TagNumber(1)
  void clearTargetPeerId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get message => $_getSZ(1);
  @$pb.TagNumber(2)
  set message($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasMessage() => $_has(1);
  @$pb.TagNumber(2)
  void clearMessage() => $_clearField(2);
}

class TouchHiResponse extends $pb.GeneratedMessage {
  factory TouchHiResponse({
    $core.bool? success,
    $core.String? responseMessage,
  }) {
    final result = create();
    if (success != null) result.success = success;
    if (responseMessage != null) result.responseMessage = responseMessage;
    return result;
  }

  TouchHiResponse._();

  factory TouchHiResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory TouchHiResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TouchHiResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..aOS(2, _omitFieldNames ? '' : 'responseMessage')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TouchHiResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TouchHiResponse copyWith(void Function(TouchHiResponse) updates) =>
      super.copyWith((message) => updates(message as TouchHiResponse))
          as TouchHiResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static TouchHiResponse create() => TouchHiResponse._();
  @$core.override
  TouchHiResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static TouchHiResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<TouchHiResponse>(create);
  static TouchHiResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get responseMessage => $_getSZ(1);
  @$pb.TagNumber(2)
  set responseMessage($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasResponseMessage() => $_has(1);
  @$pb.TagNumber(2)
  void clearResponseMessage() => $_clearField(2);
}

class Node extends $pb.GeneratedMessage {
  factory Node({
    $core.String? id,
    $core.String? name,
    $core.String? version,
    $core.Iterable<$core.String>? addresses,
    $core.Iterable<$core.String>? capabilities,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? metadata,
    $core.String? status,
    $core.String? publicKey,
    $core.int? port,
    $0.Timestamp? lastSeenAt,
    $0.Timestamp? heartbeatAt,
    $0.Timestamp? registeredAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (name != null) result.name = name;
    if (version != null) result.version = version;
    if (addresses != null) result.addresses.addAll(addresses);
    if (capabilities != null) result.capabilities.addAll(capabilities);
    if (metadata != null) result.metadata.addEntries(metadata);
    if (status != null) result.status = status;
    if (publicKey != null) result.publicKey = publicKey;
    if (port != null) result.port = port;
    if (lastSeenAt != null) result.lastSeenAt = lastSeenAt;
    if (heartbeatAt != null) result.heartbeatAt = heartbeatAt;
    if (registeredAt != null) result.registeredAt = registeredAt;
    return result;
  }

  Node._();

  factory Node.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Node.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Node',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'version')
    ..pPS(4, _omitFieldNames ? '' : 'addresses')
    ..pPS(5, _omitFieldNames ? '' : 'capabilities')
    ..m<$core.String, $core.String>(6, _omitFieldNames ? '' : 'metadata',
        entryClassName: 'Node.MetadataEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.model.peer.v1'))
    ..aOS(7, _omitFieldNames ? '' : 'status')
    ..aOS(8, _omitFieldNames ? '' : 'publicKey')
    ..aI(9, _omitFieldNames ? '' : 'port')
    ..aOM<$0.Timestamp>(10, _omitFieldNames ? '' : 'lastSeenAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(11, _omitFieldNames ? '' : 'heartbeatAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(12, _omitFieldNames ? '' : 'registeredAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Node clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Node copyWith(void Function(Node) updates) =>
      super.copyWith((message) => updates(message as Node)) as Node;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Node create() => Node._();
  @$core.override
  Node createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Node getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Node>(create);
  static Node? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get version => $_getSZ(2);
  @$pb.TagNumber(3)
  set version($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasVersion() => $_has(2);
  @$pb.TagNumber(3)
  void clearVersion() => $_clearField(3);

  @$pb.TagNumber(4)
  $pb.PbList<$core.String> get addresses => $_getList(3);

  @$pb.TagNumber(5)
  $pb.PbList<$core.String> get capabilities => $_getList(4);

  @$pb.TagNumber(6)
  $pb.PbMap<$core.String, $core.String> get metadata => $_getMap(5);

  @$pb.TagNumber(7)
  $core.String get status => $_getSZ(6);
  @$pb.TagNumber(7)
  set status($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasStatus() => $_has(6);
  @$pb.TagNumber(7)
  void clearStatus() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get publicKey => $_getSZ(7);
  @$pb.TagNumber(8)
  set publicKey($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasPublicKey() => $_has(7);
  @$pb.TagNumber(8)
  void clearPublicKey() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.int get port => $_getIZ(8);
  @$pb.TagNumber(9)
  set port($core.int value) => $_setSignedInt32(8, value);
  @$pb.TagNumber(9)
  $core.bool hasPort() => $_has(8);
  @$pb.TagNumber(9)
  void clearPort() => $_clearField(9);

  @$pb.TagNumber(10)
  $0.Timestamp get lastSeenAt => $_getN(9);
  @$pb.TagNumber(10)
  set lastSeenAt($0.Timestamp value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasLastSeenAt() => $_has(9);
  @$pb.TagNumber(10)
  void clearLastSeenAt() => $_clearField(10);
  @$pb.TagNumber(10)
  $0.Timestamp ensureLastSeenAt() => $_ensure(9);

  @$pb.TagNumber(11)
  $0.Timestamp get heartbeatAt => $_getN(10);
  @$pb.TagNumber(11)
  set heartbeatAt($0.Timestamp value) => $_setField(11, value);
  @$pb.TagNumber(11)
  $core.bool hasHeartbeatAt() => $_has(10);
  @$pb.TagNumber(11)
  void clearHeartbeatAt() => $_clearField(11);
  @$pb.TagNumber(11)
  $0.Timestamp ensureHeartbeatAt() => $_ensure(10);

  @$pb.TagNumber(12)
  $0.Timestamp get registeredAt => $_getN(11);
  @$pb.TagNumber(12)
  set registeredAt($0.Timestamp value) => $_setField(12, value);
  @$pb.TagNumber(12)
  $core.bool hasRegisteredAt() => $_has(11);
  @$pb.TagNumber(12)
  void clearRegisteredAt() => $_clearField(12);
  @$pb.TagNumber(12)
  $0.Timestamp ensureRegisteredAt() => $_ensure(11);
}

class ListNodesRequest extends $pb.GeneratedMessage {
  factory ListNodesRequest({
    $core.int? limit,
    $core.int? offset,
    $core.Iterable<$core.String>? status,
    $core.Iterable<$core.String>? capabilities,
    $core.bool? onlineOnly,
  }) {
    final result = create();
    if (limit != null) result.limit = limit;
    if (offset != null) result.offset = offset;
    if (status != null) result.status.addAll(status);
    if (capabilities != null) result.capabilities.addAll(capabilities);
    if (onlineOnly != null) result.onlineOnly = onlineOnly;
    return result;
  }

  ListNodesRequest._();

  factory ListNodesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListNodesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListNodesRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'limit')
    ..aI(2, _omitFieldNames ? '' : 'offset')
    ..pPS(3, _omitFieldNames ? '' : 'status')
    ..pPS(4, _omitFieldNames ? '' : 'capabilities')
    ..aOB(5, _omitFieldNames ? '' : 'onlineOnly')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListNodesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListNodesRequest copyWith(void Function(ListNodesRequest) updates) =>
      super.copyWith((message) => updates(message as ListNodesRequest))
          as ListNodesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListNodesRequest create() => ListNodesRequest._();
  @$core.override
  ListNodesRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListNodesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListNodesRequest>(create);
  static ListNodesRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get limit => $_getIZ(0);
  @$pb.TagNumber(1)
  set limit($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasLimit() => $_has(0);
  @$pb.TagNumber(1)
  void clearLimit() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get offset => $_getIZ(1);
  @$pb.TagNumber(2)
  set offset($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasOffset() => $_has(1);
  @$pb.TagNumber(2)
  void clearOffset() => $_clearField(2);

  @$pb.TagNumber(3)
  $pb.PbList<$core.String> get status => $_getList(2);

  @$pb.TagNumber(4)
  $pb.PbList<$core.String> get capabilities => $_getList(3);

  @$pb.TagNumber(5)
  $core.bool get onlineOnly => $_getBF(4);
  @$pb.TagNumber(5)
  set onlineOnly($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasOnlineOnly() => $_has(4);
  @$pb.TagNumber(5)
  void clearOnlineOnly() => $_clearField(5);
}

class ListNodesResponse extends $pb.GeneratedMessage {
  factory ListNodesResponse({
    $core.Iterable<Node>? nodes,
    $fixnum.Int64? total,
    $core.int? page,
    $core.int? size,
  }) {
    final result = create();
    if (nodes != null) result.nodes.addAll(nodes);
    if (total != null) result.total = total;
    if (page != null) result.page = page;
    if (size != null) result.size = size;
    return result;
  }

  ListNodesResponse._();

  factory ListNodesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListNodesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListNodesResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..pPM<Node>(1, _omitFieldNames ? '' : 'nodes', subBuilder: Node.create)
    ..aInt64(2, _omitFieldNames ? '' : 'total')
    ..aI(3, _omitFieldNames ? '' : 'page')
    ..aI(4, _omitFieldNames ? '' : 'size')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListNodesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListNodesResponse copyWith(void Function(ListNodesResponse) updates) =>
      super.copyWith((message) => updates(message as ListNodesResponse))
          as ListNodesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListNodesResponse create() => ListNodesResponse._();
  @$core.override
  ListNodesResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListNodesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListNodesResponse>(create);
  static ListNodesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Node> get nodes => $_getList(0);

  @$pb.TagNumber(2)
  $fixnum.Int64 get total => $_getI64(1);
  @$pb.TagNumber(2)
  set total($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTotal() => $_has(1);
  @$pb.TagNumber(2)
  void clearTotal() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get page => $_getIZ(2);
  @$pb.TagNumber(3)
  set page($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPage() => $_has(2);
  @$pb.TagNumber(3)
  void clearPage() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get size => $_getIZ(3);
  @$pb.TagNumber(4)
  set size($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasSize() => $_has(3);
  @$pb.TagNumber(4)
  void clearSize() => $_clearField(4);
}

class GetNodeRequest extends $pb.GeneratedMessage {
  factory GetNodeRequest({
    $core.String? nodeId,
  }) {
    final result = create();
    if (nodeId != null) result.nodeId = nodeId;
    return result;
  }

  GetNodeRequest._();

  factory GetNodeRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetNodeRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetNodeRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'nodeId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetNodeRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetNodeRequest copyWith(void Function(GetNodeRequest) updates) =>
      super.copyWith((message) => updates(message as GetNodeRequest))
          as GetNodeRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetNodeRequest create() => GetNodeRequest._();
  @$core.override
  GetNodeRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetNodeRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetNodeRequest>(create);
  static GetNodeRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get nodeId => $_getSZ(0);
  @$pb.TagNumber(1)
  set nodeId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasNodeId() => $_has(0);
  @$pb.TagNumber(1)
  void clearNodeId() => $_clearField(1);
}

class GetNodeResponse extends $pb.GeneratedMessage {
  factory GetNodeResponse({
    Node? node,
  }) {
    final result = create();
    if (node != null) result.node = node;
    return result;
  }

  GetNodeResponse._();

  factory GetNodeResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetNodeResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetNodeResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..aOM<Node>(1, _omitFieldNames ? '' : 'node', subBuilder: Node.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetNodeResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetNodeResponse copyWith(void Function(GetNodeResponse) updates) =>
      super.copyWith((message) => updates(message as GetNodeResponse))
          as GetNodeResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetNodeResponse create() => GetNodeResponse._();
  @$core.override
  GetNodeResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetNodeResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetNodeResponse>(create);
  static GetNodeResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Node get node => $_getN(0);
  @$pb.TagNumber(1)
  set node(Node value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasNode() => $_has(0);
  @$pb.TagNumber(1)
  void clearNode() => $_clearField(1);
  @$pb.TagNumber(1)
  Node ensureNode() => $_ensure(0);
}

class RegisterNodeRequest extends $pb.GeneratedMessage {
  factory RegisterNodeRequest({
    $core.String? name,
    $core.String? version,
    $core.Iterable<$core.String>? capabilities,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? metadata,
    $core.String? publicKey,
    $core.Iterable<$core.String>? addresses,
    $core.int? port,
  }) {
    final result = create();
    if (name != null) result.name = name;
    if (version != null) result.version = version;
    if (capabilities != null) result.capabilities.addAll(capabilities);
    if (metadata != null) result.metadata.addEntries(metadata);
    if (publicKey != null) result.publicKey = publicKey;
    if (addresses != null) result.addresses.addAll(addresses);
    if (port != null) result.port = port;
    return result;
  }

  RegisterNodeRequest._();

  factory RegisterNodeRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RegisterNodeRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RegisterNodeRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'name')
    ..aOS(2, _omitFieldNames ? '' : 'version')
    ..pPS(3, _omitFieldNames ? '' : 'capabilities')
    ..m<$core.String, $core.String>(4, _omitFieldNames ? '' : 'metadata',
        entryClassName: 'RegisterNodeRequest.MetadataEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.model.peer.v1'))
    ..aOS(5, _omitFieldNames ? '' : 'publicKey')
    ..pPS(6, _omitFieldNames ? '' : 'addresses')
    ..aI(7, _omitFieldNames ? '' : 'port')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RegisterNodeRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RegisterNodeRequest copyWith(void Function(RegisterNodeRequest) updates) =>
      super.copyWith((message) => updates(message as RegisterNodeRequest))
          as RegisterNodeRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RegisterNodeRequest create() => RegisterNodeRequest._();
  @$core.override
  RegisterNodeRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RegisterNodeRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RegisterNodeRequest>(create);
  static RegisterNodeRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get name => $_getSZ(0);
  @$pb.TagNumber(1)
  set name($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasName() => $_has(0);
  @$pb.TagNumber(1)
  void clearName() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get version => $_getSZ(1);
  @$pb.TagNumber(2)
  set version($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasVersion() => $_has(1);
  @$pb.TagNumber(2)
  void clearVersion() => $_clearField(2);

  @$pb.TagNumber(3)
  $pb.PbList<$core.String> get capabilities => $_getList(2);

  @$pb.TagNumber(4)
  $pb.PbMap<$core.String, $core.String> get metadata => $_getMap(3);

  @$pb.TagNumber(5)
  $core.String get publicKey => $_getSZ(4);
  @$pb.TagNumber(5)
  set publicKey($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasPublicKey() => $_has(4);
  @$pb.TagNumber(5)
  void clearPublicKey() => $_clearField(5);

  @$pb.TagNumber(6)
  $pb.PbList<$core.String> get addresses => $_getList(5);

  @$pb.TagNumber(7)
  $core.int get port => $_getIZ(6);
  @$pb.TagNumber(7)
  set port($core.int value) => $_setSignedInt32(6, value);
  @$pb.TagNumber(7)
  $core.bool hasPort() => $_has(6);
  @$pb.TagNumber(7)
  void clearPort() => $_clearField(7);
}

class RegisterNodeResponse extends $pb.GeneratedMessage {
  factory RegisterNodeResponse({
    Node? node,
  }) {
    final result = create();
    if (node != null) result.node = node;
    return result;
  }

  RegisterNodeResponse._();

  factory RegisterNodeResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory RegisterNodeResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RegisterNodeResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..aOM<Node>(1, _omitFieldNames ? '' : 'node', subBuilder: Node.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RegisterNodeResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RegisterNodeResponse copyWith(void Function(RegisterNodeResponse) updates) =>
      super.copyWith((message) => updates(message as RegisterNodeResponse))
          as RegisterNodeResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static RegisterNodeResponse create() => RegisterNodeResponse._();
  @$core.override
  RegisterNodeResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static RegisterNodeResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RegisterNodeResponse>(create);
  static RegisterNodeResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Node get node => $_getN(0);
  @$pb.TagNumber(1)
  set node(Node value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasNode() => $_has(0);
  @$pb.TagNumber(1)
  void clearNode() => $_clearField(1);
  @$pb.TagNumber(1)
  Node ensureNode() => $_ensure(0);
}

class DeregisterNodeRequest extends $pb.GeneratedMessage {
  factory DeregisterNodeRequest({
    $core.String? nodeId,
  }) {
    final result = create();
    if (nodeId != null) result.nodeId = nodeId;
    return result;
  }

  DeregisterNodeRequest._();

  factory DeregisterNodeRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory DeregisterNodeRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeregisterNodeRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'nodeId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeregisterNodeRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeregisterNodeRequest copyWith(
          void Function(DeregisterNodeRequest) updates) =>
      super.copyWith((message) => updates(message as DeregisterNodeRequest))
          as DeregisterNodeRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static DeregisterNodeRequest create() => DeregisterNodeRequest._();
  @$core.override
  DeregisterNodeRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static DeregisterNodeRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeregisterNodeRequest>(create);
  static DeregisterNodeRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get nodeId => $_getSZ(0);
  @$pb.TagNumber(1)
  set nodeId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasNodeId() => $_has(0);
  @$pb.TagNumber(1)
  void clearNodeId() => $_clearField(1);
}

class DeregisterNodeResponse extends $pb.GeneratedMessage {
  factory DeregisterNodeResponse({
    $core.bool? success,
    $core.String? nodeId,
  }) {
    final result = create();
    if (success != null) result.success = success;
    if (nodeId != null) result.nodeId = nodeId;
    return result;
  }

  DeregisterNodeResponse._();

  factory DeregisterNodeResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory DeregisterNodeResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeregisterNodeResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.peer.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..aOS(2, _omitFieldNames ? '' : 'nodeId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeregisterNodeResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeregisterNodeResponse copyWith(
          void Function(DeregisterNodeResponse) updates) =>
      super.copyWith((message) => updates(message as DeregisterNodeResponse))
          as DeregisterNodeResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static DeregisterNodeResponse create() => DeregisterNodeResponse._();
  @$core.override
  DeregisterNodeResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static DeregisterNodeResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeregisterNodeResponse>(create);
  static DeregisterNodeResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get nodeId => $_getSZ(1);
  @$pb.TagNumber(2)
  set nodeId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNodeId() => $_has(1);
  @$pb.TagNumber(2)
  void clearNodeId() => $_clearField(2);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
