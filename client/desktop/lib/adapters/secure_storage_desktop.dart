import 'package:peers_touch_base/storage/secure_storage_adapter.dart';
import 'package:peers_touch_desktop/core/storage/secure_storage.dart' as ds;

class DesktopSecureStorageAdapter implements SecureStorageAdapter {
  final ds.SecureStorage _inner;
  DesktopSecureStorageAdapter(this._inner);
  @override
  Future<void> set(String key, String value) => _inner.set(key, value);
  @override
  Future<String?> get(String key) => _inner.get(key);
  @override
  Future<void> remove(String key) => _inner.remove(key);
}
