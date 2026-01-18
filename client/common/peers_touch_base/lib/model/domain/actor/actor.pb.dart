// This is a generated file - do not edit.
//
// Generated from domain/actor/actor.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class Actor extends $pb.GeneratedMessage {
  factory Actor({
    $core.String? id,
    $core.String? username,
    $core.String? displayName,
    $core.String? email,
    $core.String? inbox,
    $core.String? outbox,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? endpoints,
    $core.bool? isFollowing,
    $fixnum.Int64? actorId,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (username != null) result.username = username;
    if (displayName != null) result.displayName = displayName;
    if (email != null) result.email = email;
    if (inbox != null) result.inbox = inbox;
    if (outbox != null) result.outbox = outbox;
    if (endpoints != null) result.endpoints.addEntries(endpoints);
    if (isFollowing != null) result.isFollowing = isFollowing;
    if (actorId != null) result.actorId = actorId;
    return result;
  }

  Actor._();

  factory Actor.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory Actor.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Actor',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.actor.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'username')
    ..aOS(3, _omitFieldNames ? '' : 'displayName')
    ..aOS(4, _omitFieldNames ? '' : 'email')
    ..aOS(5, _omitFieldNames ? '' : 'inbox')
    ..aOS(6, _omitFieldNames ? '' : 'outbox')
    ..m<$core.String, $core.String>(7, _omitFieldNames ? '' : 'endpoints',
        entryClassName: 'Actor.EndpointsEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('peers_touch.model.actor.v1'))
    ..aOB(8, _omitFieldNames ? '' : 'is_following')
    ..a<$fixnum.Int64>(
        9, _omitFieldNames ? '' : 'actor_id', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Actor clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Actor copyWith(void Function(Actor) updates) =>
      super.copyWith((message) => updates(message as Actor)) as Actor;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static Actor create() => Actor._();
  @$core.override
  Actor createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static Actor getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Actor>(create);
  static Actor? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get username => $_getSZ(1);
  @$pb.TagNumber(2)
  set username($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUsername() => $_has(1);
  @$pb.TagNumber(2)
  void clearUsername() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get displayName => $_getSZ(2);
  @$pb.TagNumber(3)
  set displayName($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDisplayName() => $_has(2);
  @$pb.TagNumber(3)
  void clearDisplayName() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get email => $_getSZ(3);
  @$pb.TagNumber(4)
  set email($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasEmail() => $_has(3);
  @$pb.TagNumber(4)
  void clearEmail() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get inbox => $_getSZ(4);
  @$pb.TagNumber(5)
  set inbox($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasInbox() => $_has(4);
  @$pb.TagNumber(5)
  void clearInbox() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get outbox => $_getSZ(5);
  @$pb.TagNumber(6)
  set outbox($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasOutbox() => $_has(5);
  @$pb.TagNumber(6)
  void clearOutbox() => $_clearField(6);

  @$pb.TagNumber(7)
  $pb.PbMap<$core.String, $core.String> get endpoints => $_getMap(6);

  @$pb.TagNumber(8)
  $core.bool get isFollowing => $_getBF(7);
  @$pb.TagNumber(8)
  set isFollowing($core.bool value) => $_setBool(7, value);
  @$pb.TagNumber(8)
  $core.bool hasIsFollowing() => $_has(7);
  @$pb.TagNumber(8)
  void clearIsFollowing() => $_clearField(8);

  @$pb.TagNumber(9)
  $fixnum.Int64 get actorId => $_getI64(8);
  @$pb.TagNumber(9)
  set actorId($fixnum.Int64 value) => $_setInt64(8, value);
  @$pb.TagNumber(9)
  $core.bool hasActorId() => $_has(8);
  @$pb.TagNumber(9)
  void clearActorId() => $_clearField(9);
}

class UserLink extends $pb.GeneratedMessage {
  factory UserLink({
    $core.String? label,
    $core.String? url,
  }) {
    final result = create();
    if (label != null) result.label = label;
    if (url != null) result.url = url;
    return result;
  }

  UserLink._();

  factory UserLink.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UserLink.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UserLink',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.actor.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'label')
    ..aOS(2, _omitFieldNames ? '' : 'url')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UserLink clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UserLink copyWith(void Function(UserLink) updates) =>
      super.copyWith((message) => updates(message as UserLink)) as UserLink;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UserLink create() => UserLink._();
  @$core.override
  UserLink createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UserLink getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<UserLink>(create);
  static UserLink? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get label => $_getSZ(0);
  @$pb.TagNumber(1)
  set label($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasLabel() => $_has(0);
  @$pb.TagNumber(1)
  void clearLabel() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get url => $_getSZ(1);
  @$pb.TagNumber(2)
  set url($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUrl() => $_has(1);
  @$pb.TagNumber(2)
  void clearUrl() => $_clearField(2);
}

class PeersTouchInfo extends $pb.GeneratedMessage {
  factory PeersTouchInfo({
    $core.String? networkId,
  }) {
    final result = create();
    if (networkId != null) result.networkId = networkId;
    return result;
  }

  PeersTouchInfo._();

  factory PeersTouchInfo.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory PeersTouchInfo.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PeersTouchInfo',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.actor.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'network_id')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PeersTouchInfo clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PeersTouchInfo copyWith(void Function(PeersTouchInfo) updates) =>
      super.copyWith((message) => updates(message as PeersTouchInfo))
          as PeersTouchInfo;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static PeersTouchInfo create() => PeersTouchInfo._();
  @$core.override
  PeersTouchInfo createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static PeersTouchInfo getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PeersTouchInfo>(create);
  static PeersTouchInfo? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get networkId => $_getSZ(0);
  @$pb.TagNumber(1)
  set networkId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasNetworkId() => $_has(0);
  @$pb.TagNumber(1)
  void clearNetworkId() => $_clearField(1);
}

class ActorProfile extends $pb.GeneratedMessage {
  factory ActorProfile({
    $core.String? id,
    $core.String? displayName,
    $core.String? username,
    $core.String? note,
    $core.String? avatar,
    $core.String? header,
    $core.String? region,
    $core.String? timezone,
    $core.Iterable<$core.String>? tags,
    $core.Iterable<UserLink>? links,
    $core.String? url,
    $core.String? serverDomain,
    $core.String? keyFingerprint,
    $core.Iterable<$core.String>? verifications,
    PeersTouchInfo? peersTouch,
    $core.String? acct,
    $core.bool? locked,
    $core.String? createdAt,
    $fixnum.Int64? followersCount,
    $fixnum.Int64? followingCount,
    $fixnum.Int64? statusesCount,
    $core.bool? showCounts,
    $core.Iterable<$core.String>? moments,
    $core.String? defaultVisibility,
    $core.bool? manuallyApprovesFollowers,
    $core.String? messagePermission,
    $core.int? autoExpireDays,
  }) {
    final result = create();
    if (id != null) result.id = id;
    if (displayName != null) result.displayName = displayName;
    if (username != null) result.username = username;
    if (note != null) result.note = note;
    if (avatar != null) result.avatar = avatar;
    if (header != null) result.header = header;
    if (region != null) result.region = region;
    if (timezone != null) result.timezone = timezone;
    if (tags != null) result.tags.addAll(tags);
    if (links != null) result.links.addAll(links);
    if (url != null) result.url = url;
    if (serverDomain != null) result.serverDomain = serverDomain;
    if (keyFingerprint != null) result.keyFingerprint = keyFingerprint;
    if (verifications != null) result.verifications.addAll(verifications);
    if (peersTouch != null) result.peersTouch = peersTouch;
    if (acct != null) result.acct = acct;
    if (locked != null) result.locked = locked;
    if (createdAt != null) result.createdAt = createdAt;
    if (followersCount != null) result.followersCount = followersCount;
    if (followingCount != null) result.followingCount = followingCount;
    if (statusesCount != null) result.statusesCount = statusesCount;
    if (showCounts != null) result.showCounts = showCounts;
    if (moments != null) result.moments.addAll(moments);
    if (defaultVisibility != null) result.defaultVisibility = defaultVisibility;
    if (manuallyApprovesFollowers != null)
      result.manuallyApprovesFollowers = manuallyApprovesFollowers;
    if (messagePermission != null) result.messagePermission = messagePermission;
    if (autoExpireDays != null) result.autoExpireDays = autoExpireDays;
    return result;
  }

  ActorProfile._();

  factory ActorProfile.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ActorProfile.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ActorProfile',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.actor.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'display_name')
    ..aOS(3, _omitFieldNames ? '' : 'username')
    ..aOS(4, _omitFieldNames ? '' : 'note')
    ..aOS(5, _omitFieldNames ? '' : 'avatar')
    ..aOS(6, _omitFieldNames ? '' : 'header')
    ..aOS(7, _omitFieldNames ? '' : 'region')
    ..aOS(8, _omitFieldNames ? '' : 'timezone')
    ..pPS(9, _omitFieldNames ? '' : 'tags')
    ..pPM<UserLink>(10, _omitFieldNames ? '' : 'links',
        subBuilder: UserLink.create)
    ..aOS(11, _omitFieldNames ? '' : 'url')
    ..aOS(12, _omitFieldNames ? '' : 'server_domain')
    ..aOS(13, _omitFieldNames ? '' : 'key_fingerprint')
    ..pPS(14, _omitFieldNames ? '' : 'verifications')
    ..aOM<PeersTouchInfo>(15, _omitFieldNames ? '' : 'peers_touch',
        subBuilder: PeersTouchInfo.create)
    ..aOS(16, _omitFieldNames ? '' : 'acct')
    ..aOB(17, _omitFieldNames ? '' : 'locked')
    ..aOS(18, _omitFieldNames ? '' : 'created_at')
    ..aInt64(19, _omitFieldNames ? '' : 'followers_count')
    ..aInt64(20, _omitFieldNames ? '' : 'following_count')
    ..aInt64(21, _omitFieldNames ? '' : 'statuses_count')
    ..aOB(22, _omitFieldNames ? '' : 'show_counts')
    ..pPS(23, _omitFieldNames ? '' : 'moments')
    ..aOS(24, _omitFieldNames ? '' : 'default_visibility')
    ..aOB(25, _omitFieldNames ? '' : 'manually_approves_followers')
    ..aOS(26, _omitFieldNames ? '' : 'message_permission')
    ..aI(27, _omitFieldNames ? '' : 'auto_expire_days')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorProfile clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorProfile copyWith(void Function(ActorProfile) updates) =>
      super.copyWith((message) => updates(message as ActorProfile))
          as ActorProfile;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ActorProfile create() => ActorProfile._();
  @$core.override
  ActorProfile createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ActorProfile getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ActorProfile>(create);
  static ActorProfile? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get displayName => $_getSZ(1);
  @$pb.TagNumber(2)
  set displayName($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasDisplayName() => $_has(1);
  @$pb.TagNumber(2)
  void clearDisplayName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get username => $_getSZ(2);
  @$pb.TagNumber(3)
  set username($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasUsername() => $_has(2);
  @$pb.TagNumber(3)
  void clearUsername() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get note => $_getSZ(3);
  @$pb.TagNumber(4)
  set note($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasNote() => $_has(3);
  @$pb.TagNumber(4)
  void clearNote() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get avatar => $_getSZ(4);
  @$pb.TagNumber(5)
  set avatar($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasAvatar() => $_has(4);
  @$pb.TagNumber(5)
  void clearAvatar() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get header => $_getSZ(5);
  @$pb.TagNumber(6)
  set header($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasHeader() => $_has(5);
  @$pb.TagNumber(6)
  void clearHeader() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get region => $_getSZ(6);
  @$pb.TagNumber(7)
  set region($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasRegion() => $_has(6);
  @$pb.TagNumber(7)
  void clearRegion() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get timezone => $_getSZ(7);
  @$pb.TagNumber(8)
  set timezone($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasTimezone() => $_has(7);
  @$pb.TagNumber(8)
  void clearTimezone() => $_clearField(8);

  @$pb.TagNumber(9)
  $pb.PbList<$core.String> get tags => $_getList(8);

  @$pb.TagNumber(10)
  $pb.PbList<UserLink> get links => $_getList(9);

  @$pb.TagNumber(11)
  $core.String get url => $_getSZ(10);
  @$pb.TagNumber(11)
  set url($core.String value) => $_setString(10, value);
  @$pb.TagNumber(11)
  $core.bool hasUrl() => $_has(10);
  @$pb.TagNumber(11)
  void clearUrl() => $_clearField(11);

  @$pb.TagNumber(12)
  $core.String get serverDomain => $_getSZ(11);
  @$pb.TagNumber(12)
  set serverDomain($core.String value) => $_setString(11, value);
  @$pb.TagNumber(12)
  $core.bool hasServerDomain() => $_has(11);
  @$pb.TagNumber(12)
  void clearServerDomain() => $_clearField(12);

  @$pb.TagNumber(13)
  $core.String get keyFingerprint => $_getSZ(12);
  @$pb.TagNumber(13)
  set keyFingerprint($core.String value) => $_setString(12, value);
  @$pb.TagNumber(13)
  $core.bool hasKeyFingerprint() => $_has(12);
  @$pb.TagNumber(13)
  void clearKeyFingerprint() => $_clearField(13);

  @$pb.TagNumber(14)
  $pb.PbList<$core.String> get verifications => $_getList(13);

  @$pb.TagNumber(15)
  PeersTouchInfo get peersTouch => $_getN(14);
  @$pb.TagNumber(15)
  set peersTouch(PeersTouchInfo value) => $_setField(15, value);
  @$pb.TagNumber(15)
  $core.bool hasPeersTouch() => $_has(14);
  @$pb.TagNumber(15)
  void clearPeersTouch() => $_clearField(15);
  @$pb.TagNumber(15)
  PeersTouchInfo ensurePeersTouch() => $_ensure(14);

  @$pb.TagNumber(16)
  $core.String get acct => $_getSZ(15);
  @$pb.TagNumber(16)
  set acct($core.String value) => $_setString(15, value);
  @$pb.TagNumber(16)
  $core.bool hasAcct() => $_has(15);
  @$pb.TagNumber(16)
  void clearAcct() => $_clearField(16);

  @$pb.TagNumber(17)
  $core.bool get locked => $_getBF(16);
  @$pb.TagNumber(17)
  set locked($core.bool value) => $_setBool(16, value);
  @$pb.TagNumber(17)
  $core.bool hasLocked() => $_has(16);
  @$pb.TagNumber(17)
  void clearLocked() => $_clearField(17);

  @$pb.TagNumber(18)
  $core.String get createdAt => $_getSZ(17);
  @$pb.TagNumber(18)
  set createdAt($core.String value) => $_setString(17, value);
  @$pb.TagNumber(18)
  $core.bool hasCreatedAt() => $_has(17);
  @$pb.TagNumber(18)
  void clearCreatedAt() => $_clearField(18);

  @$pb.TagNumber(19)
  $fixnum.Int64 get followersCount => $_getI64(18);
  @$pb.TagNumber(19)
  set followersCount($fixnum.Int64 value) => $_setInt64(18, value);
  @$pb.TagNumber(19)
  $core.bool hasFollowersCount() => $_has(18);
  @$pb.TagNumber(19)
  void clearFollowersCount() => $_clearField(19);

  @$pb.TagNumber(20)
  $fixnum.Int64 get followingCount => $_getI64(19);
  @$pb.TagNumber(20)
  set followingCount($fixnum.Int64 value) => $_setInt64(19, value);
  @$pb.TagNumber(20)
  $core.bool hasFollowingCount() => $_has(19);
  @$pb.TagNumber(20)
  void clearFollowingCount() => $_clearField(20);

  @$pb.TagNumber(21)
  $fixnum.Int64 get statusesCount => $_getI64(20);
  @$pb.TagNumber(21)
  set statusesCount($fixnum.Int64 value) => $_setInt64(20, value);
  @$pb.TagNumber(21)
  $core.bool hasStatusesCount() => $_has(20);
  @$pb.TagNumber(21)
  void clearStatusesCount() => $_clearField(21);

  @$pb.TagNumber(22)
  $core.bool get showCounts => $_getBF(21);
  @$pb.TagNumber(22)
  set showCounts($core.bool value) => $_setBool(21, value);
  @$pb.TagNumber(22)
  $core.bool hasShowCounts() => $_has(21);
  @$pb.TagNumber(22)
  void clearShowCounts() => $_clearField(22);

  @$pb.TagNumber(23)
  $pb.PbList<$core.String> get moments => $_getList(22);

  @$pb.TagNumber(24)
  $core.String get defaultVisibility => $_getSZ(23);
  @$pb.TagNumber(24)
  set defaultVisibility($core.String value) => $_setString(23, value);
  @$pb.TagNumber(24)
  $core.bool hasDefaultVisibility() => $_has(23);
  @$pb.TagNumber(24)
  void clearDefaultVisibility() => $_clearField(24);

  @$pb.TagNumber(25)
  $core.bool get manuallyApprovesFollowers => $_getBF(24);
  @$pb.TagNumber(25)
  set manuallyApprovesFollowers($core.bool value) => $_setBool(24, value);
  @$pb.TagNumber(25)
  $core.bool hasManuallyApprovesFollowers() => $_has(24);
  @$pb.TagNumber(25)
  void clearManuallyApprovesFollowers() => $_clearField(25);

  @$pb.TagNumber(26)
  $core.String get messagePermission => $_getSZ(25);
  @$pb.TagNumber(26)
  set messagePermission($core.String value) => $_setString(25, value);
  @$pb.TagNumber(26)
  $core.bool hasMessagePermission() => $_has(25);
  @$pb.TagNumber(26)
  void clearMessagePermission() => $_clearField(26);

  @$pb.TagNumber(27)
  $core.int get autoExpireDays => $_getIZ(26);
  @$pb.TagNumber(27)
  set autoExpireDays($core.int value) => $_setSignedInt32(26, value);
  @$pb.TagNumber(27)
  $core.bool hasAutoExpireDays() => $_has(26);
  @$pb.TagNumber(27)
  void clearAutoExpireDays() => $_clearField(27);
}

class UpdateProfileRequest extends $pb.GeneratedMessage {
  factory UpdateProfileRequest({
    $core.String? displayName,
    $core.String? note,
    $core.String? avatar,
    $core.String? header,
    $core.String? region,
    $core.String? timezone,
    $core.Iterable<$core.String>? tags,
    $core.Iterable<UserLink>? links,
    $core.String? defaultVisibility,
    $core.bool? manuallyApprovesFollowers,
    $core.String? messagePermission,
    $core.int? autoExpireDays,
  }) {
    final result = create();
    if (displayName != null) result.displayName = displayName;
    if (note != null) result.note = note;
    if (avatar != null) result.avatar = avatar;
    if (header != null) result.header = header;
    if (region != null) result.region = region;
    if (timezone != null) result.timezone = timezone;
    if (tags != null) result.tags.addAll(tags);
    if (links != null) result.links.addAll(links);
    if (defaultVisibility != null) result.defaultVisibility = defaultVisibility;
    if (manuallyApprovesFollowers != null)
      result.manuallyApprovesFollowers = manuallyApprovesFollowers;
    if (messagePermission != null) result.messagePermission = messagePermission;
    if (autoExpireDays != null) result.autoExpireDays = autoExpireDays;
    return result;
  }

  UpdateProfileRequest._();

  factory UpdateProfileRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory UpdateProfileRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateProfileRequest',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.actor.v1'),
      createEmptyInstance: create)
    ..aOS(1, _omitFieldNames ? '' : 'display_name')
    ..aOS(2, _omitFieldNames ? '' : 'note')
    ..aOS(3, _omitFieldNames ? '' : 'avatar')
    ..aOS(4, _omitFieldNames ? '' : 'header')
    ..aOS(5, _omitFieldNames ? '' : 'region')
    ..aOS(6, _omitFieldNames ? '' : 'timezone')
    ..pPS(7, _omitFieldNames ? '' : 'tags')
    ..pPM<UserLink>(8, _omitFieldNames ? '' : 'links',
        subBuilder: UserLink.create)
    ..aOS(9, _omitFieldNames ? '' : 'default_visibility')
    ..aOB(10, _omitFieldNames ? '' : 'manually_approves_followers')
    ..aOS(11, _omitFieldNames ? '' : 'message_permission')
    ..aI(12, _omitFieldNames ? '' : 'auto_expire_days')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateProfileRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateProfileRequest copyWith(void Function(UpdateProfileRequest) updates) =>
      super.copyWith((message) => updates(message as UpdateProfileRequest))
          as UpdateProfileRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static UpdateProfileRequest create() => UpdateProfileRequest._();
  @$core.override
  UpdateProfileRequest createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static UpdateProfileRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateProfileRequest>(create);
  static UpdateProfileRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get displayName => $_getSZ(0);
  @$pb.TagNumber(1)
  set displayName($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasDisplayName() => $_has(0);
  @$pb.TagNumber(1)
  void clearDisplayName() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get note => $_getSZ(1);
  @$pb.TagNumber(2)
  set note($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNote() => $_has(1);
  @$pb.TagNumber(2)
  void clearNote() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get avatar => $_getSZ(2);
  @$pb.TagNumber(3)
  set avatar($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasAvatar() => $_has(2);
  @$pb.TagNumber(3)
  void clearAvatar() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get header => $_getSZ(3);
  @$pb.TagNumber(4)
  set header($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasHeader() => $_has(3);
  @$pb.TagNumber(4)
  void clearHeader() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get region => $_getSZ(4);
  @$pb.TagNumber(5)
  set region($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasRegion() => $_has(4);
  @$pb.TagNumber(5)
  void clearRegion() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get timezone => $_getSZ(5);
  @$pb.TagNumber(6)
  set timezone($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasTimezone() => $_has(5);
  @$pb.TagNumber(6)
  void clearTimezone() => $_clearField(6);

  @$pb.TagNumber(7)
  $pb.PbList<$core.String> get tags => $_getList(6);

  @$pb.TagNumber(8)
  $pb.PbList<UserLink> get links => $_getList(7);

  @$pb.TagNumber(9)
  $core.String get defaultVisibility => $_getSZ(8);
  @$pb.TagNumber(9)
  set defaultVisibility($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasDefaultVisibility() => $_has(8);
  @$pb.TagNumber(9)
  void clearDefaultVisibility() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.bool get manuallyApprovesFollowers => $_getBF(9);
  @$pb.TagNumber(10)
  set manuallyApprovesFollowers($core.bool value) => $_setBool(9, value);
  @$pb.TagNumber(10)
  $core.bool hasManuallyApprovesFollowers() => $_has(9);
  @$pb.TagNumber(10)
  void clearManuallyApprovesFollowers() => $_clearField(10);

  @$pb.TagNumber(11)
  $core.String get messagePermission => $_getSZ(10);
  @$pb.TagNumber(11)
  set messagePermission($core.String value) => $_setString(10, value);
  @$pb.TagNumber(11)
  $core.bool hasMessagePermission() => $_has(10);
  @$pb.TagNumber(11)
  void clearMessagePermission() => $_clearField(11);

  @$pb.TagNumber(12)
  $core.int get autoExpireDays => $_getIZ(11);
  @$pb.TagNumber(12)
  set autoExpireDays($core.int value) => $_setSignedInt32(11, value);
  @$pb.TagNumber(12)
  $core.bool hasAutoExpireDays() => $_has(11);
  @$pb.TagNumber(12)
  void clearAutoExpireDays() => $_clearField(12);
}

class ActorList extends $pb.GeneratedMessage {
  factory ActorList({
    $core.Iterable<Actor>? items,
    $fixnum.Int64? total,
  }) {
    final result = create();
    if (items != null) result.items.addAll(items);
    if (total != null) result.total = total;
    return result;
  }

  ActorList._();

  factory ActorList.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromBuffer(data, registry);
  factory ActorList.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      create()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ActorList',
      package: const $pb.PackageName(
          _omitMessageNames ? '' : 'peers_touch.model.actor.v1'),
      createEmptyInstance: create)
    ..pPM<Actor>(1, _omitFieldNames ? '' : 'items', subBuilder: Actor.create)
    ..aInt64(2, _omitFieldNames ? '' : 'total')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorList clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ActorList copyWith(void Function(ActorList) updates) =>
      super.copyWith((message) => updates(message as ActorList)) as ActorList;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  static ActorList create() => ActorList._();
  @$core.override
  ActorList createEmptyInstance() => create();
  @$core.pragma('dart2js:noInline')
  static ActorList getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<ActorList>(create);
  static ActorList? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<Actor> get items => $_getList(0);

  @$pb.TagNumber(2)
  $fixnum.Int64 get total => $_getI64(1);
  @$pb.TagNumber(2)
  set total($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTotal() => $_has(1);
  @$pb.TagNumber(2)
  void clearTotal() => $_clearField(2);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
