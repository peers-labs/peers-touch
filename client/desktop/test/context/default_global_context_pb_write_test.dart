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
  test('Map write also persists proto json snapshots', () async {
    final ss = FakeSecureStorage();
    final ls = FakeLocalStorage();
    final ctx = DefaultGlobalContext(secureStorage: ss, localStorage: ls);
    await ctx.setSession({'actorId': 'alice', 'handle': 'alice', 'baseUrl': 'http://localhost', 'accessToken': 't'});
    await ctx.updatePreferences({'theme': 'dark', 'telemetry': true});
    final sessPb = ls.get<Map<String, dynamic>>('global:current_session_pb');
    final prefsPb = ls.get<Map<String, dynamic>>('global:user_preferences_pb');
    expect(sessPb != null, true);
    expect(prefsPb != null, true);
  });
}
