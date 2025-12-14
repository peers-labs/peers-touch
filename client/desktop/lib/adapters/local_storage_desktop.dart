import 'package:peers_touch_base/storage/local_storage_adapter.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart' as ds;

class DesktopLocalStorageAdapter implements LocalStorageAdapter {
  final ds.LocalStorage _inner;
  DesktopLocalStorageAdapter(this._inner);
  @override
  Future<void> set(String key, dynamic value) => _inner.set(key, value);
  @override
  T? get<T>(String key) => _inner.get<T>(key);
  @override
  Future<void> remove(String key) => _inner.remove(key);
}
