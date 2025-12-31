import 'dart:async';

import 'package:fixnum/fixnum.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/model/domain/actor/actor.pb.dart';
import 'package:peers_touch_base/model/domain/actor/preferences.pb.dart';
import 'package:peers_touch_base/model/domain/actor/session.pb.dart';
import 'package:peers_touch_base/network/connectivity_adapter.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/storage/local_storage_adapter.dart';
import 'package:peers_touch_base/storage/secure_storage_adapter.dart';

class DefaultGlobalContext implements GlobalContext {
  DefaultGlobalContext({
    required this.secureStorage,
    this.connectivity,
    this.localStorage,
  });

  final SecureStorageAdapter secureStorage;
  final ConnectivityAdapter? connectivity;
  final LocalStorageAdapter? localStorage;

  ActorSessionSnapshot? _session;
  ActorProfile? _profile;
  final List<ActorSessionSnapshot> _accounts = [];
  ActorPreferences _preferences = ActorPreferences();
  String? _protocolTag;
  bool _isRefreshingProfile = false;

  final _sessionCtrl = StreamController<ActorSessionSnapshot?>.broadcast();
  final _profileCtrl = StreamController<ActorProfile?>.broadcast();
  final _accountsCtrl = StreamController<List<ActorSessionSnapshot>>.broadcast();
  final _prefsCtrl = StreamController<ActorPreferences>.broadcast();
  final _protocolCtrl = StreamController<String?>.broadcast();
  final _netCtrl = StreamController<List<String>>.broadcast();

  void _bindConnectivity() {
    if (connectivity == null) return;
    connectivity!.onStatusChange.listen((evts) {
      _netCtrl.add(evts);
      LoggingService.info('GlobalContext.network events: $evts');
    });
  }

  @override
  ActorSessionSnapshot? get session => _session;

  @override
  ActorProfile? get profile => _profile;

  @override
  List<ActorSessionSnapshot> get accounts => List.unmodifiable(_accounts);

  @override
  ActorPreferences get preferences => _preferences;

  @override
  String? get protocolTag => _protocolTag;

  @override
  String? get actorId => _session?.actorId;

  @override
  String? get actorHandle => _session?.handle;

  @override
  Stream<ActorSessionSnapshot?> get onSessionChange => _sessionCtrl.stream;

  @override
  Stream<ActorProfile?> get onProfileChange => _profileCtrl.stream;

  @override
  Stream<List<ActorSessionSnapshot>> get onAccountsChange => _accountsCtrl.stream;

  @override
  Stream<ActorPreferences> get onPreferencesChange => _prefsCtrl.stream;

  @override
  Stream<String?> get onProtocolChange => _protocolCtrl.stream;

  @override
  Stream<List<String>> get onNetworkStatusChange => _netCtrl.stream;

  @override
  Future<void> setSession(ActorSessionSnapshot? session) async {
    _session = session;
    _sessionCtrl.add(_session);
    LoggingService.info('GlobalContext.setSession: ${session?.handle ?? 'null'}');

    if (session == null) {
      await _clearSecureTokens();
      await _clearLocalSession();
      return;
    }

    await _saveSecureTokens(session);
    await _saveLocalSession(session);
    _updateAccounts(session);
    
    refreshProfile();
  }

  Future<void> _clearSecureTokens() async {
    try {
      await secureStorage.remove('token_key');
      await secureStorage.remove('refresh_token_key');
    } catch (e) {
      LoggingService.warning('Failed to clear secure tokens: $e');
    }
  }

  Future<void> _clearLocalSession() async {
    if (localStorage == null) return;
    await localStorage!.remove('global:current_session_pb');
  }

  Future<void> _saveSecureTokens(ActorSessionSnapshot session) async {
    if (session.accessToken.isNotEmpty) {
      try {
        await secureStorage.set('token_key', session.accessToken);
      } catch (e) {
        LoggingService.warning('Failed to save access token: $e');
      }
    }
    if (session.refreshToken.isNotEmpty) {
      try {
        await secureStorage.set('refresh_token_key', session.refreshToken);
      } catch (e) {
        LoggingService.warning('Failed to save refresh token: $e');
      }
    }
  }

  Future<void> _saveLocalSession(ActorSessionSnapshot session) async {
    if (localStorage == null) return;
    try {
      await localStorage!.set('global:current_session_pb', session.toProto3Json());
    } catch (e) {
      LoggingService.warning('Failed to save session to local storage: $e');
    }
  }

