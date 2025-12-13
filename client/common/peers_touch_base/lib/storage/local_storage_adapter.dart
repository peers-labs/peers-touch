abstract class LocalStorageAdapter {
  Future<void> set(String key, dynamic value);
  T? get<T>(String key);
  Future<void> remove(String key);
}
