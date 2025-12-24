import 'package:peers_touch_base/storage/secure_storage.dart';
import 'package:peers_touch_base/storage/secure_storage_adapter.dart';

class DesktopSecureStorageAdapter implements SecureStorageAdapter {
  DesktopSecureStorageAdapter(this._inner);
  final SecureStorage _inner;
  @override
  Future<void> set(String key, String value) => _inner.set(key, value);
  @override
  Future<String?> get(String key) => _inner.get(key);
  @override
  Future<void> remove(String key) => _inner.remove(key);
}
