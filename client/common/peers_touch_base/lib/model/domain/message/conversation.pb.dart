// This is a generated file - do not edit.
//
// Generated from domain/message/conversation.proto.

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

/// Conversation management
class CreateConvRequest extends $pb.GeneratedMessage {
  factory CreateConvRequest({
    $core.String? convId,
    $core.String? type,
    $core.String? title,
    $core.String? avatarCid,
    $core.String? policy,
  }) {
    final result = create();
    if (convId != null) result.convId = convId;
    if (type != null) result.type = type;
    if (title != null) result.title = title;
    if (avatarCid != null) result.avatarCid = avatarCid;
    if (policy != null) result.policy = policy;
    return result;
  }

  CreateConvRequest._();

  factory CreateConvRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateConvRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateConvRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'convId')
    ..aOS(2, _omitFieldNames ? '' : 'type')
    ..aOS(3, _omitFieldNames ? '' : 'title')
    ..aOS(4, _omitFieldNames ? '' : 'avatarCid')
    ..aOS(5, _omitFieldNames ? '' : 'policy')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateConvRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateConvRequest copyWith(void Function(CreateConvRequest) updates) =>
      super.copyWith((message) => updates(message as CreateConvRequest))
          as CreateConvRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateConvRequest create() => CreateConvRequest._();
  @$core.override
  CreateConvRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateConvRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateConvRequest>(create);
  static CreateConvRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get convId => $_getSZ(0);
  @$pb.TagNumber(1)
  set convId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConvId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConvId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get type => $_getSZ(1);
  @$pb.TagNumber(2)
  set type($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasType() => $_has(1);
  @$pb.TagNumber(2)
  void clearType() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get title => $_getSZ(2);
  @$pb.TagNumber(3)
  set title($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTitle() => $_has(2);
  @$pb.TagNumber(3)
  void clearTitle() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get avatarCid => $_getSZ(3);
  @$pb.TagNumber(4)
  set avatarCid($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasAvatarCid() => $_has(3);
  @$pb.TagNumber(4)
  void clearAvatarCid() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get policy => $_getSZ(4);
  @$pb.TagNumber(5)
  set policy($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasPolicy() => $_has(4);
  @$pb.TagNumber(5)
  void clearPolicy() => $_clearField(5);
}

class Conversation extends $pb.GeneratedMessage {
  factory Conversation({
    $fixnum.Int64? pk,
    $core.String? convId,
    $core.String? type,
    $core.String? title,
    $core.String? avatarCid,
    $core.String? policy,
    $core.int? epoch,
    $0.Timestamp? createdAt,
    $0.Timestamp? updatedAt,
  }) {
    final result = create();
    if (pk != null) result.pk = pk;
    if (convId != null) result.convId = convId;
    if (type != null) result.type = type;
    if (title != null) result.title = title;
    if (avatarCid != null) result.avatarCid = avatarCid;
    if (policy != null) result.policy = policy;
    if (epoch != null) result.epoch = epoch;
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
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'pk', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..aOS(2, _omitFieldNames ? '' : 'convId')
    ..aOS(3, _omitFieldNames ? '' : 'type')
    ..aOS(4, _omitFieldNames ? '' : 'title')
    ..aOS(5, _omitFieldNames ? '' : 'avatarCid')
    ..aOS(6, _omitFieldNames ? '' : 'policy')
    ..aI(7, _omitFieldNames ? '' : 'epoch', fieldType: $pb.PbFieldType.OU3)
    ..aOM<$0.Timestamp>(8, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..aOM<$0.Timestamp>(9, _omitFieldNames ? '' : 'updatedAt',
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
  $fixnum.Int64 get pk => $_getI64(0);
  @$pb.TagNumber(1)
  set pk($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPk() => $_has(0);
  @$pb.TagNumber(1)
  void clearPk() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get convId => $_getSZ(1);
  @$pb.TagNumber(2)
  set convId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasConvId() => $_has(1);
  @$pb.TagNumber(2)
  void clearConvId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get type => $_getSZ(2);
  @$pb.TagNumber(3)
  set type($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasType() => $_has(2);
  @$pb.TagNumber(3)
  void clearType() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get title => $_getSZ(3);
  @$pb.TagNumber(4)
  set title($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasTitle() => $_has(3);
  @$pb.TagNumber(4)
  void clearTitle() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get avatarCid => $_getSZ(4);
  @$pb.TagNumber(5)
  set avatarCid($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasAvatarCid() => $_has(4);
  @$pb.TagNumber(5)
  void clearAvatarCid() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get policy => $_getSZ(5);
  @$pb.TagNumber(6)
  set policy($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasPolicy() => $_has(5);
  @$pb.TagNumber(6)
  void clearPolicy() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.int get epoch => $_getIZ(6);
  @$pb.TagNumber(7)
  set epoch($core.int value) => $_setUnsignedInt32(6, value);
  @$pb.TagNumber(7)
  $core.bool hasEpoch() => $_has(6);
  @$pb.TagNumber(7)
  void clearEpoch() => $_clearField(7);

  @$pb.TagNumber(8)
  $0.Timestamp get createdAt => $_getN(7);
  @$pb.TagNumber(8)
  set createdAt($0.Timestamp value) => $_setField(8, value);
  @$pb.TagNumber(8)
  $core.bool hasCreatedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearCreatedAt() => $_clearField(8);
  @$pb.TagNumber(8)
  $0.Timestamp ensureCreatedAt() => $_ensure(7);

  @$pb.TagNumber(9)
  $0.Timestamp get updatedAt => $_getN(8);
  @$pb.TagNumber(9)
  set updatedAt($0.Timestamp value) => $_setField(9, value);
  @$pb.TagNumber(9)
  $core.bool hasUpdatedAt() => $_has(8);
  @$pb.TagNumber(9)
  void clearUpdatedAt() => $_clearField(9);
  @$pb.TagNumber(9)
  $0.Timestamp ensureUpdatedAt() => $_ensure(8);
}

class CreateConvResponse extends $pb.GeneratedMessage {
  factory CreateConvResponse({
    Conversation? conv,
  }) {
    final result = create();
    if (conv != null) result.conv = conv;
    return result;
  }

  CreateConvResponse._();

  factory CreateConvResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory CreateConvResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateConvResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOM<Conversation>(1, _omitFieldNames ? '' : 'conv',
        subBuilder: Conversation.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateConvResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateConvResponse copyWith(void Function(CreateConvResponse) updates) =>
      super.copyWith((message) => updates(message as CreateConvResponse))
          as CreateConvResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static CreateConvResponse create() => CreateConvResponse._();
  @$core.override
  CreateConvResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static CreateConvResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateConvResponse>(create);
  static CreateConvResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Conversation get conv => $_getN(0);
  @$pb.TagNumber(1)
  set conv(Conversation value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasConv() => $_has(0);
  @$pb.TagNumber(1)
  void clearConv() => $_clearField(1);
  @$pb.TagNumber(1)
  Conversation ensureConv() => $_ensure(0);
}

class GetConvRequest extends $pb.GeneratedMessage {
  factory GetConvRequest({
    $core.String? id,
  }) {
    final result = create();
    if (id != null) result.id = id;
    return result;
  }

  GetConvRequest._();

  factory GetConvRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetConvRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetConvRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetConvRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetConvRequest copyWith(void Function(GetConvRequest) updates) =>
      super.copyWith((message) => updates(message as GetConvRequest))
          as GetConvRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetConvRequest create() => GetConvRequest._();
  @$core.override
  GetConvRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetConvRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetConvRequest>(create);
  static GetConvRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);
}

class GetConvResponse extends $pb.GeneratedMessage {
  factory GetConvResponse({
    Conversation? conv,
  }) {
    final result = create();
    if (conv != null) result.conv = conv;
    return result;
  }

  GetConvResponse._();

  factory GetConvResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetConvResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetConvResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOM<Conversation>(1, _omitFieldNames ? '' : 'conv',
        subBuilder: Conversation.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetConvResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetConvResponse copyWith(void Function(GetConvResponse) updates) =>
      super.copyWith((message) => updates(message as GetConvResponse))
          as GetConvResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetConvResponse create() => GetConvResponse._();
  @$core.override
  GetConvResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetConvResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetConvResponse>(create);
  static GetConvResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Conversation get conv => $_getN(0);
  @$pb.TagNumber(1)
  set conv(Conversation value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasConv() => $_has(0);
  @$pb.TagNumber(1)
  void clearConv() => $_clearField(1);
  @$pb.TagNumber(1)
  Conversation ensureConv() => $_ensure(0);
}

class GetConvStateRequest extends $pb.GeneratedMessage {
  factory GetConvStateRequest({
    $core.String? id,
  }) {
    final result = create();
    if (id != null) result.id = id;
    return result;
  }

  GetConvStateRequest._();

  factory GetConvStateRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetConvStateRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetConvStateRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetConvStateRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetConvStateRequest copyWith(void Function(GetConvStateRequest) updates) =>
      super.copyWith((message) => updates(message as GetConvStateRequest))
          as GetConvStateRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetConvStateRequest create() => GetConvStateRequest._();
  @$core.override
  GetConvStateRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetConvStateRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetConvStateRequest>(create);
  static GetConvStateRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);
}

class GetConvStateResponse extends $pb.GeneratedMessage {
  factory GetConvStateResponse({
    $core.int? epoch,
  }) {
    final result = create();
    if (epoch != null) result.epoch = epoch;
    return result;
  }

  GetConvStateResponse._();

  factory GetConvStateResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetConvStateResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetConvStateResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'epoch', fieldType: $pb.PbFieldType.OU3)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetConvStateResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetConvStateResponse copyWith(void Function(GetConvStateResponse) updates) =>
      super.copyWith((message) => updates(message as GetConvStateResponse))
          as GetConvStateResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetConvStateResponse create() => GetConvStateResponse._();
  @$core.override
  GetConvStateResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetConvStateResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetConvStateResponse>(create);
  static GetConvStateResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get epoch => $_getIZ(0);
  @$pb.TagNumber(1)
  set epoch($core.int value) => $_setUnsignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasEpoch() => $_has(0);
  @$pb.TagNumber(1)
  void clearEpoch() => $_clearField(1);
}

/// Members
class UpdateMembersRequest extends $pb.GeneratedMessage {
  factory UpdateMembersRequest({
    $fixnum.Int64? convPk,
    $core.Iterable<$core.String>? add,
    $core.Iterable<$core.String>? remove,
    $core.String? role,
  }) {
    final result = create();
    if (convPk != null) result.convPk = convPk;
    if (add != null) result.add.addAll(add);
    if (remove != null) result.remove.addAll(remove);
    if (role != null) result.role = role;
    return result;
  }

  UpdateMembersRequest._();

  factory UpdateMembersRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateMembersRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateMembersRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'convPk', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..pPS(2, _omitFieldNames ? '' : 'add')
    ..pPS(3, _omitFieldNames ? '' : 'remove')
    ..aOS(4, _omitFieldNames ? '' : 'role')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateMembersRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateMembersRequest copyWith(void Function(UpdateMembersRequest) updates) =>
      super.copyWith((message) => updates(message as UpdateMembersRequest))
          as UpdateMembersRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateMembersRequest create() => UpdateMembersRequest._();
  @$core.override
  UpdateMembersRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateMembersRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateMembersRequest>(create);
  static UpdateMembersRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $fixnum.Int64 get convPk => $_getI64(0);
  @$pb.TagNumber(1)
  set convPk($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConvPk() => $_has(0);
  @$pb.TagNumber(1)
  void clearConvPk() => $_clearField(1);

  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get add => $_getList(1);

  @$pb.TagNumber(3)
  $pb.PbList<$core.String> get remove => $_getList(2);

  @$pb.TagNumber(4)
  $core.String get role => $_getSZ(3);
  @$pb.TagNumber(4)
  set role($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasRole() => $_has(3);
  @$pb.TagNumber(4)
  void clearRole() => $_clearField(4);
}

class UpdateMembersResponse extends $pb.GeneratedMessage {
  factory UpdateMembersResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  UpdateMembersResponse._();

  factory UpdateMembersResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateMembersResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateMembersResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateMembersResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateMembersResponse copyWith(
          void Function(UpdateMembersResponse) updates) =>
      super.copyWith((message) => updates(message as UpdateMembersResponse))
          as UpdateMembersResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateMembersResponse create() => UpdateMembersResponse._();
  @$core.override
  UpdateMembersResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateMembersResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateMembersResponse>(create);
  static UpdateMembersResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

class GetMembersRequest extends $pb.GeneratedMessage {
  factory GetMembersRequest({
    $core.String? convId,
  }) {
    final result = create();
    if (convId != null) result.convId = convId;
    return result;
  }

  GetMembersRequest._();

  factory GetMembersRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetMembersRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMembersRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'convId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMembersRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMembersRequest copyWith(void Function(GetMembersRequest) updates) =>
      super.copyWith((message) => updates(message as GetMembersRequest))
          as GetMembersRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetMembersRequest create() => GetMembersRequest._();
  @$core.override
  GetMembersRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetMembersRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMembersRequest>(create);
  static GetMembersRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get convId => $_getSZ(0);
  @$pb.TagNumber(1)
  set convId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConvId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConvId() => $_clearField(1);
}

class ConvMember extends $pb.GeneratedMessage {
  factory ConvMember({
    $core.String? did,
    $core.String? role,
    $0.Timestamp? joinedAt,
  }) {
    final result = create();
    if (did != null) result.did = did;
    if (role != null) result.role = role;
    if (joinedAt != null) result.joinedAt = joinedAt;
    return result;
  }

  ConvMember._();

  factory ConvMember.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ConvMember.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ConvMember',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'did')
    ..aOS(2, _omitFieldNames ? '' : 'role')
    ..aOM<$0.Timestamp>(3, _omitFieldNames ? '' : 'joinedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ConvMember clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ConvMember copyWith(void Function(ConvMember) updates) =>
      super.copyWith((message) => updates(message as ConvMember)) as ConvMember;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ConvMember create() => ConvMember._();
  @$core.override
  ConvMember createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ConvMember getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ConvMember>(create);
  static ConvMember? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get did => $_getSZ(0);
  @$pb.TagNumber(1)
  set did($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasDid() => $_has(0);
  @$pb.TagNumber(1)
  void clearDid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get role => $_getSZ(1);
  @$pb.TagNumber(2)
  set role($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasRole() => $_has(1);
  @$pb.TagNumber(2)
  void clearRole() => $_clearField(2);

  @$pb.TagNumber(3)
  $0.Timestamp get joinedAt => $_getN(2);
  @$pb.TagNumber(3)
  set joinedAt($0.Timestamp value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasJoinedAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearJoinedAt() => $_clearField(3);
  @$pb.TagNumber(3)
  $0.Timestamp ensureJoinedAt() => $_ensure(2);
}

class GetMembersResponse extends $pb.GeneratedMessage {
  factory GetMembersResponse({
    $core.Iterable<ConvMember>? members,
  }) {
    final result = create();
    if (members != null) result.members.addAll(members);
    return result;
  }

  GetMembersResponse._();

  factory GetMembersResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetMembersResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMembersResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..pPM<ConvMember>(1, _omitFieldNames ? '' : 'members',
        subBuilder: ConvMember.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMembersResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMembersResponse copyWith(void Function(GetMembersResponse) updates) =>
      super.copyWith((message) => updates(message as GetMembersResponse))
          as GetMembersResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetMembersResponse create() => GetMembersResponse._();
  @$core.override
  GetMembersResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetMembersResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMembersResponse>(create);
  static GetMembersResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<ConvMember> get members => $_getList(0);
}

/// Key rotation
class KeyRotateRequest extends $pb.GeneratedMessage {
  factory KeyRotateRequest({
    $core.String? convId,
    $core.int? epoch,
    $core.Iterable<KeyPackage>? packages,
  }) {
    final result = create();
    if (convId != null) result.convId = convId;
    if (epoch != null) result.epoch = epoch;
    if (packages != null) result.packages.addAll(packages);
    return result;
  }

  KeyRotateRequest._();

  factory KeyRotateRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory KeyRotateRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'KeyRotateRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'convId')
    ..aI(2, _omitFieldNames ? '' : 'epoch', fieldType: $pb.PbFieldType.OU3)
    ..pPM<KeyPackage>(3, _omitFieldNames ? '' : 'packages',
        subBuilder: KeyPackage.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  KeyRotateRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  KeyRotateRequest copyWith(void Function(KeyRotateRequest) updates) =>
      super.copyWith((message) => updates(message as KeyRotateRequest))
          as KeyRotateRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static KeyRotateRequest create() => KeyRotateRequest._();
  @$core.override
  KeyRotateRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static KeyRotateRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<KeyRotateRequest>(create);
  static KeyRotateRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get convId => $_getSZ(0);
  @$pb.TagNumber(1)
  set convId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConvId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConvId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get epoch => $_getIZ(1);
  @$pb.TagNumber(2)
  set epoch($core.int value) => $_setUnsignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEpoch() => $_has(1);
  @$pb.TagNumber(2)
  void clearEpoch() => $_clearField(2);

  @$pb.TagNumber(3)
  $pb.PbList<KeyPackage> get packages => $_getList(2);
}

class KeyPackage extends $pb.GeneratedMessage {
  factory KeyPackage({
    $core.String? did,
    $core.List<$core.int>? package,
  }) {
    final result = create();
    if (did != null) result.did = did;
    if (package != null) result.package = package;
    return result;
  }

  KeyPackage._();

  factory KeyPackage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory KeyPackage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'KeyPackage',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'did')
    ..a<$core.List<$core.int>>(
        2, _omitFieldNames ? '' : 'package', $pb.PbFieldType.OY)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  KeyPackage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  KeyPackage copyWith(void Function(KeyPackage) updates) =>
      super.copyWith((message) => updates(message as KeyPackage)) as KeyPackage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static KeyPackage create() => KeyPackage._();
  @$core.override
  KeyPackage createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static KeyPackage getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<KeyPackage>(create);
  static KeyPackage? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get did => $_getSZ(0);
  @$pb.TagNumber(1)
  set did($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasDid() => $_has(0);
  @$pb.TagNumber(1)
  void clearDid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.List<$core.int> get package => $_getN(1);
  @$pb.TagNumber(2)
  set package($core.List<$core.int> value) => $_setBytes(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPackage() => $_has(1);
  @$pb.TagNumber(2)
  void clearPackage() => $_clearField(2);
}

class KeyRotateResponse extends $pb.GeneratedMessage {
  factory KeyRotateResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  KeyRotateResponse._();

  factory KeyRotateResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory KeyRotateResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'KeyRotateResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  KeyRotateResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  KeyRotateResponse copyWith(void Function(KeyRotateResponse) updates) =>
      super.copyWith((message) => updates(message as KeyRotateResponse))
          as KeyRotateResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static KeyRotateResponse create() => KeyRotateResponse._();
  @$core.override
  KeyRotateResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static KeyRotateResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<KeyRotateResponse>(create);
  static KeyRotateResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

/// Messages
class AppendMessageRequest extends $pb.GeneratedMessage {
  factory AppendMessageRequest({
    $core.String? convId,
    $core.List<$core.int>? encryptedContent,
    $core.String? timestamp,
  }) {
    final result = create();
    if (convId != null) result.convId = convId;
    if (encryptedContent != null) result.encryptedContent = encryptedContent;
    if (timestamp != null) result.timestamp = timestamp;
    return result;
  }

  AppendMessageRequest._();

  factory AppendMessageRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory AppendMessageRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AppendMessageRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'convId')
    ..a<$core.List<$core.int>>(
        2, _omitFieldNames ? '' : 'encryptedContent', $pb.PbFieldType.OY)
    ..aOS(3, _omitFieldNames ? '' : 'timestamp')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AppendMessageRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AppendMessageRequest copyWith(void Function(AppendMessageRequest) updates) =>
      super.copyWith((message) => updates(message as AppendMessageRequest))
          as AppendMessageRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AppendMessageRequest create() => AppendMessageRequest._();
  @$core.override
  AppendMessageRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static AppendMessageRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AppendMessageRequest>(create);
  static AppendMessageRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get convId => $_getSZ(0);
  @$pb.TagNumber(1)
  set convId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConvId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConvId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.List<$core.int> get encryptedContent => $_getN(1);
  @$pb.TagNumber(2)
  set encryptedContent($core.List<$core.int> value) => $_setBytes(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEncryptedContent() => $_has(1);
  @$pb.TagNumber(2)
  void clearEncryptedContent() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get timestamp => $_getSZ(2);
  @$pb.TagNumber(3)
  set timestamp($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTimestamp() => $_has(2);
  @$pb.TagNumber(3)
  void clearTimestamp() => $_clearField(3);
}

class Message extends $pb.GeneratedMessage {
  factory Message({
    $fixnum.Int64? id,
    $core.String? convId,
    $core.String? senderDid,
    $core.List<$core.int>? encryptedContent,
    $core.int? epoch,
    $0.Timestamp? timestamp,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (convId != null) result.convId = convId;
    if (senderDid != null) result.senderDid = senderDid;
    if (encryptedContent != null) result.encryptedContent = encryptedContent;
    if (epoch != null) result.epoch = epoch;
    if (timestamp != null) result.timestamp = timestamp;
    return result;
  }

  Message._();

  factory Message.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Message.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Message',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..a<$fixnum.Int64>(1, _omitFieldNames ? '' : 'id', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..aOS(2, _omitFieldNames ? '' : 'convId')
    ..aOS(3, _omitFieldNames ? '' : 'senderDid')
    ..a<$core.List<$core.int>>(
        4, _omitFieldNames ? '' : 'encryptedContent', $pb.PbFieldType.OY)
    ..aI(5, _omitFieldNames ? '' : 'epoch', fieldType: $pb.PbFieldType.OU3)
    ..aOM<$0.Timestamp>(6, _omitFieldNames ? '' : 'timestamp',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Message clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Message copyWith(void Function(Message) updates) =>
      super.copyWith((message) => updates(message as Message)) as Message;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Message create() => Message._();
  @$core.override
  Message createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Message getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Message>(create);
  static Message? _defaultInstance;

  @$pb.TagNumber(1)
  $fixnum.Int64 get id => $_getI64(0);
  @$pb.TagNumber(1)
  set id($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get convId => $_getSZ(1);
  @$pb.TagNumber(2)
  set convId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasConvId() => $_has(1);
  @$pb.TagNumber(2)
  void clearConvId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get senderDid => $_getSZ(2);
  @$pb.TagNumber(3)
  set senderDid($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSenderDid() => $_has(2);
  @$pb.TagNumber(3)
  void clearSenderDid() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.List<$core.int> get encryptedContent => $_getN(3);
  @$pb.TagNumber(4)
  set encryptedContent($core.List<$core.int> value) => $_setBytes(3, value);
  @$pb.TagNumber(4)
  $core.bool hasEncryptedContent() => $_has(3);
  @$pb.TagNumber(4)
  void clearEncryptedContent() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.int get epoch => $_getIZ(4);
  @$pb.TagNumber(5)
  set epoch($core.int value) => $_setUnsignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasEpoch() => $_has(4);
  @$pb.TagNumber(5)
  void clearEpoch() => $_clearField(5);

  @$pb.TagNumber(6)
  $0.Timestamp get timestamp => $_getN(5);
  @$pb.TagNumber(6)
  set timestamp($0.Timestamp value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasTimestamp() => $_has(5);
  @$pb.TagNumber(6)
  void clearTimestamp() => $_clearField(6);
  @$pb.TagNumber(6)
  $0.Timestamp ensureTimestamp() => $_ensure(5);
}

class AppendMessageResponse extends $pb.GeneratedMessage {
  factory AppendMessageResponse({
    Message? message,
  }) {
    final result = create();
    if (message != null) result.message = message;
    return result;
  }

  AppendMessageResponse._();

  factory AppendMessageResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory AppendMessageResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AppendMessageResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOM<Message>(1, _omitFieldNames ? '' : 'message',
        subBuilder: Message.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AppendMessageResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AppendMessageResponse copyWith(
          void Function(AppendMessageResponse) updates) =>
      super.copyWith((message) => updates(message as AppendMessageResponse))
          as AppendMessageResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AppendMessageResponse create() => AppendMessageResponse._();
  @$core.override
  AppendMessageResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static AppendMessageResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AppendMessageResponse>(create);
  static AppendMessageResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Message get message => $_getN(0);
  @$pb.TagNumber(1)
  set message(Message value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasMessage() => $_has(0);
  @$pb.TagNumber(1)
  void clearMessage() => $_clearField(1);
  @$pb.TagNumber(1)
  Message ensureMessage() => $_ensure(0);
}

class ListMessagesRequest extends $pb.GeneratedMessage {
  factory ListMessagesRequest({
    $core.String? convId,
    $fixnum.Int64? beforeId,
    $core.int? limit,
  }) {
    final result = create();
    if (convId != null) result.convId = convId;
    if (beforeId != null) result.beforeId = beforeId;
    if (limit != null) result.limit = limit;
    return result;
  }

  ListMessagesRequest._();

  factory ListMessagesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListMessagesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMessagesRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'convId')
    ..a<$fixnum.Int64>(
        2, _omitFieldNames ? '' : 'beforeId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMessagesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMessagesRequest copyWith(void Function(ListMessagesRequest) updates) =>
      super.copyWith((message) => updates(message as ListMessagesRequest))
          as ListMessagesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListMessagesRequest create() => ListMessagesRequest._();
  @$core.override
  ListMessagesRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListMessagesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMessagesRequest>(create);
  static ListMessagesRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get convId => $_getSZ(0);
  @$pb.TagNumber(1)
  set convId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConvId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConvId() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get beforeId => $_getI64(1);
  @$pb.TagNumber(2)
  set beforeId($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasBeforeId() => $_has(1);
  @$pb.TagNumber(2)
  void clearBeforeId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);
}

class ListMessagesResponse extends $pb.GeneratedMessage {
  factory ListMessagesResponse({
    $core.Iterable<Message>? messages,
    $core.bool? hasMore,
  }) {
    final result = create();
    if (messages != null) result.messages.addAll(messages);
    if (hasMore != null) result.hasMore = hasMore;
    return result;
  }

  ListMessagesResponse._();

  factory ListMessagesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListMessagesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMessagesResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..pPM<Message>(1, _omitFieldNames ? '' : 'messages',
        subBuilder: Message.create)
    ..aOB(2, _omitFieldNames ? '' : 'hasMore')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMessagesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMessagesResponse copyWith(void Function(ListMessagesResponse) updates) =>
      super.copyWith((message) => updates(message as ListMessagesResponse))
          as ListMessagesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListMessagesResponse create() => ListMessagesResponse._();
  @$core.override
  ListMessagesResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListMessagesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMessagesResponse>(create);
  static ListMessagesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Message> get messages => $_getList(0);

  @$pb.TagNumber(2)
  $core.bool get hasMore => $_getBF(1);
  @$pb.TagNumber(2)
  set hasMore($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasHasMore() => $_has(1);
  @$pb.TagNumber(2)
  void clearHasMore() => $_clearField(2);
}

class StreamMessagesRequest extends $pb.GeneratedMessage {
  factory StreamMessagesRequest({
    $core.String? convId,
    $fixnum.Int64? sinceId,
  }) {
    final result = create();
    if (convId != null) result.convId = convId;
    if (sinceId != null) result.sinceId = sinceId;
    return result;
  }

  StreamMessagesRequest._();

  factory StreamMessagesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory StreamMessagesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'StreamMessagesRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'convId')
    ..a<$fixnum.Int64>(2, _omitFieldNames ? '' : 'sinceId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StreamMessagesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StreamMessagesRequest copyWith(
          void Function(StreamMessagesRequest) updates) =>
      super.copyWith((message) => updates(message as StreamMessagesRequest))
          as StreamMessagesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static StreamMessagesRequest create() => StreamMessagesRequest._();
  @$core.override
  StreamMessagesRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static StreamMessagesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<StreamMessagesRequest>(create);
  static StreamMessagesRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get convId => $_getSZ(0);
  @$pb.TagNumber(1)
  set convId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConvId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConvId() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get sinceId => $_getI64(1);
  @$pb.TagNumber(2)
  set sinceId($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSinceId() => $_has(1);
  @$pb.TagNumber(2)
  void clearSinceId() => $_clearField(2);
}

class StreamMessagesResponse extends $pb.GeneratedMessage {
  factory StreamMessagesResponse({
    $core.Iterable<Message>? messages,
  }) {
    final result = create();
    if (messages != null) result.messages.addAll(messages);
    return result;
  }

  StreamMessagesResponse._();

  factory StreamMessagesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory StreamMessagesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'StreamMessagesResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..pPM<Message>(1, _omitFieldNames ? '' : 'messages',
        subBuilder: Message.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StreamMessagesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StreamMessagesResponse copyWith(
          void Function(StreamMessagesResponse) updates) =>
      super.copyWith((message) => updates(message as StreamMessagesResponse))
          as StreamMessagesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static StreamMessagesResponse create() => StreamMessagesResponse._();
  @$core.override
  StreamMessagesResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static StreamMessagesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<StreamMessagesResponse>(create);
  static StreamMessagesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Message> get messages => $_getList(0);
}

/// Receipts
class PostReceiptRequest extends $pb.GeneratedMessage {
  factory PostReceiptRequest({
    $core.String? convId,
    $fixnum.Int64? messageId,
    $core.String? type,
  }) {
    final result = create();
    if (convId != null) result.convId = convId;
    if (messageId != null) result.messageId = messageId;
    if (type != null) result.type = type;
    return result;
  }

  PostReceiptRequest._();

  factory PostReceiptRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostReceiptRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostReceiptRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'convId')
    ..a<$fixnum.Int64>(
        2, _omitFieldNames ? '' : 'messageId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..aOS(3, _omitFieldNames ? '' : 'type')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostReceiptRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostReceiptRequest copyWith(void Function(PostReceiptRequest) updates) =>
      super.copyWith((message) => updates(message as PostReceiptRequest))
          as PostReceiptRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostReceiptRequest create() => PostReceiptRequest._();
  @$core.override
  PostReceiptRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostReceiptRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostReceiptRequest>(create);
  static PostReceiptRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get convId => $_getSZ(0);
  @$pb.TagNumber(1)
  set convId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConvId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConvId() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get messageId => $_getI64(1);
  @$pb.TagNumber(2)
  set messageId($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasMessageId() => $_has(1);
  @$pb.TagNumber(2)
  void clearMessageId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get type => $_getSZ(2);
  @$pb.TagNumber(3)
  set type($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasType() => $_has(2);
  @$pb.TagNumber(3)
  void clearType() => $_clearField(3);
}

class PostReceiptResponse extends $pb.GeneratedMessage {
  factory PostReceiptResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  PostReceiptResponse._();

  factory PostReceiptResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostReceiptResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostReceiptResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostReceiptResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostReceiptResponse copyWith(void Function(PostReceiptResponse) updates) =>
      super.copyWith((message) => updates(message as PostReceiptResponse))
          as PostReceiptResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostReceiptResponse create() => PostReceiptResponse._();
  @$core.override
  PostReceiptResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostReceiptResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostReceiptResponse>(create);
  static PostReceiptResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

class GetReceiptsRequest extends $pb.GeneratedMessage {
  factory GetReceiptsRequest({
    $core.String? convId,
    $fixnum.Int64? messageId,
  }) {
    final result = create();
    if (convId != null) result.convId = convId;
    if (messageId != null) result.messageId = messageId;
    return result;
  }

  GetReceiptsRequest._();

  factory GetReceiptsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetReceiptsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetReceiptsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'convId')
    ..a<$fixnum.Int64>(
        2, _omitFieldNames ? '' : 'messageId', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetReceiptsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetReceiptsRequest copyWith(void Function(GetReceiptsRequest) updates) =>
      super.copyWith((message) => updates(message as GetReceiptsRequest))
          as GetReceiptsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetReceiptsRequest create() => GetReceiptsRequest._();
  @$core.override
  GetReceiptsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetReceiptsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetReceiptsRequest>(create);
  static GetReceiptsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get convId => $_getSZ(0);
  @$pb.TagNumber(1)
  set convId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConvId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConvId() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get messageId => $_getI64(1);
  @$pb.TagNumber(2)
  set messageId($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasMessageId() => $_has(1);
  @$pb.TagNumber(2)
  void clearMessageId() => $_clearField(2);
}

class Receipt extends $pb.GeneratedMessage {
  factory Receipt({
    $core.String? did,
    $core.String? type,
    $0.Timestamp? timestamp,
  }) {
    final result = create();
    if (did != null) result.did = did;
    if (type != null) result.type = type;
    if (timestamp != null) result.timestamp = timestamp;
    return result;
  }

  Receipt._();

  factory Receipt.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Receipt.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Receipt',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'did')
    ..aOS(2, _omitFieldNames ? '' : 'type')
    ..aOM<$0.Timestamp>(3, _omitFieldNames ? '' : 'timestamp',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Receipt clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Receipt copyWith(void Function(Receipt) updates) =>
      super.copyWith((message) => updates(message as Receipt)) as Receipt;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Receipt create() => Receipt._();
  @$core.override
  Receipt createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Receipt getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Receipt>(create);
  static Receipt? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get did => $_getSZ(0);
  @$pb.TagNumber(1)
  set did($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasDid() => $_has(0);
  @$pb.TagNumber(1)
  void clearDid() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get type => $_getSZ(1);
  @$pb.TagNumber(2)
  set type($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasType() => $_has(1);
  @$pb.TagNumber(2)
  void clearType() => $_clearField(2);

  @$pb.TagNumber(3)
  $0.Timestamp get timestamp => $_getN(2);
  @$pb.TagNumber(3)
  set timestamp($0.Timestamp value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasTimestamp() => $_has(2);
  @$pb.TagNumber(3)
  void clearTimestamp() => $_clearField(3);
  @$pb.TagNumber(3)
  $0.Timestamp ensureTimestamp() => $_ensure(2);
}

class GetReceiptsResponse extends $pb.GeneratedMessage {
  factory GetReceiptsResponse({
    $core.Iterable<Receipt>? receipts,
  }) {
    final result = create();
    if (receipts != null) result.receipts.addAll(receipts);
    return result;
  }

  GetReceiptsResponse._();

  factory GetReceiptsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetReceiptsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetReceiptsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..pPM<Receipt>(1, _omitFieldNames ? '' : 'receipts',
        subBuilder: Receipt.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetReceiptsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetReceiptsResponse copyWith(void Function(GetReceiptsResponse) updates) =>
      super.copyWith((message) => updates(message as GetReceiptsResponse))
          as GetReceiptsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetReceiptsResponse create() => GetReceiptsResponse._();
  @$core.override
  GetReceiptsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetReceiptsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetReceiptsResponse>(create);
  static GetReceiptsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Receipt> get receipts => $_getList(0);
}

/// Attachments
class PostAttachmentRequest extends $pb.GeneratedMessage {
  factory PostAttachmentRequest({
    $core.String? convId,
    $core.String? filename,
    $core.String? mimeType,
    $core.List<$core.int>? encryptedData,
  }) {
    final result = create();
    if (convId != null) result.convId = convId;
    if (filename != null) result.filename = filename;
    if (mimeType != null) result.mimeType = mimeType;
    if (encryptedData != null) result.encryptedData = encryptedData;
    return result;
  }

  PostAttachmentRequest._();

  factory PostAttachmentRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostAttachmentRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostAttachmentRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'convId')
    ..aOS(2, _omitFieldNames ? '' : 'filename')
    ..aOS(3, _omitFieldNames ? '' : 'mimeType')
    ..a<$core.List<$core.int>>(
        4, _omitFieldNames ? '' : 'encryptedData', $pb.PbFieldType.OY)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostAttachmentRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostAttachmentRequest copyWith(
          void Function(PostAttachmentRequest) updates) =>
      super.copyWith((message) => updates(message as PostAttachmentRequest))
          as PostAttachmentRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostAttachmentRequest create() => PostAttachmentRequest._();
  @$core.override
  PostAttachmentRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostAttachmentRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostAttachmentRequest>(create);
  static PostAttachmentRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get convId => $_getSZ(0);
  @$pb.TagNumber(1)
  set convId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConvId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConvId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get filename => $_getSZ(1);
  @$pb.TagNumber(2)
  set filename($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasFilename() => $_has(1);
  @$pb.TagNumber(2)
  void clearFilename() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get mimeType => $_getSZ(2);
  @$pb.TagNumber(3)
  set mimeType($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasMimeType() => $_has(2);
  @$pb.TagNumber(3)
  void clearMimeType() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.List<$core.int> get encryptedData => $_getN(3);
  @$pb.TagNumber(4)
  set encryptedData($core.List<$core.int> value) => $_setBytes(3, value);
  @$pb.TagNumber(4)
  $core.bool hasEncryptedData() => $_has(3);
  @$pb.TagNumber(4)
  void clearEncryptedData() => $_clearField(4);
}

class Attachment extends $pb.GeneratedMessage {
  factory Attachment({
    $core.String? id,
    $core.String? filename,
    $core.String? mimeType,
    $fixnum.Int64? size,
    $0.Timestamp? uploadedAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (filename != null) result.filename = filename;
    if (mimeType != null) result.mimeType = mimeType;
    if (size != null) result.size = size;
    if (uploadedAt != null) result.uploadedAt = uploadedAt;
    return result;
  }

  Attachment._();

  factory Attachment.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Attachment.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Attachment',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'filename')
    ..aOS(3, _omitFieldNames ? '' : 'mimeType')
    ..aInt64(4, _omitFieldNames ? '' : 'size')
    ..aOM<$0.Timestamp>(5, _omitFieldNames ? '' : 'uploadedAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Attachment clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Attachment copyWith(void Function(Attachment) updates) =>
      super.copyWith((message) => updates(message as Attachment)) as Attachment;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Attachment create() => Attachment._();
  @$core.override
  Attachment createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Attachment getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Attachment>(create);
  static Attachment? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get filename => $_getSZ(1);
  @$pb.TagNumber(2)
  set filename($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasFilename() => $_has(1);
  @$pb.TagNumber(2)
  void clearFilename() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get mimeType => $_getSZ(2);
  @$pb.TagNumber(3)
  set mimeType($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasMimeType() => $_has(2);
  @$pb.TagNumber(3)
  void clearMimeType() => $_clearField(3);

  @$pb.TagNumber(4)
  $fixnum.Int64 get size => $_getI64(3);
  @$pb.TagNumber(4)
  set size($fixnum.Int64 value) => $_setInt64(3, value);
  @$pb.TagNumber(4)
  $core.bool hasSize() => $_has(3);
  @$pb.TagNumber(4)
  void clearSize() => $_clearField(4);

  @$pb.TagNumber(5)
  $0.Timestamp get uploadedAt => $_getN(4);
  @$pb.TagNumber(5)
  set uploadedAt($0.Timestamp value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasUploadedAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearUploadedAt() => $_clearField(5);
  @$pb.TagNumber(5)
  $0.Timestamp ensureUploadedAt() => $_ensure(4);
}

class PostAttachmentResponse extends $pb.GeneratedMessage {
  factory PostAttachmentResponse({
    Attachment? attachment,
  }) {
    final result = create();
    if (attachment != null) result.attachment = attachment;
    return result;
  }

  PostAttachmentResponse._();

  factory PostAttachmentResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostAttachmentResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostAttachmentResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOM<Attachment>(1, _omitFieldNames ? '' : 'attachment',
        subBuilder: Attachment.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostAttachmentResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostAttachmentResponse copyWith(
          void Function(PostAttachmentResponse) updates) =>
      super.copyWith((message) => updates(message as PostAttachmentResponse))
          as PostAttachmentResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostAttachmentResponse create() => PostAttachmentResponse._();
  @$core.override
  PostAttachmentResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostAttachmentResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostAttachmentResponse>(create);
  static PostAttachmentResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Attachment get attachment => $_getN(0);
  @$pb.TagNumber(1)
  set attachment(Attachment value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasAttachment() => $_has(0);
  @$pb.TagNumber(1)
  void clearAttachment() => $_clearField(1);
  @$pb.TagNumber(1)
  Attachment ensureAttachment() => $_ensure(0);
}

class GetAttachmentRequest extends $pb.GeneratedMessage {
  factory GetAttachmentRequest({
    $core.String? id,
  }) {
    final result = create();
    if (id != null) result.id = id;
    return result;
  }

  GetAttachmentRequest._();

  factory GetAttachmentRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetAttachmentRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetAttachmentRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAttachmentRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAttachmentRequest copyWith(void Function(GetAttachmentRequest) updates) =>
      super.copyWith((message) => updates(message as GetAttachmentRequest))
          as GetAttachmentRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetAttachmentRequest create() => GetAttachmentRequest._();
  @$core.override
  GetAttachmentRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetAttachmentRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetAttachmentRequest>(create);
  static GetAttachmentRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);
}

class GetAttachmentResponse extends $pb.GeneratedMessage {
  factory GetAttachmentResponse({
    Attachment? attachment,
    $core.List<$core.int>? encryptedData,
  }) {
    final result = create();
    if (attachment != null) result.attachment = attachment;
    if (encryptedData != null) result.encryptedData = encryptedData;
    return result;
  }

  GetAttachmentResponse._();

  factory GetAttachmentResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetAttachmentResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetAttachmentResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOM<Attachment>(1, _omitFieldNames ? '' : 'attachment',
        subBuilder: Attachment.create)
    ..a<$core.List<$core.int>>(
        2, _omitFieldNames ? '' : 'encryptedData', $pb.PbFieldType.OY)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAttachmentResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAttachmentResponse copyWith(
          void Function(GetAttachmentResponse) updates) =>
      super.copyWith((message) => updates(message as GetAttachmentResponse))
          as GetAttachmentResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetAttachmentResponse create() => GetAttachmentResponse._();
  @$core.override
  GetAttachmentResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetAttachmentResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetAttachmentResponse>(create);
  static GetAttachmentResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Attachment get attachment => $_getN(0);
  @$pb.TagNumber(1)
  set attachment(Attachment value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasAttachment() => $_has(0);
  @$pb.TagNumber(1)
  void clearAttachment() => $_clearField(1);
  @$pb.TagNumber(1)
  Attachment ensureAttachment() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.List<$core.int> get encryptedData => $_getN(1);
  @$pb.TagNumber(2)
  set encryptedData($core.List<$core.int> value) => $_setBytes(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEncryptedData() => $_has(1);
  @$pb.TagNumber(2)
  void clearEncryptedData() => $_clearField(2);
}

/// Search
class SearchMessagesRequest extends $pb.GeneratedMessage {
  factory SearchMessagesRequest({
    $core.String? convId,
    $core.String? query,
    $core.int? limit,
  }) {
    final result = create();
    if (convId != null) result.convId = convId;
    if (query != null) result.query = query;
    if (limit != null) result.limit = limit;
    return result;
  }

  SearchMessagesRequest._();

  factory SearchMessagesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SearchMessagesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SearchMessagesRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'convId')
    ..aOS(2, _omitFieldNames ? '' : 'query')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchMessagesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchMessagesRequest copyWith(
          void Function(SearchMessagesRequest) updates) =>
      super.copyWith((message) => updates(message as SearchMessagesRequest))
          as SearchMessagesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SearchMessagesRequest create() => SearchMessagesRequest._();
  @$core.override
  SearchMessagesRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SearchMessagesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SearchMessagesRequest>(create);
  static SearchMessagesRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get convId => $_getSZ(0);
  @$pb.TagNumber(1)
  set convId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConvId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConvId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get query => $_getSZ(1);
  @$pb.TagNumber(2)
  set query($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasQuery() => $_has(1);
  @$pb.TagNumber(2)
  void clearQuery() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);
}

class SearchMessagesResponse extends $pb.GeneratedMessage {
  factory SearchMessagesResponse({
    $core.Iterable<Message>? messages,
  }) {
    final result = create();
    if (messages != null) result.messages.addAll(messages);
    return result;
  }

  SearchMessagesResponse._();

  factory SearchMessagesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory SearchMessagesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SearchMessagesResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..pPM<Message>(1, _omitFieldNames ? '' : 'messages',
        subBuilder: Message.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchMessagesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchMessagesResponse copyWith(
          void Function(SearchMessagesResponse) updates) =>
      super.copyWith((message) => updates(message as SearchMessagesResponse))
          as SearchMessagesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static SearchMessagesResponse create() => SearchMessagesResponse._();
  @$core.override
  SearchMessagesResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static SearchMessagesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SearchMessagesResponse>(create);
  static SearchMessagesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Message> get messages => $_getList(0);
}

/// Snapshot
class GetSnapshotRequest extends $pb.GeneratedMessage {
  factory GetSnapshotRequest({
    $core.String? convId,
  }) {
    final result = create();
    if (convId != null) result.convId = convId;
    return result;
  }

  GetSnapshotRequest._();

  factory GetSnapshotRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetSnapshotRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetSnapshotRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'convId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSnapshotRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSnapshotRequest copyWith(void Function(GetSnapshotRequest) updates) =>
      super.copyWith((message) => updates(message as GetSnapshotRequest))
          as GetSnapshotRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetSnapshotRequest create() => GetSnapshotRequest._();
  @$core.override
  GetSnapshotRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetSnapshotRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetSnapshotRequest>(create);
  static GetSnapshotRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get convId => $_getSZ(0);
  @$pb.TagNumber(1)
  set convId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConvId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConvId() => $_clearField(1);
}

class Snapshot extends $pb.GeneratedMessage {
  factory Snapshot({
    $core.String? convId,
    $core.int? epoch,
    $core.List<$core.int>? stateData,
    $0.Timestamp? createdAt,
  }) {
    final result = create();
    if (convId != null) result.convId = convId;
    if (epoch != null) result.epoch = epoch;
    if (stateData != null) result.stateData = stateData;
    if (createdAt != null) result.createdAt = createdAt;
    return result;
  }

  Snapshot._();

  factory Snapshot.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Snapshot.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Snapshot',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'convId')
    ..aI(2, _omitFieldNames ? '' : 'epoch', fieldType: $pb.PbFieldType.OU3)
    ..a<$core.List<$core.int>>(
        3, _omitFieldNames ? '' : 'stateData', $pb.PbFieldType.OY)
    ..aOM<$0.Timestamp>(4, _omitFieldNames ? '' : 'createdAt',
        subBuilder: $0.Timestamp.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Snapshot clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Snapshot copyWith(void Function(Snapshot) updates) =>
      super.copyWith((message) => updates(message as Snapshot)) as Snapshot;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Snapshot create() => Snapshot._();
  @$core.override
  Snapshot createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Snapshot getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Snapshot>(create);
  static Snapshot? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get convId => $_getSZ(0);
  @$pb.TagNumber(1)
  set convId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConvId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConvId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get epoch => $_getIZ(1);
  @$pb.TagNumber(2)
  set epoch($core.int value) => $_setUnsignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEpoch() => $_has(1);
  @$pb.TagNumber(2)
  void clearEpoch() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.List<$core.int> get stateData => $_getN(2);
  @$pb.TagNumber(3)
  set stateData($core.List<$core.int> value) => $_setBytes(2, value);
  @$pb.TagNumber(3)
  $core.bool hasStateData() => $_has(2);
  @$pb.TagNumber(3)
  void clearStateData() => $_clearField(3);

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

class GetSnapshotResponse extends $pb.GeneratedMessage {
  factory GetSnapshotResponse({
    Snapshot? snapshot,
  }) {
    final result = create();
    if (snapshot != null) result.snapshot = snapshot;
    return result;
  }

  GetSnapshotResponse._();

  factory GetSnapshotResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetSnapshotResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetSnapshotResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOM<Snapshot>(1, _omitFieldNames ? '' : 'snapshot',
        subBuilder: Snapshot.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSnapshotResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSnapshotResponse copyWith(void Function(GetSnapshotResponse) updates) =>
      super.copyWith((message) => updates(message as GetSnapshotResponse))
          as GetSnapshotResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetSnapshotResponse create() => GetSnapshotResponse._();
  @$core.override
  GetSnapshotResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetSnapshotResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetSnapshotResponse>(create);
  static GetSnapshotResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Snapshot get snapshot => $_getN(0);
  @$pb.TagNumber(1)
  set snapshot(Snapshot value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasSnapshot() => $_has(0);
  @$pb.TagNumber(1)
  void clearSnapshot() => $_clearField(1);
  @$pb.TagNumber(1)
  Snapshot ensureSnapshot() => $_ensure(0);
}

class PostSnapshotRequest extends $pb.GeneratedMessage {
  factory PostSnapshotRequest({
    $core.String? convId,
    $core.int? epoch,
    $core.List<$core.int>? stateData,
  }) {
    final result = create();
    if (convId != null) result.convId = convId;
    if (epoch != null) result.epoch = epoch;
    if (stateData != null) result.stateData = stateData;
    return result;
  }

  PostSnapshotRequest._();

  factory PostSnapshotRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostSnapshotRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostSnapshotRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'convId')
    ..aI(2, _omitFieldNames ? '' : 'epoch', fieldType: $pb.PbFieldType.OU3)
    ..a<$core.List<$core.int>>(
        3, _omitFieldNames ? '' : 'stateData', $pb.PbFieldType.OY)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostSnapshotRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostSnapshotRequest copyWith(void Function(PostSnapshotRequest) updates) =>
      super.copyWith((message) => updates(message as PostSnapshotRequest))
          as PostSnapshotRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostSnapshotRequest create() => PostSnapshotRequest._();
  @$core.override
  PostSnapshotRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostSnapshotRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostSnapshotRequest>(create);
  static PostSnapshotRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get convId => $_getSZ(0);
  @$pb.TagNumber(1)
  set convId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConvId() => $_has(0);
  @$pb.TagNumber(1)
  void clearConvId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get epoch => $_getIZ(1);
  @$pb.TagNumber(2)
  set epoch($core.int value) => $_setUnsignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEpoch() => $_has(1);
  @$pb.TagNumber(2)
  void clearEpoch() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.List<$core.int> get stateData => $_getN(2);
  @$pb.TagNumber(3)
  set stateData($core.List<$core.int> value) => $_setBytes(2, value);
  @$pb.TagNumber(3)
  $core.bool hasStateData() => $_has(2);
  @$pb.TagNumber(3)
  void clearStateData() => $_clearField(3);
}

class PostSnapshotResponse extends $pb.GeneratedMessage {
  factory PostSnapshotResponse({
    $core.bool? success,
  }) {
    final result = create();
    if (success != null) result.success = success;
    return result;
  }

  PostSnapshotResponse._();

  factory PostSnapshotResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PostSnapshotResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostSnapshotResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.message.v1'),
      createEmptyInstance: create)
    ..aOB(1, _omitFieldNames ? '' : 'success')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostSnapshotResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostSnapshotResponse copyWith(void Function(PostSnapshotResponse) updates) =>
      super.copyWith((message) => updates(message as PostSnapshotResponse))
          as PostSnapshotResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PostSnapshotResponse create() => PostSnapshotResponse._();
  @$core.override
  PostSnapshotResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PostSnapshotResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostSnapshotResponse>(create);
  static PostSnapshotResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get success => $_getBF(0);
  @$pb.TagNumber(1)
  set success($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSuccess() => $_has(0);
  @$pb.TagNumber(1)
  void clearSuccess() => $_clearField(1);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
