import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/context/default_global_context.dart';
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

void main() {
  test('setSession writes tokens', () async {
    final ss = FakeSecureStorage();
    final ctx = DefaultGlobalContext(secureStorage: ss);
    await ctx.setSession({
      'userId': 'u1',
      'username': 'u1',
      'protocol': 'peers-touch',
      'baseUrl': 'http://localhost:18080',
      'accessToken': 'token123',
      'refreshToken': 'ref456',
    });
    expect(await ss.get('token_key'), 'token123');
    expect(await ss.get('refresh_token_key'), 'ref456');
  });

  test('clear session removes tokens', () async {
    final ss = FakeSecureStorage();
    final ctx = DefaultGlobalContext(secureStorage: ss);
    await ss.set('token_key', 'x');
    await ss.set('refresh_token_key', 'y');
    await ctx.setSession(null);
    expect(await ss.get('token_key'), isNull);
    expect(await ss.get('refresh_token_key'), isNull);
  });
}
