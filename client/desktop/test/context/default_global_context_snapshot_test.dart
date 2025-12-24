import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/context/default_global_context.dart';
import 'package:peers_touch_base/model/domain/actor/preferences.pb.dart';
import 'package:peers_touch_base/model/domain/actor/session.pb.dart';
import 'package:peers_touch_base/storage/secure_storage_adapter.dart';

class FakeSecureStorage implements SecureStorageAdapter {
  @override
  Future<String?> get(String key) async => null;
  @override
  Future<void> remove(String key) async {}
  @override
  Future<void> set(String key, String value) async {}
}

void main() {
  test('setSessionSnapshot/getSessionSnapshot roundtrip', () async {
    final ctx = DefaultGlobalContext(secureStorage: FakeSecureStorage());
    final snap = ActorSessionSnapshot(
      actorId: 'alice',
      handle: 'alice',
      protocol: 'peers-touch',
      baseUrl: 'http://localhost:18080',
      accessToken: 't',
      refreshToken: 'r',
    );
    await ctx.setSessionSnapshot(snap);
    final got = ctx.getSessionSnapshot();
    expect(got?.actorId, 'alice');
    expect(got?.handle, 'alice');
    expect(got?.accessToken, 't');
  });

  test('updatePreferencesSnapshot/getPreferencesSnapshot roundtrip', () async {
    final ctx = DefaultGlobalContext(secureStorage: FakeSecureStorage());
    final prefs = ActorPreferences(
      theme: 'dark',
      locale: 'zh-CN',
      telemetry: true,
      endpointOverrides: <MapEntry<String, String>>[MapEntry('api', 'http://localhost')],
      featureFlags: <MapEntry<String, bool>>[MapEntry('x', true)],
      schemaVersion: 1,
    );
    await ctx.updatePreferencesSnapshot(prefs);
    final got = ctx.getPreferencesSnapshot();
    expect(got?.theme, 'dark');
    expect(got?.locale, 'zh-CN');
    expect(got?.telemetry, true);
    expect(got?.schemaVersion, 1);
  });
}