  void _updateAccounts(ActorSessionSnapshot session) {
    final idx = _accounts.indexWhere(
      (a) => a.actorId == session.actorId && a.baseUrl == session.baseUrl,
    );
    if (idx >= 0) {
      _accounts[idx] = session;
    } else {
      _accounts.add(session);
    }
    _accountsCtrl.add(List.unmodifiable(_accounts));
    _saveAccounts();
    LoggingService.info('GlobalContext.accounts updated: count=${_accounts.length}');
  }

  Future<void> _saveAccounts() async {
    if (localStorage == null) return;
    try {
      final list = _accounts.map((a) => a.toProto3Json()).toList();
      await localStorage!.set('global:accounts_pb', list);
    } catch (e) {
      LoggingService.warning('Failed to save accounts: $e');
    }
  }

  @override
  Future<void> switchAccount(String actorId, String baseUrl) async {
    final found = _accounts.where(
      (a) => a.actorId == actorId && a.baseUrl == baseUrl,
    ).firstOrNull;
    if (found == null) return;
    await setSession(found);
  }

  @override
  Future<void> updatePreferences(ActorPreferences prefs) async {
    _preferences = prefs;
    _prefsCtrl.add(_preferences);
    
    if (localStorage != null) {
      try {
        await localStorage!.set('global:preferences_pb', prefs.toProto3Json());
      } catch (e) {
        LoggingService.warning('Failed to save preferences: $e');
      }
    }
    LoggingService.info('GlobalContext.updatePreferences schema=${prefs.schemaVersion}');
  }

  @override
  Future<void> setProtocolTag(String? tag) async {
    _protocolTag = tag;
    _protocolCtrl.add(_protocolTag);
    LoggingService.info('GlobalContext.setProtocolTag: ${tag ?? ''}');
  }

  @override
  Future<bool> isOnline() async {
    if (connectivity == null) return true;
    return connectivity!.isOnline();
  }

  @override
  Future<void> hydrate() async {
    _bindConnectivity();
    if (localStorage == null) return;

    await _hydrateSession();
    await _hydrateAccounts();
    await _hydratePreferences();
    await _hydrateProfile();
  }

  Future<void> _hydrateSession() async {
    try {
      final data = await localStorage!.get<Map<String, dynamic>>('global:current_session_pb');
      if (data != null) {
        final session = ActorSessionSnapshot()..mergeFromProto3Json(data);
        _session = session;
        _sessionCtrl.add(_session);
        LoggingService.info('GlobalContext.hydrate session: ${session.handle}');
      }
    } catch (e) {
      LoggingService.warning('Failed to hydrate session: $e');
    }
  }

  Future<void> _hydrateAccounts() async {
    try {
      final list = await localStorage!.get<List>('global:accounts_pb');
      if (list != null) {
        _accounts.clear();
        for (final item in list) {
          if (item is Map) {
            final account = ActorSessionSnapshot()..mergeFromProto3Json(item);
            _accounts.add(account);
          }
        }
        _accountsCtrl.add(List.unmodifiable(_accounts));
      }
    } catch (e) {
      LoggingService.warning('Failed to hydrate accounts: $e');
    }
  }

  Future<void> _hydratePreferences() async {
    try {
      final data = await localStorage!.get<Map<String, dynamic>>('global:preferences_pb');
      if (data != null) {
        _preferences = ActorPreferences()..mergeFromProto3Json(data);
        _prefsCtrl.add(_preferences);
        LoggingService.info('GlobalContext.hydrate preferences schema: ${_preferences.schemaVersion}');
      }
    } catch (e) {
      LoggingService.warning('Failed to hydrate preferences: $e');
    }
  }

  Future<void> _hydrateProfile() async {
    final handle = actorHandle;
    if (handle == null || handle.isEmpty) return;
    
    try {
      final data = await localStorage!.get<Map<String, dynamic>>('profile_cache_$handle');
      if (data != null) {
        _profile = _mapToActorProfile(data);
        _profileCtrl.add(_profile);
        LoggingService.info('GlobalContext.hydrate profile from cache: $handle');
      }
    } catch (e) {
      LoggingService.warning('Failed to hydrate profile: $e');
    }
  }

