import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/context/default_global_context.dart';
import 'package:peers_touch_base/storage/local_storage_adapter.dart';
import 'package:peers_touch_base/storage/secure_storage_adapter.dart';

class FakeSecureStorage implements SecureStorageAdapter {
  final Map<String, String> _store = {};
  @override
  Future<String?> get(String key) async => _store[key];
  @override
  Future<void> remove(String key) async => _store.remove(key);
  @override
  Future<void> set(String key, String value) async => _store[key] = value;
}

class FakeLocalStorage implements LocalStorageAdapter {
  final Map<String, dynamic> _store = {};
  @override
  T? get<T>(String key) => _store[key] as T?;
  @override
  Future<void> remove(String key) async => _store.remove(key);
  @override
  Future<void> set(String key, dynamic value) async => _store[key] = value;
}

void main() {
  test('hydrate loads session/accounts/preferences and normalizes keys', () async {
    final ls = FakeLocalStorage();
    await ls.set('global:current_session', {
      'userId': 'alice',
      'username': 'alice',
      'baseUrl': 'http://localhost:18080',
      'accessToken': 't',
    });
    await ls.set('global:accounts', [
      {'userId': 'alice', 'username': 'alice', 'baseUrl': 'http://localhost:18080'},
    ]);
    await ls.set('global:user_preferences', {'theme': 'dark'});
    final ctx = DefaultGlobalContext(secureStorage: FakeSecureStorage(), localStorage: ls);
    await ctx.hydrate();
    expect(ctx.currentSession?['actorId'], 'alice');
    expect(ctx.currentSession?['handle'], 'alice');
    expect(ctx.accounts.length, 1);
    expect(ctx.preferences['theme'], 'dark');
  });
}
