import '../storage/secure_storage_adapter.dart';
import '../storage/local_storage_adapter.dart';
import 'token_provider.dart';

class DefaultTokenProvider implements TokenProvider {
  final SecureStorageAdapter secureStorage;
  final LocalStorageAdapter? localStorage;
  DefaultTokenProvider({required this.secureStorage, this.localStorage});
  @override
  Future<void> clear() async {
    try { await secureStorage.remove('token_key'); } catch (_) {}
    try { await secureStorage.remove('refresh_token_key'); } catch (_) {}
    if (localStorage != null) {
      final sess = await localStorage!.get<Map<String, dynamic>>('global:current_session');
      if (sess != null) {
        sess['accessToken'] = '';
        sess['refreshToken'] = '';
        await localStorage!.set('global:current_session', sess);
      }
    }
  }

  @override
  Future<String?> readAccessToken() async {
    try {
      final t = await secureStorage.get('token_key');
      if (t != null && t.isNotEmpty) return t;
    } catch (_) {}
    if (localStorage != null) {
      final sess = await localStorage!.get<Map<String, dynamic>>('global:current_session');
      final v = sess?['accessToken']?.toString();
      if (v != null && v.isNotEmpty) return v;
    }
    return null;
  }

  @override
  Future<String?> readRefreshToken() async {
    try {
      final t = await secureStorage.get('refresh_token_key');
      if (t != null && t.isNotEmpty) return t;
    } catch (_) {}
    if (localStorage != null) {
      final sess = await localStorage!.get<Map<String, dynamic>>('global:current_session');
      final v = sess?['refreshToken']?.toString();
      if (v != null && v.isNotEmpty) return v;
    }
    return null;
  }

  @override
  Future<void> writeTokens({required String accessToken, String? refreshToken}) async {
    try { await secureStorage.set('token_key', accessToken); } catch (_) {}
    if (refreshToken != null && refreshToken.isNotEmpty) {
      try { await secureStorage.set('refresh_token_key', refreshToken); } catch (_) {}
    }
    if (localStorage != null) {
      final sess = await localStorage!.get<Map<String, dynamic>>('global:current_session');
      final m = Map<String, dynamic>.from(sess ?? const {});
      m['accessToken'] = accessToken;
      if (refreshToken != null && refreshToken.isNotEmpty) {
        m['refreshToken'] = refreshToken;
      }
      await localStorage!.set('global:current_session', m);
    }
  }
}
