import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/context/default_global_context.dart';
import 'package:peers_touch_base/storage/secure_storage_adapter.dart';
import 'package:peers_touch_base/storage/local_storage_adapter.dart';

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
  test('setSession persists session and accounts', () async {
    final ss = FakeSecureStorage();
    final ls = FakeLocalStorage();
    final ctx = DefaultGlobalContext(secureStorage: ss, localStorage: ls);
    await ctx.setSession({
      'userId': 'u1',
      'username': 'u1',
      'protocol': 'peers-touch',
      'baseUrl': 'http://localhost:18080',
      'accessToken': 'token123',
    });
    final sess = ls.get<Map<String, dynamic>>('global:current_session');
    final accs = ls.get<List>('global:accounts');
    expect(sess?['username'], 'u1');
    expect(accs?.length, 1);
  });

  test('updatePreferences persists preferences', () async {
    final ctx = DefaultGlobalContext(secureStorage: FakeSecureStorage(), localStorage: FakeLocalStorage());
    await ctx.updatePreferences({'theme': 'dark'});
    final ls = (ctx.localStorage as FakeLocalStorage);
    final prefs = ls.get<Map<String, dynamic>>('global:user_preferences');
    expect(prefs?['theme'], 'dark');
  });
}
