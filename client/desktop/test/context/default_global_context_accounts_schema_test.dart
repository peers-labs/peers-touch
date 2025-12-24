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
  test('accounts schemaVersion is set on write and hydrate', () async {
    final ls = FakeLocalStorage();
    final ctx = DefaultGlobalContext(secureStorage: FakeSecureStorage(), localStorage: ls);
    await ctx.setSession({'actorId': 'alice', 'handle': 'alice', 'baseUrl': 'http://localhost'});
    expect(ls.get<int>('global:accounts_schema'), 1);
    ls._store.remove('global:accounts_schema');
    await ctx.hydrate();
    expect(ls.get<int>('global:accounts_schema'), 1);
  });
}
