import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/context/default_global_context.dart';
import 'package:peers_touch_base/storage/secure_storage_adapter.dart';
import 'package:peers_touch_base/network/connectivity_adapter.dart';

class FakeSecureStorage implements SecureStorageAdapter {
  @override
  Future<String?> get(String key) async => null;
  @override
  Future<void> remove(String key) async {}
  @override
  Future<void> set(String key, String value) async {}
}

class FakeConnectivityAdapter implements ConnectivityAdapter {
  final _ctrl = StreamController<List<String>>.broadcast();
  @override
  Future<bool> isOnline() async => true;
  @override
  Stream<List<String>> get onStatusChange => _ctrl.stream;
  void emit(List<String> v) => _ctrl.add(v);
}

void main() {
  test('onNetworkStatusChange forwards connectivity events', () async {
    final conn = FakeConnectivityAdapter();
    final ctx = DefaultGlobalContext(secureStorage: FakeSecureStorage(), connectivity: conn);
    final events = <List<String>>[];
    final sub = ctx.onNetworkStatusChange.listen(events.add);
    await ctx.hydrate();
    conn.emit(['wifi']);
    await Future<void>.delayed(const Duration(milliseconds: 10));
    expect(events.isNotEmpty, true);
    expect(events.first, ['wifi']);
    await sub.cancel();
  });
}
