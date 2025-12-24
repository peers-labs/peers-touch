// This is a generated file - do not edit.
//
// Generated from domain/applet/applet.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

/// AppletInfo represents the public information of an applet
class AppletInfo extends $pb.GeneratedMessage {
  factory AppletInfo({
    $core.String? id,
    $core.String? name,
    $core.String? description,
    $core.String? iconUrl,
    $core.String? developerId,
    $fixnum.Int64? downloadCount,
    $core.String? latestVersion,
    $fixnum.Int64? updatedAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (name != null) result.name = name;
    if (description != null) result.description = description;
    if (iconUrl != null) result.iconUrl = iconUrl;
    if (developerId != null) result.developerId = developerId;
    if (downloadCount != null) result.downloadCount = downloadCount;
    if (latestVersion != null) result.latestVersion = latestVersion;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  AppletInfo._();

  factory AppletInfo.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory AppletInfo.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AppletInfo',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.domain.applet'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'description')
    ..aOS(4, _omitFieldNames ? '' : 'iconUrl')
    ..aOS(5, _omitFieldNames ? '' : 'developerId')
    ..aInt64(6, _omitFieldNames ? '' : 'downloadCount')
    ..aOS(7, _omitFieldNames ? '' : 'latestVersion')
    ..aInt64(8, _omitFieldNames ? '' : 'updatedAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AppletInfo clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AppletInfo copyWith(void Function(AppletInfo) updates) =>
      super.copyWith((message) => updates(message as AppletInfo)) as AppletInfo;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AppletInfo create() => AppletInfo._();
  @$core.override
  AppletInfo createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static AppletInfo getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AppletInfo>(create);
  static AppletInfo? _defaultInstance;

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
  $core.String get description => $_getSZ(2);
  @$pb.TagNumber(3)
  set description($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDescription() => $_has(2);
  @$pb.TagNumber(3)
  void clearDescription() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get iconUrl => $_getSZ(3);
  @$pb.TagNumber(4)
  set iconUrl($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasIconUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearIconUrl() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get developerId => $_getSZ(4);
  @$pb.TagNumber(5)
  set developerId($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasDeveloperId() => $_has(4);
  @$pb.TagNumber(5)
  void clearDeveloperId() => $_clearField(5);

  @$pb.TagNumber(6)
  $fixnum.Int64 get downloadCount => $_getI64(5);
  @$pb.TagNumber(6)
  set downloadCount($fixnum.Int64 value) => $_setInt64(5, value);
  @$pb.TagNumber(6)
  $core.bool hasDownloadCount() => $_has(5);
  @$pb.TagNumber(6)
  void clearDownloadCount() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get latestVersion => $_getSZ(6);
  @$pb.TagNumber(7)
  set latestVersion($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasLatestVersion() => $_has(6);
  @$pb.TagNumber(7)
  void clearLatestVersion() => $_clearField(7);

  @$pb.TagNumber(8)
  $fixnum.Int64 get updatedAt => $_getI64(7);
  @$pb.TagNumber(8)
  set updatedAt($fixnum.Int64 value) => $_setInt64(7, value);
  @$pb.TagNumber(8)
  $core.bool hasUpdatedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearUpdatedAt() => $_clearField(8);
}

/// AppletVersionInfo represents details of a specific version
class AppletVersionInfo extends $pb.GeneratedMessage {
  factory AppletVersionInfo({
    $core.String? id,
    $core.String? appletId,
    $core.String? version,
    $core.String? bundleUrl,
    $core.String? bundleHash,
    $fixnum.Int64? bundleSize,
    $core.String? minSdkVersion,
    $core.String? changelog,
    $fixnum.Int64? createdAt,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (appletId != null) result.appletId = appletId;
    if (version != null) result.version = version;
    if (bundleUrl != null) result.bundleUrl = bundleUrl;
    if (bundleHash != null) result.bundleHash = bundleHash;
    if (bundleSize != null) result.bundleSize = bundleSize;
    if (minSdkVersion != null) result.minSdkVersion = minSdkVersion;
    if (changelog != null) result.changelog = changelog;
    if (createdAt != null) result.createdAt = createdAt;
    return result;
  }

  AppletVersionInfo._();

  factory AppletVersionInfo.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory AppletVersionInfo.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AppletVersionInfo',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.domain.applet'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'appletId')
    ..aOS(3, _omitFieldNames ? '' : 'version')
    ..aOS(4, _omitFieldNames ? '' : 'bundleUrl')
    ..aOS(5, _omitFieldNames ? '' : 'bundleHash')
    ..aInt64(6, _omitFieldNames ? '' : 'bundleSize')
    ..aOS(7, _omitFieldNames ? '' : 'minSdkVersion')
    ..aOS(8, _omitFieldNames ? '' : 'changelog')
    ..aInt64(9, _omitFieldNames ? '' : 'createdAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AppletVersionInfo clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AppletVersionInfo copyWith(void Function(AppletVersionInfo) updates) =>
      super.copyWith((message) => updates(message as AppletVersionInfo))
          as AppletVersionInfo;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static AppletVersionInfo create() => AppletVersionInfo._();
  @$core.override
  AppletVersionInfo createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static AppletVersionInfo getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AppletVersionInfo>(create);
  static AppletVersionInfo? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get appletId => $_getSZ(1);
  @$pb.TagNumber(2)
  set appletId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasAppletId() => $_has(1);
  @$pb.TagNumber(2)
  void clearAppletId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get version => $_getSZ(2);
  @$pb.TagNumber(3)
  set version($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasVersion() => $_has(2);
  @$pb.TagNumber(3)
  void clearVersion() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get bundleUrl => $_getSZ(3);
  @$pb.TagNumber(4)
  set bundleUrl($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasBundleUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearBundleUrl() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get bundleHash => $_getSZ(4);
  @$pb.TagNumber(5)
  set bundleHash($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasBundleHash() => $_has(4);
  @$pb.TagNumber(5)
  void clearBundleHash() => $_clearField(5);

  @$pb.TagNumber(6)
  $fixnum.Int64 get bundleSize => $_getI64(5);
  @$pb.TagNumber(6)
  set bundleSize($fixnum.Int64 value) => $_setInt64(5, value);
  @$pb.TagNumber(6)
  $core.bool hasBundleSize() => $_has(5);
  @$pb.TagNumber(6)
  void clearBundleSize() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get minSdkVersion => $_getSZ(6);
  @$pb.TagNumber(7)
  set minSdkVersion($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasMinSdkVersion() => $_has(6);
  @$pb.TagNumber(7)
  void clearMinSdkVersion() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get changelog => $_getSZ(7);
  @$pb.TagNumber(8)
  set changelog($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasChangelog() => $_has(7);
  @$pb.TagNumber(8)
  void clearChangelog() => $_clearField(8);

  @$pb.TagNumber(9)
  $fixnum.Int64 get createdAt => $_getI64(8);
  @$pb.TagNumber(9)
  set createdAt($fixnum.Int64 value) => $_setInt64(8, value);
  @$pb.TagNumber(9)
  $core.bool hasCreatedAt() => $_has(8);
  @$pb.TagNumber(9)
  void clearCreatedAt() => $_clearField(9);
}

/// Request to list applets
class ListAppletsRequest extends $pb.GeneratedMessage {
  factory ListAppletsRequest({
    $core.int? limit,
    $core.int? offset,
    $core.String? searchKeyword,
  }) {
    final result = create();
    if (limit != null) result.limit = limit;
    if (offset != null) result.offset = offset;
    if (searchKeyword != null) result.searchKeyword = searchKeyword;
    return result;
  }

  ListAppletsRequest._();

  factory ListAppletsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListAppletsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListAppletsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.domain.applet'),
      createEmptyInstance: create)
    ..aI(1, _omitFieldNames ? '' : 'limit')
    ..aI(2, _omitFieldNames ? '' : 'offset')
    ..aOS(3, _omitFieldNames ? '' : 'searchKeyword')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListAppletsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListAppletsRequest copyWith(void Function(ListAppletsRequest) updates) =>
      super.copyWith((message) => updates(message as ListAppletsRequest))
          as ListAppletsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListAppletsRequest create() => ListAppletsRequest._();
  @$core.override
  ListAppletsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListAppletsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListAppletsRequest>(create);
  static ListAppletsRequest? _defaultInstance;

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
  $core.String get searchKeyword => $_getSZ(2);
  @$pb.TagNumber(3)
  set searchKeyword($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSearchKeyword() => $_has(2);
  @$pb.TagNumber(3)
  void clearSearchKeyword() => $_clearField(3);
}

/// Response for listing applets
class ListAppletsResponse extends $pb.GeneratedMessage {
  factory ListAppletsResponse({
    $core.Iterable<AppletInfo>? applets,
    $fixnum.Int64? totalCount,
  }) {
    final result = create();
    if (applets != null) result.applets.addAll(applets);
    if (totalCount != null) result.totalCount = totalCount;
    return result;
  }

  ListAppletsResponse._();

  factory ListAppletsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ListAppletsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListAppletsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.domain.applet'),
      createEmptyInstance: create)
    ..pPM<AppletInfo>(1, _omitFieldNames ? '' : 'applets',
        subBuilder: AppletInfo.create)
    ..aInt64(2, _omitFieldNames ? '' : 'totalCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListAppletsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListAppletsResponse copyWith(void Function(ListAppletsResponse) updates) =>
      super.copyWith((message) => updates(message as ListAppletsResponse))
          as ListAppletsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ListAppletsResponse create() => ListAppletsResponse._();
  @$core.override
  ListAppletsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ListAppletsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListAppletsResponse>(create);
  static ListAppletsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<AppletInfo> get applets => $_getList(0);

  @$pb.TagNumber(2)
  $fixnum.Int64 get totalCount => $_getI64(1);
  @$pb.TagNumber(2)
  set totalCount($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTotalCount() => $_has(1);
  @$pb.TagNumber(2)
  void clearTotalCount() => $_clearField(2);
}

/// Request to get applet details
class GetAppletDetailsRequest extends $pb.GeneratedMessage {
  factory GetAppletDetailsRequest({
    $core.String? appletId,
  }) {
    final result = create();
    if (appletId != null) result.appletId = appletId;
    return result;
  }

  GetAppletDetailsRequest._();

  factory GetAppletDetailsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetAppletDetailsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetAppletDetailsRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.domain.applet'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'appletId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAppletDetailsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAppletDetailsRequest copyWith(
          void Function(GetAppletDetailsRequest) updates) =>
      super.copyWith((message) => updates(message as GetAppletDetailsRequest))
          as GetAppletDetailsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetAppletDetailsRequest create() => GetAppletDetailsRequest._();
  @$core.override
  GetAppletDetailsRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetAppletDetailsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetAppletDetailsRequest>(create);
  static GetAppletDetailsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get appletId => $_getSZ(0);
  @$pb.TagNumber(1)
  set appletId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAppletId() => $_has(0);
  @$pb.TagNumber(1)
  void clearAppletId() => $_clearField(1);
}

/// Response for applet details
class GetAppletDetailsResponse extends $pb.GeneratedMessage {
  factory GetAppletDetailsResponse({
    AppletInfo? info,
    AppletVersionInfo? latestVersion,
  }) {
    final result = create();
    if (info != null) result.info = info;
    if (latestVersion != null) result.latestVersion = latestVersion;
    return result;
  }

  GetAppletDetailsResponse._();

  factory GetAppletDetailsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory GetAppletDetailsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetAppletDetailsResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.domain.applet'),
      createEmptyInstance: create)
    ..aOM<AppletInfo>(1, _omitFieldNames ? '' : 'info',
        subBuilder: AppletInfo.create)
    ..aOM<AppletVersionInfo>(2, _omitFieldNames ? '' : 'latestVersion',
        subBuilder: AppletVersionInfo.create)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAppletDetailsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAppletDetailsResponse copyWith(
          void Function(GetAppletDetailsResponse) updates) =>
      super.copyWith((message) => updates(message as GetAppletDetailsResponse))
          as GetAppletDetailsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static GetAppletDetailsResponse create() => GetAppletDetailsResponse._();
  @$core.override
  GetAppletDetailsResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static GetAppletDetailsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetAppletDetailsResponse>(create);
  static GetAppletDetailsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  AppletInfo get info => $_getN(0);
  @$pb.TagNumber(1)
  set info(AppletInfo value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasInfo() => $_has(0);
  @$pb.TagNumber(1)
  void clearInfo() => $_clearField(1);
  @$pb.TagNumber(1)
  AppletInfo ensureInfo() => $_ensure(0);

  @$pb.TagNumber(2)
  AppletVersionInfo get latestVersion => $_getN(1);
  @$pb.TagNumber(2)
  set latestVersion(AppletVersionInfo value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasLatestVersion() => $_has(1);
  @$pb.TagNumber(2)
  void clearLatestVersion() => $_clearField(2);
  @$pb.TagNumber(2)
  AppletVersionInfo ensureLatestVersion() => $_ensure(1);
}

/// Request to publish/update applet (Metadata part)
/// File upload is handled separately via multipart/form-data
class PublishAppletRequest extends $pb.GeneratedMessage {
  factory PublishAppletRequest({
    $core.String? name,
    $core.String? description,
    $core.String? version,
    $core.String? minSdkVersion,
    $core.String? changelog,
  }) {
    final result = create();
    if (name != null) result.name = name;
    if (description != null) result.description = description;
    if (version != null) result.version = version;
    if (minSdkVersion != null) result.minSdkVersion = minSdkVersion;
    if (changelog != null) result.changelog = changelog;
    return result;
  }

  PublishAppletRequest._();

  factory PublishAppletRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PublishAppletRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PublishAppletRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.domain.applet'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'name')
    ..aOS(2, _omitFieldNames ? '' : 'description')
    ..aOS(3, _omitFieldNames ? '' : 'version')
    ..aOS(4, _omitFieldNames ? '' : 'minSdkVersion')
    ..aOS(5, _omitFieldNames ? '' : 'changelog')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishAppletRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishAppletRequest copyWith(void Function(PublishAppletRequest) updates) =>
      super.copyWith((message) => updates(message as PublishAppletRequest))
          as PublishAppletRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PublishAppletRequest create() => PublishAppletRequest._();
  @$core.override
  PublishAppletRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PublishAppletRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PublishAppletRequest>(create);
  static PublishAppletRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get name => $_getSZ(0);
  @$pb.TagNumber(1)
  set name($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasName() => $_has(0);
  @$pb.TagNumber(1)
  void clearName() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get description => $_getSZ(1);
  @$pb.TagNumber(2)
  set description($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasDescription() => $_has(1);
  @$pb.TagNumber(2)
  void clearDescription() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get version => $_getSZ(2);
  @$pb.TagNumber(3)
  set version($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasVersion() => $_has(2);
  @$pb.TagNumber(3)
  void clearVersion() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get minSdkVersion => $_getSZ(3);
  @$pb.TagNumber(4)
  set minSdkVersion($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasMinSdkVersion() => $_has(3);
  @$pb.TagNumber(4)
  void clearMinSdkVersion() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get changelog => $_getSZ(4);
  @$pb.TagNumber(5)
  set changelog($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasChangelog() => $_has(4);
  @$pb.TagNumber(5)
  void clearChangelog() => $_clearField(5);
}

class PublishAppletResponse extends $pb.GeneratedMessage {
  factory PublishAppletResponse({
    $core.String? appletId,
    $core.String? versionId,
    $core.bool? isNewApplet,
  }) {
    final result = create();
    if (appletId != null) result.appletId = appletId;
    if (versionId != null) result.versionId = versionId;
    if (isNewApplet != null) result.isNewApplet = isNewApplet;
    return result;
  }

  PublishAppletResponse._();

  factory PublishAppletResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PublishAppletResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PublishAppletResponse',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.domain.applet'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'appletId')
    ..aOS(2, _omitFieldNames ? '' : 'versionId')
    ..aOB(3, _omitFieldNames ? '' : 'isNewApplet')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishAppletResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishAppletResponse copyWith(
          void Function(PublishAppletResponse) updates) =>
      super.copyWith((message) => updates(message as PublishAppletResponse))
          as PublishAppletResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PublishAppletResponse create() => PublishAppletResponse._();
  @$core.override
  PublishAppletResponse createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PublishAppletResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PublishAppletResponse>(create);
  static PublishAppletResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get appletId => $_getSZ(0);
  @$pb.TagNumber(1)
  set appletId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasAppletId() => $_has(0);
  @$pb.TagNumber(1)
  void clearAppletId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get versionId => $_getSZ(1);
  @$pb.TagNumber(2)
  set versionId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasVersionId() => $_has(1);
  @$pb.TagNumber(2)
  void clearVersionId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.bool get isNewApplet => $_getBF(2);
  @$pb.TagNumber(3)
  set isNewApplet($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasIsNewApplet() => $_has(2);
  @$pb.TagNumber(3)
  void clearIsNewApplet() => $_clearField(3);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
