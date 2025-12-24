import 'package:peers_touch_base/storage/local_storage.dart' as base;
import 'package:peers_touch_base/storage/local_storage_adapter.dart';

class DesktopLocalStorageAdapter implements LocalStorageAdapter {
  DesktopLocalStorageAdapter(this._inner);
  final base.LocalStorage _inner;
  @override
  Future<void> set(String key, dynamic value) => _inner.set(key, value);
  @override
  Future<T?> get<T>(String key) => _inner.get<T>(key);
  @override
  Future<void> remove(String key) => _inner.remove(key);
}
