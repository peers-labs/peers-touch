import 'dart:async';

import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
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
  Map<String, dynamic>? _session;
  Map<String, dynamic>? _userProfile;
  final List<Map<String, dynamic>> _accounts = [];
  Map<String, dynamic> _preferences = {};
  String? _protocolTag;
  bool _isRefreshingProfile = false;
  bool _isHydrated = false;
  Completer<void>? _hydrateCompleter;
  String? _lastLogoutMessage;
  final _sessionCtrl = StreamController<Map<String, dynamic>?>.broadcast();
  final _profileCtrl = StreamController<Map<String, dynamic>?>.broadcast();
  final _accountsCtrl =
      StreamController<List<Map<String, dynamic>>>.broadcast();
  final _prefsCtrl = StreamController<Map<String, dynamic>>.broadcast();
  final _protocolCtrl = StreamController<String?>.broadcast();
  final _netCtrl = StreamController<List<String>>.broadcast();
  final _logoutCtrl = StreamController<LogoutReason>.broadcast();

  void _bindConnectivity() {
    if (connectivity == null) return;
    connectivity!.onStatusChange.listen((evts) {
      _netCtrl.add(evts);
      try {
        LoggingService.info('GlobalContext.network events: $evts');
      } catch (_) {}
    });
  }

  @override
  Map<String, dynamic>? get currentSession => _session;
  @override
  Map<String, dynamic>? get userProfile => _userProfile;
  @override
  List<Map<String, dynamic>> get accounts => List.unmodifiable(_accounts);
  @override
  Map<String, dynamic> get preferences => Map.unmodifiable(_preferences);
  @override
  String? get protocolTag => _protocolTag;
  @override
  String? get actorId =>
      _session?['actorId']?.toString() ?? _session?['userId']?.toString();
  @override
  String? get actorHandle =>
      _session?['handle']?.toString() ?? _session?['username']?.toString();
  @override
  Stream<Map<String, dynamic>?> get onSessionChange => _sessionCtrl.stream;
  @override
  Stream<Map<String, dynamic>?> get onProfileChange => _profileCtrl.stream;
  @override
  Stream<List<Map<String, dynamic>>> get onAccountChange =>
      _accountsCtrl.stream;
  @override
  Stream<Map<String, dynamic>> get onPreferencesChange => _prefsCtrl.stream;
  @override
  Stream<String?> get onProtocolChange => _protocolCtrl.stream;
  @override
  Stream<List<String>> get onNetworkStatusChange => _netCtrl.stream;

  Map<String, dynamic> _normalizeSession(Map<String, dynamic> raw) {
    final m = Map<String, dynamic>.from(raw);
    final actorId =
        (m['actorId']?.toString()) ?? (m['userId']?.toString()) ?? '';
    final handle =
        (m['handle']?.toString()) ?? (m['username']?.toString()) ?? '';
    m['actorId'] = actorId;
    m['handle'] = handle;
    m['userId'] = actorId; // compatibility
    m['username'] = handle; // compatibility
    return m;
  }

  @override
  Future<void> setSession(Map<String, dynamic>? session) async {
    _session = session != null ? _normalizeSession(session) : null;
    _sessionCtrl.add(_session);
    try {
      LoggingService.info(
        'GlobalContext.setSession: ${_session != null ? _session!['handle'] : 'null'}',
      );
    } catch (_) {}
    if (session == null) {
      try {
        await secureStorage.remove('token_key');
      } catch (e) {
        LoggingService.warning(
          'Failed to remove token from secure storage: $e',
        );
      }
      try {
        await secureStorage.remove('refresh_token_key');
      } catch (e) {
        LoggingService.warning(
          'Failed to remove refresh token from secure storage: $e',
        );
      }
      if (localStorage != null) {
        await localStorage!.remove('global:current_session');
        await localStorage!.remove('global:current_session_pb');
      }
      return;
    }
    final access = _session?['accessToken']?.toString() ?? '';
    final refresh = _session?['refreshToken']?.toString();
    if (access.isNotEmpty) {
      try {
        await secureStorage.set('token_key', access);
      } catch (e) {
        LoggingService.warning('Failed to write token to secure storage: $e');
      }
    }
    if (refresh != null && refresh.isNotEmpty) {
      try {
        await secureStorage.set('refresh_token_key', refresh);
      } catch (e) {
        LoggingService.warning(
          'Failed to write refresh token to secure storage: $e',
        );
      }
    }
    if (localStorage != null) {
      await localStorage!.set('global:current_session', _session);
      try {
        final snap = ActorSessionSnapshot(
          actorId: actorId ?? '',
          handle: actorHandle ?? '',
          protocol: (_session?['protocol']?.toString() ?? ''),
          baseUrl: (_session?['baseUrl']?.toString() ?? ''),
          accessToken: access,
          refreshToken: refresh ?? '',
          roles: (_session?['roles'] is List
              ? List<String>.from(_session?['roles'])
              : <String>[]),
        );
        await localStorage!.set(
          'global:current_session_pb',
          snap.toProto3Json(),
        );
      } catch (_) {}
    }
    final idx = _accounts.indexWhere(
      (a) =>
          (a['actorId']?.toString() == _session?['actorId']?.toString()) &&
          (a['baseUrl']?.toString() == _session?['baseUrl']?.toString()),
    );
    if (idx >= 0) {
      _accounts[idx] = _session!;
    } else {
      _accounts.add(_session!);
    }
    _accountsCtrl.add(List.unmodifiable(_accounts));
    if (localStorage != null) {
      await localStorage!.set('global:accounts', _accounts);
      await localStorage!.set('global:accounts_schema', 1);
    }
    try {
      LoggingService.info(
        'GlobalContext.accounts updated: count=${_accounts.length}',
      );
    } catch (_) {}
    
    refreshProfile();
  }

  @override
  Future<void> setSessionSnapshot(ActorSessionSnapshot snapshot) async {
    final map = {
      'actorId': snapshot.actorId,
      'handle': snapshot.handle,
      'protocol': snapshot.protocol,
      'baseUrl': snapshot.baseUrl,
      'accessToken': snapshot.accessToken,
      'refreshToken': snapshot.refreshToken,
      if (snapshot.hasExpiresAt())
        'expiresAt': snapshot.expiresAt.toDateTime().toIso8601String(),
      'roles': snapshot.roles,
    };
    await setSession(map);
    try {
      if (localStorage != null) {
        await localStorage!.set(
          'global:current_session_pb',
          snapshot.toProto3Json(),
        );
      }
    } catch (_) {}
  }

  @override
  ActorSessionSnapshot? getSessionSnapshot() {
    final s = _session;
    if (s == null) return null;
    final snap = ActorSessionSnapshot(
      actorId: (s['actorId']?.toString() ?? s['userId']?.toString() ?? ''),
      handle: (s['handle']?.toString() ?? s['username']?.toString() ?? ''),
      protocol: (s['protocol']?.toString() ?? ''),
      baseUrl: (s['baseUrl']?.toString() ?? ''),
      accessToken: (s['accessToken']?.toString() ?? ''),
      refreshToken: (s['refreshToken']?.toString() ?? ''),
      roles: (s['roles'] is List ? List<String>.from(s['roles']) : <String>[]),
    );
    return snap;
  }

  @override
  Future<void> switchAccount(String userId, String baseUrl) async {
    final found = _accounts.firstWhere(
      (a) =>
          a['userId']?.toString() == userId &&
          a['baseUrl']?.toString() == baseUrl,
      orElse: () => {},
    );
    if (found.isEmpty) return;
    await setSession(found);
  }

  @override
  Future<void> updatePreferences(Map<String, dynamic> prefs) async {
    _preferences = Map.of(prefs);
    if (!_preferences.containsKey('schemaVersion')) {
      _preferences['schemaVersion'] = 1;
    }
    _prefsCtrl.add(Map.unmodifiable(_preferences));
    if (localStorage != null) {
      await localStorage!.set('global:user_preferences', _preferences);
      try {
        final entriesOverrides = (_preferences['endpoint_overrides'] is Map)
            ? (_preferences['endpoint_overrides'] as Map).entries.map(
                (e) => MapEntry(e.key.toString(), e.value.toString()),
              )
            : const <MapEntry<String, String>>[];
        final entriesFlags = (_preferences['feature_flags'] is Map)
            ? (_preferences['feature_flags'] as Map).entries.map(
                (e) => MapEntry(e.key.toString(), e.value == true),
              )
            : const <MapEntry<String, bool>>[];
        final snap = ActorPreferences(
          theme: (_preferences['theme']?.toString() ?? ''),
          locale: (_preferences['locale']?.toString() ?? ''),
          telemetry: _preferences['telemetry'] == true,
          endpointOverrides: entriesOverrides,
          featureFlags: entriesFlags,
          schemaVersion: (_preferences['schemaVersion'] is int)
              ? (_preferences['schemaVersion'] as int)
              : int.tryParse(_preferences['schemaVersion']?.toString() ?? '') ??
                    1,
        );
        await localStorage!.set(
          'global:user_preferences_pb',
          snap.toProto3Json(),
        );
      } catch (_) {}
    }
    try {
      LoggingService.info(
        'GlobalContext.updatePreferences schema=${_preferences['schemaVersion']}',
      );
    } catch (_) {}
  }

  @override
  Future<void> updatePreferencesSnapshot(ActorPreferences prefs) async {
    final map = {
      if (prefs.theme.isNotEmpty) 'theme': prefs.theme,
      if (prefs.locale.isNotEmpty) 'locale': prefs.locale,
      'telemetry': prefs.telemetry,
      'endpoint_overrides': prefs.endpointOverrides,
      'feature_flags': prefs.featureFlags,
      'schemaVersion': prefs.schemaVersion,
    };
    await updatePreferences(map);
    try {
      if (localStorage != null) {
        await localStorage!.set(
          'global:user_preferences_pb',
          prefs.toProto3Json(),
        );
      }
    } catch (_) {}
  }

  @override
  ActorPreferences? getPreferencesSnapshot() {
    final p = _preferences;
    final snap = ActorPreferences(
      theme: (p['theme']?.toString() ?? ''),
      locale: (p['locale']?.toString() ?? ''),
      telemetry: p['telemetry'] == true,
      endpointOverrides: (p['endpoint_overrides'] is Map)
          ? (p['endpoint_overrides'] as Map).entries.map(
              (e) => MapEntry(e.key.toString(), e.value.toString()),
            )
          : const <MapEntry<String, String>>[],
      featureFlags: (p['feature_flags'] is Map)
          ? (p['feature_flags'] as Map).entries.map(
              (e) => MapEntry(e.key.toString(), e.value == true),
            )
          : const <MapEntry<String, bool>>[],
      schemaVersion: (p['schemaVersion'] is int)
          ? (p['schemaVersion'] as int)
          : int.tryParse(p['schemaVersion']?.toString() ?? '') ?? 1,
    );
    return snap;
  }

  @override
  Future<void> hydrate() async {
    // Prevent double hydration — if already hydrated, just return.
    // If hydration is in progress, await the existing operation.
    if (_isHydrated) return;
    if (_hydrateCompleter != null) {
      await _hydrateCompleter!.future;
      return;
    }
    _hydrateCompleter = Completer<void>();
    
    try {
      _bindConnectivity();
      if (localStorage == null) {
        _isHydrated = true;
        _hydrateCompleter!.complete();
        return;
      }
      // Prefer proto JSON if present
      try {
        final sessPb = await localStorage!.get<Map<String, dynamic>>(
          'global:current_session_pb',
        );
        if (sessPb != null) {
          final snap = ActorSessionSnapshot();
          snap.mergeFromProto3Json(sessPb);
          await setSessionSnapshot(snap);
        }
      } catch (_) {}
      final sess = await localStorage!.get<Map<String, dynamic>>(
        'global:current_session',
      );
      if (sess != null) {
        _session = _normalizeSession(sess);
        _sessionCtrl.add(_session);
        try {
          LoggingService.info(
            'GlobalContext.hydrate session: ${_session?['handle']}',
          );
        } catch (_) {}
      }
      final accs = await localStorage!.get<List>('global:accounts');
      if (accs is List) {
        _accounts
          ..clear()
          ..addAll(
            accs.whereType<Map>().map(
              (e) => _normalizeSession(e.cast<String, dynamic>()),
            ),
          );
        _accountsCtrl.add(List.unmodifiable(_accounts));
        final schema = await localStorage!.get<int>('global:accounts_schema');
        if (schema == null) {
          await localStorage!.set('global:accounts_schema', 1);
        }
      }
      final prefs = await localStorage!.get<Map<String, dynamic>>(
        'global:user_preferences',
      );
      if (prefs != null) {
        _preferences = Map<String, dynamic>.from(prefs);
        if (!_preferences.containsKey('schemaVersion')) {
          _preferences['schemaVersion'] = 1;
          await localStorage!.set('global:user_preferences', _preferences);
        }
        _prefsCtrl.add(Map.unmodifiable(_preferences));
        try {
          LoggingService.info(
            'GlobalContext.hydrate preferences schema: ${_preferences['schemaVersion']}',
          );
        } catch (_) {}
      }
      try {
        final prefsPb = await localStorage!.get<Map<String, dynamic>>(
          'global:user_preferences_pb',
        );
        if (prefsPb != null) {
          final pp = ActorPreferences();
          pp.mergeFromProto3Json(prefsPb);
          await updatePreferencesSnapshot(pp);
        }
      } catch (_) {}
      
      _isHydrated = true;
      _hydrateCompleter!.complete();
    } catch (e) {
      _hydrateCompleter!.completeError(e);
      _hydrateCompleter = null; // Allow retry on failure
      rethrow;
    }
  }

  @override
  Future<void> setProtocolTag(String? tag) async {
    _protocolTag = tag;
    _protocolCtrl.add(_protocolTag);
    try {
      LoggingService.info(
        'GlobalContext.setProtocolTag: ${_protocolTag ?? ''}',
      );
    } catch (_) {}
  }

  @override
  Future<bool> isOnline() async {
    if (connectivity == null) return true;
    return connectivity!.isOnline();
  }

  @override
  Future<void> refreshProfile() async {
    if (_isRefreshingProfile) {
      LoggingService.debug('GlobalContext.refreshProfile: Already refreshing, skipping');
      // Wait for existing refresh to complete
      while (_isRefreshingProfile) {
        await Future.delayed(const Duration(milliseconds: 50));
      }
      // After waiting, check if profile was loaded
      if (_userProfile != null && _userProfile!['id'] != null) {
        return;
      }
      throw Exception('Profile refresh failed: no profile available after waiting');
    }
    final handle = actorHandle;
    if (handle == null || handle.isEmpty) {
      LoggingService.warning('GlobalContext.refreshProfile: No handle available');
      throw Exception('No handle available to refresh profile');
    }
    
    _isRefreshingProfile = true;
    LoggingService.info('GlobalContext.refreshProfile: Starting for handle=$handle');
    try {
      final client = HttpServiceLocator().httpService;
      final response = await client.getResponse<dynamic>(
        '/activitypub/$handle/profile',
      );
      LoggingService.info('GlobalContext.refreshProfile: Response status=${response.statusCode}');
      if (response.statusCode == 200 && response.data is Map) {
        _userProfile = (response.data as Map).cast<String, dynamic>();
        _profileCtrl.add(_userProfile);
        
        LoggingService.debug('GlobalContext.refreshProfile: Raw profile data keys: ${_userProfile?.keys.toList()}');
        LoggingService.debug('GlobalContext.refreshProfile: avatar field = "${_userProfile?['avatar']}"');
        LoggingService.debug('GlobalContext.refreshProfile: avatarUrl field = "${_userProfile?['avatarUrl']}"');
        
        if (_userProfile != null && localStorage != null) {
          await localStorage!.set('profile_cache_$handle', _userProfile);
        }
        
        final avatarUrl = _userProfile?['avatar']?.toString() ?? 
                          _userProfile?['avatarUrl']?.toString();
        LoggingService.debug('GlobalContext.refreshProfile: Final avatarUrl = "$avatarUrl"');
        
        if (avatarUrl != null && avatarUrl.isNotEmpty && _session != null) {
          final currentAvatar = _session!['avatarUrl']?.toString() ?? '';
          if (currentAvatar != avatarUrl) {
            _session!['avatarUrl'] = avatarUrl;
            _sessionCtrl.add(_session);
            LoggingService.info('GlobalContext.refreshProfile: Updated session avatarUrl to "$avatarUrl"');
          }
        }
        
        LoggingService.info('GlobalContext.refreshProfile: $handle loaded successfully');
      } else {
        LoggingService.warning('GlobalContext.refreshProfile: Invalid response status=${response.statusCode}');
        // Rethrow to let caller handle this
        throw Exception('Profile not found: status=${response.statusCode}');
      }
    } catch (e) {
      LoggingService.warning('GlobalContext.refreshProfile failed: $e');
      // Rethrow so caller knows the profile refresh failed
      rethrow;
    } finally {
      _isRefreshingProfile = false;
    }
  }

  @override
  void setProfile(Map<String, dynamic>? profile) {
    _userProfile = profile;
    _profileCtrl.add(_userProfile);
    
    if (profile != null && localStorage != null && actorHandle != null) {
      localStorage!.set('profile_cache_$actorHandle', profile);
    }
    
    final avatarUrl = profile?['avatar']?.toString() ?? 
                      profile?['avatarUrl']?.toString();
    if (avatarUrl != null && avatarUrl.isNotEmpty && _session != null) {
      final currentAvatar = _session!['avatarUrl']?.toString() ?? '';
      if (currentAvatar != avatarUrl) {
        _session!['avatarUrl'] = avatarUrl;
        _sessionCtrl.add(_session);
      }
    }
  }

  @override
  void clearProfile() {
    _userProfile = null;
    _profileCtrl.add(null);
  }

  @override
  Stream<LogoutReason> get onLogoutRequested => _logoutCtrl.stream;

  @override
  String? get lastLogoutMessage => _lastLogoutMessage;

  @override
  void requestLogout(LogoutReason reason, {String? message}) {
    _lastLogoutMessage = message ?? _defaultMessageForReason(reason);
    LoggingService.info('GlobalContext.requestLogout: reason=$reason, message=$_lastLogoutMessage');
    _logoutCtrl.add(reason);
  }

  String _defaultMessageForReason(LogoutReason reason) {
    switch (reason) {
      case LogoutReason.userInitiated:
        return '您已退出登录';
      case LogoutReason.tokenExpired:
        return '登录已过期，请重新登录';
      case LogoutReason.userNotFound:
        return '用户不存在，请重新登录';
      case LogoutReason.forcedByServer:
        return '您已被强制下线';
      case LogoutReason.sessionCleared:
        return '会话已清除，请重新登录';
    }
  }
}
