import 'package:peers_touch_base/storage/local_storage_adapter.dart';
import 'package:peers_touch_base/storage/local_storage.dart' as base;

class DesktopLocalStorageAdapter implements LocalStorageAdapter {
  final base.LocalStorage _inner;
  DesktopLocalStorageAdapter(this._inner);
  @override
  Future<void> set(String key, dynamic value) => _inner.set(key, value);
  @override
  Future<T?> get<T>(String key) => _inner.get<T>(key);
  @override
  Future<void> remove(String key) => _inner.remove(key);
}
