import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/lifecycle/default_app_lifecycle_orchestrator.dart';
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
  test('initialRoute is /login when no token', () async {
    final ss = FakeSecureStorage();
    final orch = DefaultAppLifecycleOrchestrator(secureStorage: ss);
    final snapshot = await orch.awaitReadyGate();
    expect(snapshot.initialRoute, '/login');
  });

  test('initialRoute is /shell when token exists', () async {
    final ss = FakeSecureStorage();
    await ss.set('token_key', 'abc');
    final orch = DefaultAppLifecycleOrchestrator(secureStorage: ss);
    final snapshot = await orch.awaitReadyGate();
    expect(snapshot.initialRoute, '/shell');
  });
}
