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

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
