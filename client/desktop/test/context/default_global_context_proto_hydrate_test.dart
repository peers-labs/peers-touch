import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/context/default_global_context.dart';
import 'package:peers_touch_base/model/domain/actor/preferences.pb.dart';
import 'package:peers_touch_base/model/domain/actor/session.pb.dart';
import 'package:peers_touch_base/storage/local_storage_adapter.dart';
import 'package:peers_touch_base/storage/secure_storage_adapter.dart';

class FakeSecureStorage implements SecureStorageAdapter {
  @override
  Future<String?> get(String key) async => null;
  @override
  Future<void> remove(String key) async {}
  @override
  Future<void> set(String key, String value) async {}
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
  test('hydrate prefers proto json for session and preferences', () async {
    final ls = FakeLocalStorage();
    final snap = ActorSessionSnapshot(
      actorId: 'alice',
      handle: 'alice',
      protocol: 'peers-touch',
      baseUrl: 'http://localhost:18080',
      accessToken: 't',
      refreshToken: 'r',
    );
    ls._store['global:current_session_pb'] = snap.toProto3Json();
    final prefs = ActorPreferences(
      theme: 'dark',
      locale: 'zh-CN',
      telemetry: true,
      endpointOverrides: <MapEntry<String, String>>[MapEntry('api', 'http://localhost')],
      featureFlags: <MapEntry<String, bool>>[MapEntry('x', true)],
      schemaVersion: 1,
    );
    ls._store['global:user_preferences_pb'] = prefs.toProto3Json();

    final ctx = DefaultGlobalContext(secureStorage: FakeSecureStorage(), localStorage: ls);
    await ctx.hydrate();
    expect(ctx.actorHandle, 'alice');
    final gotPrefs = ctx.getPreferencesSnapshot();
    expect(gotPrefs?.theme, 'dark');
    expect(gotPrefs?.schemaVersion, 1);
  });
}