  @override
  Future<void> refreshProfile() async {
    if (_isRefreshingProfile) return;
    final handle = actorHandle;
    if (handle == null || handle.isEmpty) return;

    _isRefreshingProfile = true;
    try {
      final client = HttpServiceLocator().httpService;
      final response = await client.getResponse<dynamic>('/activitypub/$handle/profile');
      
      if (response.statusCode == 200 && response.data is Map) {
        final data = (response.data as Map).cast<String, dynamic>();
        _profile = _mapToActorProfile(data);
        _profileCtrl.add(_profile);

        if (localStorage != null) {
          await localStorage!.set('profile_cache_$handle', data);
        }

        _syncAvatarToSession();
        LoggingService.info('GlobalContext.refreshProfile: $handle loaded');
      }
    } catch (e) {
      LoggingService.warning('GlobalContext.refreshProfile failed: $e');
    } finally {
      _isRefreshingProfile = false;
    }
  }

  ActorProfile _mapToActorProfile(Map<String, dynamic> data) {
    return ActorProfile(
      id: data['id']?.toString() ?? '',
      displayName: data['display_name']?.toString() ?? data['displayName']?.toString() ?? '',
      username: data['username']?.toString() ?? data['handle']?.toString() ?? '',
      note: data['note']?.toString() ?? data['summary']?.toString() ?? '',
      avatar: data['avatar']?.toString() ?? data['avatarUrl']?.toString() ?? '',
      header: data['header']?.toString() ?? data['coverUrl']?.toString() ?? '',
      region: data['region']?.toString() ?? '',
      timezone: data['timezone']?.toString() ?? '',
      tags: (data['tags'] as List?)?.map((e) => e.toString()).toList() ?? [],
      links: (data['links'] as List?)?.map((e) {
        final m = (e as Map).cast<String, dynamic>();
        return UserLink(
          label: m['label']?.toString() ?? '',
          url: m['url']?.toString() ?? '',
        );
      }).toList() ?? [],
      url: data['url']?.toString() ?? data['actorUrl']?.toString() ?? '',
      serverDomain: data['server_domain']?.toString() ?? data['serverDomain']?.toString() ?? '',
      keyFingerprint: data['key_fingerprint']?.toString() ?? data['keyFingerprint']?.toString() ?? '',
      verifications: (data['verifications'] as List?)?.map((e) => e.toString()).toList() ?? [],
      peersTouch: data['peers_touch'] != null
          ? PeersTouchInfo(networkId: data['peers_touch']['network_id']?.toString() ?? '')
          : null,
      acct: data['acct']?.toString() ?? '',
      locked: data['locked'] == true,
      createdAt: data['created_at']?.toString() ?? data['createdAt']?.toString() ?? '',
      followersCount: Int64(data['followers_count'] as int? ?? data['followersCount'] as int? ?? 0),
      followingCount: Int64(data['following_count'] as int? ?? data['followingCount'] as int? ?? 0),
      statusesCount: Int64(data['statuses_count'] as int? ?? data['statusesCount'] as int? ?? 0),
      showCounts: data['show_counts'] != false && data['showCounts'] != false,
      moments: (data['moments'] as List?)?.map((e) => e.toString()).toList() ?? [],
      defaultVisibility: data['default_visibility']?.toString() ?? data['defaultVisibility']?.toString() ?? 'public',
      manuallyApprovesFollowers: data['manually_approves_followers'] == true || data['manuallyApprovesFollowers'] == true,
      messagePermission: data['message_permission']?.toString() ?? data['messagePermission']?.toString() ?? 'everyone',
      autoExpireDays: data['auto_expire_days'] as int? ?? data['autoExpireDays'] as int? ?? 0,
    );
  }

  void _syncAvatarToSession() {
    if (_profile == null || _session == null) return;
    
    final avatarUrl = _profile!.avatar;
    if (avatarUrl.isNotEmpty && _session!.accessToken.isNotEmpty) {
      _session = ActorSessionSnapshot(
        actorId: _session!.actorId,
        handle: _session!.handle,
        protocol: _session!.protocol,
        baseUrl: _session!.baseUrl,
        accessToken: _session!.accessToken,
        refreshToken: _session!.refreshToken,
        expiresAt: _session!.hasExpiresAt() ? _session!.expiresAt : null,
        roles: _session!.roles,
      );
      _sessionCtrl.add(_session);
    }
  }

  @override
  void setProfile(ActorProfile? profile) {
    _profile = profile;
    _profileCtrl.add(_profile);

    if (profile != null && localStorage != null && actorHandle != null) {
      localStorage!.set('profile_cache_$actorHandle', profile.toProto3Json());
    }

    _syncAvatarToSession();
  }

  @override
  void clearProfile() {
    _profile = null;
    _profileCtrl.add(null);
  }
}
