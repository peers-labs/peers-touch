import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/network/token_provider.dart';
import 'package:peers_touch_base/storage/local_storage_adapter.dart';
import 'package:peers_touch_base/storage/secure_storage_adapter.dart';

class DefaultTokenProvider implements TokenProvider {
  DefaultTokenProvider({required this.secureStorage, this.localStorage});
  final SecureStorageAdapter secureStorage;
  final LocalStorageAdapter? localStorage;
  
  // In-memory token cache for this process (avoids shared storage issues with multiple instances)
  String? _cachedAccessToken;
  String? _cachedRefreshToken;
  String? _cachedSessionId;
  
  @override
  Future<void> clear() async {
    _cachedAccessToken = null;
    _cachedRefreshToken = null;
    _cachedSessionId = null;
    try { await secureStorage.remove('token_key'); } catch (_) {}
    try { await secureStorage.remove('refresh_token_key'); } catch (_) {}
    try { await secureStorage.remove('session_id_key'); } catch (_) {}
  }

  @override
  Future<String?> readAccessToken() async {
    // 1. First check in-memory cache (process-specific, won't be overwritten by other instances)
    if (_cachedAccessToken != null && _cachedAccessToken!.isNotEmpty) {
      return _cachedAccessToken;
    }
    
    // 2. Then check GlobalContext in-memory session (if registered)
    if (Get.isRegistered<GlobalContext>()) {
      final gc = Get.find<GlobalContext>();
      final t = gc.currentSession?['accessToken']?.toString();
      if (t != null && t.isNotEmpty) {
        _cachedAccessToken = t;
        return t;
      }
    }
    
    // 3. Fallback to SecureStorage (but this may be shared between instances)
    try {
      final t = await secureStorage.get('token_key');
      if (t != null && t.isNotEmpty) {
        _cachedAccessToken = t;
        return t;
      }
    } catch (_) {}
    
    return null;
  }

  @override
  Future<String?> readRefreshToken() async {
    // 1. Check in-memory cache
    if (_cachedRefreshToken != null && _cachedRefreshToken!.isNotEmpty) {
      return _cachedRefreshToken;
    }
    
    // 2. Check GlobalContext
    if (Get.isRegistered<GlobalContext>()) {
      final gc = Get.find<GlobalContext>();
      final t = gc.currentSession?['refreshToken']?.toString();
      if (t != null && t.isNotEmpty) {
        _cachedRefreshToken = t;
        return t;
      }
    }
    
    // 3. Fallback to SecureStorage
    try {
      final t = await secureStorage.get('refresh_token_key');
      if (t != null && t.isNotEmpty) {
        _cachedRefreshToken = t;
        return t;
      }
    } catch (_) {}
    
    return null;
  }

  @override
  Future<String?> readSessionId() async {
    // 1. Check in-memory cache
    if (_cachedSessionId != null && _cachedSessionId!.isNotEmpty) {
      return _cachedSessionId;
    }
    
    // 2. Check GlobalContext
    if (Get.isRegistered<GlobalContext>()) {
      final gc = Get.find<GlobalContext>();
      final t = gc.currentSession?['sessionId']?.toString();
      if (t != null && t.isNotEmpty) {
        _cachedSessionId = t;
        return t;
      }
    }
    
    // 3. Fallback to SecureStorage
    try {
      final t = await secureStorage.get('session_id_key');
      if (t != null && t.isNotEmpty) {
        _cachedSessionId = t;
        return t;
      }
    } catch (_) {}
    
    return null;
  }

  @override
  Future<void> writeTokens({required String accessToken, String? refreshToken, String? sessionId}) async {
    // Update in-memory cache
    _cachedAccessToken = accessToken;
    if (refreshToken != null && refreshToken.isNotEmpty) {
      _cachedRefreshToken = refreshToken;
    }
    if (sessionId != null && sessionId.isNotEmpty) {
      _cachedSessionId = sessionId;
    }
    
    // Also persist to SecureStorage for app restart
    try { await secureStorage.set('token_key', accessToken); } catch (_) {}
    if (refreshToken != null && refreshToken.isNotEmpty) {
      try { await secureStorage.set('refresh_token_key', refreshToken); } catch (_) {}
    }
    if (sessionId != null && sessionId.isNotEmpty) {
      try { await secureStorage.set('session_id_key', sessionId); } catch (_) {}
    }
    
    // Sync tokens back to GlobalContext so that all readers (AuthMiddleware,
    // _checkSessionValidity, etc.) see the updated values.
    try {
      if (Get.isRegistered<GlobalContext>()) {
        final gc = Get.find<GlobalContext>();
        final session = gc.currentSession;
        if (session != null) {
          session['accessToken'] = accessToken;
          if (refreshToken != null && refreshToken.isNotEmpty) {
            session['refreshToken'] = refreshToken;
          }
          if (sessionId != null && sessionId.isNotEmpty) {
            session['sessionId'] = sessionId;
          }
        }
      }
    } catch (_) {}
  }
}
