import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/context/default_global_context.dart';
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
  test('setProtocolTag emits onProtocolChange', () async {
    final ctx = DefaultGlobalContext(secureStorage: FakeSecureStorage());
    String? last;
    final sub = ctx.onProtocolChange.listen((v) => last = v);
    await ctx.setProtocolTag('mastodon');
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(last, 'mastodon');
    await sub.cancel();
  });
}
