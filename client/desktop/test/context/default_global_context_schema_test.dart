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
  test('preferences schemaVersion set on update and hydrate', () async {
    final ls = FakeLocalStorage();
    final ctx = DefaultGlobalContext(secureStorage: FakeSecureStorage(), localStorage: ls);
    await ctx.updatePreferences({'theme': 'light'});
    final saved = ls.get<Map<String, dynamic>>('global:user_preferences');
    expect(saved?['schemaVersion'], 1);
    ls._store['global:user_preferences'] = {'theme': 'dark'};
    await ctx.hydrate();
    expect(ctx.preferences['schemaVersion'], 1);
  });
}
